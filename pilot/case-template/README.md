# Pilot case template

A pilot case is one directory **under `pilot-private/`** (git-ignored) or
outside the repository. Never put real materials anywhere else in the repo:
`npm run pilot -- …` refuses a case directory inside the repository that is
not git-ignored.

```
pilot-private/CASE-001/
  manifest.json          # filled from manifest.example.json
  inputs/                # the original files, unchanged
  work/                  # written by the harness (store, preflight, run state)
  evidence/bundle-*/     # one directory per evidence collection, never overwritten
```

Create one with `npm run pilot -- init pilot-private/CASE-001`, then fill
every `<FILL…>` value (preflight fails while any placeholder remains).

## manifest.json fields

| Field | Meaning |
|---|---|
| `operator` | Stated name of the person running the pilot. Not an authenticated identity. |
| `teacherRole` | Role only. No personal data is needed. |
| `synthetic` | `false` for a real pilot. Only synthetic cases may use `modelMode: "fixture"` or `syntheticAutomation`. |
| `modelMode` | `real`: the configured external model (`.env`). `fixture`: deterministic rules, synthetic cases only. |
| `inputs[].role` | `PROGRAM_SOURCE` (program/standard: scope and outcomes), `FACT_SOURCE` (textbook/source: evidence), `METHOD_SOURCE` (recorded, not used by the DOCX review), `TEACHER_DOCUMENT` (exactly one .docx), `TEMPLATE`, `TEACHER_REFERENCE`, `OTHER` (hashed and recorded only). |
| `inputs[].source` | Required for `*_SOURCE`: title, authority, docType, version, effectiveFrom, grades, as written on the document. Unknown → ask; do not guess. |
| `inputs[].official` | `true`/`false` only when known; `null` otherwise. |
| `inputs[].confirmation` | Optional `{ "confirmedByName": "…" }`: the operator states this exact source version may be used. Without it the run stops at `SOURCE_CONFIRMATION_PENDING` and someone confirms it in the UI (`pilot:serve`). |
| `inputs[].noStudentDataDeclared` | Teacher document only: needed when it has images or embedded objects that cannot be privacy-checked. |
| `expectations.exportContains` | Optional strings the exported DOCX should contain (diagnostic). |

Human review templates (copied into every evidence bundle):
`human-review-template.md`, `word-qa-checklist.md`,
`armenian-review-checklist.md`, `teacher-feedback-template.md`.
