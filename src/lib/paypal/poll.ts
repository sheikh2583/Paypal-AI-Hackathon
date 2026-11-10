import { getAppEnv } from "../env";
import { reconcilePayPalInvoices } from "./reconcile";
import { retryPendingPayPalWebhooks } from "./webhook";

const READ_INTERVAL_MS = 5_000;
const POLL_INTERVAL_MS = 10_000;
const WEBHOOK_RETRY_INTERVAL_MS = 60_000;
type PollState = { lastRunAt: number; lastRetryAt: number; inFlight?: Promise<void>; timer?: ReturnType<typeof setInterval> };
const processScope = globalThis as typeof globalThis & { chaserPayPalPoll?: PollState };
const state = processScope.chaserPayPalPoll ??= { lastRunAt: -Infinity, lastRetryAt: -Infinity };

function reconcileIfDue(): Promise<void> {
  if (state.inFlight) return state.inFlight;
  if (Date.now() - state.lastRunAt < READ_INTERVAL_MS) return Promise.resolve();
  state.inFlight = reconcilePayPalInvoices()
    .then(async () => {
      if (Date.now() - state.lastRetryAt < WEBHOOK_RETRY_INTERVAL_MS) return;
      state.lastRetryAt = Date.now();
      await retryPendingPayPalWebhooks();
    })
    .catch(() => console.warn("PayPal reconciliation could not run."))
    .finally(() => {
      state.lastRunAt = Date.now();
      state.inFlight = undefined;
    });
  return state.inFlight;
}

export function reconcilePayPalOnRead(): Promise<void> {
  // Start on the first runtime read, after startup migrations. The timer cannot keep Node alive.
  if (!state.timer && (process.env.NODE_ENV === "development" || getAppEnv().demoPublic)) {
    state.timer = setInterval(() => void reconcileIfDue(), POLL_INTERVAL_MS);
    state.timer.unref();
  }
  return reconcileIfDue();
}
