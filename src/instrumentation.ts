import { getAuthSecret } from "@/lib/auth-secret";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  getAuthSecret();

  const intervalMs = Number(process.env.INTEGRATION_DISPATCH_INTERVAL_MS);
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) return;

  const { startDispatchScheduler } = await import("@/lib/integrations/scheduler");
  const { dispatchPendingEvents } = await import("@/lib/integrations/dispatch");
  const { registerConfiguredConnectors } = await import("@/lib/integrations/registry");
  startDispatchScheduler({
    intervalMs,
    run: async () => {
      registerConfiguredConnectors();
      const { delivered, failed, skipped } = await dispatchPendingEvents(100);
      if (delivered + failed + skipped > 0) {
        console.log(`[dispatch-scheduler] delivered=${delivered} failed=${failed} skipped=${skipped}`);
      }
    },
  });
}
