# Engineering invariants

The correctness rules established by the bugs fixed so far, in terms of
what the code enforces today. Each one says where it is enforced, which
tests hold it, and where it is **not** enforced. A rule that is desirable
but not enforced is labelled **NOT ENFORCED**.

Scope: the material review (`server/materials/`), sources
(`server/pipeline/sourceIngestion.ts`, `sourceConfirmation.ts`) and the pilot
harness (`server/pilot/`). That is the pilot path.

---

## Invariant 1: dependency consistency

> A result is current only if the dependency state it was evaluated against
> is the same state it is committed against.

**What a check result depends on.** `dependencyFingerprint(review)` in
`server/materials/checks.ts` covers:
- the selected sources, with version and content hash;
- which of them are still usable (confirmed and not superseded);
- the confirmed outcomes of the selected program;
- the option-count rule (`rule-single-correct-answer`: active and params);
- the prompt versions of the model checks.

Per-question inputs (text, key, type, options) are in `itemInputHash`.
The run context (`runContext`) adds:
- the document revision;
- the selected sources;
- the structure: status, confirmation and items.

**Enforced by:**
- **On every load**, results whose fingerprint differs from the current one
  are marked stale (`invalidateOutdated`, `reviewService.ts`).
- **Check runs** (`runChecks`) capture the context and fingerprint once,
  under the lock and before any await. Results are stamped with the
  captured values. At commit, the captured context is compared
  synchronously with the live one; on any difference the run becomes
  `obsolete` and nothing is published as current.
- **Structure proposals** (`segment`) capture the structure and key before
  the model call. If either changed meanwhile, the late proposal is
  `obsolete` and the teacher's work is kept (fixed in `f6f4754`).
- **Decisions** (`decide`) carry the revision the teacher saw and run under
  the per-review lock. A proposal from an older revision is refused (409).
- **Undo** rebuilds from the original under the lock.
- **Pilot harness**: a run refuses inputs that differ from the preflight
  lock (`PREFLIGHT_STALE`). Evidence re-checks the lock when it is collected.

**Tests.** `tests/materials/reviewFlow.test.ts`:
- "independent race (review 963fb4b)": rule threshold changed, rule
  switched off, source superseded, or confirmed outcome edited during a
  check;
- "pilot audit: a split proposal must not overwrite structure work";
- "independent review R2";
- the revision-conflict tests.

`tests/pilot/run.test.ts`: the stale-input cases.

**Deliberately not part of the fingerprint:**
- **Model id and provider.** Each check records its model, and the
  evidence lists them. Switching the configured model does not make old
  results stale. They stay results *of the model they name*.
- **Prompt file contents.** The fingerprint uses prompt *version names*.
  An edit to a prompt file without a version bump does not make results
  stale. Mitigation: evidence records the sha256 of every prompt file
  (`run.json → provenance.prompts`), so two runs can be compared.
  **NOT ENFORCED** at runtime.
- **Model call settings** (`OPENROUTER_MAX_TOKENS`, temperature). Recorded
  in evidence; not a freshness dependency.
- **Source chunk text** beyond the content hash. The content hash covers
  it: a changed source is a new version or content hash.

**Outside the pilot path, NOT ENFORCED:** thematic plans, lesson plans,
generated assessments and material validation reports
(`thematicPlanGenerator`, `lessonPlanGenerator`, `orchestrator`,
`materialValidator`). Each reads its inputs, awaits the model and saves a
snapshot. None re-checks its inputs at save time or goes stale later. They
are timestamped artefacts, not "current" results. The DOCX pilot does not
use them.

---

## Invariant 2: failed checks are not passes

> A model or provider failure never becomes successful evaluation evidence.

**Enforced by:**
- **Failed calls.** A failed model call, judge call or retrieval gives
  `status: 'not_evaluated'` with `executionError: true` (`checks.ts`).
  `reviewStatus` counts execution errors, and such a review is never
  final. `runChecks({ retryFailed: true })` retries only those.
- **Cut-off answers.** An answer cut at the output-token limit is refused,
  even when the cut text parses as JSON (`TruncatedOutputError`,
  `modelProvider.ts`). The error now reports token usage, including
  reasoning.
- **Pilot run.** It stops at `MODEL_FAILED` when execution errors remain.
  It never falls back from a real model to the FIXTURE provider:
  `REAL_MODEL_NOT_AVAILABLE` is a stop.
- **Evidence.** If the declared mode disagrees with the providers that
  produced the results, the evidence is `MODEL_MODE_MISMATCH`. A FIXTURE
  result is never labelled real.
- **FIXTURE environment.** It makes no external calls. Embeddings are
  disabled there, so no result comes from an unlabelled real service.

**Tests.** `tests/openRouterProvider.test.ts` (truncation); the
material-review tests for execution errors; `tests/pilot/run.test.ts`
(REAL_MODEL_NOT_AVAILABLE, mode mismatch); `tests/embeddingProvider.test.ts`
(fixture mode).

---

## Invariant 3: stale or obsolete results cannot finalise a review

> A review is final only on fresh evidence.

**Enforced by `reviewStatus`** (`reviewService.ts`). The review is `final`
only when all of these hold:
- the structure is confirmed and has questions;
- every question is checked;
- no result is stale;
- no re-check is pending and no run is running;
- there are no execution errors;
- there are no failures, `needs_review` results or undecided proposals.

Otherwise it is a DRAFT, with the reasons, in the UI, in the export status
header and in the change list. `obsolete` runs publish nothing. Accepting a
fix marks the affected questions stale until their re-check has run.

**Pilot harness:** `TECHNICAL_RUN_COMPLETE` requires no pending decisions,
re-checks or stale items. It does **not** require `final`: open findings are
reported, not hidden.

**Tests.** `reviewFlow.test.ts`: "an accepted fix is not checked while its
re-check is pending", "results go stale, the status is not final", and the
R2 cases.

---

## Invariant 4: source identity matters

> Results tied to one source version never silently apply to replacement
> content.

**Enforced by:**
- **Confirmation.** A confirmation is bound to the source's version and
  content hash (`sourceConfirmation.ts`). A changed source is no longer
  confirmed. Superseding requires stated particulars.
- **Selection.** A review stores the version and content hash of each
  selected source. `resolveSelectedSources` refuses a source that changed
  after selection, is superseded or lost its confirmation. Those
  identifiers are part of the fingerprint, so dependent results go stale
  and proposals that relied on the source are superseded.
- **Pilot harness.** A case source is reused only while the file's sha256
  matches, and the review only while the teacher document's sha256
  matches. Otherwise the run re-ingests or reports `PREFLIGHT_STALE`. Case
  stores contain no demo sources, and a store with demo content is refused.

**Tests.** `tests/sourceConfirmation.test.ts`,
`tests/sourceSupersede.test.ts`, `reviewFlow.test.ts` ("a source that
changed after selection is not used", "a superseded source invalidates
dependent results", "independent review R1"), and the demo-store case in
`tests/pilot/run.test.ts`.

**NOT ENFORCED:**
- Outcome confirmation (`POST /outcomes/confirm`) records no name and is
  not bound to a source version. Outcomes carry `sourceId` and
  `standardVersion`, and the fingerprint includes their text, but who
  confirmed them is not stored.

---

## Invariant 5: evidence provenance

> Pilot evidence identifies the exact application, configuration and input
> state that produced an output.

**Enforced by the pilot harness** (`server/pilot/`):
- **Inputs.** The sha256 of every input and of the manifest (preflight
  lock), plus extraction evidence: text and chunk hashes, extractor
  versions. For each source, the preflight chunk hash is compared with
  what was stored.
- **Application.** Git commit, branch, the count of modified tracked
  files, package version, Node version and platform.
- **Configuration.** Provider, model ids, token limit, fixture flag, and
  whether each credential is present (values never), plus the sha256 of
  every prompt file.
- **Results.** The model, provider and prompt version of each check and
  proposal. The audited AI calls of the case store (provider, model,
  action, count). The run history and the current dependency fingerprint.
- **Output.** The export sha256, a second export to check determinism,
  structural DOCX diagnostics, and `SHA256SUMS` over the bundle. Bundles
  are never overwritten.

**Tests.** `tests/pilot/run.test.ts` (complete bundle, SHA256SUMS,
immutability, secrets, stale inputs) and `tests/pilot/preflight.test.ts`.

**NOT ENFORCED / limits:**
- `dirtyTrackedFiles` ignores untracked files. Run pilots from a clean
  checkout.
- The audit log keeps the latest 200 entries; the evidence says when it
  may be incomplete.
- FIXTURE provider calls are not audit-logged.
- Result records carry the model id but not token limits or temperature.
  Those are recorded once per bundle, not per result.
