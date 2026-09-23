import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { ExtractedOutcomesSchema } from '../../shared/schemas.js';
import { AssessmentItem, CurriculumOutcome, MethodRule, Source } from '../../shared/types.js';
import { validateExternalMaterial } from '../pipeline/materialValidator.js';
import { runSideBySideComparison } from '../pipeline/compare.js';
import { computeRegressionDiff, runRegressionSuite } from '../pipeline/regression.js';
import { runFullGenerationPipeline } from '../pipeline/orchestrator.js';
import { retrieveChunks } from '../pipeline/retrieval.js';
import { validateSingleItem } from '../pipeline/validator.js';
import { getProvider } from '../providers/modelProvider.js';
import { getJudgeProvider, isTypeSafeJevConfigured } from '../providers/judgeProvider.js';
import { repository } from '../store/repository.js';

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

  router.post('/sources', (req: Request, res: Response) => {
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
      res.json({ source: saved });
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
      const provider = getProvider('gemini');

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
    res.json({
      availableJudges: [
        {
          id: 'gemini',
          name: 'Google Gemini 3.8 Flash (T=0, Structured)',
          configured: Boolean(process.env.GEMINI_API_KEY),
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

  // --- Assessments ---
  router.post('/assessments/generate', async (req: Request, res: Response) => {
    try {
      const {
        subject,
        grade,
        topic,
        selectedSourceIds,
        providerId = 'gemini',
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
    const { status } = req.body;
    const ok = repository.updateAssessmentStatus(req.params.id, status);
    res.json({ success: ok });
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
      const provider = getProvider('gemini');
      const { judgeProviderId = 'gemini', judgeConfidenceThreshold } = req.body;
      const judgeProvider = getJudgeProvider(judgeProviderId);
      const { trace } = await validateSingleItem(
        updatedItem,
        assessment.subject,
        assessment.grade,
        provider,
        {
          judgeProvider,
          judgeConfidenceThreshold:
            typeof judgeConfidenceThreshold === 'number' ? judgeConfidenceThreshold : 0.8,
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
        providerId = 'gemini',
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
        providerId = 'gemini',
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
      const { providerId = 'gemini', modelId = 'gemini-3.8-flash' } = req.body;
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

  return router;
}
