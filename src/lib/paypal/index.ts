// Entry point: returns the right PayPalClient for the current PAYPAL_MODE.
import type { PayPalClient } from "../types";
import { getPayPalEnv } from "../env";
import { MockPayPalClient } from "./mock";
import { RealPayPalClient } from "./real";
import type { AppDb } from "../db/client";

/** Returns the configured PayPal client (real or mock) based on PAYPAL_MODE. */
export function getPayPal(source?: Record<string, string | undefined>, database?: AppDb): PayPalClient {
  const env = getPayPalEnv(source);
  if (env.mode === "mock") {
    return new MockPayPalClient(database);
  }
  return new RealPayPalClient(env);
}

