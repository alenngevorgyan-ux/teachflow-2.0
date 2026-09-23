import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { repository } from '../store/repository.js';

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
}

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
          },
        });

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
        repository.logAIInteraction({
          providerId: this.providerId,
          modelId: model,
          action: options?.actionName || 'generateStructured',
          prompt,
          output: rawText,
          latencyMs,
        });

        return {
          output: validated,
          providerId: this.providerId,
          modelId: model,
          latencyMs,
          requestId,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[GeminiProvider] Attempt ${attempts} failed:`, lastError.message);
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
    });

    throw new Error(
      `Gemini Provider (${model}) failed to generate valid structured output after 2 attempts: ${lastError?.message}`
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
export class OpenRouterProvider implements IModelProvider {
  public providerId = 'openrouter';
  public defaultModelId = process.env.OPENROUTER_MODEL_ID?.trim() || undefined;

  private async complete(
    prompt: string,
    options: ProviderOptions | undefined,
    extra: Record<string, unknown>,
    defaultSystem?: string
  ): Promise<{ text: string; model: string }> {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('OpenRouter Provider Error: OPENROUTER_API_KEY is not set in environment.');
    }
    const model = options?.modelId || this.defaultModelId;
    if (!model) {
      throw new Error('OpenRouter Provider Error: no model id (set OPENROUTER_MODEL_ID).');
    }
    const system = options?.systemInstruction || defaultSystem;
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
        ...extra,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: string | null } }[];
      error?: { message?: string; code?: number | string };
    } | null;
    if (!res.ok || !body || body.error) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      throw new Error(`OpenRouter (${model}) error: ${msg}`);
    }
    const text = body.choices?.[0]?.message?.content || '';
    if (!text) throw new Error(`OpenRouter (${model}) returned an empty response`);
    return { text, model: body.model || model };
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

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { text, model } = await this.complete(
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
        rawText = text;
        modelUsed = model;
        const validated = schema.parse(JSON.parse(stripJsonFences(text)));
        const latencyMs = Date.now() - start;
        repository.logAIInteraction({
          providerId: this.providerId,
          modelId: modelUsed,
          action: options?.actionName || 'generateStructured',
          prompt,
          output: rawText,
          latencyMs,
        });
        return { output: validated, providerId: this.providerId, modelId: modelUsed, latencyMs, requestId };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[OpenRouterProvider] Attempt ${attempt} failed:`, lastError.message);
      }
    }

    repository.logAIInteraction({
      providerId: this.providerId,
      modelId: modelUsed,
      action: `${options?.actionName || 'generateStructured'}:FAILED`,
      prompt,
      output: rawText || `Error: ${lastError?.message}`,
      latencyMs: Date.now() - start,
    });
    throw new Error(
      `OpenRouter Provider (${modelUsed}) failed to generate valid structured output after 2 attempts: ${lastError?.message}`
    );
  }

  async generateText(prompt: string, options?: ProviderOptions): Promise<ProviderResponse<string>> {
    const start = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const requested = options?.modelId || this.defaultModelId || 'n/a';
    try {
      const { text, model } = await this.complete(prompt, options, { temperature: options?.temperature ?? 0.2 });
      const latencyMs = Date.now() - start;
      repository.logAIInteraction({
        providerId: this.providerId,
        modelId: model,
        action: options?.actionName || 'generateText',
        prompt,
        output: text,
        latencyMs,
      });
      return { output: text, providerId: this.providerId, modelId: model, latencyMs, requestId };
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
  throw new Error(`Unsupported model provider requested: "${providerId}"`);
}
