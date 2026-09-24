import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { extractorVersions, sha256 } from './preflight.js';

// "What exactly produced this output?" — application, configuration and
// prompt identity for pilot evidence. Credentials are recorded only as
// present / absent; their values are never read into evidence.

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function gitProvenance() {
  const porcelain = git(['status', '--porcelain', '--untracked-files=no']);
  return {
    commit: git(['rev-parse', 'HEAD']) ?? 'UNKNOWN',
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'UNKNOWN',
    /** Tracked files modified relative to the commit: the run is then NOT exactly this commit. */
    dirtyTrackedFiles: porcelain === null ? null : porcelain.split('\n').filter(Boolean).length,
  };
}

export function appProvenance() {
  let pkg: { name?: string; version?: string } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  } catch {
    /* unknown */
  }
  return { name: pkg.name ?? 'UNKNOWN', version: pkg.version ?? 'UNKNOWN', node: process.version, platform: `${process.platform}-${process.arch}` };
}

const SET = (k: string) => Boolean(process.env[k]?.trim());

/** Non-secret model configuration; credentials only as booleans. */
export function modelConfiguration() {
  return {
    MODEL_PROVIDER: process.env.MODEL_PROVIDER?.trim() || '(unset: gemini)',
    OPENROUTER_MODEL_ID: process.env.OPENROUTER_MODEL_ID?.trim() || null,
    OPENROUTER_JUDGE_MODEL_ID: process.env.OPENROUTER_JUDGE_MODEL_ID?.trim() || null,
    OPENROUTER_MAX_TOKENS: process.env.OPENROUTER_MAX_TOKENS?.trim() || '(unset: 8192)',
    JEV_MODEL_ID: process.env.JEV_MODEL_ID?.trim() || null,
    TEACHFLOW_FIXTURE_MODE: process.env.TEACHFLOW_FIXTURE_MODE === '1',
    credentialsPresent: {
      OPENROUTER_API_KEY: SET('OPENROUTER_API_KEY'),
      GEMINI_API_KEY: SET('GEMINI_API_KEY'),
      OPENROUTER_JEV_API_KEY: SET('OPENROUTER_JEV_API_KEY'),
    },
    fixedCallParameters: 'material checks and splitting: temperature 0; judge verifyClaim: temperature 0',
  };
}

/** sha256 of every prompt template, so a prompt edit without a version bump is still visible in evidence. */
export function promptHashes(): Record<string, string> {
  const dir = path.resolve(process.cwd(), 'server/prompts');
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.txt')) out[f] = sha256(fs.readFileSync(path.join(dir, f)));
  return out;
}

export function fullProvenance() {
  return { git: gitProvenance(), app: appProvenance(), model: modelConfiguration(), prompts: promptHashes(), extractors: extractorVersions() };
}

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|AUTH|CREDENTIAL|PRIVATE)/i;

/** Values of secret-looking environment variables (>= 8 chars): evidence must contain none of them. */
export function secretValues(): { name: string; value: string }[] {
  return Object.entries(process.env)
    .filter(([k, v]) => SECRET_NAME.test(k) && typeof v === 'string' && v.trim().length >= 8)
    .map(([name, value]) => ({ name, value: value!.trim() }));
}

/** Names of secret variables whose value appears in `text` (never the values). */
export function findSecrets(text: string, secrets = secretValues()): string[] {
  return secrets.filter((s) => text.includes(s.value)).map((s) => s.name);
}
