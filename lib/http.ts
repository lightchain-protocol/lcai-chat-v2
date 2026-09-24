import { auth as authSession } from "@/app/(auth)/auth";
import { jwtExpirySecs } from "@/lib/jwt";

const AUTH_TOKEN_KEYS = ["user-token"] as const;
let authTokenCache: string | null = null;
// Browser: use the public URL (baked in at build time) so requests go through
// the host's port mapping. Server (Node runtime inside the container): prefer
// CONSUMER_API_INTERNAL_URL (compose DNS) because the container's own localhost
// does not route to the consumer-api service.
const apiBaseUrl = (() => {
  // biome-ignore lint/performance/useTopLevelRegex: This is a performance optimization
  const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");
  const publicUrl = process.env.NEXT_PUBLIC_CONSUMER_API_URL
    ? stripTrailingSlash(process.env.NEXT_PUBLIC_CONSUMER_API_URL)
    : undefined;
  if (typeof window !== "undefined") {
    return publicUrl;
  }
  const internalUrl = process.env.CONSUMER_API_INTERNAL_URL
    ? stripTrailingSlash(process.env.CONSUMER_API_INTERNAL_URL)
    : undefined;
  return internalUrl ?? publicUrl;
})();

export function setAuthToken(token: string): void {
  authTokenCache = token;

  if (typeof window === "undefined") {
    return;
  }

  for (const key of AUTH_TOKEN_KEYS) {
    localStorage.setItem(key, token);
  }
}

export function clearAuthToken(): void {
  authTokenCache = null;

  if (typeof window === "undefined") {
    return;
  }

  for (const key of AUTH_TOKEN_KEYS) {
    localStorage.removeItem(key);
  }
}

export async function getAuthToken(): Promise<string | null> {
  if (authTokenCache) {
    return authTokenCache;
  }

  if (typeof window === "undefined") {
    const session = await authSession();
    return session?.user?.token ?? null;
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

/** A token this close to its exp counts as gone, so a send never expires mid-flight. */
const AUTH_TOKEN_SKEW_SECS = 30;

/**
 * Whether the consumer-api token can still carry a request. It lives an hour
 * while the NextAuth session holding it lives for weeks, so a tab left open
 * keeps looking signed in after every call it makes has started to fail.
 * Synchronous so a send can be gated on it.
 */
export function hasUsableAuthToken(): boolean {
  const token =
    authTokenCache ??
    (typeof window === "undefined"
      ? null
      : localStorage.getItem(AUTH_TOKEN_KEYS[0]));
  if (!token) {
    return false;
  }
  const exp = jwtExpirySecs(token);
  // ponytail: an unreadable token is left for the server to judge.
  return exp === null || exp - AUTH_TOKEN_SKEW_SECS > Date.now() / 1000;
}

interface RequestOptions extends Omit<RequestInit, "headers"> {
  headers?: HeadersInit;
  auth?: boolean;
  bearerToken?: string;
}

interface JsonRequestOptions extends Omit<RequestOptions, "body"> {}

async function buildHeaders(
  headers?: HeadersInit,
  auth = true,
  bearerToken?: string,
): Promise<Headers> {
  const resolvedHeaders = new Headers(headers);

  if (auth && !resolvedHeaders.has("Authorization")) {
    const token = bearerToken ?? (await getAuthToken());
    if (token) {
      resolvedHeaders.set("Authorization", `Bearer ${token}`);
    }
  }

  return resolvedHeaders;
}

export async function request(
  path: string | URL | Request,
  options: RequestOptions = {},
): Promise<Response> {
  const { auth = true, headers, ...rest } = options;

  return fetch(`${apiBaseUrl}${path}`, {
    ...rest,
    headers: await buildHeaders(headers, auth),
  });
}

async function jsonRequest(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {},
): Promise<Response> {
  const headers = await buildHeaders(
    options.headers,
    options.auth ?? true,
    options.bearerToken,
  );

  if (body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return request(path, {
    ...options,
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getRequest(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  return request(path, { ...options, method: "GET" });
}

export function postRequest(
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {},
): Promise<Response> {
  return jsonRequest("POST", path, body, options);
}

export function putRequest(
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {},
): Promise<Response> {
  return jsonRequest("PUT", path, body, options);
}

export function patchRequest(
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {},
): Promise<Response> {
  return jsonRequest("PATCH", path, body, options);
}

export function deleteRequest(
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {},
): Promise<Response> {
  return jsonRequest("DELETE", path, body, options);
}

export const $http = {
  baseUrl: apiBaseUrl,
  request,
  get: getRequest,
  post: postRequest,
  put: putRequest,
  patch: patchRequest,
  delete: deleteRequest,
} as const;
