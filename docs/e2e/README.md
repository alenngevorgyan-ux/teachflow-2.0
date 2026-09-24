# Fixture E2E evidence (synthetic)

Environment: the labelled FIXTURE server (rule-based provider and judge, synthetic sources, synthetic Armenian DOCX). This is **not** a real model, real sources or a real teacher file.

Files:
- `e2e-log.txt` — step log of `scripts/e2e-review.mjs` (the real UI in Chrome).
- `proposals.txt` — what was actually proposed, declined and accepted (`scripts/e2e-proposals.mjs`, from the fixture store).
- `inspection.txt` — downloaded files compared (`scripts/inspect-e2e-output.mts`).
- `original.docx`, `corrected.docx`, `changes.txt` — the downloads.

## What actually changed, and why only the key line

Question 2's document key said `2-գ` (Արտաշես Առաջին); the fixture source says Վարդան Մամիկոնյան (option `ա`). Both proposals — the declined one and the accepted one — contain **one** text patch:

- paragraph `p0012-…` (the key line `1-ա, 2-գ`), UTF-16 range [5,8): `2-գ` → `2-ա`;
- plus `keyChange: ["ա"]`, which updates the review's **structured** key mapping for question 2 (`keyBefore: ["գ"]` is kept for undo). That is data in the review, not document text.

The question's own text was not wrong, so nothing proposed changing it. What changes "together" in this run is therefore the key **entry in the document** and the key **mapping in the review**, applied in one accept. It is **not** a question-text edit plus a key edit. The earlier handoff wording ("question and key change together") was inaccurate for this run.

XML: only `word/document.xml` differs, and within it only that one run's `<w:t>1-ա, 2-գ</w:t>` → `<w:t xml:space="preserve">1-ա, 2-ա</w:t>` (see `inspection.txt`). Every other package part is byte-identical; the original download equals the upload.

## The two-patch atomic group

A group with two text patches (question text in one paragraph plus the key line in another) was **not** exercised by this E2E run. It is covered by tests:
- engine level: `tests/docx/patch.test.ts` ("is atomic: one invalid patch means nothing in the group is applied", "applies non-overlapping patches of one group in the same paragraph");
- review level (`tests/materials/reviewFlow.test.ts`, "a linked question + key group is atomic at the review level"): both edits apply in one revision and reach the exported file; if the second edit no longer applies, neither is applied (text, key and revision unchanged, export equals the original bytes); a teacher edit of one part creates a new proposal revision and still applies both.
