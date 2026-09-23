import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logSpy = vi.hoisted(() => vi.fn());

vi.mock('../server/store/repository.js', () => ({
  repository: { logAIInteraction: logSpy },
}));

import { ocrPdfPage } from '../server/providers/ocrProvider.js';

describe('ocrPdfPage: no GEMINI_API_KEY configured', () => {
  const original = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    logSpy.mockClear();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = original;
  });

  it('throws a clear error instead of returning fabricated text', async () => {
    await expect(ocrPdfPage(Buffer.from('fake pdf bytes'), 3)).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
