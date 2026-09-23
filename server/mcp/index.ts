import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
      const normQ = normalizeArmenianText(query);
      const filtered = outcomes.filter(
        (o) =>
          normalizeArmenianText(o.text).includes(normQ) ||
          normalizeArmenianText(o.code).includes(normQ)
      );
      const policyVersion = repository.computePolicyVersion();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                policyVersion,
                totalOutcomes: filtered.length,
                outcomes: filtered,
              },
              null,
              2
            ),
          },
        ],
      };
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
      const { factChunks } = retrieveChunks(subject, grade, query);
      const policyVersion = repository.computePolicyVersion();
      const topFragments = factChunks.slice(0, 5).map((f) => ({
        chunkId: f.chunk.id,
        sourceId: f.sourceId,
        sourceTitle: f.sourceTitle,
        version: f.version,
        page: f.chunk.page ?? 1,
        text: f.chunk.text,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                policyVersion,
                fragments: topFragments,
              },
              null,
              2
            ),
          },
        ],
      };
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(assessment, null, 2),
          },
        ],
      };
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    }
  );

  // Tool 5: thematic_plan_generate
  server.tool(
    'thematic_plan_generate',
    'Generate or scaffold a deterministic curriculum-aligned annual thematic plan with hours and outcomes',
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(plan, null, 2),
          },
        ],
      };
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ planId, valid: errors.length === 0, errors }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 7: lesson_plan_generate
  server.tool(
    'lesson_plan_generate',
    'Generate a 45-minute lesson plan from a thematic plan row, grounded in FACT sources with citations',
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(lessonPlan, null, 2),
          },
        ],
      };
    }
  );

  // Tool 8: answer_sheet_grade
  server.tool(
    'answer_sheet_grade',
    'Deterministically grade an answer sheet against assessment answer key and propose rubric points for open answers',
    {
      assessmentId: z.string(),
      variant: z.enum(['A', 'B']).default('A'),
      studentCode: z.string().default('7B-01'),
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

      const graded = gradeSubmissionDeterministically(assessment, {
        assessmentId,
        variant,
        studentCode,
        timestamp: new Date().toISOString(),
        status: 'scanned_pending_review',
        confidenceOverall: undefined,
        answers: answers.map((a: any) => ({ ...a, confidence: a.confidence, isLowConfidence: false })),
      });

      repository.saveAnswerSheet(graded);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(graded, null, 2),
          },
        ],
      };
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(reviewResult, null, 2),
          },
        ],
      };
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
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
      if (exportType === 'grades') {
        const assessment = repository.getAssessment(targetId);
        if (!assessment) throw new Error('Assessment not found');
        const sheets = repository.getAnswerSheets(targetId);
        csv = emisAdapter.exportGradesCsv(assessment.topic, sheets);
      } else if (exportType === 'thematic_plan') {
        const plan = repository.getThematicPlan(targetId);
        if (!plan) throw new Error('Plan not found');
        csv = emisAdapter.exportThematicPlanCsv(plan);
      } else {
        const report = repository.getReport(targetId);
        if (!report) throw new Error('Report not found');
        csv = emisAdapter.exportReportCsv(report);
      }

      return {
        content: [
          {
            type: 'text',
            text: csv,
          },
        ],
      };
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

export function createMcpRouter(): Router {
  const router = Router();
  const mcpServer = createMcpServer();

  // SSE Transport connection map for Streamable HTTP at /mcp
  let transport: SSEServerTransport | null = null;

  router.get('/mcp/sse', async (req: Request, res: Response) => {
    transport = new SSEServerTransport('/mcp/messages', res);
    await mcpServer.connect(transport);
  });

  router.post('/mcp/messages', async (req: Request, res: Response) => {
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).json({ error: 'SSE connection not established' });
    }
  });

  return router;
}
