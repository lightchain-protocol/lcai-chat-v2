/**
 * Typed HTTP client for the LightChain Gateway API.
 *
 * All methods throw on non-2xx responses with the error body included.
 * Base URL comes from NEXT_PUBLIC_GATEWAY_URL env var.
 */

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ModelsResponse {
  models: ModelInfo[];
}

export interface PrepareSessionResponse {
  worker: string;
  workerEncryptionKey: string;
  disputerEncryptionKey?: string;
  signature: string;
  nonce: number;
  expiry: number;
}

export interface UploadBlobResponse {
  blobHashes: string[];
}

export interface TokenResponse {
  token: string;
  expiresAt: string;
}

export interface PendingTokenResponse {
  status: "pending";
  message: string;
}

export interface AuthProvider {
  buildProtectedHeaders(): Promise<Record<string, string>>;
  buildBearerOnlyHeaders?(): Promise<Record<string, string>>;
  clearToken?(): void;
}

export class GatewayClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "GatewayClientError";
  }
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly auth?: AuthProvider;

  constructor(baseUrl?: string, auth?: AuthProvider) {
    const url = baseUrl ?? process.env.NEXT_PUBLIC_GATEWAY_URL;
    if (!url) {
      throw new Error(
        "Gateway URL not configured: set NEXT_PUBLIC_GATEWAY_URL or pass baseUrl",
      );
    }
    // Strip trailing slash for consistent path joining
    this.baseUrl = url.replace(/\/+$/, "");
    this.auth = auth;
  }

  async getModels(): Promise<ModelsResponse> {
    return this.get<ModelsResponse>("/api/models");
  }

  async prepareSession(modelId: string): Promise<PrepareSessionResponse> {
    return this.post<PrepareSessionResponse>(
      "/api/sessions/prepare",
      { modelId },
      { protected: true },
    );
  }

  async uploadBlob(base64Data: string): Promise<UploadBlobResponse> {
    return this.post<UploadBlobResponse>(
      "/api/blobs",
      { data: base64Data },
      { protected: true, bearerOnly: true },
    );
  }

  async getSessionToken(
    sessionId: number,
  ): Promise<TokenResponse | PendingTokenResponse> {
    let res = await this.getResponse(`/api/sessions/${sessionId}/token`, {
      protected: true,
    });

    // Retry once on 401: clear the token and re-authenticate.
    if (res.status === 401 && this.auth?.clearToken) {
      this.auth.clearToken();
      res = await this.getResponse(`/api/sessions/${sessionId}/token`, {
        protected: true,
      });
    }

    if (res.status === 202) {
      return res.json() as Promise<PendingTokenResponse>;
    }

    return this.handleResponse<TokenResponse>(res);
  }

  private async get<T>(
    path: string,
    options?: { protected?: boolean },
  ): Promise<T> {
    const res = await this.getResponse(path, options);
    return this.handleResponse<T>(res);
  }

  private async post<T>(
    path: string,
    body: unknown,
    options?: { protected?: boolean; bearerOnly?: boolean },
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await this.getRequestHeaders(options)),
      },
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  private async getResponse(
    path: string,
    options?: { protected?: boolean; bearerOnly?: boolean },
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: await this.getRequestHeaders(options),
    });
  }

  private async getRequestHeaders(
    options?: { protected?: boolean; bearerOnly?: boolean },
  ): Promise<Record<string, string>> {
    if (!options?.protected) {
      return {};
    }
    if (!this.auth) {
      throw new Error("Protected gateway request requires auth provider");
    }
    if (options.bearerOnly && this.auth.buildBearerOnlyHeaders) {
      return this.auth.buildBearerOnlyHeaders();
    }
    return this.auth.buildProtectedHeaders();
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GatewayClientError(
        `Gateway API error: ${res.status} ${res.statusText}`,
        res.status,
        text,
      );
    }
    return res.json() as Promise<T>;
  }
}
