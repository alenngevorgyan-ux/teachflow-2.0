# Pilot readiness handoff

**NOT DEPLOYED TO PRODUCTION.** Only the feature branch was pushed. Vercel's
Git integration creates Preview deployments for such pushes; nothing was
promoted, and no production data or migration was touched.

## Starting point

- Branch: `claude/model-recommendations-ui-6imi0y` at
  `6fc0159b806d123064732e0dc7ff6223921e016b`.
- New branch: `claude/pilot-readiness-harness`, created from that commit.

## Final state

- Branch: `claude/pilot-readiness-harness`.
- Last code commit: `3cab6b0`. The docs are committed on top of it; the
  pushed HEAD is in `git log -1` and in the final report of this sprint.
- Not merged to `main`.

## Frozen benchmark vs current pilot candidate

- The frozen benchmark build is `c3d4abb7b262062b44f414fca610411b125e2151`.
  That commit is **not in this repository**, neither locally nor on
  `origin` (`git fetch` answers "not our ref"). Nothing here refers to it,
  and nothing was changed to or for it.
- This branch is the **current pilot candidate**. It is not the frozen
  benchmark build. No benchmark result applies to it, and none was
  rewritten.

## What was built

1. **Pilot case format** (`pilot-case/1`, `server/pilot/manifest.ts`):
   - roles mapped onto TeachFlow's concepts: program, fact and method
     sources, teacher document, template, reference, other;
   - required source metadata; stated-name confirmation;
   - a declaration that there is no student data in unchecked parts;
   - `synthetic` and `modelMode` flags, with FIXTURE mode and automation
     allowed for synthetic cases only;
   - `<FILL…>` placeholders are rejected.
2. **Preflight** (`npm run pilot:preflight`):
   - per input: existence, size, type sniffing, duplicates, same name with
     different bytes, metadata consistency;
   - the application's real extractor and DOCX opener; text and chunk
     hashes; scanned pages;
   - privacy findings by kind only;
   - a lock file (sha256 of the manifest and inputs).
3. **Run** (`npm run pilot:run`):
   - the application's own services in a per-case store;
   - that store holds no demo content (new `TEACHFLOW_STORE_SEED=rules-only`);
   - explicit states (`server/pilot/states.ts`) with a stop at every human
     step;
   - idempotent reruns;
   - refuses the wrong store, a store with demo content and stale inputs.
4. **Human steps in the real UI**: `npm run pilot:serve` serves the case
   store. Checked: the UI shows only the case's sources, and its export is
   byte-identical to the bundle's.
5. **Evidence bundle** (`npm run pilot:evidence`):
   - provenance: git, app, model configuration with credential presence
     only, prompt file hashes, extractors;
   - audited AI calls;
   - source diagnostics: original vs stored text;
   - check results with evidence hashes (text only with `--include-excerpts`);
   - deterministic export and structural DOCX diagnostics;
   - the change report and the human sheets;
   - a secret scan and `SHA256SUMS`;
   - bundles are never overwritten;
   - re-checks the preflight lock.
6. **Templates**:
   - `pilot/case-template/` (manifest example, README);
   - Word QA checklist;
   - Armenian review checklist;
   - human review sheet;
   - teacher feedback sheet.
7. **Synthetic example** `pilot/examples/SYNTH-AVARAYR-7`. It is labelled
   FIXTURE and synthetic throughout, and exercises structure → checks →
   proposal → accept → re-check → export.
8. **Docs**: `docs/pilot-runbook.md` and `docs/engineering-invariants.md`.

## Bugs found

| # | Bug | Cause | Reproduction | Fix | Regression test |
|---|---|---|---|---|---|
| 1 | A late structure proposal could overwrite the teacher's structure or key edits | `segment` committed without comparing the structure it started from | Teacher confirms or edits while a re-split waits: the run was `succeeded`, the teacher's work lost | Capture the structure and key before the call; a late result is `obsolete` (`f6f4754`) | `reviewFlow.test.ts` "pilot audit: a split proposal must not overwrite…" |
| 2 | FIXTURE mode sent source and query text to the Gemini embeddings API | The embedding provider ignored fixture mode whenever `GEMINI_API_KEY` was set | Seen in the first synthetic pilot run (401 from Gemini); the test sets a key and fixture mode, and the mock was called | Embeddings are disabled and not audited in fixture mode (`c7de8d3`) | `embeddingProvider.test.ts` "fixture mode (pilot audit)" |
| 3 | A truncated real-model answer could not be diagnosed | Token usage was dropped from the error | Real synthetic run: "cut off at 8192" with no detail | The error reports completion and reasoning tokens (`bd2caf1`) | `openRouterProvider.test.ts` "reports the token usage" |
| 4 | Pilot stores were seeded with DEMO sources, outcomes, plans and reports | The repository seeds demo data into any empty store | The first case store had 4 demo sources and 8 demo outcomes, selectable in the UI | `TEACHFLOW_STORE_SEED=rules-only`; the harness refuses stores with demo content (`b0fb63e`, `b0996b7`) | `pilot/run.test.ts` "a pilot store holds no demo content…" |
| 5 | Preflight repeated the personal data it had found (a phone number) in its report | The privacy guard's message includes the matched values | The test put a phone number in a DOCX header, and the report contained it | Report finding kinds only, in preflight and run errors (`b0996b7`) | `pilot/preflight.test.ts` PII cases |
| 6 | Evidence reported `EXPORT_FAILED` for a run waiting at a human step | Expected export text was evaluated before the fixes existed | Structure-pending case with `exportContains` | Expectations are evaluated only for a completed run; non-determinism and an unexpectedly changed export now fail (`3cab6b0`) | `pilot/run.test.ts` "stops at each human step…", "expected text missing…" |

Audited without a new bug (see `docs/engineering-invariants.md`):
- check runs, decisions and undo;
- outcome edits during a check (a test was added and passes on the old code);
- prompt contents and model id: recorded, not freshness dependencies;
- plan and assessment generators: snapshot artefacts outside the pilot
  path, not enforced.

## Tests

Run on the final code (the docs commit changes no code):

| Command | Result |
|---|---|
| `npx tsc --noEmit` (also `npm run lint`) | clean |
| `npm test` | **41 files, 484 tests passed** (431 at the start; 53 new) |
| `npx vitest run tests/pilot` | 4 files, 50 tests passed |
| `npx vite build` | built (the chunk-size warning is pre-existing) |
| Fixture browser E2E: fresh `.fixture-data`, `scripts/fixture-env.ts`, server on :3100, `node scripts/e2e-review.mjs` | `E2E OK`. Corrected DOCX sha256 `58cc0b0e…`, identical to the harness export of the synthetic case |
| Synthetic pilot CLI run: `init --from pilot/examples/SYNTH-AVARAYR-7`, preflight, run, evidence | `TECHNICAL_RUN_COMPLETE`, `fixture_deterministic`, 1 proposal accepted and re-checked, no problems |
| Real-model synthetic smoke (same case, `modelMode: real`, `google/gemini-3.5-flash`) | **`MODEL_FAILED`** at segmentation: cut off at 8192 tokens, 7862 of them reasoning. Recorded in its evidence as a real failure. Two calls; no further credit spent |

No separate browser E2E for the pilot: `e2e-review.mjs` already drives the
same UI flow. The pilot-shaped flow runs end to end against a real store in
`tests/pilot/run.test.ts`, and the served case UI was checked by hand. A
browser pilot E2E would duplicate both.

## Pilot workflow (when Narek sends materials)

```text
1. npm run pilot -- init pilot-private/CASE-001
2. Copy the files into pilot-private/CASE-001/inputs/ and fill manifest.json
   (every <FILL…>; see pilot/case-template/README.md).
3. npm run pilot:preflight -- pilot-private/CASE-001      (until PREFLIGHT_PASSED)
4. npm run pilot:run -- pilot-private/CASE-001
   At each *_PENDING state:
     npm run pilot:serve -- pilot-private/CASE-001  → http://localhost:3200, do the step, Ctrl+C,
     then run step 4 again. Repeat until TECHNICAL_RUN_COMPLETE (or a failure state).
5. npm run pilot:evidence -- pilot-private/CASE-001
6. Open evidence/bundle-*/summary.md; do the Word QA, Armenian review and teacher sheets
   in the bundle.
7. Give Claude Code the bundle directory (not the inputs) for analysis.
```

Before step 4, resolve the **real-model blocker** below.

## Decisions needed before a real pilot

1. **Segmentation fails with the configured model.** Options:
   - raise `OPENROUTER_MAX_TOKENS` (e.g. 16384–32768), which costs more
     per call;
   - limit reasoning for structured calls;
   - choose another model.
2. **Embeddings.** The `GEMINI_API_KEY` in `.env` is rejected by the
   embeddings API (401 `ACCESS_TOKEN_TYPE_UNSUPPORTED`), so retrieval is
   keyword-only. With a working key, source text and check queries go to
   Google's embeddings API: that is a third-party data flow to approve.
3. **Outcome confirmation** records no name (Invariant 4, not enforced).
   Note who confirmed in the human review sheet, or add attribution later.

## What remains impossible without real materials

- validating real Armenian sources: extraction quality, OCR needs, chunking
  of real programs and textbooks;
- validating a real teacher DOCX: layouts, numbering and tables this
  engine has never seen;
- Microsoft Word visual QA of the corrected copy;
- human Armenian review of findings and fixes;
- factual correctness of findings against real sources;
- real teacher usefulness and time saved;
- real-model quality of splitting, checks and proposals (blocked first by
  the token limit above);
- whether the program-outcome workflow matches what schools actually use.

## Known risks, not fixed (outside this sprint's scope)

- A corrupt store file in **normal** mode is replaced by seeded data and
  saved over. Pilot stores are safe: in `rules-only` mode an existing file
  is never re-seeded or overwritten at load.
- The "Reset demo data" button would seed demo content into a served pilot
  store. The next run refuses that store; the runbook warns about it.
- Check `detail` messages can quote short fragments of the material or the
  source, in evidence as in the UI. Full evidence text only with
  `--include-excerpts`.
- `.claude/` (local tool settings) is untracked and was not committed.

## Production status

`NOT DEPLOYED TO PRODUCTION`
