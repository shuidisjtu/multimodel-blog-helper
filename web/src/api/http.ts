export interface ApiSuccess<T> {
  data: T;
  requestId: string;
}

export type ApiErrorKind = 'api' | 'network' | 'invalid-response';

export class ApiRequestError extends Error {
  readonly kind: ApiErrorKind;
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    kind: ApiErrorKind,
    code: string,
    options: { requestId?: string; retryAfterSeconds?: number } = {},
  ) {
    super(code);
    this.name = 'ApiRequestError';
    this.kind = kind;
    this.code = code;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

type FetchLike = typeof fetch;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (value === null || !/^\d+$/.test(value)) return undefined;
  return Number.parseInt(value, 10);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiRequestError('invalid-response', 'INVALID_RESPONSE');
  }
}

export async function postJson<T>(
  path: string,
  body: unknown,
  isData: (value: unknown) => value is T,
  fetchImpl: FetchLike = fetch,
): Promise<ApiSuccess<T>> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError('network', 'NETWORK_ERROR');
  }

  const payload = await readJson(response);
  const headerRequestId = getNonBlankString(response.headers.get('X-Request-Id'));

  if (!response.ok) {
    if (isRecord(payload) && isRecord(payload.error)) {
      const code = getNonBlankString(payload.error.code) ?? 'INTERNAL_ERROR';
      const requestId = getNonBlankString(payload.requestId) ?? headerRequestId;
      throw new ApiRequestError('api', code, {
        requestId,
        retryAfterSeconds: parseRetryAfter(response),
      });
    }
    throw new ApiRequestError('invalid-response', 'INVALID_RESPONSE', {
      requestId: headerRequestId,
      retryAfterSeconds: parseRetryAfter(response),
    });
  }

  if (!isRecord(payload) || !isData(payload.data)) {
    throw new ApiRequestError('invalid-response', 'INVALID_RESPONSE', {
      requestId: headerRequestId,
    });
  }

  const requestId = getNonBlankString(payload.requestId) ?? headerRequestId;
  if (requestId === undefined) {
    throw new ApiRequestError('invalid-response', 'INVALID_RESPONSE');
  }

  return { data: payload.data, requestId };
}
