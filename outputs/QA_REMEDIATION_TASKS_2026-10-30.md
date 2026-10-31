# Live AI QA Remediation Tasks — 2026-10-30

Status: local execution record. External Kan inspection is unavailable (`GET /workspaces` returned `status=unavailable`), so no provider transition or comment is claimed.

## QA-1 — Constraint semantics and contradictions

- Detect unsupported brand exclusion, minimum-price language, contradictory bounds, and aggregate/combined budgets before model output can silently invert or discard them.
- Return a focused clarification or explicit unsupported-constraint outcome; never claim the requirement was honored.
- Preserve supported per-intent maximum USD budgets, ratings, stock and positive brands.

## QA-2 — Off-topic and unknown-category classification

- Classify general knowledge, arithmetic, travel, weather and other non-catalog goals independently of the finite keyword list where deterministically possible.
- Keep supported product siblings actionable.
- Distinguish an unknown product category from an out-of-scope request and from a broad but plausibly catalog-related request.

## QA-3 — Multi-intent and follow-up integrity

- Validate extracted plans against product types explicitly named in English and Hebrew.
- Repair or reject duplicated broad intents that lose an explicitly named sibling category.
- Require clarification for a category-free follow-up when multiple prior intents are plausible even if the provider selected one prior ID.
- Preserve explicit single-target and explicit “both” follow-ups.

## QA-4 — Catalog-evidence gating

- Do not present category-wide products as matches for requested arbitrary features unless trusted title, description or tags establish the feature.
- If feature evidence is absent, return an honest no-verified-match result without inventing facts.
- Keep supported category/use-case ranking behavior for evidence that is present.

## QA-5 — Provider-plan observability and QA handoff

- Record a bounded, secret-free diagnostic summary of provider intent plans (IDs, statuses, categories, constraint keys and counts; no credentials or raw provider payloads).
- Add regression coverage for the original live scenarios.
- Prepare an independent-QA matrix for before/after replay plus 20 new creativity-rated cases. Deterministic test results must remain separate from live-provider results.

## QA-6 — Final live-retest reliability follow-up

- Add bounded structured-output generation retries for intermittent provider schema failures; keep each final plan schema-validated and observable.
- Recognize definite Hebrew category forms in explicit follow-ups and Hebrew aggregate-budget wording.
- Decline currency-qualified minimum prices instead of silently dropping them.
- Require trusted catalog evidence for clearly requested camera/evening qualities, or return an honest no-evidence result.
- Generate issue-specific unsupported-constraint copy and avoid treating phrases such as “do not guess” as brand exclusion.

## QA-7 — Second live-retest residuals

- Treat explicit “only this product” follow-ups as exclusive current-result scope instead of merging unchanged sibling cards into the new turn.
- Exclude evidence-language negations (`not stated`, `does not mention`) from brand-exclusion parsing while retaining true brand exclusions.
- Distinguish `no more than` maximum language from `more than` minimum language.
- Derive per-intent evidence requirements from the shopper's category-scoped prompt segment, including Hebrew evening wording, rather than depending on variable provider query wording.

## QA-8 — Uncontracted evidence-negation grammar

- Treat base-form evidence verbs after `not`—for example `not mention`, `not state`, `not list`, and `not omit`—as evidence disclaimers, never brand candidates.
- Preserve true exclusion behavior for named brands after `not`, `except`, and `anything but`.

## QA-9 — Open-vocabulary explicit evidence requirements

- Extract bounded feature phrases from explicit catalog-proof language (`state`, `mention`, `list`, `show`, `describe`, `verified`) even when the feature is not in the predefined synonym vocabulary.
- Require lexical support in trusted title, description, or tags; when the feature phrase cannot be resolved safely, return no generic products and explain the evidence limitation.
- Preserve ordinary category browsing and the curated synonym behavior for known capabilities.

## Boundaries

- No price picker.
- No push, merge, deployment or submission.
- Preserve existing user data and uncommitted work.
- Unsupported semantics are communicated honestly rather than approximated silently.
