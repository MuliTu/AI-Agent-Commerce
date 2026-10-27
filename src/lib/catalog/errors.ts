export type CatalogErrorKind =
  | 'invalid_request'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid_response';

type CatalogErrorOptions = {
  endpoint: string;
  status?: number;
  cause?: unknown;
};

export class CatalogError extends Error {
  readonly kind: CatalogErrorKind;
  readonly endpoint: string;
  readonly status?: number;

  constructor(kind: CatalogErrorKind, message: string, options: CatalogErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'CatalogError';
    this.kind = kind;
    this.endpoint = options.endpoint;
    this.status = options.status;
  }
}
