# Submission QA: final live semantic-rerank comparison

Date: 2026-10-31
Experiment under test: `859ea57a024d40077c79e084951e8b4eeb82de93` (`local/semantic-evidence-shadow`)
Published baseline: `828f4e88405007aaa62c9359a32fe1a81df29194`
Live provider: configured OpenAI provider
Verdict: **the experiment is the stronger submission candidate, with one newly observed Q02 ranking/tier regression and materially higher latency than baseline.**

## Scope and integrity

- Exactly 15 approved application requests were sent: the original Q01–Q15 prompts, one attempt each. No repeats and no requests beyond the approved bound.
- Every request returned HTTP 200 with `status: completed`; harness errors: 0.
- The server used `BAZAK_DATABASE_PATH=/tmp/bazak-submission-live.2ZQTj3/commerce.sqlite`. The isolated database contains exactly 15 conversations (`submission-live-q01` through `submission-live-q15`). The shared `var/data/commerce.sqlite` contains 0 conversations with the `submission-live-%` prefix.
- The production build was fresh. Before the live run, both versions had passed lint, typecheck and build; experiment unit/integration tests were 357/357 and baseline 312/312. Both passed 34/34 Playwright tests with `LLM_PROVIDER=disabled` (those are deterministic tests, not live-AI evidence).
- Server diagnostics show 15 intent-planner completions and 16 semantic-evaluator completions (Q15 has two intents). The application does not expose upstream token counts or monetary cost, so neither is claimed.
- Representative UI restoration was checked without additional AI calls: Q02, Q05, Q06, Q08, Q10, Q11 and Q15. Cards, evidence labels, scores, prices and empty-state copy matched the saved API results.
- Important correction to earlier reports: earlier live harnesses set `DATABASE_PATH`, but the application reads `BAZAK_DATABASE_PATH`; those earlier test-labeled conversations were therefore written to the shared local app DB. No existing rows were deleted, and no cleanup was attempted. This run used the correct isolated variable.

Quality scale: 0 complete failure, 1 poor/major issue, 2 weak/substantial fixes, 3 acceptable but noticeably flawed, 4 good/minor improvement, 5 excellent. Creativity is a separate 0–5 scale.

## Quantified comparison

Against the published baseline, using the 15 unique scenarios as the denominator:

- Improved: **15/15 (100%)**
- Unchanged: **0/15 (0%)**
- Worsened: **0/15 (0%)**
- Unscorable: **0**

Against the first experiment (`d3e26b7`): improved 14/15 (93.3%), unchanged 1/15 (6.7%, Q03), worsened 0/15.

Against the prior full remediation (`7be1a5b`): improved 3/15 (20.0%: Q08, Q10, Q11), unchanged 11/15 (73.3%), worsened 1/15 (6.7%: Q02). This comparison matters because Q02 previously passed at 5/5, but the current single attempt misclassified the strongest selfie match.

Current score total: **69/75, mean 4.60/5**. Published baseline: **22/75, mean 1.47/5**.

## Scenario results

### Q01 — camera-phone metaphor

- Input: `A pocket camera that also happens to be a phone, under $700.`
- Creativity: 3/5.
- Expected: all results at most $700; direct camera evidence first; no candidate-cap false unknown labels.
- Baseline: camera phones but no evidence labels; quality 3/5.
- Current: Realme XT `supported 98`, S8/X21/Oppo F19 `97`, S7 `96`, Realme X/S10 `95`, followed by lower-supported/unknown options. All prices were at most $700; all 14 candidates were assessed. The S8 was out of stock, but stock was not requested.
- Quality: **5/5**. Attempts: 1. Latency: 9,652 ms.

### Q02 — Hebrew selfie specificity

- Input: `אני רוצה טלפון לסלפי חד ומחמיא, עד 400 דולר — לא סתם טלפון עם מצלמה.`
- Creativity: 4/5.
- Expected: Vivo V9 first because the catalog explicitly says `emphasis on capturing high-quality selfies`; every price at most $400.
- Baseline/first experiment: false brand-exclusion failure; quality 1/5.
- Prior remediation: Vivo V9 `supported 97` first; quality 5/5.
- Current: S7 `partial 74`, Vivo S1 `partial 72`, Oppo F19 `partial 63`, Realme X `partial 60`, then Vivo V9 `unknown 98` with `No direct catalog-text proof`. The UI visibly repeats this contradiction directly above the catalog sentence containing `high-quality selfies`. Prices did stay at or below $400.
- Classification: **confirmed live semantic-tier/ranking regression; likely nondeterministic model evaluation, root cause not proven by one attempt**.
- Quality: **2/5**. Attempts: 1. Latency: 5,754 ms.

### Q03 — stylish and reliable, highest relevance first

- Input: `Show me phones with stylish design and reliable performance, highest relevance score first.`
- Creativity: 2/5.
- Expected: Oppo K1 then Vivo S1, with related products afterward; tier-first behavior must be transparent.
- Baseline: K1 first but weaker lexical order below it; quality 3/5.
- Current: Oppo K1 `supported 98`, Vivo S1 `supported 96`; partial and unknown products followed. Ordering is tier-first then score, as the UI states, rather than a global numeric-score sort.
- Quality: **5/5**. Attempts: 1. Latency: 7,813 ms.

### Q04 — compact, reliable, non-flagship price

- Input: `I want a compact, reliable smartphone without paying flagship money.`
- Creativity: 3/5.
- Expected: value language must not become an exclusion; Realme C35 and compact iPhone 5s should lead.
- Baseline/first experiment: false brand-exclusion failure; quality 1/5.
- Current: Realme C35 `partial 92`, iPhone 5s `partial 86`, then lower partial/unknown value phones. The catalog cannot fully verify both subjective conditions, so no product was mislabeled as supported.
- Quality: **5/5**. Attempts: 1. Latency: 7,281 ms.

### Q05 — strict high-resolution evidence

- Input: `Only show phones whose catalog listing confirms a high-resolution display.`
- Creativity: 3/5.
- Expected: exactly Vivo X21 and Galaxy S7.
- Baseline/first experiment: all generic phones; quality 1/5.
- Current/API/UI: exactly Vivo X21 and Galaxy S7, each `supported 100`, each with the literal high-resolution quote. No generic phones.
- Quality: **5/5**. Attempts: 1. Latency: 6,730 ms.

### Q06 — strict nonexistent satellite-calling evidence

- Input: `Only show phones whose listing actually confirms satellite calls.`
- Creativity: 4/5.
- Expected: honest empty result because no catalog phone states this feature.
- Baseline/first experiment: all generic phones; quality 0/5.
- Current/API/UI: zero products and honest copy: `The catalog does not state the requested feature, so I won’t present generic products as verified matches.`
- Quality: **5/5**. Attempts: 1. Latency: 5,603 ms.

### Q07 — browser-tabs laptop

- Input: `A laptop for living in browser tabs, but keep it under $1,500.`
- Creativity: 3/5.
- Expected: all under $1,500; Dell is the strongest documented performance candidate; avoid inventing RAM/CPU facts.
- Baseline/first experiment: three laptops without dependable semantic evidence; quality 3/5.
- Current: Dell `partial 68` first; Huawei `unknown 49`, Yoga `unknown 44`; all prices under $1,500. The weak catalog cannot verify the workload strongly.
- Quality: **4/5**. Attempts: 1. Latency: 4,215 ms.

### Q08 — strict documented slim laptop

- Input: `Only documented slim laptops under $1,500, please — no guessing from the photo.`
- Creativity: 2/5.
- Expected: Huawei Matebook X Pro only; its description explicitly says `slim and stylish`, price $1,399.99.
- Baseline: Huawei first but two over-inclusive products; quality 3/5. First experiment/prior remediation: false empty; quality 1/5.
- Current/API/UI: exactly Huawei Matebook X Pro, `supported 100`, with direct quote and correct price.
- Quality: **5/5**. Attempts: 1 in this matrix; an earlier targeted run on the same commit also passed 3/3. Latency: 3,802 ms.

### Q09 — basketball shoes with everyday backups

- Input: `Shoes for shooting hoops, though everyday sporty ones can be backups.`
- Creativity: 3/5.
- Expected: basketball shoe first, then clearly labeled sporty alternatives.
- Baseline/first experiment: category resolution failed; quality 1/5.
- Current: Air Jordan Red And Black `supported 98`, three sporty alternatives `partial 72/55/40`, baseball cleats `unknown 22`. The two planned shoe intents were coalesced into one user-facing result.
- Quality: **5/5**. Attempts: 1. Latency: 5,523 ms.

### Q10 — red/black in-stock basketball shoe

- Input: `I want red-and-black basketball shoes that are actually in stock.`
- Creativity: 2/5.
- Expected: Nike Air Jordan 1 Red And Black, stock 7, verified first.
- Baseline/first experiment: no products; quality 0/5. Prior remediation: correct item but only partial; quality 4/5.
- Current/API/UI: exact Air Jordan first, stock 7, `supported 98`; all displayed alternatives also pass the deterministic in-stock constraint and are clearly unknown.
- Quality: **5/5**. Attempts: 1 in this matrix; earlier same-commit targeted run passed 3/3. Latency: 5,540 ms.

### Q11 — evening perfume with negative contrast

- Input: `A perfume that feels right after sunset, under $150 — not a daytime freshie.`
- Creativity: 2/5.
- Expected: Chanel Coco Noir first; CK One must not satisfy the negative preference; all prices at most $150.
- Baseline/first experiment: false exclusion failure; quality 1/5. Prior remediation: CK One incorrectly prominent; quality 3/5.
- Current: Chanel `supported 100` first with `Perfect for evening occasions`; three unknown alternatives followed. CK One was assessed as contradicted and filtered from the result. All prices pass.
- Quality: **5/5**. Attempts: 1 in this matrix; earlier same-commit targeted run passed behavior 3/3 with minor label variability. Latency: 5,256 ms.

### Q12 — warm cozy cold-evening scent

- Input: `Warm, cozy scent for a cold evening; show close alternatives after exact matches.`
- Creativity: 5/5.
- Expected: resolve scent to fragrances; evening evidence first; weak alternatives clearly qualified.
- Baseline/first experiment: category resolution failed; quality 1/5.
- Current: Chanel `supported 99` first; CK One and three other scents `unknown 18–20`. Evening is supported, but warm/cozy is not literal catalog evidence.
- Quality: **4/5**. Attempts: 1. Latency: 4,573 ms.

### Q13 — Hebrew mascara by desired effect

- Input: `איפור לריסים שצריכים דרמה ונפח — אני לא זוכרת איך קוראים למוצר.`
- Creativity: 4/5.
- Expected: Essence Mascara first with dramatic/volumizing evidence.
- Baseline/first experiment: Hebrew negation phrase misread as exclusion; quality 1/5.
- Current: Essence Mascara `supported 99` first; unrelated beauty products followed as `unknown 1`.
- Quality: **5/5**. Attempts: 1. Latency: 5,534 ms.

### Q14 — shine-control lightweight makeup

- Input: `Makeup that controls shine with a lightweight finish.`
- Creativity: 2/5.
- Expected: Powder Canister first with literal evidence.
- Baseline/first experiment: category resolution failed; quality 1/5.
- Current: Powder Canister `supported 100` first; four unrelated beauty products clearly unknown and low-scored.
- Quality: **5/5**. Attempts: 1. Latency: 6,217 ms.

### Q15 — two intents with scoped budget

- Input: `Find me a camera phone and an evening fragrance under $80 — the budget is for the fragrance.`
- Creativity: 5/5.
- Expected: two intents; $80 applies only to fragrance; strong camera evidence first; under-$80 fragrance alternatives must not be claimed as verified evening matches.
- Baseline: camera results plus honest empty fragrance; quality 3/5. First experiment: response/card contradiction and candidate-cap error; quality 2/5.
- Current/API/UI: two intents. Camera intent has ten supported products headed by Realme XT/iPhone 13 Pro/S10 `99`; phone prices are correctly uncapped. Fragrance intent has CK One, Dolce Shine and Gucci, all under $80 and explicitly `unknown 12` with `No direct catalog-text proof`. Global copy truthfully explains that unverified alternatives follow verified matches.
- Quality: **4/5** because CK One is an everyday fragrance and remains first among unverified evening alternatives. Attempts: 1. Latency: 6,248 ms.

## Latency and provider-call observations

Current 15-request run: mean 5,983 ms; median 5,603 ms; min 3,802 ms; max 9,652 ms.

Existing measured medians (different runs, so descriptive rather than controlled performance benchmarking): published baseline 1,849 ms; first experiment 3,715 ms; prior remediation 5,361 ms; current 5,603 ms. Current live behavior is materially more accurate, but its median was about 3.03× the published baseline median.

Application-level counts: 15 HTTP requests, 15 planner operations and 16 semantic evaluator operations. Exact upstream HTTP request count may differ because provider-library retries are not surfaced. Token and cost data were not visible.

## Decision and remaining risk

**Best submission candidate: `859ea57`.** It is the only tested state that fixes strict slim-laptop evidence, exact basketball-shoe verification and the negative evening-fragrance case while retaining the broader remediation gains. It passed all deterministic checks and improved all 15 scenarios over published baseline by the defined rubric.

Do not describe it as fully stable. Q02 is a concrete live regression relative to `7be1a5b`: the evaluator assigned `unknown 98` with no evidence to Vivo V9 even though its displayed description explicitly says high-quality selfies. This was one approved attempt, so the product defect is confirmed for that run while reproducibility and root cause remain unproven. The model-based tiering is known to vary across attempts. A bounded repeated Q02 retest is the highest-value remaining live check before submission; it requires separate approval for additional OpenAI calls.

Other residual limitations:

- Semantic evaluation adds substantial latency and additional provider usage.
- Subjective requests with sparse catalog text (Q07, Q12, Q15 fragrance) remain honestly labeled but cannot become strong verified matches.
- Tier-first ordering intentionally overrides global numeric-score ordering; the UI now states this, but it differs from a literal `highest score first` interpretation.
- Security testing, load/concurrency, accessibility audit, mobile breakpoints and provider-failure injection were outside this live run.

## Evidence locations

- Raw live result bundle: `/tmp/bazak-submission-live.2ZQTj3/results.json` (temporary)
- Isolated SQLite database: `/tmp/bazak-submission-live.2ZQTj3/commerce.sqlite` (temporary)
- Original baseline/first-experiment report: `outputs/QA_SEMANTIC_RERANK_AB_LIVE_2026-10-31.md`
- Prior 27-attempt remediation report: `outputs/QA_SEMANTIC_RERANK_FIX_LIVE_RETEST_2026-10-31.md`
- Same-commit targeted repetition report: `outputs/QA_SEMANTIC_THREE_CASE_LIVE_RETEST_2026-10-31.md`
