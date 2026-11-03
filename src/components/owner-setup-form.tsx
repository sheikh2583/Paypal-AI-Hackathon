"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export function OwnerSetupForm({ configured, testingSender }: { configured: boolean; testingSender: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 14) { setError("Use at least 14 characters for your password."); return; }
    setBusy(true);
    try {
      const result = await authClient.signUp.email({ email, password, name: "Chaser Owner", callbackURL: "/login?verified=1" });
      if (result.error) throw new Error("Owner setup could not be completed. Check that this email matches AUTH_OWNER_EMAIL and try again.");
      setMessage("Resend accepted the verification email request. Check the eligible inbox; the testing sender may restrict delivery to other recipients.");
      setPassword(""); setConfirm("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Owner setup could not be completed.");
    } finally { setBusy(false); }
  }

  return <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-12"><section className="w-full rounded-3xl border bg-card p-7 shadow-sm sm:p-10">
    <p className="text-sm font-semibold text-primary">Chaser · owner setup</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Create the owner account</h1>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Only the email configured as AUTH_OWNER_EMAIL can register. After setup, public registration is closed. Email verification and one-time email codes are required to sign in.</p>
    {testingSender ? <p role="note" className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed text-sky-950">Resend’s onboarding sender is for testing. It cannot send to arbitrary users; use the eligible Resend test recipient for this owner account. A verified domain is required for general recipient delivery.</p> : null}
    {!configured ? <p role="status" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Set AUTH_OWNER_EMAIL, BETTER_AUTH_SECRET, RESEND_API_KEY, and RESEND_FROM in the server environment first.</p> : <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-4">
      <div><label htmlFor="owner-email" className="mb-1.5 block text-sm font-medium">Owner email</label><input id="owner-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm" /></div>
      <div><label htmlFor="owner-password" className="mb-1.5 block text-sm font-medium">Password</label><input id="owner-password" type="password" autoComplete="new-password" minLength={14} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm" /><p className="mt-1 text-xs text-muted-foreground">At least 14 characters.</p></div>
      <div><label htmlFor="owner-confirm" className="mb-1.5 block text-sm font-medium">Confirm password</label><input id="owner-confirm" type="password" autoComplete="new-password" minLength={14} maxLength={128} required value={confirm} onChange={(event) => setConfirm(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm" /></div>
      {error ? <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}{message ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
      <button disabled={busy} className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? "Creating account…" : "Create owner account"}</button>
    </form>}
    <p className="mt-6 text-center text-sm text-muted-foreground">Already set up? <Link className="font-medium text-primary hover:underline" href="/login">Sign in</Link></p>
  </section></main>;
}
