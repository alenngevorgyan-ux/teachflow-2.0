# Overnight progress — TeachFlow review flow + Armenian-first redesign

Brief: `TeachFlow_Night_Build/MASTER_PROMPT.md` (supplied zip, 2026-09-24). Full report: `docs/overnight-handoff.md`.

## Baseline (verified at start)
- Branch `claude/docx-material-fix`, HEAD `6423a6160e2e21aa0acc670679f96b3d7641f6e9`, clean except untracked `.claude/`.
- Remote `origin` = github.com/alenngevorgyan-ux/teachflow-2.0, default branch `main`; `vercel.json` has no production-branch setting; this branch is not `main`.
- `tsc` OK; `npm test` 32 files / 360 tests; `vite build` OK. Before screenshots show 596px horizontal overflow at 390px.

## Done
1. Correctness: lock + version, run records, late-result discard, span anchoring + undo, proposal revisions, key-only fixes, input-hash reuse, retry, formatting policy, exact no-op export, original download, shared-paragraph spans, teacher split edits, type rules, declaration, audit redaction, FIXTURE environment (`fed0f0f`).
2. E2E-found fixes (`be8c6fa`).
3. Design system, shell, Home, review UI, fixture tooling, E2E evidence (`a59d0a9`).
4. Historical debts (`06c2297`).
5. Other screens (`9d73560`).
6. OpenRouter max_tokens and live smoke (`504d600`).
7. Docs: handoff, design notes, TASKS.md.

## Active step
Done. Only the external gates remain (see the handoff §3).

## Next exact action (for whoever continues)
Upload the real subject program and textbook in Registry, confirm them, and run the smoke scenario on :3000 with 2–3 real teacher DOCX files; then run `scripts/docx-layout-check.ts` with Word.

## Blockers
- Real sources and real teacher DOCX: not supplied.
- Word layout run: needs a person present (macOS automation prompt).
- Armenian linguistic QA: needs a fluent reviewer.
