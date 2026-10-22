export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiClient {
  get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown>;
}

const MAX_MESSAGE = 300;

export function createApiClient(
  config: { baseUrl: string; token: string; timeoutMs: number },
  fetchImpl: typeof fetch = fetch,
): ApiClient {
  return {
    async get(path, query = {}) {
      const url = new URL(`${config.baseUrl}/api/v1${path}`);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new ApiError(
          0,
          timedOut ? "TIMEOUT" : "NETWORK",
          timedOut ? `No answer within ${config.timeoutMs} ms` : "Could not reach the HexProcure server",
        );
      }
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        const err = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
        throw new ApiError(
          res.status,
          typeof err?.code === "string" ? err.code : "UNKNOWN",
          typeof err?.message === "string" ? err.message.slice(0, MAX_MESSAGE) : res.statusText,
        );
      }
      if (body === undefined) throw new ApiError(res.status, "BAD_RESPONSE", "Response was not valid JSON");
      return body;
    },
  };
}

export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Unexpected error while calling HexProcure";
  if (error.status === 401 || error.status === 403) {
    return `Not authorised (HTTP ${error.status}, ${error.code}): ${error.message}. Check HEXPROCURE_TOKEN and the token user's role.`;
  }
  if (error.status === 404) return `Not found (HTTP 404, ${error.code}): ${error.message}`;
  if (error.status === 429) return `Rate limited (HTTP 429, ${error.code}): ${error.message}. Retry later.`;
  if (error.status === 0) return `Request failed (${error.code}): ${error.message}`;
  return `HexProcure API error (HTTP ${error.status}, ${error.code}): ${error.message}`;
}
