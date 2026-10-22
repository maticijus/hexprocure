export interface Config {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

const MAX_TIMEOUT_MS = 60_000;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const url = env.HEXPROCURE_URL?.trim();
  const token = env.HEXPROCURE_TOKEN?.trim();
  const missing = [!url && "HEXPROCURE_URL", !token && "HEXPROCURE_TOKEN"].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Set HEXPROCURE_URL to the app base URL and HEXPROCURE_TOKEN to an API token (hxp_...).",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url!);
  } catch {
    throw new Error("HEXPROCURE_URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("HEXPROCURE_URL must start with http:// or https://");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("HEXPROCURE_URL must not contain a query string or fragment");
  }
  const rawTimeout = env.HEXPROCURE_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`HEXPROCURE_TIMEOUT_MS must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }
  return { baseUrl: parsed.origin + parsed.pathname.replace(/\/+$/, ""), token: token!, timeoutMs };
}
