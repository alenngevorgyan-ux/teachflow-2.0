import { AnswerSheetSubmission } from '../../shared/types.js';
import { repository } from '../store/repository.js';
import { checkPrivacy } from './privacyGuard.js';
import { gradeSubmissionDeterministically } from './autoGrader.js';
import { decodeAnswerSheetQr } from './answerSheetQr.js';
import { readAnswerSheet } from '../providers/visionProvider.js';

export interface ScanAnswerSheetParams {
  imageBuffer: Buffer;
  mimeType: string;
  // Teacher-selected fallback context, used only when the QR can't be
  // decoded (see decodeAnswerSheetQr's "if feasible" contract).
  assessmentId?: string;
  variant?: 'A' | 'B';
  // Manual override in case the handwritten code is illegible even to the
  // teacher's own eyes — never required.
  studentCodeOverride?: string;
}

export interface ScanAnswerSheetResult {
  submission: AnswerSheetSubmission;
  qrDecoded: boolean;
  warnings: string[];
}

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export async function scanAnswerSheet(params: ScanAnswerSheetParams): Promise<ScanAnswerSheetResult> {
  const warnings: string[] = [];

  const qr = decodeAnswerSheetQr(params.imageBuffer, params.mimeType);
  const assessmentId = qr?.assessmentId || params.assessmentId;
  const variant = qr?.variant || params.variant;

  if (!assessmentId) {
    throw new Error(
      'QR-կոդը ընթերցվել չհաջողվեց և թեստ ընտրված չէ: Խնդրում ենք ընտրել թեստը ձեռքով:'
    );
  }
  if (!variant) {
    throw new Error('Տարբերակը (A/B) հայտնի չէ: QR-ը չընթերցվեց, խնդրում ենք ընտրել ձեռքով:');
  }
  if (!qr) {
    warnings.push(
      'QR-կոդը թերթիկի վրա չընթերցվեց (կամ բացակայում է): Օգտագործվել են ձեռքով ընտրված թեստը/տարբերակը:'
    );
  }

  const assessment = repository.getAssessment(assessmentId);
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  const variantItems = assessment.items.filter((it) => it.variant === variant);
  if (variantItems.length === 0) {
    throw new Error(`«${variant}» տարբերակի համար առաջադրանքներ չկան այս թեստում:`);
  }

  // Never fabricate: a failed vision call means we have no real answers to
  // record — surface it as a visible error, do not save a fake submission.
  const vision = await readAnswerSheet({
    imageBuffer: params.imageBuffer,
    mimeType: params.mimeType,
    itemCount: variantItems.length,
    itemTypes: variantItems.map((it) => it.type),
  });

  if (vision.unreadableNote) warnings.push(vision.unreadableNote);

  const studentCode = params.studentCodeOverride || vision.studentCode;
  if (!studentCode) {
    throw new Error(
      'Աշակերտի կոդը ընթերցվել չհաջողվեց լուսանկարից: Խնդրում ենք մուտքագրել ձեռքով:'
    );
  }

  const priv = checkPrivacy(studentCode);
  if (priv.blocked) {
    throw new Error(priv.warnings[0]);
  }

  const answers = vision.answers.map((a) => {
    const item = variantItems[a.itemIndex - 1];
    return {
      itemIndex: a.itemIndex,
      itemId: item?.id || '',
      studentAnswer: a.mark,
      confidence: a.confidence,
      isLowConfidence: a.confidence < LOW_CONFIDENCE_THRESHOLD,
    };
  });

  const confidenceOverall =
    answers.length > 0 ? answers.reduce((sum, a) => sum + (a.confidence ?? 0), 0) / answers.length : undefined;

  const graded = gradeSubmissionDeterministically(assessment, {
    assessmentId,
    variant,
    studentCode,
    timestamp: new Date().toISOString(),
    // Transient — deleted by repository.confirmAnswerSheet() once the
    // teacher confirms this submission (privacy rule: zero image retention).
    imageUrl: `data:${params.mimeType};base64,${params.imageBuffer.toString('base64')}`,
    status: 'scanned_pending_review',
    confidenceOverall,
    answers,
  });

  const saved = repository.saveAnswerSheet(graded);
  return { submission: saved, qrDecoded: Boolean(qr), warnings };
}
