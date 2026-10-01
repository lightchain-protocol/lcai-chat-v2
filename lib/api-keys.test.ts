import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiKey } from "./api-keys";

// lib/http reaches the server-side NextAuth module, which only loads inside Next.
vi.mock("@/app/(auth)/auth", () => ({ auth: () => Promise.resolve(null) }));

const {
  createApiKey,
  deleteApiKey,
  listApiKeys,
  capStopsKey,
  revokeApiKey,
  setSpendCap,
  spendCapOf,
  toCreateKeyBody,
  usageSnippets,
} = await import("./api-keys");

/** The consumer-api, answering every request with this. */
function serverAnswers(status: number, body?: unknown) {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status })
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const KEYS_URL = /\/api\/api-keys$/;

const keyView: ApiKey = {
  id: "3f1c2a4e-0000-4000-8000-000000000001",
  prefix: "lcai_AbCdEfG",
  name: "backend-prod",
  spendCapWei: "5000000000000000000",
  spentWei: "0",
  createdAt: "2026-10-01T12:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

/**
 * A consumer-api holding one key, with the cap, revoke and delete routes: a
 * revoked key stays listed, its cap fixed, and only a revoked key may be
 * deleted.
 */
function serverWithOneKey() {
  let key: ApiKey | null = { ...keyView };
  const keyPath = `/api/api-keys/${keyView.id}`;
  const answer = (url: string, init?: RequestInit): Response => {
    const path = url.slice(url.indexOf("/api/"));
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/api/api-keys") {
      return Response.json({ keys: key ? [key] : [] });
    }
    if (!key || !path.startsWith(keyPath)) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (method === "PATCH" && path === keyPath) {
      if (key.revokedAt) {
        return Response.json({ error: "api_key_revoked" }, { status: 409 });
      }
      key.spendCapWei = JSON.parse(String(init?.body)).spendCapWei;
      return Response.json(key);
    }
    if (method === "POST" && path === `${keyPath}/revoke`) {
      key.revokedAt ??= "2026-10-01T13:00:00.000Z";
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE" && path === keyPath) {
      if (!key.revokedAt) {
        return Response.json(
          { error: "api_key_active", message: "Revoke the key first" },
          { status: 409 }
        );
      }
      key = null;
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(answer(url, init))
    )
  );
}

describe("spendCapOf", () => {
  it("reads the amount in LCAI as wei", () => {
    expect(spendCapOf({ unlimited: false, lcai: " 1.5 " })).toEqual({
      capWei: "1500000000000000000",
    });
  });

  it("gives no cap when Unlimited is chosen, whatever the amount", () => {
    expect(spendCapOf({ unlimited: true, lcai: "" })).toEqual({ capWei: null });
    expect(spendCapOf({ unlimited: true, lcai: "abc" })).toEqual({
      capWei: null,
    });
  });

  it("asks for an amount when Unlimited isn't chosen", () => {
    expect(spendCapOf({ unlimited: false, lcai: "  " })).toEqual({
      error: "Enter a spend cap in LCAI, or choose Unlimited.",
    });
  });

  it.each(["0", "0.0", "-1", "abc", "1e3", "0.0000000000000000001"])(
    "refuses a spend cap of %j",
    (lcai) => {
      expect(spendCapOf({ unlimited: false, lcai })).toEqual({
        error: "Enter a spend cap above 0 LCAI, with at most 18 decimals.",
      });
    }
  );
});

describe("capStopsKey", () => {
  it("is true for a cap at or below what the key has spent", () => {
    expect(capStopsKey("100", "250")).toBe(true);
    expect(capStopsKey("250", "250")).toBe(true);
  });

  it("is false for a cap above the spend, or none", () => {
    expect(capStopsKey("251", "250")).toBe(false);
    expect(capStopsKey(null, "250")).toBe(false);
  });
});

describe("toCreateKeyBody", () => {
  it("sends the name and the cap in wei", () => {
    expect(
      toCreateKeyBody({
        name: "  backend-prod ",
        spendCapLcai: "0.5",
        unlimited: false,
      })
    ).toEqual({
      body: { name: "backend-prod", spendCapWei: "500000000000000000" },
    });
  });

  it("sends no cap for an Unlimited key", () => {
    expect(
      toCreateKeyBody({ name: "ci", spendCapLcai: "", unlimited: true })
    ).toEqual({ body: { name: "ci" } });
  });

  it("refuses a capped key with no amount", () => {
    expect(
      toCreateKeyBody({ name: "ci", spendCapLcai: "", unlimited: false })
    ).toEqual({ error: "Enter a spend cap in LCAI, or choose Unlimited." });
  });

  it.each(["", "   "])("refuses a key named %j", (name) => {
    expect(
      toCreateKeyBody({ name, spendCapLcai: "1", unlimited: false })
    ).toEqual({ error: "Give the key a name." });
  });
});

describe("createApiKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the request and answers the key the server minted", async () => {
    const fetch = serverAnswers(201, { ...keyView, key: "lcai_secret" });

    const result = await createApiKey({
      name: "backend-prod",
      spendCapWei: "5000000000000000000",
    });

    expect(result).toEqual({ created: { ...keyView, key: "lcai_secret" } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(KEYS_URL);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "backend-prod",
      spendCapWei: "5000000000000000000",
    });
  });

  it("says so when the wallet holds as many keys as it may", async () => {
    serverAnswers(409, {
      error: "api_key_limit",
      message: "A wallet may hold at most 25 active keys; revoke one first",
    });

    expect(await createApiKey({ name: "ci" })).toEqual({
      error: "A wallet may hold at most 25 active keys; revoke one first",
    });
  });

  it("asks for a new sign-in when the token is refused", async () => {
    serverAnswers(401, {
      error: "unauthorized",
      message: "Invalid or missing token",
    });

    expect(await createApiKey({ name: "ci" })).toEqual({
      error: "Your sign-in has expired. Sign out and sign in again.",
    });
  });
});

describe("listApiKeys", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("answers the wallet's keys", async () => {
    serverAnswers(200, { keys: [keyView] });

    expect(await listApiKeys()).toEqual([keyView]);
  });

  it("throws why the server refused the listing", async () => {
    serverAnswers(401, { error: "unauthorized" });

    await expect(listApiKeys()).rejects.toThrow(
      "Your sign-in has expired. Sign out and sign in again."
    );
  });

  it("says so when the API can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );

    await expect(listApiKeys()).rejects.toThrow(
      "Couldn't reach the API. Check your connection and try again."
    );
  });
});

describe("revoking and deleting a key", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a revoked key listed as revoked", async () => {
    serverWithOneKey();

    expect(await revokeApiKey(keyView.id)).toEqual({});
    expect(await listApiKeys()).toEqual([
      { ...keyView, revokedAt: "2026-10-01T13:00:00.000Z" },
    ]);
  });

  it("removes a revoked key once it is deleted", async () => {
    serverWithOneKey();

    await revokeApiKey(keyView.id);
    expect(await deleteApiKey(keyView.id)).toEqual({});
    expect(await listApiKeys()).toEqual([]);
  });

  it("refuses to delete a key that is still active", async () => {
    serverWithOneKey();

    expect(await deleteApiKey(keyView.id)).toEqual({
      error: "Revoke the key before deleting it.",
    });
    expect(await listApiKeys()).toEqual([keyView]);
  });

  it("says so when the wallet has no such key", async () => {
    serverAnswers(404, { error: "not_found" });

    expect(await revokeApiKey(keyView.id)).toEqual({
      error: "This wallet has no such key.",
    });
    expect(await deleteApiKey(keyView.id)).toEqual({
      error: "This wallet has no such key.",
    });
  });

  it("says so when the API can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );

    expect(await revokeApiKey(keyView.id)).toEqual({
      error: "Couldn't reach the API. Check your connection and try again.",
    });
  });
});

describe("setSpendCap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists the key with the new cap once it is set", async () => {
    serverWithOneKey();

    const result = await setSpendCap(keyView.id, "2000000000000000000");

    const updated = { ...keyView, spendCapWei: "2000000000000000000" };
    expect(result).toEqual({ updated });
    expect(await listApiKeys()).toEqual([updated]);
  });

  it("lifts the cap with null", async () => {
    serverWithOneKey();

    expect(await setSpendCap(keyView.id, null)).toEqual({
      updated: { ...keyView, spendCapWei: null },
    });
  });

  it("refuses to change a revoked key's cap", async () => {
    serverWithOneKey();
    await revokeApiKey(keyView.id);

    expect(await setSpendCap(keyView.id, "1")).toEqual({
      error: "A revoked key's spend cap can't be changed.",
    });
  });
});

describe("usageSnippets", () => {
  it("points the OpenAI SDK at the API's /v1", () => {
    const { openai } = usageSnippets(
      "https://chat-api.testnet.lightchain.ai",
      "testnet"
    );

    expect(openai).toContain(
      'baseURL: "https://chat-api.testnet.lightchain.ai/v1",'
    );
    expect(openai).toContain("apiKey: process.env.LIGHTCHAIN_API_KEY,");
  });

  it("names the network for the Lightchain SDK", () => {
    const { lightchain } = usageSnippets("https://api.example", "mainnet");

    expect(lightchain).toContain('network: "mainnet",');
  });
});
