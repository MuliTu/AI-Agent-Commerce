# Catalog fixture

`products-page.json` is a small, versioned snapshot derived from the DummyJSON
demonstration catalog. `provenance.json` records the endpoint, assembly date,
curation method, contract and deliberate transformations. The initial fixture
was assembled offline rather than claimed as a live capture. It is not current price,
stock or inventory truth.

## Refresh procedure

1. Fetch the recorded endpoint into a temporary file outside the repository.
2. Select a small representative set without changing product facts.
3. Update `products-page.json`, `provenance.json`, the date/method and
   `fixtureVersion` in the same change.
4. Run `npm test -- tests/catalog/fixtures.test.ts` to validate the snapshot
   with the same `catalogPageSchema`/`productSchema` used for live responses.
5. Review the diff for unexpected fields, credentials, personal data or
   transactional claims, then run `npm run check`.

Refreshing is an explicit developer action. Tests never contact DummyJSON.
