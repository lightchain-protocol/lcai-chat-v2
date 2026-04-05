import { auth as authSession } from "@/app/(auth)/auth";

const AUTH_TOKEN_KEYS = ["user-token"] as const;
let authTokenCache: string | null = null;
const apiBaseUrl = process.env.NEXT_PUBLIC_CONSUMER_API_URL?.replace(
  /\/+$/,
  ""
);

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

async function getAuthToken(): Promise<string | null> {
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
