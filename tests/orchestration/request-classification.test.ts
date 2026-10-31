import { describe, expect, it } from 'vitest';
import {
  classifyIntentRequest,
  classifyRequestSegments,
  classifyRequestText,
} from '../../src/lib/orchestration/request-classification';

const categories = ['smartphones', 'laptops', 'fragrances', 'kitchen-accessories'];

describe('deterministic request classification', () => {
  it.each([
    'Explain quantum entanglement in one sentence',
    'calculate 17 times 29',
    'מצא לי טיסה לפריז',
    'הסבר מה זה שזירה קוונטית',
    'חשב כמה זה 17 כפול 29',
  ])('recognizes an explicit outside-catalog request: %s', (request) => {
    expect(classifyRequestText(request, categories)).toBe('outside_catalog');
  });

  it('keeps a mixed product and outside request unclassified until it is segmented', () => {
    expect(classifyRequestText('Find a smartphone and tell me the weather in London', categories)).toBe('unknown');
  });

  it.each([
    ['Find a smartphone under $300', 'catalog_product'],
    ['אני מחפש צלחות למטבח', 'catalog_product'],
    ['I am looking for a useful product', 'unknown'],
    ['אני מחפש משהו טוב למטבח', 'catalog_product'],
    ['Something useful for a gift', 'unknown'],
  ] as const)('classifies product evidence conservatively: %s', (request, expected) => {
    expect(classifyRequestText(request, categories)).toBe(expected);
  });

  it('keeps product and general-knowledge segments separate', () => {
    expect(classifyRequestSegments(
      'Find me a laptop under $900, and then explain quantum entanglement in one sentence.',
      categories,
    )).toEqual([
      { text: 'Find me a laptop under $900', classification: 'catalog_product' },
      { text: 'explain quantum entanglement in one sentence.', classification: 'outside_catalog' },
    ]);
  });

  it('separates arithmetic from a supported product sibling', () => {
    expect(classifyRequestSegments(
      'Find an in-stock fragrance under $80 and calculate 17 times 29.',
      categories,
    )).toEqual([
      { text: 'Find an in-stock fragrance under $80', classification: 'catalog_product' },
      { text: 'calculate 17 times 29.', classification: 'outside_catalog' },
    ]);
  });

  it('does not split an ordinary compound product request', () => {
    expect(classifyRequestSegments('Find a phone and charger', categories)).toEqual([
      { text: 'Find a phone and charger', classification: 'catalog_product' },
    ]);
  });

  it('uses intent context to classify mixed plans independently', () => {
    const prompt = 'Find a laptop under $900, and then explain quantum entanglement.';
    expect(classifyIntentRequest({
      prompt,
      intentContext: 'Find a laptop laptop',
      intentCount: 2,
      availableCategories: categories,
    })).toBe('catalog_product');
    expect(classifyIntentRequest({
      prompt,
      intentContext: 'Explain quantum entanglement quantum',
      intentCount: 2,
      availableCategories: categories,
    })).toBe('outside_catalog');
  });
});
