/**
 * Custom ChatTransport for the LightChain protocol.
 *
 * Replaces DefaultChatTransport when NEXT_PUBLIC_USE_PROTOCOL=true.
 * Instead of hitting /api/chat, it:
 *   1. Initializes an on-chain session (if not already done)
 *   2. Encrypts the user's prompt with the session key
 *   3. Submits the encrypted blob via gateway + on-chain job via wallet
 *   4. Receives encrypted response chunks via relay WebSocket
 *   5. Decrypts and emits as a data stream for useChat consumption
 *
 * NOTE: Requires relay server to accept JWT via query parameter (?token=).
 * A small relay modification is needed since the browser WebSocket API
 * doesn't support custom headers.
 */

import type { WSErrorFrame, WSFrame } from "./relay-client";
import { RelayClient } from "./relay-client";
import type { SessionManagerConfig } from "./session";
import { SessionManager } from "./session";

/**
 * ProtocolTransport wraps session management, encryption, and relay delivery
 * into a ChatTransport-compatible interface for AI SDK's useChat hook.
 *
 * The transport returns a synthetic Response whose body is a ReadableStream
 * encoding decrypted relay frames in AI SDK data stream protocol format.
 */
export class ProtocolTransport {
  private readonly sessionMgr: SessionManager;
  private relayClient: RelayClient | null = null;

  constructor(config: SessionManagerConfig) {
    this.sessionMgr = new SessionManager(config);
  }

  setOnSessionStatus(cb: (status: string) => void) {
    this.sessionMgr.setOnStatusChange(cb);
  }

  get sessionStatus() {
    return this.sessionMgr.status;
  }

  /**
   * Implements the ChatTransport.sendMessages interface.
   *
   * Extracts the last user message text, submits the job (encrypt + blob +
   * on-chain TX via wallet), and returns a Response with a streaming body
   * fed by relay WebSocket frames.
   */
  async sendMessages(options: {
    messages: Array<{
      role: string;
      parts?: Array<{ type: string; text?: string }>;
    }>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<{ response: Response }> {
    // Initialize session on first message
    await this.sessionMgr.initialize();

    // Ensure relay is connected
    this.ensureRelayConnected();

    // Extract plaintext from the last user message
    const lastMessage = options.messages.at(-1);
    if (!lastMessage) {
      throw new Error("No messages provided");
    }
    const plaintext = extractTextFromMessage(lastMessage);
    if (!plaintext) {
      throw new Error("No text content in last message");
    }

    // Submit job: encrypt → blob upload → on-chain TX via user's wallet
    const { jobId } = await this.sessionMgr.submitJob(plaintext);

    // Create a streaming response from relay WebSocket frames
    const stream = this.createResponseStream(jobId, options.signal);

    return {
      response: new Response(stream, {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      }),
    };
  }

  /**
   * Disconnects relay and resets session.
   */
  destroy() {
    this.relayClient?.disconnect();
    this.relayClient = null;
    this.sessionMgr.reset();
  }

  private ensureRelayConnected() {
    const relayUrl = this.sessionMgr.getRelayUrl();
    const relayToken = this.sessionMgr.relayToken;
    if (!relayUrl || !relayToken) {
      throw new Error("Relay URL or token not available");
    }

    if (this.relayClient) {
      const status = this.relayClient.getStatus();
      if (status === "connected" || status === "connecting") {
        return;
      }
      // WebSocket is dead — reconnect.
      this.relayClient.disconnect();
      this.relayClient = null;
    }

    this.relayClient = new RelayClient(relayUrl, relayToken);
    this.relayClient.connect();
  }

  /**
   * Creates a ReadableStream that emits AI SDK event stream data as
   * Server-Sent Events (SSE) — the format expected by the AI SDK's
   * parseJsonEventStream / EventSourceParserStream pipeline.
   */
  private createResponseStream(
    jobId: number,
    signal?: AbortSignal
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const sessionMgr = this.sessionMgr;
    const relayClient = this.relayClient;
    const partId = `text-${jobId}`;
    let started = false;

    const sse = (obj: Record<string, unknown>): Uint8Array =>
      encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        if (!relayClient) {
          controller.error(new Error("Relay client not connected"));
          return;
        }

        const unsubscribe = relayClient.onJob(
          jobId,
          async (frame: WSFrame | WSErrorFrame) => {
            try {
              if (frame.type === "error") {
                const errorFrame = frame as WSErrorFrame;
                controller.enqueue(
                  sse({ type: "error", errorText: errorFrame.message })
                );
                controller.close();
                unsubscribe();
                return;
              }

              const wsFrame = frame as WSFrame;

              if (wsFrame.payload && !started) {
                started = true;
                controller.enqueue(sse({ type: "text-start", id: partId }));
              }

              if (wsFrame.payload) {
                const decrypted = await sessionMgr.decryptResponse(
                  wsFrame.payload
                );
                controller.enqueue(
                  sse({ type: "text-delta", id: partId, delta: decrypted })
                );
              }

              if (wsFrame.type === "complete") {
                if (started) {
                  controller.enqueue(sse({ type: "text-end", id: partId }));
                }
                controller.close();
                unsubscribe();
              }
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "decryption failed";
              controller.enqueue(sse({ type: "error", errorText: msg }));
              controller.close();
              unsubscribe();
            }
          }
        );

        signal?.addEventListener("abort", () => {
          unsubscribe();
          controller.close();
        });
      },
    });
  }
}

function extractTextFromMessage(message: {
  role: string;
  parts?: Array<{ type: string; text?: string }>;
}): string | null {
  if (!message.parts) return null;
  const textParts = message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text);
  return textParts.join("\n") || null;
}
