// Builds throwaway SYNTHETIC pilot cases in a temp directory from the
// committed example case (pilot/examples/SYNTH-AVARAYR-7).
import fs from 'fs';
import os from 'os';
import path from 'path';

export const EXAMPLE = path.resolve('pilot/examples/SYNTH-AVARAYR-7');

export function makeCase(mutate?: (m: any, dir: string) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-case-'));
  fs.cpSync(EXAMPLE, dir, { recursive: true, filter: (s) => !/[\\/](work|evidence)([\\/]|$)/.test(path.relative(EXAMPLE, s)) });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  mutate?.(m, dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return dir;
}
