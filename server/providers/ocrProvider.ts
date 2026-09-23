import { GoogleGenAI } from '@google/genai';
import { repository } from '../store/repository.js';

// Same model already used as the default Gemini text model elsewhere in this
// codebase (server/providers/modelProvider.ts) — it is multimodal and can
// read PDF bytes directly, including scanned/image-only pages.
export const OCR_MODEL_ID = 'gemini-3.8-flash';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OCR Provider Error: GEMINI_API_KEY is not set. Scanned-page OCR requires a direct Gemini API key.'
    );
  }
  return new GoogleGenAI({ apiKey });
}

// Sends the whole PDF plus a target page number and asks Gemini to OCR just
// that page. Throws on failure — never returns fabricated text.
export async function ocrPdfPage(pdfBytes: Buffer, pageNumber: number): Promise<string> {
  const ai = getClient();
  const start = Date.now();

  try {
    const response = await ai.models.generateContent({
      model: OCR_MODEL_ID,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: pdfBytes.toString('base64') } },
            {
              text: `This PDF's page ${pageNumber} has no extractable text layer (it is a scan/image). Perform OCR on page ${pageNumber} ONLY and output its text verbatim, preserving paragraph breaks. Output ONLY the extracted text — no commentary, no markdown, no page-number labels.`,
            },
          ],
        },
      ],
      config: { temperature: 0.0 },
    });

    const text = (response.text || '').trim();
    if (!text) {
      throw new Error(`OCR returned empty text for page ${pageNumber}`);
    }

    repository.logAIInteraction({
      providerId: 'gemini',
      modelId: OCR_MODEL_ID,
      action: 'ocrPdfPage',
      prompt: `page ${pageNumber}`,
      output: text,
      latencyMs: Date.now() - start,
    });

    return text;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    repository.logAIInteraction({
      providerId: 'gemini',
      modelId: OCR_MODEL_ID,
      action: 'ocrPdfPage:FAILED',
      prompt: `page ${pageNumber}`,
      output: `Error: ${msg}`,
      latencyMs: Date.now() - start,
    });
    throw err;
  }
}
