// Pilot case command line. Every step runs the real TeachFlow code; see
// docs/pilot-runbook.md.
//
//   npm run pilot -- init      <caseDir> [--from <exampleCaseDir>]
//   npm run pilot -- preflight <caseDir>
//   npm run pilot -- run       <caseDir>
//   npm run pilot -- serve     <caseDir> [--port 3200]
//   npm run pilot -- evidence  <caseDir> [--include-excerpts]
//   npm run pilot -- status    <caseDir>
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const [cmd, caseArg, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(name);
const option = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

function usage(code = 2): never {
  console.log('usage: npm run pilot -- <init|preflight|run|serve|evidence|status> <caseDir> [options]  (see docs/pilot-runbook.md)');
  process.exit(code);
}

/** A case inside this repository must be git-ignored, so real materials can never be committed by accident. */
function assertPrivateLocation(caseDir: string): void {
  const repo = path.resolve(process.cwd());
  const rel = path.relative(repo, caseDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return; // outside the repository
  try {
    execFileSync('git', ['check-ignore', '-q', path.join(caseDir, 'manifest.json')], { stdio: 'ignore' });
  } catch {
    console.error(`REFUSED: ${caseDir} is inside the repository but NOT git-ignored. Put real pilot cases under pilot-private/ (ignored) or outside the repository.`);
    process.exit(3);
  }
}

async function caseEnv(caseDir: string, modelMode: 'real' | 'fixture', synthetic: boolean) {
  process.env.TEACHFLOW_DATA_DIR = path.join(caseDir, 'work', 'store');
  process.env.TEACHFLOW_STORE_SEED = 'rules-only'; // no demo sources, outcomes or plans in a pilot store
  if (modelMode === 'fixture') {
    if (!synthetic) throw new Error('fixture model mode is only allowed for synthetic cases');
    process.env.TEACHFLOW_FIXTURE_MODE = '1';
    process.env.MODEL_PROVIDER = 'fixture';
  } else {
    delete process.env.TEACHFLOW_FIXTURE_MODE;
  }
  // Credentials from .env (never printed). Existing variables win.
  (await import('dotenv')).config({ quiet: true } as never);
}

async function main() {
  if (!cmd || !caseArg) usage();
  const caseDir = path.resolve(caseArg);

  if (cmd === 'init') {
    if (fs.existsSync(caseDir)) throw new Error(`${caseDir} already exists`);
    assertPrivateLocation(caseDir);
    const from = option('--from');
    if (from) {
      fs.cpSync(path.resolve(from), caseDir, { recursive: true, filter: (s) => !/[\\/](work|evidence|outputs)([\\/]|$)/.test(path.relative(path.resolve(from), s)) });
      const m = JSON.parse(fs.readFileSync(path.join(caseDir, 'manifest.json'), 'utf8'));
      m.caseId = path.basename(caseDir);
      m.createdAt = new Date().toISOString();
      fs.writeFileSync(path.join(caseDir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
    } else {
      fs.mkdirSync(path.join(caseDir, 'inputs'), { recursive: true });
      const example = JSON.parse(fs.readFileSync(path.resolve('pilot/case-template/manifest.example.json'), 'utf8'));
      example.caseId = path.basename(caseDir);
      example.createdAt = new Date().toISOString();
      fs.writeFileSync(path.join(caseDir, 'manifest.json'), JSON.stringify(example, null, 2) + '\n');
    }
    console.log(`Created ${caseDir}. Put the files into inputs/ and fill manifest.json (see pilot/case-template/README.md).`);
    return;
  }

  assertPrivateLocation(caseDir);
  const { readManifest } = await import('../server/pilot/manifest.js');

  if (cmd === 'preflight') {
    const { writePreflight } = await import('../server/pilot/preflight.js');
    const { report } = await writePreflight(caseDir);
    console.log(`${report.status} (${report.inputs.length} input(s))`);
    for (const r of report.inputs) console.log(`  ${r.id} [${r.role}] ${r.file}: ${r.bytes ?? '-'} bytes, sha256 ${r.sha256?.slice(0, 16) ?? '-'}…${r.extraction ? `, text ${r.extraction.textLength} chars / ${r.extraction.chunkCount} chunks (${r.extraction.status})` : ''}${r.docx ? `, ${r.docx.paragraphs} paragraphs` : ''}`);
    for (const e of report.errors) console.log(`  ERROR ${e}`);
    for (const w of report.warnings) console.log(`  warning ${w}`);
    process.exit(report.status === 'PREFLIGHT_PASSED' ? 0 : 1);
  }

  const { manifest, errors } = readManifest(caseDir);
  if (!manifest) throw new Error(errors.join('; '));
  await caseEnv(caseDir, manifest.modelMode, manifest.synthetic);

  if (cmd === 'run') {
    const { runPilotCase } = await import('../server/pilot/run.js');
    const rs = await runPilotCase(caseDir);
    for (const s of rs.stages) console.log(`  ${s.stage}: ${s.state} — ${s.detail}`);
    console.log(`STATE: ${rs.finalState}`);
    if (rs.instruction) console.log(`NEXT: ${rs.instruction}`);
    const { isFailure } = await import('../server/pilot/states.js');
    process.exit(rs.finalState && isFailure(rs.finalState) ? 1 : 0);
  }
  if (cmd === 'evidence') {
    const { collectEvidence } = await import('../server/pilot/evidence.js');
    const r = await collectEvidence(caseDir, { includeExcerpts: flag('--include-excerpts') });
    console.log(`STATE: ${r.overallState}\nmodel execution: ${r.modelExecution}\nbundle: ${r.bundleDir}`);
    for (const p of r.problems) console.log(`  problem: ${p}`);
    process.exit(0);
  }
  if (cmd === 'status') {
    const { readRunState } = await import('../server/pilot/run.js');
    const rs = readRunState(caseDir);
    const ev = path.join(caseDir, 'evidence');
    const bundles = fs.existsSync(ev) ? fs.readdirSync(ev).sort() : [];
    console.log(`STATE: ${rs?.finalState ?? 'NOT RUN'}${rs?.instruction ? `\nNEXT: ${rs.instruction}` : ''}\nlatest evidence: ${bundles.at(-1) ?? 'none'}`);
    return;
  }
  if (cmd === 'serve') {
    const port = option('--port') ?? '3200';
    console.log(`Serving the case store of ${manifest.caseId} on http://localhost:${port} (${manifest.modelMode === 'fixture' ? 'FIXTURE mode' : 'real model'}). Ctrl+C to stop.`);
    const child = spawn('npx', ['tsx', 'server.ts'], { stdio: 'inherit', env: { ...process.env, PORT: port, DISABLE_HMR: 'true' } });
    child.on('exit', (c) => process.exit(c ?? 0));
    return;
  }
  usage();
}

main().catch((err) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
