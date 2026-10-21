export interface DispatchSchedulerOptions {
  intervalMs: number;
  run: () => Promise<void>;
}

export function startDispatchScheduler({ intervalMs, run }: DispatchSchedulerOptions): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`[dispatch-scheduler] tick failed: ${e.name}: ${e.message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
