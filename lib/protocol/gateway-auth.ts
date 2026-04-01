const TOKEN_KEY = "lc-auth-token";

export type SignMessageFn = (message: string) => Promise<`0x${string}`>;

type AuthChallengeResponse = {
  message: string;
  expiresAt: string;
};

type AuthVerifyResponse = {
  token: string;
  wallet: string;
  expiresAt: string;
};

/**
 * Handles authentication for the LightChain Gateway API.
 *
 * Single auth flow: EIP-191 challenge-response via the dispatcher (proxied
 * through the gateway). The resulting ES256K JWT is used for all requests —
 * both gateway-owned endpoints and dispatcher proxy endpoints.
 */
export class GatewayAuth {
  private readonly baseUrl: string;
  private readonly signMessage: SignMessageFn;
  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0;

  constructor(baseUrl: string, signMessage: SignMessageFn) {
    this.baseUrl = baseUrl;
    this.signMessage = signMessage;
    this.restoreToken();
  }

  /**
   * Returns a valid Bearer token, authenticating if needed.
   * Triggers one wallet popup on first call or after token expiry.
   */
  async getToken(): Promise<string> {
    const now = Date.now();
    // 60s buffer to avoid using a token that's about to expire.
    if (this.cachedToken && now < this.cachedTokenExpiresAt - 60_000) {
      return this.cachedToken;
    }

    const challenge = await this.getJSON<AuthChallengeResponse>(
      "/api/dispatcher/auth/challenge"
    );
    if (!challenge.message) {
      throw new Error("Auth challenge missing message");
    }

    const signature = await this.signMessage(challenge.message);
    const verified = await this.postJSON<AuthVerifyResponse>(
      "/api/dispatcher/auth/verify",
      {
        message: challenge.message,
        signature,
      }
    );
    if (!verified.token) {
      throw new Error("Auth verification did not return a token");
    }

    this.cachedToken = verified.token;
    this.cachedTokenExpiresAt = Date.parse(verified.expiresAt);
    this.persistToken(verified.token, verified.expiresAt);
    return verified.token;
  }

  /**
   * Builds auth headers for any gateway request. Single Bearer token for everything.
   */
  async buildProtectedHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Alias for buildProtectedHeaders — no distinction needed after auth unification.
   */
  async buildBearerOnlyHeaders(): Promise<Record<string, string>> {
    return await this.buildProtectedHeaders();
  }

  /**
   * Clears the cached token. Called on 401 to force re-authentication.
   */
  clearToken() {
    this.cachedToken = null;
    this.cachedTokenExpiresAt = 0;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* SSR */
    }
  }

  reset() {
    this.clearToken();
  }

  private persistToken(token: string, expiresAt: string) {
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt }));
    } catch {
      /* SSR */
    }
  }

  private restoreToken() {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return;
      const { token, expiresAt } = JSON.parse(raw);
      if (token && expiresAt && Date.now() < Date.parse(expiresAt) - 60_000) {
        this.cachedToken = token;
        this.cachedTokenExpiresAt = Date.parse(expiresAt);
      } else {
        sessionStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      /* SSR or corrupt */
    }
  }

  private async getJSON<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    return this.handleResponse<T>(res);
  }

  private async postJSON<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Gateway auth error: ${res.status} ${res.statusText} ${text}`
      );
    }
    return res.json() as Promise<T>;
  }
}
