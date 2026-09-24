# Pilot runbook

How to run one real teacher scenario through TeachFlow and keep evidence of
what happened. Written for someone who did not build the harness.

The harness does not replace TeachFlow. It runs the application's own code
(source upload, source confirmation, material review, export) in a separate
store for each case. At every step where a person has to decide, it stops
and says so.

## Before the pilot

What we need from the teacher / school:

| Material | Role in the manifest | Needed? |
|---|---|---|
| The teacher's test or material, as a Word **.docx** | `TEACHER_DOCUMENT` | yes, exactly one |
| The subject program / standard the material must follow | `PROGRAM_SOURCE` | strongly recommended; without it the program-scope check is "not evaluated" |
| The textbook pages / source the questions are based on | `FACT_SOURCE` | strongly recommended; without it fact checks are "not evaluated" |
| Methodological guide | `METHOD_SOURCE` | optional (recorded; the DOCX review does not use it) |
| The school's template, a reference answer | `TEMPLATE`, `TEACHER_REFERENCE` | optional (hashed and recorded only) |

For every source: the title, issuing body, version and effective date *as
written on the document*. If something is unknown, ask. Don't guess.

Not supported yet (preflight says so): a teacher document as PDF or a scan,
and sources that need OCR without a configured OCR provider.

Model: a real pilot runs with the model configured in `.env`
(`MODEL_PROVIDER`, `OPENROUTER_MODEL_ID`, `OPENROUTER_API_KEY`). Check
**Known blockers** at the end of this file first.

## Creating a pilot case

```bash
npm run pilot -- init pilot-private/CASE-001
```

This creates `pilot-private/CASE-001/` with `manifest.json` and `inputs/`.
`pilot-private/` is git-ignored, and the command refuses any directory
inside the repository that is not ignored. A directory outside the
repository also works.

1. Copy the original files, unchanged, into `pilot-private/CASE-001/inputs/`.
   Armenian file names and spaces are fine.
2. Fill in `manifest.json`: replace every `<FILL…>` value. The meaning of each
   field is in `pilot/case-template/README.md`. Keep `synthetic: false` and
   `modelMode: "real"`.
3. Source confirmation: either add `"confirmation": {"confirmedByName": "…"}`
   to a source (the operator states that this exact version may be used), or
   leave it out and confirm the source in the UI later.

A fully worked **synthetic** example is at `pilot/examples/SYNTH-AVARAYR-7/`.
It is test data, not a real scenario.

## Running preflight

```bash
npm run pilot:preflight -- pilot-private/CASE-001
```

For every input, preflight checks that:
- the file exists, is readable and is not empty;
- it is within the upload size limit;
- the extension matches the content;
- it is not a duplicate of another input, and no other input has the same name with different bytes;
- the source metadata is present and consistent.

It also runs the application's real text extractor and DOCX opener:
- sources: text length, text hash and chunk hash, and scanned pages;
- teacher DOCX: paragraphs, and the parts TeachFlow cannot privacy-check.

Personal data is reported by kind only (for example `phone`), never by value.

Output: `work/preflight.json`, and on success `work/preflight-lock.json`
(sha256 of the manifest and of every input). The exit code is 0 only on
`PREFLIGHT_PASSED`. A failed preflight removes an older lock.

If you change any input or the manifest after preflight, run preflight
again. A run or evidence collection against changed files reports
`PREFLIGHT_STALE`.

## Running TeachFlow

```bash
npm run pilot:run -- pilot-private/CASE-001
```

The run goes through the real application steps in the case's own store
(`work/store`). That store holds no demo sources, outcomes or plans, only the
application's method rules. The steps:

1. verify inputs against the preflight lock;
2. check that the model is available (no call is made);
3. upload each source through the real upload path, and compare the stored
   chunks with preflight;
4. confirm sources (from the manifest, or stop);
5. check for confirmed program outcomes (or stop);
6. upload the teacher DOCX and select the case's sources;
7. propose the question structure (a model call), then stop for the
   teacher to confirm it;
8. run the checks;
9. make fix proposals, then stop for the teacher's decisions;
10. `TECHNICAL_RUN_COMPLETE`.

It prints every stage and ends with `STATE:` and `NEXT:`. The run can be
repeated safely: sources and the review are reused, not duplicated.

### Human steps: done in the real UI on the case store

```bash
npm run pilot:serve -- pilot-private/CASE-001        # http://localhost:3200
```

| State | What a person does | Then |
|---|---|---|
| `SOURCE_CONFIRMATION_PENDING` | Registry (sources) page: confirm the source version (a stated name) | `pilot:run` again |
| `OUTCOMES_PENDING` | Registry (sources) page: extract the program's outcomes (a model call) and confirm each one against the program text. Outcome confirmation records no name: note who did it in the human review sheet | `pilot:run` again |
| `STRUCTURE_REVIEW_PENDING` | Materials → the review: check and confirm the question structure | `pilot:run` again |
| `DECISIONS_PENDING` | Materials → the review: accept or reject each proposal (the re-check runs automatically) | `pilot:run` again |

Stop `pilot:serve` (Ctrl+C) before running `pilot:run`: both write the same
store. **Do not press "Reset demo data"** in a pilot store. That would put
demo data into it, and the next run refuses the store.

## Running checks

Checks run inside `pilot:run` (step 8). Only questions without a fresh result
are checked, and failed calls are retried. If some calls still fail, the run
stops at `MODEL_FAILED` and names the failed calls. Run it again to retry. A
failed call is **never** a pass: it is `not_evaluated` with an execution
error, and the review cannot be final.

## Exporting the DOCX

The corrected copy is exported during evidence collection (`export.docx` in
the bundle). The UI download from the served case gives the same bytes. The
original is never modified.

## Collecting evidence

```bash
npm run pilot:evidence -- pilot-private/CASE-001
npm run pilot:status  -- pilot-private/CASE-001      # state + latest bundle
```

This creates a new `evidence/bundle-<time>/`. Bundles are never
overwritten. Contents:

| File | What it answers |
|---|---|
| `summary.md` | **Start here.** Overall state, model execution, stages, problems, human-verification table |
| `manifest.final.json` | The manifest and the preflight lock at collection time |
| `preflight.json` | Per-input checks, extraction evidence (hashes) |
| `source-diagnostics.json` | Original file hash vs the text TeachFlow stored, per source; confirmation |
| `run.json` | Provenance: git commit and branch, dirty files, app version, model configuration (credentials only as present/absent), prompt file hashes, extractor versions. Also: audited AI calls, run state, review runs, dependency fingerprint, method rules |
| `check-results.json` | Per question and check: status, model, evidence **hashes**. Text only with `--include-excerpts` |
| `export.docx`, `export.sha256` | Corrected copy |
| `docx-diagnostics.json` | ZIP and relationship integrity, page setup, fonts, expected text, determinism, original unchanged |
| `change-report.txt` | The change list the teacher also gets |
| `word-qa-checklist.md`, `armenian-review-checklist.md`, `human-review-template.md`, `teacher-feedback-template.md` | Blank human sheets for this bundle |
| `SHA256SUMS` | Hash of every file in the bundle |

Evidence is scanned for the values of secret-looking environment variables.
If one is found, the file is removed and the bundle is `EVIDENCE_FAILED`.

Check messages (`detail`) can quote a short fragment of the material or the
source, as the UI does. Use `--include-excerpts` only when the reviewer needs
the full evidence text. The bundle stays in `pilot-private/`.

## Microsoft Word QA

`word-qa-checklist.md` in the bundle. It must be done in Microsoft Word, not
LibreOffice or a browser preview. The automatic diagnostics are structural
only; `renderedPreview` is `NOT_RUN`.

## Armenian review

`armenian-review-checklist.md`: a native speaker, ideally a subject teacher,
checks TeachFlow's messages and the accepted fixes.

## Teacher interview

`human-review-template.md` covers content: sources, invented facts,
difficulty, correct answers, distractors, ambiguity.

`teacher-feedback-template.md` covers workflow and the DOCX. Record the
teacher's own words, not a score.

## Interpreting the result

These are separate. One does not imply another.

| Kind of success | Evidence | Who decides |
|---|---|---|
| Technical | `summary.md` state `TECHNICAL_RUN_COMPLETE`; no problems | the harness |
| Model | `run.json` `modelExecution: real_external` with the model ids; no execution errors | the harness (it ran), people (it was right) |
| Factual | Every finding and fix is correct against the sources | subject specialist (human review sheet) |
| Formatting | Word QA checklist all OK | person with Microsoft Word |
| Teacher usefulness | Teacher feedback | the teacher |

`fixture_deterministic` means rule-based FIXTURE output. It is never
evidence of model behaviour. A synthetic case is never pilot evidence.
"All checks passed" means the automated checks found nothing. It does not
mean the material is correct.

## Failure handling

Keep the whole case directory (`inputs/`, `work/`, `evidence/`). Don't
delete or re-create the store to "try again": that destroys the record.
Then:

| State | Meaning | Next |
|---|---|---|
| `PREFLIGHT_FAILED` | Inputs or manifest invalid (see `work/preflight.json`) | Fix, preflight again |
| `PREFLIGHT_STALE` | A file or the manifest changed after preflight | Preflight again (a new lock), then run |
| `REAL_MODEL_NOT_AVAILABLE` | No credentials / model id for the configured provider | Configure `.env`; the harness never falls back to fixtures |
| `MODEL_MODE_MISMATCH` | Declared mode differs from what ran, or a fixture case made external calls | Investigate; the bundle is not valid as declared |
| `INGESTION_FAILED` / `EXTRACTION_FAILED` | The application refused a file or got no text | See the stage detail; personal data is named by kind only |
| `MODEL_FAILED` | A model call failed or was cut off | Run again to retry; see Known blockers |
| `RUN_OBSOLETE` | Inputs changed while a step ran; nothing stale was published | Run again |
| `EXPORT_FAILED` | Export error, broken structure, non-determinism or missing expected text | Keep the bundle; report |
| `EVIDENCE_FAILED` | A secret value reached the evidence (file removed) | Report; don't share the bundle |

Collect evidence after a failure too (`pilot:evidence`). The bundle then
records the failure honestly.

## Model and retrieval settings

**Thinking level per operation** (`server/providers/reasoningPolicy.ts`, recorded in every result and in `run.json → provenance.reasoning`):

| Operation | Level |
|---|---|
| `material:segment` (splitting into questions) | minimal |
| `material:program_scope`, `material:answer_unambiguous`, `judge:verifyClaim` | low |
| `material:suggest_fix` | medium |
| everything else | provider default (unchanged) |

For a recorded experiment, set `TEACHFLOW_REASONING_OVERRIDE="material:segment=low"`.
It shows up in the evidence.

**Semantic retrieval** is chosen explicitly and never falls back silently:

```bash
EMBEDDING_PROVIDER=openrouter   # google/gemini-embedding-001 via OpenRouter (OPENROUTER_API_KEY), 768 dims
# unset -> Gemini API directly (GEMINI_API_KEY)
```

The run prints `SEMANTIC_RETRIEVAL = …` twice: the configured route, and
what the checks actually used. `summary.md` shows the observed state:

- `GOOGLE_EMBEDDINGS`: every check's passages were found semantically;
- `KEYWORD_FALLBACK`: no semantic search;
- `MIXED`: some passages had no embeddings;
- `NOT_USED`: no source checks ran.

With `GOOGLE_EMBEDDINGS`, source chunks and check queries go to Google's
embedding model (through OpenRouter or directly). Decide this knowingly
before real materials.

**Cost.** `summary.md → Model calls` lists every call: operation, model,
thinking level, attempts, tokens (including reasoning) and the cost as
reported by OpenRouter. The Gemini API reports no cost, so those calls
show `?`.

## Known blockers (as of this sprint)

- **The OpenRouter key has used its whole spending limit** ($2.00; $2.02
  used). Every real-model call now fails with "Key limit exceeded". Raise
  the limit or use another key before a real run.
- **Gemini key:** the `GEMINI_API_KEY` in `.env` is not a standard Gemini
  API key and is rejected (401). Use `EMBEDDING_PROVIDER=openrouter`, or
  replace the key.
- **Splitting fix not yet re-verified on the real model.** The fix that
  takes a miscopied single-option paragraph from the document is covered by
  tests built from the model's actual miscopies. It could not be re-run
  against the model because of the key limit.

## Commands at a glance

```bash
npm run pilot -- init      pilot-private/CASE-001 [--from <exampleCase>]
npm run pilot:preflight -- pilot-private/CASE-001
npm run pilot:run       -- pilot-private/CASE-001
npm run pilot:serve     -- pilot-private/CASE-001 [--port 3200]
npm run pilot:evidence  -- pilot-private/CASE-001 [--include-excerpts]
npm run pilot:status    -- pilot-private/CASE-001
```
