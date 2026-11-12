"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MessageSquareReply, Sparkles } from "lucide-react";
import { intentLabels as intentWords } from "@/lib/labels";
import type { ReplyClassification } from "@/lib/types";

const suggestions = [
  "Can I split this into three payments?",
  "Could you take 20% off if I pay today?",
  "I’ll pay on Friday, sorry for the delay.",
  "I’m not happy with the work and won’t pay this.",
];

export function ClientReplyBox({ invoiceId, clientName, ownerName, liveAi, collapsed = false }: {
  invoiceId: string;
  clientName: string;
  ownerName: string;
  liveAi: boolean;
  /** Folded behind a summary while a scripted story is in progress on this invoice. */
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function send(body: string) {
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await fetch("/api/agent/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId, text: body }) });
      const data = await response.json() as { error?: { message?: string }; partial?: boolean; message?: string; classification?: ReplyClassification; run?: { summary?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Chaser could not process that reply.");
      if (data.partial) setResult(data.message ?? "Chaser acted on the reply.");
      else {
        const intent = data.classification ? intentWords[data.classification.intent] : "unclear";
        setResult(`Chaser read this as “${intent}”. ${data.run?.summary ?? ""}`.trim());
      }
      setText("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chaser could not process that reply.");
    } finally {
      setBusy(false);
    }
  }

  const heading = <span className="flex items-center gap-2"><MessageSquareReply className="size-4 text-primary" aria-hidden="true" /><span id="client-reply-title" className="font-semibold">Write your own reply as {clientName}</span></span>;
  const badge = liveAi ? <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground"><Sparkles className="size-3" aria-hidden="true" /> Live AI</span> : null;
  const body = liveAi ? <>
    <p className="mt-1 text-sm text-muted-foreground">Here you play {clientName}. Type anything a client might say, and Chaser answers for {ownerName}. It still can’t promise more than {ownerName}’s limits allow; anything bigger goes to Approvals.</p>
    <div className="mt-3 flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={busy} onClick={() => setText(suggestion)} className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-secondary disabled:opacity-60">{suggestion}</button>)}</div>
    <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void send(text); }}>
      <label className="sr-only" htmlFor="client-reply-text">{clientName}’s reply</label>
      <textarea id="client-reply-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={600} rows={3} disabled={busy} placeholder={`Write ${clientName}’s reply…`} className="w-full rounded-xl border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{text.length}/600 · This is a demo: please don’t type real personal details.</span>
        <button type="submit" disabled={busy || !text.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">{busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}{busy ? "Chaser is thinking…" : `Send as ${clientName}`}</button>
      </div>
    </form>
    {result ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{result} <a href="#conversation" className="font-semibold underline">See it in the conversation</a></p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
  </> : <p className="mt-1 text-sm text-muted-foreground">Free-text replies need a live AI model, which isn’t switched on here. Use the story buttons instead.</p>;

  if (collapsed) {
    return (
      <details aria-labelledby="client-reply-title" className="rounded-2xl border bg-card p-5 shadow-sm">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">{heading}<span className="text-sm text-muted-foreground">· optional, goes off the script</span>{badge}</summary>
        <div className="mt-2">{body}</div>
      </details>
    );
  }
  return (
    <section aria-labelledby="client-reply-title" className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">{heading}{badge}</div>
      {body}
    </section>
  );
}
