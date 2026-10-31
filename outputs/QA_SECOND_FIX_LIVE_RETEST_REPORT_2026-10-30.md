# Second-Fix Live OpenAI QA Retest — 2026-10-30

## Verdict

**FAIL — materially improved, but not ready to sign off.**

The second fix pass resolves the highest-risk structured-output failure and several constraint-safety defects:

- 41/41 live application requests returned a valid final API result; `invalid_tool_output` occurred 0/41.
- Repeated Samsung and unknown-category requests were stable 5/5 each.
- Minimum-price requests, Hebrew aggregate budgets, contradictory bounds, brand exclusion, IP68/wireless claims, and positive controls were handled safely.
- Camera evidence filtering now retains the previous price context and returns only cards whose trusted catalog text mentions camera capability.

Four residual product defects remain:

1. **Hebrew exclusive follow-up is only partially applied.** `רק הבושם עד 70 דולר.` correctly updates the fragrance intent, but the API result still includes the previous phone intent and cards (2/2 reproductions).
2. **eSIM evidence request is falsely classified as brand exclusion.** The phrase `If eSIM is not stated in the catalog...` triggers `Brand exclusion is not supported (stated in the catalog)` instead of the evidence-unavailable path.
3. **English aggregate-budget copy contains a false minimum-price warning.** `no more than $500 total` is correctly rejected as an aggregate budget, but is also incorrectly described as minimum-price filtering.
4. **Hebrew evening-fragrance evidence is nondeterministic.** The same request produced evidence-safe empty fragrance results 2/5 times but returned three generic fragrances with no evening evidence 3/5 times.

These are application defects, not harness failures. No product code was changed during this QA run.

## Candidate, provider, and isolation

- Repository: `/Users/mulituriel/Documents/Projects/AI-Agent-Commerce`
- Candidate HEAD: `81899cc310777659c562d2f18425c82490c95522`
- Candidate state: dirty working tree supplied by the developer; all pre-existing edits were preserved.
- Build tested: a fresh `npm run build` of the current working tree.
- Runtime: fresh production server on `127.0.0.1:3340`.
- Database: isolated SQLite file at `/tmp/bazak-final-retest2.TQzrsp/commerce.sqlite`.
- Conversation IDs: `second-fix-*`; no existing conversations were read, edited, or deleted.
- Provider: the application's configured live OpenAI provider, authorized by the user for this run.
- Security testing: out of scope.

## Scoring

- Quality: 0 complete failure, 1 poor/major defect, 2 weak/substantial fixes needed, 3 acceptable but noticeably flawed, 4 good/minor improvement, 5 excellent.
- Creativity: 0 ordinary, 5 exceptionally unusual or inventive.
- “Before” scores are from `QA_FINAL_LIVE_RETEST_REPORT_2026-10-30.md`; “Now” is this independent run.

## Execution summary

| Layer | Result | Evidence |
|---|---:|---|
| Production build | PASS | `npm run build` completed successfully before live testing. |
| Unit/integration suite | PASS | 27 files, 285 tests passed. |
| Browser E2E | PASS | 34/34 Playwright tests passed against the deterministic E2E configuration. |
| Live OpenAI application requests | 41/41 HTTP/API results | 41 POSTs, all returned HTTP 200 with a structured application result. |
| Live schema failures | 0/41 | No `invalid_tool_output`; previous run observed 5/64. |
| Harness failures/timeouts | 0 | No fetch exception, timeout, or malformed JSON response. |
| Observed API latency | 85–4,680 ms | Measured end-to-end per POST. Deterministic preflight rejections were ~85–90 ms. |
| Provider model-attempt count | Not observable | Application logs exposed one sanitized final `intent_plan_summary` per provider-planned request, but not the number of bounded regeneration attempts. |
| Tokens/cost | Not observable | No usage or cost telemetry was exposed; no estimate is invented. |

The run covered 20 scenario families and 41 POSTs. Four families were repeated five times, one was repeated twice, and the multi-turn families contributed six POSTs (two N10 sequences and one N09 sequence). Repetitions used unique conversation and turn IDs.

## Targeted before/after results

### L13 — natural Hebrew multi-intent, repeated five times

- Exact input: `תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר, שניהם במלאי.`
- Expected (specified by retest handoff): two independent intents; phone `maxPrice=400`, fragrance `maxPrice=80`, both `inStock=true`; “evening” must be backed by trusted catalog evidence, otherwise the fragrance result must be honestly empty.
- Before: 2/3 parsed successfully; one `invalid_tool_output`. Quality 3/5.
- Actual now: all five requests parsed into the correct smartphone and fragrance intents with the correct price/stock constraints. The phone cards were always valid (for example Realme XT $349.99/stock 80, Realme C35 $149.99/48, Oppo F19 Pro Plus $399.99/78). Attempts 1 and 5 returned no fragrance cards and Hebrew evidence-unavailable copy. Attempts 2–4 returned CK One $49.99, Dolce Shine $69.99, and Gucci Bloom $79.99 even though their trusted title/description/tags do not say “evening.”
- Classification: **confirmed nondeterministic evidence-gate defect**; structured-output stability fixed.
- Attempts/evidence: 5/5 API success; evidence conversations `second-fix-l13-1..5`; durations 2,457–4,680 ms.
- Creativity: 3/5. Quality now: **3/5**.

### L15 — explicit English multi-intent, repeated five times

- Exact input: `Find two separate things: an in-stock phone under $400, and an in-stock evening fragrance under $80.`
- Expected (specified): two independent constrained intents; only evidence-backed evening fragrance cards.
- Before: 1/3 success because two attempts returned `invalid_tool_output`. Quality 2/5.
- Actual now: 5/5 structured success. Every attempt returned the correct in-stock phone set under $400 and an empty fragrance outcome with exact copy: `The catalog does not state the requested feature, so I won’t present generic products as verified matches.`
- Classification: **fixed**.
- Attempts/evidence: 5; `second-fix-l15-1..5`; 1,751–4,419 ms.
- Creativity: 2/5. Quality now: **5/5**.

### N01 — ordinary Samsung filter, repeated five times

- Exact input: `Show Samsung smartphones under $450.`
- Expected (specified): Samsung smartphone cards only, all at or below $450.
- Before: first attempt `invalid_tool_output`, rerun passed. Quality 3/5.
- Actual now: 5/5 identical correct plans: `brands=[Samsung]`, `category=smartphones`, `maxPrice=450`; only Samsung Galaxy S7 at $299.99.
- Classification: **fixed/stable**.
- Attempts/evidence: 5; `second-fix-n01-1..5`; 1,803–2,157 ms.
- Creativity: 0/5. Quality now: **5/5**.

### N06 — unknown catalog category, repeated five times

- Exact input: `Find a telescope in the catalog.`
- Expected (specified): no unrelated products; honest unknown/unsupported catalog-category result.
- Before: first attempt `invalid_tool_output`; rerun safely returned zero products. Quality 3/5.
- Actual now: 5/5 stable zero-product outcomes. Internal intent category was `telescopes`, status failed; user copy was the friendly catalog-scope refusal.
- Classification: **fixed/stable**, with minor copy ambiguity because “not sold in this catalog” would be more precise than off-topic wording.
- Attempts/evidence: 5; `second-fix-n06-1..5`; 1,669–1,861 ms.
- Creativity: 1/5. Quality now: **4/5**.

### N10 — explicit Hebrew exclusive follow-up, repeated twice

- Exact sequence:
  1. `מצא לי טלפון ובושם.`
  2. `רק הבושם עד 70 דולר.`
- Expected (specified): the follow-up should target only fragrance, apply `maxPrice=70`, show no clarification, and remove/suppress the phone from the current result.
- Before: 0/2; both runs asked an incorrect category clarification. Quality 1/5.
- Actual now: the planner correctly produced one fragrance update with `maxPrice=70`; both runs returned only CK One $49.99 and Dolce Shine $69.99 for that intent. However, the final API result still merged and displayed the entire previous phone intent and its 16 cards, and the response said it searched “separately for each” goal. This contradicts `רק הבושם` (“only the fragrance”).
- Classification: **partially fixed; confirmed result-merging/exclusive-scope defect**.
- Attempts/evidence: 2 full sequences (4 POSTs), reproduced 2/2; `second-fix-n10-1..2`.
- Creativity: 2/5. Quality now: **2/5**.

### N12 — unsupported minimum price

- Exact input: `Find a phone costing at least $250.`
- Expected (specified): explicitly state minimum-price filtering is unsupported; return no products.
- Before: minimum silently ignored and a $149.99 phone was returned. Quality 0/5.
- Actual now: status failed, zero products, exact copy `Minimum-price filtering is not supported. Please provide a maximum price instead.`
- Classification: **fixed**.
- Attempts/evidence: 1; `second-fix-n12-1`; 90 ms preflight result.
- Creativity: 3/5. Quality now: **5/5**.

### N20 — Hebrew aggregate budget, repeated twice

- Exact input: `תן לי טלפון ובושם, יחד עד 500 דולר, ואל תנחש איך לחלק.`
- Expected (specified): decline unsupported shared budget in Hebrew, no products, no invented allocation.
- Before: failed 2/2; returned unbudgeted products including a $1,099.99 phone. Quality 0/5.
- Actual now: 2/2 immediate safe failure, zero products, exact Hebrew explanation: `תקציב משותף למספר מוצרים אינו נתמך כרגע. אפשר לציין תקציב מרבי נפרד לכל מוצר.`
- Classification: **fixed/stable**.
- Attempts/evidence: 2; `second-fix-n20-1..2`; 85–88 ms.
- Creativity: 5/5. Quality now: **5/5**.

### L03 — camera-focused phone plus evening fragrance

- Exact input: `I need a camera-focused phone under $400, and an evening fragrance under $100; both must be in stock.`
- Expected (specified): preserve all hard constraints; every card must have trusted camera/evening evidence or the corresponding outcome must be empty with an honest explanation.
- Before: hard constraints passed, but generic fragrance cards lacked evening evidence. Quality 3/5.
- Actual now: camera cards were correctly evidence-backed and under $400/in stock (Realme XT, Realme X, Vivo V9, Oppo F19 Pro Plus, Vivo S1, Galaxy S7; each trusted description mentions camera/photo/selfie capability). The fragrance outcome was empty because no under-$100 item states evening suitability. Honest evidence-unavailable copy was returned.
- Classification: **fixed for this replay**.
- Attempts/evidence: 1; `second-fix-l03-1`; 2,417 ms.
- Creativity: 4/5. Quality now: **5/5**.

### N09 — ambiguous subjective camera refinement

- Exact sequence:
  1. `Find a phone under $300.`
  2. `It should have a good camera.`
- Expected (specified/proposed): preserve $300; do not claim objective camera quality; return only cards with trusted camera evidence and explain the limitation.
- Before: price was preserved, but several generic cards had no camera evidence. Quality 3/5.
- Actual now: follow-up retained `maxPrice=300` and reduced the list to Realme X $299.99, Vivo V9 $299.99, Vivo S1 $249.99, and Galaxy S7 $299.99; each description mentions camera/camera system/selfies. Response accurately says the catalog mentions camera capabilities but does not objectively verify quality.
- Classification: **fixed**.
- Attempts/evidence: 1 two-turn sequence; `second-fix-n09-1`; 1,995 + 1,790 ms.
- Creativity: 2/5. Quality now: **5/5**.

### L04 — aggregate budget and issue-specific copy

- Exact input: `Find me a phone and a fragrance together for no more than $500 total.`
- Expected (specified): reject only the unsupported combined budget, offer separate per-product maxima, return no products.
- Before: safely rejected, but generic copy mentioned unrelated constraint types. Quality 4/5.
- Actual now: zero products and a correct aggregate-budget explanation, but the response incorrectly starts `Minimum-price filtering is not supported.` The phrase “no more than” is a maximum, not a minimum.
- Classification: **confirmed false-positive explanation defect**; safe behavior retained.
- Attempts/evidence: 1; `second-fix-l04-1`; 87 ms.
- Creativity: 4/5. Quality now: **3/5**.

### L05 — brand exclusion and positive contrast

- Exact negative input: `Show me smartphones under $500, but not Samsung.`
- Expected (specified): decline unsupported exclusion and return no products.
- Actual negative: zero products; `Brand exclusion is not supported (Samsung.). Please name brands you do want included.`
- Exact positive control: `Show me Samsung smartphones under $500.`
- Expected: normal positive brand filter.
- Actual positive: `brands=[Samsung]`, max $500; Galaxy S8 $499.99 and Galaxy S7 $299.99.
- Classification: **fixed; no general overblocking for positive brand language**. Minor punctuation defect in `(Samsung.)`.
- Attempts/evidence: 2 requests; `second-fix-l05neg-1`, `second-fix-l05pos-1`.
- Creativity: negative 3/5, positive 0/5. Quality: **4/5** negative, **5/5** positive.

### L06 — verified IP68 and wireless charging

- Exact input: `Find a phone with verified IP68 waterproof certification and wireless charging. Do not guess if the catalog does not say.`
- Expected (specified): no generic substitutes; evidence-backed matches only, otherwise empty and honest.
- Before: safe empty result but generic unsupported copy. Quality 4/5.
- Actual now: zero products with specific evidence-unavailable copy: `The catalog does not state the requested feature, so I won’t present generic products as verified matches.` `Do not guess` did not trigger brand exclusion.
- Classification: **fixed**.
- Attempts/evidence: 1; `second-fix-l06-1`; 1,825 ms.
- Creativity: 5/5. Quality now: **5/5**.

### L07 — verified eSIM and overblocking contrast

- Exact input: `Find a smartphone with verified eSIM support. If eSIM is not stated in the catalog, say that rather than recommending generic phones.`
- Expected (specified): evidence-unavailable empty result, analogous to L06.
- Before: safely returned empty, though copy was generic. Quality 4/5.
- Actual now: immediate failure with zero products, but wrong copy: `Brand exclusion is not supported (stated in the catalog). Please name brands you do want included.` The phrase `not stated in the catalog` was mistaken for a negated brand.
- Classification: **confirmed regression/false positive in brand-exclusion preflight**.
- Attempts/evidence: 1; `second-fix-l07-1`; 88 ms.
- Creativity: 5/5. Quality now: **1/5**.

### L12 — Hebrew broad kitchen request and false-positive contrast

- Exact input: `אני מחפש משהו טוב למטבח, אבל לא יקר מדי.`
- Expected (proposed): treat “not too expensive” as soft preference, avoid inventing a numeric ceiling, and offer relevant kitchen products; do not misread `לא` as brand exclusion.
- Before: immediate unsupported result. Quality 3/5.
- Actual now: completed `kitchen-accessories` search, no invented numeric price. Returned relevant cards including Kitchen Sieve $7.99, Spice Rack $19.99, Microwave Oven $89.99, Boxed Blender $39.99, and lower-cost utensils. No false exclusion response.
- Classification: **fixed**, though the 30-card list is broad and “not expensive” remains subjective.
- Attempts/evidence: 1; `second-fix-l12-1`; 1,852 ms.
- Creativity: 2/5. Quality now: **4/5**.

### L19 and N18 — contradictory bounds

- Exact L19: `Find me a phone that costs under $200 but also over $800.`
- Exact N18: `Find a phone under $500 but over $700.`
- Expected (specified): surface the contradiction; no products.
- Before: both were safely rejected but with generic copy. Quality 4/5 each.
- Actual now: both returned zero products and precise messages naming the minimum and maximum values and asking which bound to change.
- Classification: **fixed**.
- Attempts/evidence: 1 each; `second-fix-l19-1`, `second-fix-n18-1`; 85–87 ms.
- Creativity: 4/5 each. Quality now: **5/5** each.

## Additional contrast cases

| ID | Exact input | Expected basis | Actual | Attempts | Creativity | Quality | Classification |
|---|---|---|---|---:|---:|---:|---|
| C01 | `Find a fragrance rated at least 4 stars.` | Supported `minRating`; must not be confused with minimum price | `minRating=4`, fragrance category; only CK One 4.37 and Chanel Coco Noir 4.26 | 1 | 1 | 5 | Pass; no overblocking |
| C02 | `I'm not sure which phone is best; show me smartphones under $300.` | Ordinary uncertainty must not be treated as negation/exclusion | Correct smartphone `maxPrice=300`; all nine cards ≤$300 | 1 | 1 | 5 | Pass; no overblocking |
| C03 | `Find a phone and a fragrance, each under $500.` | Separate budgets are supported, unlike a combined budget | Two independent `maxPrice=500` intents; all phone/fragrance cards ≤$500 | 1 | 1 | 5 | Pass; no overblocking |

## Defect register and likely locus

The following are evidence-based behavioral hypotheses, not proven code-level root causes:

| Priority | Defect | Reproduction | Likely behavioral locus | Why it matters |
|---|---|---|---|---|
| P1 | Exclusive Hebrew follow-up retains prior phone result | N10, 2/2 | Planner correctly emits one fragrance update, but conversation-result merge preserves sibling phone outcome despite `רק` | User explicitly asked for only one category; UI/API still shows the excluded category |
| P1 | eSIM request falsely becomes brand exclusion | L07, 1/1 | Pre-provider negation/exclusion detector appears to treat words after `not` (`stated in the catalog`) as a brand-like exclusion | Gives a nonsensical explanation and blocks valid evidence handling |
| P1 | Hebrew evening evidence gate varies with model wording | L13, 3/5 unsafe generic fragrance sets | Evidence enforcement appears sensitive to generated query/required-tag normalization (`evening fragrance`, `fragrance for evening`, Hebrew forms) | Same user input can truthfully return empty or falsely imply suitability |
| P2 | `no more than` also flagged as minimum price | L04, 1/1 | Deterministic minimum-price detector likely overlaps the `more than` substring without respecting the preceding `no` | Safe rejection, but materially misleading explanation |
| P3 | Unknown-category copy resembles off-topic refusal | N06, 5/5 | Result-to-copy mapping uses generic catalog-scope text | Safe but less actionable than “not found/sold in this catalog” |

## Pass/fail accounting

Counting each scenario family/control as one assessed behavior (with L05 negative and positive scored separately, and L19/N18 separately):

- Excellent (5): 13 behaviors — L15, N01, N12, N20, L03, N09, L05 positive, L06, L19, N18, C01, C02, C03.
- Good (4): N06, L05 negative, L12.
- Acceptable but flawed (3): L13, L04.
- Weak (2): N10.
- Poor (1): L07.
- Complete failure (0): none.

Release sign-off is still **FAIL** because N10 and L07 violate explicit user intent, and L13 gives nondeterministic unsupported feature claims. The lack of schema failures is a strong improvement but does not compensate for these correctness defects.

## Scope and limitations

- Live evidence was collected through the real production API and configured OpenAI provider, not through the deterministic E2E mock.
- The browser E2E suite verifies UI mechanics under its configured deterministic provider; it is not evidence that live OpenAI semantics are correct.
- Product cards were checked against the returned trusted DummyJSON fields (title, description, tags, category, price, rating, and stock). No external product-fact claims were added.
- The current catalog snapshot and current model behavior were tested on 2026-10-30. Provider nondeterminism means repeated coverage lowers but does not eliminate residual risk.
- The application did not expose token usage, dollar cost, or a per-request model-attempt counter. Therefore only application POST counts and observed final results are reported.
- No security, load, accessibility audit, deployment, or provider-configuration change was performed.

## Recommendation

Do not request final QA sign-off yet. Fix the four residual defects above, then rerun at minimum:

1. N10 twice and an English `Only the fragrance...` control, verifying that excluded sibling outcomes are absent from the final API/UI result.
2. L07 plus paraphrases using `not stated`, `doesn't mention`, and `do not guess`, while preserving true brand-exclusion cases.
3. L13 at least five times in Hebrew plus L15 in English, asserting every returned fragrance card contains trusted evening evidence.
4. L04 plus `no more than $300` single-product and `at least $300` controls, verifying maximum/minimum language is classified distinctly.
