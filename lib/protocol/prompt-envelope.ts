/**
 * The versioned prompt payload that gets encrypted and posted as a blob.
 *
 * Prompts used to be a bare UTF-8 string, which left a deployed vision model
 * with no way to receive an image. The envelope adds images while staying
 * backward compatible: the worker treats anything that is not a versioned
 * envelope as plain text, so an old client and a new worker still interoperate.
 *
 * Images are carried inside the encrypted payload rather than uploaded
 * somewhere and referenced by URL. An image is part of the prompt, and the
 * whole point of this protocol is that prompts are only ever readable by the
 * worker the user paid.
 */

/** Matches promptEnvelope in lightchain-worker/internal/pipeline/prompt.go. */
export const PROMPT_ENVELOPE_VERSION = 1;

export type PromptEnvelope = {
  v: number;
  text: string;
  images?: string[];
};

/**
 * Longest edge, in pixels, that an attached image is scaled down to.
 *
 * The prompt blob is hard-capped at 126,972 bytes by EIP-4844 encoding and the
 * consumer pays for every byte, so a phone photo has to be reduced before it
 * can be sent. 1024 is comfortably enough for the vision models in this fleet.
 */
export const MAX_IMAGE_EDGE_PX = 1024;

/** JPEG quality used when re-encoding a downscaled image. */
const JPEG_QUALITY = 0.82;

/**
 * Ceiling on total encoded image bytes in one prompt.
 *
 * Deliberately below the 126,972-byte blob limit so that the text, the JSON
 * framing and the AES-GCM overhead all still fit. Exceeding the blob limit
 * fails the whole job rather than degrading, so this must fail early and
 * visibly instead.
 */
export const MAX_TOTAL_IMAGE_BYTES = 90_000;

export function buildPromptEnvelope(
  text: string,
  images: string[]
): PromptEnvelope | string {
  // No images means no envelope. Keeping the plain-string form for ordinary
  // prompts avoids changing the bytes that go on chain for the common case.
  if (images.length === 0) return text;
  return { v: PROMPT_ENVELOPE_VERSION, text, images };
}

export function serializePrompt(envelope: PromptEnvelope | string): string {
  return typeof envelope === "string" ? envelope : JSON.stringify(envelope);
}

/** Strips a `data:<mime>;base64,` prefix, which Ollama does not want. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function estimateBase64Bytes(base64: string): number {
  // Every 4 base64 characters encode 3 bytes, minus padding.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Scales an image down to fit MAX_IMAGE_EDGE_PX and re-encodes it as JPEG,
 * returning bare base64.
 *
 * Runs in the browser against a canvas. Callers on the server or in tests get
 * an error rather than a silent full-size passthrough, because sending a
 * full-resolution photo would blow the blob limit and fail the job.
 */
export async function downscaleImageToBase64(file: File): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("image downscaling requires a browser environment");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_IMAGE_EDGE_PX ? MAX_IMAGE_EDGE_PX / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get a 2d canvas context");
    ctx.drawImage(bitmap, 0, 0, width, height);

    return stripDataUrlPrefix(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  } finally {
    bitmap.close();
  }
}

/**
 * Rejects an attachment set that will not fit the prompt blob.
 *
 * Returns null when the set is fine, or a message to show the user. Failing
 * here is much kinder than letting the job fail on chain after they have
 * already been charged.
 */
export function checkImageBudget(images: string[]): string | null {
  const total = images.reduce((sum, img) => sum + estimateBase64Bytes(img), 0);
  if (total <= MAX_TOTAL_IMAGE_BYTES) return null;
  return `Images total ${Math.round(total / 1024)} KB, over the ${Math.round(
    MAX_TOTAL_IMAGE_BYTES / 1024
  )} KB that fits in one prompt. Remove one or use a smaller image.`;
}
