import crypto from 'crypto';
import multer from 'multer';
import { Request, Response, Router } from 'express';
import { ExtractedOutcomesSchema } from '../../shared/schemas.js';
import {
  AssessmentItem,
  CurriculumOutcome,
  MethodRule,
  Source,
  ThematicPlan,
  LessonPlan,
  ReportTemplate,
  ReportInstance,
  AnswerSheetSubmission,
  TerminologyGlossaryItem,
} from '../../shared/types.js';
import { validateExternalMaterial } from '../pipeline/materialValidator.js';
import { runSideBySideComparison } from '../pipeline/compare.js';
import { computeRegressionDiff, runRegressionSuite } from '../pipeline/regression.js';
import { runFullGenerationPipeline } from '../pipeline/orchestrator.js';
import { retrieveChunks } from '../pipeline/retrieval.js';
import { validateSingleItem } from '../pipeline/validator.js';
import { evaluateReadyForClassroomGate } from '../pipeline/statusGate.js';
import { getDefaultProviderId, getProvider, isProviderConfigured } from '../providers/modelProvider.js';
import { embedChunksInPlace } from '../providers/embeddingProvider.js';
import { getJudgeProvider, isTypeSafeJevConfigured } from '../providers/judgeProvider.js';
import { repository } from '../store/repository.js';
import {
  generateThematicPlan,
  validateThematicPlanDeterministically,
} from '../pipeline/thematicPlanGenerator.js';
import { generateLessonPlanFromRow } from '../pipeline/lessonPlanGenerator.js';
import { computeItemAnalysis, gradeSubmissionDeterministically } from '../pipeline/autoGrader.js';
import { runReportReview } from '../pipeline/reportReviewer.js';
import { importLegacyReport } from '../pipeline/legacyReportImporter.js';
import { checkPrivacy } from '../pipeline/privacyGuard.js';
import { emisAdapter } from '../pipeline/emisAdapter.js';
import { runArmenianEvaluation } from '../pipeline/armenianEvalHarness.js';
import { ingestSourceFile } from '../pipeline/sourceIngestion.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export function createApiRouter(): Router {
  const router = Router();

  // --- Sources ---
  router.get('/sources', (_req: Request, res: Response) => {
    const sources = repository.getSources();
    // Return sources with citing count
    const assessments = repository.getAssessments();
    const sourceUsageMap: Record<string, number> = {};

    for (const a of assessments) {
      for (const item of a.items) {
        for (const cit of item.citations) {
          const chunkId = cit.chunkId;
          const srcId = chunkId.split('#')[0];
          sourceUsageMap[srcId] = (sourceUsageMap[srcId] || 0) + 1;
        }
      }
    }

    const enriched = sources.map((s) => ({
      ...s,
      usageCount: sourceUsageMap[s.id] || 0,
    }));

    res.json({ sources: enriched });
  });

  router.post('/sources', async (req: Request, res: Response) => {
    try {
      const {
        title,
        authority,
        docType,
        subject,
        grades,
        role,
        version,
        effectiveFrom,
        text,
        isOcr,
      } = req.body;

      if (!title || !subject || !role || !text) {
        return res.status(400).json({ error: 'Missing required source metadata or text.' });
      }

      const sourceId = `src-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const sha256 = crypto.createHash('sha256').update(text).digest('hex');

      // Chunk text by ~800 characters with paragraph boundaries
      const paragraphs = text.split(/\n\s*\n/);
      const chunks: Source['chunks'] = [];
      let currentChunkText = '';
      let chunkIndex = 1;
      let currentPage = 1;

      for (const p of paragraphs) {
        const trimmed = p.trim();
        if (!trimmed) continue;

        if (currentChunkText.length + trimmed.length > 800) {
          if (currentChunkText) {
            chunks.push({
              id: `${sourceId}#p${currentPage}#c${chunkIndex}`,
              sourceId,
              page: currentPage,
              text: currentChunkText.trim(),
            });
            chunkIndex++;
            if (chunkIndex % 3 === 0) currentPage++;
            currentChunkText = '';
          }
        }
        currentChunkText += (currentChunkText ? '\n\n' : '') + trimmed;
      }

      if (currentChunkText) {
        chunks.push({
          id: `${sourceId}#p${currentPage}#c${chunkIndex}`,
          sourceId,
          page: currentPage,
          text: currentChunkText.trim(),
        });
      }

      // Compute Gemini embeddings per chunk so retrieval can use semantic
      // similarity, not just keyword matching. Never blocks the upload: a
      // missing GEMINI_API_KEY or a failed call just means these chunks
      // degrade to keyword-only retrieval, and that is reported back visibly.
      const embeddingResult = await embedChunksInPlace(chunks);

      const newSource: Source = {
        id: sourceId,
        title,
        authority: authority || 'Գրանցված մեթոդիստի կողմից',
        docType: docType || 'textbook',
        subject,
        grades: Array.isArray(grades) ? grades.map(Number) : [5],
        role: role || 'FACT',
        version: version || '1.0',
        effectiveFrom: effectiveFrom || new Date().toISOString().substring(0, 10),
        status: 'active',
        sha256,
        isDemo: false,
        uploadedAt: new Date().toISOString(),
        ocr: Boolean(isOcr),
        chunks,
      };

      const saved = repository.saveSource(newSource);
      res.json({ source: saved, embeddingWarning: embeddingResult.warning });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Real file upload: PDF (per-page, real page numbers, scanned pages -> Gemini
  // OCR), DOCX, TXT. sha256 is computed over the raw uploaded bytes.
  router.post('/sources/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Ֆայլ չի ուղարկվել (multipart field name՝ "file")' });
      }

      const { title, authority, docType, subject, grades, role, version, effectiveFrom } = req.body;
      if (!title || !subject) {
        return res.status(400).json({ error: 'Missing required source metadata (title, subject).' });
      }

      const { source, warnings } = await ingestSourceFile({
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        title,
        authority,
        docType,
        subject,
        grades: (Array.isArray(grades) ? grades : typeof grades === 'string' ? grades.split(',') : [5]).map(
          Number
        ),
        role,
        version,
        effectiveFrom,
      });

      res.json({ source, warnings });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/sources/:id/supersede', (req: Request, res: Response) => {
    try {
      const oldId = req.params.id;
      const oldSource = repository.getSource(oldId);
      if (!oldSource) {
        return res.status(404).json({ error: 'Source not found' });
      }

      const { newVersion, effectiveFrom, text } = req.body;
      const contentToUse = text || oldSource.chunks.map((c) => c.text).join('\n\n');
      const newSourceId = `src-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const sha256 = crypto.createHash('sha256').update(contentToUse).digest('hex');

      const newChunks = oldSource.chunks.map((c, idx) => ({
        id: `${newSourceId}#p${c.page ?? 1}#c${idx + 1}`,
        sourceId: newSourceId,
        page: c.page,
        text: c.text,
      }));

      const newSource: Source = {
        ...oldSource,
        id: newSourceId,
        version: newVersion || `${oldSource.version}-next`,
        effectiveFrom: effectiveFrom || new Date().toISOString().substring(0, 10),
        status: 'active',
        sha256,
        isDemo: false,
        uploadedAt: new Date().toISOString(),
        chunks: newChunks,
      };

      const result = repository.supersedeSource(oldId, newSource);
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.delete('/sources/:id', (req: Request, res: Response) => {
    const success = repository.deleteSource(req.params.id);
    res.json({ success });
  });

  router.post('/sources/extract-outcomes', async (req: Request, res: Response) => {
    try {
      const { text, subject, grade, sourceId } = req.body;
      const provider = getProvider();

      const prompt = `You are a curriculum specialist. Extract standard curriculum outcome codes and text descriptions in Armenian for Grade ${grade} Subject "${subject}":\n\n${text}`;
      const resAI = await provider.generateStructured(prompt, ExtractedOutcomesSchema, {
        temperature: 0.0,
        actionName: 'extractOutcomes',
      });

      const outcomes: CurriculumOutcome[] = resAI.output.outcomes.map((o) => ({
        code: o.code,
        text: o.text,
        subject,
        grade: Number(grade),
        standardVersion: 'pending-confirmation',
        sourceId: sourceId || 'extracted',
        confirmed: false, // Unconfirmed outcomes are never used until methodologist confirms
      }));

      repository.saveOutcomes(outcomes);
      res.json({ outcomes });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // --- Outcomes ---
  router.get('/outcomes', (req: Request, res: Response) => {
    const outcomes = repository.getOutcomes();
    res.json({ outcomes });
  });

  router.post('/outcomes/confirm', (req: Request, res: Response) => {
    const { code, confirmed } = req.body;
    const ok = repository.confirmOutcome(code, Boolean(confirmed));
    res.json({ success: ok });
  });

  router.delete('/outcomes/:code', (req: Request, res: Response) => {
    const ok = repository.deleteOutcome(req.params.code);
    res.json({ success: ok });
  });

  // --- Rules ---
  router.get('/rules', (_req: Request, res: Response) => {
    res.json({ rules: repository.getRules() });
  });

  router.post('/rules', (req: Request, res: Response) => {
    const { title, description, kind, params, severity, sourceId } = req.body;
    const newRule: MethodRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title,
      description,
      kind: kind || 'deterministic',
      params: params || {},
      severity: severity || 'warning',
      sourceId,
      active: true,
    };
    const saved = repository.saveRule(newRule);
    res.json({ rule: saved });
  });

  router.post('/rules/:id/toggle', (req: Request, res: Response) => {
    const ok = repository.toggleRule(req.params.id, Boolean(req.body.active));
    res.json({ success: ok });
  });

  router.delete('/rules/:id', (req: Request, res: Response) => {
    const ok = repository.deleteRule(req.params.id);
    res.json({ success: ok });
  });

  // --- Judge Status ---
  router.get('/judge/status', (_req: Request, res: Response) => {
    const defaultJudge = getJudgeProvider('gemini');
    res.json({
      availableJudges: [
        {
          id: 'gemini',
          name: `${defaultJudge.providerId} · ${defaultJudge.modelId} (T=0, Structured)`,
          providerId: defaultJudge.providerId,
          modelId: defaultJudge.modelId,
          configured: isProviderConfigured(getDefaultProviderId()),
          isDefault: true,
        },
        {
          id: 'typesafe_jev',
          name: 'TypeSafe Jev API',
          configured: isTypeSafeJevConfigured(),
          isDefault: false,
        },
      ],
      typeSafeConfigured: isTypeSafeJevConfigured(),
    });
  });

  // --- Active model provider (explicit config, no fallback) ---
  router.get('/model/status', (_req: Request, res: Response) => {
    const providerId = getDefaultProviderId();
    let modelId: string | null = null;
    let error: string | null = null;
    try {
      modelId = getProvider(providerId).defaultModelId ?? null;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    }
    res.json({ providerId, modelId, configured: isProviderConfigured(providerId), error });
  });

  // --- Assessments ---
  router.post('/assessments/generate', async (req: Request, res: Response) => {
    try {
      const {
        subject,
        grade,
        topic,
        selectedSourceIds,
        providerId = getDefaultProviderId(),
        modelId,
        generateOnlyCoveredPart,
        judgeProviderId = 'gemini',
        judgeConfidenceThreshold,
      } = req.body;

      if (!subject || !grade || !topic) {
        return res.status(400).json({ error: 'Subject, grade, and topic are required.' });
      }

      const provider = getProvider(providerId);
      const judgeProvider = getJudgeProvider(judgeProviderId);

      const assessment = await runFullGenerationPipeline({
        subject,
        grade: Number(grade),
        topic,
        selectedSourceIds,
        provider,
        modelId,
        generateOnlyCoveredPart: Boolean(generateOnlyCoveredPart),
        judgeProvider,
        judgeConfidenceThreshold:
          typeof judgeConfidenceThreshold === 'number' ? judgeConfidenceThreshold : 0.8,
      });

      res.json({ assessment });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/assessments', (_req: Request, res: Response) => {
    res.json({ assessments: repository.getAssessments() });
  });

  router.get('/assessments/:id', (req: Request, res: Response) => {
    const a = repository.getAssessment(req.params.id);
    if (!a) return res.status(404).json({ error: 'Assessment not found' });
    res.json({ assessment: a });
  });

  router.post('/assessments/:id/status', (req: Request, res: Response) => {
    const { status, acceptedWarnings } = req.body as {
      status?: string;
      acceptedWarnings?: string[];
    };

    const assessment = repository.getAssessment(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // 'validated' and 'refused' are computed by the server during generation/re-validation.
    // Clients may only ever request 'draft' (revert) or 'ready_for_classroom' (promote).
    if (status !== 'draft' && status !== 'ready_for_classroom') {
      return res.status(400).json({
        error: `Կարգավիճակը («${status}») չի կարող սահմանվել ուղղակիորեն: Թույլատրված է միայն 'draft' կամ 'ready_for_classroom':`,
      });
    }

    if (status === 'draft') {
      repository.updateAssessmentStatus(assessment.id, 'draft');
      return res.json({ success: true, status: 'draft' });
    }

    // status === 'ready_for_classroom': server-side gate on the independently
    // computed item traces, never on client-asserted state.
    const gate = evaluateReadyForClassroomGate(assessment.traces, acceptedWarnings || []);
    if (!gate.ok) {
      if (gate.reason === 'has_fail') {
        return res.status(409).json({
          error: `Հնարավոր չէ պատրաստել դասարանի համար. ${gate.failingItemIds.length} առաջադրանք ունի FAIL ստուգում. ${gate.failingItemIds.join(', ')}`,
        });
      }
      return res.status(409).json({
        error: `${gate.unacceptedWarningItemIds.length} առաջադրանք ունի WARN ստուգում, որը դեռ չի հաստատվել ուսուցչի կողմից:`,
        warningItemIds: gate.unacceptedWarningItemIds,
      });
    }

    const ok = repository.updateAssessmentStatus(
      assessment.id,
      'ready_for_classroom',
      gate.warningItemIds.length > 0 ? gate.warningItemIds : undefined
    );
    res.json({ success: ok, status: 'ready_for_classroom' });
  });

  router.post('/assessments/:id/items/:itemId', async (req: Request, res: Response) => {
    try {
      const assessment = repository.getAssessment(req.params.id);
      if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

      const itemIdx = assessment.items.findIndex((i) => i.id === req.params.itemId);
      if (itemIdx < 0) return res.status(404).json({ error: 'Item not found' });

      const updatedItem: AssessmentItem = {
        ...assessment.items[itemIdx],
        ...req.body.item,
      };

      // Re-run validation for edited item
      const provider = getProvider();
      const { judgeProviderId = 'gemini', judgeConfidenceThreshold } = req.body;
      const judgeProvider = getJudgeProvider(judgeProviderId);
      const variantItemCounts: Record<string, number> = {};
      for (const it of assessment.items) {
        const v = it.id === updatedItem.id ? updatedItem.variant : it.variant;
        variantItemCounts[v] = (variantItemCounts[v] || 0) + 1;
      }
      const { trace } = await validateSingleItem(
        updatedItem,
        assessment.subject,
        assessment.grade,
        provider,
        {
          judgeProvider,
          judgeConfidenceThreshold:
            typeof judgeConfidenceThreshold === 'number' ? judgeConfidenceThreshold : 0.8,
          variantItemCounts,
        }
      );

      assessment.items[itemIdx] = updatedItem;
      const traceIdx = assessment.traces.findIndex((t) => t.itemId === updatedItem.id);
      if (traceIdx >= 0) {
        assessment.traces[traceIdx] = trace;
      } else {
        assessment.traces.push(trace);
      }

      repository.saveAssessment(assessment);
      res.json({ assessment, item: updatedItem, trace });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.delete('/assessments/:id', (req: Request, res: Response) => {
    const ok = repository.deleteAssessment(req.params.id);
    res.json({ success: ok });
  });

  // --- Validate Material ---
  router.post('/validate-material', async (req: Request, res: Response) => {
    try {
      const {
        subject,
        grade,
        text,
        selectedSourceIds,
        providerId = getDefaultProviderId(),
        judgeProviderId = 'gemini',
        judgeConfidenceThreshold,
      } = req.body;
      if (!subject || !grade || !text) {
        return res.status(400).json({ error: 'Subject, grade, and text are required.' });
      }

      const provider = getProvider(providerId);
      const judgeProvider = getJudgeProvider(judgeProviderId);

      const report = await validateExternalMaterial(
        provider,
        subject,
        Number(grade),
        text,
        selectedSourceIds,
        {
          judgeProvider,
          judgeConfidenceThreshold:
            typeof judgeConfidenceThreshold === 'number' ? judgeConfidenceThreshold : 0.8,
        }
      );
      res.json({ report });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/validation-reports', (_req: Request, res: Response) => {
    res.json({ reports: repository.getValidationReports() });
  });

  router.delete('/validation-reports/:id', (req: Request, res: Response) => {
    const ok = repository.deleteValidationReport(req.params.id);
    res.json({ success: ok });
  });

  // --- Side-by-Side Compare ---
  router.post('/compare', async (req: Request, res: Response) => {
    try {
      const {
        subject,
        grade,
        topic,
        isUncoveredTopicPreset,
        selectedSourceIds,
        numberOfRuns = 3,
        providerId = getDefaultProviderId(),
        modelId,
        judgeProviderId = 'gemini',
        judgeConfidenceThreshold,
      } = req.body;

      const provider = getProvider(providerId);
      const report = await runSideBySideComparison(provider, {
        subject,
        grade: Number(grade),
        topic,
        isUncoveredTopicPreset: Boolean(isUncoveredTopicPreset),
        selectedSourceIds,
        numberOfRuns: Number(numberOfRuns) || 3,
        modelId,
        judgeProviderId,
        judgeConfidenceThreshold:
          typeof judgeConfidenceThreshold === 'number' ? judgeConfidenceThreshold : 0.8,
      });

      res.json({ report });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/compare/reports', (_req: Request, res: Response) => {
    res.json({ reports: repository.getSideBySideReports() });
  });

  // --- Regression Runner ---
  router.get('/regression/tasks', (_req: Request, res: Response) => {
    res.json({ tasks: repository.getFrozenTasks() });
  });

  router.post('/regression/tasks', (req: Request, res: Response) => {
    const { subject, grade, topic, sourceIds, expectedOutcome, description } = req.body;
    const task = repository.saveFrozenTask({
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      subject,
      grade: Number(grade),
      topic,
      sourceIds: sourceIds || [],
      expectedOutcome: expectedOutcome || 'generate',
      description: description || '',
    });
    res.json({ task });
  });

  router.delete('/regression/tasks/:id', (req: Request, res: Response) => {
    const ok = repository.deleteFrozenTask(req.params.id);
    res.json({ success: ok });
  });

  router.post('/regression/run', async (req: Request, res: Response) => {
    try {
      const { providerId = getDefaultProviderId(), modelId } = req.body;
      const provider = getProvider(providerId);
      const run = await runRegressionSuite(provider, modelId);
      res.json({ run });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/regression/runs', (_req: Request, res: Response) => {
    res.json({ runs: repository.getRegressionRuns() });
  });

  router.get('/regression/diff', (req: Request, res: Response) => {
    const { olderId, newerId } = req.query;
    const runs = repository.getRegressionRuns();
    const older = runs.find((r) => r.id === olderId);
    const newer = runs.find((r) => r.id === newerId);

    if (!older || !newer) {
      return res.status(404).json({ error: 'One or both regression runs not found.' });
    }

    const diff = computeRegressionDiff(older, newer);
    res.json({ diff });
  });

  // --- System & Audit ---
  router.get('/system/policy-version', (_req: Request, res: Response) => {
    res.json({ policyVersion: repository.computePolicyVersion() });
  });

  router.get('/system/audit-logs', (_req: Request, res: Response) => {
    res.json({ auditLogs: repository.getAuditLogs() });
  });

  router.get('/system/export', (_req: Request, res: Response) => {
    res.json(repository.exportAllData());
  });

  router.post('/system/clear-non-demo', (_req: Request, res: Response) => {
    repository.clearNonDemoData();
    res.json({ success: true });
  });

  router.post('/system/clear-demo', (_req: Request, res: Response) => {
    repository.clearDemoData();
    res.json({ success: true });
  });

  router.post('/system/reset-demo', (_req: Request, res: Response) => {
    repository.resetDemoData();
    res.json({ success: true });
  });

  // --- Schools & Teachers ---
  router.get('/schools', (_req: Request, res: Response) => {
    res.json({ schools: repository.getSchools() });
  });

  router.get('/teachers', (_req: Request, res: Response) => {
    res.json({ teachers: repository.getTeachers() });
  });

  // --- Privacy Check ---
  router.post('/privacy/check', (req: Request, res: Response) => {
    const { content = '' } = req.body;
    const result = checkPrivacy(content);
    res.json(result);
  });

  // --- Thematic Plans ---
  router.get('/thematic-plans', (req: Request, res: Response) => {
    const { schoolId, subject, grade } = req.query;
    const plans = repository.getThematicPlans(
      schoolId ? String(schoolId) : undefined,
      subject ? String(subject) : undefined,
      grade !== undefined ? Number(grade) : undefined
    );
    res.json({ plans });
  });

  router.get('/thematic-plans/:id', (req: Request, res: Response) => {
    const plan = repository.getThematicPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Thematic plan not found' });
    res.json({ plan });
  });

  router.post('/thematic-plans', async (req: Request, res: Response) => {
    try {
      const {
        subject = 'Հայոց պատմություն',
        grade = 7,
        programVersion = '2025-v1',
        academicYear = '2025-2026',
        schoolId = 'sch-1',
        schoolName = 'Դպրոց Ա',
        teacherName = 'Ուսուցիչ Ա',
        weeklyHours = 2,
        totalAnnualHours = 68,
      } = req.body;

      const plan = await generateThematicPlan({
        subject,
        grade: Number(grade),
        programVersion,
        academicYear,
        schoolId,
        schoolName,
        teacherName,
        weeklyHours: Number(weeklyHours),
        totalAnnualHours: Number(totalAnnualHours),
      });

      res.json({ plan });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.put('/thematic-plans/:id/rows/:rowId', (req: Request, res: Response) => {
    const { id, rowId } = req.params;
    const updated = repository.updateThematicPlanRow(id, rowId, req.body);
    if (!updated) return res.status(404).json({ error: 'Thematic plan or row not found' });
    res.json({ plan: updated });
  });

  router.get('/thematic-plans/:id/validate', (req: Request, res: Response) => {
    const plan = repository.getThematicPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Thematic plan not found' });
    const outcomes = repository.getConfirmedOutcomes(plan.subject, plan.grade);
    const errors = validateThematicPlanDeterministically(plan, outcomes);
    res.json({ errors, valid: errors.length === 0 });
  });

  router.get('/thematic-plans/:id/export/csv', (req: Request, res: Response) => {
    const plan = repository.getThematicPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Thematic plan not found' });
    const csv = emisAdapter.exportThematicPlanCsv(plan);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="thematic_plan_${plan.id}.csv"`);
    res.send(csv);
  });

  router.delete('/thematic-plans/:id', (req: Request, res: Response) => {
    const ok = repository.deleteThematicPlan(req.params.id);
    res.json({ success: ok });
  });

  // --- Lesson Plans ---
  router.get('/lesson-plans', (req: Request, res: Response) => {
    const { thematicPlanId } = req.query;
    res.json({ lessonPlans: repository.getLessonPlans(thematicPlanId ? String(thematicPlanId) : undefined) });
  });

  router.get('/lesson-plans/:id', (req: Request, res: Response) => {
    const plan = repository.getLessonPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Lesson plan not found' });
    res.json({ lessonPlan: plan });
  });

  router.post('/lesson-plans/generate', async (req: Request, res: Response) => {
    try {
      const { thematicPlanId, rowId, durationMinutes = 45 } = req.body;
      const lessonPlan = await generateLessonPlanFromRow({
        thematicPlanId,
        rowId,
        durationMinutes: Number(durationMinutes),
      });
      res.json({ lessonPlan });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.delete('/lesson-plans/:id', (req: Request, res: Response) => {
    const ok = repository.deleteLessonPlan(req.params.id);
    res.json({ success: ok });
  });

  // --- Answer Sheets & Auto-Grading ---
  router.get('/answer-sheets', (req: Request, res: Response) => {
    const { assessmentId } = req.query;
    res.json({ answerSheets: repository.getAnswerSheets(assessmentId ? String(assessmentId) : undefined) });
  });

  router.get('/answer-sheets/:id', (req: Request, res: Response) => {
    const sheet = repository.getAnswerSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Answer sheet not found' });
    res.json({ answerSheet: sheet });
  });

  router.post('/answer-sheets/scan', (req: Request, res: Response) => {
    try {
      const { assessmentId, variant = 'A', studentCode, answers = [], imageUrl } = req.body;
      const assessment = repository.getAssessment(assessmentId);
      if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

      // Privacy check on student code (prevent full student names)
      if (studentCode) {
        const priv = checkPrivacy(studentCode);
        if (priv.blocked) {
          return res.status(400).json({ error: priv.warnings[0] });
        }
      }

      const graded = gradeSubmissionDeterministically(assessment, {
        assessmentId,
        variant,
        studentCode: studentCode || `7B-${Math.floor(10 + Math.random() * 89)}`,
        timestamp: new Date().toISOString(),
        status: 'scanned_pending_review',
        confidenceOverall: undefined,
        imageUrl,
        answers,
      });

      const saved = repository.saveAnswerSheet(graded);
      res.json({ answerSheet: saved });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/answer-sheets/:id/confirm', (req: Request, res: Response) => {
    const confirmed = repository.confirmAnswerSheet(req.params.id);
    if (!confirmed) return res.status(404).json({ error: 'Answer sheet not found' });
    res.json({ answerSheet: confirmed });
  });

  router.get('/assessments/:id/item-analysis', (req: Request, res: Response) => {
    const items = computeItemAnalysis(req.params.id);
    res.json({ itemAnalysis: items });
  });

  router.get('/assessments/:id/export/csv', (req: Request, res: Response) => {
    const assessment = repository.getAssessment(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    const sheets = repository.getAnswerSheets(assessment.id);
    const csv = emisAdapter.exportGradesCsv(assessment.topic, sheets);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="assessment_grades_${assessment.id}.csv"`);
    res.send(csv);
  });

  // --- Report Templates ---
  router.get('/report-templates', (_req: Request, res: Response) => {
    res.json({ templates: repository.getReportTemplates() });
  });

  router.get('/report-templates/:id', (req: Request, res: Response) => {
    const template = repository.getReportTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: 'Report template not found' });
    res.json({ template });
  });

  router.post('/report-templates', (req: Request, res: Response) => {
    const saved = repository.saveReportTemplate(req.body);
    res.json({ template: saved });
  });

  router.delete('/report-templates/:id', (req: Request, res: Response) => {
    const ok = repository.deleteReportTemplate(req.params.id);
    res.json({ success: ok });
  });

  // --- Reports (Instances) ---
  router.get('/reports', (req: Request, res: Response) => {
    const { schoolId, authorRole, period, status, templateId, subject, grade } = req.query;
    const reports = repository.getReports({
      schoolId: schoolId ? String(schoolId) : undefined,
      authorRole: authorRole ? String(authorRole) : undefined,
      period: period ? String(period) : undefined,
      status: status ? String(status) : undefined,
      templateId: templateId ? String(templateId) : undefined,
      subject: subject ? String(subject) : undefined,
      grade: grade !== undefined ? Number(grade) : undefined,
    });
    res.json({ reports });
  });

  router.get('/reports/:id', (req: Request, res: Response) => {
    const report = repository.getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ report });
  });

  router.post('/reports', (req: Request, res: Response) => {
    try {
      const report = repository.saveReport(req.body);
      res.json({ report });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/reports/consolidate', (req: Request, res: Response) => {
    try {
      const {
        templateId = 'tpl-method-unit',
        schoolId = 'sch-1',
        academicYear = '2025-2026',
        period = 'half_year',
        subjectGroup = 'Հումանիտար և բնագիտական առարկաներ',
      } = req.body;

      const consolidated = repository.consolidateSchoolReport(
        templateId,
        schoolId,
        academicYear,
        period,
        subjectGroup
      );
      res.json({ report: consolidated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/reports/legacy-import', async (req: Request, res: Response) => {
    try {
      const {
        rawText,
        fileName = 'legacy_report.txt',
        templateId = 'tpl-program-progress',
        schoolId = 'sch-1',
        schoolName = 'Դպրոց Ա',
        authorName = 'Ուսուցիչ (ներմուծված)',
      } = req.body;

      if (!rawText) {
        return res.status(400).json({ error: 'Missing rawText to import' });
      }

      const report = await importLegacyReport({
        rawText,
        fileName,
        templateId,
        schoolId,
        schoolName,
        authorName,
      });

      res.json({ report });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/reports/:id/review', (req: Request, res: Response) => {
    const report = repository.getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const reviewResult = runReportReview(report);
    res.json({ review: reviewResult });
  });

  router.put('/reports/:id/status', (req: Request, res: Response) => {
    const { status, comment } = req.body;
    const updated = repository.updateReportStatus(req.params.id, status, comment);
    if (!updated) return res.status(404).json({ error: 'Report not found' });
    res.json({ report: updated });
  });

  router.get('/reports/:id/export/csv', (req: Request, res: Response) => {
    const report = repository.getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const csv = emisAdapter.exportReportCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report_${report.id}.csv"`);
    res.send(csv);
  });

  router.delete('/reports/:id', (req: Request, res: Response) => {
    const ok = repository.deleteReport(req.params.id);
    res.json({ success: ok });
  });

  // --- Glossary ---
  router.get('/glossary', (req: Request, res: Response) => {
    const { subject, grade } = req.query;
    res.json({
      glossary: repository.getGlossary(
        subject ? String(subject) : undefined,
        grade !== undefined ? Number(grade) : undefined
      ),
    });
  });

  router.post('/glossary', (req: Request, res: Response) => {
    const saved = repository.saveGlossaryItem(req.body);
    res.json({ item: saved });
  });

  router.delete('/glossary/:id', (req: Request, res: Response) => {
    const ok = repository.deleteGlossaryItem(req.params.id);
    res.json({ success: ok });
  });

  // --- Armenian Eval ---
  router.get('/armenian-eval/tasks', (_req: Request, res: Response) => {
    res.json({ tasks: repository.getArmenianEvalTasks() });
  });

  router.post('/armenian-eval/tasks', (req: Request, res: Response) => {
    const saved = repository.saveArmenianEvalTask(req.body);
    res.json({ task: saved });
  });

  router.get('/armenian-eval/results', (_req: Request, res: Response) => {
    res.json({ results: repository.getArmenianEvalResults() });
  });

  router.post('/armenian-eval/run', async (req: Request, res: Response) => {
    try {
      const { providerId = getDefaultProviderId(), modelId } = req.body;
      const provider = getProvider(providerId);
      const result = await runArmenianEvaluation(provider, modelId);
      res.json({ result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
