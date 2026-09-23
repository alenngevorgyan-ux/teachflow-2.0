import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getProvider } from '../providers/modelProvider.js';
import { validateExternalMaterial } from '../pipeline/materialValidator.js';
import { normalizeArmenianText } from '../pipeline/normalization.js';
import { runFullGenerationPipeline } from '../pipeline/orchestrator.js';
import { retrieveChunks } from '../pipeline/retrieval.js';
import { repository } from '../store/repository.js';
import {
  generateThematicPlan,
  validateThematicPlanDeterministically,
} from '../pipeline/thematicPlanGenerator.js';
import { generateLessonPlanFromRow } from '../pipeline/lessonPlanGenerator.js';
import { gradeSubmissionDeterministically } from '../pipeline/autoGrader.js';
import { runReportReview } from '../pipeline/reportReviewer.js';
import { importLegacyReport } from '../pipeline/legacyReportImporter.js';
import { emisAdapter } from '../pipeline/emisAdapter.js';
import { runArmenianEvaluation } from '../pipeline/armenianEvalHarness.js';
import { assertStudentCode } from '../pipeline/privacyGuard.js';

// Every tool response carries the current policyVersion (the hash of active
// sources + method rules at call time) so an MCP client can tell whether the
// content it just got is still current the next time it checks. Never a tool
// concern to remember to add — one place, applied uniformly.
function withPolicyVersion<T extends Record<string, unknown>>(payload: T): T & { policyVersion: string } {
  return { policyVersion: repository.computePolicyVersion(), ...payload };
}

function toolResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'TeachFlow Curriculum Connector',
    version: '1.0.0',
  });

  // Tool 1: search_curriculum
  server.tool(
    'search_curriculum',
    'Search official confirmed curriculum learning outcomes by subject, grade and keyword query',
    {
      subject: z.string().describe('Subject name (e.g. Բնագիտություն)'),
      grade: z.number().describe('Grade level (e.g. 5)'),
      query: z.string().describe('Search query keyword'),
    },
    async ({ subject, grade, query }) => {
      const outcomes = repository.getConfirmedOutcomes(subject, grade);
      const sources = repository.getSources();
      const normQ = normalizeArmenianText(query);
      const filtered = outcomes
        .filter(
          (o) =>
            normalizeArmenianText(o.text).includes(normQ) ||
            normalizeArmenianText(o.code).includes(normQ)
        )
        .map((o) => ({
          ...o,
          // The outcome's own standardVersion is teacher/methodologist-entered
          // metadata; sourceVersion is the actual current version of that
          // source record in the registry — surfaced explicitly so a client
          // can detect drift between the two.
          sourceVersion: sources.find((s) => s.id === o.sourceId)?.version,
        }));

      return toolResult(
        withPolicyVersion({
          totalOutcomes: filtered.length,
          outcomes: filtered,
        })
      );
    }
  );

  // Tool 2: get_source_fragment
  server.tool(
    'get_source_fragment',
    'Retrieve top verified FACT chunks for a subject, grade, and topic query',
    {
      subject: z.string().describe('Subject name'),
      grade: z.number().describe('Grade level'),
      query: z.string().describe('Topic or concept keyword'),
    },
    async ({ subject, grade, query }) => {
      const { factChunks } = await retrieveChunks(subject, grade, query);
      const topFragments = factChunks.slice(0, 5).map((f) => ({
        chunkId: f.chunk.id,
        sourceId: f.sourceId,
        sourceTitle: f.sourceTitle,
        version: f.version,
        page: f.chunk.page ?? 1,
        text: f.chunk.text,
      }));

      return toolResult(withPolicyVersion({ fragments: topFragments }));
    }
  );

  // Tool 3: generate_assessment_with_trace
  server.tool(
    'generate_assessment_with_trace',
    'Generate a curriculum-grounded assessment with item traces, variant equivalence, and source citations',
    {
      subject: z.string(),
      grade: z.number(),
      topic: z.string(),
      sourceIds: z.array(z.string()).optional(),
    },
    async ({ subject, grade, topic, sourceIds }) => {
      const provider = getProvider();
      const assessment = await runFullGenerationPipeline({
        subject,
        grade,
        topic,
        selectedSourceIds: sourceIds,
        provider,
      });

      // assessment.policyVersion and each item trace's factSources[].version
      // are already real (T1/T2) — no wrapping needed here.
      return toolResult(assessment);
    }
  );

  // Tool 4: validate_material
  server.tool(
    'validate_material',
    'Validate any arbitrary educational text or ChatGPT test against approved curriculum sources',
    {
      subject: z.string(),
      grade: z.number(),
      text: z.string(),
      sourceIds: z.array(z.string()).optional(),
    },
    async ({ subject, grade, text, sourceIds }) => {
      const provider = getProvider();
      const report = await validateExternalMaterial(provider, subject, grade, text, sourceIds);
      // report.policyVersion is already real.
      return toolResult(report);
    }
  );

  // Tool 5: thematic_plan_generate
  server.tool(
    'thematic_plan_generate',
    'Generate a curriculum-aligned annual thematic plan grounded in confirmed outcomes and FACT sources',
    {
      subject: z.string(),
      grade: z.number(),
      academicYear: z.string().default('2025-2026'),
      schoolId: z.string().default('sch-1'),
      weeklyHours: z.number().default(2),
      totalAnnualHours: z.number().default(68),
    },
    async ({ subject, grade, academicYear, schoolId, weeklyHours, totalAnnualHours }) => {
      const plan = await generateThematicPlan({
        subject,
        grade,
        programVersion: '2025-v1',
        academicYear,
        schoolId,
        schoolName: 'Դպրոց Ա (Երևան, հ. 120 հիմնական դպրոց)',
        teacherName: 'Ուսուցիչ Ա',
        weeklyHours,
        totalAnnualHours,
      });

      return toolResult(withPolicyVersion({ plan }));
    }
  );

  // Tool 6: thematic_plan_validate
  server.tool(
    'thematic_plan_validate',
    'Deterministically validate a thematic plan against curriculum hours, mandatory outcomes, and calendar',
    {
      planId: z.string(),
    },
    async ({ planId }) => {
      const plan = repository.getThematicPlan(planId);
      if (!plan) throw new Error(`Plan not found: ${planId}`);
      const outcomes = repository.getConfirmedOutcomes(plan.subject, plan.grade);
      const errors = validateThematicPlanDeterministically(plan, outcomes);

      return toolResult(withPolicyVersion({ planId, valid: errors.length === 0, errors }));
    }
  );

  // Tool 7: lesson_plan_generate
  server.tool(
    'lesson_plan_generate',
    'Generate a 45-minute lesson plan from a thematic plan row, grounded in FACT sources with citations and a validation trace',
    {
      thematicPlanId: z.string(),
      rowId: z.string(),
      durationMinutes: z.number().default(45),
    },
    async ({ thematicPlanId, rowId, durationMinutes }) => {
      const lessonPlan = await generateLessonPlanFromRow({
        thematicPlanId,
        rowId,
        durationMinutes,
      });

      // lessonPlan.trace.policyVersion and .factSources[].version are real (T10).
      return toolResult(lessonPlan);
    }
  );

  // Tool 8: answer_sheet_grade
  server.tool(
    'answer_sheet_grade',
    'Deterministically grade an answer sheet against assessment answer key and propose rubric points for open answers',
    {
      assessmentId: z.string(),
      variant: z.enum(['A', 'B']).default('A'),
      studentCode: z.string().describe('Anonymous student code (e.g. 7B-14). Names are rejected.'),
      answers: z.array(
        z.object({
          itemIndex: z.number(),
          itemId: z.string(),
          studentAnswer: z.string(),
        })
      ),
    },
    async ({ assessmentId, variant, studentCode, answers }) => {
      const assessment = repository.getAssessment(assessmentId);
      if (!assessment) throw new Error(`Assessment not found: ${assessmentId}`);

      assertStudentCode(studentCode);
      const graded = gradeSubmissionDeterministically(assessment, {
        assessmentId,
        variant,
        studentCode,
        timestamp: new Date().toISOString(),
        status: 'scanned_pending_review',
        confidenceOverall: undefined,
        answers: answers.map((a) => ({ ...a, isLowConfidence: false })),
      });

      repository.saveAnswerSheet(graded);

      return toolResult(withPolicyVersion({ answerSheet: graded }));
    }
  );

  // Tool 9: report_review
  server.tool(
    'report_review',
    'AI review assistant: verifies completeness, rules, registry consistency, source fidelity, anomalies, and summary',
    {
      reportId: z.string(),
    },
    async ({ reportId }) => {
      const report = repository.getReport(reportId);
      if (!report) throw new Error(`Report not found: ${reportId}`);
      const reviewResult = runReportReview(report);

      return toolResult(
        withPolicyVersion({
          reportId,
          templateVersion: report.templateVersion,
          review: reviewResult,
        })
      );
    }
  );

  // Tool 10: legacy_report_extract
  server.tool(
    'legacy_report_extract',
    'Extract unstructured legacy report text into structured template schema with confidence and provenance',
    {
      rawText: z.string(),
      fileName: z.string().default('legacy_report.txt'),
      templateId: z.string().default('tpl-program-progress'),
      schoolId: z.string().default('sch-1'),
    },
    async ({ rawText, fileName, templateId, schoolId }) => {
      const report = await importLegacyReport({
        rawText,
        fileName,
        templateId,
        schoolId,
        schoolName: 'Դպրոց Ա',
        authorName: 'Ուսուցիչ (ներմուծված)',
      });

      // report.templateVersion is already real.
      return toolResult(withPolicyVersion({ report }));
    }
  );

  // Tool 11: emis_export
  server.tool(
    'emis_export',
    'Export grades, thematic plans, or reports to EMIS-compatible CSV format',
    {
      exportType: z.enum(['grades', 'thematic_plan', 'report']),
      targetId: z.string(),
    },
    async ({ exportType, targetId }) => {
      let csv = '';
      let sourceVersion: string | undefined;
      if (exportType === 'grades') {
        const assessment = repository.getAssessment(targetId);
        if (!assessment) throw new Error('Assessment not found');
        const sheets = repository.getAnswerSheets(targetId);
        csv = emisAdapter.exportGradesCsv(assessment.topic, sheets);
        sourceVersion = assessment.policyVersion;
      } else if (exportType === 'thematic_plan') {
        const plan = repository.getThematicPlan(targetId);
        if (!plan) throw new Error('Plan not found');
        csv = emisAdapter.exportThematicPlanCsv(plan);
        sourceVersion = plan.programVersion;
      } else {
        const report = repository.getReport(targetId);
        if (!report) throw new Error('Report not found');
        csv = emisAdapter.exportReportCsv(report);
        sourceVersion = report.templateVersion;
      }

      return toolResult(withPolicyVersion({ exportType, targetId, sourceVersion, csv }));
    }
  );

  // Tool 12: armenian_eval_run
  server.tool(
    'armenian_eval_run',
    'Run frozen Armenian evaluation harness across orthography, grammar, terminology, OCR, citations, and refusals',
    {
      providerId: z.string().optional(),
      modelId: z.string().optional(),
    },
    async ({ providerId, modelId }) => {
      const provider = getProvider(providerId || undefined);
      const res = await runArmenianEvaluation(provider, modelId);

      return toolResult(withPolicyVersion({ result: res }));
    }
  );

  return server;
}

export function createMcpRouter(): Router {
  const router = Router();

  // --- Primary transport: Streamable HTTP at /mcp (official SDK transport) ---
  // Stateless: this deployment can run on serverless (Vercel), where nothing
  // guarantees the same instance handles two requests from one client, so a
  // server-held session would silently break. A fresh server + transport is
  // created per request instead of trying to persist one across calls.
  router.post('/mcp', async (req: Request, res: Response) => {
    try {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: unknown) {
      console.error('MCP StreamableHTTP request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err instanceof Error ? err.message : 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // GET/DELETE are part of the Streamable HTTP spec for server-initiated
  // notifications and session termination — neither applies in stateless
  // mode (no session to stream into or tear down), so they're rejected
  // explicitly rather than silently accepted and doing nothing.
  router.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'This MCP server is stateless: no server-initiated GET stream. Use POST.' });
  });
  router.delete('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'This MCP server is stateless: no session to terminate.' });
  });

  // --- Legacy transport: SSE at /sse, kept for older MCP clients ---
  const mcpServerForSse = createMcpServer();
  let sseTransport: SSEServerTransport | null = null;

  router.get('/sse', async (_req: Request, res: Response) => {
    sseTransport = new SSEServerTransport('/sse/messages', res);
    await mcpServerForSse.connect(sseTransport);
  });

  router.post('/sse/messages', async (req: Request, res: Response) => {
    if (sseTransport) {
      await sseTransport.handlePostMessage(req, res);
    } else {
      res.status(400).json({ error: 'SSE connection not established' });
    }
  });

  return router;
}
