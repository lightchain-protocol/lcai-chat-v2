/**
 * Typed HTTP client for the LightChain Gateway API.
 *
 * All methods throw on non-2xx responses with the error body included.
 * Base URL comes from NEXT_PUBLIC_CONSUMER_API_URL env var.
 */

export type ModelInfo = {
  id: string;
  name: string;
};

export type ModelsResponse = {
  models: ModelInfo[];
};

export type PrepareSessionResponse = {
  worker: string;
  workerEncryptionKey: string;
  disputerEncryptionKey?: string;
  signature: string;
  nonce: number;
  expiry: number;
};

export type UploadBlobResponse = {
  blobHashes: string[];
};

export type TokenResponse = {
  token: string;
  expiresAt: string;
};

export type PendingTokenResponse = {
  status: "pending";
  message: string;
};

export type SessionStatusResponse = {
  sessionStatus: string; // "active" | "awaiting_reassignment" | "reassigning" | "closed" | "unknown"
};

export type AuthProvider = {
  buildProtectedHeaders(): Promise<Record<string, string>>;
  buildBearerOnlyHeaders?(): Promise<Record<string, string>>;
  clearToken?(): void;
};

export class GatewayClientError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "GatewayClientError";
    this.status = status;
    this.body = body;
  }
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly auth?: AuthProvider;

  constructor(baseUrl?: string, auth?: AuthProvider) {
    const url = baseUrl ?? process.env.NEXT_PUBLIC_CONSUMER_API_URL;
    if (!url) {
      throw new Error(
        "Gateway URL not configured: set NEXT_PUBLIC_CONSUMER_API_URL or pass baseUrl"
      );
    }
    // Strip trailing slash for consistent path joining
    // biome-ignore lint/performance/useTopLevelRegex: regex is used for path joining
    this.baseUrl = url.replace(/\/+$/, "");
    this.auth = auth;
  }

  async getModels(): Promise<ModelsResponse> {
    return await this.get<ModelsResponse>("/api/models");
  }

  async prepareSession(modelId: string): Promise<PrepareSessionResponse> {
    return await this.post<PrepareSessionResponse>(
      "/api/sessions/prepare",
      { modelId },
      { protected: true }
    );
  }

  async uploadBlob(base64Data: string): Promise<UploadBlobResponse> {
    return await this.post<UploadBlobResponse>(
      "/api/blobs",
      { data: base64Data },
      { protected: true, bearerOnly: true }
    );
  }

  async getSessionToken(
    sessionId: number
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

  /**
   * Checks dispatcher-local session status for recovery-on-reconnect.
   * Piggybacks on the token endpoint which will include sessionStatus
   * once the companion dispatcher change ships. Returns "unknown" on
   * any error so reconnect recovery falls through to the on-chain check.
   */
  async getSessionStatus(sessionId: number): Promise<SessionStatusResponse> {
    let res: Response;
    try {
      res = await this.getResponse(`/api/sessions/${sessionId}/token`, {
        protected: true,
      });
    } catch {
      return { sessionStatus: "unknown" };
    }

    // 401: retry with fresh auth (same pattern as getSessionToken)
    if (res.status === 401 && this.auth?.clearToken) {
      this.auth.clearToken();
      try {
        res = await this.getResponse(`/api/sessions/${sessionId}/token`, {
          protected: true,
        });
      } catch {
        return { sessionStatus: "unknown" };
      }
    }

    if (res.status === 202 || res.status === 404 || !res.ok) {
      return { sessionStatus: "unknown" };
    }

    try {
      const data = await res.json();
      return { sessionStatus: data.sessionStatus ?? "active" };
    } catch {
      return { sessionStatus: "unknown" };
    }
  }

  private async get<T>(
    path: string,
    options?: { protected?: boolean }
  ): Promise<T> {
    const res = await this.getResponse(path, options);
    return this.handleResponse<T>(res);
  }

  private async post<T>(
    path: string,
    body: unknown,
    options?: { protected?: boolean; bearerOnly?: boolean }
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
    options?: { protected?: boolean; bearerOnly?: boolean }
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: await this.getRequestHeaders(options),
    });
  }

  private async getRequestHeaders(options?: {
    protected?: boolean;
    bearerOnly?: boolean;
  }): Promise<Record<string, string>> {
    if (!options?.protected) {
      return {};
    }
    if (!this.auth) {
      throw new Error("Protected gateway request requires auth provider");
    }
    if (options.bearerOnly && this.auth.buildBearerOnlyHeaders) {
      return await this.auth.buildBearerOnlyHeaders();
    }
    return await this.auth.buildProtectedHeaders();
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GatewayClientError(
        `Gateway API error: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }
    return res.json() as Promise<T>;
  }
}
