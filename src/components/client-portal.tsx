"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LockKeyhole, LogOut, MousePointerClick, Send } from "lucide-react";
import { authClient } from "@/lib/auth-client";

/** Password sign-in for clients. Their accounts are created by the owner, so there is no sign-up here. */
export function ClientLoginForm({ notice, demo }: {
  notice?: string;
  /** Public demo only: a published fictional account the "Click for demo" button fills in (D78). */
  demo?: { name: string; email: string; password: string };
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await signInWith(email, password);
  }

  async function signInAsDemo() {
    if (!demo) return;
    // Fill the visible fields first so the visitor sees which account they are using.
    setEmail(demo.email);
    setPassword(demo.password);
    await signInWith(demo.email, demo.password);
  }

  async function signInWith(email: string, password: string) {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw new Error("That email or password could not be verified.");
      if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect === true) {
        throw new Error("This is the owner's account. Use the owner sign-in instead.");
      }
      router.replace("/client");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void signIn(event)} className="space-y-4">
      {notice ? <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{notice}</p> : null}
      {demo ? <div className="rounded-xl border border-primary/25 bg-accent/60 p-4">
        <button type="button" disabled={busy} onClick={() => void signInAsDemo()} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60">
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <MousePointerClick className="size-4" aria-hidden="true" />} Click for demo
        </button>
        <p className="mt-2 text-xs leading-relaxed text-accent-foreground">Signs you in as {demo.name}, a fictional client, with a public demo account. You&apos;ll see only {demo.name.split(" ")[0]}&apos;s invoices.</p>
      </div> : null}
      <div><label htmlFor="client-email" className="mb-1.5 block text-sm font-medium">Email</label><input id="client-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="you@example.com" /></div>
      <div><label htmlFor="client-password" className="mb-1.5 block text-sm font-medium">Password</label><input id="client-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="Your password" /></div>
      <button type="submit" disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60">{busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <LockKeyhole className="size-4" aria-hidden="true" />}{busy ? "Signing in…" : "Sign in"}</button>
      {error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

export function ClientSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} onClick={() => { setBusy(true); void authClient.signOut().finally(() => { router.replace("/client/login"); router.refresh(); }); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60">
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />} Sign out
    </button>
  );
}

/** A client's reply to Chaser about one of their own invoices. */
export function ClientReplyForm({ invoiceId, ownerName }: { invoiceId: string; ownerName: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await fetch("/api/client/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId, text }) });
      const data = await response.json() as { error?: { message?: string }; summary?: string };
      if (!response.ok) throw new Error(data.error?.message ?? "Your message could not be sent.");
      setResult("Sent. Chaser's answer is in the conversation above.");
      setText("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void send(event)} className="mt-3 space-y-2">
      <label htmlFor={`reply-${invoiceId}`} className="text-sm font-medium">Reply to {ownerName}</label>
      <textarea id={`reply-${invoiceId}`} value={text} onChange={(event) => setText(event.target.value)} maxLength={600} rows={3} disabled={busy} placeholder="For example: Could I split this into three payments?" className="w-full rounded-xl border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Chaser answers for {ownerName} within the limits {ownerName} set. This is a demo, so please don&apos;t type personal details.</span>
        <button type="submit" disabled={busy || !text.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}{busy ? "Sending…" : "Send"}</button>
      </div>
      {result ? <p role="status" className="text-sm text-emerald-700">{result}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
