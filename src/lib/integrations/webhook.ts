import type { Connector } from "./types";

export interface WebhookConfig {
  url: string;
  secret?: string;
  handles: Connector["handles"];
}

/** Generic webhook connector: POSTs the raw event JSON to any HTTP endpoint.
 *  Signs requests with HMAC-SHA256 when a secret is configured
 *  (`X-HexProcure-Signature` header) so receivers can verify authenticity. */
export function createWebhookConnector(
  config: WebhookConfig,
  fetchImpl: typeof fetch = fetch,
): Connector {
  return {
    name: `webhook:${config.url}`,
    handles: config.handles,
    async deliver(event) {
      const body = JSON.stringify(event);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-hexprocure-event": event.type,
      };
      if (config.secret) {
        headers["x-hexprocure-signature"] = await sign(body, config.secret);
      }
      try {
        const res = await fetchImpl(config.url, { method: "POST", headers, body });
        if (!res.ok) {
          const retryable = res.status >= 500 || res.status === 429;
          return { ok: false, error: `HTTP ${res.status}`, retryable };
        }
        return { ok: true, response: { status: res.status } };
      } catch (error) {
        return { ok: false, error: String(error), retryable: true };
      }
    },
  };
}

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
