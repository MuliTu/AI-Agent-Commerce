import { APICallError, NoObjectGeneratedError } from 'ai';
import { CatalogError } from '../catalog';
import { createSafeDiagnostic, type SafeDiagnostic } from '../diagnostics/provider-diagnostic';

const retryableTransportCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);
const agentBoundaryErrorMarker = Symbol.for('bazak.agent.AgentBoundaryError');
const agentErrorCodes = new Set<AgentErrorCode>([
  'provider_authentication', 'provider_rate_limit', 'provider_unavailable',
  'catalog_unavailable', 'unknown_product', 'invalid_tool_output',
]);

function isRetryableTransportFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if (current instanceof TypeError && current.message.trim().toLowerCase() === 'fetch failed') return true;
    const code = 'code' in current ? (current as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && retryableTransportCodes.has(code.toUpperCase())) return true;
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export type AgentErrorCode =
  | 'provider_authentication'
  | 'provider_rate_limit'
  | 'provider_unavailable'
  | 'catalog_unavailable'
  | 'unknown_product'
  | 'invalid_tool_output';

export class AgentBoundaryError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable: boolean;
  readonly diagnostic?: SafeDiagnostic;

  constructor(code: AgentErrorCode, message: string, retryable: boolean, cause?: unknown, diagnostic?: SafeDiagnostic) {
    super(message, { cause });
    this.name = 'AgentBoundaryError';
    this.code = code;
    this.retryable = retryable;
    this.diagnostic = diagnostic;
    Object.defineProperty(this, agentBoundaryErrorMarker, { value: true });
  }

  static isInstance(error: unknown): error is AgentBoundaryError {
    if (error instanceof AgentBoundaryError) return true;
    if (!error || typeof error !== 'object' || (error as Record<PropertyKey, unknown>)[agentBoundaryErrorMarker] !== true) return false;
    const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown };
    return typeof candidate.code === 'string'
      && agentErrorCodes.has(candidate.code as AgentErrorCode)
      && typeof candidate.message === 'string'
      && typeof candidate.retryable === 'boolean';
  }
}

export function toCatalogAgentError(error: unknown): AgentBoundaryError {
  if (AgentBoundaryError.isInstance(error)) return error;
  if (error instanceof CatalogError) {
    if (error.kind === 'http' && error.status === 404) {
      return new AgentBoundaryError('unknown_product', 'The requested product is not in the catalog.', false, error);
    }
    const retryable = error.kind === 'timeout' || error.kind === 'network' ||
      (error.kind === 'http' && error.status !== undefined && (error.status === 429 || error.status >= 500));
    return new AgentBoundaryError('catalog_unavailable', 'The catalog request could not be completed.', retryable, error);
  }
  return new AgentBoundaryError('catalog_unavailable', 'The catalog request could not be completed.', false, error);
}

export function toProviderAgentError(error: unknown): AgentBoundaryError {
  if (AgentBoundaryError.isInstance(error)) return error;
  if (NoObjectGeneratedError.isInstance(error)) {
    return new AgentBoundaryError(
      'invalid_tool_output',
      'The model provider returned output that did not match the required schema.',
      false,
      undefined,
      createSafeDiagnostic(error, 'provider_output_validation'),
    );
  }
  if (APICallError.isInstance(error)) {
    const diagnostic = createSafeDiagnostic(error, 'provider_request');
    const status = error.statusCode;
    if (status === 401 || status === 403) {
      return new AgentBoundaryError('provider_authentication', 'The model provider rejected the request.', false, error, diagnostic);
    }
    if (status === 429) {
      return new AgentBoundaryError('provider_rate_limit', 'The model provider rate limit was reached.', true, error, diagnostic);
    }
    return new AgentBoundaryError(
      'provider_unavailable',
      status !== undefined && status >= 400 && status < 500
        ? 'The model provider could not accept the request.'
        : 'The model provider request failed.',
      status === undefined || status >= 500,
      error,
      diagnostic,
    );
  }
  const retryable = isRetryableTransportFailure(error);
  return new AgentBoundaryError(
    'provider_unavailable',
    retryable ? 'The model provider is temporarily unreachable. Try again.' : 'The model provider request failed.',
    retryable,
    error,
    createSafeDiagnostic(error, 'provider_request'),
  );
}
