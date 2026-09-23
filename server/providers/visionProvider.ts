import { GoogleGenAI } from '@google/genai';
import { AnswerSheetVisionOutput, AnswerSheetVisionSchema } from '../../shared/schemas.js';
import { repository } from '../store/repository.js';

// Same default Gemini model used elsewhere in this codebase (multimodal).
export const VISION_MODEL_ID = 'gemini-3.8-flash';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Vision Provider Error: GEMINI_API_KEY is not set. Answer-sheet reading requires a direct Gemini API key.'
    );
  }
  return new GoogleGenAI({ apiKey });
}

export interface ReadAnswerSheetParams {
  imageBuffer: Buffer;
  mimeType: string;
  itemCount: number;
  itemTypes: string[]; // e.g. ["single_choice", "single_choice", "short_answer"], 1 per item in order
}

// Reads a scanned/photographed answer sheet via Gemini vision. Never
// fabricates: throws on failure/empty response rather than returning
// invented marks, and every returned answer carries its own confidence so
// low-confidence fields can be flagged for manual review instead of trusted
// silently.
export async function readAnswerSheet(params: ReadAnswerSheetParams): Promise<AnswerSheetVisionOutput> {
  const ai = getClient();
  const start = Date.now();

  const prompt = `You are reading a scanned/photographed student answer sheet for an anonymous-code educational assessment.

The sheet has ${params.itemCount} items, in order, of these types: ${params.itemTypes.join(', ')}.
For single/multiple_choice items, "mark" is the selected option letter (Ա, Բ, Գ, Դ or A, B, C, D — read exactly what is marked). For short_answer/open items, "mark" is the handwritten text, transcribed as legibly as possible.

Rules:
1. NEVER invent a mark you cannot actually see. If an item is blank or illegible, set mark to "" and confidence low (below 0.4).
2. "confidence" must genuinely reflect how certain you are of THAT SPECIFIC reading — do not default it to a fixed value.
3. "studentCode" is the short anonymous code (e.g. "7B-14") handwritten in the code box — never a real name. Omit if illegible.
4. If the photo is blurry, dark, cropped, or otherwise degrades your ability to read parts of it, say so in "unreadableNote".

Output ONLY structured JSON matching the schema: { studentCode?, answers: [{ itemIndex, mark, confidence }], unreadableNote? }`;

  try {
    const response = await ai.models.generateContent({
      model: VISION_MODEL_ID,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: params.mimeType, data: params.imageBuffer.toString('base64') } },
            { text: prompt },
          ],
        },
      ],
      config: {
        temperature: 0.0,
        responseMimeType: 'application/json',
      },
    });

    const rawText = (response.text || '').trim();
    if (!rawText) {
      throw new Error('Empty response received from Gemini vision model');
    }

    let cleaned = rawText;
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    }

    const parsed = AnswerSheetVisionSchema.parse(JSON.parse(cleaned));

    repository.logAIInteraction({
      providerId: 'gemini',
      modelId: VISION_MODEL_ID,
      action: 'readAnswerSheet',
      prompt: `${params.itemCount} items`,
      output: rawText,
      latencyMs: Date.now() - start,
    });

    return parsed;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    repository.logAIInteraction({
      providerId: 'gemini',
      modelId: VISION_MODEL_ID,
      action: 'readAnswerSheet:FAILED',
      prompt: `${params.itemCount} items`,
      output: `Error: ${msg}`,
      latencyMs: Date.now() - start,
    });
    throw err;
  }
}
