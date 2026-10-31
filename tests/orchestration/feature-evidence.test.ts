import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/lib/domain/contracts';
import {
  filterProductsByFeatureEvidence,
  requestedFeatureEvidence,
  requestedFeatureEvidenceForIntent,
} from '../../src/lib/orchestration/feature-evidence';

const cameraPhone: Product = {
  id: 1, title: 'Camera Phone', description: 'Photography phone with a capable camera',
  category: 'smartphones', price: 300, tags: ['camera'], images: [],
};
const genericPhone: Product = {
  id: 2, title: 'Generic Phone', description: 'A general smartphone',
  category: 'smartphones', price: 250, tags: ['mobile'], images: [],
};
const eveningFragrance: Product = {
  id: 3, title: 'Evening Fragrance', description: 'A scent for evening wear',
  category: 'fragrances', price: 90, tags: ['night'], images: [],
};
const satellitePhone: Product = {
  id: 4, title: 'Remote Phone', description: 'Supports satellite calling in remote areas',
  category: 'smartphones', price: 800, tags: ['satellite'], images: [],
};

describe('catalog feature evidence', () => {
  it('requires every explicitly requested verifiable feature', () => {
    const requirements = requestedFeatureEvidence(
      'Find a phone with verified IP68 certification and wireless charging.',
    );

    expect(requirements.map(({ label }) => label)).toEqual(['IP68 certification', 'wireless charging']);
    expect(filterProductsByFeatureEvidence([cameraPhone, genericPhone], requirements)).toEqual([]);
  });

  it('keeps products whose trusted fields establish a requested camera capability', () => {
    const requirements = requestedFeatureEvidence(
      'Find a smartphone whose catalog description mentions camera capabilities.',
    );

    expect(filterProductsByFeatureEvidence([genericPhone, cameraPhone], requirements)).toEqual([cameraPhone]);
  });

  it('requires evidence for explicitly requested camera and evening qualities', () => {
    expect(requestedFeatureEvidence('Find a camera-focused phone under $400.').map(({ label }) => label))
      .toEqual(['camera capabilities']);
    const evening = requestedFeatureEvidence('Find an evening fragrance under $100.');
    expect(evening.map(({ label }) => label)).toEqual(['evening use']);
    expect(filterProductsByFeatureEvidence([eveningFragrance], evening)).toEqual([eveningFragrance]);
  });

  it.each([
    ['בושם לערב', 'בושם לערב'],
    ['בושם', 'fragrance'],
    ['ניחוח', 'perfume'],
  ])('scopes Hebrew evening evidence from the shopper segment despite provider wording: %s', (goal, query) => {
    const requirements = requestedFeatureEvidenceForIntent({
      prompt: 'תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר, שניהם במלאי',
      intentContext: `${goal} ${query}`,
      category: 'fragrances',
      intentCount: 2,
      availableCategories: ['smartphones', 'fragrances'],
    });
    expect(requirements.map(({ label }) => label)).toEqual(['evening use']);
    expect(filterProductsByFeatureEvidence([genericPhone, eveningFragrance], requirements))
      .toEqual([eveningFragrance]);
  });

  it.each([
    'Find a smartphone with satellite calling. If the catalog does not state satellite calling support, return no products.',
    'Find a smartphone with satellite calling. If the catalog does not mention satellite calling, return no products.',
    'Find a phone with quantum-resistant encryption, but only if the catalog description lists quantum-resistant encryption.',
  ])('extracts an unseen explicit catalog-evidence phrase: %s', (prompt) => {
    const requirements = requestedFeatureEvidence(prompt);
    expect(requirements).toHaveLength(1);
    expect(requirements[0].alternatives[0]).toBeTruthy();
  });

  it('keeps only trusted products that establish an unseen explicit feature', () => {
    const requirements = requestedFeatureEvidence(
      'Find a smartphone with satellite calling. If the catalog does not mention satellite calling, return no products.',
    );
    expect(filterProductsByFeatureEvidence([genericPhone, satellitePhone], requirements))
      .toEqual([satellitePhone]);
  });

  it('scopes a separate explicit proof clause back to the matching multi-intent segment', () => {
    const prompt = 'Find a phone with satellite calling and a fragrance. If the catalog does not mention satellite calling, return no phone products.';
    expect(requestedFeatureEvidenceForIntent({
      prompt,
      intentContext: 'phone',
      category: 'smartphones',
      intentCount: 2,
      availableCategories: ['smartphones', 'fragrances'],
    }).map(({ label }) => label)).toEqual(['satellite calling']);
    expect(requestedFeatureEvidenceForIntent({
      prompt,
      intentContext: 'fragrance',
      category: 'fragrances',
      intentCount: 2,
      availableCategories: ['smartphones', 'fragrances'],
    })).toEqual([]);
  });

  it('does not promote ordinary unknown wording into a hard evidence filter', () => {
    expect(requestedFeatureEvidence('Find a phone with a long-lasting battery for travel.')).toEqual([]);
    expect(requestedFeatureEvidence('Show me smartphones under $500.')).toEqual([]);
  });

  it('fails safely when explicit proof language uses only an unresolved pronoun', () => {
    const requirements = requestedFeatureEvidence('Find a suitable phone. If the catalog does not mention it, return no products.');
    expect(requirements).toEqual([{ label: 'explicitly requested catalog feature', alternatives: [] }]);
    expect(filterProductsByFeatureEvidence([genericPhone], requirements)).toEqual([]);
  });
});
