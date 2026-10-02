import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/http reaches the server-side NextAuth module, which only loads inside Next.
vi.mock("@/app/(auth)/auth", () => ({ auth: () => Promise.resolve(null) }));

const { clearAuthToken, setAuthToken } = await import("@/lib/http");
const { apiBalanceQueryOptions, prepaidStatus } = await import(
  "./use-prepaid-balance"
);

const WALLET = "0x00000000000000000000000000000000000000aa";
const DELEGATE = "0x00000000000000000000000000000000000000de";

/** The consumer-api: GET /api/balance answers with `answer()`. */
function balanceApi(answer: () => Promise<Response>) {
  const fetch = vi.fn((_url: string, _init?: RequestInit) => answer());
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const answered = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/** An API that has not answered yet. */
const unanswered = () => new Promise<Response>(() => null);

/**
 * What the hook reports for a wallet with this sign-in token, as the
 * balance query runs in react-query (the hook's useQuery, minus React).
 */
function hookState(
  client: QueryClient,
  initialToken?: string,
  { hasContract = true, sessionLoading = false, connected = true } = {}
) {
  let token = initialToken;
  const address = connected ? WALLET : undefined;
  const observer = new QueryObserver(
    client,
    apiBalanceQueryOptions(address, token)
  );
  const unsubscribe = observer.subscribe(() => null);
  return {
    status: () =>
      prepaidStatus({
        hasContract,
        address,
        token,
        sessionLoading,
        api: observer.getCurrentResult(),
      }),
    setToken: (next?: string) => {
      token = next;
      observer.setOptions(apiBalanceQueryOptions(address, next));
    },
    settled: () =>
      vi.waitFor(() => {
        if (observer.getCurrentResult().isFetching) {
          throw new Error("still fetching");
        }
      }),
    unsubscribe,
  };
}

describe("usePrepaidBalance status", () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CONSUMER_API_URL", "http://consumer-api.test");
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    client.clear();
    clearAuthToken();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is loading, not unavailable, while /api/balance has not answered", () => {
    setAuthToken("signed-in-token");
    balanceApi(unanswered);
    const hook = hookState(client, "signed-in-token");

    expect(hook.status()).toBe("loading");
    hook.unsubscribe();
  });

  it("is signed-out, without asking the API, before the wallet signs in", async () => {
    const fetch = balanceApi(answered(200, { delegate: DELEGATE }));
    const hook = hookState(client, undefined);
    await hook.settled();

    expect(hook.status()).toBe("signed-out");
    expect(fetch).not.toHaveBeenCalled();
    hook.unsubscribe();
  });

  it("is loading, not signed-out, while the session is still being read", () => {
    const fetch = balanceApi(answered(200, { delegate: DELEGATE }));
    const hook = hookState(client, undefined, { sessionLoading: true });

    expect(hook.status()).toBe("loading");
    expect(fetch).not.toHaveBeenCalled();
    hook.unsubscribe();
  });

  it("is signed-out, not stuck loading, with a session but no wallet connected", () => {
    setAuthToken("signed-in-token");
    balanceApi(unanswered);
    const hook = hookState(client, "signed-in-token", { connected: false });

    expect(hook.status()).toBe("signed-out");
    hook.unsubscribe();
  });

  it("fetches the balance once the wallet signs in, without a reload", async () => {
    const fetch = balanceApi(answered(200, { delegate: DELEGATE }));
    const hook = hookState(client, undefined);
    await hook.settled();

    setAuthToken("fresh-token");
    hook.setToken("fresh-token");
    await hook.settled();

    expect(hook.status()).toBe("available");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer fresh-token",
    });
    hook.unsubscribe();
  });

  it("fetches again when a refused token is replaced by a new sign-in", async () => {
    let httpStatus = 401;
    balanceApi(() => answered(httpStatus, { delegate: DELEGATE })());
    setAuthToken("expired-token");
    const hook = hookState(client, "expired-token");
    await hook.settled();
    expect(hook.status()).toBe("error");

    httpStatus = 200;
    setAuthToken("renewed-token");
    hook.setToken("renewed-token");
    await hook.settled();

    expect(hook.status()).toBe("available");
    hook.unsubscribe();
  });

  it("keeps the balance on screen while a renewed token refetches it", async () => {
    let answer = answered(200, { delegate: DELEGATE });
    balanceApi(() => answer());
    setAuthToken("first-token");
    const hook = hookState(client, "first-token");
    await hook.settled();

    answer = unanswered;
    setAuthToken("renewed-token");
    hook.setToken("renewed-token");

    expect(hook.status()).toBe("available");
    hook.unsubscribe();
  });

  it("drops the last answer when the wallet signs out", async () => {
    balanceApi(answered(200, { delegate: DELEGATE }));
    setAuthToken("signed-in-token");
    const hook = hookState(client, "signed-in-token");
    await hook.settled();

    clearAuthToken();
    hook.setToken();

    expect(hook.status()).toBe("signed-out");
    hook.unsubscribe();
  });

  it("is unavailable when the API says the network has no prepaid balance", async () => {
    balanceApi(answered(503, { error: "feature_disabled" }));
    setAuthToken("signed-in-token");
    const hook = hookState(client, "signed-in-token");
    await hook.settled();

    expect(hook.status()).toBe("unavailable");
    hook.unsubscribe();
  });

  it("is an error, not unavailable, when a proxy answers 503 for a down API", async () => {
    balanceApi(() =>
      Promise.resolve(new Response("<html>Bad gateway</html>", { status: 503 }))
    );
    setAuthToken("signed-in-token");
    const hook = hookState(client, "signed-in-token");
    await hook.settled();

    expect(hook.status()).toBe("error");
    hook.unsubscribe();
  });

  it("is unavailable when this build has no JobRegistry for the chain", () => {
    balanceApi(unanswered);
    const hook = hookState(client, undefined, { hasContract: false });

    expect(hook.status()).toBe("unavailable");
    hook.unsubscribe();
  });
});
