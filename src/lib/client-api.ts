export type ApiResult<T> = { ok: true; body: T } | { ok: false; message: string };

/** Browser-side POST helper: JSON in, typed result out, API error message surfaced. */
export async function postJson<T = Record<string, never>>(path: string, payload?: unknown): Promise<ApiResult<T>> {
  return sendJson<T>("POST", path, payload);
}

export async function sendJson<T = Record<string, never>>(
  method: "POST" | "PATCH",
  path: string,
  payload?: unknown,
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, message: body?.error?.message ?? `Request failed (${res.status})` };
  return { ok: true, body: (body ?? {}) as T };
}
