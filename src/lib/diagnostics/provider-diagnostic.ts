import { APICallError, NoObjectGeneratedError } from 'ai';
import { ZodError } from 'zod';
import { CatalogError } from '../catalog';
import { PersistenceConflictError } from '../persistence';

export type DiagnosticStage =
  | 'request_validation'
  | 'provider_request'
  | 'provider_output_validation'
  | 'catalog_fetch'
  | 'persistence'
  | 'response_serialization'
  | 'execution';

export type SafeDiagnostic = {
  stage: DiagnosticStage;
  class: 'request_validation' | 'response_serialization' | 'api_call_error' | 'provider_output_validation' | 'catalog_error' | 'persistence_conflict' | 'sqlite_error' | 'unknown';
  status?: number;
  code?: string;
  param?: string;
};

const providerTokens = new Set([
  'invalid_json_schema', 'invalid_request_error', 'rate_limit_error', 'authentication_error',
  'model_not_found', 'context_length_exceeded', 'server_error',
]);
const providerParams = new Set(['text.format.schema', 'response_format', 'model', 'input', 'messages', 'tools']);
const sqliteCodes = new Set([
  'SQLITE_BUSY', 'SQLITE_CONSTRAINT', 'SQLITE_READONLY', 'SQLITE_CANTOPEN',
  'SQLITE_IOERR', 'SQLITE_CORRUPT', 'SQLITE_MISMATCH',
]);
const diagnosticStages = new Set<DiagnosticStage>([
  'request_validation', 'provider_request', 'provider_output_validation', 'catalog_fetch',
  'persistence', 'response_serialization', 'execution',
]);
const diagnosticClasses = new Set<SafeDiagnostic['class']>([
  'request_validation', 'response_serialization', 'api_call_error', 'provider_output_validation',
  'catalog_error', 'persistence_conflict', 'sqlite_error', 'unknown',
]);

function safeStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function safeProviderToken(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z0-9_.-]+$/i.test(value)) return undefined;
  return providerTokens.has(value) ? value : undefined;
}

function safeProviderParam(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  return providerParams.has(value) ? value : undefined;
}

function providerErrorFields(error: unknown): Pick<SafeDiagnostic, 'code' | 'param'> {
  if (!error || typeof error !== 'object' || !('data' in error)) return {};
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return {};
  const nested = 'error' in data && data.error && typeof data.error === 'object' ? data.error : data;
  const record = nested as { type?: unknown; code?: unknown; param?: unknown };
  return {
    code: safeProviderToken(record.code) ?? safeProviderToken(record.type),
    param: safeProviderParam(record.param),
  };
}

function classify(error: unknown, fallbackStage: DiagnosticStage): SafeDiagnostic | undefined {
  if (APICallError.isInstance(error)) {
    return { stage: 'provider_request', class: 'api_call_error', ...providerErrorFields(error), ...(safeStatus(error.statusCode) === undefined ? {} : { status: safeStatus(error.statusCode) }) };
  }
  if (NoObjectGeneratedError.isInstance(error)
  ) {
    return { stage: 'provider_output_validation', class: 'provider_output_validation' };
  }
  if (error instanceof ZodError
    || Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'ZodError' && Array.isArray((error as { issues?: unknown }).issues))) {
    if (fallbackStage === 'request_validation') return { stage: fallbackStage, class: 'request_validation' };
    if (fallbackStage === 'response_serialization') return { stage: fallbackStage, class: 'response_serialization' };
    return { stage: 'provider_output_validation', class: 'provider_output_validation' };
  }
  if (error instanceof CatalogError
    || Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'CatalogError')) {
    const status = safeStatus((error as { status?: unknown }).status);
    return { stage: 'catalog_fetch', class: 'catalog_error', ...(status === undefined ? {} : { status }) };
  }
  if (error instanceof PersistenceConflictError
    || Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'PersistenceConflictError')) {
    return { stage: fallbackStage, class: 'persistence_conflict' };
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && sqliteCodes.has(code)) {
      return { stage: fallbackStage, class: 'sqlite_error', code };
    }
  }
  return undefined;
}

export function createSafeDiagnostic(error: unknown, fallbackStage: DiagnosticStage): SafeDiagnostic {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const diagnostic = classify(current, fallbackStage);
    if (diagnostic) return diagnostic;
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return { stage: fallbackStage, class: 'unknown' };
}

export function normalizeSafeDiagnostic(value: unknown): SafeDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { stage?: unknown; class?: unknown; status?: unknown; code?: unknown; param?: unknown };
  if (typeof candidate.stage !== 'string' || !diagnosticStages.has(candidate.stage as DiagnosticStage)) return undefined;
  if (typeof candidate.class !== 'string' || !diagnosticClasses.has(candidate.class as SafeDiagnostic['class'])) return undefined;

  const stage = candidate.stage as DiagnosticStage;
  const diagnosticClass = candidate.class as SafeDiagnostic['class'];
  const normalized: SafeDiagnostic = { stage, class: diagnosticClass };

  if (diagnosticClass === 'api_call_error') {
    const status = safeStatus(candidate.status);
    const code = safeProviderToken(candidate.code);
    const param = safeProviderParam(candidate.param);
    if (status !== undefined) normalized.status = status;
    if (code !== undefined) normalized.code = code;
    if (param !== undefined) normalized.param = param;
  } else if (diagnosticClass === 'catalog_error') {
    const status = safeStatus(candidate.status);
    if (status !== undefined) normalized.status = status;
  } else if (diagnosticClass === 'sqlite_error' && typeof candidate.code === 'string' && sqliteCodes.has(candidate.code)) {
    normalized.code = candidate.code;
  }

  return normalized;
}
