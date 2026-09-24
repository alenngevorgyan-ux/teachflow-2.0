# Overnight progress — TeachFlow review flow + Armenian-first redesign

Brief: `TeachFlow_Night_Build/MASTER_PROMPT.md` (supplied zip, 2026-09-24).

## Baseline (verified at start)
- Branch `claude/docx-material-fix`, HEAD `6423a6160e2e21aa0acc670679f96b3d7641f6e9`, clean except untracked `.claude/`.
- Remote `origin` = github.com/alenngevorgyan-ux/teachflow-2.0, default branch `main`. `vercel.json` has no production-branch setting; this feature branch is not `main`.
- `npx tsc --noEmit` OK; `npm test` 32 files / 360 tests pass; `vite build` OK. `npm run lint` = `tsc --noEmit`.
- Before screenshots: `docs/screenshots/before/` (1440, 1024, 390). At 390px the page overflows horizontally by 596px.
- Live model: OpenRouter key has no credits (seen 2026-09-24). No real sources, no real teacher DOCX.

## Plan (short)
1. P0/P1 correctness: per-review mutation lock + optimistic version; run records (pending/running/succeeded/failed/obsolete) with input hashes; late results discarded; spans stored in segmentation coordinates and mapped through accepted groups (enables undo); undo; question-type rules; formatting policy for cross-run edits; no-op export = original bytes; original download; declaration for uninspected content; no document text in audit logs; result reuse by input hash; teacher segmentation edits (validated); unassigned material listed; proposal states proposed/accepted/rejected/superseded.
2. Deterministic FIXTURE environment (separate data dir, fixture provider, labelled everywhere) for the E2E UI run.
3. P2 design system: tokens, locally bundled Noto Sans Armenian, AppShell with left nav, review workbench with stages, findings panel, filters, evidence, diff, export summary; translations.
4. P3 debts: consolidation defaults, calendar assumptions, embedding audit, MCP trimming, academic-year manual confirmation.
5. Visual migration of other main screens via shared tokens/components.
6. Verification: tests, build, puppeteer E2E (download + inspect DOCX), screenshots 1440/1024/390 + 200% zoom, docs, commits, push (feature branch only).

## Log
- (start) Baseline recorded, before screenshots captured, puppeteer-core added as dev dependency (drives the installed Google Chrome; no browser download).

## Active step
P0/P1 correctness work in `server/materials/*`.

## Blockers
- Live provider: no credits (cannot top up — not authorised).
- Real sources / real teacher DOCX: not supplied.
