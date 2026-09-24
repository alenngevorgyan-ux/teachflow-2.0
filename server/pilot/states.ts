// Pilot states. A reviewer reads ONE state to know where a case stands.
// There is deliberately no "SUCCESS": the best technical outcome is
// TECHNICAL_RUN_COMPLETE, after which human review is still pending
// (Word QA, Armenian review, teacher usefulness).

export const PILOT_STATES = [
  // failures (the run stopped; nothing after this stage is valid)
  'PREFLIGHT_FAILED',
  'PREFLIGHT_STALE', // an input changed after preflight
  'INGESTION_FAILED',
  'EXTRACTION_FAILED',
  'REAL_MODEL_NOT_AVAILABLE',
  'MODEL_FAILED', // a model/provider call failed (checks not evaluated)
  'MODEL_MODE_MISMATCH', // e.g. fixture results in a run declared real
  'RUN_OBSOLETE', // dependencies changed during a run; its results were discarded
  'EXPORT_FAILED',
  'EVIDENCE_FAILED',
  // waiting for a person (do it in the UI: npm run pilot:serve)
  'SOURCE_CONFIRMATION_PENDING',
  'OUTCOMES_PENDING',
  'STRUCTURE_REVIEW_PENDING',
  'DECISIONS_PENDING',
  // technical pipeline done; people still have to judge the result
  'TECHNICAL_RUN_COMPLETE',
] as const;

export type PilotState = (typeof PILOT_STATES)[number];

export const HUMAN_STEP_INSTRUCTIONS: Partial<Record<PilotState, string>> = {
  SOURCE_CONFIRMATION_PENDING:
    'Confirm each source version: npm run pilot:serve -- <case>, open Registry as methodologist, check the text, click "Confirm vN" (or add "confirmation" to the input in manifest.json), then run pilot:run again.',
  OUTCOMES_PENDING:
    'The selected program has no confirmed learning outcomes. In the UI (pilot:serve) Registry: "Extract outcomes" on the program source, review and confirm each outcome, then run pilot:run again.',
  STRUCTURE_REVIEW_PENDING:
    'Check how the teacher document was split into questions: pilot:serve, My materials -> the case document -> Structure; correct and confirm, then run pilot:run again.',
  DECISIONS_PENDING:
    'Proposed fixes wait for decisions: pilot:serve, open the document, accept or decline each proposal (declining keeps the finding open), then run pilot:evidence.',
};

export function isFailure(s: PilotState): boolean {
  return PILOT_STATES.indexOf(s) <= PILOT_STATES.indexOf('EVIDENCE_FAILED');
}
