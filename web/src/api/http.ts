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

async function readJson(response: Response, requestId?: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiRequestError('invalid-response', 'INVALID_RESPONSE', { requestId });
  }
}

function apiErrorFromPayload(response: Response, payload: unknown): ApiRequestError {
  const headerRequestId = getNonBlankString(response.headers.get('X-Request-Id'));
  const retryAfterSeconds = parseRetryAfter(response);
  if (isRecord(payload) && isRecord(payload.error)) {
    const code = getNonBlankString(payload.error.code) ?? 'INTERNAL_ERROR';
    const requestId = getNonBlankString(payload.requestId) ?? headerRequestId;
    return new ApiRequestError('api', code, { requestId, retryAfterSeconds });
  }
  return new ApiRequestError('invalid-response', 'INVALID_RESPONSE', {
    requestId: headerRequestId,
    retryAfterSeconds,
  });
}

interface RequestOptions {
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  acceptedStatuses?: readonly number[];
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  isData: (value: unknown) => value is T,
  options: RequestOptions = {},
): Promise<ApiSuccess<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(path, { ...init, signal: options.signal });
  } catch {
    throw new ApiRequestError('network', 'NETWORK_ERROR');
  }

  const headerRequestId = getNonBlankString(response.headers.get('X-Request-Id'));
  const payload = await readJson(response, headerRequestId);
  const hasAcceptedStatus =
    options.acceptedStatuses === undefined || options.acceptedStatuses.includes(response.status);

  if (!response.ok) throw apiErrorFromPayload(response, payload);
  if (!hasAcceptedStatus) {
    throw new ApiRequestError('invalid-response', 'INVALID_RESPONSE', {
      requestId: headerRequestId,
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

export async function postJson<T>(
  path: string,
  body: unknown,
  isData: (value: unknown) => value is T,
  fetchImpl: FetchLike = fetch,
): Promise<ApiSuccess<T>> {
  return requestJson(
    path,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    isData,
    { fetchImpl, acceptedStatuses: [200] },
  );
}

export function postForm<T>(
  path: string,
  form: FormData,
  headers: Record<string, string>,
  isData: (value: unknown) => value is T,
  options: RequestOptions = {},
): Promise<ApiSuccess<T>> {
  return requestJson(
    path,
    {
      method: 'POST',
      headers: { Accept: 'application/json', ...headers },
      body: form,
    },
    isData,
    options,
  );
}

export function getJson<T>(
  path: string,
  isData: (value: unknown) => value is T,
  options: RequestOptions = {},
): Promise<ApiSuccess<T>> {
  return requestJson(path, { method: 'GET', headers: { Accept: 'application/json' } }, isData, {
    ...options,
    acceptedStatuses: options.acceptedStatuses ?? [200],
  });
}

export async function getText(
  path: string,
  options: RequestOptions = {},
): Promise<ApiSuccess<string>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
      signal: options.signal,
    });
  } catch {
    throw new ApiRequestError('network', 'NETWORK_ERROR');
  }

  const requestId = getNonBlankString(response.headers.get('X-Request-Id'));
  if (!response.ok) {
    const payload = await readJson(response, requestId);
    throw apiErrorFromPayload(response, payload);
  }
  if (
    response.status !== 200 ||
    !/^text\/plain(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
  ) {
    throw new ApiRequestError('invalid-response', 'INVALID_RESPONSE', { requestId });
  }
  if (requestId === undefined) {
    throw new ApiRequestError('invalid-response', 'INVALID_RESPONSE');
  }
  return { data: await response.text(), requestId };
}
