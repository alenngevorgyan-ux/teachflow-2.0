import { describe, expect, it } from 'vitest';
import { decodeAnswerSheetQr, generateAnswerSheetQrDataUrl } from '../server/pipeline/answerSheetQr.js';

describe('answer sheet QR: generate + decode round trip', () => {
  it('decodes exactly what was encoded (PNG)', async () => {
    const dataUrl = await generateAnswerSheetQrDataUrl({ assessmentId: 'asm-abc-123', variant: 'B' });
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    const decoded = decodeAnswerSheetQr(buffer, 'image/png');

    expect(decoded).toEqual({ assessmentId: 'asm-abc-123', variant: 'B' });
  });

  it('round-trips a different assessmentId/variant', async () => {
    const dataUrl = await generateAnswerSheetQrDataUrl({ assessmentId: 'asm-xyz-999', variant: 'A' });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    const decoded = decodeAnswerSheetQr(buffer, 'image/png');
    expect(decoded).toEqual({ assessmentId: 'asm-xyz-999', variant: 'A' });
  });
});

describe('decodeAnswerSheetQr: no fabrication on unreadable input', () => {
  it('returns null for a non-image buffer instead of throwing or guessing', () => {
    const decoded = decodeAnswerSheetQr(Buffer.from('not an image at all'), 'image/jpeg');
    expect(decoded).toBeNull();
  });

  it('returns null for an unsupported mime type', async () => {
    const dataUrl = await generateAnswerSheetQrDataUrl({ assessmentId: 'x', variant: 'A' });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    const decoded = decodeAnswerSheetQr(buffer, 'image/webp');
    expect(decoded).toBeNull();
  });

  it('returns null for a well-formed QR that does not match the TFv1 payload format', async () => {
    const QRCode = (await import('qrcode')).default;
    const dataUrl = await QRCode.toDataURL('some unrelated QR content', { margin: 1, width: 160 });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    const decoded = decodeAnswerSheetQr(buffer, 'image/png');
    expect(decoded).toBeNull();
  });
});
