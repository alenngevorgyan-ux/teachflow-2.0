import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assessment, AnswerSheetSubmission } from '../shared/types.js';

const store = vi.hoisted(() => ({
  assessment: null as Assessment | null,
  saved: [] as AnswerSheetSubmission[],
  qrResult: null as { assessmentId: string; variant: 'A' | 'B' } | null,
  visionResult: null as any,
  visionError: null as Error | null,
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getAssessment: (id: string) => (store.assessment && store.assessment.id === id ? store.assessment : null),
    saveAnswerSheet: (s: AnswerSheetSubmission) => {
      store.saved.push(s);
      return s;
    },
  },
}));

vi.mock('../server/pipeline/answerSheetQr.js', () => ({
  decodeAnswerSheetQr: () => store.qrResult,
}));

vi.mock('../server/providers/visionProvider.js', () => ({
  readAnswerSheet: async () => {
    if (store.visionError) throw store.visionError;
    return store.visionResult;
  },
}));

import { scanAnswerSheet } from '../server/pipeline/answerSheetScanner.js';

function assessment(): Assessment {
  return {
    id: 'asm-1',
    subject: 'history',
    grade: 7,
    topic: 'x',
    selectedSourceIds: [],
    status: 'validated',
    coverage: { topicCovered: true, coveredOutcomeCodes: [], missingAspects: [] },
    items: [
      { id: 'item-A-1', variant: 'A', type: 'single_choice', stem: 's1', options: ['Ա', 'Բ'], answerKey: 'Ա', outcomeCodes: [], difficulty: 'basic', citations: [] },
      { id: 'item-A-2', variant: 'A', type: 'single_choice', stem: 's2', options: ['Ա', 'Բ'], answerKey: 'Բ', outcomeCodes: [], difficulty: 'basic', citations: [] },
    ],
    traces: [],
    variantEquivalence: [],
    createdAt: '',
    policyVersion: 'p',
  };
}

const IMG = Buffer.from('fake-image-bytes');

beforeEach(() => {
  store.assessment = assessment();
  store.saved = [];
  store.qrResult = { assessmentId: 'asm-1', variant: 'A' };
  store.visionResult = {
    studentCode: '7B-14',
    answers: [
      { itemIndex: 1, mark: 'Ա', confidence: 0.95 },
      { itemIndex: 2, mark: 'Բ', confidence: 0.4 },
    ],
  };
  store.visionError = null;
});

describe('scanAnswerSheet: QR resolution', () => {
  it('uses the QR-decoded assessmentId/variant over the teacher-selected fallback', async () => {
    store.qrResult = { assessmentId: 'asm-1', variant: 'A' };
    const result = await scanAnswerSheet({
      imageBuffer: IMG,
      mimeType: 'image/jpeg',
      assessmentId: 'wrong-id',
      variant: 'B',
    });
    expect(result.qrDecoded).toBe(true);
    expect(result.submission.assessmentId).toBe('asm-1');
    expect(result.submission.variant).toBe('A');
  });

  it('falls back to the teacher-selected assessment/variant when the QR is not found, with a visible warning', async () => {
    store.qrResult = null;
    const result = await scanAnswerSheet({
      imageBuffer: IMG,
      mimeType: 'image/jpeg',
      assessmentId: 'asm-1',
      variant: 'A',
    });
    expect(result.qrDecoded).toBe(false);
    expect(result.warnings.some((w) => w.includes('QR'))).toBe(true);
  });

  it('throws when the QR is missing and no assessment was selected either', async () => {
    store.qrResult = null;
    await expect(
      scanAnswerSheet({ imageBuffer: IMG, mimeType: 'image/jpeg' })
    ).rejects.toThrow(/QR/);
  });
});

describe('scanAnswerSheet: vision failure is never silently swallowed', () => {
  it('throws when the vision call fails, and saves nothing', async () => {
    store.visionError = new Error('Gemini vision unavailable');
    await expect(
      scanAnswerSheet({ imageBuffer: IMG, mimeType: 'image/jpeg' })
    ).rejects.toThrow(/Gemini vision unavailable/);
    expect(store.saved).toHaveLength(0);
  });

  it('throws when neither vision nor a manual override provides a student code', async () => {
    store.visionResult = { studentCode: undefined, answers: [{ itemIndex: 1, mark: 'Ա', confidence: 0.9 }] };
    await expect(scanAnswerSheet({ imageBuffer: IMG, mimeType: 'image/jpeg' })).rejects.toThrow(/կոդը/);
  });

  it('accepts a manual studentCodeOverride when vision could not read it', async () => {
    store.visionResult = { studentCode: undefined, answers: [{ itemIndex: 1, mark: 'Ա', confidence: 0.9 }] };
    const result = await scanAnswerSheet({
      imageBuffer: IMG,
      mimeType: 'image/jpeg',
      studentCodeOverride: '7B-99',
    });
    expect(result.submission.studentCode).toBe('7B-99');
  });
});

describe('scanAnswerSheet: low-confidence flagging', () => {
  it('marks answers below the threshold as isLowConfidence, and high-confidence ones as not', async () => {
    const result = await scanAnswerSheet({ imageBuffer: IMG, mimeType: 'image/jpeg' });
    const a1 = result.submission.answers.find((a) => a.itemIndex === 1)!;
    const a2 = result.submission.answers.find((a) => a.itemIndex === 2)!;
    expect(a1.isLowConfidence).toBe(false); // 0.95
    expect(a2.isLowConfidence).toBe(true); // 0.4
  });
});

describe('scanAnswerSheet: image retention', () => {
  it('stores the image transiently on the submission (deleted later on confirm, not here)', async () => {
    const result = await scanAnswerSheet({ imageBuffer: IMG, mimeType: 'image/jpeg' });
    expect(result.submission.imageUrl).toContain('data:image/jpeg;base64,');
    expect(result.submission.status).toBe('scanned_pending_review');
  });
});

describe('scanAnswerSheet: privacy guard', () => {
  it('rejects a student code that looks like a real name', async () => {
    store.visionResult = {
      studentCode: 'Տիգրան Սարգսյան',
      answers: [{ itemIndex: 1, mark: 'Ա', confidence: 0.9 }],
    };
    await expect(scanAnswerSheet({ imageBuffer: IMG, mimeType: 'image/jpeg' })).rejects.toThrow();
    expect(store.saved).toHaveLength(0);
  });
});
