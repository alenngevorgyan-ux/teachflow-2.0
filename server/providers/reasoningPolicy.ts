// How much a reasoning model may "think" per operation. Thinking tokens count
// toward the output limit: a structural task at the model's default level
// (medium for Gemini 3.5 Flash) spent 7862 of 8192 tokens thinking before
// answering. Levels are set per operation, not globally; operations not
// listed here keep the provider's default (unchanged behaviour).
//
// OpenRouter: sent as reasoning.effort (mapped to Gemini's thinkingLevel).
// Gemini direct: sent as thinkingConfig.thinkingLevel for gemini-3* models.
// The level used is recorded with every result and audit entry.
import { ThinkingLevel } from '@google/genai';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export const REASONING_POLICY_VERSION = 'reasoning-policy/1';

const POLICY: Readonly<Record<string, ReasoningEffort>> = {
  // parsing / splitting / JSON extraction
  'material:segment': 'minimal',
  // checking a question against the program or a source
  'material:program_scope': 'low',
  'material:answer_unambiguous': 'low',
  'judge:verifyClaim': 'low',
  // writing a correction: more demanding pedagogically
  'material:suggest_fix': 'medium',
};

const LEVELS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

/**
 * Experiment override, e.g. TEACHFLOW_REASONING_OVERRIDE="material:segment=low".
 * Only operations already in the policy; an invalid entry is an error, never ignored.
 * The effective policy (with any override) is what evidence records.
 */
function overrides(): Record<string, ReasoningEffort> {
  const raw = process.env.TEACHFLOW_REASONING_OVERRIDE?.trim();
  if (!raw) return {};
  const out: Record<string, ReasoningEffort> = {};
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [op, level] = part.split('=').map((x) => x.trim());
    if (!(op in POLICY) || !LEVELS.includes(level as ReasoningEffort)) {
      throw new Error(`TEACHFLOW_REASONING_OVERRIDE: invalid entry "${part}" (operations: ${Object.keys(POLICY).join(', ')}; levels: ${LEVELS.join(', ')})`);
    }
    out[op] = level as ReasoningEffort;
  }
  return out;
}

/** The level for an operation (action name), or undefined = provider default. */
export function reasoningEffortFor(actionName: string | undefined): ReasoningEffort | undefined {
  if (!actionName) return undefined;
  return overrides()[actionName] ?? POLICY[actionName];
}

/** The effective per-operation levels (policy plus any override). */
export function reasoningPolicy(): Record<string, ReasoningEffort> {
  return { ...POLICY, ...overrides() };
}

export function reasoningPolicyId(): string {
  const o = overrides();
  return Object.keys(o).length ? `${REASONING_POLICY_VERSION}+override(${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(',')})` : REASONING_POLICY_VERSION;
}

/** Gemini's native thinkingLevel exists only on Gemini 3 models. */
const GEMINI_LEVEL: Record<ReasoningEffort, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export function geminiThinkingConfig(modelId: string, actionName: string | undefined): { thinkingLevel: ThinkingLevel } | undefined {
  const effort = reasoningEffortFor(actionName);
  if (!effort || !/^gemini-3/.test(modelId)) return undefined;
  return { thinkingLevel: GEMINI_LEVEL[effort] };
}
