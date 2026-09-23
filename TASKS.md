# TASKS — TeachFlow backlog (prioritized)

Status legend: [ ] todo, [x] done (only when committed and verified).

Already merged into this base (from the interrupted AI Studio session): default confidences removed in validator/autoGrader/routes/types; legacy import rewritten to Gemini structured extraction with verbatim-quote verification; review summary states only what was checked; README stub.

## P0 — Demo-critical and honesty (before the KTAK meeting, Fri 25.09.2026)

- [x] **T0. Test harness.** Add vitest; `npm test` script. Unit tests for `normalizeArmenianText` / `isQuoteVerbatimInChunk` (։ ՝ ՛ « » apostrophes, case, whitespace, line breaks, և/եւ), deterministic validator checks, grading, thematic-plan checks.
- [x] **T1. Compare fairness.** In `compare.ts`, resolve every baseline citation to a real chunk: verbatim match via `isQuoteVerbatimInChunk`, else normalized token overlap ≥ 0.8; assign real chunkId/page, then run the same validator. Unlocatable quote → `quote_verbatim` fail but still judge `claim_supported` against best-matching FACT chunk. Baseline model error = `ERROR` (not refusal). Refusal detected by a separate structured call. Compute `machineReadableTrace` instead of hardcoding. Test: a hand-written baseline output with correct quotes and no chunk ids can PASS.
- [x] **T2. Validator completeness.** `claim_supported` for every FACT citation (worst wins); language-check and llm-rule judge errors produce visible check results; enforce `rule-max-items` per variant; trace `modelId` = model id returned by generation.
- [x] **T3. Server-side status enforcement.** `ready_for_classroom` only if all items PASS, or WARN with explicit `acceptedWarnings`; clients cannot set `validated`.
- [x] **T4. Legacy import: surface model failure.** If the extraction call fails, return a visible error state for the import (not a silent all-null report).
- [x] **T5. SIMULATED badges.** Every module that runs without a real model call shows `SIMULATED` until its task below is done.
- [x] **T6. Honest thematic plan.** Remove the hardcoded history-7 topics and the "Թեմա N" placeholder generator. Generate grouping/sequence with a structured Gemini call using only confirmed outcomes and FACT chunks; refuse when no confirmed outcomes exist. Remove the last-row hours adjustment. Implement the real holiday check. Move demo "taught" marks into demo seeding. Tests for each deterministic check, including that a wrong total fails.

## P1 — Make the core real

- [x] **T7. Retrieval.** Top-K (12 FACT / 4 METHOD); Gemini embeddings (verify the current embedding model id) stored per chunk at upload; hybrid score with keywords; coverage gate uses a similarity threshold.
- [x] **T8. Upload.** PDF (per page, real page numbers; scanned pages → Gemini OCR, `ocr: true`), DOCX, TXT; sha256 over file bytes.
- [x] **T9. Workspace chat.** Structured Gemini parse → `{intent, subject, grade, topic, sourceHints}`; resolve against registry; confirmation chips (source title + program version) before any action; no keyword routing; same API functions as other screens.
- [x] **T10. Lesson plan** through the existing pipeline (FACT chunks, citations, validator, trace).
- [x] **T11. Answer-sheet reading.** Gemini vision → `{testId, variant, studentCode, answers[{itemIndex, mark, confidence}]}`; QR decode server-side if feasible; low-confidence fields highlighted; images deleted after confirmation.
- [x] **T12. MCP.** Official SDK `StreamableHTTPServerTransport` at `/mcp` (keep SSE at `/sse`); tools include policyVersion and source versions.

## P2 — Quality and hygiene

- [x] **T13. Armenian eval scoring.** Wrong answer 0, forbidden form 0; show raw outputs; allow per-task-type default model selection by score.
- [ ] **T14. Privacy guard** on every write path (materials, report fields, legacy import, student codes, chat). Flag name+surname only near student codes / class labels / phone / email; do not block historical names in content (e.g. «Տիգրան Մեծ»).
- [ ] **T15. Clean install** without `--legacy-peer-deps`.
- [ ] **T16. Demo data** uses the 2026–2027 academic year; remove invented curriculum codes from demo seeds or label them clearly as fictional.
- [ ] **T17. README**: setup, env, architecture, honest limitations.

## Later (after teacher/KTAK feedback — do not start without confirmation)
- Real report forms from schools → templates.
- ChatGPT Edu app publication (needs workspace admin).
- EMIS export formats (needs KTAK).
- Textbook ingestion (needs rights holder permission).
