import { getAuthSecret } from "@/lib/auth-secret";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") getAuthSecret();
}
