import { parseEther } from "viem";
import { $http } from "@/lib/http";

/** A key as `GET /api/api-keys` lists it: never the key itself. */
export type ApiKey = {
  id: string;
  /** `lcai_` and seven characters, to tell keys apart. */
  prefix: string;
  name: string | null;
  /** Lifetime cap in wei; null is uncapped. */
  spendCapWei: string | null;
  spentWei: string;
  createdAt: string;
  revokedAt: string | null;
};

/** What the create form holds, as typed. */
export type CreateKeyForm = {
  name: string;
  spendCapLcai: string;
  /** Chosen explicitly: an empty amount is not "no cap". */
  unlimited: boolean;
};

/** `POST /api/api-keys`. Wei is a decimal string: it outgrows a number. */
export type CreateKeyBody = {
  name: string;
  spendCapWei?: string;
};

/** The cap chosen, in wei; null for Unlimited. */
export function spendCapOf(choice: {
  unlimited: boolean;
  lcai: string;
}): { capWei: string | null } | { error: string } {
  if (choice.unlimited) {
    return { capWei: null };
  }
  const cap = choice.lcai.trim();
  if (!cap) {
    return { error: "Enter a spend cap in LCAI, or choose Unlimited." };
  }
  // parseEther rounds past 18 decimals; refuse instead of rounding a cap.
  const capWei = LCAI_AMOUNT.test(cap) ? parseEther(cap) : 0n;
  if (capWei <= 0n) {
    return {
      error: "Enter a spend cap above 0 LCAI, with at most 18 decimals.",
    };
  }
  return { capWei: capWei.toString() };
}

const LCAI_AMOUNT = /^\d*\.?\d{0,18}$/;

/**
 * Whether a cap leaves the key nothing to spend: every fee is above zero, so
 * a cap at or below what it has spent stops it at once.
 */
export function capStopsKey(capWei: string | null, spentWei: string): boolean {
  return capWei !== null && BigInt(capWei) <= BigInt(spentWei);
}

/** The create request for what the form holds, or why it can't be sent. */
export function toCreateKeyBody(
  form: CreateKeyForm
): { body: CreateKeyBody } | { error: string } {
  const name = form.name.trim();
  if (!name) {
    return { error: "Give the key a name." };
  }
  const cap = spendCapOf({
    unlimited: form.unlimited,
    lcai: form.spendCapLcai,
  });
  if ("error" in cap) {
    return cap;
  }
  return {
    body: cap.capWei === null ? { name } : { name, spendCapWei: cap.capWei },
  };
}

const KEYS = "/api/api-keys";
const keyPath = (id: string) => `${KEYS}/${id}`;

const NO_SUCH_KEY = "This wallet has no such key.";
const UNREACHABLE =
  "Couldn't reach the API. Check your connection and try again.";

/** Every key of the wallet, revoked ones included, newest first. */
export async function listApiKeys(): Promise<ApiKey[]> {
  const res = await $http.get(KEYS).catch(() => {
    throw new Error(UNREACHABLE);
  });
  if (!res.ok) {
    throw new Error(await refusal(res));
  }
  return ((await res.json()) as { keys: ApiKey[] }).keys;
}

/** Mints a key. The answer is the only one that ever carries `key`. */
export async function createApiKey(
  body: CreateKeyBody
): Promise<{ created: ApiKey & { key: string } } | { error: string }> {
  try {
    const res = await $http.post(KEYS, body);
    if (!res.ok) {
      return { error: await refusal(res) };
    }
    return { created: await res.json() };
  } catch {
    return { error: UNREACHABLE };
  }
}

/** Sets an active key's lifetime cap, in wei; null lifts it. */
export async function setSpendCap(
  id: string,
  spendCapWei: string | null
): Promise<{ updated: ApiKey } | { error: string }> {
  try {
    const res = await $http.patch(keyPath(id), { spendCapWei });
    if (!res.ok) {
      return {
        error: await refusal(res, {
          404: NO_SUCH_KEY,
          409: "A revoked key's spend cap can't be changed.",
        }),
      };
    }
    return { updated: await res.json() };
  } catch {
    return { error: UNREACHABLE };
  }
}

/** Revokes a key at once. It stays listed, marked revoked. */
export function revokeApiKey(id: string): Promise<{ error?: string }> {
  return keyAction("POST", `${keyPath(id)}/revoke`, { 404: NO_SUCH_KEY });
}

/** Deletes a revoked key for good. The server refuses an active one. */
export function deleteApiKey(id: string): Promise<{ error?: string }> {
  return keyAction("DELETE", keyPath(id), {
    404: NO_SUCH_KEY,
    409: "Revoke the key before deleting it.",
  });
}

/** A bodyless call on one key: revoke or delete. */
async function keyAction(
  method: string,
  path: string,
  messages: StatusMessages
): Promise<{ error?: string }> {
  try {
    const res = await $http.request(path, { method });
    return res.ok ? {} : { error: await refusal(res, messages) };
  } catch {
    return { error: UNREACHABLE };
  }
}

/** What to say for a status, where the server's own message won't do. */
type StatusMessages = Partial<Record<number, string>>;

/** What to tell the user about a refused request. */
async function refusal(
  res: Response,
  messages: StatusMessages = {}
): Promise<string> {
  if (res.status === 401) {
    return "Your sign-in has expired. Sign out and sign in again.";
  }
  const message = messages[res.status];
  if (message) {
    return message;
  }
  const body = (await res.json().catch(() => null)) as {
    message?: string;
  } | null;
  return body?.message ?? `The API answered ${res.status}. Try again.`;
}

/**
 * How to call the API with a key: through the OpenAI SDK directly, and
 * through `@lightchain/sdk`, which supplies the network's URL.
 */
export function usageSnippets(
  apiBaseUrl: string,
  network: "mainnet" | "testnet"
): { openai: string; lightchain: string } {
  // ponytail: a fixed example model, as in the docs; put a served one from
  // /v1/models here if people paste the snippet as it is.
  const call = `const completion = await openai.chat.completions.create({
  model: "gemma4:e2b", // GET /v1/models lists the models served now
  messages: [{ role: "user", content: "Say hello in five words." }],
});
console.log(completion.choices[0].message.content);`;

  return {
    openai: `import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${apiBaseUrl}/v1",
  apiKey: process.env.LIGHTCHAIN_API_KEY, // lcai_...
});

${call}`,
    lightchain: `import OpenAI from "openai";
import { Lightchain } from "@lightchain/sdk";

const lc = new Lightchain({
  network: "${network}",
  apiKey: process.env.LIGHTCHAIN_API_KEY, // lcai_...
});

const openai = new OpenAI({ baseURL: lc.baseURL, apiKey: lc.apiKey, fetch: lc.fetch });

${call}`,
  };
}
