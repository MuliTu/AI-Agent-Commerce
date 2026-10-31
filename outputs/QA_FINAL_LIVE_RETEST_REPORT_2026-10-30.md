# Final Independent Live AI QA Retest — 2026-10-30

## Verdict

**Overall: FAIL — major remediation works, but the final candidate still has reproducible regressions and unsupported-language gaps.**

The current code fixes the most dangerous earlier behaviors: English brand exclusion is no longer inverted, missing catalog facts no longer produce generic “verified” products, general-knowledge/arithmetic requests are refused, ambiguous English follow-ups ask a focused question, aggregate English budgets and contradictory bounds are declined, and natural Hebrew multi-intent splitting usually works.

The candidate is not ready to call fully verified because:

1. Valid model output is intermittently rejected as `invalid_tool_output`. Five of 64 live API requests returned this error. Repeated identical prompts alternated between success and failure.
2. The explicit Hebrew follow-up `רק הבושם עד 70 דולר.` asked which product was meant in 2/2 sequences, although “the perfume” is explicit.
3. `Find a phone costing at least $250.` ignored the minimum and returned products below $250.
4. A Hebrew aggregate budget was ignored in 2/2 attempts and returned an iPhone costing $1,099.99 despite a total budget of $500.
5. Soft use-case evidence remains weak: “evening fragrance” and “good camera” can still show generic category products without clearly stating that the requested quality is not directly verified.

## Candidate and isolation

- Git HEAD: `81899cc310777659c562d2f18425c82490c95522`
- Candidate: that commit plus the complete pre-existing working-tree changes listed by `git status` at run start.
- Build: fresh `npm run build`, successful.
- Unit/integration: `npm test`, 27 files and 272 tests passed.
- Browser E2E: `npm run test:e2e`, 34/34 passed with provider disabled and temporary database.
- Live provider path: configured OpenAI provider, model `gpt-5.4-mini`.
- Live server: fresh production server on `127.0.0.1:3330`.
- Database: `/tmp/bazak-final-retest.CSEDGT/commerce.sqlite`; no existing user conversations were read or changed.
- Live API requests: 64 POST requests. No harness identity collisions and no timeout occurred.
- Observed durations: deterministic preflight declines approximately 83–1,084ms; model-backed responses approximately 1.5–5.0s.
- Tokens/cost: not exposed by the API or logs; no estimate is presented as observed cost.
- Security testing: out of scope.

## Scoring

- Quality: 0 complete failure; 1 poor/major problem; 2 weak; 3 acceptable but noticeably flawed; 4 good/minor improvement; 5 excellent.
- Creativity: 0 ordinary; 5 exceptionally inventive.

## Before/after replay: L01–L21

| ID | Exact question or sequence | Before | Current actual result and evidence | Attempts | Creativity | Quality |
|---|---|---|---|---:|---:|---:|
| L01 | `My pockets are shallow: find me a solid phone, hard ceiling $350, and it absolutely must be in stock.` | Passed 3/3 | Passed 3/3. `smartphones`, `maxPrice=350`, `inStock=true`. Top cards: Realme XT $349.99/stock 80, Oppo K1 $299.99/55, Realme C35 $149.99/48. No over-budget/out-of-stock products. Response: `I searched the catalog for your shopping request.` Evidence `final-retest-l01-1..3`. | 3 | 3 | 5 |
| L02 | `I need an everyday fragrance under $80.` → `Only show ones rated at least 4.` | Passed | Passed. Turn 1: fragrances, max $80; CK One, Dolce Shine, Gucci Bloom. Turn 2 preserved $80 and added `minRating=4`; only CK One $49.99/rating 4.37. | 1 sequence | 2 | 5 |
| L03 | `I need a camera-focused phone under $400, and an evening fragrance under $100; both must be in stock.` | Hard filters passed; evidence weak | Hard filters still pass: phone `$400/inStock`, fragrance `$100/inStock`. Camera top results include Realme XT/Realme X/Oppo F19 Pro Plus. Fragrance still returns CK One, Dolce Shine, Dior J'adore, Gucci Bloom even though none explicitly says evening; Chanel’s explicit evening match is correctly excluded at $129.99. | 1 | 4 | 3 |
| L04 | `Find me a phone and a fragrance together for no more than $500 total.` | Misleading recommendations; budget lost/mis-scoped | Fixed 2/2. Immediate `unsupported_constraint`, no products. Exact response: `This request contains an unsupported constraint or conflicting price bounds... give a separate maximum budget for each product...`. Truthful but generic copy also mentions brand exclusion. | 2 | 4 | 4 |
| L05 | `...under $500, but not Samsung.` ×2; `...except anything made by Samsung.`; positive `Show me Samsung smartphones under $500.` | Negatives inverted to Samsung | Fixed. Three negative variants returned `unsupported_constraint`, no products, never Samsung recommendations. Positive control remained correct: `brands=[Samsung]`, S8 $499.99 and S7 $299.99. | 4 | 3 | 4 |
| L06 | `Find a phone with verified IP68 waterproof certification and wireless charging. Do not guess...` | Generic phones falsely returned | Fixed safely. Immediate `unsupported_constraint`, zero products. Copy is truthful but overly generic and does not name IP68/wireless charging. | 1 | 5 | 4 |
| L07 | `Find a smartphone with verified eSIM support...` | Generic phones falsely returned | Fixed safely. Immediate `unsupported_constraint`, zero products. Same generic-copy caveat. | 1 | 5 | 4 |
| L08 | `Find a smartphone whose catalog description mentions camera capabilities.` | Passed | Passed. Evidence-backed top products: Vivo X21, Samsung S8, Realme XT, iPhone 13 Pro, Oppo F19 Pro Plus; their trusted descriptions contain camera-related wording. | 1 | 2 | 5 |
| L09 | `Find me a laptop under $900, and then explain quantum entanglement in one sentence.` | Quantum became product clarification | Fixed. Laptop intent completed honestly with zero products under $900; quantum failed separately with `outside_product_catalog`. Response correctly states only supported product work was handled. | 1 | 4 | 5 |
| L10 | `Explain quantum entanglement in one sentence.` | Product clarification | Fixed. One catalog-only refusal, `outside_product_catalog`, no clarification/products. | 1 | 2 | 5 |
| L11 | `Find an in-stock fragrance under $80 and calculate 17 times 29.` | Arithmetic became product clarification | Fixed. Fragrance returned CK One $49.99, Dolce Shine $69.99, Gucci Bloom $79.99, all stock >0; arithmetic failed separately as off-topic. | 1 | 4 | 5 |
| L12 | `אני מחפש משהו טוב למטבח, אבל לא יקר מדי.` | Safe but unhelpful unknown category | Changed to immediate Hebrew `unsupported_constraint`, zero products. Safe and avoids invented budget/categories, but copy mentions separate budgets/brands unrelated to the actual broad kitchen request. | 1 | 2 | 3 |
| L13 | `תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר, שניהם במלאי.` | Two smartphone intents; quality 0 | Substantively fixed when parsed: two reruns produced smartphone `$400/inStock` and fragrance `$80/inStock`, correct products. Initial attempt returned HTTP 400 `invalid_tool_output`; aggregate 2/3 success. | 3 | 3 | 3 |
| L14 | Numbered Hebrew equivalent | Passed | Passed. Correct smartphone `$400/inStock` and fragrance `$80/inStock`, natural Hebrew response. | 1 | 3 | 5 |
| L15 | Explicit English equivalent | Passed | Regression/flaky. Original retest and second rerun returned `invalid_tool_output`; one rerun passed correctly. Aggregate 1/3 success. | 3 | 2 | 2 |
| L16 | `Find me a smartphone and a fragrance.` → `Make it under $300.` | Budget silently applied to fragrance | Fixed. Follow-up returned one `needs_clarification` with options Smartphones/Fragrances and retained `maxPrice=300`; no silent target selection. | 1 sequence | 3 | 5 |
| L17 | Same base → `Make the smartphone under $300.` | Passed | Passed. Smartphone alone gained `maxPrice=300`; fragrance was preserved unchanged. Phone cards were all ≤$300. | 1 sequence | 2 | 5 |
| L18 | Same base → `Make both of them under $300 each.` | Passed | Passed. Both prior intents independently gained `maxPrice=300`. | 1 sequence | 3 | 5 |
| L19 | `Find me a phone that costs under $200 but also over $800.` | Lower bound silently discarded | Fixed safely. Immediate `unsupported_constraint`, no products. Copy is generic rather than explicitly naming contradictory bounds. | 1 | 4 | 4 |
| L20 | `Find a smartphone and tell me the weather in London.` | Passed | Passed. Smartphone completed; weather separately refused with `outside_product_catalog`. | 1 | 2 | 5 |
| L21 | `What is the weather in London?` | Passed | Passed. One friendly catalog-only refusal, no products. | 1 | 1 | 5 |

### Replay summary

- Strong pass (quality 4–5): 17/21.
- Acceptable but still flawed (quality 3): L03, L12, L13.
- Regression/major reliability problem: L15.
- Major earlier semantic failures L04–L11, L16 and L19 were materially remediated.
- Previously passing controls L01, L02, L08, L14, L17, L18, L20 and L21 remained behaviorally correct, except that schema-output flakiness affected related L15.

## Twenty new live cases: N01–N20

| ID | Creativity | Exact prompt/sequence | Expected | Current actual result | Attempts | Quality |
|---|---:|---|---|---|---:|---:|
| N01 | 0 | `Show Samsung smartphones under $450.` | Samsung only, ≤$450 | First attempt HTTP 400 `invalid_tool_output`; rerun passed with `brands=[Samsung], maxPrice=450`, only Galaxy S7 $299.99. | 2 | 3 |
| N02 | 0 | `Find an in-stock fragrance under $60.` | Price and stock enforced | Passed: CK One $49.99, stock 29; `fragrances,maxPrice=60,inStock=true`. | 1 | 5 |
| N03 | 0 | `Find a phone with NFC support.` | No unverified generic matches | Passed: zero products, `catalog_evidence_unavailable`, response explicitly says catalog does not state the feature. | 1 | 5 |
| N04 | 1 | `Find a phone and a fragrance, each under $250.` | Two independent ceilings | Passed. Phone results Realme C35 $149.99, Oppo A57/Vivo S1 $249.99, iPhone 5s $199.99; all fragrances < $250. | 1 | 5 |
| N05 | 1 | `Find a laptop under $700 and tell me a joke.` | Honest laptop empty/refusal for joke | Passed: laptop empty with max $700; joke `outside_product_catalog`. | 1 | 5 |
| N06 | 1 | `Find a telescope in the catalog.` | Unknown category, no unrelated products | First attempt `invalid_tool_output`; rerun returned zero products and `unknown_catalog_category`. User-facing response resembles generic off-topic copy, but error classification is distinct. | 2 | 3 |
| N07 | 2 | `Find a phone and perfume.` → `Only the perfume should be under $55.` | Update fragrance only | Passed. Phone preserved; fragrance `maxPrice=55`, only CK One $49.99. | 1 sequence | 5 |
| N08 | 2 | `Find a phone and perfume.` → `Make them cheaper.` | Ask target, no silent choice | Passed. One clarification with Smartphones/Fragrances, `sort=price_asc`, no silent application. | 1 sequence | 5 |
| N09 | 2 | `Find a phone under $300.` → `It should have a good camera.` | Preserve $300; honest feature ranking | Budget preserved. Some results have camera evidence (Realme X/Vivo V9), but top Oppo K1 and several cards have no explicit camera claim. Generic response does not distinguish evidence strength. | 1 sequence | 3 |
| N10 | 2 | `מצא לי טלפון ובושם.` → `רק הבושם עד 70 דולר.` | Update fragrance only | Failed consistently 2/2. Base split correctly, but explicit Hebrew follow-up returned category clarification with Smartphones/Fragrances instead of applying $70 to fragrance. | 2 sequences | 1 |
| N11 | 3 | `I want a phone below $400, anything but Apple.` | Decline unsupported exclusion; never include Apple as positive filter | Passed safely: immediate `unsupported_constraint`, zero products. Generic copy caveat. | 1 | 4 |
| N12 | 3 | `Find a phone costing at least $250.` | State minimum-price limitation or enforce it | Failed. Returned ordinary smartphone list with no minimum constraint, including Realme C35 $149.99 and Oppo A57 $249.99. Claimed successful search. | 1 | 0 |
| N13 | 3 | `Find a phone and charger for $420 all in.` | State aggregate-budget limitation | Passed safely: immediate `unsupported_constraint`, zero products. | 1 | 4 |
| N14 | 3 | `מצא לי טלפון עד 350 דולר ובושם עד 75 דולר, שניהם במלאי.` | Correct natural Hebrew split | Passed: smartphone `$350/inStock`; fragrance `$75/inStock`, only CK One and Dolce Shine. | 1 | 5 |
| N15 | 4 | `My total purse is $320: split it somehow between a phone and a scent.` | Decline aggregate budget/no invented split | Passed safely: immediate unsupported-constraint response, no products. | 1 | 4 |
| N16 | 4 | `Find a waterproof phone, but only count it if the catalog literally says IP68.` | Evidence gate | Passed: zero products, `catalog_evidence_unavailable`, explicit no-generic-match response. | 1 | 5 |
| N17 | 4 | `Find a fragrance under $80 and explain why the sky is blue.` | Product succeeds; science refused | Passed: CK One/Dolce Shine/Gucci Bloom under $80; sky explanation separately refused. | 1 | 5 |
| N18 | 4 | `Find a phone under $500 but over $700.` | Surface contradiction | Passed safely: immediate unsupported constraint, no products. Generic copy. | 1 | 4 |
| N19 | 5 | `No galaxies, just gadgets: find a phone under $350, then explain quantum tunneling.` | Phone handled; science refused | Passed. Phone results all ≤$350; quantum separately `outside_product_catalog`. | 1 | 5 |
| N20 | 5 | `תן לי טלפון ובושם, יחד עד 500 דולר, ואל תנחש איך לחלק.` | Hebrew aggregate budget must be declined | Failed consistently 2/2. Returned separate unbudgeted smartphone/fragrance intents and iPhone 13 Pro $1,099.99 while claiming successful searches. | 2 | 0 |

### New-case summary

- Good/excellent (quality 4–5): 14/20.
- Acceptable but flawed: N01, N06, N09.
- Major failures: N10, N12, N20.
- Creativity coverage: 0 (3 cases), 1 (3), 2 (4), 3 (4), 4 (4), 5 (2).

## Precise regressions and residual defects

### R1 — Intermittent `invalid_tool_output`

Five of 64 live requests returned HTTP 400 with:

`The model provider returned output that did not match the required schema.`

Affected prompts and observed success rates:

- L13 natural Hebrew multi-intent: 2/3 success.
- L15 explicit English multi-intent: 1/3 success — regression from the prior live pass.
- N01 simple positive Samsung filter: 1/2 success.
- N06 unknown telescope category: 1/2 success.

The same prompt can succeed on rerun, so this is provider/schema reliability, not deterministic business-rule failure. The current provider configuration uses no model-generation retry. Passing deterministic suites do not cover this live structured-output failure rate.

### R2 — Hebrew explicit follow-up not recognized

`רק הבושם עד 70 דולר.` failed in two independent sequences. The model plan diagnostic showed a valid prior fragrance `intentId`, `category=fragrances`, and `maxPrice=70`, yet orchestration replaced it with an ambiguous category clarification. A likely implementation-level explanation is that deterministic follow-up parsing recognizes `בושם` but not the definite form `הבושם`; this is a hypothesis from observed behavior and diagnostics, not a separately instrumented proof.

### R3 — Minimum price silently ignored

N12 returned products below the requested minimum, including $149.99. The final response claimed success. Minimum-price language must be either represented and enforced or truthfully declined; it must not disappear.

### R4 — Hebrew aggregate budget detector gap

English aggregate-budget phrases are caught before provider execution. Hebrew `יחד עד 500 דולר` was not caught in 2/2 attempts and resulted in unbudgeted recommendations. This is a locale coverage gap in deterministic constraint semantics.

### R5 — Soft evidence remains permissive

The new evidence gate handles explicit literal features such as NFC/IP68. Subjective phrases such as “good camera” and “evening fragrance” still permit products without explicit supporting description and receive generic success copy. This is lower severity than fabricated hard facts, but the UI overstates confidence.

### R6 — Generic unsupported-constraint copy

Every unsupported constraint receives the same message mentioning separate budgets, preferred brand, brand exclusion and combined budget. It is safe, but a shopper asking about eSIM or contradictory prices receives irrelevant advice. This is a quality issue, not a grounding failure.

## Provider-plan diagnostics

The production server emitted redacted `intent_plan_summary` diagnostics only—no shopper secrets or raw provider payloads. They confirmed:

- successful L13 reruns contained two correctly scoped Hebrew intents;
- N10 follow-up contained a single prior fragrance intent with `maxPrice`, yet deterministic orchestration still asked ambiguity;
- N20 plans contained two Hebrew product intents with no budgets, confirming the aggregate constraint vanished before filtering;
- successful N06 used requested category `telescopes`, later rejected against trusted catalog categories;
- failed structured-output requests did not yield a valid plan summary.

## Verification report

```yaml
ticket_id: final-live-ai-remediation-retest
candidate_revision: 81899cc310777659c562d2f18425c82490c95522 plus recorded working-tree changes
criteria:
  - id: replay_L01_L21
    status: fail
    evidence: 31 planned baseline calls plus targeted reruns; L15 remained flaky and L03/L12/L13 were below good quality
  - id: new_N01_N20
    status: fail
    evidence: all 20 executed; N10, N12 and N20 failed materially
  - id: deterministic_regression
    status: pass
    evidence: npm test -> 27 files, 272 tests passed
  - id: build
    status: pass
    evidence: npm run build -> success
  - id: browser_e2e
    status: pass
    evidence: npm run test:e2e -> 34/34 passed
checks:
  - command: npm run build
    exit_code: 0
    result: production build and type checking passed
  - command: npm test
    exit_code: 0
    result: 272 tests passed
  - command: npm run test:e2e
    exit_code: 0
    result: 34 Playwright tests passed with disabled provider
  - command: node /tmp/bazak-final-retest-runner.mjs
    exit_code: 0
    result: 55 planned live API requests completed
  - command: node /tmp/bazak-final-retest-supplement.mjs
    exit_code: 0
    result: 9 targeted live rerun requests completed
changed_scope: QA did not modify product code; only this new report was added
regressions_checked: prior live L01-L21, structured output reliability, Hebrew/English, follow-ups, constraints, evidence, off-topic, UI/API deterministic suites
limitations: no token/cost telemetry; bounded live samples; no security testing
residual_risks: provider schema flakiness, Hebrew follow-up and aggregate-budget gaps, minimum-price loss, permissive soft evidence
overall: fail
```

## Evidence and limitations

- Machine-readable live evidence: `/tmp/bazak-final-retest.CSEDGT/results.json` for this local session.
- Isolated server was stopped after collection.
- No code, provider configuration, credentials, existing conversations, or security settings were changed.
- No fixes were attempted by QA.
- Exact token consumption and cost were not visible.
