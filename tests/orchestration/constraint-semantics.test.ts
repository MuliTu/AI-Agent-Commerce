import { describe, expect, it } from 'vitest';
import { analyzeConstraintSemantics } from '../../src/lib/orchestration/constraint-semantics';

const categories = ['smartphones', 'mobile-accessories', 'fragrances', 'laptops'];

describe('constraint semantics', () => {
  it('does not treat ordinary uncertainty as brand exclusion', () => {
    expect(analyzeConstraintSemantics('I need a gift but I am not sure what matters', categories))
      .toMatchObject({ status: 'supported', issues: [] });
  });
  it.each([
    ['Show smartphones under $500, but not Samsung', 'Samsung'],
    ['Show every smartphone below $500 except anything made by Samsung', 'Samsung'],
    ['מצא לי טלפון עד 500 דולר בלי Samsung', 'Samsung'],
  ])('detects unsupported brand exclusion in %s', (prompt, brand) => {
    const result = analyzeConstraintSemantics(prompt, categories);
    expect(result.status).toBe('unsupported');
    expect(result.issues).toContainEqual(expect.objectContaining({
      kind: 'brand_exclusion', excludedBrands: [brand], disposition: 'unsupported',
    }));
  });

  it('does not treat a positive brand request as an exclusion', () => {
    expect(analyzeConstraintSemantics('Show Samsung smartphones under $500', categories))
      .toMatchObject({ status: 'supported', budgetScope: 'single', issues: [] });
  });

  it('detects unsupported minimum price and contradictory bounds', () => {
    expect(analyzeConstraintSemantics('Find a phone over $200', categories).issues)
      .toContainEqual(expect.objectContaining({ kind: 'minimum_price', minPrice: 200 }));
    expect(analyzeConstraintSemantics('Find a phone under $200 but also over $800', categories))
      .toMatchObject({
        status: 'needs_clarification',
        issues: [expect.objectContaining({ kind: 'contradictory_price', minPrice: 800, maxPrice: 200 })],
      });
    expect(analyzeConstraintSemantics('Find a phone costing at least $250', categories).issues)
      .toContainEqual(expect.objectContaining({ kind: 'minimum_price', minPrice: 250 }));
    expect(analyzeConstraintSemantics('Only show phones rated at least 4', categories))
      .toMatchObject({ status: 'supported', issues: [] });
  });

  it('distinguishes aggregate, explicit each, and ambiguous multi-intent budgets', () => {
    expect(analyzeConstraintSemantics('Find a phone and fragrance together for no more than $500 total', categories))
      .toMatchObject({ status: 'needs_clarification', budgetScope: 'aggregate' });
    expect(analyzeConstraintSemantics('Find a phone and fragrance under $300 each', categories))
      .toMatchObject({ status: 'supported', budgetScope: 'each', issues: [] });
    expect(analyzeConstraintSemantics('Find a phone and fragrance under $300', categories))
      .toMatchObject({
        status: 'needs_clarification',
        budgetScope: 'ambiguous',
        issues: [expect.objectContaining({ kind: 'ambiguous_multi_intent_budget' })],
      });
  });

  it('recognizes explicit Hebrew per-item scope', () => {
    expect(analyzeConstraintSemantics('טלפון ובושם, כל אחד עד 300 דולר', categories))
      .toMatchObject({ status: 'supported', budgetScope: 'each', issues: [] });
  });

  it('recognizes Hebrew aggregate scope and ignores non-brand negation', () => {
    expect(analyzeConstraintSemantics('תן לי טלפון ובושם, יחד עד 500 דולר, ואל תנחש איך לחלק', categories))
      .toMatchObject({ status: 'needs_clarification', budgetScope: 'aggregate' });
    expect(analyzeConstraintSemantics('אני מחפש משהו טוב למטבח, אבל לא יקר מדי', categories))
      .toMatchObject({ status: 'supported', issues: [] });
    expect(analyzeConstraintSemantics('Find a phone with IP68. Do not guess.', categories))
      .toMatchObject({ status: 'supported', issues: [] });
    expect(analyzeConstraintSemantics('If eSIM is not stated in the catalog, say that.', categories))
      .toMatchObject({ status: 'supported', issues: [] });
    expect(analyzeConstraintSemantics("If the description doesn't mention eSIM, do not recommend it.", categories))
      .toMatchObject({ status: 'supported', issues: [] });
  });

  it.each([
    'If the catalog does not mention eSIM, return no products.',
    'If the catalog does not mention NFC, return no products.',
    'If the description does not omit it, continue.',
    'If the catalog does not state eSIM support, say so.',
    'If the details do not list NFC, do not guess.',
    'If the page does not show wireless charging, return no products.',
  ])('does not parse an uncontracted evidence disclaimer as a brand: %s', (prompt) => {
    expect(analyzeConstraintSemantics(prompt, categories))
      .toMatchObject({ status: 'supported', issues: [] });
  });

  it.each([
    ['Show phones but not Samsung', 'Samsung'],
    ['Show phones, anything but Apple', 'Apple'],
    ['Show phones except Google', 'Google'],
  ])('still detects a true named-brand exclusion: %s', (prompt, brand) => {
    expect(analyzeConstraintSemantics(prompt, categories).issues)
      .toContainEqual(expect.objectContaining({ kind: 'brand_exclusion', excludedBrands: [brand] }));
  });

  it('distinguishes no-more-than maximum language from minimum-price language', () => {
    expect(analyzeConstraintSemantics('Find a phone and fragrance for no more than $500 total', categories))
      .toMatchObject({
        budgetScope: 'aggregate',
        issues: [expect.objectContaining({ kind: 'aggregate_budget', maxPrice: 500 })],
      });
    expect(analyzeConstraintSemantics('Find a phone for no more than $300', categories))
      .toMatchObject({ status: 'supported', budgetScope: 'single', issues: [] });
    expect(analyzeConstraintSemantics('Find a phone for more than $300', categories).issues)
      .toContainEqual(expect.objectContaining({ kind: 'minimum_price', minPrice: 300 }));
  });
});
