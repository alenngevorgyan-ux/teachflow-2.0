import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { FixtureModelProvider, isFixtureMode } from './fixtureProvider.js';
import { CallUsage, repository } from '../store/repository.js';
import { geminiThinkingConfig, reasoningEffortFor } from './reasoningPolicy.js';

export interface ProviderOptions {
  modelId?: string;
  temperature?: number;
  systemInstruction?: string;
  actionName?: string;
}

export interface ProviderResponse<T> {
  output: T;
  providerId: string;
  modelId: string;
  latencyMs: number;
  requestId: string;
  /** Thinking level requested for this operation (reasoningPolicy); absent = provider default. */
  reasoningEffort?: string;
  usage?: CallUsage;
}

type RawUsage = { promptTokens: number | null; completionTokens: number | null; reasoningTokens: number | null; costUsd: number | null };

/** Sums the usage of several attempts; a value unknown in any attempt stays unknown. */
export function sumUsage(parts: RawUsage[]): CallUsage {
  const add = (k: keyof RawUsage) => (parts.length && parts.every((p) => typeof p[k] === 'number') ? parts.reduce((n, p) => n + (p[k] as number), 0) : null);
  return { attempts: parts.length, promptTokens: add('promptTokens'), completionTokens: add('completionTokens'), reasoningTokens: add('reasoningTokens'), costUsd: add('costUsd') };
}

function openRouterUsage(u: OpenRouterUsage | undefined): RawUsage {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { promptTokens: num(u?.prompt_tokens), completionTokens: num(u?.completion_tokens), reasoningTokens: num(u?.completion_tokens_details?.reasoning_tokens), costUsd: num(u?.cost) };
}

function geminiUsage(r: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }): RawUsage {
  const m = r.usageMetadata;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const out = num(m?.candidatesTokenCount);
  const thoughts = num(m?.thoughtsTokenCount) ?? (m ? 0 : null);
  // Gemini reports thoughts separately from the answer; completion = answer + thoughts. Cost is not reported.
  return { promptTokens: num(m?.promptTokenCount), completionTokens: out !== null && thoughts !== null ? out + thoughts : null, reasoningTokens: thoughts, costUsd: null };
}

type OpenRouterUsage = { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; cost?: number };

export interface IModelProvider {
  providerId: string;
  // Model used when a call passes no modelId; undefined if not configured
  defaultModelId?: string;
  generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: ProviderOptions
  ): Promise<ProviderResponse<T>>;

  generateText(prompt: string, options?: ProviderOptions): Promise<ProviderResponse<string>>;
}

export class GeminiProvider implements IModelProvider {
  public providerId = 'gemini';
  private defaultModel = 'gemini-3.8-flash';
  public defaultModelId = this.defaultModel;

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Gemini Provider Error: GEMINI_API_KEY is not set in environment. Please configure your API key.'
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

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: ProviderOptions
  ): Promise<ProviderResponse<T>> {
    const start = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const model = options?.modelId || this.defaultModel;
    const ai = this.getClient();

    let attempts = 0;
    let lastError: Error | null = null;
    let rawText = '';
    const thinkingConfig = geminiThinkingConfig(model, options?.actionName);
    const reasoningEffort = thinkingConfig ? reasoningEffortFor(options?.actionName) : undefined;
    const usages: RawUsage[] = [];

    while (attempts < 2) {
      attempts++;
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction:
              options?.systemInstruction ||
              'You are a precise educational assistant. Output only strictly valid JSON matching the requested structure.',
            temperature: options?.temperature !== undefined ? options?.temperature : 0.1,
            responseMimeType: 'application/json',
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
        });
        usages.push(geminiUsage(response));

        assertGeminiNotTruncated(response, model);
        rawText = response.text || '';
        if (!rawText) {
          throw new Error('Empty response received from Gemini model');
        }

        // Parse JSON
        // Strip markdown backticks if any
        let cleanedJson = rawText.trim();
        if (cleanedJson.startsWith('```json')) {
          cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        } else if (cleanedJson.startsWith('```')) {
          cleanedJson = cleanedJson.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
        }

        const parsed = JSON.parse(cleanedJson);
        const validated = schema.parse(parsed);

        const latencyMs = Date.now() - start;

        // Log for audit
        const usage = sumUsage(usages);
        repository.logAIInteraction({
          providerId: this.providerId,
          modelId: model,
          action: options?.actionName || 'generateStructured',
          prompt,
          output: rawText,
          latencyMs,
          reasoningEffort,
          usage,
        });

        return {
          output: validated,
          providerId: this.providerId,
          modelId: model,
          latencyMs,
          requestId,
          reasoningEffort,
          usage,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[GeminiProvider] Attempt ${attempts} failed:`, lastError.message);
        if (err instanceof TruncatedOutputError) break; // the same limit would cut it again
      }
    }

    const latencyMs = Date.now() - start;
    repository.logAIInteraction({
      providerId: this.providerId,
      modelId: model,
      action: `${options?.actionName || 'generateStructured'}:FAILED`,
      prompt,
      output: rawText || `Error: ${lastError?.message}`,
      latencyMs,
      reasoningEffort,
      usage: sumUsage(usages),
    });

    throw new Error(
      `Gemini Provider (${model}) failed to generate valid structured output after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${lastError?.message}`
    );
  }

  async generateText(prompt: string, options?: ProviderOptions): Promise<ProviderResponse<string>> {
    const start = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const model = options?.modelId || this.defaultModel;
    const ai = this.getClient();

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: options?.systemInstruction,
          temperature: options?.temperature !== undefined ? options?.temperature : 0.2,
        },
      });

      assertGeminiNotTruncated(response, model);
      const output = response.text || '';
      const latencyMs = Date.now() - start;

      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: model,
        action: options?.actionName || 'generateText',
        prompt,
        output,
        latencyMs,
      });

      return {
        output,
        providerId: this.providerId,
        modelId: model,
        latencyMs,
        requestId,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: model,
        action: `${options?.actionName || 'generateText'}:FAILED`,
        prompt,
        output: `Error: ${errorMsg}`,
        latencyMs,
      });
      throw new Error(`Gemini Provider (${model}) execution failed: ${errorMsg}`);
    }
  }
}

export class OpenAIProviderStub implements IModelProvider {
  public providerId = 'openai';

  async generateStructured<T>(
    _prompt: string,
    _schema: z.ZodType<T>,
    _options?: ProviderOptions
  ): Promise<ProviderResponse<T>> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'OpenAI Provider is not configured in this environment (OPENAI_API_KEY missing).'
      );
    }
    throw new Error('OpenAI Provider is configured as stub in current MVP build.');
  }

  async generateText(_prompt: string, _options?: ProviderOptions): Promise<ProviderResponse<string>> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'OpenAI Provider is not configured in this environment (OPENAI_API_KEY missing).'
      );
    }
    throw new Error('OpenAI Provider is configured as stub in current MVP build.');
  }
}

function stripJsonFences(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  }
  return cleaned;
}

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenRouter (OpenAI-compatible chat completions). The model id must be set
 * explicitly (OPENROUTER_MODEL_ID or per call); there is no built-in default.
 * The model id OpenRouter reports back is what gets recorded.
 */
export const OPENROUTER_DEFAULT_MAX_TOKENS = 8192;
const OPENROUTER_MAX_TOKENS_LIMIT = 131072;

/**
 * Output token ceiling per OpenRouter request. Unset/empty -> the documented
 * default (8192). A value that is set but not a whole number in
 * 1..131072 is a configuration error, reported on every call, never replaced
 * silently by the default.
 */
export function openRouterMaxTokens(): number {
  const raw = process.env.OPENROUTER_MAX_TOKENS?.trim();
  if (!raw) return OPENROUTER_DEFAULT_MAX_TOKENS;
  const v = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(v) || v < 1 || v > OPENROUTER_MAX_TOKENS_LIMIT) {
    throw new Error(`OpenRouter Provider Error: OPENROUTER_MAX_TOKENS="${raw}" is invalid (a whole number 1–${OPENROUTER_MAX_TOKENS_LIMIT} expected).`);
  }
  return v;
}

/**
 * The model stopped because it hit the output-token limit. The text is cut
 * off: even if it happens to parse as JSON (e.g. a list that ends early) it
 * is not a complete answer and is never accepted.
 */
export class TruncatedOutputError extends Error {
  usage?: RawUsage;
  constructor(providerModel: string, limit: number | string, usage?: string) {
    super(`${providerModel}: the response was cut off at the output-token limit (${limit})${usage ? `; usage: ${usage}` : ''}; an incomplete answer is not accepted.`);
    this.name = 'TruncatedOutputError';
  }
}

/** Gemini: candidates[0].finishReason === 'MAX_TOKENS' means a cut-off answer. */
export function assertGeminiNotTruncated(response: { candidates?: { finishReason?: string }[] }, model: string): void {
  if (response.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new TruncatedOutputError(`Gemini (${model})`, 'model maximum');
}

export class OpenRouterProvider implements IModelProvider {
  public providerId = 'openrouter';
  public defaultModelId = process.env.OPENROUTER_MODEL_ID?.trim() || undefined;

  private async complete(
    prompt: string,
    options: ProviderOptions | undefined,
    extra: Record<string, unknown>,
    defaultSystem?: string
  ): Promise<{ text: string; model: string; usage: RawUsage }> {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('OpenRouter Provider Error: OPENROUTER_API_KEY is not set in environment.');
    }
    const model = options?.modelId || this.defaultModelId;
    if (!model) {
      throw new Error('OpenRouter Provider Error: no model id (set OPENROUTER_MODEL_ID).');
    }
    const system = options?.systemInstruction || defaultSystem;
    const maxTokens = openRouterMaxTokens();
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'TeachFlow',
      },
      body: JSON.stringify({
        model,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
        // Without max_tokens OpenRouter reserves the model's maximum output
        // (65536 for the configured model), which a key with a spending limit
        // cannot afford even for a small structured answer. Bounded here;
        // a too-small limit yields invalid JSON and a visible error.
        max_tokens: maxTokens,
        ...(reasoningEffortFor(options?.actionName) ? { reasoning: { effort: reasoningEffortFor(options?.actionName) } } : {}),
        ...extra,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: string | null }; finish_reason?: string | null; native_finish_reason?: string | null }[];
      usage?: OpenRouterUsage;
      error?: { message?: string; code?: number | string };
    } | null;
    if (!res.ok || !body || body.error) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      throw new Error(`OpenRouter (${model}) error: ${msg}`);
    }
    const usage = openRouterUsage(body.usage);
    const finish = body.choices?.[0]?.finish_reason;
    const nativeFinish = body.choices?.[0]?.native_finish_reason;
    if (finish === 'length' || nativeFinish === 'MAX_TOKENS' || nativeFinish === 'max_tokens') {
      // Reasoning tokens count toward max_tokens: the usage shows whether thinking used up the budget.
      const u = body.usage;
      const usageText =
        typeof u?.completion_tokens === 'number'
          ? `completion ${u.completion_tokens} tokens${typeof u.completion_tokens_details?.reasoning_tokens === 'number' ? `, of which reasoning ${u.completion_tokens_details.reasoning_tokens}` : ''}`
          : undefined;
      const cut = new TruncatedOutputError(`OpenRouter (${body.model || model})`, maxTokens, usageText);
      cut.usage = usage; // a cut-off answer is still paid for
      throw cut;
    }
    const text = body.choices?.[0]?.message?.content || '';
    if (!text) throw new Error(`OpenRouter (${model}) returned an empty response`);
    return { text, model: body.model || model, usage };
  }

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: ProviderOptions
  ): Promise<ProviderResponse<T>> {
    const start = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const requested = options?.modelId || this.defaultModelId || 'n/a';
    let modelUsed = requested;
    let rawText = '';
    let lastError: Error | null = null;

    let attempts = 0;
    const reasoningEffort = reasoningEffortFor(options?.actionName);
    const usages: RawUsage[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      try {
        const { text, model, usage: u } = await this.complete(
          prompt,
          options,
          {
            temperature: options?.temperature ?? 0.1,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'output', strict: false, schema: z.toJSONSchema(schema) },
            },
          },
          'You are a precise educational assistant. Output only strictly valid JSON matching the requested structure.'
        );
        usages.push(u);
        rawText = text;
        modelUsed = model;
        const validated = schema.parse(JSON.parse(stripJsonFences(text)));
        const latencyMs = Date.now() - start;
        const usage = sumUsage(usages);
        repository.logAIInteraction({
          providerId: this.providerId,
          modelId: modelUsed,
          action: options?.actionName || 'generateStructured',
          prompt,
          output: rawText,
          latencyMs,
          reasoningEffort,
          usage,
        });
        return { output: validated, providerId: this.providerId, modelId: modelUsed, latencyMs, requestId, reasoningEffort, usage };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof TruncatedOutputError && err.usage) usages.push(err.usage);
        console.warn(`[OpenRouterProvider] Attempt ${attempt} failed:`, lastError.message);
        // The same limit would cut the answer again: do not pay for a retry.
        if (err instanceof TruncatedOutputError || /OPENROUTER_MAX_TOKENS=/.test(lastError.message)) break;
      }
    }

    repository.logAIInteraction({
      providerId: this.providerId,
      modelId: modelUsed,
      action: `${options?.actionName || 'generateStructured'}:FAILED`,
      prompt,
      output: rawText || `Error: ${lastError?.message}`,
      latencyMs: Date.now() - start,
      reasoningEffort,
      usage: sumUsage(usages),
    });
    throw new Error(
      `OpenRouter Provider (${modelUsed}) failed to generate valid structured output after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${lastError?.message}`
    );
  }

  async generateText(prompt: string, options?: ProviderOptions): Promise<ProviderResponse<string>> {
    const start = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const requested = options?.modelId || this.defaultModelId || 'n/a';
    try {
      const { text, model, usage: u } = await this.complete(prompt, options, { temperature: options?.temperature ?? 0.2 });
      const latencyMs = Date.now() - start;
      const reasoningEffort = reasoningEffortFor(options?.actionName);
      const usage = sumUsage([u]);
      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: model,
        action: options?.actionName || 'generateText',
        prompt,
        output: text,
        latencyMs,
        reasoningEffort,
        usage,
      });
      return { output: text, providerId: this.providerId, modelId: model, latencyMs, requestId, reasoningEffort, usage };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: requested,
        action: `${options?.actionName || 'generateText'}:FAILED`,
        prompt,
        output: `Error: ${errorMsg}`,
        latencyMs: Date.now() - start,
      });
      throw new Error(`OpenRouter Provider (${requested}) execution failed: ${errorMsg}`);
    }
  }
}

export const MODEL_PROVIDER_IDS = ['gemini', 'openrouter', 'openai'] as const;

/** Provider used when a request does not name one: MODEL_PROVIDER env, else gemini. */
export function getDefaultProviderId(): string {
  return process.env.MODEL_PROVIDER?.trim() || 'gemini';
}

export function isProviderConfigured(providerId: string): boolean {
  if (providerId === 'gemini') return Boolean(process.env.GEMINI_API_KEY?.trim());
  if (providerId === 'openrouter')
    return Boolean(process.env.OPENROUTER_API_KEY?.trim() && process.env.OPENROUTER_MODEL_ID?.trim());
  return false;
}

// Model Provider registry — an unknown id is an error, never a fallback
export function getProvider(providerId = getDefaultProviderId()): IModelProvider {
  if (providerId === 'gemini') {
    return new GeminiProvider();
  }
  if (providerId === 'openrouter') {
    return new OpenRouterProvider();
  }
  if (providerId === 'openai') {
    return new OpenAIProviderStub();
  }
  if (providerId === 'fixture') {
    // Deterministic stand-in, only in the separate labelled fixture environment.
    if (!isFixtureMode()) throw new Error('The fixture provider is only available in the separate FIXTURE environment.');
    return new FixtureModelProvider();
  }
  throw new Error(`Unsupported model provider requested: "${providerId}"`);
}
