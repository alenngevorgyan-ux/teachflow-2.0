# TeachFlow — curriculum connector for AI in Armenian schools

> **TeachFlow prototype — not an official system of any state body.**
> All bundled data is synthetic and labelled `DEMO DATA`. Report forms are drafts, not confirmed forms.

Armenian public schools get ChatGPT Edu from the 2026–2027 school year. A general AI can write a test or a lesson plan, but it cannot prove that the result follows the **official standard, the right program version, approved sources and methodological rules**. TeachFlow adds that proof layer:

- **Registry** of sources (standard, subject programs, textbooks, methodological guides) with version, effective dates, role (`FACT` / `METHOD` / `TEMPLATE`), status and SHA-256 hash.
- **Engine**: retrieval → coverage gate (refuses when sources are insufficient) → generation with verbatim citations → independent validation of every item → variant equivalence → per-item trace.
- **Validate material** made in any AI (including ChatGPT Edu) against the same sources and rules.
- **Teacher tools**: chat + canvas workspace, thematic plan, lesson plan, tests with printable answer sheets, auto-grading, reports.
- **Reporting chain**: teacher → director → reviewer, with templates stored as data, automatic review and import of legacy reports.
- **Quality**: side-by-side comparison with a plain-AI baseline scored by the same validator, regression runner, Armenian model evaluation, terminology glossary.
- **Integrations**: MCP server (for ChatGPT Edu apps and other assistants) and CSV export for EMIS.

Generating the content is not the hard part. TeachFlow is only worth using if it can **enforce, detect, prove and regress** better than a well-configured ChatGPT Edu with the same sources.

---

## Quick start

Requirements: Node.js 22+ and npm.

```bash
npm install            # or: npm ci
cp .env.example .env   # then fill in at least one provider (see below)
npm run dev            # API + UI on http://localhost:3000
```

The first start creates `data/teachflow_store.json` from the demo seeds in `server/store/demoData.ts`. The file is gitignored. Delete it, or use **Reset Demo** in the header, to start again from the seeds.

Without an API key the app still starts, and the registry, deterministic checks, grading and report lifecycle all work. Every step that needs a model returns a visible error; nothing is filled in with a guess.

| Command | What it does |
| --- | --- |
| `npm run dev` | Express API + Vite dev middleware on port 3000 |
| `npm test` | Vitest unit tests (`tests/`) |
| `npx tsc --noEmit` / `npm run lint` | Type check |
| `npm run build` | Production frontend build into `dist/` |
| `NODE_ENV=production npm start` | Serve API + built `dist/` |

## Configuration

Environment variables are read from `.env` (via `dotenv`). Copy `.env.example` to get started.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MODEL_PROVIDER` | no (default `gemini`) | `gemini` or `openrouter`. This is an explicit choice: the app never falls back from one provider to another. |
| `GEMINI_API_KEY` | for `gemini`, and see below | Direct Gemini API. |
| `OPENROUTER_API_KEY` | for `openrouter` | OpenRouter (OpenAI-compatible). |
| `OPENROUTER_MODEL_ID` | for `openrouter` | Exact model id from openrouter.ai/models. There is no default. |
| `OPENROUTER_JUDGE_MODEL_ID` | no | Separate judge model. Defaults to `OPENROUTER_MODEL_ID`. |
| `OPENROUTER_JEV_API_KEY` | no | Optional TypeSafe Jev judge (OpenRouter Decisions API). It needs its own key and never falls back to the general one. |
| `JEV_MODEL_ID` | no | Defaults to `~typesafe/jev-latest`. |
| `DISABLE_HMR` | no | `true` disables Vite HMR and file watching. |

Features that need **`GEMINI_API_KEY` whatever `MODEL_PROVIDER` is set to**:
- embeddings for retrieval (`gemini-embedding-001`). Without the key, retrieval uses keyword scoring only.
- OCR of scanned PDF pages
- reading answer-sheet photos (vision)

The Gemini generation, judge, OCR and vision model id is hardcoded as `gemini-3.8-flash` in `server/providers/`. Every model call records the provider and the exact model id that was actually used.

`OPENAI_API_KEY` belongs to a stub provider (`OpenAIProviderStub`). That provider always throws and is not a working integration.

## Deployment (Vercel)

`vercel.json` builds the frontend with `vite build`, installs with `npm ci`, and routes `/api/*`, `/mcp` and `/sse` to the serverless function in `api/index.ts`.

**The store is not persistent on Vercel.** It is written to `/tmp/teachflow-data`, which is per instance and wiped on cold start. Every cold start re-seeds the demo data. Anything created in production (uploaded sources, reports, eval runs) can disappear at any time.

## Architecture

```
src/                React 19 + Tailwind UI, one page per module (src/pages/)
  i18n/             hy / ru / en strings (Armenian first, reformed orthography)
server.ts           Express entry: /api, /mcp, /sse, Vite or static dist/
api/index.ts        Same app as a Vercel serverless function
server/
  api/routes.ts     REST API
  mcp/index.ts      MCP server: Streamable HTTP at /mcp (stateless), SSE at /sse
  pipeline/         the engine (see below)
  providers/        model, judge, embedding, OCR and vision providers
  prompts/*.vN.txt  versioned prompts; the prompt version is part of policyVersion
  store/            JSON-file repository + demo seeds
shared/             types and zod schemas shared by server and UI
tests/              vitest unit tests
```

The main modules in `server/pipeline/`:

| Module | Role |
| --- | --- |
| `outcomeExtractor` | Extracts outcomes from a standard/program. A code is saved only if it appears in the source (never invented or numbered), the description must be verbatim, and confirmed outcomes are never overwritten; saved outcomes are unconfirmed until a methodologist confirms them |
| `retrieval` | Top-K FACT / METHOD chunks, hybrid of embedding similarity and keyword score |
| `coverage` | Coverage gate: refuses to generate when the sources do not cover the topic |
| `generator`, `orchestrator` | Item generation with verbatim citations, and the full pipeline |
| `validator` | Per-item checks: quote is verbatim, claim is supported by the cited FACT chunk, FACT vs METHOD use, language, rules |
| `equivalence` | Variant A/B equivalence |
| `materialValidator` | Validate pasted/external material |
| `compare` | Side-by-side against a plain-AI baseline; baseline citations are resolved to real chunks and scored by the same validator |
| `regression` | Frozen tasks, re-run and diff |
| `thematicPlanGenerator`, `lessonPlanGenerator` | Structured generation from confirmed outcomes and FACT chunks, then deterministic checks |
| `answerSheetScanner`, `answerSheetQr`, `autoGrader` | QR decode, vision reading, deterministic grading, item analysis |
| `reportReviewer`, `legacyReportImporter` | Report checks; legacy import with verbatim-quote verification of each extracted value |
| `armenianEvalHarness` | Armenian model evaluation: raw outputs, strict scoring, per-category model recommendations |
| `privacyGuard` | Blocks student PII on every write path (see below) |
| `emisAdapter` | CSV export for EMIS / the electronic journal |
| `normalization` | Armenian-aware normalization (։ ՝ ՛ « », և/եւ, apostrophes, case, whitespace) |

**`policyVersion`** is a 16-character SHA-256 prefix over the active rules (id, kind, params), the active source versions and a list of prompt versions. It is attached to generated artifacts and MCP tool results, so an output can be traced to the policy it was produced under. The prompt-version list is a hardcoded string in `repository.computePolicyVersion()` that covers only the core generation and validation prompts (coverage, generation, claim, language, rule, equivalence). Editing a prompt file does not change `policyVersion` unless that string is updated too.

**MCP tools**: `search_curriculum`, `get_source_fragment`, `generate_assessment_with_trace`, `validate_material`, `thematic_plan_generate`, `thematic_plan_validate`, `lesson_plan_generate`, `answer_sheet_grade`, `report_review`, `legacy_report_extract`, `emis_export`, `armenian_eval_run`.

## Rules the code enforces

- **Never fabricate.** No default values, confidences, outcome codes, statistics or model ids. A missing value stays `null` and goes to manual confirmation.
- **Deterministic checks can fail.** Data is never adjusted to make a check pass.
- **Every model call is visible.** Provider and model id are recorded and errors are shown in the UI.
- **AI assists, humans decide.** Nothing is auto-approved, auto-submitted or auto-signed. A test becomes `ready_for_classroom` only when every item passes or its warnings are explicitly accepted, and this is enforced on the server.
- **No student personal data.** Only anonymous student codes (`7B-14`) are allowed. `privacyGuard` runs on material validation, legacy import, chat, report fields and comments, plan and item edits, and student codes. Violations return HTTP 422.
  - E-mails and phone numbers are always blocked.
  - A first name + surname is blocked only near a student marker: a student code, a class label, the word "student", or a phone/e-mail. Historical names in teaching content («Տիգրան Մեծ») pass.
  - Answer-sheet images are deleted after the teacher confirms.
- **No teacher surveillance.** There are no rankings or risk scores. Directors see only report status per teacher.

## Honest status

### Real (backed by a model call or a deterministic check, with tests)
- Outcome extraction from standards and programs. Codes and descriptions are checked verbatim against the source, and everything waits for methodologist confirmation.
- Registry with versions, roles, effective dates and hashes. Upload of PDF (per page, with OCR fallback for scanned pages), DOCX and TXT.
- Retrieval (top-K, embeddings + keywords) and the coverage gate.
- Generation with citations and per-item validation: verbatim quote, claim support, FACT/METHOD roles, language judge, method rules, variant equivalence, trace.
- Validation of external material.
- Side-by-side comparison. The baseline gets the same sources and is scored by the same validator; baseline errors are reported as errors, not as refusals.
- Thematic plan and lesson plan generation, with deterministic plan checks (hours, mandatory outcomes, holidays).
- Workspace chat: a structured intent parse, then confirmation chips before any action.
- Answer sheets: server-side QR decode, vision reading with per-field confidence, deterministic grading, item analysis.
- Legacy report import. Every extracted value must quote the source text verbatim; if the model fails, the error is shown.
- Armenian eval harness: wrong answers and forbidden forms score 0, raw outputs are shown.
- MCP over Streamable HTTP and SSE.

### Demo, draft or partial
- **All data is synthetic** (`DEMO DATA`): sources, outcome codes (prefixed `DEMO-`), schools, reports, glossary entries.
- **Report templates are drafts**, not forms confirmed by schools or authorities. EMIS export is plain CSV in a format we chose; the real EMIS formats are unknown.
- **Dashboards page** shows hand-written illustrative numbers. It is labelled DEMO DATA and is not computed from the store.
- **Report review** (`reportReviewer`) evaluates the rules of the bundled draft templates deterministically. Any other rule, and every `llm_judged` rule, is reported as **not evaluated** and needs manual review, and a missing value is never treated as 0. The rules themselves come from draft templates, including the reading of «15% or 4 hours» (exceeding either one fails), and need confirmation by real schools.
- **Compare / eval quality depends on the model.** The comparison and the eval are only as good as the configured model and judge, and there are no published benchmark results yet.

- **`policyVersion` covers only part of the prompts.** It includes 6 of the 14 prompt files, through a hardcoded list (see Architecture).

### Not there
- **No authentication or authorization.** The role switcher in the header is a UI view selector. Anyone who can reach the API can call every endpoint, including destructive ones such as `/api/system/reset-demo`. Do not expose a deployment with real data.
- No database. The store is a single JSON file, with no concurrency control and no persistence on Vercel.
- No real curriculum content is bundled. Textbook text can only be ingested with the rights holder's permission (standards and programs, as official acts, can be ingested).
- Not published as a ChatGPT Edu app, and no EMIS integration beyond file export.

See [`TASKS.md`](TASKS.md) for the backlog and [`CLAUDE.md`](CLAUDE.md) for the rules contributors follow.
