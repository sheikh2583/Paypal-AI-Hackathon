"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Play, Radar } from "lucide-react";
import type { AutopilotStatus } from "@/lib/autopilot";
import type { RunOutcome } from "@/lib/types";

const outcomeWords: Record<RunOutcome, string> = {
  NUDGED: "reminder sent",
  PLAN_OFFERED: "plan offered",
  PLAN_ACTIVE: "installments issued",
  ESCALATED: "waiting on you",
  WAITING: "follow-up scheduled",
  NO_ACTION: "no action needed",
};

function describeOutcomes(outcomes: RunOutcome[]): string {
  if (outcomes.length === 0) return "Nothing needed a follow-up right now.";
  const counts = new Map<string, number>();
  for (const outcome of outcomes) counts.set(outcomeWords[outcome], (counts.get(outcomeWords[outcome]) ?? 0) + 1);
  const parts = [...counts.entries()].map(([word, count]) => `${count} ${word}`);
  return `Checked ${outcomes.length} ${outcomes.length === 1 ? "invoice" : "invoices"}: ${parts.join(", ")}.`;
}

export function AutopilotCard({ status }: { status: AutopilotStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"toggle" | "run" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  async function call(action: "toggle" | "run", path: string, body?: Record<string, unknown>) {
    setBusy(action);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const result = await response.json() as { error?: { message?: string }; enabled?: boolean; results?: { finalState: RunOutcome }[]; failed?: unknown[] };
      if (!response.ok) throw new Error(result.error?.message ?? "Autopilot request failed.");
      if (action === "run") {
        const failed = Array.isArray(result.failed) ? result.failed.length : 0;
        setFeedback(`${describeOutcomes((result.results ?? []).map(({ finalState }) => finalState))}${failed ? ` ${failed} could not run.` : ""}`);
      } else if (!result.enabled) {
        setFeedback("Autopilot is off. Chaser acts only when you ask.");
      } else {
        setFeedback(status.scheduleConfigured
          ? "Autopilot is on. Chaser follows up on due invoices by itself and stops for anything outside your limits."
          : "Autopilot is on, but scheduled checks aren’t set up on this demo. Use “Check due invoices now”.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Autopilot request failed.");
    } finally {
      setBusy(null);
    }
  }

  const lastRun = status.lastRun;
  const dueText = status.dueNow === 0
    ? "No invoices are due for a follow-up right now."
    : `${status.dueNow} ${status.dueNow === 1 ? "invoice is" : "invoices are"} due for a follow-up.`;
  return (
    <section aria-labelledby="autopilot-title" className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`grid size-10 place-items-center rounded-xl ${status.enabled ? "bg-emerald-50 text-emerald-700" : "bg-accent text-primary"}`}><Radar className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 id="autopilot-title" className="font-semibold">Autopilot</h2>
            <p className="text-sm text-muted-foreground">
              {status.enabled
                ? status.scheduleConfigured
                  ? `Every ${status.intervalMinutes} minutes Chaser follows up on due invoices by itself, inside your limits.`
                  : "On, but scheduled checks aren’t set up here. Follow-ups run when you click below."
                : "Chaser only acts when you click. Turn it on to let Chaser follow up by itself."}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.enabled}
          aria-label="Autopilot"
          disabled={busy !== null}
          onClick={() => void call("toggle", "/api/autopilot", { enabled: !status.enabled })}
          className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-1.5 py-1 text-sm font-semibold transition disabled:opacity-60 ${status.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "bg-background text-muted-foreground"}`}
        >
          <span className={`grid size-7 place-items-center rounded-full transition ${status.enabled ? "order-2 bg-emerald-600 text-white" : "order-1 bg-secondary"}`}>{busy === "toggle" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}</span>
          <span className={`px-2 ${status.enabled ? "order-1" : "order-2"}`}>{status.enabled ? "On" : "Off"}</span>
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="text-muted-foreground">
          {dueText}
          {lastRun ? <> Last check {new Date(lastRun.at).toLocaleString()}, {lastRun.ranCount} of {lastRun.dueCount} handled.</> : null}
        </span>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void call("run", "/api/agent/run-due")}
          className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-semibold transition hover:bg-secondary disabled:opacity-60"
        >
          {busy === "run" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
          {busy === "run" ? "Checking due invoices…" : "Check due invoices now"}
        </button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Your limits and approvals apply exactly as they do when you click.</p>
      {feedback ? <p role="status" className="mt-3 text-sm text-emerald-700">{feedback}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
