import { describe, it, expect, vi } from "vitest";
import { PaddleOcrProvider } from "./ocr-provider";

function fakeFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("PaddleOcrProvider", () => {
  const png = Buffer.from("fake-png-bytes");

  it("posts multipart form-data to the sidecar /ocr endpoint", async () => {
    const fetchMock = fakeFetch({ text: "hello", lines: [{ text: "hello", confidence: 0.98 }] });
    const provider = new PaddleOcrProvider("http://localhost:8100", fetchMock as unknown as typeof fetch);
    const result = await provider.extract(png, "invoice.pdf");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8100/ocr");
    expect(init.body).toBeInstanceOf(FormData);
    expect(result.text).toContain("hello");
  });

  it("throws a descriptive error on sidecar failure", async () => {
    const fetchMock = fakeFetch({ detail: "model not loaded" }, 503);
    const provider = new PaddleOcrProvider("http://localhost:8100", fetchMock as unknown as typeof fetch);
    await expect(provider.extract(png, "invoice.pdf")).rejects.toThrow(/OCR service.*503/);
  });

  it("rejects empty files before calling the service", async () => {
    const fetchMock = vi.fn();
    const provider = new PaddleOcrProvider("http://x", fetchMock as unknown as typeof fetch);
    await expect(provider.extract(Buffer.alloc(0), "empty.pdf")).rejects.toThrow(/empty/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces a max file size of 10 MB", async () => {
    const fetchMock = vi.fn();
    const provider = new PaddleOcrProvider("http://x", fetchMock as unknown as typeof fetch);
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(provider.extract(big, "big.pdf")).rejects.toThrow(/10 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PaddleOcrProvider response validation", () => {
  const png = Buffer.from("bytes");

  it("throws on malformed sidecar JSON (missing text field)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ foo: 1 }), { status: 200 }));
    const provider = new PaddleOcrProvider("http://x", fetchMock as unknown as typeof fetch);
    await expect(provider.extract(png, "a.pdf")).rejects.toThrow(/malformed/i);
  });

  it("still binds correctly when the method is called detached", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "ok", lines: [] }), { status: 200 }),
    );
    const provider = new PaddleOcrProvider("http://x", fetchMock as unknown as typeof fetch);
    const detached = provider.extract;
    const result = await detached(png, "a.pdf");
    expect(result.text).toBe("ok");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/ocr");
  });
});
