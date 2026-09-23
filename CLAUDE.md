# TeachFlow — project brief for Claude Code

## What this is
TeachFlow is an Armenian curriculum connector for AI in schools. Armenian public schools get ChatGPT Edu from 2026–2027 (entry via my.emis.am). General AI can generate tests and plans; nobody can prove the output follows the **official Armenian standard, the right program version, approved sources and methodological rules**. TeachFlow does that:

- **Registry** of official sources (standard, subject programs, textbooks, methodological guides) with version, effective dates, role (FACT / METHOD / TEMPLATE), status, hash.
- **Engine**: retrieval → coverage gate (refuse if the source is insufficient) → generation with verbatim citations → **independent validation** of every item → variant equivalence → per-item **trace**.
- **Validate material**: check any material made in any AI (incl. ChatGPT Edu).
- **Teacher tools**: chat + canvas workspace, thematic plan, lesson plan, tests with answer sheets, auto-grading, program progress, one-click reports.
- **Reporting chain**: teacher → director → reviewer (authority), templates as data, automatic review, legacy report import.
- **Quality**: side-by-side compare with a strong ChatGPT baseline, regression runner, Armenian model evaluation, terminology glossary.
- **Integrations**: MCP server (for ChatGPT Edu Apps and other assistants), EMIS export adapter (files only).

The core bet: generation is a commodity. TeachFlow is only valuable if it can **enforce, detect, prove and regress** better than a well-configured ChatGPT Edu with the same sources. The compare screen must stay honest.

## Non-negotiable rules
1. **Never fabricate.** No default values, no default confidence (`?? 0.95` is forbidden), no invented curriculum content, outcome codes, statistics, endpoints or model ids. Missing = `null` / `undefined`, shown as "n/a", routed to manual confirmation.
2. **Deterministic checks must be able to fail.** Never adjust data to make a check pass.
3. **Every model call is visible**: provider + exact model id recorded; no silent fallback between providers; errors surface in the UI.
4. **AI assists, humans decide.** Nothing is auto-approved, auto-submitted or auto-signed.
5. **No student personal data.** Anonymous student codes only (e.g. `7B-14`). No names, contacts, birth dates. Answer-sheet images deleted after confirmation by default.
6. **No teacher surveillance.** No rankings, leaderboards or risk scores about teachers. Directors see only report status per teacher.
7. **Not an official system.** No state emblems or ministry names in the UI chrome. Footer: "TeachFlow prototype — not an official system of any state body".
8. **Templates are data.** Report forms are unconfirmed; every form is a JSON template editable in the UI, marked `DRAFT — form not yet confirmed`.
9. **Demo data is synthetic and labeled `DEMO DATA`.** Anything that runs without a real model call shows a `SIMULATED` badge.
10. **Content rights.** Standards and programs (official acts) can be ingested; textbook texts only with permission. Do not bundle copyrighted textbook text in the repo.

## Stack and commands
- React 19 + Vite + Tailwind (frontend, `src/`), Express + TypeScript via `tsx` (backend, `server/`, entry `server.ts`), shared types/zod schemas in `shared/`.
- AI: `@google/genai` (Gemini direct) or OpenRouter (OpenAI-compatible HTTP), chosen by `MODEL_PROVIDER`. Provider layer: `server/providers/modelProvider.ts`, judges: `server/providers/judgeProvider.ts`.
- Store: JSON file behind `server/store/repository.ts`; demo seeding in `server/store/demoData.ts`.
- Prompts: versioned text files in `server/prompts/*.vN.txt` (prompt version is part of `policyVersion`).
- Install: `npm install` (CI and Vercel: `npm ci`). No `--legacy-peer-deps`.
- Dev: `npm run dev` (serves API + Vite on port 3000). Typecheck: `npx tsc --noEmit`.
- Env: `MODEL_PROVIDER` = `gemini` (default) or `openrouter`. Gemini: `GEMINI_API_KEY`. OpenRouter: `OPENROUTER_API_KEY` + `OPENROUTER_MODEL_ID` (exact id, no default), optional `OPENROUTER_JUDGE_MODEL_ID`. Optional TypeSafe Jev judge (OpenRouter Decisions API, `@openrouter/sdk`): `OPENROUTER_JEV_API_KEY` (own key, no fallback to the general one), `JEV_MODEL_ID` (default `~typesafe/jev-latest`). See `.env.example`.

## Map of the code
- `server/pipeline/`: `retrieval`, `coverage`, `generator`, `validator`, `equivalence`, `orchestrator`, `materialValidator`, `compare`, `regression`, `normalization` (Armenian-aware text normalization), `thematicPlanGenerator`, `lessonPlanGenerator`, `autoGrader`, `reportReviewer`, `legacyReportImporter`, `armenianEvalHarness`, `privacyGuard`, `emisAdapter`.
- `server/api/routes.ts`: REST API. `server/mcp/index.ts`: MCP tools.
- `src/pages/`: one page per module; `src/i18n/translations.ts`: hy / ru / en strings (Armenian primary, reformed orthography).

## Honest status — full version in README.md ("Honest status")
Real: P0–P2 tasks T0–T16 in TASKS.md (registry + upload/OCR, top-K hybrid retrieval, coverage gate, generation + per-item validation, material validation, fair compare, thematic/lesson plans via structured calls, chat with confirmation chips, answer-sheet vision + QR + grading, legacy import with verbatim quotes, strict Armenian eval, MCP Streamable HTTP, privacy guard).
Demo / partial / known gaps: all data synthetic; report templates and EMIS CSV are drafts; Dashboards page is hand-written numbers (labelled DEMO DATA); reportReviewer evaluates only two template rules and marks all others (incl. llm_judged) as passed — known bug; policyVersion hardcodes 6 of 14 prompt versions; no auth (role switcher is UI only); JSON store is not persistent on Vercel.

## How to work in this repo
- Read TASKS.md first; work top-down; one task per commit with a clear message.
- Before saying a task is done: typecheck passes, relevant tests pass, and you ran the flow (or explain why you could not, e.g. no API key).
- Write unit tests for every deterministic check you touch (`npm test` — set up vitest if missing).
- Prefer small, reviewable diffs. Ask before large refactors, new dependencies with heavy footprint, or schema migrations of stored data.
- Keep UI text in `translations.ts`; Armenian first.
- If a requirement is ambiguous, stop and ask rather than invent domain facts (report forms, program content, legal bases are unknown until confirmed by real teachers/authorities).
