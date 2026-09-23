import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ create: vi.fn(), apiKeys: [] as string[] }));
vi.mock('@openrouter/sdk', () => ({
  OpenRouter: class {
    alpha = { decisions: { create: sdk.create } };
    constructor(opts: { apiKey: string }) {
      sdk.apiKeys.push(opts.apiKey);
    }
  },
}));
vi.mock('../server/store/repository.js', () => ({ repository: { logAIInteraction: () => undefined } }));

import { JEV_DEFAULT_MODEL_ID, TypeSafeJevJudgeProvider, isTypeSafeJevConfigured } from '../server/providers/judgeProvider.js';

const ENV = ['OPENROUTER_JEV_API_KEY', 'OPENROUTER_API_KEY', 'JEV_MODEL_ID'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.OPENROUTER_JEV_API_KEY = 'jev-key';
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.JEV_MODEL_ID;
  sdk.create.mockReset();
  sdk.apiKeys.length = 0;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ok = (answers: Record<string, unknown>) => ({ model: '~typesafe/jev-2026-09', answers, usage: { inputTokens: 1, outputTokens: 1 } });

describe('TypeSafe Jev judge via OpenRouter decisions', () => {
  it('sends typed questions with the evidence and maps the answers', async () => {
    sdk.create.mockResolvedValueOnce(
      ok({
        verdict: { type: 'choice', choice: 'supported', probabilities: { supported: 0.91, partially_supported: 0.06, not_supported: 0.03 } },
        fully_supported: { type: 'noul', noul: 0.88 },
      })
    );
    const judge = new TypeSafeJevJudgeProvider();
    const r = await judge.verifyClaim('claim', 'evidence', { stem: 's', answerKey: 'k' });

    const req = sdk.create.mock.calls[0][0].decisionsRequest;
    expect(req.model).toBe(JEV_DEFAULT_MODEL_ID);
    expect(req.state).toMatchObject({ evidence: 'evidence', claim: 'claim', stem: 's', answerKey: 'k' });
    expect(req.questions.verdict.type).toBe('choice');
    expect(req.questions.fully_supported.type).toBe('noul');
    expect(sdk.apiKeys).toEqual(['jev-key']);

    expect(r).toMatchObject({ verdict: 'supported', confidence: 0.91, probability: 0.88 });
    expect(judge.modelId).toBe('~typesafe/jev-2026-09');
  });

  it('does not invent a confidence when Jev returns none', async () => {
    sdk.create.mockResolvedValueOnce(
      ok({ verdict: { type: 'choice', choice: 'supported' }, fully_supported: { type: 'noul', noul: 0.9 } })
    );
    await expect(new TypeSafeJevJudgeProvider().verifyClaim('c', 'e')).rejects.toThrow('no confidence');
  });

  it('rejects an unknown verdict', async () => {
    sdk.create.mockResolvedValueOnce(
      ok({ verdict: { type: 'choice', choice: 'maybe', confidence: 0.5 }, fully_supported: { type: 'noul', noul: 0.5 } })
    );
    await expect(new TypeSafeJevJudgeProvider().verifyClaim('c', 'e')).rejects.toThrow('unexpected verdict');
  });

  it('surfaces API failures', async () => {
    sdk.create.mockRejectedValueOnce(new Error('402 insufficient credits'));
    await expect(new TypeSafeJevJudgeProvider().verifyClaim('c', 'e')).rejects.toThrow('insufficient credits');
  });

  it('needs its own key; the general OpenRouter key is not used', async () => {
    delete process.env.OPENROUTER_JEV_API_KEY;
    process.env.OPENROUTER_API_KEY = 'general-key';
    expect(isTypeSafeJevConfigured()).toBe(false);
    await expect(new TypeSafeJevJudgeProvider().verifyClaim('c', 'e')).rejects.toThrow('OPENROUTER_JEV_API_KEY');
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it('classify returns the label with its distribution', async () => {
    sdk.create.mockResolvedValueOnce(ok({ label: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 } } }));
    const r = await new TypeSafeJevJudgeProvider().classify('text', ['a', 'b']);
    expect(r).toEqual({ label: 'b', probabilities: { a: 0.2, b: 0.8 }, confidence: 0.8 });
  });
});
