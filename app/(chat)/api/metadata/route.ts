import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 512 * 1024;

const TITLE_RE = /<title>(.*?)<\/title>/i;
const DESCRIPTION_RE = /<meta name="description" content="(.*?)"/i;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

function isBlockedIP(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) {
    const [a, b] = addr.split(".").map(Number);
    // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16,
    // 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT),
    // 224.0.0.0/4 (multicast), 240.0.0.0/4 (reserved + 255.255.255.255).
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = addr.toLowerCase();
    // ::, ::1, fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast),
    // 2002::/16 (6to4 — can embed RFC1918 v4),
    // 64:ff9b::/96 (well-known NAT64 — can embed RFC1918 v4),
    // ::ffff:* (IPv4-mapped) rejected wholesale.
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("ff") ||
      lower.startsWith("::ffff:") ||
      lower.startsWith("2002:") ||
      lower.startsWith("64:ff9b:")
    );
  }
  // Anything that isn't a valid IP literal is treated as blocked.
  return true;
}

async function safeFetch(
  rawUrl: string,
  hops: number,
  signal: AbortSignal
): Promise<Response | null> {
  if (hops >= MAX_REDIRECTS) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }

  // Resolve hostname before connecting and reject anything that points at
  // loopback / private / link-local / cloud-metadata addresses.
  // Residual: classic DNS rebinding is still possible because the kernel
  // re-resolves at connect time. The Content-Type guard below + the small
  // bandwidth of the title/description fields limit but do not eliminate
  // an attacker's ability to exfiltrate snippets of internal HTML pages.
  let resolved: { address: string };
  try {
    resolved = await lookup(parsed.hostname);
  } catch {
    return null;
  }

  if (isBlockedIP(resolved.address)) {
    return null;
  }

  let res: Response;
  try {
    res = await fetch(rawUrl, { redirect: "manual", signal });
  } catch {
    return null;
  }

  // Re-validate each hop instead of letting fetch follow blindly — a public
  // landing page can otherwise redirect into an internal address.
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) {
      return null;
    }
    const next = new URL(location, parsed).toString();
    return safeFetch(next, hops + 1, signal);
  }

  // Only parse responses that actually claim to be HTML — prevents the
  // metadata extractor from reflecting bytes of internal JSON APIs etc.
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (
    !ALLOWED_CONTENT_TYPES.some((allowed) => contentType.startsWith(allowed))
  ) {
    return null;
  }

  return res;
}

async function readCappedText(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    return "";
  }
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

const FALLBACK_PAYLOAD = {
  title: "Unknown",
  description: "Unable to fetch metadata",
};

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing URL" }, { status: 400 });
  }

  // Single timeout for the whole walk so that 3 redirects can't add up to
  // 4 × FETCH_TIMEOUT_MS of wall-clock work.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  try {
    const res = await safeFetch(url, 0, signal);
    if (!res) {
      return NextResponse.json(FALLBACK_PAYLOAD);
    }

    const html = await readCappedText(res, MAX_BODY_BYTES);

    const titleMatch = html.match(TITLE_RE);
    const descMatch = html.match(DESCRIPTION_RE);

    return NextResponse.json({
      title: titleMatch ? titleMatch[1] : "No title found",
      description: descMatch ? descMatch[1] : "No description available.",
    });
  } catch {
    return NextResponse.json(FALLBACK_PAYLOAD);
  }
}
