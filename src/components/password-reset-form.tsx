"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try { await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" }); } catch { /* Keep the response uniform to avoid account enumeration. */ }
    setSent(true); setBusy(false);
  }
  return <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12"><section className="w-full rounded-3xl border bg-card p-8 shadow-sm"><p className="text-sm font-semibold text-primary">Chaser · account recovery</p><h1 className="mt-2 text-3xl font-semibold">Reset your password</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Enter your owner email. We won&apos;t disclose whether an account exists.</p>{sent ? <p role="status" className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">If this is an eligible owner address and Resend accepts the request, check its inbox. This response does not confirm email delivery.</p> : <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4"><label className="block text-sm font-medium" htmlFor="reset-email">Owner email</label><input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm" /><button disabled={busy} className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? "Sending…" : "Send reset link"}</button></form>}<p className="mt-6 text-center text-sm"><Link href="/login" className="text-primary hover:underline">Back to sign in</Link></p></section></main>;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter(); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password.length < 14 || password !== confirm) { setError(password.length < 14 ? "Use at least 14 characters." : "Passwords do not match."); return; }
    setBusy(true);
    let failed = false;
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      failed = Boolean(result.error);
    } catch {
      failed = true;
    } finally {
      setBusy(false);
    }
    if (failed) { setError("This reset link is invalid or expired. Request a new one."); return; }
    router.replace("/login?passwordReset=1");
  }
  return <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12"><section className="w-full rounded-3xl border bg-card p-8 shadow-sm"><p className="text-sm font-semibold text-primary">Chaser · account recovery</p><h1 className="mt-2 text-3xl font-semibold">Choose a new password</h1><form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4"><div><label htmlFor="new-password" className="mb-1.5 block text-sm font-medium">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={14} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm" /></div><div><label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={14} maxLength={128} required value={confirm} onChange={(event) => setConfirm(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm" /></div>{error ? <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}<button disabled={busy} className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? "Updating…" : "Update password"}</button></form><p className="mt-5 text-xs text-muted-foreground">At least 14 characters. Password reset ends existing sessions.</p></section></main>;
}
