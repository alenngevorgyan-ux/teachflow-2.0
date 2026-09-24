# Overnight handoff — 2026-09-24

Branch `claude/docx-material-fix`. Start of the night: `6423a6160e2e21aa0acc670679f96b3d7641f6e9`. Final SHA and push status: see the end of this file.
**Production: not deployed.** Nothing was merged into `main`. The branch is not the production branch.

## What changed tonight (commits)

| Commit | Summary |
|---|---|
| `fed0f0f` | Review sessions: per-review lock + version, run records (running/succeeded/failed/obsolete), late results discarded, spans in segmentation coordinates, **undo**, teacher edits as new proposal revisions, key-only fixes for teacher keys, input-hash reuse, retry of failed calls, formatting policy, exact no-op export, original download, several questions per paragraph, teacher split edits, question-type rules, no-student-data declaration, audit redaction, FIXTURE provider |
| `be8c6fa` | Found by the E2E run: freshness from dependency invalidation only; option-count uses the real seeded rule; program ≠ factual evidence; Armenian preservation notes; report hash |
| `a59d0a9` | Armenian-first design system, app shell, Home, the whole review UI, fixture tooling, E2E script and evidence |
| `06c2297` | Historical debts: consolidation inputs, calendar, embedding audit, MCP strings, academic-year confirmation |
| `9d73560` | Other screens: translated report statuses, normal-case badges, wrapping headers, screens audit |
| `504d600` | OpenRouter `max_tokens` bounded (the reason every live call failed) |
| (docs) | This handoff, the design notes, the progress log, TASKS.md |

## How to run

```bash
npm install
npm run dev                      # normal app, http://localhost:3000 (demo data, real provider from .env)

# Separate, labelled FIXTURE environment (rule-based "model", synthetic sources; never touches data/)
rm -rf .fixture-data && TEACHFLOW_DATA_DIR=.fixture-data npx tsx scripts/fixture-env.ts
PORT=3100 TEACHFLOW_DATA_DIR=.fixture-data TEACHFLOW_FIXTURE_MODE=1 MODEL_PROVIDER=fixture DISABLE_HMR=true npx tsx server.ts
node scripts/e2e-review.mjs      # drives the UI in Chrome against :3100, writes docs/e2e + docs/screenshots/after
npx tsx scripts/inspect-e2e-output.mts   # inspects the downloaded DOCX files
node scripts/screens-audit.mjs   # main routes on :3000, screenshots + horizontal overflow
```

`DISABLE_HMR=true` keeps the second server's HMR port free. That also means it does not pick up front-end edits: restart it after changing `src/`.

## Five-minute smoke scenario (by hand, FIXTURE environment on :3100)

1. Open `http://localhost:3100/#/materialReview`. A dark banner says FIXTURE. Upload `docs/fixtures/Թեստ_Ավարայր_7-րդ դասարան (FIXTURE) v2.docx`.
2. Click **Առաջարկել կառուցվածքը**. Question 3 wrongly gets one "option" (its instruction line). In **Կառուցվածք**, set its type to **Բաց հարց**, click **Հեռացնել տարբերակը**, then **Պահպանել ուղղումները** and **Հաստատել կառուցվածքը**.
3. Click **Ստուգել** with no sources. Structural checks pass; content checks show **Չի ստուգվել** with the reason (filter **Չստուգված**).
4. In **Աղբյուրներ**, tick the two FIXTURE sources, click **Պահպանել ընտրությունը**, then **Ստուգել**. Question 2 shows **Խնդիր** with evidence (source, version, page 12). Click it: the document highlights the question, its options and the `2-գ` key entry.
5. Click **Առաջարկել ուղղումներ**, then **Մերժել առաջարկը**. The failure stays. Propose again, then **Ընդունել ուղղումը**: the key becomes `2-ա` and both questions keyed on that line are re-checked.
6. Reload: same revision, sources and decisions. Download the corrected DOCX, the original and the report from **Արտահանում**. **Չեղարկել վերջին ուղղումը** restores the previous revision.

## 1. Implemented and verified

- **Deterministic fixture E2E in the real UI** (`scripts/e2e-review.mjs`, log in `docs/e2e/e2e-log.txt`):
  - upload → proposed structure → teacher correction → no-source checks (structural only) → sources → checks;
  - the finding highlights exactly the question's spans;
  - keyboard selection and jump to the document, and Tab reaches accept then decline;
  - reject leaves the check failed;
  - accept of the key fix, with re-check of the dependent items only. **Correction (second pass):** that fix was ONE text patch (the key line `2-գ` → `2-ա`) plus a structured `keyChange` in the review; the question text was not edited. A two-patch question + key group was not exercised by this run; it is covered by tests (see `docs/e2e/README.md`);
  - a stale or repeated decision gets **HTTP 409**;
  - reload restores the state;
  - three downloads;
  - 0px horizontal overflow at 1440 / 1024 / 390 and at 200% zoom;
  - the drawer closes with Escape and focus returns.
- **Downloaded files inspected** (`docs/e2e/inspection.txt`):
  - the original download is byte-identical to the upload (sha256 `5167fb30…`);
  - in the corrected copy exactly one paragraph changed (`1-ա, 2-գ` → `1-ա, 2-ա`), only `word/document.xml` differs, and only in that one `w:t`;
  - list numbering is unchanged;
  - the report's corrected-copy hash equals the download header (`58cc0b0e…`), and it was identical across three runs (deterministic export).
- **Unit and integration tests: 35 files, 388 tests passing** (`npm test`); `tsc --noEmit` clean; `vite build` OK. The tests cover:
  - no-op exact bytes, untouched parts, split runs and the formatting policy, lists, table cells, XML escaping, whitespace, Armenian / surrogate / combining characters, protected content;
  - malformed or unsafe zip and XML, duplicates and paths, entry and decompression limits, `.doc`, `.docm`, `.dotx`;
  - stale and overlapping patches, the same text in two places, atomic linked groups, double submit, a concurrent check, a late result after a source change, undo, reload, a rejected proposal staying unresolved, no key text inserted;
  - no sources, demo and unconfirmed sources, wrong subject or grade, changed source, unsupported and multi-select types, ambiguous splits, model failure and retry, result reuse;
  - audit redaction, embedding audit, MCP strings, calendar, consolidation.
- **HTTP-level checks on :3000:**
  - consolidation `{}` → 400, unknown period or template → 400;
  - a malformed academic year → 400, and a valid one is stored with a manual-confirmation record;
  - a plan with a calendar of unknown provenance → calendar check `notEvaluated`, hours check still runs.
- **Live provider smoke test (separate from the fixture E2E):** one real split call on the synthetic file, `google/gemini-3.5-flash` via OpenRouter, 14.5 s. It found 2 single-choice questions with 3 options each and the key 1-ա, 2-գ, with 0 dropped parts. Its audit entry holds only hashes.
- **Screenshots** (fixture state, labelled FIXTURE in the UI):
  - before: `docs/screenshots/before/`;
  - after: `docs/screenshots/after/` (01–14 flow; 10–13 responsive and zoom);
  - other screens at 1440 and 390: `docs/screenshots/after/screens/` (demo data).

## 2. Implemented but not verified

- **Real Word layout:** `scripts/docx-layout-check.ts` (Word or LibreOffice → PDF → pagination compare) was not run tonight. It opens Microsoft Word through AppleScript, which can stop on a macOS automation permission prompt while nobody is there. The preview is labelled as not being a Word rendering. **Visual layout QA in Word: blocked (needs a person at the machine).**
- **The live provider beyond splitting:** checks, fixes and re-checks with a real model have not run. They need confirmed real sources; the dev store has only demo sources, which cannot be confirmed.
- **Screen readers:** no VoiceOver or NVDA pass. The live region, labels and roles are in place but unheard.
- **Armenian wording:** no fluent reviewer yet. Linguistic QA is pending, as is Russian and English wording review.
- **Browsers:** only Chrome was tested.
- **Old records:** the backward-compatibility loading of old review records (missing `version`, `runs`, `atGroupCount`, `'stale'` proposals) is implemented in `reviewService.load()` but not covered by a dedicated test.

## 3. Blocked (external) — smallest next action

| Gate | Blocker | Smallest next action |
|---|---|---|
| Real teacher files | None supplied | Get 2–3 anonymised teacher DOCX files; run the smoke scenario on :3000 with a real provider |
| Real sources | Program / standard / textbook not supplied | Upload them in **Registry**, extract and confirm outcomes, confirm each version (Registry → «Հաստատել vN») |
| Real Word layout | Needs a person present for Word automation | `npx tsx scripts/docx-layout-check.ts original.docx corrected.docx` and open the PDFs |
| Linguistic QA | Needs a fluent Armenian reviewer | Review `src/i18n/translations.ts` (`shell`, `home`, `materialReview`, `reports`) and the server messages in `server/materials/*` |
| Provider budget | The key's limit is low (it could not afford a 65,536-token reservation) | Nothing needed for tonight's scale; `OPENROUTER_MAX_TOKENS` bounds a request |

**Pilot readiness: NOT ready.** Synthetic files, fixture sources and the rule-based fixture provider do not close the real-teacher, real-source or real-Word gates.

## 4. Not in scope (to avoid misunderstanding)

OCR, PDF and scans, tracked-changes export, a separate key file, authentication and multi-tenant isolation (there is none; confirmation names are stated names, not identities), dark mode, and production migration.

## Schema and migration notes (backward compatible, local JSON store)

- `Source.confirmation?` — absent on existing sources, which means **unconfirmed**. It is valid only while `version` and `sourceContentHash` still match. Demo sources are never confirmable.
- `MaterialReview`:
  - new `version`, `runs`, `noStudentDataDeclaration?`, and `segmentation.atGroupCount`;
  - proposal status `'stale'` is renamed `'superseded'`.
  - `load()` upgrades old records: `version` 0, empty `runs`, `atGroupCount` = the current group count (old records stored spans already in current coordinates), `stale` → `superseded`, and runs left `running` for more than 30 minutes → `failed`.
- `MaterialItem.stemSpans?`, `MaterialCheck.executionError?`, `MaterialItemResult.inputHash?/checkedAt?`, `MaterialSuggestion.keyChange?/keyBefore?`, `ModelCallInfo.latencyMs?/inputHash?`, and the new check id `question_type` — all optional.
- `ThematicPlan.calendar` can now be `null`, and carries `source` (`user_confirmed` | `demo`) and `confirmedAt`. Plans stored earlier with the hard-coded 16+18 weeks have no `source`, so their calendar check reports **not evaluated** (intended). `validationNotEvaluated?` is new. The demo seed marks its calendar `demo`; this applies to newly seeded stores. The existing local `data/` store keeps its old plan until "Reset demo data".
- `ReportInstance.manualConfirmations?` is new.
- Env: `TEACHFLOW_DATA_DIR`, `PORT`, `TEACHFLOW_FIXTURE_MODE`, `MODEL_PROVIDER=fixture` (refused unless fixture mode, a separate data directory and not production), and `OPENROUTER_MAX_TOKENS`.
- Files: uploaded DOCX files live in `data/material-files/<sha256>.docx`; the fixture store is in `.fixture-data/`. Both are git-ignored.

## Side effects on the local dev store (`data/`, demo data only)

- One consolidated draft report was created while reproducing the consolidation bug (an empty request at HEAD produced a report).
- One demo report's academic year changed 2026-2027 → 2025-2026 (with a manual-confirmation record) while testing the new endpoint.
- Audit log: one entry from before the redaction fix (01:30 UTC) contains the synthetic test's prompt text. It is not real data.
- "Reset demo data" (sidebar) restores all of these.

## Known issues found overnight — fixed in the second pass

- The generator's validator: the seeded deterministic rules were never evaluated (wrong rule ids) → fixed in `8dee294`.
- EMIS export: invented confidence `1.0` and provenance "System recorded" → fixed in `d9354ab`.
- Source supersede: invented version and date, old chunks kept, demo flag lost → fixed in `e46a92b`.
- Still open: the pinned context in `App.tsx` starts with demo values (program version `demo-v1`, year `2026-2027`, demo school); they are shown as demo in the shell.

## Final state

- Branch `claude/docx-material-fix`, pushed to `origin` (new remote branch). Code HEAD at push: `f070ea8ab555b78937ed7703f6d1c35525a4f0a9`; this note is the only later commit.
- `main` untouched, nothing merged, no force push.
- **Deployment:** see "Second pass" below. Verified through GitHub deployment records: Preview, not production.
- Final checks at `f070ea8`: `tsc --noEmit` clean; `npm test` 35 files / 388 tests passing; `vite build` OK; fixture E2E OK.

## Second pass (reliability fixes, no new features)

Commits: `3b75159` (next-pass file), `8dee294`, `d9354ab`, `e46a92b`, `5033129`, `7ff35bb`, plus this documentation commit.

1. **Generator validator (`8dee294`).** The seed defines `rule-single-correct-answer` (minOptions/maxOptions) and `rule-factual-grounding` (minCitations), but the validator only knew `rule-min-options`, `rule-allowed-item-types` and `rule-max-items`. Both seeded rules were skipped without a trace, while `methodRulesApplied` listed every active rule.
   - Now: evaluators for both seeded rules, and every evaluated rule leaves a check.
   - An active rule with no evaluator or with bad parameters gives a visible "not checked" and appears in `methodRulesNotEvaluated`; there is no default of 3.
   - Guarded by tests through `validateAllItems` with the real seed (`getDemoRules()`); the four new tests fail on the old validator.
2. **EMIS export (`d9354ab`).** An empty cell means unknown / not recorded, stated in every file's header.
   - No `1.0`, no `0`, no "System recorded", no "null" or "undefined".
   - The plan export no longer writes untaught hours as `0`. A recorded `0` stays `0`.
3. **Source supersede (`e46a92b`).**
   - The version and effective date are stated by the person, with the same rules as a new upload, or the request gets a 400. The internal revision id and upload time are system facts.
   - New text is really used; without new text the old chunks, pages and file hash are carried over.
   - The demo flag is inherited, and the confirmation is dropped.
   - The old record gets `supersededAt` / `supersededBy` instead of an invented `effectiveTo`.
   - Dependent material-review results go stale when a selected source is superseded, changed or unconfirmed. This test also exposed and fixed a reuse bug: an old passing result used to be reused after the source was superseded.
   - Verified over HTTP: missing particulars → 400, source count unchanged. A successful supersede was **not** run against the local data, to preserve it.
4. **Output-token limit (`5033129`).**
   - `OPENROUTER_MAX_TOKENS`: unset → 8192; an invalid value → a configuration error on every call, before any request.
   - A response cut at the limit is refused (`finish_reason: length` / native `MAX_TOKENS`; Gemini `MAX_TOKENS`, including the judge), even when the cut text parses as JSON, with no retry.
5. **DOCX evidence (`7ff35bb`).** `docs/e2e/proposals.txt` and `docs/e2e/README.md` record, from the actual data, that each fixture proposal was one key-line patch plus a structured key change. New review-level tests cover the atomic question + key group: both edits apply; a failing second edit applies neither; a teacher edit still applies both.
6. **Vercel deployment (read-only, GitHub deployment records written by `vercel[bot]`):**
   - `f070ea8`: deployment 6628798751, environment **Preview**, `production_environment: false`, https://teachflow-20-c5baajssm-mentaliser21-4868s-projects.vercel.app.
   - `33662bc`: deployment 6628811537, **Preview**, `production_environment: false`, https://teachflow-20-8icywloiz-mentaliser21-4868s-projects.vercel.app.
   - Both commits are only on `claude/docx-material-fix`. All 29 recorded deployments of this repository are Preview; none is Production.
   - The URLs answer 302, most likely Vercel's access protection. This is the view Vercel reports into GitHub, not the Vercel API itself; no Vercel CLI was used, and nothing was redeployed or changed.

Checks at the end of the second pass: `tsc --noEmit` clean; `npm test` 37 files / 413 tests passing; `vite build` OK; fixture E2E reran and passed (review `mat-muf7ma19-cae75d`, same single key-line change, original = upload, only `word/document.xml` differs).

Kept separate and unchanged in status:
- the synthetic fixture E2E (passes);
- live model splitting (one call, synthetic file, overnight);
- content checks on real sources (not done: no real sources);
- the Microsoft Word layout check (not done: needs a person at the machine).

## Third pass — independent review of 21569c8 (R1–R3, demo context)

Review package: `TeachFlow_Review_21569c8.zip` (REVIEW.md, reproduce.patch). All four REPRO scenarios reproduced on `21569c8` before any change (4 passed = the defects were present).

| Finding | Fix | Commit |
|---|---|---|
| R3 — a failed LLM rule-judge call was listed as an applied rule | LLM rules count as applied only after a validated verdict (pass or fail); failed calls go to `methodRulesNotEvaluated` and keep their visible error | `472dbf3` |
| R1 — a proposal based on a superseded, changed or unconfirmed source could still be accepted (old tab or API) | Dependency contract (below); `decide(accept)` requires the proposal's basis to be the current fresh result, otherwise 409 with no document change | `2daed04` |
| R2 — a changed or disabled method rule left a review "final"; an ordinary check skipped it | Same contract: the fingerprint is compared on every load, before choosing what to re-check and before status, export and report | `2daed04` |
| Demo context flowed into real plan creation (`demo-v1`, `2026-2027`) | Program version and year are typed for each plan (form and chat chip); a plan for a demo school is stored and shown with `isDemoContext` and marked in its EMIS export. There is no real-school registry, and none was invented | `a2d26a6` |

**Dependency contract.** Each check result stores a fingerprint of the review-wide dependencies it used:
- the selected sources, and whether each is still usable (confirmed, active, unchanged);
- the confirmed outcomes of the selected program;
- the option-count rule's state and parameters;
- the prompt versions.

On every load, a result whose fingerprint differs (or that has none) becomes stale, and the proposals built on it are superseded. A check run that finishes after the dependencies changed is discarded. Reuse of results with identical inputs is unchanged; this is tested with no new model calls.

**Regression tests.** The reviewer's REPRO tests became tests of the safe behaviour:
- 7 new review-level tests fail on `21569c8`: source superseded or confirmation revoked between proposal and accept, a fresh proposal needed after re-check, minOptions raised, rule switched off, a confirmed outcome changed, the change report following.
- The R3 test fails on the previous validator.
- A new test checks that a successful "fail" verdict still counts as applied.

**UI evidence** (disposable fixture environment, synthetic data, `scripts/ui-supersede-check.mjs`, `docs/review-21569c8/`):
- a finished review is set up through the API;
- the FACT source is replaced **through the Registry dialog in Chrome** (the version field starts empty; confirm is disabled until version and date are given);
- result: the old source is `superseded` with no invented `effectiveTo`; the new version `fixture-2` uses the new text and is `unconfirmed`;
- the old review is 3/3 stale, `final=false`, and its proposal `superseded`; an old-tab accept gets **409** with the revision unchanged and 0 accepted groups;
- the review page shows stale and draft;
- the plan form starts with empty text fields, its submit is disabled, and the demo-school note is shown.

**Checks:**
- `tsc --noEmit` clean; `npm test` 37 files / **425** tests passing; `vite build` OK.
- The fixture E2E reran and passed. The log now states exactly "1 text patch + structured keyChange" for the accepted fix.
- One E2E run was slow to close headless Chrome; it finished with "E2E OK", and no Chrome process was left.

**Not changed and still open:**
- the real-school registry;
- content checks on real sources;
- the Microsoft Word layout check;
- Armenian linguistic QA;
- live-model runs beyond the one splitting call.

**The pilot is not ready.**

## Fourth pass — review of 963fb4b (dependency race during a check)

Finding (reproduced on `963fb4b` with the reviewer's `reproduce-race.patch`, 2 passed = bug present):
- `checkItem` ran the rule checks before waiting on retrieval or the model, but stamped `inputHash` and `dependencyFingerprint` afterwards from the live repository.
- The commit compared `runContext(r)` against `runContext(snapshot)`, and both read the live rules.
- So a rule change during the wait left the old rule's result as a fresh pass, and the next ordinary check skipped it.

Fix:
- `runChecks` captures the run context and dependency fingerprint once, under the lock, before any await. Results are stamped with the captured values; the input hash is computed before the first await.
- At commit, the document is loaded first. Then, synchronously and with nothing between the comparison and `save()` in this single-process server, the live context is compared with the captured one.
- On a mismatch the run is `obsolete` and nothing is published as current; earlier results are left stale by the load-time contract.
- No lock is held during model calls.

Regression tests (the reviewer's scenarios, now asserting the safe behaviour):
- threshold raised during the wait, and rule switched off during the wait: run obsolete, no fresh result, and the next ordinary check re-runs the question (`fail` / `not_evaluated`);
- earlier fresh results plus a change during a re-run: all stale, not final;
- source superseded during the wait: obsolete, nothing current. This also failed on `963fb4b`: the same race existed for sources;
- unchanged inputs: the run succeeds and reuse still makes no new model calls.

Four of these fail on `963fb4b`.

Checks: `tsc --noEmit` clean; `npm test` 37 files / **430** passing; `vite build` OK; fixture E2E passes (single key-line change, only `word/document.xml` differs).

Unchanged gates: no real sources, no real teacher DOCX, no Word layout check, no Armenian linguistic QA, no live-model content checks. **The pilot is not ready.**

## Pilot Readiness Sprint

Branch `claude/pilot-readiness-harness`, from `6fc0159`. Full handoff:
`docs/pilot-readiness-handoff.md`. How to run a case: `docs/pilot-runbook.md`.
Invariants and how they are enforced: `docs/engineering-invariants.md`.

- **Harness.** `npm run pilot -- init|preflight|run|serve|evidence|status`
  runs one teacher scenario through the application's own code in a
  per-case store (`pilot-private/`, git-ignored, with no demo content).
  It stops with explicit states at every human step and writes immutable
  evidence bundles:
  - provenance and audited calls;
  - hashes instead of text;
  - a deterministic export with DOCX diagnostics;
  - the human QA sheets;
  - a secret scan and `SHA256SUMS`.
- **Bugs fixed, each with a regression test:**
  - late split overwriting teacher structure work (`f6f4754`);
  - FIXTURE mode calling Gemini embeddings;
  - truncation errors without token usage;
  - demo data seeded into pilot stores;
  - preflight repeating detected personal data;
  - premature `EXPORT_FAILED` at human steps.
- **Real-model smoke (synthetic):** `MODEL_FAILED`. Segmentation was cut
  off at 8192 tokens, 7862 of them reasoning, with
  `google/gemini-3.5-flash`. This must be resolved before a real pilot.
- **Checks:**
  - `tsc` clean;
  - `npm test` 41 files / **484** passing;
  - `vite build` OK;
  - fixture E2E `E2E OK`;
  - synthetic pilot CLI run `TECHNICAL_RUN_COMPLETE`.
- The frozen benchmark SHA `c3d4abb7…` is not in this repository and was
  not touched. This branch is the current pilot candidate, not the
  benchmark build.

Unchanged gates: no real sources, no real teacher DOCX, no Word layout
check, no Armenian linguistic QA, no successful real-model run.
**NOT DEPLOYED TO PRODUCTION.** The pilot is not ready. The harness to run
it is.

### Pilot Readiness Sprint: final piece

- Thinking level per operation (splitting `minimal`, checks and judge
  `low`, fixes `medium`).
- Tokens and cost of every call are recorded in the evidence.
- Explicit `SEMANTIC_RETRIEVAL` state. Embeddings run through OpenRouter,
  the same Google model; the Gemini key in `.env` is invalid.
- Real-model synthetic pilot: `TECHNICAL_RUN_COMPLETE` for $0.095. Splitting
  works: 710 output tokens, 0 reasoning. Retrieval is `GOOGLE_EMBEDDINGS`.
- The real model miscopied an Armenian option at both `minimal` and `low`.
  Now fixed: a single-option paragraph is taken from the document. Covered
  by tests; not re-verified on the model, because the OpenRouter key has
  used its $2 limit.
- `npm test` 504 passing. Details: `docs/pilot-readiness-handoff.md`
  ("Final piece"). **NOT DEPLOYED TO PRODUCTION.**

