# Final Live-Retest Fix Handoff — 2026-10-30

Status: deterministic implementation complete; independent configured-provider verification pending.

## Fixed from the final live report

- R1: schema-invalid provider generations are regenerated up to three total attempts. Transport retries remain disabled inside each attempt, so request count is explicit and bounded. Non-schema failures are not retried by this loop.
- R2: definite/conjoined Hebrew aliases such as `הבושם`, `והטלפון`, and `רק הבושם` resolve to the named active product intent.
- R3: currency-qualified minimum phrases including `at least $250` are declined before provider planning; rating language such as `rated at least 4` remains supported.
- R4: Hebrew aggregate scope including `יחד עד 500 דולר` is declined before provider planning.
- R5: explicit good-camera, camera-focused, and evening-fragrance qualities require trusted title/description/tag evidence. No evidence yields `catalog_evidence_unavailable` rather than generic category matches.
- R6: unsupported responses identify brand exclusion, minimum price, contradictory bounds, or aggregate budget specifically.
- False positives: `do not guess`, Hebrew `לא יקר`, and ordinary uncertainty no longer trigger brand-exclusion handling.

## Required targeted live rerun

Use isolated conversations and unique turn IDs. Record every provider attempt and the final application result.

1. Repeat L13 and L15 five times each; all final requests should succeed unless all three bounded generations are schema-invalid.
2. Repeat N01 and N06 five times each to measure residual structured-output failure after bounded regeneration.
3. Run `מצא לי טלפון ובושם.` then `רק הבושם עד 70 דולר.` twice. Only fragrance should receive `maxPrice=70`; no clarification.
4. Run `Find a phone costing at least $250.`. Expect `unsupported_constraint`, minimum-price-specific copy, and zero products.
5. Run `תן לי טלפון ובושם, יחד עד 500 דולר, ואל תנחש איך לחלק.` twice. Expect aggregate-budget-specific Hebrew copy and zero products.
6. Replay L03 and N09. Every returned item must contain trusted camera/evening evidence; if none survives other filters, expect an honest evidence-unavailable empty result.
7. Replay L04, L05, L06/L07, L12, L19 and N18 to verify issue-specific copy and absence of false brand-exclusion detection.

Do not treat the deterministic suite as live-provider evidence. Report total model calls consumed by regeneration if telemetry makes that observable; otherwise report attempt counts from application diagnostics without estimating cost.
