import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { repository } from '../store/repository.js';

export interface ClaimVerificationResult {
  verdict: 'supported' | 'partially_supported' | 'not_supported';
  probability: number;
  confidence: number;
  reason: string;
}

export interface ClassificationResult {
  label: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface IJudgeProvider {
  providerId: string;
  modelId: string;
  verifyClaim(
    claim: string,
    evidenceText: string,
    context?: { stem?: string; options?: string[]; answerKey?: string }
  ): Promise<ClaimVerificationResult>;

  classify(text: string, labels: string[]): Promise<ClassificationResult>;
}

// Zod schema for structured Gemini judge claim verification
const GeminiJudgeVerifySchema = z.object({
  verdict: z.enum(['supported', 'partially_supported', 'not_supported']),
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

// Zod schema for Gemini classification
const GeminiJudgeClassifySchema = z.object({
  label: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
});

/**
 * Implementation 1: Gemini Judge Provider (Default)
 * Temperature 0, structured output.
 */
export class GeminiJudgeProvider implements IJudgeProvider {
  public providerId = 'gemini';
  public modelId = 'gemini-3.8-flash';

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Gemini Judge Provider Error: GEMINI_API_KEY is not set in environment.'
      );
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  async verifyClaim(
    claim: string,
    evidenceText: string,
    context?: { stem?: string; options?: string[]; answerKey?: string }
  ): Promise<ClaimVerificationResult> {
    const start = Date.now();
    const ai = this.getClient();

    const prompt = `You are a strict curriculum and factual verification judge.
Compare the educational claim/question against the provided verified evidence chunk text.

EVIDENCE CHUNK TEXT:
"""
${evidenceText}
"""

CLAIM / QUESTION BEING VERIFIED:
"""
${claim}
"""
${context?.stem ? `Stem: "${context.stem}"\n` : ''}${context?.answerKey ? `Answer key: "${context.answerKey}"\n` : ''}

Output strictly valid JSON with:
- "verdict": "supported" (if 100% corroborated by the evidence), "partially_supported" (if partially corroborated or missing nuance), or "not_supported" (if contradicted, unmentioned, or factually unsupported).
- "probability": float between 0.0 and 1.0 representing probability of full truth under evidence.
- "confidence": float between 0.0 and 1.0 representing your confidence in this judgment (0.9-1.0 if clear, <0.8 if ambiguous or text quality is poor).
- "reason": concise explanation in Armenian.`;

    try {
      const response = await ai.models.generateContent({
        model: this.modelId,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a rigorous factual verification judge. Respond strictly in valid JSON matching schema.',
          temperature: 0.0,
          responseMimeType: 'application/json',
        },
      });

      const raw = response.text || '{}';
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
      }

      const parsed = JSON.parse(cleaned);
      const validated = GeminiJudgeVerifySchema.parse(parsed);

      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: this.modelId,
        action: 'judge:verifyClaim',
        prompt,
        output: raw,
        latencyMs: Date.now() - start,
      });

      return validated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: this.modelId,
        action: 'judge:verifyClaim:FAILED',
        prompt,
        output: `Error: ${msg}`,
        latencyMs: Date.now() - start,
      });
      throw new Error(`Gemini Judge Provider error: ${msg}`);
    }
  }

  async classify(text: string, labels: string[]): Promise<ClassificationResult> {
    const start = Date.now();
    const ai = this.getClient();

    const prompt = `Classify the following text into exactly one of these labels: ${labels.join(', ')}.

TEXT:
"""
${text}
"""

Output strictly JSON with:
- "label": the selected label from the allowed list
- "probabilities": dictionary of label -> float probability
- "confidence": float between 0.0 and 1.0`;

    try {
      const response = await ai.models.generateContent({
        model: this.modelId,
        contents: prompt,
        config: {
          temperature: 0.0,
          responseMimeType: 'application/json',
        },
      });

      const raw = response.text || '{}';
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      }
      const parsed = JSON.parse(cleaned);
      const validated = GeminiJudgeClassifySchema.parse(parsed);

      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: this.modelId,
        action: 'judge:classify',
        prompt,
        output: raw,
        latencyMs: Date.now() - start,
      });

      return validated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini Judge classify error: ${msg}`);
    }
  }
}

/**
 * Implementation 2: TypeSafe Jev Judge Provider (Optional)
 * Enabled ONLY if TYPESAFE_API_KEY is set in environment.
 * If missing or a call fails: throws a visible error — never silently switches judge!
 */
export class TypeSafeJevJudgeProvider implements IJudgeProvider {
  public providerId = 'typesafe_jev';
  public modelId = process.env.TYPESAFE_MODEL_ID || 'jev-standard';

  private getApiKey(): string {
    const key = process.env.TYPESAFE_API_KEY;
    if (!key) {
      throw new Error(
        'TypeSafe Jev Judge Error: TYPESAFE_API_KEY is not set in environment. Visible judge error: Cannot use TypeSafe Jev without a valid API key. (Never silently switching judge).'
      );
    }
    return key;
  }

  async verifyClaim(
    claim: string,
    evidenceText: string,
    context?: { stem?: string; options?: string[]; answerKey?: string }
  ): Promise<ClaimVerificationResult> {
    const apiKey = this.getApiKey();
    const apiUrl = process.env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/verify';
    const start = Date.now();

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelId,
          claim,
          evidence: evidenceText,
          context,
          temperature: 0,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `TypeSafe Jev API error (${res.status}): ${errorText || res.statusText}`
        );
      }

      const data = await res.json();
      const verdict = data.verdict || (data.supported ? 'supported' : 'not_supported');
      const confidence = typeof data.confidence === 'number' ? data.confidence : 0.85;
      const probability = typeof data.probability === 'number' ? data.probability : 0.9;
      const reason = data.reason || 'TypeSafe Jev verification completed.';

      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: this.modelId,
        action: 'judge:typesafe_jev:verifyClaim',
        prompt: `Claim: ${claim}`,
        output: JSON.stringify(data),
        latencyMs: Date.now() - start,
      });

      return {
        verdict,
        probability,
        confidence,
        reason,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: this.modelId,
        action: 'judge:typesafe_jev:FAILED',
        prompt: `Claim: ${claim}`,
        output: `Error: ${msg}`,
        latencyMs: Date.now() - start,
      });
      // Spec: Never silently switch judge!
      throw new Error(`TypeSafe Jev Judge Call Failed: ${msg}`);
    }
  }

  async classify(text: string, labels: string[]): Promise<ClassificationResult> {
    const apiKey = this.getApiKey();
    const apiUrl = process.env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/classify';

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelId,
          text,
          labels,
        }),
      });

      if (!res.ok) {
        throw new Error(`TypeSafe Jev Classify API error (${res.status})`);
      }

      const data = await res.json();
      return {
        label: data.label,
        probabilities: data.probabilities || {},
        confidence: data.confidence ?? 0.85,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`TypeSafe Jev Judge Classify Failed: ${msg}`);
    }
  }
}

/**
 * Factory for Judge Provider
 */
export function getJudgeProvider(providerId = 'gemini'): IJudgeProvider {
  if (providerId === 'typesafe_jev') {
    return new TypeSafeJevJudgeProvider();
  }
  if (providerId === 'gemini') {
    return new GeminiJudgeProvider();
  }
  throw new Error(`Unsupported judge provider requested: "${providerId}"`);
}

export function isTypeSafeJevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY && process.env.TYPESAFE_API_KEY.trim());
}
