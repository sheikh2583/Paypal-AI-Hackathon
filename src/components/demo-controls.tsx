"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, LoaderCircle, Play, RotateCcw } from "lucide-react";

interface DemoControlsProps {
  invoiceId: string;
  paymentId?: string | null;
  compact?: boolean;
  stepComplete?: boolean;
  progressStep?: 0 | 1 | 2 | 3;
  paymentAmountCents?: number;
  paymentComplete?: boolean;
}

const demoSteps = ["Send reminder", "Hear Dana’s reply", "Agree and issue plan"];
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function DemoControls({ invoiceId, paymentId, compact = false, stepComplete = false, progressStep = 0, paymentAmountCents, paymentComplete = false }: DemoControlsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

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

  useEffect(() => {
    if (!confirmReset) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.getElementById("reset-demo-dialog");
    const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    focusable[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmReset(false);
      if (event.key === "Tab" && focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [confirmReset]);

  return (
    <div className={compact ? "space-y-2" : "rounded-2xl border bg-card p-5 shadow-sm"}>
      {!compact ? <div className="mb-4"><p className="text-sm font-semibold">Walk through Dana’s payment plan</p><p className="mt-1 text-sm text-muted-foreground">A repeatable scripted scenario. Client replies and payments are simulated; no real messages or money are sent.</p></div> : null}
      {!compact ? <ol aria-label="Dana demo progress" className="mb-4 grid gap-2 sm:grid-cols-3">{demoSteps.map((label, index) => {
        const complete = progressStep > index;
        const current = progressStep === index && !stepComplete;
        return <li key={label} aria-current={current ? "step" : undefined} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${complete ? "border-emerald-200 bg-emerald-50 text-emerald-800" : current ? "border-primary/30 bg-primary/5 font-semibold text-foreground" : "text-muted-foreground"}`}><span className="grid size-5 shrink-0 place-items-center rounded-full bg-background font-semibold">{complete ? <Check className="size-3.5" /> : index + 1}</span>{label}</li>;
      })}</ol> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy !== null || stepComplete} onClick={() => void post("/api/demo/step", { invoiceId }, "step")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
          {busy === "step" ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
          {busy === "step" ? "Running step…" : stepComplete ? "Plan issued" : progressStep === 0 ? "Start with a reminder" : progressStep === 1 ? "Continue to Dana’s reply" : "Confirm plan and create invoices"}
        </button>
        {paymentId ? <button type="button" disabled={busy !== null} onClick={() => void post("/api/mock-paypal/pay", { paypalInvoiceId: paymentId }, "pay")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-semibold transition hover:bg-secondary disabled:cursor-wait disabled:opacity-60">
          {busy === "pay" ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
          Simulate {paymentAmountCents === undefined ? "deposit" : `${money(paymentAmountCents)} deposit`} payment
        </button> : null}
        {!compact ? <button type="button" disabled={busy !== null} onClick={() => setConfirmReset(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-60">
          {busy === "reset" ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          Reset demo
        </button> : null}
      </div>
      {paymentComplete ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Deposit paid in the mock flow. Dana’s plan walkthrough is complete.</p> : null}
      {stepComplete && !paymentId && !paymentComplete ? <p className="mt-3 text-sm text-muted-foreground">Installment invoices are ready. Open Dana’s invoice to review the schedule and simulate the deposit.</p> : null}
      {feedback ? <p role="status" className="mt-3 text-sm text-emerald-700">{feedback}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {confirmReset ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmReset(false); }}>
        <section id="reset-demo-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-demo-title" aria-describedby="reset-demo-description" className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl">
          <div className="mb-4 grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-800"><RotateCcw className="size-5" /></div>
          <h2 id="reset-demo-title" className="text-lg font-semibold">Reset the demo workspace?</h2>
          <p id="reset-demo-description" className="mt-2 text-sm leading-relaxed text-muted-foreground">This restores the fictional invoices and clears demo messages, approvals, and audit activity. You can run the walkthrough again afterward.</p>
          <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setConfirmReset(false)} className="min-h-10 rounded-lg border px-4 text-sm font-medium transition hover:bg-secondary">Keep current demo</button><button type="button" disabled={busy !== null} onClick={() => { setConfirmReset(false); void post("/api/demo/reset", {}, "reset"); }} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60">{busy === "reset" ? "Resetting…" : "Reset demo"}</button></div>
        </section>
      </div> : null}
    </div>
  );
}
