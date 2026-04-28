import { auth as authSession } from "@/app/(auth)/auth";

// Legacy storage key. Pre-fix builds wrote the SIWE-derived bearer to
// `localStorage["user-token"]` so that a tab reload could resume gateway
// calls without re-fetching the NextAuth session. Any same-origin XSS could
// then read it. We no longer write it anywhere; we evict it on
// `clearAuthToken` and once on the first browser-side `getAuthToken` so
// users on long-lived sessions get migrated without waiting for a sign-out.
const LEGACY_AUTH_LOCALSTORAGE_KEY = "user-token";

let authTokenCache: string | null = null;
let inFlightSessionFetch: Promise<string | null> | null = null;
let legacyEvicted = false;
// Bumped on every `clearAuthToken`. An in-flight rehydrate compares the
// generation it captured against the current value before writing the
// cache; a mismatch means the caller revoked the token mid-fetch (sign-out,
// 401) and the just-fetched value must not be repopulated.
let cacheGeneration = 0;
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
  // Browser-only cache. SSR runs `lib/http.ts` in a long-lived Node
  // process; writing to a module-scoped variable there would leak the
  // token across requests of unrelated users. The server path of
  // `getAuthToken` reads from the per-request `authSession()` instead.
  if (typeof window === "undefined") {
    return;
  }
  authTokenCache = token;
}

export function clearAuthToken(): void {
  authTokenCache = null;
  // Invalidate any rehydrate currently in flight so its resolved token
  // does not repopulate the cache after the caller decided to revoke.
  cacheGeneration++;
  inFlightSessionFetch = null;

  if (typeof window === "undefined") {
    return;
  }

  // Migration: evict any token left in localStorage by older builds. New
  // tokens are never persisted there, so this is a one-way cleanup.
  legacyEvicted = true;
  try {
    localStorage.removeItem(LEGACY_AUTH_LOCALSTORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
}

function evictLegacyLocalStorageToken(): void {
  if (legacyEvicted || typeof window === "undefined") {
    return;
  }
  legacyEvicted = true;
  try {
    localStorage.removeItem(LEGACY_AUTH_LOCALSTORAGE_KEY);
  } catch {
    // localStorage unavailable
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

  // Browser: rehydrate from the NextAuth session cookie. The cache is
  // normally populated by `syncAuthTokenFromSession` (lib/siwe/config.ts)
  // on sign-in and on AppKit init; this fallback covers cold-start callers
  // that race the AppKit boot. Concurrent callers share a single in-flight
  // request so cold start doesn't fan out to N round-trips.
  if (inFlightSessionFetch) {
    return inFlightSessionFetch;
  }

  const startGeneration = cacheGeneration;
  inFlightSessionFetch = (async () => {
    try {
      // Dynamic import keeps `next-auth/react` (a "use client" module) out
      // of any server bundle that statically pulls in `lib/http.ts`.
      const { getSession } = await import("next-auth/react");
      const session = await getSession();
      const token = session?.user?.token ?? null;
      if (cacheGeneration !== startGeneration) {
        // `clearAuthToken` ran while we were fetching — the token we just
        // received is no longer authoritative. Surface as unauthenticated
        // and let the next call rehydrate cleanly.
        return null;
      }
      if (token) {
        authTokenCache = token;
      }
      return token;
    } catch {
      // Network blip / NextAuth route unavailable: surface as unauthenticated
      // rather than rejecting the gateway request with a fetch error.
      return null;
    } finally {
      // Best-effort one-time migration of any stale token from older builds.
      evictLegacyLocalStorageToken();
      // Only release this promise if it's still the current in-flight one.
      // `clearAuthToken` may have already nulled it.
      if (inFlightSessionFetch !== null) {
        inFlightSessionFetch = null;
      }
    }
  })();

  return inFlightSessionFetch;
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
  bearerToken?: string
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
  options: RequestOptions = {}
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
  options: JsonRequestOptions = {}
): Promise<Response> {
  const headers = await buildHeaders(
    options.headers,
    options.auth ?? true,
    options.bearerToken
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
  options: RequestOptions = {}
): Promise<Response> {
  return request(path, { ...options, method: "GET" });
}

export function postRequest(
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {}
): Promise<Response> {
  return jsonRequest("POST", path, body, options);
}

export function putRequest(
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {}
): Promise<Response> {
  return jsonRequest("PUT", path, body, options);
}

export function patchRequest(
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {}
): Promise<Response> {
  return jsonRequest("PATCH", path, body, options);
}

export function deleteRequest(
  path: string,
  body?: unknown,
  options: JsonRequestOptions = {}
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
