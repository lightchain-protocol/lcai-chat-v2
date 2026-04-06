import { useSession } from "next-auth/react";
import { useCallback } from "react";

const apiBaseUrl = process.env.NEXT_PUBLIC_CONSUMER_API_URL?.replace(
  /\/+$/,
  ""
);

interface RequestOptions extends Omit<RequestInit, "headers"> {
  headers?: HeadersInit;
  auth?: boolean;
  bearerToken?: string;
}

export const useHttp = () => {
  const { data: session } = useSession();

  const buildHeaders = useCallback(
    (headers: HeadersInit = {}, auth = true, bearerToken?: string) => {
      const resolvedHeaders = new Headers(headers);
      if (auth && !resolvedHeaders.has("Authorization")) {
        const token = bearerToken ?? session?.user?.token;
        if (token) {
          resolvedHeaders.set("Authorization", `Bearer ${token}`);
        }
      }
      return resolvedHeaders;
    },
    [session]
  );

  const request = useCallback(
    async (
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      path: string,
      options: RequestOptions = {},
      body?: unknown
    ) => {
      const headers = buildHeaders(
        options.headers,
        options.auth,
        options.bearerToken
      );

      if (body !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      return response;
    },
    [buildHeaders]
  );

  const getRequest = useCallback(
    (path: string, options: RequestOptions) => {
      return request("GET", path, options);
    },
    [request]
  );

  const postRequest = useCallback(
    (path: string, body?: unknown, options: RequestOptions = {}) => {
      return request("POST", path, options, body);
    },
    [request]
  );

  const putRequest = useCallback(
    (path: string, body?: unknown, options: RequestOptions = {}) => {
      return request("PUT", path, options, body);
    },
    [request]
  );

  const patchRequest = useCallback(
    (path: string, body?: unknown, options: RequestOptions = {}) => {
      return request("PATCH", path, options, body);
    },
    [request]
  );

  const deleteRequest = useCallback(
    (path: string, body?: unknown, options: RequestOptions = {}) => {
      return request("DELETE", path, options, body);
    },
    [request]
  );

  return {
    baseUrl: apiBaseUrl,
    get: getRequest,
    post: postRequest,
    put: putRequest,
    patch: patchRequest,
    delete: deleteRequest,
  };
};
