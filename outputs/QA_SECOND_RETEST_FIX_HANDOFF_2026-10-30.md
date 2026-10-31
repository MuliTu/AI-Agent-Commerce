# Second Live-Retest Residual Fix Handoff — 2026-10-30

Status: implementation and deterministic verification complete; independent live-provider rerun pending.

## Root fixes

- Exclusive named refinements (`Only the fragrance...`, `רק הבושם...`) no longer merge unchanged sibling outcomes into the new API result. Ordinary named refinements continue preserving siblings.
- Brand-exclusion parsing rejects evidence-language candidates such as `not stated`, `not listed`, `not mentioned`, and catalog-related phrases. True exclusions such as `not Samsung` remain blocked safely.
- `no more than` is parsed as maximum-price language and cannot also produce a minimum-price issue. `more than` and currency-qualified `at least` remain minimum-price limitations.
- Feature evidence is derived from the shopper's category-scoped prompt segment. Hebrew `בושם לערב` produces an evening-use requirement even when provider goal/query wording is generic or English.

## Minimum independent live rerun

1. Run phone+fragrance followed by `רק הבושם עד 70 דולר.` twice, plus English `Only the fragrance should be under $70.` Confirm the new API result contains one fragrance outcome and no phone outcome/cards.
2. Replay the eSIM prompt and paraphrases using `not stated`, `isn't listed`, and `does not mention`; expect evidence-unavailable behavior. Re-run `not Samsung` as the exclusion control.
3. Replay aggregate `no more than $500 total`, single-product `no more than $300`, `more than $300`, and `at least $300`. Confirm only the latter two produce the minimum-price limitation.
4. Replay natural Hebrew phone + evening fragrance at least five times while varying provider wording naturally. Every returned fragrance card must contain trusted evening/night evidence; otherwise the fragrance outcome must be empty with `catalog_evidence_unavailable`.

Keep historical conversation turns visible as history, but assess the new turn's API result and new assistant result block separately. Do not count deterministic tests as live-provider evidence.
