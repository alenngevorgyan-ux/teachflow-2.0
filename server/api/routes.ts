import crypto from 'crypto';
import multer from 'multer';
import { Request, Response, Router } from 'express';
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
  MaterialReview,
} from '../../shared/types.js';
import { validateExternalMaterial } from '../pipeline/materialValidator.js';
import {
  confirmSegmentation,
  createReview,
  decide,
  editSegmentation,
  getReview,
  readConsistent,
  reviewStatus,
  runChecks,
  segment,
  selectSources,
  setTeacherKey,
  suggest,
  unassignedParagraphs,
  undoLast,
} from '../materials/reviewService.js';
import { resolveStructure } from '../materials/spans.js';
import { isFixtureMode } from '../providers/fixtureProvider.js';
import { buildChangeList, correctedFileName, exportReviewDocx } from '../materials/exportReview.js';
import { currentParagraphs, loadWorkingCopy } from '../materials/workingCopy.js';
import {
  confirmSource,
  revokeSourceConfirmation,
  sourceConfirmationState,
  sourceContentHash,
} from '../pipeline/sourceConfirmation.js';
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
import { extractOutcomes } from '../pipeline/outcomeExtractor.js';
import { ConflictError, DeclarationRequiredError, UserInputError, parseGradeInput } from '../pipeline/errors.js';
import { DocxRejectedError } from '../docx/docxPackage.js';
import {
  PrivacyViolationError,
  assertNoPii,
  assertStudentCode,
  checkPrivacy,
} from '../pipeline/privacyGuard.js';
import { emisAdapter } from '../pipeline/emisAdapter.js';
import { computeCategoryModelRecommendations, runArmenianEvaluation } from '../pipeline/armenianEvalHarness.js';
import { ingestSourceFile, parseSourceMetadata } from '../pipeline/sourceIngestion.js';
import { parseWorkspaceIntent } from '../pipeline/workspaceIntent.js';
import { scanAnswerSheet } from '../pipeline/answerSheetScanner.js';
import { generateAnswerSheetQrDataUrl } from '../pipeline/answerSheetQr.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Privacy violations are client errors (422) with the findings attached so the
// UI can show exactly what was blocked; everything else stays a 500.
function sendError(res: Response, err: unknown) {
  if (err instanceof ConflictError) {
    return res.status(409).json({ error: err.message, code: 'conflict' });
  }
  if (err instanceof DeclarationRequiredError) {
    return res.status(400).json({ error: err.message, code: 'declaration_required', parts: err.parts });
  }
  if (err instanceof DocxRejectedError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err instanceof UserInputError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof PrivacyViolationError) {
    return res.status(422).json({
      error: err.message,
      privacy: { where: err.where, warnings: err.warnings, findings: err.findings },
    });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ error: msg });
}

// Every listed field must be a non-empty string. Missing input is a client
// error, never a value we invent on the server.
function requireText(fields: Record<string, unknown>): void {
  const missing = Object.entries(fields)
    .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new UserInputError(`Պարտադիր դաշտերը բացակայում են՝ ${missing.join(', ')}:`);
  }
}

// Paths whose bodies are official sources: an institution's phone / e-mail
// there is not student data (names near student markers are still blocked).
const CONTACTS_ALLOWED = [/^\/sources(\/|$)/];

export function createApiRouter(): Router {
  const router = Router();

  // Privacy guard on every JSON write path (rule 5). Multipart uploads are
  // checked after text extraction (sourceIngestion, answerSheetScanner).
  router.use((req: Request, res: Response, next) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !req.body || typeof req.body !== 'object') return next();
    if (req.path === '/privacy/check') return next(); // stores nothing; reports findings itself
    try {
      assertNoPii(req.body, `${req.method} ${req.path}`, {
        allowContacts: CONTACTS_ALLOWED.some((re) => re.test(req.path)),
      });
      next();
    } catch (err) {
      sendError(res, err);
    }
  });

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

    const enriched = sources.map((s) => {
      const confirmation = sourceConfirmationState(s);
      return {
        ...s,
        usageCount: sourceUsageMap[s.id] || 0,
        contentHash: sourceContentHash(s),
        confirmationState: confirmation.state,
        confirmationReason: confirmation.reason,
      };
    });

    res.json({ sources: enriched });
  });

  router.post('/sources', async (req: Request, res: Response) => {
    try {
      const { text, isOcr } = req.body;
      const { metadata, errors } = parseSourceMetadata(req.body);
      if (!metadata || !text) {
        return res.status(400).json({ error: `Missing or invalid source fields: ${[...errors, ...(text ? [] : ['text'])].join(', ')}` });
      }
      assertNoPii(text, 'source.text', { allowContacts: true });

      const sourceId = `src-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const sha256 = crypto.createHash('sha256').update(text).digest('hex');

      // Chunk text by ~800 characters with paragraph boundaries
      const paragraphs = text.split(/\n\s*\n/);
      const chunks: Source['chunks'] = [];
      let currentChunkText = '';
      let chunkIndex = 1;
      // Pasted text has no pages: chunks carry no page number (never invented).

      for (const p of paragraphs) {
        const trimmed = p.trim();
        if (!trimmed) continue;

        if (currentChunkText.length + trimmed.length > 800) {
          if (currentChunkText) {
            chunks.push({
              id: `${sourceId}#c${chunkIndex}`,
              sourceId,
              text: currentChunkText.trim(),
            });
            chunkIndex++;
            currentChunkText = '';
          }
        }
        currentChunkText += (currentChunkText ? '\n\n' : '') + trimmed;
      }

      if (currentChunkText) {
        chunks.push({
          id: `${sourceId}#c${chunkIndex}`,
          sourceId,
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
        ...metadata,
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
      sendError(res, err);
    }
  });

  // Real file upload: PDF (per-page, real page numbers, scanned pages -> Gemini
  // OCR), DOCX, TXT. sha256 is computed over the raw uploaded bytes.
  router.post('/sources/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Ֆայլ չի ուղարկվել (multipart field name՝ "file")' });
      }

      const { metadata, errors } = parseSourceMetadata(req.body);
      if (!metadata) {
        return res.status(400).json({ error: `Missing or invalid source fields: ${errors.join(', ')}` });
      }

      const { source, warnings } = await ingestSourceFile({
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        ...metadata,
      });

      res.json({ source, warnings });
    } catch (err: unknown) {
      sendError(res, err);
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
        id: c.page !== undefined ? `${newSourceId}#p${c.page}#c${idx + 1}` : `${newSourceId}#c${idx + 1}`,
        sourceId: newSourceId,
        page: c.page,
        text: c.text,
      }));

      const newSource: Source = {
        ...revokeSourceConfirmation(oldSource),
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
      sendError(res, err);
    }
  });

  // Confirmation of one source version for content checks. The name is what
  // the person typed; without authentication it is not a verified identity.
  router.post('/sources/:id/confirm', (req: Request, res: Response) => {
    try {
      const source = repository.getSource(req.params.id);
      if (!source) return res.status(404).json({ error: 'Source not found' });
      const { confirmedByName, expectedVersion, expectedContentHash } = req.body;
      const saved = repository.saveSource(confirmSource(source, { confirmedByName, expectedVersion, expectedContentHash }));
      res.json({ source: saved, confirmationState: sourceConfirmationState(saved).state });
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  router.delete('/sources/:id/confirmation', (req: Request, res: Response) => {
    const source = repository.getSource(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    const saved = repository.saveSource(revokeSourceConfirmation(source));
    res.json({ source: saved, confirmationState: sourceConfirmationState(saved).state });
  });

  router.delete('/sources/:id', (req: Request, res: Response) => {
    const success = repository.deleteSource(req.params.id);
    res.json({ success });
  });

  router.post('/sources/extract-outcomes', async (req: Request, res: Response) => {
    try {
      // The source is loaded from the registry: outcomes are checked against
      // its stored text, never against text sent by the client.
      const { sourceId, grade } = req.body;
      const source = sourceId ? repository.getSource(String(sourceId)) : undefined;
      if (!source) return res.status(404).json({ error: 'Source not found' });
      const g = Number(grade);
      if (!source.grades.includes(g)) {
        return res.status(400).json({ error: `grade must be one of the source's grades (${source.grades.join(', ')})` });
      }
      const result = await extractOutcomes({
        provider: getProvider(),
        text: source.chunks.map((c) => c.text).join('\n\n'),
        subject: source.subject,
        grade: g,
        sourceId: source.id,
      });
      res.json({ outcomes: result.saved, ...result });
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  // --- Outcomes ---
  router.get('/outcomes', (req: Request, res: Response) => {
    const outcomes = repository.getOutcomes();
    res.json({ outcomes });
  });

  router.post('/outcomes/confirm', (req: Request, res: Response) => {
    const { code, subject, grade, confirmed } = req.body;
    if (!code || !subject || grade === undefined) {
      return res.status(400).json({ error: 'code, subject and grade are required' });
    }
    const ok = repository.confirmOutcome({ code, subject, grade: Number(grade) }, Boolean(confirmed));
    res.json({ success: ok });
  });

  router.delete('/outcomes/:code', (req: Request, res: Response) => {
    const { subject, grade } = req.query;
    if (!subject || grade === undefined) {
      return res.status(400).json({ error: 'subject and grade query parameters are required' });
    }
    const ok = repository.deleteOutcome({ code: req.params.code, subject: String(subject), grade: Number(grade) });
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
      sendError(res, err);
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
      sendError(res, err);
    }
  });

  router.delete('/assessments/:id', (req: Request, res: Response) => {
    const ok = repository.deleteAssessment(req.params.id);
    res.json({ success: ok });
  });

  // --- Validate Material ---
  // --- Material review: teacher DOCX -> checks -> accepted fixes -> DOCX ---
  // No defaults: subject, grade and sources are chosen explicitly; content
  // checks use only the selected confirmed sources. Decisions carry the
  // revision the teacher saw; conflicts are 409.
  const materialDeps = (body: { providerId?: unknown; judgeProviderId?: unknown } = {}) => ({
    provider: getProvider(typeof body.providerId === 'string' ? body.providerId : getDefaultProviderId()),
    judge: getJudgeProvider(typeof body.judgeProviderId === 'string' ? body.judgeProviderId : 'gemini'),
  });

  const materialView = async (review: MaterialReview) => {
    const w = await loadWorkingCopy(review);
    const paragraphs = currentParagraphs(w);
    return {
      review,
      paragraphs,
      // Items and key spans at the current revision (stored spans are in segmentation coordinates).
      structure: resolveStructure(review),
      unassignedParagraphIds: unassignedParagraphs(review, paragraphs),
      status: reviewStatus(review),
    };
  };

  const send = (res: Response, p: Promise<unknown>) =>
    p.then((body) => res.json(body)).catch((err: unknown) => sendError(res, err));

  router.get('/runtime', (_req: Request, res: Response) => {
    res.json({ fixtureMode: isFixtureMode(), modelProvider: getDefaultProviderId() });
  });

  router.get('/materials', (_req: Request, res: Response) => {
    const list = repository.getMaterialReviews().map((r) => ({
      id: r.id,
      fileName: r.fileName,
      subject: r.subject,
      grade: r.grade,
      uploadedAt: r.uploadedAt,
      revision: r.revision,
      questions: r.segmentation?.items.length ?? null,
      acceptedChanges: r.acceptedGroups.length,
      status: reviewStatus(r),
    }));
    res.json({ materials: list });
  });

  router.post('/materials', upload.single('file'), (req: Request, res: Response) => {
    if (!req.file) return sendError(res, new UserInputError('Ֆայլը բացակայում է:'));
    // Multer decodes the filename as latin1; browsers send UTF-8.
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    send(
      res,
      createReview({
        fileName,
        subject: req.body.subject,
        grade: req.body.grade,
        bytes: new Uint8Array(req.file.buffer),
        declaredNoStudentData: req.body.declaredNoStudentData,
      }).then(materialView)
    );
  });

  router.get('/materials/:id', (req: Request, res: Response) => {
    send(res, Promise.resolve().then(() => materialView(getReview(req.params.id))));
  });

  router.put('/materials/:id/sources', (req: Request, res: Response) => {
    send(res, selectSources(req.params.id, req.body.programSourceIds, req.body.factSourceIds).then(materialView));
  });

  router.post('/materials/:id/segment', (req: Request, res: Response) => {
    send(res, Promise.resolve().then(() => segment(req.params.id, materialDeps(req.body))).then(materialView));
  });

  router.put('/materials/:id/segmentation', (req: Request, res: Response) => {
    send(
      res,
      editSegmentation(req.params.id, {
        expectedRevision: req.body.expectedRevision,
        items: req.body.items,
        answerKeyParagraphIds: req.body.answerKeyParagraphIds,
      }).then(materialView)
    );
  });

  router.post('/materials/:id/segmentation/confirm', (req: Request, res: Response) => {
    send(res, confirmSegmentation(req.params.id, req.body.expectedRevision).then(materialView));
  });

  router.put('/materials/:id/items/:itemId/key', (req: Request, res: Response) => {
    send(res, setTeacherKey(req.params.id, req.params.itemId, req.body.optionLabels).then(materialView));
  });

  router.post('/materials/:id/check', (req: Request, res: Response) => {
    send(
      res,
      Promise.resolve()
        .then(() => runChecks(req.params.id, materialDeps(req.body), { all: req.body.all === true, retryFailed: req.body.retryFailed === true }))
        .then(materialView)
    );
  });

  router.post('/materials/:id/suggest', (req: Request, res: Response) => {
    send(
      res,
      Promise.resolve()
        .then(() => suggest(req.params.id, materialDeps(req.body)))
        .then(async ({ review, problems }) => ({ ...(await materialView(review)), suggestionProblems: problems }))
    );
  });

  router.post('/materials/:id/suggestions/:suggestionId/decision', (req: Request, res: Response) => {
    send(
      res,
      Promise.resolve()
        .then(() =>
          decide(
            req.params.id,
            req.params.suggestionId,
            { decision: req.body.decision, replacements: req.body.replacements, expectedRevision: req.body.expectedRevision },
            materialDeps(req.body)
          )
        )
        .then(materialView)
    );
  });

  router.post('/materials/:id/undo', (req: Request, res: Response) => {
    send(res, Promise.resolve().then(() => undoLast(req.params.id, req.body.expectedRevision, materialDeps(req.body))).then(materialView));
  });

  const attachment = (res: Response, fallback: string, name: string) =>
    res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`);

  // The corrected copy at the last persisted revision. Waits for an in-flight
  // decision so it never exports half of one. Drafts are labelled as such.
  router.get('/materials/:id/export.docx', (req: Request, res: Response) => {
    readConsistent(req.params.id, async (review) => ({ review, buf: await exportReviewDocx(review) }))
      .then(({ review, buf }) => {
        const status = reviewStatus(review);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        attachment(res, 'corrected.docx', correctedFileName(review));
        res.setHeader('X-TeachFlow-Status', status.final ? 'final' : 'draft');
        res.setHeader('X-TeachFlow-Revision', review.revision);
        res.setHeader('X-TeachFlow-Sha256', crypto.createHash('sha256').update(buf).digest('hex'));
        res.send(buf);
      })
      .catch((err: unknown) => sendError(res, err));
  });

  // The uploaded file, byte for byte. Never modified.
  router.get('/materials/:id/original.docx', (req: Request, res: Response) => {
    try {
      const review = getReview(req.params.id);
      const bytes = repository.getMaterialFile(review.fileSha256);
      if (!bytes) throw new Error('Original file is missing from storage');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      attachment(res, 'original.docx', review.fileName);
      res.setHeader('X-TeachFlow-Sha256', review.fileSha256);
      res.send(Buffer.from(bytes));
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  router.get('/materials/:id/changes.txt', (req: Request, res: Response) => {
    readConsistent(req.params.id, async (review) => ({ review, text: await buildChangeList(review) }))
      .then(({ review, text }) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        attachment(res, 'changes.txt', `${review.fileName.replace(/\.docx$/i, '')} — փոփոխություններ.txt`);
        res.send(text);
      })
      .catch((err: unknown) => sendError(res, err));
  });

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
      sendError(res, err);
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
      sendError(res, err);
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
      sendError(res, err);
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
    const { content = '', context } = req.body;
    const result = checkPrivacy(String(content), {
      context: context === 'student_code' ? 'student_code' : 'content',
    });
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

  // Workspace chat: structured intent parse (no keyword routing). The result
  // is only a proposal — the client shows it as confirmation chips (source
  // title + version) and the teacher must confirm before any of the actual
  // generation endpoints below are called.
  router.post('/workspace/parse-intent', async (req: Request, res: Response) => {
    try {
      const { message, subject, grade, providerId, modelId } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Missing message' });
      }
      if (!subject || grade === undefined) {
        return res.status(400).json({ error: 'Missing pinned subject/grade context' });
      }

      const provider = getProvider(providerId);
      const result = await parseWorkspaceIntent({
        message,
        pinnedSubject: subject,
        pinnedGrade: Number(grade),
        provider,
        modelId,
      });

      res.json(result);
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  router.post('/thematic-plans', async (req: Request, res: Response) => {
    try {
      // No defaults: a plan built on an assumed subject, grade, program
      // version, school or hour count would carry invented curriculum facts.
      const { subject, grade, programVersion, academicYear, schoolId, teacherName } = req.body;
      requireText({ subject, programVersion, academicYear, schoolId, teacherName });

      const gradeNum = parseGradeInput(grade);

      const school = repository.getSchools().find((s) => s.id === schoolId);
      if (!school) {
        throw new UserInputError(`Անհայտ դպրոց՝ «${schoolId}»:`);
      }

      const plan = await generateThematicPlan({
        subject,
        grade: gradeNum,
        programVersion,
        academicYear,
        schoolId,
        schoolName: school.name,
        teacherName,
        // Not coerced with Number(): generateThematicPlan rejects anything
        // that is not a positive integer, and Number('') === 0 / Number(null)
        // === 0 must not slip through as a value.
        weeklyHours: req.body.weeklyHours,
        totalAnnualHours: req.body.totalAnnualHours,
      });

      res.json({ plan });
    } catch (err: unknown) {
      sendError(res, err);
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
      sendError(res, err);
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

  // Must be registered before GET /answer-sheets/:id, or Express would match
  // "qr" as the :id param.
  router.get('/answer-sheets/qr', async (req: Request, res: Response) => {
    try {
      const { assessmentId, variant } = req.query;
      if (!assessmentId || (variant !== 'A' && variant !== 'B')) {
        return res.status(400).json({ error: 'Missing assessmentId or variant (A|B)' });
      }
      const dataUrl = await generateAnswerSheetQrDataUrl({
        assessmentId: String(assessmentId),
        variant: variant as 'A' | 'B',
      });
      res.json({ dataUrl });
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  router.get('/answer-sheets/:id', (req: Request, res: Response) => {
    const sheet = repository.getAnswerSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Answer sheet not found' });
    res.json({ answerSheet: sheet });
  });

  router.post('/answer-sheets/scan', (req: Request, res: Response) => {
    try {
      const { assessmentId, variant = 'A', studentCode, answers = [], imageUrl } = req.body;
      // Student code is required and must be anonymous; never invent one.
      const code = assertStudentCode(studentCode);

      const assessment = repository.getAssessment(assessmentId);
      if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

      const graded = gradeSubmissionDeterministically(assessment, {
        assessmentId,
        variant,
        studentCode: code,
        timestamp: new Date().toISOString(),
        status: 'scanned_pending_review',
        confidenceOverall: undefined,
        imageUrl,
        answers,
      });

      const saved = repository.saveAnswerSheet(graded);
      res.json({ answerSheet: saved });
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  // Real photo-based answer-sheet reading: server-side QR decode (assessment
  // id + variant) with Gemini vision for student code + marks/confidence.
  router.post('/answer-sheets/scan-image', upload.single('image'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Պատկեր չի ուղարկվել (multipart field name՝ "image")' });
      }

      const { assessmentId, variant, studentCode } = req.body;
      const result = await scanAnswerSheet({
        imageBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
        assessmentId,
        variant: variant === 'A' || variant === 'B' ? variant : undefined,
        studentCodeOverride: studentCode || undefined,
      });

      res.json({ answerSheet: result.submission, qrDecoded: result.qrDecoded, warnings: result.warnings });
    } catch (err: unknown) {
      sendError(res, err);
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
      sendError(res, err);
    }
  });

  router.post('/reports/consolidate', (req: Request, res: Response) => {
    try {
      const {
        templateId = 'tpl-method-unit',
        schoolId = 'sch-1',
        academicYear = '2026-2027',
        period = 'half_year',
        subjectGroup,
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
      sendError(res, err);
    }
  });

  router.post('/reports/legacy-import', async (req: Request, res: Response) => {
    try {
      // No defaults: the file name, the form, the school and the author are
      // facts about the imported document, not values the server may invent.
      const { rawText, fileName, templateId, schoolId, authorName } = req.body;
      requireText({ rawText, fileName, templateId, schoolId, authorName });

      const school = repository.getSchools().find((s) => s.id === schoolId);
      if (!school) {
        throw new UserInputError(`Անհայտ դպրոց՝ «${schoolId}»:`);
      }

      const report = await importLegacyReport({
        rawText,
        fileName,
        templateId,
        schoolId,
        schoolName: school.name,
        authorName,
      });

      res.json({ report });
    } catch (err: unknown) {
      sendError(res, err);
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
      sendError(res, err);
    }
  });

  // Per-task-type ("category") model recommendation, computed purely from
  // stored eval run history — never invented, absent for a category with no
  // runs yet.
  router.get('/armenian-eval/recommendations', (_req: Request, res: Response) => {
    const recommendations = computeCategoryModelRecommendations(repository.getArmenianEvalResults());
    res.json({ recommendations });
  });

  router.get('/armenian-eval/preferences', (_req: Request, res: Response) => {
    res.json({ preferences: repository.getEvalModelPreferences() });
  });

  router.post('/armenian-eval/preferences', (req: Request, res: Response) => {
    const { category, providerId, modelId } = req.body;
    if (!category || !providerId || !modelId) {
      return res.status(400).json({ error: 'Missing category, providerId, or modelId' });
    }
    repository.setEvalModelPreference(category, `${providerId}/${modelId}`);
    res.json({ preferences: repository.getEvalModelPreferences() });
  });

  return router;
}
