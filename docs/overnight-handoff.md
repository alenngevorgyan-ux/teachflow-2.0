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
  - accept of the linked key fix, with re-check of the dependent items only;
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

## Known issues outside tonight's scope (not changed)

- `server/pipeline/validator.ts` (generated items) checks a rule id `rule-min-options` that does not exist in the seeded rules, so its option-count rule never runs.
- `server/pipeline/emisAdapter.ts` fills confidence `1.0` and provenance "System recorded" for fields without them.
- `POST /sources/:id/supersede` invents a version (`<old>-next`) and today's date when none is given.
- The pinned context in `App.tsx` still starts with demo values (program version `demo-v1`, year `2026-2027`, demo school); they are shown as demo in the shell.
