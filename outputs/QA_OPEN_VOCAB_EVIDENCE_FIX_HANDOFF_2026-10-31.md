# Open-Vocabulary Evidence Fix Handoff — 2026-10-31

Status: implementation and deterministic verification complete; narrow independent live verification pending.

## Root fix

Explicit catalog-proof language now produces a bounded evidence requirement even when the requested feature is absent from the curated vocabulary. Supported constructions include catalog/title/description/details language with `state`, `mention`, `list`, `show`, `describe`, or `say`, plus `verified`/`documented` feature wording.

The extracted phrase is normalized and matched only against trusted product title, description, and tags. Common structural suffixes such as `support`, `feature`, and `capability` are removed. Curated requirements still provide known synonyms such as camera/photography and evening/night. When explicit proof language cannot identify a safe phrase, the request fails closed with no generic matches.

Ordinary wording without explicit proof language remains browsing/ranking context and is not automatically promoted to a hard filter. In multi-intent prompts, proof clauses are attached only to the category segment that contains the extracted feature phrase.

## Independent live matrix

1. Repeat twice:
   - `Find a smartphone with satellite calling. If the catalog does not state satellite calling support, return no products.`
   - The same request with `mention satellite calling`.
   - An unseen contrast such as `quantum-resistant encryption` with explicit description/list proof language.
2. Positive trusted-text control: use a requested phrase known to occur in trusted catalog text and verify only matching cards survive.
3. Curated synonym controls: camera/photography, evening/night, eSIM, and NFC.
4. Ordinary browsing controls: a generic smartphone search and `phone with a long-lasting battery for travel` must not be rejected solely because the adjective is not literally present.
5. Multi-intent control: phone with an explicit unknown evidence requirement plus an ordinary fragrance. The proof requirement must constrain only the phone outcome.

Record trusted fields supporting every positive match. Deterministic tests are not live-provider evidence.

## Limitation

Unknown open-vocabulary features use conservative lexical phrase matching rather than semantic entailment. Curated features retain hand-authored synonyms. This can produce an honest false negative for an unseen synonym, but it will not substitute generic category products as verified matches.
