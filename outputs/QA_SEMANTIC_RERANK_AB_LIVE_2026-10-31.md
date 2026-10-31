# Live A/B QA — semantic evidence reranker

Date: 2026-10-31
Experiment: `local/semantic-evidence-shadow` at `d3e26b76333fb8f063fb5af2eee007a5eca39098`
Baseline: detached worktree at published `828f4e8`
Verdict: **Do not publish the experiment as-is.** It materially improves ordering when planning succeeds, but strict-evidence behavior, fallback transparency, candidate truncation, latency, and several pre-reranker language/category failures remain release blockers.

## Scope and method

- Real production builds, real configured OpenAI provider, and the public DummyJSON catalog were used. No mocks were counted as live evidence.
- Both variants used isolated SQLite databases and separate servers (`3350` baseline, `3351` experiment). Existing conversations and user data were not touched.
- A single catalog snapshot containing 194 products was captured before the run and used to ground expectations.
- 15 distinct prompts were sent once to each variant: **30 live application API requests** total. No request-level harness errors occurred.
- Exact downstream OpenAI request count, tokens, and cost are not exposed by the application, so they are **N/A rather than estimated**. Experiment requests can include planner and semantic-evaluator calls; the report does not pretend that 30 app requests equals 30 provider calls.
- UI was inspected by restoring four saved experiment conversations (Q03, Q05, Q08, Q15). No extra model requests were sent for UI inspection.
- Local verification: experiment production build passed; `npm test` passed **30 files / 333 tests**.

Quality scale: 0 complete failure, 1 poor/major issue, 2 weak/substantial fixes, 3 acceptable but flawed, 4 good/minor improvement, 5 excellent. Creativity is a separate 0–5 scale.

Important caveat: semantic scores are model judgments, not objective truth. Exact quotes were checked against catalog text; scores were assessed only by whether their relative ordering and label were reasonable for the request.

## Catalog-grounded reference facts

- Camera phones: Realme XT explicitly focuses on camera technology, sensors, photos/video; Oppo F19 Pro Plus explicitly focuses on camera capabilities and photography; Vivo V9 explicitly emphasizes high-quality selfies; Galaxy S10 explicitly has a versatile camera system.
- Stylish + reliable: Oppo K1 literally says “stylish design and reliable performance”; Vivo S1 says stylish and reliable functionality.
- High-resolution display: Vivo X21 and Galaxy S7 explicitly say “high-resolution display.”
- Satellite calling: no smartphone description in the snapshot states it.
- Slim laptop under $1,500: Huawei Matebook X Pro is $1,399.99 and its description explicitly says “slim and stylish.” Dell XPS 13 is $1,499.99; Lenovo Yoga 920 is $1,099.99, but neither has equally direct “slim” wording.
- Shoes: Air Jordan 1 Red And Black is a red/black basketball shoe with stock 7.
- Fragrance: Chanel Coco Noir is $129.99 and explicitly described for evening wear; CK One is explicitly fresh/clean/everyday; no fragrance below $80 explicitly says evening.
- Beauty: Essence Mascara Lash Princess explicitly promises dramatic/volumizing/lengthening; Powder Canister explicitly controls shine with a lightweight finish.

## Executive comparison

| Outcome | Count |
|---|---:|
| Clear experiment ranking improvement | 2 (Q01, Q03) |
| Experiment regression | 2 (Q08, Q15) |
| No meaningful experiment benefit / shared failure | 11 |
| Experiment responses with visible semantic annotations | 3 scenarios (Q01, Q03, Q15) |
| Observed semantic fallback/no annotations after a semantic-eligible request | 3 scenarios (Q05, Q06, Q07) |

Latency across all 15 requests per variant:

| Variant | Mean | Median | Max (observed) |
|---|---:|---:|---:|
| Baseline | 1,583 ms | 1,849 ms | 4,317 ms |
| Experiment | 3,350 ms | 3,715 ms | 8,164 ms |

The experiment mean was about **2.12×** baseline and median about **2.01×**. The slowest experiment request was Q01 at 8.164 s.

## Scenario results

### Q01 — metaphorical camera phone (creativity 3/5)

**Input:** `A pocket camera that also happens to be a phone, under $700.`
**Expected (proposed, catalog-grounded):** enforce max $700; put explicit camera descriptions first; Galaxy S10 should remain a related camera match rather than unverified merely because it is late in the lexical candidate list.
**Baseline actual (4,317 ms):** Realme XT, Galaxy S8, Vivo X21, Realme X, Oppo F19 Pro Plus, Vivo V9, Vivo S1, Galaxy S7, Galaxy S10. No evidence labels.
**Experiment actual (8,164 ms):** Realme XT supported 98; Oppo F19 Pro Plus 98; Galaxy S8 97; Vivo X21 97; Realme X 95; Galaxy S7 94; Vivo V9 90; Vivo S1 86; then Realme C35 unknown 12, iPhone 6 unknown 10, Oppo K1 unknown 8, Oppo A57 unknown 8, Galaxy S10 unknown 0, iPhone 5s unknown 0.
**Assessment:** confirmed improvement at the top and price constraint held. Confirmed candidate-limit defect: Galaxy S10 has explicit “versatile camera system” catalog evidence but was outside the 12 evaluated candidates and was appended as unknown 0.
**Quality:** baseline 3/5; experiment 4/5. **Attempts:** 1 each.

### Q02 — Hebrew selfie specificity (creativity 4/5)

**Input:** `אני רוצה טלפון לסלפי חד ומחמיא, עד 400 דולר — לא סתם טלפון עם מצלמה.`
**Expected (proposed):** under $400; Vivo V9 should lead because its description explicitly emphasizes high-quality selfies; ordinary camera phones may follow as partial matches.
**Actual, both:** failed before retrieval with “סינון שמחריג מותג אינו נתמך כרגע”; 123 ms baseline / 372 ms experiment; no cards.
**Assessment:** confirmed upstream Hebrew negation false-positive (`לא סתם`) interpreted as brand exclusion. Reranker never ran.
**Quality:** 1/5 both. **Attempts:** 1 each.

### Q03 — literal stylish + reliable, asks highest score first (creativity 2/5)

**Input:** `Show me phones with stylish design and reliable performance, highest relevance score first.`
**Expected (specified by input + catalog):** Oppo K1 first, Vivo S1 next, related partial matches afterward; score ordering should be understandable.
**Baseline actual (1,849 ms):** Oppo K1, Realme C35, Vivo S1, iPhone 6, iPhone 13 Pro, Realme XT, Oppo A57, Galaxy S8, Vivo X21, Realme X, Oppo F19 Pro Plus, Galaxy S7, Vivo V9, iPhone 5s, Galaxy S10, iPhone X.
**Experiment actual (6,309 ms):** Oppo K1 supported 99, Vivo S1 supported 98; Galaxy S7 partial 95, iPhone 6 93, Realme C35 92, Realme X 91, Oppo A57 90, Vivo V9 90, iPhone 13 Pro 84, iPhone 5s 80, Realme XT 58, Galaxy S8 57; four unknown 0.
**Assessment:** clear ranking improvement and exact evidence quotes validated. UI visibly rendered “Verified match,” “Related, not fully verified,” scores, and evidence excerpts.
**Tier-first caveat:** implementation sorts tier before score, not globally by score. In this observed run supported scores were also highest, so no contradictory ordering appeared. The prompt’s literal “highest relevance score first” is therefore satisfied only accidentally; a partial 99 would still follow a supported 80 by design.
**Quality:** baseline 3/5; experiment 5/5. **Attempts:** 1 each.

### Q04 — compact, reliable, non-flagship phrasing (creativity 3/5)

**Input:** `I want a compact, reliable smartphone without paying flagship money.`
**Expected (proposed):** iPhone 5s is explicitly compact/reliable; Realme C35 is budget/reliable. “Without paying flagship money” is a price/value preference, not brand exclusion.
**Actual, both:** failed with `Brand exclusion is not supported (paying flagship money)`; 137 / 131 ms.
**Assessment:** confirmed upstream negation parser false-positive; no reranking.
**Quality:** 1/5 both. **Attempts:** 1 each.

### Q05 — strict high-resolution evidence (creativity 3/5)

**Input:** `Only show phones whose catalog listing confirms a high-resolution display.`
**Expected (specified):** only evidence-backed phones, at minimum Vivo X21 and Galaxy S7; generic phones must be excluded.
**Baseline actual (1,911 ms):** all 16 phones, starting Vivo X21, iPhone 13 Pro, Realme XT, Galaxy S8, Oppo K1, Galaxy S7.
**Experiment actual (5,636 ms):** all 16 phones, starting Vivo X21, iPhone 13 Pro, Realme XT, Galaxy S8, Galaxy S7; **no semantic labels/scores at all**.
**Assessment:** confirmed strict-evidence failure and observed semantic fallback. The UI says 16 catalog-backed options but provides no evidence tier, while non-matching products remain. `confirms` is not recognized by the narrow strictness detector. Server diagnostics established the fallback cause as `semantic_evidence_rerank {status:"failed", code:"invalid_assessment"}`.
**Quality:** 1/5 both. **Attempts:** 1 each.

### Q06 — strict unsupported satellite feature (creativity 4/5)

**Input:** `Only show phones whose listing actually confirms satellite calls.`
**Expected (specified + catalog):** honest empty result; no description mentions satellite calling.
**Baseline actual (1,971 ms):** all 16 generic phones.
**Experiment actual (6,139 ms):** all 16 generic phones; no semantic labels/scores.
**Assessment:** complete grounding failure plus semantic fallback. The user’s “only…confirms” requirement is ignored.
**Quality:** 0/5 both. **Attempts:** 1 each.

### Q07 — metaphorical browser-tabs laptop (creativity 3/5)

**Input:** `A laptop for living in browser tabs, but keep it under $1,500.`
**Expected (proposed):** all returned products must be under $1,500; Dell’s high-end performance/compact profile is a reasonable lead, with Huawei and Yoga as alternatives. Catalog lacks RAM/CPU details needed for strong tab-workload proof, so claims should remain cautious.
**Baseline actual (1,932 ms):** Dell XPS 13, Huawei Matebook X Pro, Lenovo Yoga 920.
**Experiment actual (4,107 ms):** Huawei, Dell, Yoga; no semantic labels/scores.
**Assessment:** hard price held. Experiment reordering cannot be attributed to the semantic reranker because annotations are absent and fallback was observed. Server diagnostics established `invalid_assessment`; neither response explains the evidence limitation.
**Quality:** 3/5 both. **Attempts:** 1 each.

### Q08 — strict slim laptop (creativity 2/5)

**Input:** `Only documented slim laptops under $1,500, please — no guessing from the photo.`
**Expected (specified):** Huawei Matebook X Pro should be returned because its description explicitly says “slim and stylish” and price is $1,399.99. Other laptops require evidence or omission.
**Baseline actual (2,024 ms):** Huawei, Yoga, Dell, without verification labels (over-inclusive but contains the correct direct match first).
**Experiment actual (4,388 ms):** empty with `catalog_evidence_unavailable` copy: “The catalog does not state the requested feature…”
**Assessment:** confirmed experiment false-negative and regression. It directly contradicts real catalog text. Server diagnostics show the semantic evaluator completed all three assessments but labeled all three `partial`; strict mode then retained only `supported`, producing empty output. Thus the immediate cause is proven: the model/validation pipeline failed to classify Huawei's exact “slim” evidence as supported, and strict filtering removed every partial. The deeper reason for that misclassification is not exposed. UI reproduced the false-negative.
**Quality:** baseline 3/5; experiment 1/5. **Attempts:** 1 each.

### Q09 — basketball shoes + backups (creativity 3/5)

**Input:** `Shoes for shooting hoops, though everyday sporty ones can be backups.`
**Expected (proposed):** basketball shoes first; sporty shoes as partial alternatives.
**Actual, both:** unknown category and no products; experiment split into two failed intents.
**Assessment:** upstream category resolver cannot map natural “shoes” phrasing despite catalog inventory. No reranking.
**Quality:** 1/5 both. **Attempts:** 1 each. Latency: 2,221 / 2,142 ms.

### Q10 — exact red/black in-stock basketball shoe (creativity 2/5)

**Input:** `I want red-and-black basketball shoes that are actually in stock.`
**Expected (specified + catalog):** Air Jordan 1 Red And Black; stock 7.
**Actual, both:** unknown category and no products; 1,817 / 1,794 ms.
**Assessment:** complete miss despite an exact catalog item.
**Quality:** 0/5 both. **Attempts:** 1 each.

### Q11 — evening fragrance with negative contrast (creativity 2/5)

**Input:** `A perfume that feels right after sunset, under $150 — not a daytime freshie.`
**Expected (proposed):** Chanel Coco Noir ($129.99, explicitly evening wear) first; exclude CK One (explicit everyday).
**Actual, both:** failed with false brand-exclusion message `(a daytime freshie)`; 89 / 92 ms.
**Assessment:** upstream negation failure; no reranking.
**Quality:** 1/5 both. **Attempts:** 1 each.

### Q12 — warm cozy cold-evening scent (creativity 5/5)

**Input:** `Warm, cozy scent for a cold evening; show close alternatives after exact matches.`
**Expected (proposed):** fragrance intent; direct evening evidence first, then clearly labeled partial scent-profile alternatives.
**Actual, both:** unknown category and no cards; 1,634 / 1,866 ms.
**Assessment:** synonym “scent” is not mapped to fragrance; reranker never runs.
**Quality:** 1/5 both. **Attempts:** 1 each.

### Q13 — Hebrew mascara by desired effect (creativity 4/5)

**Input:** `איפור לריסים שצריכים דרמה ונפח — אני לא זוכרת איך קוראים למוצר.`
**Expected (proposed):** Essence Mascara Lash Princess first due exact dramatic/volumizing evidence.
**Actual, both:** false Hebrew brand-exclusion failure due `לא זוכרת`; 85 / 88 ms.
**Assessment:** upstream negation failure; no reranking.
**Quality:** 1/5 both. **Attempts:** 1 each.

### Q14 — shine-control lightweight makeup (creativity 2/5)

**Input:** `Makeup that controls shine with a lightweight finish.`
**Expected (catalog-grounded):** Powder Canister first; its text is an exact match.
**Actual, both:** unknown category and no cards; 1,563 / 3,715 ms.
**Assessment:** “makeup” does not map to the beauty category; exact semantic evidence is never reached.
**Quality:** 1/5 both. **Attempts:** 1 each.

### Q15 — two intents, budget scoped to fragrance (creativity 5/5)

**Input:** `Find me a camera phone and an evening fragrance under $80 — the budget is for the fragrance.`
**Expected (specified):** two intents; $80 applies only to fragrance; evidence-backed camera phones ranked first; because no under-$80 fragrance explicitly says evening, return an honest empty fragrance result (or clearly label unverified suggestions without claiming verified-only behavior).
**Baseline actual (2,073 ms):** 16 camera phones; fragrance empty; response honestly says catalog does not state the requested feature.
**Experiment actual (5,304 ms):** camera ranking improved (Realme XT, iPhone 13 Pro, Oppo F19 Pro Plus supported 99; Galaxy S8/Vivo X21/Galaxy S7 supported 98; etc.). Fragrance returned CK One, Dolce Shine, Gucci Bloom, all `unknown` 12 with `No direct catalog-text proof`. Hard $80 budget held.
**Assessment:** mixed. Intent split and scoped price are correct, and camera ordering is improved. But the user-visible response says `I returned only products whose trusted catalog text mentions the requested capability or use case` while UI cards explicitly say `Unverified relevance` / `No direct catalog-text proof`. This is a confirmed contradiction and a regression from baseline’s honest empty result. CK One is also explicitly everyday, the opposite of evening. Candidate cap again marks Galaxy S10 unknown 0 despite explicit camera text.
**Quality:** baseline 3/5; experiment 2/5. **Attempts:** 1 each.

## Required design checks

### Tier-first vs highest-score-first

- Observed sorting is tier-first, then score. Q03 did not expose a numeric inversion because supported items also had the highest scores.
- The behavior therefore matches the experiment plan but not a literal global “highest relevance score first” contract in all possible outputs.
- Recommendation: either rename the UI claim to “ordered by evidence tier, then AI relevance” or offer true score-first sorting. Do not show “ordered by relevance and evidence tier” without defining precedence.

### Contradicted labels

- No live product card with `contradicted` was observed; this is **N/A**, not a pass.
- Current implementation filters contradicted assessments rather than displaying them, so the UI’s ability to explain a contradiction was not exercised.

### Hard constraints

- Q01 max $700 held.
- Q07/Q08 max $1,500 held where products were returned.
- Q15 fragrance max $80 was correctly scoped and held; camera prices were not incorrectly capped.
- Q10 requested in-stock but failed before retrieval, so stock enforcement for that scenario is N/A.

### Strict “only verified” behavior

- Q06: failed completely; generic products returned for nonexistent satellite evidence.
- Q05: failed; generic products returned for high-resolution evidence and no semantic labels surfaced.
- Q08: strict mode overblocked a real supported Huawei match.
- Result: strict behavior is neither reliably inclusive of verified matches nor exclusive of unverified matches.

### Candidate limit

- Confirmed live in Q01 and Q15: only the first 12 candidates were semantically assessed. Galaxy S10, which has direct camera evidence, was appended as unknown 0.
- This creates false “unverified” labels based on lexical position rather than catalog evidence. The UI does not disclose “not evaluated due to limit.”

### Semantic fallback

- Observed in Q05, Q06, and Q07: products had no `semanticRelevance`, score, tier, or evidence labels. Server diagnostics confirmed `invalid_assessment` for each.
- The fallback preserved availability of results, but the UI did not disclose that semantic ranking was unavailable and still claimed relevance/evidence ordering.
- The immediate evaluator failure code is known (`invalid_assessment`), but the malformed field/value and provider usage were not exposed.

## UI coverage

Four restored conversations were checked in the real experiment UI:

1. **Q03:** visible `Verified match`, `Related, not fully verified`, `AI relevance: 99/100`, and exact catalog quotes. Product ordering matched the API.
2. **Q05:** 16 cards displayed with no evidence label/score, reproducing fallback and strict over-inclusion.
3. **Q08:** visible honest-empty UI, but false-negative copy contradicts Huawei’s actual catalog description.
4. **Q15:** visible contradiction between global “only trusted catalog text” response and fragrance cards labeled `Unverified relevance` / `No direct catalog-text proof`.

No additional OpenAI request was created during UI verification.

## Root-pattern assessment

Confirmed patterns:

1. **The reranker can substantially improve top ordering** when planner/category resolution succeeds and semantic evaluation returns valid output.
2. **Upstream parsing dominates coverage.** Four negation phrases are misread as brand exclusions (Q02, Q04, Q11, Q13); four natural category expressions are not mapped (Q09, Q10, Q12, Q14). The reranker cannot repair absent candidates.
3. **Strictness detection is brittle.** Natural `only ... confirms` wording is missed, while a documented slim query is overblocked.
4. **Candidate truncation corrupts evidence semantics.** “Unknown 0” currently conflates “assessed and unsupported” with “not assessed because candidate 13+.”
5. **Fallback is silent.** The user cannot tell that semantic evaluation was skipped/failed.
6. **Response copy can contradict card-level evidence.** Q15 is the clearest reproduction.

Preliminary hypotheses, not proven causes:

- Narrow regex/phrase extraction likely explains missed strict wording and false brand exclusions.
- The deeper reason Q08's direct Huawei quote was downgraded to `partial` is unknown; requirement normalization or verdict prompting may be involved.
- Q05–Q07 definitely failed semantic validation with `invalid_assessment`; the specific malformed assessment field/value is not logged.

## Prioritized recommendations

1. **P0 — Fix response/card contradiction:** never say “only trusted catalog text” when any shown card is partial/unknown.
2. **P0 — Make strict mode reliable:** recognize broader natural wording; on evaluator fallback, fail closed for strict requests or state that verification is unavailable rather than returning generic products.
3. **P0 — Separate `not_evaluated` from `unknown`:** do not label candidates beyond the cap as evidence-unknown; either evaluate all displayed candidates, cap displayed results, or expose an explicit not-evaluated state.
4. **P1 — Fix pre-reranker language handling:** contextual negation in English/Hebrew and catalog-category synonyms (`shoes`, `scent`, `makeup`).
5. **P1 — Surface semantic fallback:** telemetry plus user-safe UI indicator; preserve deterministic ranking but do not claim semantic evidence ordering.
6. **P1 — Revisit latency budget:** the measured median doubled to 3.715 s and max reached 8.164 s.
7. **P2 — Clarify ordering contract:** evidence-tier-first versus global score-first.

## Final decision

The experiment demonstrates a real and useful ranking improvement in two well-routed phone cases, especially Q03. That benefit is not yet dependable across natural shopping language. Strict evidence is unsafe, fallback is opaque, candidate truncation creates false labels, and the global response can directly contradict the cards. **Recommendation: keep the branch experimental and address P0 issues before publication, then rerun the same 15 cases with at least three repetitions for semantically evaluated scenarios to measure nondeterminism.**
