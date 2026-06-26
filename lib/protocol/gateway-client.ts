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

/**
 * Read-only preflight payload returned by GET /api/models/:modelId/capabilities
 * (web-search epic, Story 16). `capabilities` is the union of heartbeat-
 * advertised capability tokens across all currently-active workers eligible
 * for the model. Empty array = no capable worker currently heartbeating.
 */
export type ModelCapabilitiesResponse = {
  modelId: string;
  capabilities: string[];
};

export type SelectSessionResponse = {
  worker: string;
  workerEncryptionKey: string;
  disputerEncryptionKey?: string;
  nonce: number;
  expiry: number;
  /**
   * Heartbeat-advertised capability set of the selected worker (web-search
   * epic, Story 12). Optional for forward-compat with pre-epic dispatchers.
   * Clients persist this in session state to gate per-message UI features
   * (e.g., disable the web-search toggle when "search" is absent).
   */
  workerCapabilities?: string[];
  /**
   * Opaque correlation token (web-search epic, Story 16). Must be echoed to
   * prepareSession so a capability-aware overwrite on the dispatcher cannot
   * bind this client to a worker that replaced the one it selected. Optional
   * for forward-compat with a dispatcher that predates the token.
   */
  selectionId?: string;
};

export type PrepareSessionResponse = {
  worker: string;
  workerEncryptionKey: string;
  signature: string;
  nonce: number;
  expiry: number;
  workerCapabilities?: string[];
};

export type UploadBlobResponse = {
  blobHashes: string[];
};

export type BalanceResponse = {
  /** Prepaid balance in wei, as a decimal string. */
  balance: string;
  /** The address the consumer-api submits on the user's behalf. */
  delegate: string;
  /** Whether `delegate` is currently authorized by the user on-chain. */
  delegateAuthorized: boolean;
};

export type SubmitMessageResponse = {
  jobId: string;
  txHash: string;
};

export class InsufficientPrepaidBalanceError extends Error {
  constructor(message = "Insufficient prepaid balance") {
    super(message);
    this.name = "InsufficientPrepaidBalanceError";
  }
}

export class DelegateNotAuthorizedError extends Error {
  readonly delegate: string;
  constructor(delegate: string) {
    super(`Delegate ${delegate} is not authorized on-chain`);
    this.name = "DelegateNotAuthorizedError";
    this.delegate = delegate;
  }
}

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

export class ProtocolAuthExpiredError extends Error {
  constructor(message = "Protocol authentication expired") {
    super(message);
    this.name = "ProtocolAuthExpiredError";
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

  /**
   * Read-only capability preflight (web-search epic, Story 16). Caller MUST
   * pass the hex model ID — use getModels() to resolve a friendly local
   * name to its hex form first. Unauthenticated, so no auth provider needed.
   */
  async getModelCapabilities(
    modelIdHex: string
  ): Promise<ModelCapabilitiesResponse> {
    return await this.get<ModelCapabilitiesResponse>(
      `/api/models/${modelIdHex}/capabilities`
    );
  }

  async selectSession(
    modelId: string,
    opts?: { requiredCapabilities?: string[] }
  ): Promise<SelectSessionResponse> {
    const body: Record<string, unknown> = { modelId };
    if (opts?.requiredCapabilities && opts.requiredCapabilities.length > 0) {
      body.requiredCapabilities = opts.requiredCapabilities;
    }
    return await this.post<SelectSessionResponse>(
      "/api/sessions/select",
      body,
      { protected: true }
    );
  }

  async prepareSession(input: {
    modelId: string;
    encWorkerKey: string;
    encDisputerKey: string;
    requiredCapabilities?: string[];
    // Story 16: correlation token from the prior selectSession response.
    selectionId?: string;
  }): Promise<PrepareSessionResponse> {
    return await this.post<PrepareSessionResponse>(
      "/api/sessions/prepare",
      input,
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

  /**
   * Reads the authenticated user's prepaid balance, the delegate address the
   * consumer-api uses, and whether the user has authorized that delegate.
   */
  async getBalance(): Promise<BalanceResponse> {
    return await this.get<BalanceResponse>("/api/balance", { protected: true });
  }

  /**
   * Submits a job on behalf of the authenticated user, debiting their prepaid
   * balance — no wallet TX. Requires the user to have authorized the delegate
   * and to have a non-zero balance, otherwise throws Delegate/Insufficient errors.
   */
  async submitMessage(
    sessionId: number,
    blobHash: string
  ): Promise<SubmitMessageResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await this.getRequestHeaders({
            protected: true,
            bearerOnly: true,
          })),
        },
        body: JSON.stringify({ blobHash }),
      }
    );

    if (res.status === 401) {
      this.auth?.clearToken?.();
      throw new ProtocolAuthExpiredError();
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}) as { delegate?: string });
      throw new DelegateNotAuthorizedError(body.delegate ?? "");
    }
    if (res.status === 402) {
      throw new InsufficientPrepaidBalanceError();
    }

    return this.handleResponse<SubmitMessageResponse>(res);
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
      if (res.status === 401) {
        throw new ProtocolAuthExpiredError();
      }
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

    if (res.status === 401 && options?.protected) {
      this.auth?.clearToken?.();
      throw new ProtocolAuthExpiredError();
    }

    return this.handleResponse<T>(res);
  }

  private async getResponse(
    path: string,
    options?: { protected?: boolean; bearerOnly?: boolean }
  ): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: await this.getRequestHeaders(options),
    });

    if (res.status === 401 && options?.protected) {
      this.auth?.clearToken?.();
      throw new ProtocolAuthExpiredError();
    }

    return res;
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
