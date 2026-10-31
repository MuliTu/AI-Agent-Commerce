# Live semantic-reranker remediation retest

Date: 2026-10-31
Candidate: `7be1a5b8733dad6849f0783d89acae6977722b6d` on `local/semantic-evidence-shadow`
Comparison sources: published baseline `828f4e8`; first experiment `d3e26b7`; current remediation `7be1a5b`
Overall: **major measurable improvement, but not release-clean. Q08 remains a stable strict-evidence false negative.**

## Scope and integrity

- Fresh production build of the exact candidate passed.
- Local suite passed: **30 files, 352 tests**.
- Real configured OpenAI provider and real DummyJSON catalog were used with a fresh isolated SQLite database.
- Exact original 15 prompts were replayed. Q01, Q03, Q05, Q06, Q08 and Q15 were each run three times, producing **27 live application requests** total.
- All 27 returned HTTP 200 and completed application results; no harness exceptions occurred.
- Observable orchestration operations: 27 planner invocations and 30 semantic-evaluator invocations (Q15 has two intents), or 57 model-operation invocations at the application layer. Exact upstream HTTP call count may differ if the SDK/provider retries internally and is therefore not claimed.
- Token usage and cost were not surfaced: **N/A**.
- Existing user data was not touched. No product code, credentials or configuration were changed.

Quality scale: 0 complete failure; 1 poor/major issue; 2 weak; 3 acceptable but noticeably flawed; 4 good/minor improvement; 5 excellent. Creativity is a separate 0–5 scale.

## Percentage change

The denominator is the **15 unique scenarios**, using the first current attempt and the same quality rubric from the original report. All 15 were scorable; unscorable count is 0. Repeated attempts are excluded from the percentage denominator and reported separately under stability.

### Current remediation versus first experiment

- Improved: **13/15 = 86.7%**
- Unchanged: **2/15 = 13.3%** — Q03 remained excellent; Q08 remained poor.
- Worsened: **0/15 = 0%**
- Unscorable: **0**

### Current remediation versus published baseline

- Improved: **14/15 = 93.3%**
- Unchanged: **0/15 = 0%**
- Worsened: **1/15 = 6.7%** — Q08, because baseline at least returned Huawei first while current strict mode returns empty.
- Unscorable: **0**

These percentages measure scenario-quality-score direction, not an objective model-accuracy percentage.

## Latency

| Sample | Mean | Median | Min | Max |
|---|---:|---:|---:|---:|
| Current, 15 unique first attempts | 5,586 ms | 5,361 ms | 3,790 ms | 8,685 ms |
| Current, all 27 attempts | 5,665 ms | 5,369 ms | 3,790 ms | 8,685 ms |
| First experiment, 15 unique | 3,350 ms | 3,715 ms | — | 8,164 ms |
| Published baseline, 15 unique | 1,583 ms | 1,849 ms | — | 4,317 ms |

Current quality is substantially better, but latency is worse: current unique-run median is about 1.44× the first experiment median and 2.90× baseline median.

## Scenario-by-scenario comparison

### Q01 — camera phone metaphor

**Input:** `A pocket camera that also happens to be a phone, under $700.`
**Creativity:** 3/5
**Expectation:** respect $700; direct camera evidence first; Galaxy S10 must not be mislabeled merely because of candidate truncation.
**Baseline:** Realme XT, S8, X21, Realme X, Oppo F19, Vivo V9, Vivo S1, S7, S10; no evidence labels. **3/5.**
**First experiment:** strong camera ordering, but Galaxy S10 was `unknown 0` because only 12 candidates were evaluated. **4/5.**
**Current:** all three attempts evaluated 14 candidates. Attempt 1 order: Realme XT/Oppo F19 `supported 98`, S8/X21/S10 `supported 97`, Realme X 96, S7 95, Vivo V9 94, Vivo S1 86, then five unknown 8. Galaxy S10 is now correctly evaluated as supported. Price constraint held. Latencies: 8,685 / 5,713 / 5,550 ms. **5/5.**

### Q02 — Hebrew selfie specificity

**Input:** `אני רוצה טלפון לסלפי חד ומחמיא, עד 400 דולר — לא סתם טלפון עם מצלמה.`
**Creativity:** 4/5
**Expectation:** Vivo V9 first due explicit high-quality-selfie text; all prices at most $400.
**Baseline / first experiment:** both failed before retrieval because `לא סתם` was misread as brand exclusion. **1/5 / 1/5.**
**Current:** Vivo V9 `supported 97` first with exact selfie quote; Vivo S1 `partial 63`, S7 `partial 55`, then clearly unknown camera alternatives. Eleven returned phones all satisfy $400. 6,315 ms. **5/5.**

### Q03 — stylish and reliable, highest relevance first

**Input:** `Show me phones with stylish design and reliable performance, highest relevance score first.`
**Creativity:** 2/5
**Expectation:** Oppo K1 first, Vivo S1 second, related items afterward.
**Baseline:** K1 first but Realme C35 incorrectly preceded Vivo S1. **3/5.**
**First experiment:** K1 `supported 99`, Vivo S1 `98`, related items after them. **5/5.**
**Current:** stable top two across all attempts: K1 and Vivo S1, both supported 98–100. Lower supported/partial membership varied (for example iPhone 6 was supported in attempts 1 and 3 but partial in attempt 2), demonstrating model nondeterminism below the top. Latencies: 7,085 / 7,429 / 7,582 ms. **5/5.** Tier-first still intentionally takes precedence over a global numeric-score sort.

### Q04 — compact reliable without flagship pricing

**Input:** `I want a compact, reliable smartphone without paying flagship money.`
**Creativity:** 3/5
**Expectation:** budget/value language must not become brand exclusion; Realme C35 and iPhone 5s should lead.
**Baseline / first experiment:** both failed with false brand-exclusion copy. **1/5 / 1/5.**
**Current:** Realme C35 `partial 96`, iPhone 5s `partial 89`, Oppo A57 `partial 78`, followed by unknown alternatives. 7,298 ms. **5/5.**

### Q05 — strict high-resolution display

**Input:** `Only show phones whose catalog listing confirms a high-resolution display.`
**Creativity:** 3/5
**Expectation:** only Vivo X21 and Galaxy S7, which literally state high-resolution display.
**Baseline:** all 16 phones. **1/5.**
**First experiment:** all 16 after `invalid_assessment` fallback, with no labels. **1/5.**
**Current:** all three attempts returned exactly Vivo X21 and Galaxy S7, both `supported 100` with exact quotes; no generic phones. UI says “2 evaluated catalog-backed options.” Latencies: 5,361 / 5,296 / 6,400 ms. **5/5.**

### Q06 — strict nonexistent satellite calls

**Input:** `Only show phones whose listing actually confirms satellite calls.`
**Creativity:** 4/5
**Expectation:** honest empty result because no catalog phone states satellite calling.
**Baseline:** all 16 generic phones. **0/5.**
**First experiment:** all 16 after semantic fallback. **0/5.**
**Current:** three stable empty results with `catalog_evidence_unavailable`, `semanticStatus: applied`, and honest copy that the catalog does not state the feature. Latencies: 5,036 / 5,030 / 4,826 ms. **5/5.**

### Q07 — laptop for many browser tabs

**Input:** `A laptop for living in browser tabs, but keep it under $1,500.`
**Creativity:** 3/5
**Expectation:** all under $1,500; Dell is the strongest documented performance candidate; avoid claiming unsupported RAM/CPU facts.
**Baseline:** Dell, Huawei, Yoga without evidence labels. **3/5.**
**First experiment:** Huawei, Dell, Yoga after semantic fallback. **3/5.**
**Current:** Dell `partial 74` first; Huawei `unknown 78`, Yoga `unknown 71`. Evidence tier correctly keeps the supported-related Dell before higher-scored unknowns; all prices pass. 4,307 ms. **4/5** because catalog evidence remains weak and the use-case cannot be strongly verified.

### Q08 — strict documented slim laptop

**Input:** `Only documented slim laptops under $1,500, please — no guessing from the photo.`
**Creativity:** 2/5
**Expectation:** Huawei Matebook X Pro must be returned: $1,399.99 and description explicitly says `slim and stylish`.
**Baseline:** Huawei, Yoga, Dell, with Huawei correctly first but over-inclusive. **3/5.**
**First experiment:** empty; all three assessments were partial and strict filtering removed them. **1/5.**
**Current:** still empty in all three attempts. Evaluator completed and produced only partial/unknown verdicts; deterministic promotion did not recover Huawei. UI repeats the false statement that the catalog does not state the requested feature. Latencies: 4,304 / 4,349 / 4,434 ms. **1/5. Confirmed unresolved blocker.**

### Q09 — basketball shoes with sporty backups

**Input:** `Shoes for shooting hoops, though everyday sporty ones can be backups.`
**Creativity:** 3/5
**Expectation:** basketball shoe first, then clearly related sporty alternatives.
**Baseline / first experiment:** category resolution failed; experiment also split into two failed intents. **1/5 / 1/5.**
**Current:** one coalesced result: Air Jordan 1 Red And Black `supported 98`, then three sports sneakers `partial 80/78/74`, baseball cleats unknown. 5,720 ms. **5/5.**

### Q10 — exact red/black in-stock basketball shoe

**Input:** `I want red-and-black basketball shoes that are actually in stock.`
**Creativity:** 2/5
**Expectation:** Nike Air Jordan 1 Red And Black, stock 7, as verified top match.
**Baseline / first experiment:** category resolution failed, no products. **0/5 / 0/5.**
**Current:** exact Air Jordan is first, stock 7, with title and description evidence; four in-stock alternatives follow. However the exact match is labeled only `partial 98` / “Related, not fully verified,” despite title and description satisfying color and basketball use. UI reproduced this under-classification. 5,106 ms. **4/5.**

### Q11 — evening perfume, not daytime fresh

**Input:** `A perfume that feels right after sunset, under $150 — not a daytime freshie.`
**Creativity:** 2/5
**Expectation:** Chanel Coco Noir first and under $150; CK One should not be treated as satisfying the negative daytime condition.
**Baseline / first experiment:** false brand-exclusion failure. **1/5 / 1/5.**
**Current:** Chanel Coco Noir `supported 99` first with exact `Perfect for evening occasions` quote and $129.99 price. CK One is still shown second as `partial 78` using its contradictory everyday-wear evidence, followed by unknowns. 4,185 ms. **3/5** because the main answer is correct but the explicitly unwanted daytime product remains a relatively prominent alternative.

### Q12 — warm cozy cold-evening scent

**Input:** `Warm, cozy scent for a cold evening; show close alternatives after exact matches.`
**Creativity:** 5/5
**Expectation:** resolve `scent` to fragrances; evening evidence first, then clearly qualified alternatives.
**Baseline / first experiment:** category resolution failed. **1/5 / 1/5.**
**Current:** Chanel Coco Noir `supported 98` first; CK One and three other fragrances explicitly unknown and lower scored. 3,790 ms. **4/5** because evening suitability is supported, but “warm/cozy” is not directly stated and alternatives are weak.

### Q13 — Hebrew mascara by effect

**Input:** `איפור לריסים שצריכים דרמה ונפח — אני לא זוכרת איך קוראים למוצר.`
**Creativity:** 4/5
**Expectation:** Essence Mascara Lash Princess first with dramatic/volumizing evidence.
**Baseline / first experiment:** `לא זוכרת` was misread as brand exclusion. **1/5 / 1/5.**
**Current:** Essence Mascara `supported 99` first; unrelated beauty products follow as unknown 1–2. 5,369 ms. **5/5.**

### Q14 — shine-control lightweight makeup

**Input:** `Makeup that controls shine with a lightweight finish.`
**Creativity:** 2/5
**Expectation:** Powder Canister first with exact catalog evidence.
**Baseline / first experiment:** `makeup` did not resolve to beauty. **1/5 / 1/5.**
**Current:** Powder Canister `supported 99` first; four unrelated beauty products clearly unknown. 5,098 ms. **5/5.**

### Q15 — camera phone plus evening fragrance, budget scoped to fragrance

**Input:** `Find me a camera phone and an evening fragrance under $80 — the budget is for the fragrance.`
**Creativity:** 5/5
**Expectation:** two isolated intents; $80 only on fragrance; camera evidence first; no under-$80 fragrance has explicit evening evidence, so either honest empty or clearly labeled unverified alternatives without a verified-only claim.
**Baseline:** camera phones plus honest empty fragrance result. **3/5.**
**First experiment:** improved camera ranking, but global copy falsely claimed only trusted-text matches while three fragrances were `unknown`; Galaxy S10 also became `unknown 0` due candidate cap. **2/5.**
**Current:** all three attempts preserved two intents and scoped $80 only to fragrances. Camera intent evaluates all 16 and consistently places explicit camera phones in supported tier; Galaxy S10 is now supported 96–100. Fragrance intent returns CK One, Dolce Shine and Gucci, all clearly `unknown` with low scores and `No direct catalog-text proof`. Global copy now truthfully says verified matches appear first and unverified alternatives follow. Latencies: 6,125 / 5,876 / 6,690 ms. **4/5** because the contradiction and truncation are fixed, but CK One is an explicitly everyday fragrance and remains first among the evening alternatives.

## Repetition and nondeterminism

- Q01: top camera cohort and Galaxy S10 support were stable; exact score varied 86–100 and lower unknown ordering varied.
- Q03: Oppo K1 and Vivo S1 remained the top supported pair, but lower products shifted between supported, partial and unknown.
- Q05: exact two-product strict result stable across 3/3.
- Q06: honest empty strict result stable across 3/3.
- Q08: false empty result stable across 3/3; this is deterministic enough to treat as a real remaining defect, not a one-off model miss.
- Q15: intent split, scoped budget, camera support and transparent fragrance unknown labels were stable across 3/3; exact scores and camera ordering varied.

## UI verification

The current production UI was inspected by restoring existing isolated conversations, without additional model calls:

1. Q05 visibly shows exactly two `Verified match` cards, each `AI relevance: 100/100`, and states evidence-tier-first ordering.
2. Q08 visibly shows `NO MATCHING OPTIONS`, reproducing the false negative.
3. Q10 visibly shows the correct in-stock Air Jordan first, but as `Related, not fully verified` rather than verified.
4. Q15 visibly shows supported camera cards and `Unverified relevance` / `No direct catalog-text proof` for all fragrances; the former contradictory verified-only response is gone.

## Verified improvements from commit `7be1a5b`

- Contextual English/Hebrew negation fixes unblock Q02, Q04, Q11 and Q13.
- Category aliases and alternative-intent coalescing unblock Q09, Q10, Q12 and Q14.
- Strict natural `confirms` handling fixes Q05 and Q06.
- Candidate coverage fixes Q01/Q15: no unevaluated product is mislabeled `unknown 0`; Galaxy S10 is actually assessed.
- Visible response copy now derives from semantic status/tiers and removes Q15’s verified-only contradiction.
- Strict nonexistent evidence fails closed stably.

## Remaining defects and risks

1. **P0/P1: Q08 strict literal evidence remains broken.** Huawei’s direct `slim and stylish` text is still not promoted to supported; strict filtering returns empty and misleading copy.
2. **Q10 exact-match under-classification:** exact red/black basketball product is only partial despite strong literal evidence.
3. **Negative descriptive preference is not enforced semantically:** Q11 still gives CK One a relatively high partial score despite explicit `not a daytime freshie` and catalog evidence that it is everyday.
4. **Q15 alternatives include an opposite-use product:** CK One leads the unknown evening alternatives even though it is explicitly everyday.
5. **Latency regression:** current median is materially slower than both prior variants.
6. Model tier/score nondeterminism remains below the stable leading matches; scores are advisory, not objective truth.

## VerificationReport

```yaml
ticket_id: semantic-reranker-live-remediation
candidate_revision: 7be1a5b8733dad6849f0783d89acae6977722b6d
criteria:
  - id: replay-original-15
    status: pass
    evidence: 15 exact prompts, 27 total live requests, no harness errors
  - id: strict-positive-negative
    status: fail
    evidence: Q05 and Q06 pass 3/3; Q08 fails 3/3 despite direct Huawei evidence
  - id: eliminate-unevaluated-unknown-zero
    status: pass
    evidence: Q01/Q15 evaluate displayed phone candidates; Galaxy S10 receives supported evidence
  - id: truthful-visible-copy
    status: pass
    evidence: Q15 UI labels unknown alternatives and no longer claims verified-only output
  - id: upstream-language-category-remediation
    status: pass
    evidence: Q02/Q04/Q09-Q14 now retrieve relevant catalog categories/products
checks:
  - command: npm run build
    exit_code: 0
    result: production build passed
  - command: npm test
    exit_code: 0
    result: 30 files / 352 tests passed
  - command: node /tmp/bazak-semantic-final-retest.mjs
    exit_code: 0
    result: 27/27 completed HTTP 200
changed_scope: implementation commit inspected; QA added only this new report
regressions_checked: hard price/stock filters, strict evidence, category aliases, negation, multi-intent isolation, UI labels, fallback/status copy
limitations: provider tokens/cost and hidden retry-level HTTP calls are not exposed; six scenarios repeated, nine run once
residual_risks: Q08 blocker, Q10 under-classification, negative-preference handling, latency, model nondeterminism
overall: fail
```

## Decision

`7be1a5b` is a large, evidence-backed improvement over both baseline and the first experiment: 86.7% of the unique scenarios improved versus the first experiment and none worsened. It should nevertheless remain local/experimental until Q08 is fixed and rerun. The remaining Q10/Q11/Q15 relevance issues and latency should also be addressed or explicitly accepted before publication.
