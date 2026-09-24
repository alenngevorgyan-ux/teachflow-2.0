import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const logs = vi.hoisted(() => [] as { providerId: string; modelId: string; action: string }[]);
vi.mock('../server/store/repository.js', () => ({
  repository: { logAIInteraction: (l: { providerId: string; modelId: string; action: string }) => logs.push(l) },
}));

import { OPENROUTER_API_URL, OpenRouterProvider, TruncatedOutputError, assertGeminiNotTruncated, getDefaultProviderId, getProvider } from '../server/providers/modelProvider.js';
import { getJudgeProvider } from '../server/providers/judgeProvider.js';

const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL_ID', 'OPENROUTER_JUDGE_MODEL_ID', 'MODEL_PROVIDER', 'OPENROUTER_MAX_TOKENS'];
let savedEnv: Record<string, string | undefined>;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_MODEL_ID = 'vendor/model-x';
  delete process.env.OPENROUTER_JUDGE_MODEL_ID;
  delete process.env.MODEL_PROVIDER;
  delete process.env.OPENROUTER_MAX_TOKENS;
  logs.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

const Schema = z.object({ answer: z.string() });

describe('OpenRouterProvider', () => {
  it('sends the configured model with a JSON schema and records the model OpenRouter reports', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ model: 'vendor/model-x-2026-09', choices: [{ message: { content: '{"answer":"Երևան"}' } }] })
    );
    const res = await new OpenRouterProvider().generateStructured('q', Schema, { actionName: 't' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENROUTER_API_URL);
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('vendor/model-x');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema.properties.answer).toBeDefined();

    expect(res.output).toEqual({ answer: 'Երևան' });
    expect(res.providerId).toBe('openrouter');
    expect(res.modelId).toBe('vendor/model-x-2026-09');
    expect(logs.at(-1)).toMatchObject({ providerId: 'openrouter', modelId: 'vendor/model-x-2026-09', action: 't' });
  });

  it('a per-call modelId overrides the configured one', async () => {
    fetchMock.mockResolvedValueOnce(reply({ model: 'other/model', choices: [{ message: { content: 'hi' } }] }));
    await new OpenRouterProvider().generateText('q', { modelId: 'other/model' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('other/model');
  });

  it('fails visibly without an API key and without calling the network', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(new OpenRouterProvider().generateText('q')).rejects.toThrow('OPENROUTER_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has no invented default model: missing OPENROUTER_MODEL_ID is an error', async () => {
    delete process.env.OPENROUTER_MODEL_ID;
    const p = new OpenRouterProvider();
    expect(p.defaultModelId).toBeUndefined();
    await expect(p.generateText('q')).rejects.toThrow('OPENROUTER_MODEL_ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the OpenRouter error message', async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: { message: 'Insufficient credits', code: 402 } }, 402));
    await expect(new OpenRouterProvider().generateText('q')).rejects.toThrow('Insufficient credits');
    expect(logs.at(-1)?.action).toBe('generateText:FAILED');
  });

  it('retries once on invalid JSON, then throws', async () => {
    fetchMock.mockImplementation(async () => reply({ model: 'm', choices: [{ message: { content: 'not json' } }] }));
    await expect(new OpenRouterProvider().generateStructured('q', Schema)).rejects.toThrow('after 2 attempts');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects output that does not match the schema', async () => {
    fetchMock.mockImplementation(async () => reply({ model: 'm', choices: [{ message: { content: '{"answer": 5}' } }] }));
    await expect(new OpenRouterProvider().generateStructured('q', Schema)).rejects.toThrow();
  });
});

describe('provider selection', () => {
  it('defaults to gemini when MODEL_PROVIDER is unset', () => {
    expect(getDefaultProviderId()).toBe('gemini');
    expect(getProvider().providerId).toBe('gemini');
  });

  it('MODEL_PROVIDER=openrouter routes default calls and the default judge to OpenRouter', () => {
    process.env.MODEL_PROVIDER = 'openrouter';
    process.env.OPENROUTER_JUDGE_MODEL_ID = 'vendor/judge-model';
    expect(getProvider().providerId).toBe('openrouter');
    const judge = getJudgeProvider('gemini');
    expect(judge.providerId).toBe('openrouter');
    expect(judge.modelId).toBe('vendor/judge-model');
  });

  it('an unknown provider is an error, not a fallback', () => {
    expect(() => getProvider('nope')).toThrow('Unsupported model provider');
  });

  it('the OpenRouter judge records the model it actually ran on', async () => {
    process.env.MODEL_PROVIDER = 'openrouter';
    fetchMock.mockResolvedValueOnce(
      reply({
        model: 'vendor/model-x-2026-09',
        choices: [{ message: { content: '{"verdict":"supported","probability":0.9,"confidence":0.9,"reason":"ok"}' } }],
      })
    );
    const judge = getJudgeProvider('gemini');
    const r = await judge.verifyClaim('claim', 'evidence');
    expect(r.verdict).toBe('supported');
    expect(judge.modelId).toBe('vendor/model-x-2026-09');
  });
});

describe('OpenRouter output-token limit', () => {
  const Items = z.object({ items: z.array(z.string()) });

  it('sends the documented default when unset, and the configured value when valid', async () => {
    fetchMock.mockImplementation(async () => reply({ choices: [{ message: { content: '{"answer":"x"}' }, finish_reason: 'stop' }] }));
    await new OpenRouterProvider().generateStructured('q', Schema);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(8192);
    process.env.OPENROUTER_MAX_TOKENS = ' 2048 ';
    await new OpenRouterProvider().generateStructured('q', Schema);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_tokens).toBe(2048);
  });

  it.each(['abc', '0', '-5', '1.5', '999999'])('an invalid OPENROUTER_MAX_TOKENS=%s is a visible config error, not the default', async (v) => {
    process.env.OPENROUTER_MAX_TOKENS = v;
    await expect(new OpenRouterProvider().generateStructured('q', Schema)).rejects.toThrow(/OPENROUTER_MAX_TOKENS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an answer cut at the limit even when the cut text is valid JSON (an incomplete list), without retrying', async () => {
    // A list that "ends" early still parses: only finish_reason tells it is incomplete.
    fetchMock.mockImplementation(async () => reply({ choices: [{ message: { content: '{"items":["1","2"]}' }, finish_reason: 'length' }] }));
    await expect(new OpenRouterProvider().generateStructured('q', Items)).rejects.toThrow(/after 1 attempt: .*cut off at the output-token limit \(8192\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.at(-1)?.action).toMatch(/:FAILED$/);
  });

  it('a cut-off answer reports the token usage, so reasoning that ate the budget is visible (pilot audit)', async () => {
    fetchMock.mockImplementation(async () =>
      reply({ choices: [{ message: { content: '{"items":[' }, finish_reason: 'length' }], usage: { prompt_tokens: 900, completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 8000 } } })
    );
    await expect(new OpenRouterProvider().generateStructured('q', Items)).rejects.toThrow(/output-token limit \(8192\); usage: completion 8192 tokens, of which reasoning 8000/);
  });

  it('also refuses a native MAX_TOKENS stop and truncated free text', async () => {
    fetchMock.mockResolvedValue(reply({ choices: [{ message: { content: 'Կիսատ պատասխ' }, finish_reason: 'stop', native_finish_reason: 'MAX_TOKENS' }] }));
    await expect(new OpenRouterProvider().generateText('q')).rejects.toThrow(/output-token limit/);
  });

  it('a normal stop is accepted', async () => {
    fetchMock.mockResolvedValue(reply({ choices: [{ message: { content: '{"items":["1","2","3"]}' }, finish_reason: 'stop' }] }));
    const res = await new OpenRouterProvider().generateStructured('q', Items);
    expect(res.output.items).toHaveLength(3);
  });
});

describe('Gemini truncation', () => {
  it('finishReason MAX_TOKENS is refused; STOP is accepted', () => {
    expect(() => assertGeminiNotTruncated({ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'g')).toThrow(TruncatedOutputError);
    expect(() => assertGeminiNotTruncated({ candidates: [{ finishReason: 'STOP' }] }, 'g')).not.toThrow();
  });
});
