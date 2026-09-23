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

// Model Provider registry
export function getProvider(providerId = 'gemini'): IModelProvider {
  if (providerId === 'gemini') {
    return new GeminiProvider();
  }
  if (providerId === 'openai') {
    return new OpenAIProviderStub();
  }
  throw new Error(`Unsupported model provider requested: "${providerId}"`);
}
