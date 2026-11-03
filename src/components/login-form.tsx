"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleDollarSign, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ authConfigured, ownerAccountExists }: { authConfigured: boolean; ownerAccountExists: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "otp">("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.status === 403
          ? "Verify your email using the link we sent before signing in."
          : "That email or password could not be verified.");
        return;
      }
      if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect === true) {
        setStep("otp");
        setNotice("A one-time code was sent to your verified email address.");
        const sent = await authClient.twoFactor.sendOtp({ trustDevice: false });
        if (sent.error) throw new Error("We could not send your sign-in code. Try again shortly.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await authClient.twoFactor.verifyOtp({ code, trustDevice: false });
      if (result.error) throw new Error("That code is invalid or expired. Request a new one and try again.");
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The code could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.twoFactor.sendOtp({ trustDevice: false });
      if (result.error) throw new Error("We could not send a new code. Try again shortly.");
      setNotice("A new one-time code was sent. Older codes no longer work.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not send a new code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(56,189,248,0.25),transparent_48%),radial-gradient(ellipse_at_bottom_right,rgba(16,185,129,0.19),transparent_46%)]" />
        <div className="relative flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-white/10"><CircleDollarSign className="size-6 text-cyan-300" /></span><div><p className="text-lg font-semibold">Chaser</p><p className="text-xs text-slate-300">Invoice collections agent</p></div></div>
        <div className="relative max-w-xl"><p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-cyan-100"><Sparkles className="size-3.5" /> Owner workspace</p><h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">Collection work, with your guardrails in place.</h1><p className="mt-5 max-w-lg text-base leading-relaxed text-slate-300">Review what the agent did, keep every plan within policy, and verify every sign-in.</p><div className="mt-10 grid gap-3 sm:grid-cols-2"><Feature icon={ShieldCheck} title="Verified account" detail="Email must be verified before access." /><Feature icon={LockKeyhole} title="Two-step sign-in" detail="Password plus a one-time email code." /></div></div>
        <p className="relative text-xs text-slate-400">Fictional clients · PayPal mock mode · no real payments</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><span className="inline-flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><CircleDollarSign className="size-6" /></span><p className="mt-3 text-lg font-semibold">Chaser</p></div>
          <div className="mb-8"><p className="text-sm font-medium text-primary">Owner workspace</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">{step === "otp" ? "Check your email" : "Sign in securely"}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step === "otp" ? `Enter the one-time code sent to ${email}.` : "Use your owner account to review invoices, approvals, and agent activity."}</p></div>

          {!authConfigured ? <div role="status" className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">Authentication is not enabled yet. Set `AUTH_OWNER_EMAIL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and `AUTH_EMAIL_FROM` in the server environment.</div> : null}
          {step === "password" && !ownerAccountExists && authConfigured ? <div className="mb-5 rounded-xl border bg-secondary/50 p-4 text-sm text-muted-foreground">No owner account exists yet. <Link href="/setup" className="font-semibold text-primary hover:underline">Set up the owner account</Link>.</div> : null}

          {step === "password" ? <form onSubmit={(event) => void signIn(event)} className="space-y-4">
            <div><label htmlFor="email" className="mb-1.5 block text-sm font-medium">Owner email</label><input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="you@example.com" /></div>
            <div><div className="mb-1.5 flex items-center justify-between gap-3"><label htmlFor="password" className="text-sm font-medium">Password</label><Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link></div><input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="Enter your password" /></div>
            <button type="submit" disabled={busy || !authConfigured || !ownerAccountExists} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}{busy ? "Verifying…" : "Continue with password"}</button>
          </form> : <form onSubmit={(event) => void verifyCode(event)} className="space-y-4">
            <div><label htmlFor="otp" className="mb-1.5 block text-sm font-medium">Six-digit email code</label><input id="otp" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="h-12 w-full rounded-xl border bg-background px-4 text-center font-mono text-lg tracking-[0.4em] shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="000000" /></div>
            <button type="submit" disabled={busy || code.length !== 6} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{busy ? "Checking code…" : "Verify and continue"}</button>
            <div className="flex items-center justify-between text-xs"><button type="button" onClick={() => { setStep("password"); setCode(""); setError(""); setNotice(""); }} className="font-medium text-muted-foreground hover:text-foreground">Back to password</button><button type="button" disabled={busy} onClick={() => void resendCode()} className="font-medium text-primary hover:underline disabled:opacity-60">Resend code</button></div>
          </form>}

          {step === "password" && error ? <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
          {notice && step === "password" ? <p role="status" className="mt-4 text-sm text-emerald-700">{notice}</p> : null}
          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">Passwords must be at least 14 characters. Email verification and a one-time code are required. No public demo password is enabled.</p>
        </div>
      </section>
    </main>
  );
}

function Feature({ icon: Icon, title, detail }: { icon: typeof ShieldCheck; title: string; detail: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><Icon className="size-4 text-cyan-300" /><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-relaxed text-slate-300">{detail}</p></div>;
}
