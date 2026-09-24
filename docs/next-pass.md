# Next pass — continuation file

Read together with `docs/overnight-handoff.md`.

## State at the start of this pass
- Branch: `claude/docx-material-fix` (tracks `origin/claude/docx-material-fix`), clean except untracked `.claude/`.
- HEAD: `33662bc5e1780a0ed1b217e97fb6501860f1ba4d` (code last changed in `f070ea8`).
- `main` untouched. The Vercel deployment triggered by the push has an **unverified** environment.

## Task of this pass (reliability fixes + independent-review prep; no new features)
1. [x] The generator's answer checker (`server/pipeline/validator.ts`): the option-count rule uses the nonexistent id `rule-min-options`, so the check never runs. Fix it and add a regression test through the real caller path (`validateSingleItem` / `validateAllItems`).
2. [x] EMIS export (`server/pipeline/emisAdapter.ts`): remove the invented confidence `1.0` and provenance "System recorded". Missing stays unknown (never `0`).
3. [x] Source supersede (`POST /sources/:id/supersede`): remove the invented version `<old>-next` and today's date. Keep the internal revision id, the upload time and the official particulars separate. Verify that a change invalidates the confirmation and the dependent results.
4. [x] `OPENROUTER_MAX_TOKENS`: validate the configuration, detect `finish_reason: length`, and never accept a truncated JSON or an incomplete list.
5. [x] DOCX E2E evidence: document which patches were proposed and accepted and which XML changed. Explain "question + key change together" with the actual data; add a test for an atomic two-patch group if one is missing.
6. [x] Vercel deployment: a read-only check of branch, commit, environment and URL. No redeploy, no settings changes. If it can't be verified: UNVERIFIED.

Rules: do not use "Reset demo data" (preserve user and demo data); small commits; push only if the branch's established behaviour does not produce a production deployment.

## Launch commands
```bash
npm run dev                                             # :3000, normal store data/
rm -rf .fixture-data && TEACHFLOW_DATA_DIR=.fixture-data npx tsx scripts/fixture-env.ts
PORT=3100 TEACHFLOW_DATA_DIR=.fixture-data TEACHFLOW_FIXTURE_MODE=1 MODEL_PROVIDER=fixture DISABLE_HMR=true npx tsx server.ts
node scripts/e2e-review.mjs                             # fixture E2E in Chrome against :3100
npx tsx scripts/inspect-e2e-output.mts                  # inspects docs/e2e/*.docx
node scripts/screens-audit.mjs                          # routes on :3000
npx tsc --noEmit && npm test && npx vite build
```

## Evidence
- Handoff: `docs/overnight-handoff.md`; design: `docs/design-reference-notes.md`; log: `docs/overnight-progress.md`.
- E2E log and downloads: `docs/e2e/` (`e2e-log.txt`, `corrected.docx`, `original.docx`, `changes.txt`, `inspection.txt`).
- Screenshots: `docs/screenshots/before/`, `docs/screenshots/after/` (+ `screens/`).
- Synthetic fixture: `docs/fixtures/Թեստ_Ավարայր_7-րդ դասարան (FIXTURE) v2.docx`.

## Keep these kinds of evidence separate
Synthetic fixture E2E · live model splitting (one call, synthetic file) · content checks on real sources (not done) · Microsoft Word check (not done).

Status: all six done — see the "Second pass" section in `docs/overnight-handoff.md`.
