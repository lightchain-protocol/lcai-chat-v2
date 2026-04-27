import { clearAuthToken, getAuthToken } from "@/lib/http";

import type { AuthProvider } from "./gateway-client";

/**
 * Gateway AuthProvider backed by the consumer-api ES256K JWT stored in the
 * NextAuth session / localStorage after SIWE sign-in.
 *
 * There is no wallet challenge — the bearer token comes from the same session
 * that authenticates all other consumer-api calls (`lib/http.ts`). This
 * removes the second MetaMask popup from the protocol onboarding flow.
 */
export class GatewayAuth implements AuthProvider {
  async buildProtectedHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error("Not authenticated — sign in before using the gateway");
    }
    return { Authorization: `Bearer ${token}` };
  }

  buildBearerOnlyHeaders(): Promise<Record<string, string>> {
    return this.buildProtectedHeaders();
  }

  /**
   * Clears the cached bearer token. Called by GatewayClient on 401 responses.
   * The user will need to sign in again (SIWE) to mint a new token.
   */
  clearToken(): void {
    clearAuthToken();
  }
}
