"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, LoaderCircle, Play, RotateCcw } from "lucide-react";

interface DemoControlsProps {
  invoiceId: string;
  paymentId?: string | null;
  compact?: boolean;
  stepComplete?: boolean;
}

export function DemoControls({ invoiceId, paymentId, compact = false, stepComplete = false }: DemoControlsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  async function post(path: string, body: Record<string, string>, action: string) {
    setBusy(action);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: { message?: string }; run?: { summary?: string }; reply?: string; message?: string; status?: string; reset?: boolean };
      if (!response.ok) throw new Error(result.error?.message ?? "The demo action failed.");
      const runSummary = result.run?.summary;
      const detail = runSummary ? `${result.reply ? `Dana: “${result.reply}” ` : ""}${runSummary}` : result.message ?? (result.status ? `Mock PayPal now shows ${result.status.toLowerCase()}.` : result.reply ? `Client reply: “${result.reply}”` : result.reset ? "Demo reset. Start with Dana’s reminder." : "Demo step complete.");
      setFeedback(detail);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={compact ? "space-y-2" : "rounded-2xl border bg-card p-5 shadow-sm"}>
      {!compact ? <div className="mb-4"><p className="text-sm font-semibold">Guided demo · scripted mode</p><p className="mt-1 text-sm text-muted-foreground">Advance one safe, repeatable step at a time. No live client messages or real PayPal payments are sent.</p></div> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy !== null || stepComplete} onClick={() => void post("/api/demo/step", { invoiceId }, "step")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
          {busy === "step" ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
          {busy === "step" ? "Running step…" : stepComplete ? "Negotiation complete" : "Run next Dana step"}
        </button>
        {paymentId ? <button type="button" disabled={busy !== null} onClick={() => void post("/api/mock-paypal/pay", { paypalInvoiceId: paymentId }, "pay")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-semibold transition hover:bg-secondary disabled:cursor-wait disabled:opacity-60">
          {busy === "pay" ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
          Simulate deposit payment
        </button> : null}
        {!compact ? <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm("Reset the fictional demo invoices, messages, approvals, and audit history?")) void post("/api/demo/reset", {}, "reset"); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-60">
          {busy === "reset" ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          Reset demo
        </button> : null}
      </div>
      {feedback ? <p role="status" className="mt-3 text-sm text-emerald-700">{feedback}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
