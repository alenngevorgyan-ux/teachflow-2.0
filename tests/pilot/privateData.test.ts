// Real pilot materials must never be committable.
import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const ignored = (p: string) => {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', p], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('pilot data is git-ignored', () => {
  it.each([
    'pilot-private/CASE-001/manifest.json',
    'pilot-private/CASE-001/inputs/Թեստ 7-րդ դասարան.docx',
    'pilot-private/CASE-001/work/store/teachflow_store.json',
    'pilot-private/CASE-001/evidence/bundle-x/export.docx',
    'pilot/examples/SYNTH-AVARAYR-7/work/store/teachflow_store.json',
    'pilot/examples/SYNTH-AVARAYR-7/evidence/bundle-x/summary.md',
  ])('%s is ignored', (p) => expect(ignored(p)).toBe(true));

  it.each(['pilot/case-template/manifest.example.json', 'pilot/examples/SYNTH-AVARAYR-7/manifest.json', 'server/pilot/run.ts'])('%s is not ignored', (p) =>
    expect(ignored(p)).toBe(false)
  );
});
