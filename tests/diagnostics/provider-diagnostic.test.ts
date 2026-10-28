import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CatalogError } from '../../src/lib/catalog';
import { createSafeDiagnostic, normalizeSafeDiagnostic } from '../../src/lib/diagnostics/provider-diagnostic';
import { PersistenceConflictError } from '../../src/lib/persistence';

const apiMarker = Symbol.for('vercel.ai.error.AI_APICallError');
const objectMarker = Symbol.for('vercel.ai.error.AI_NoObjectGeneratedError');

describe('safe provider diagnostics', () => {
  it('allowlists API status, code, and parameter without serializing private response data', () => {
    const error = Object.assign(new Error('private provider body'), {
      [apiMarker]: true,
      statusCode: 400,
      data: { error: { type: 'invalid_request_error', code: 'invalid_json_schema', param: 'text.format.schema', message: 'private schema and key' } },
      responseHeaders: { authorization: 'secret' },
    });
    expect(createSafeDiagnostic(error, 'execution')).toEqual({
      stage: 'provider_request', class: 'api_call_error', status: 400,
      code: 'invalid_json_schema', param: 'text.format.schema',
    });
    expect(JSON.stringify(createSafeDiagnostic(error, 'execution'))).not.toContain('private');
  });

  it('classifies structured-output and Zod validation without generated text', () => {
    const noObject = Object.assign(new Error('private generated text'), { [objectMarker]: true, text: 'private generated text' });
    expect(createSafeDiagnostic(noObject, 'execution')).toEqual({ stage: 'provider_output_validation', class: 'provider_output_validation' });
    const zod = z.object({ value: z.string() }).safeParse({ value: 3 });
    if (zod.success) throw new Error('Expected validation to fail.');
    expect(createSafeDiagnostic(zod.error, 'response_serialization')).toEqual({ stage: 'response_serialization', class: 'response_serialization' });
  });

  it('classifies catalog and persistence failures using bounded safe fields', () => {
    const catalog = new CatalogError('http', 'private endpoint body', { endpoint: 'https://private', status: 503 });
    expect(createSafeDiagnostic(catalog, 'execution')).toEqual({ stage: 'catalog_fetch', class: 'catalog_error', status: 503 });
    expect(createSafeDiagnostic(new PersistenceConflictError('private row'), 'persistence')).toEqual({ stage: 'persistence', class: 'persistence_conflict' });
    expect(createSafeDiagnostic(Object.assign(new Error('private sqlite path'), { code: 'SQLITE_BUSY' }), 'persistence'))
      .toEqual({ stage: 'persistence', class: 'sqlite_error', code: 'SQLITE_BUSY' });
  });

  it('unwraps bounded causes and reduces unknown failures to class only', () => {
    const inner = Object.assign(new Error('private'), { code: 'SQLITE_CONSTRAINT' });
    expect(createSafeDiagnostic(new Error('wrapper', { cause: inner }), 'persistence'))
      .toEqual({ stage: 'persistence', class: 'sqlite_error', code: 'SQLITE_CONSTRAINT' });
    expect(createSafeDiagnostic(new Error('private arbitrary failure'), 'execution'))
      .toEqual({ stage: 'execution', class: 'unknown' });
  });

  it('normalizes supplied diagnostics through the same strict allowlist', () => {
    expect(normalizeSafeDiagnostic({
      stage: 'provider_request', class: 'api_call_error', status: 400,
      code: 'invalid_json_schema', param: 'text.format.schema',
      message: 'private response', headers: { authorization: 'secret' }, key: 'secret',
    })).toEqual({
      stage: 'provider_request', class: 'api_call_error', status: 400,
      code: 'invalid_json_schema', param: 'text.format.schema',
    });
    expect(normalizeSafeDiagnostic({
      stage: 'provider_request', class: 'api_call_error', status: 999,
      code: 'private_code', param: 'private.parameter',
    })).toEqual({ stage: 'provider_request', class: 'api_call_error' });
    expect(normalizeSafeDiagnostic({ stage: 'private_stage', class: 'unknown' })).toBeUndefined();
  });
});
