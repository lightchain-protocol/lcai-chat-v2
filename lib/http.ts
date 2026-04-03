import { resolveApiUrl } from '@/lib/utils';

const AUTH_TOKEN_KEYS = ['user-token', 'token'] as const;
let authTokenCache: string | null = null;

export function setAuthToken(token: string): void {
  authTokenCache = token;

  if (typeof window === 'undefined') {
    return;
  }

  for (const key of AUTH_TOKEN_KEYS) {
    localStorage.setItem(key, token);
  }
}

export function clearAuthToken(): void {
  authTokenCache = null;

  if (typeof window === 'undefined') {
    return;
  }

  for (const key of AUTH_TOKEN_KEYS) {
    localStorage.removeItem(key);
  }
}

function getAuthToken(): string | null {
  if (authTokenCache) {
    return authTokenCache;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  for (const key of AUTH_TOKEN_KEYS) {
    const token = localStorage.getItem(key);
    if (token) {
      authTokenCache = token;
      return token;
    }
  }

  return null;
}

interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: HeadersInit;
  auth?: boolean;
}

interface JsonRequestOptions extends Omit<RequestOptions, 'body'> {}

function buildHeaders(headers?: HeadersInit, auth = true): Headers {
  const resolvedHeaders = new Headers(headers);

  if (auth && !resolvedHeaders.has('Authorization')) {
    const token = getAuthToken();
    if (token) {
      resolvedHeaders.set('Authorization', `Bearer ${token}`);
    }
  }

  return resolvedHeaders;
}

export function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const { auth = true, headers, ...rest } = options;

  return fetch(resolveApiUrl(path), {
    ...rest,
    headers: buildHeaders(headers, auth),
  });
}

function jsonRequest(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {},
): Promise<Response> {
  const headers = buildHeaders(options.headers, options.auth ?? true);

  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return request(path, {
    ...options,
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  return request(path, { ...options, method: 'GET' });
}

export function postRequest(path: string, body?: unknown, options: JsonRequestOptions = {}): Promise<Response> {
  return jsonRequest('POST', path, body, options);
}

export function putRequest(path: string, body?: unknown, options: JsonRequestOptions = {}): Promise<Response> {
  return jsonRequest('PUT', path, body, options);
}

export function patchRequest(path: string, body?: unknown, options: JsonRequestOptions = {}): Promise<Response> {
  return jsonRequest('PATCH', path, body, options);
}

export function deleteRequest(path: string, body?: unknown, options: JsonRequestOptions = {}): Promise<Response> {
  return jsonRequest('DELETE', path, body, options);
}

export const $http = {
  request,
  get: getRequest,
  post: postRequest,
  put: putRequest,
  patch: patchRequest,
  delete: deleteRequest,
} as const;
