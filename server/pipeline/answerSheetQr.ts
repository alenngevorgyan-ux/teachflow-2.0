import QRCode from 'qrcode';
import jsQR from 'jsqr';
import jpegDecode from 'jpeg-js';
import { PNG } from 'pngjs';

// Compact, versioned payload format encoded into the printed answer sheet's
// QR code: "TFv1|<assessmentId>|<variant>". Kept deliberately simple (no
// JSON) so it's small enough to print reliably at a small QR module size.
const QR_PREFIX = 'TFv1';

export interface AnswerSheetQrPayload {
  assessmentId: string;
  variant: 'A' | 'B';
}

export async function generateAnswerSheetQrDataUrl(payload: AnswerSheetQrPayload): Promise<string> {
  const encoded = `${QR_PREFIX}|${payload.assessmentId}|${payload.variant}`;
  return QRCode.toDataURL(encoded, { margin: 1, width: 160 });
}

function decodePayload(text: string): AnswerSheetQrPayload | null {
  const parts = text.split('|');
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) return null;
  const [, assessmentId, variant] = parts;
  if (variant !== 'A' && variant !== 'B') return null;
  if (!assessmentId) return null;
  return { assessmentId, variant };
}

interface DecodedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function decodeImageToPixels(buffer: Buffer, mimeType: string): DecodedImage | null {
  try {
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      const raw = jpegDecode.decode(buffer, { useTArray: true });
      return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
    }
    if (mimeType === 'image/png') {
      const png = PNG.sync.read(buffer);
      return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
    }
    return null;
  } catch {
    return null;
  }
}

// Server-side QR decode of an uploaded answer-sheet photo. Returns null when
// no QR is found or the image format isn't supported (jsQR/jpeg-js/pngjs are
// pure JS, no native deps) — callers fall back to Gemini-vision-read fields
// or teacher-entered ones; QR is a reliability improvement, not a hard
// requirement, matching TASKS.md's "if feasible".
export function decodeAnswerSheetQr(buffer: Buffer, mimeType: string): AnswerSheetQrPayload | null {
  const img = decodeImageToPixels(buffer, mimeType);
  if (!img) return null;

  const result = jsQR(img.data, img.width, img.height);
  if (!result) return null;

  return decodePayload(result.data);
}
