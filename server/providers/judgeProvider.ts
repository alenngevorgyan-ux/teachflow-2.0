import { GoogleGenAI } from '@google/genai';
import { OpenRouter } from '@openrouter/sdk';
import { z } from 'zod';
import { repository } from '../store/repository.js';
import { IModelProvider, getDefaultProviderId, getProvider } from './modelProvider.js';

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

function buildVerifyClaimPrompt(
  claim: string,
  evidenceText: string,
  context?: { stem?: string; options?: string[]; answerKey?: string }
): string {
  return `You are a strict curriculum and factual verification judge.
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
}

function buildClassifyPrompt(text: string, labels: string[]): string {
  return `Classify the following text into exactly one of these labels: ${labels.join(', ')}.

TEXT:
"""
${text}
"""

Output strictly JSON with:
- "label": the selected label from the allowed list
- "probabilities": dictionary of label -> float probability
- "confidence": float between 0.0 and 1.0`;
}

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

    const prompt = buildVerifyClaimPrompt(claim, evidenceText, context);

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

    const prompt = buildClassifyPrompt(text, labels);

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
 * Implementation 2: TypeSafe Jev judge via OpenRouter Decisions API
 * (POST /api/alpha/decisions, model ~typesafe/jev-latest by default).
 * Key: OPENROUTER_JEV_API_KEY only (a separate OpenRouter key with its own limit).
 * Jev answers typed questions with probabilities; it gives no free-text
 * reasoning, so `reason` only restates the returned distribution.
 * Missing key, missing probabilities or a failed call throw a visible error —
 * never a default value, never a silent switch to another judge.
 */
export const JEV_DEFAULT_MODEL_ID = '~typesafe/jev-latest';

type DecisionAnswer = {
  type: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  noul?: number;
};

export function getJevApiKey(): string | undefined {
  return process.env.OPENROUTER_JEV_API_KEY?.trim() || undefined;
}

export class TypeSafeJevJudgeProvider implements IJudgeProvider {
  public providerId = 'typesafe_jev';
  public modelId = process.env.JEV_MODEL_ID?.trim() || JEV_DEFAULT_MODEL_ID;

  private client(): OpenRouter {
    const apiKey = getJevApiKey();
    if (!apiKey) {
      throw new Error(
        'TypeSafe Jev Judge Error: OPENROUTER_JEV_API_KEY is not set. Never silently switching judge.'
      );
    }
    return new OpenRouter({ apiKey });
  }

  private async decide(
    action: string,
    state: string | Record<string, unknown>,
    questions: Record<string, unknown>
  ): Promise<Record<string, DecisionAnswer>> {
    const start = Date.now();
    const client = this.client();
    try {
      const res = await client.alpha.decisions.create({
        decisionsRequest: {
          model: this.modelId,
          state,
          questions: questions as never,
        },
      });
      this.modelId = res.model || this.modelId;
      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: this.modelId,
        action: `judge:typesafe_jev:${action}`,
        prompt: JSON.stringify({ state, questions }),
        output: JSON.stringify(res),
        latencyMs: Date.now() - start,
      });
      return res.answers as Record<string, DecisionAnswer>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: this.modelId,
        action: `judge:typesafe_jev:${action}:FAILED`,
        prompt: JSON.stringify({ state, questions }),
        output: `Error: ${msg}`,
        latencyMs: Date.now() - start,
      });
      throw new Error(`TypeSafe Jev Judge Call Failed: ${msg}`);
    }
  }

  async verifyClaim(
    claim: string,
    evidenceText: string,
    context?: { stem?: string; options?: string[]; answerKey?: string }
  ): Promise<ClaimVerificationResult> {
    const answers = await this.decide(
      'verifyClaim',
      {
        evidence: evidenceText,
        claim,
        ...(context?.stem ? { stem: context.stem } : {}),
        ...(context?.answerKey ? { answerKey: context.answerKey } : {}),
      },
      {
        verdict: {
          type: 'choice',
          instructions: 'Is the claim (question with its answer key) supported by the evidence text only?',
          criteria: {
            supported: 'Fully corroborated by the evidence text',
            partially_supported: 'Partly corroborated, or missing a nuance the evidence states',
            not_supported: 'Contradicted by, or not mentioned in, the evidence text',
          },
        },
        fully_supported: {
          type: 'noul',
          instructions: 'Is every fact in the claim stated in the evidence text?',
          criteria: { true: 'Every fact is in the evidence', false: 'At least one fact is missing or contradicted' },
        },
      }
    );

    const v = answers.verdict;
    const full = answers.fully_supported;
    const verdicts = ['supported', 'partially_supported', 'not_supported'] as const;
    if (v?.type !== 'choice' || !verdicts.includes(v.choice as (typeof verdicts)[number])) {
      throw new Error(`TypeSafe Jev Judge: unexpected verdict answer ${JSON.stringify(v)}`);
    }
    if (full?.type !== 'noul' || typeof full.noul !== 'number') {
      throw new Error(`TypeSafe Jev Judge: missing fully_supported probability ${JSON.stringify(full)}`);
    }
    const confidence = v.confidence ?? v.probabilities?.[v.choice as string];
    if (typeof confidence !== 'number') {
      throw new Error('TypeSafe Jev Judge: no confidence returned for the verdict');
    }
    const verdict = v.choice as ClaimVerificationResult['verdict'];
    return {
      verdict,
      probability: full.noul,
      confidence,
      reason: `Jev: ${verdict} (p=${confidence.toFixed(2)}); P(all facts in evidence)=${full.noul.toFixed(2)}`,
    };
  }

  async classify(text: string, labels: string[]): Promise<ClassificationResult> {
    const answers = await this.decide('classify', text, {
      label: {
        type: 'choice',
        instructions: 'Which label fits the text?',
        criteria: Object.fromEntries(labels.map((l) => [l, l])),
      },
    });
    const a = answers.label;
    if (a?.type !== 'choice' || !a.choice || !labels.includes(a.choice)) {
      throw new Error(`TypeSafe Jev Judge Classify: unexpected answer ${JSON.stringify(a)}`);
    }
    const confidence = a.confidence ?? a.probabilities?.[a.choice];
    if (typeof confidence !== 'number' || !a.probabilities) {
      throw new Error('TypeSafe Jev Judge Classify: no probabilities returned');
    }
    return { label: a.choice, probabilities: a.probabilities, confidence };
  }
}

/**
 * Judge running on any IModelProvider (e.g. OpenRouter), with the same prompts
 * and schemas as the Gemini judge. providerId/modelId are those of the
 * underlying provider; modelId is updated to the id the provider reports.
 */
export class ModelJudgeProvider implements IJudgeProvider {
  public providerId: string;
  public modelId: string;

  constructor(private provider: IModelProvider, modelId?: string) {
    this.providerId = provider.providerId;
    this.modelId = modelId || provider.defaultModelId || 'n/a';
  }

  private opts(actionName: string) {
    return {
      modelId: this.modelId === 'n/a' ? undefined : this.modelId,
      temperature: 0.0,
      actionName,
      systemInstruction: 'You are a rigorous factual verification judge. Respond strictly in valid JSON matching schema.',
    };
  }

  async verifyClaim(
    claim: string,
    evidenceText: string,
    context?: { stem?: string; options?: string[]; answerKey?: string }
  ): Promise<ClaimVerificationResult> {
    const prompt = buildVerifyClaimPrompt(claim, evidenceText, context);
    try {
      const res = await this.provider.generateStructured(prompt, GeminiJudgeVerifySchema, this.opts('judge:verifyClaim'));
      this.modelId = res.modelId;
      return res.output;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${this.providerId} judge error: ${msg}`);
    }
  }

  async classify(text: string, labels: string[]): Promise<ClassificationResult> {
    const prompt = buildClassifyPrompt(text, labels);
    try {
      const res = await this.provider.generateStructured(prompt, GeminiJudgeClassifySchema, this.opts('judge:classify'));
      this.modelId = res.modelId;
      return res.output;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${this.providerId} judge classify error: ${msg}`);
    }
  }
}

/**
 * Factory for Judge Provider.
 * 'gemini' is the default model judge (UI id kept for compatibility): it runs on
 * the default model provider (MODEL_PROVIDER). With MODEL_PROVIDER=openrouter it
 * is recorded as providerId 'openrouter' with the OpenRouter model id.
 */
export function getJudgeProvider(providerId = 'gemini'): IJudgeProvider {
  if (providerId === 'typesafe_jev') {
    return new TypeSafeJevJudgeProvider();
  }
  if (providerId === 'gemini' || providerId === 'default') {
    const defaultProvider = getDefaultProviderId();
    if (defaultProvider === 'gemini') return new GeminiJudgeProvider();
    const judgeModel = process.env.OPENROUTER_JUDGE_MODEL_ID?.trim() || undefined;
    return new ModelJudgeProvider(getProvider(defaultProvider), defaultProvider === 'openrouter' ? judgeModel : undefined);
  }
  throw new Error(`Unsupported judge provider requested: "${providerId}"`);
}

export function isTypeSafeJevConfigured(): boolean {
  return Boolean(getJevApiKey());
}
