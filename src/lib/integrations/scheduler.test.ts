import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDispatchScheduler } from "./scheduler";

describe("startDispatchScheduler", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
  });

  it("runs on every interval", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startDispatchScheduler({ intervalMs: 1000, run });
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it("skips ticks while the previous run is still going", async () => {
    let release!: () => void;
    const run = vi.fn(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const stop = startDispatchScheduler({ intervalMs: 1000, run });
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("swallows errors, logs name and message only, and keeps ticking", async () => {
    const err = new Error("boom");
    (err as Error & { secret: string }).secret = "payload-data";
    const run = vi.fn().mockRejectedValue(err);
    const stop = startDispatchScheduler({ intervalMs: 1000, run });
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(errorSpy.mock.calls[0]);
    expect(logged).toContain("Error");
    expect(logged).toContain("boom");
    expect(logged).not.toContain("payload-data");
    stop();
  });

  it("stop() clears the timer", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startDispatchScheduler({ intervalMs: 1000, run });
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
