# Semantic relevance reranker — independent live QA plan

Date: 2026-10-31
Branch: `local/semantic-evidence-shadow`
Provider: existing assignment OpenAI configuration
Execution owner: independent QA after implementation; these cases have not been run by development.

## Evidence to record for every case

- Exact prompt and conversation context.
- Returned product order, evidence tier, displayed semantic score and exact evidence quote.
- Expected versus actual result.
- Whether deterministic category, price, stock, rating and brand constraints remained intact.
- Whether a related result was clearly distinguished from a verified match.
- Provider/fallback status and observed latency.

## Fifteen colloquial or ambiguous cases

1. **“I need a phone that can keep me connected way out in the middle of nowhere.”**
   Expect satellite voice evidence above related satellite emergency/SOS evidence; neither may be inferred from general phone knowledge.
2. **“Show me a phone for calling by satellite — related emergency satellite features are useful too.”**
   Expect supported voice calling first, partial SOS messaging later, and unknown phones last.
3. **“Only show phones whose listing actually confirms satellite calls.”**
   Strict mode: exclude partial and unknown products rather than filling the list.
4. **“A pocket camera that also happens to be a phone, under $700.”**
   Keep the price hard filter; rank direct camera evidence ahead of generic smartphones.
5. **“Phone for night shots — not just ‘has a camera’ marketing.”**
   Direct low-light/night evidence outranks generic camera mentions; generic camera evidence may be partial, not verified night capability.
6. **“I’m clumsy. Which phone sounds least scary around water?”**
   Water-resistance evidence ranks above generic durability wording; no IP rating may be invented.
7. **“Something that won’t die before dinner; the catalog has to say why.”**
   Explicit battery/endurance text may support or partially support; absence remains unknown.
8. **“A laptop for living in browser tabs, but keep it under $900.”**
   Price remains deterministic; performance/memory wording influences tier and ordering without invented RAM facts.
9. **“Only documented lightweight laptops, please — no guessing from the photo.”**
   Strict verified mode; titles/images alone do not prove weight.
10. **“Shoes for shooting hoops, though everyday sporty ones can be backups.”**
    Basketball evidence first; general athletic shoes may appear as related and clearly qualified.
11. **“A perfume that feels right after sunset, not a daytime freshie.”**
    Evening/night wording outranks generic fragrance; subjective inference without text remains unknown.
12. **“Warm, cozy scent for a cold evening; show close alternatives after exact matches.”**
    Direct warm/evening evidence first, partial related scent wording next, unknown last.
13. **“Makeup for lashes that need drama, but I don’t know the product word.”**
    Mascara/volumizing/lengthening catalog evidence should resolve the colloquial goal without changing category constraints.
14. **“I want red-and-black basketball shoes that are actually in stock.”**
    In-stock is a hard constraint; semantic relevance cannot restore an out-of-stock exact-looking product.
15. **“Find me a camera phone and an evening fragrance under $80 — the budget is for the fragrance.”**
    Two isolated intents; evidence and scoring must not cross products, and the price applies only to fragrance.

## Pass boundary

- Evidence tier always dominates semantic score.
- Semantic score only orders within a tier; lexical score breaks remaining ties.
- `partial` and `unknown` cards never claim the requested feature is verified.
- `contradicted` cards do not render.
- Strict verified wording renders only supported cards or an honest empty result.
- Provider timeout, schema error or invalid quote produces the documented deterministic fallback without exposing raw provider data or credentials.
