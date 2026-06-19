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

export type AccountModeResponse = {
  mode: "direct" | "delegated" | "unsupported_delegation";
  implementation?: string;
};

export type AaConfigResponse = {
  chainId: number;
  jobRegistry: string;
  sessionManagerImpl: string | null;
  sessionManagerName: string | null;
  sessionManagerVersion: string | null;
};

export type RelayResponse = { txHash: string; outcome: string };
export type DelegationBroadcastResponse = { txHash: string; status: string };

export type SignedDelegationAuthorization = {
  chainId: number;
  address: string;
  nonce: number;
  r: string;
  s: string;
  yParity: 0 | 1;
};

export type RelaySessionKeyOpInput = {
  user: string;
  op: {
    target: string;
    data: string;
    value: bigint;
    nonce: bigint;
    deadline: bigint;
    maxGasCost: bigint;
  };
  sig: string;
};

export type RelayRekeyInput = {
  user: string;
  sessionKey: string;
  policy: {
    validUntil: number;
    validAfter: number;
    spendingLimit: bigint;
    permissions: { target: string; selectors: string[] }[];
  };
  registrationNonce: bigint;
  deadline: bigint;
  sig: string;
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

  async uploadBlob(
    base64Data: string,
    opts?: { sessionId?: string; searchEnabled?: boolean }
  ): Promise<UploadBlobResponse> {
    const body: Record<string, unknown> = { data: base64Data };
    if (opts?.sessionId !== undefined) {
      body.sessionId = opts.sessionId;
    }
    if (opts?.searchEnabled === true) {
      body.searchEnabled = true;
    }
    return await this.post<UploadBlobResponse>(
      "/api/blobs",
      body,
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

  // ── Account abstraction ──────────────────────────────────────────────

  /** Classify an account's on-chain code: direct / delegated / unsupported. */
  async getAccountMode(address: string): Promise<AccountModeResponse> {
    return await this.get<AccountModeResponse>(`/api/account/${address}/mode`, { protected: true });
  }

  /** Public AA config: chain id, JobRegistry, SessionManager impl + domain. */
  async getAaConfig(): Promise<AaConfigResponse> {
    return await this.get<AaConfigResponse>("/api/aa/config");
  }

  /** Gateway-sponsored type-4 broadcast installing the 7702 delegation. */
  async activateDelegation(
    authorization: SignedDelegationAuthorization
  ): Promise<DelegationBroadcastResponse> {
    return await this.post<DelegationBroadcastResponse>(
      "/api/delegation/activate",
      { authorization },
      { protected: true }
    );
  }

  /** Gateway-sponsored type-4 broadcast removing the 7702 delegation. */
  async revokeDelegation(
    authorization: SignedDelegationAuthorization
  ): Promise<DelegationBroadcastResponse> {
    return await this.post<DelegationBroadcastResponse>(
      "/api/delegation/revoke",
      { authorization },
      { protected: true }
    );
  }

  /** Relay a session-key-signed SessionKeyOp (per-prompt gasless path). */
  async relaySessionKeyOp(
    input: RelaySessionKeyOpInput
  ): Promise<RelayResponse> {
    return await this.post<RelayResponse>(
      "/api/relay",
      {
        user: input.user,
        op: {
          target: input.op.target,
          data: input.op.data,
          value: input.op.value.toString(),
          nonce: input.op.nonce.toString(),
          deadline: input.op.deadline.toString(),
          maxGasCost: input.op.maxGasCost.toString(),
        },
        sig: input.sig,
      },
      { protected: true }
    );
  }

  /** Relay a root-key-signed RegisterSessionKey (delegate-key registration). */
  async relayRekey(input: RelayRekeyInput): Promise<RelayResponse> {
    return await this.post<RelayResponse>(
      "/api/relay/rekey",
      {
        user: input.user,
        sessionKey: input.sessionKey,
        policy: {
          validUntil: input.policy.validUntil,
          validAfter: input.policy.validAfter,
          spendingLimit: input.policy.spendingLimit.toString(),
          permissions: input.policy.permissions,
        },
        registrationNonce: input.registrationNonce.toString(),
        deadline: input.deadline.toString(),
        sig: input.sig,
      },
      { protected: true }
    );
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
