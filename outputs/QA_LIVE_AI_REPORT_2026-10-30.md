# Live AI QA Report — AI-Agent-Commerce

Date: 2026-10-30
Model path: configured OpenAI provider, `gpt-5.4-mini`
Build: fresh `npm run build`, then `next start` on isolated localhost port 3320
Database: isolated test-only SQLite database under `/tmp/bazak-live-qa.4umXV3/`
Scope: conversational shopping quality, intent extraction, hard constraints, multi-turn context, unsupported semantics, Hebrew/English, off-topic handling, and catalog grounding. Security testing was excluded.

## Executive summary

The system is reliable when a request maps directly to its supported constraint schema: category, maximum USD price, minimum rating, stock, positive brand inclusion, and price sorting. It also performs well when a follow-up explicitly names one previous product or explicitly says that a constraint applies to both products.

The main problem is not one bad model answer. It is a gap between what natural language can request and what the deterministic contract can represent and verify:

1. The constraint schema can represent positive brands but not excluded brands, minimum price, combined budgets, or verified arbitrary product features.
2. Unsupported feature hints are deliberately demoted to ranking language, but the ranking stage never requires a positive lexical match. A category match is therefore returned even when the requested feature is absent.
3. Off-topic protection uses a finite regex list. General-knowledge and arithmetic requests outside that list become product-category clarification questions.
4. Ambiguity protection depends on the shape of the model plan. If the model selects a previous intent ID, deterministic ambiguity handling is bypassed.
5. Multi-intent splitting is model-dependent. Explicit numbering works in Hebrew; a more natural Hebrew sentence was mis-split into two smartphone intents. Post-plan validation does not detect that two extracted intents reused the same broad goal/category despite a second explicit product type.

These are confirmed structural patterns, not merely prompt-quality observations. Exact code evidence is listed in “Root-cause analysis.”

## Method and accounting

- 33 live POST requests were attempted across both runs.
- 30 reached the configured provider/intent-generation stage.
- 3 failed before provider execution because the QA harness accidentally reused the same globally unique `turnId` across conversations. They returned immediate 500 responses, were corrected with unique IDs, and are excluded from product-quality scoring.
- One valid ambiguous follow-up completed after approximately 63 seconds; the client-side collection was stopped after one minute, but a later GET confirmed persisted completion.
- Other observed live request durations were approximately 1.8–4.4 seconds.
- Token usage and monetary cost were not exposed by the API or logs; no estimate is presented as fact.
- Existing user conversations and the normal application database were not modified.
- No code, provider settings, credentials, or security configuration were changed.

### Scoring

- Quality: 0 = complete failure, 1 = poor/major problem, 2 = weak/substantial fixes needed, 3 = acceptable but noticeably flawed, 4 = good/minor improvement, 5 = excellent.
- Creativity: 0 = ordinary, 5 = exceptionally inventive.

## Full scenario results

### L01 — Metaphorical low-budget phone request, repeated three times

- Exact prompt: `My pockets are shallow: find me a solid phone, hard ceiling $350, and it absolutely must be in stock.`
- Expected: smartphone category, `maxPrice=350`, `inStock=true`; no product above $350 or with stock 0. Basis: authored SPEC and supported constraint schema.
- Attempts: 3 valid independent conversations.
- Actual: all three completed with `category=smartphones`, `maxPrice=350`, `inStock=true`. Relevant products included Realme XT ($349.99, stock 80), Realme C35 ($149.99, stock 48), Oppo K1 ($299.99, stock 55), iPhone 6 ($299.99, stock 60), Oppo A57 ($249.99, stock 19), Realme X ($299.99, stock 12), Vivo V9 ($299.99, stock 82), and Vivo S1 ($249.99, stock 50). Product order varied slightly, but constraints and membership remained correct.
- Response: `I searched the catalog for your shopping request.`
- Evidence: `qa-live-phone-a1`, `qa-live-phone-a2-valid`, `qa-live-phone-a3-valid`.
- Classification: pass; repeatably stable.
- Creativity: 3/5. Quality: 5/5.

### L02 — Budget persistence through a rating follow-up

- Exact sequence: (1) `I need an everyday fragrance under $80.` (2) `Only show ones rated at least 4.`
- Expected: preserve fragrance and $80; add `minRating=4`. Basis: SPEC multi-turn refinement rule.
- Attempts: 1 two-turn sequence.
- Actual turn 1: `category=fragrances`, `maxPrice=80`; CK One, Dolce Shine, Gucci Bloom. Turn 2: `category=fragrances`, `maxPrice=80`, `minRating=4`; only Calvin Klein CK One ($49.99, rating 4.37).
- Response: `I searched the catalog for your shopping request.`
- Evidence: `qa-live-fragrance-valid`.
- Classification: pass.
- Creativity: 2/5. Quality: 5/5.

### L03 — Two intents with separate price, stock, and use-case language

- Exact prompt: `I need a camera-focused phone under $400, and an evening fragrance under $100; both must be in stock.`
- Expected: two intents with independent hard filters; soft camera/evening ranking grounded in catalog text. Basis: SPEC.
- Attempts: 1.
- Actual: phone received `smartphones`, `maxPrice=400`, `inStock=true`; fragrance received `fragrances`, `maxPrice=100`, `inStock=true`. Phone results included camera-relevant Realme XT, Realme X and Oppo F19 Pro Plus. Fragrance results were CK One, Dolce Shine, Dior J'adore and Gucci Bloom. The only explicitly evening-described fragrance, Chanel Coco Noir, correctly failed the $100 hard filter, but the response did not explain that no remaining product explicitly matched “evening.”
- Response: `I searched the catalog separately for each of your shopping goals.`
- Evidence: `qa-live-multi-conditions`.
- Classification: hard constraints pass; semantic explanation/ranking is weak.
- Creativity: 4/5. Quality: 3/5.

### L04 — Combined $500 budget across a phone and fragrance, repeated twice

- Exact prompt: `Find me a phone and a fragrance together for no more than $500 total.`
- Expected: combined budget is not representable by the current per-intent schema. The system should clarify how to split it or explicitly state the limitation. It must not claim that the total was applied. Basis: proposed safe behavior; combined-budget semantics are unsupported by the authored contract.
- Attempts: 2.
- Actual attempt 1: $500 was applied only to fragrance; phone had no budget and included iPhone 13 Pro at $1,099.99. Attempt 2: neither intent had `maxPrice`; the same over-budget phone was present. Both responses claimed separate searches succeeded.
- Response: `I searched the catalog separately for each of your shopping goals.`
- Evidence: `qa-live-shared-budget-a1`, `qa-live-shared-budget-a2`.
- Classification: unsupported capability presented misleadingly as success; nondeterministic plan handling.
- Creativity: 4/5. Quality: 1/5.

### L05 — Brand negation, repeated three phrasings, with positive control

- Exact negative prompts: (a) `Show me smartphones under $500, but not Samsung.` twice; (b) `Show me every smartphone below $500 except anything made by Samsung.` once.
- Positive control: `Show me Samsung smartphones under $500.`
- Expected: negatives exclude Samsung or explicitly reject unsupported exclusion; positive control includes only Samsung. Basis: natural-language meaning; exclusion is not currently represented in the contract.
- Attempts: 3 negative + 1 positive control.
- Actual: all three negative attempts produced `brands=["Samsung"]` and returned only Samsung Galaxy S8 ($499.99) and Samsung Galaxy S7 ($299.99). The positive control produced the exact same constraint and products. The live UI showed heading “excluding Samsung” directly above the two Samsung cards.
- Response: `I searched the catalog for your shopping request.`
- Evidence: `qa-live-negation-a1`, `qa-live-negation-a2`, `qa2-negation-except`, `qa2-brand-positive` plus live UI accessibility tree.
- Classification: confirmed systematic inversion, not random model noise.
- Creativity: 3/5. Quality: 0/5.

### L06 — Missing product facts: IP68 and wireless charging

- Exact prompt: `Find a phone with verified IP68 waterproof certification and wireless charging. Do not guess if the catalog does not say.`
- Expected: say the facts cannot be verified from catalog fields, or return no verified matches. Basis: grounding requirement and explicit shopper instruction.
- Attempts: 1.
- Actual: only `category=smartphones` survived. Generic phones including Realme XT, Samsung S8, Vivo X21, Oppo K1 and iPhone 13 Pro were returned. Neither feature was present in the displayed evidence.
- Response: `I searched the catalog for your shopping request.`
- Evidence: `qa-live-unknown-facts`.
- Classification: unsupported feature request converted to a false-positive category result.
- Creativity: 5/5. Quality: 1/5.

### L07 — Missing product fact variation: eSIM, with explicit no-guess instruction

- Exact prompt: `Find a smartphone with verified eSIM support. If eSIM is not stated in the catalog, say that rather than recommending generic phones.`
- Expected: disclose absence of verified eSIM data; no generic recommendations. Basis: grounding requirement and prompt.
- Attempts: 1.
- Actual: `category=smartphones`, no feature constraint; returned general smartphones including Realme XT, Samsung S8, Vivo X21, Realme C35 and iPhone 13 Pro. No shown description stated eSIM support.
- Response: `I searched the catalog for your shopping request.`
- Evidence: `qa2-unknown-esim`.
- Classification: same systematic false-positive pattern as L06.
- Creativity: 5/5. Quality: 1/5.

### L08 — Catalog-supported description feature control: camera capabilities

- Exact prompt: `Find a smartphone whose catalog description mentions camera capabilities.`
- Expected: rank products whose trusted descriptions mention camera-related terms. Basis: ranking design.
- Attempts: 1.
- Actual: top results included Samsung S8, Vivo X21, Realme X, Oppo F19 Pro Plus and Realme XT; each displayed description contains camera/camera capabilities/sensors/photography wording.
- Response: `I searched the catalog for your shopping request.`
- Evidence: `qa2-known-camera`.
- Classification: positive control passes; lexical ranking works when evidence exists.
- Creativity: 2/5. Quality: 5/5.

### L09 — Mixed laptop search and quantum-entanglement request

- Exact prompt: `Find me a laptop under $900, and then explain quantum entanglement in one sentence.`
- Expected: laptop result or honest empty state; catalog-only refusal for quantum explanation. Basis: SPEC mixed off-topic behavior.
- Attempts: 1.
- Actual: laptop intent completed empty under $900. Quantum intent became `needs_clarification` with “What kind of product should I focus on?” and options Beauty, Fragrances, Furniture.
- Response: `I need one more detail to continue the catalog search.`
- Evidence: `qa-live-mixed-offtopic`.
- Classification: off-topic misclassified as ambiguous shopping.
- Creativity: 4/5. Quality: 1/5.

### L10 — Pure quantum-entanglement request control

- Exact prompt: `Explain quantum entanglement in one sentence.`
- Expected: one catalog-only refusal, no category question. Basis: system prompt and SPEC general-knowledge boundary.
- Attempts: 1.
- Actual: `needs_clarification`; asked which product category to focus on and suggested Beauty, Fragrances, Furniture.
- Response: `I need one more detail to continue the catalog search.`
- Evidence: `qa2-pure-offtopic`.
- Classification: confirmed general-knowledge classifier gap independent of mixed-intent handling.
- Creativity: 2/5. Quality: 0/5.

### L11 — Mixed fragrance and arithmetic request

- Exact prompt: `Find an in-stock fragrance under $80 and calculate 17 times 29.`
- Expected: fragrance results; refusal for arithmetic. Basis: SPEC mixed off-topic rule.
- Attempts: 1.
- Actual: fragrance intent correctly returned CK One, Dolce Shine and Gucci Bloom under $80 and in stock. Arithmetic intent became `needs_clarification` and asked for a product category.
- Response: `I need one more detail to continue the catalog search.`
- Evidence: `qa2-mixed-arithmetic`.
- Classification: same deterministic off-topic gap as L09/L10.
- Creativity: 4/5. Quality: 1/5.

### L12 — Broad kitchen request in Hebrew

- Exact prompt: `אני מחפש משהו טוב למטבח, אבל לא יקר מדי.`
- Expected: resolve or suggest kitchen accessories, or ask a focused category/budget clarification. Do not invent a numeric budget. Basis: proposed usability behavior; generic “kitchen” alias is not an explicit contract promise.
- Attempts: 1.
- Actual: `unknown_catalog_category`; safe refusal in Hebrew. It did not invent a budget, but did not offer a useful clarification despite `kitchen-accessories` being available.
- Evidence: `qa-live-hebrew-kitchen`.
- Classification: safe but unhelpful; semantics partly undefined.
- Creativity: 2/5. Quality: 2/5.

### L13 — Natural Hebrew multi-intent sentence

- Exact prompt: `תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר, שניהם במלאי.`
- Expected: smartphone ≤$400 in stock plus fragrance ≤$80 in stock. Basis: SPEC multilingual and multi-intent requirements.
- Attempts: 1.
- Actual: two intents were created, but both were smartphones. The second used `maxPrice=80`, returned empty, and the final Hebrew response said no smartphones under $80 matched. No fragrance search occurred.
- Evidence: `qa-live-hebrew-multi`.
- Classification: severe intent-splitting/scoping failure.
- Creativity: 3/5. Quality: 0/5.

### L14 — Explicit numbered Hebrew multi-intent contrast

- Exact prompt: `מצא לי שני דברים נפרדים: (1) טלפון במלאי עד 400 דולר; (2) בושם לערב במלאי עד 80 דולר.`
- Expected: same two intents as L13.
- Attempts: 1.
- Actual: correctly produced smartphone `maxPrice=400,inStock=true` and fragrance `maxPrice=80,inStock=true`; response was natural Hebrew. Product sets matched hard constraints.
- Evidence: `qa2-multi-hebrew`.
- Classification: contrast passes; failure is phrasing-sensitive, not a universal Hebrew failure.
- Creativity: 3/5. Quality: 5/5.

### L15 — English version of explicit multi-intent contrast

- Exact prompt: `Find two separate things: an in-stock phone under $400, and an in-stock evening fragrance under $80.`
- Expected: two correctly scoped intents.
- Attempts: 1.
- Actual: correct smartphone and fragrance intents with their own price and stock filters. As in L03, evening was not explicitly verified among remaining under-$80 fragrances.
- Evidence: `qa2-multi-english`.
- Classification: hard constraints pass; soft-use-case caveat.
- Creativity: 2/5. Quality: 4/5.

### L16 — Ambiguous follow-up after two product topics

- Exact sequence: (1) `Find me a smartphone and a fragrance.` (2) `Make it under $300.`
- Expected: ask whether $300 applies to smartphone or fragrance. Basis: explicit SPEC rule and system prompt.
- Attempts: 1 two-turn sequence.
- Actual: no clarification. Budget was applied only to fragrance. Smartphone remained unfiltered and included iPhone 13 Pro at $1,099.99. The follow-up took approximately 63 seconds.
- Evidence: `qa-live-ambiguous-followup`.
- Classification: confirmed context/ambiguity failure with latency outlier.
- Creativity: 3/5. Quality: 1/5.

### L17 — Explicit product follow-up control

- Exact sequence: (1) `Find me a smartphone and a fragrance.` (2) `Make the smartphone under $300.`
- Expected: apply $300 only to smartphone and preserve fragrance unchanged.
- Attempts: 1 sequence.
- Actual: smartphone gained `maxPrice=300`, with Realme C35, Oppo A57, Realme X, Vivo V9, Vivo S1 and iPhone 6. Fragrance remained unchanged.
- Evidence: `qa2-explicit-followup`.
- Classification: pass.
- Creativity: 2/5. Quality: 5/5.

### L18 — Explicit “both” follow-up control

- Exact sequence: (1) `Find me a smartphone and a fragrance.` (2) `Make both of them under $300 each.`
- Expected: apply $300 independently to both prior intents.
- Attempts: 1 sequence.
- Actual: both intents gained `maxPrice=300`; smartphone over-$300 items were removed and all fragrance items remained because each was below $300.
- Evidence: `qa2-both-followup`.
- Classification: pass.
- Creativity: 3/5. Quality: 5/5.

### L19 — Contradictory price conditions

- Exact prompt: `Find me a phone that costs under $200 but also over $800.`
- Expected: detect contradiction and ask which bound is intended. Basis: proposed safe behavior; minimum price is unsupported by current schema.
- Attempts: 1.
- Actual: retained only `maxPrice=200`, ignored “over $800,” and returned Realme C35 ($149.99) and iPhone 5s ($199.99).
- Response: `I searched the catalog for your shopping request.`
- Evidence: `qa2-contradictory`.
- Classification: unsupported lower-bound/contradiction silently discarded.
- Creativity: 4/5. Quality: 1/5.

### L20 — Mixed smartphone and weather

- Exact prompt: `Find a smartphone and tell me the weather in London.`
- Expected: smartphone succeeds, weather is refused separately. Basis: SPEC.
- Attempts: 1 previously persisted live run inspected through API.
- Actual: `partial`; smartphone catalog results completed, weather failed with `outside_product_catalog`; no weather was fabricated.
- Evidence: `final-live-mixed-20261030`.
- Classification: pass for an explicitly recognized off-topic keyword.
- Creativity: 2/5. Quality: 5/5.

### L21 — Pure weather request

- Exact prompt: `What is the weather in London?`
- Expected: one friendly catalog-only refusal. Basis: SPEC.
- Attempts: 1 persisted live run inspected.
- Actual: correct refusal, no products, `outside_product_catalog`.
- Evidence: `final-live-weather-20261030`.
- Classification: pass; positive control for regex-recognized off-topic class.
- Creativity: 1/5. Quality: 5/5.

### L22 — Impossible smartphone constraints plus flight

- Exact prompt: `I need a flight to Paris next week, and also find a smartphone under $1 with a 5-star rating.`
- Expected: flight refused; valid smartphone search returns honest empty result, not operational failure. Basis: SPEC.
- Attempts: 1 persisted live run inspected.
- Actual: `partial`; smartphone completed empty with `maxPrice=1,minRating=5`; flight refused separately.
- Evidence: persisted isolated/live conversation `04269ae8-12b2-4a6e-982f-90b7d2d3e0e5`.
- Classification: pass.
- Creativity: 4/5. Quality: 5/5.

### L23 — Previously unrun contradictory test status

- The contradiction test was initially marked N/A after a long provider wait. It was subsequently executed as L19; L19 supersedes the earlier N/A status.

## Harness errors

Three early requests reused `turnId=t1` in different conversations. Turn IDs are globally stored, so the first succeeded and the next three returned immediate generic 500 errors before provider work. Corrected requests with unique IDs passed through normally. This is a QA harness error, not evidence for model quality. It does reveal that the API maps a cross-conversation turn-ID collision to a generic 500 rather than a clear identity-conflict response, but that was not the target of this non-security review.

## Root-cause analysis

### 1. Negation is structurally unrepresentable — proven

`Constraints` contains `brands?: string[]` but no excluded-brand field ([src/lib/domain/contracts.ts](../src/lib/domain/contracts.ts#L22)). The provider schema likewise offers only positive `brands` ([src/lib/orchestration/contracts.ts](../src/lib/orchestration/contracts.ts#L28)). Ranking treats every listed brand as an inclusion filter ([src/lib/ranking/rank-products.ts](../src/lib/ranking/rank-products.ts#L71)).

The model correctly preserved “excluding Samsung” in goal/query text, but the only available structured brand field was `brands=[Samsung]`. Deterministic ranking then necessarily returned Samsung only. Three negative variations and one positive control produced the same structured constraint and products. This is a schema/semantic-contract problem, not merely random model behavior.

### 2. Missing features fall back to generic category results — proven

Provider-created `requiredTags` are explicitly erased before orchestration ([src/lib/orchestration/provider.ts](../src/lib/orchestration/provider.ts#L81)). This is intended to prevent an invented taxonomy term from becoming a destructive exact filter. However, the remaining feature wording is only query text.

Ranking filters hard constraints, computes a lexical score, adds a rating contribution, and never removes zero-lexical-match candidates ([src/lib/ranking/rank-products.ts](../src/lib/ranking/rank-products.ts#L141)). Match reasons also fall back to category/rating when nothing else matched. Therefore, when no product states “eSIM,” “IP68,” or “wireless charging,” the full smartphone category still becomes a successful ranked list. Camera wording works because trusted descriptions actually contain matching tokens.

### 3. Off-topic detection is a finite keyword allow/deny boundary — proven

The deterministic classifier recognizes a limited list such as flights, hotels, weather, news, jokes and recipes ([src/lib/orchestration/category-resolution.ts](../src/lib/orchestration/category-resolution.ts#L143)). It does not recognize general knowledge broadly, quantum topics, or arithmetic.

When the model creates an intent without a category for an unrecognized off-topic request, orchestration treats it as a missing product category and the clarification policy asks for a category. This explains why weather passes while quantum and arithmetic fail. The prompt instructs broader behavior, but deterministic enforcement is narrower.

### 4. Ambiguous follow-up protection is conditional on model-plan shape — proven

The deterministic ambiguity branch runs only when the turn is constraint-only, the model returned exactly one intent, and that intent has no `intentId` ([src/lib/orchestration/orchestrator.ts](../src/lib/orchestration/orchestrator.ts#L262)).

In the failing `Make it under $300` run, the model selected the fragrance prior intent, so the guard did not run. Explicit `smartphone` and explicit `both` runs produced correct plans. The system prompt asks the model to clarify ambiguity, but there is no unconditional post-plan validation that rejects an unexplained selection among multiple previous product intents.

### 5. Hebrew multi-intent failure is phrasing-sensitive model planning plus insufficient post-validation — strongly supported

Natural conjunction wording produced two smartphone intents; explicit numbering produced correct smartphone/fragrance intents. This rules out a universal Hebrew/category-alias failure. Category grounding checks that the selected category appears in both prompt and intent context. Because the bad model goals repeated the whole sentence, `smartphones` was technically grounded for both intents. There is no validation that explicit distinct product types in the shopper prompt are represented once each or that sibling intents have scoped, nonduplicated goals.

The immediate source is the model plan; the deeper product issue is lack of deterministic multi-intent coverage validation. Exact internal model reasoning is not observable, so any claim about why the model preferred smartphone would be speculative.

### 6. Combined budgets and contradictory bounds exceed the schema — proven

The schema supports only per-intent `maxPrice`; there is no combined-budget object and no `minPrice` ([src/lib/domain/contracts.ts](../src/lib/domain/contracts.ts#L22)). Consequently, a total budget was inconsistently attached to one or zero intents, while “under $200 and over $800” retained only the supported maximum. There is no deterministic detector for combined or contradictory price language.

### 7. Broad kitchen semantics are not aliased — proven, expected behavior partly undefined

The alias list covers specific kitchen items such as plates/dishes, not the generic Hebrew word “מטבח.” The safe unknown-category failure is therefore consistent with current code. Whether generic kitchen language should map directly to `kitchen-accessories` or ask a clarification is a product decision rather than a clear current-contract violation.

## Cross-scenario patterns

| Pattern | Failures | Passing contrast | Conclusion |
| --- | --- | --- | --- |
| Negated brand | L05, 3/3 negative attempts | Positive Samsung control | System cannot represent exclusion and deterministically inverts it |
| Missing catalog fact | L06, L07 | Camera control L08 | Feature query succeeds only when catalog text overlaps; no evidence threshold exists |
| General off-topic | L09–L11 | Weather L20/L21 | Keyword classifier, not general non-product classification |
| Hebrew splitting | L13 | Explicit numbered Hebrew L14 | Phrasing-sensitive plan; no deterministic coverage validation |
| Ambiguous context | L16 | Explicit target L17; explicit both L18 | Guard depends on model omitting `intentId` |
| Unrepresentable price semantics | L04, L19 | Ordinary max-price L01/L02 | Unsupported semantics silently collapse into supported fields |

## Prioritized recommendations for the reviewing agent

These are analysis targets, not implemented fixes:

1. Define a product decision for unsupported constraints: reject/clarify rather than silently weaken. Add explicit representation only where the catalog can verify it.
2. Add `excludedBrands` only if exclusion is a supported feature; otherwise detect negation around brands and return an unsupported-constraint clarification.
3. Require an evidence threshold for soft feature requests. If meaningful query tokens have no trusted-field match, return an honest “catalog does not state this” outcome instead of rating-sorted category results.
4. Replace or augment the off-topic keyword regex with deterministic product-category evidence. Unknown no-category intents should not automatically become product clarification when the requested action is plainly non-shopping.
5. Validate multi-intent coverage against explicit product types in the original prompt, especially when sibling intents duplicate category/goal context.
6. Apply ambiguity validation after the model plan: when multiple prior intents exist and the new turn names none, do not trust a single reused `intentId` without explicit evidence.
7. Detect combined budgets, minimum-price language, and contradictions before converting them into ordinary `maxPrice` constraints.
8. Add live-evaluation fixtures for the exact negative and contrast pairs in this report. Deterministic tests alone currently encode the intended happy paths but did not expose the model/schema interactions.

## Limitations

- Live sample sizes are intentionally bounded; three repetitions were used for the most severe negation failure and three for the metaphorical phone control, while most other cases have one or two attempts.
- The report proves output and code-path behavior, not hidden model reasoning.
- DummyJSON is a demo catalog; no claim is made that its data is complete or commercially current.
- Token/cost telemetry was unavailable.
- No security, destructive persistence, deployment, or account-isolation testing was performed.
- No product code was changed and no fix was verified.
