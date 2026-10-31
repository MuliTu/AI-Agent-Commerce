# Third Live-Retest Residual Fix Handoff — 2026-10-30

Status: deterministic fix complete; narrow independent live verification pending.

## Root fix

Brand-exclusion parsing now rejects base-form and inflected evidence verbs as brand candidates: `mention`, `state`, `list`, `omit`, `show`, and `sell`, including their common inflections. This covers uncontracted `does not mention eSIM` without weakening named-brand exclusions.

## Narrow live matrix

Run each evidence case twice:

- `If the catalog does not mention eSIM...`
- `If the catalog does not mention NFC...`
- `If the catalog does not state/list/show the feature...`
- The contracted `doesn't mention it`, `not stated`, `not listed`, and `do not guess` controls

Run each true-exclusion control once:

- `not Samsung`
- `anything but Apple`
- `except Google`

Evidence-language cases must reach catalog-evidence handling and return no generic matches when evidence is absent. Named-brand exclusions must still return the brand-exclusion limitation. Keep live results separate from deterministic regression results.
