"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, CircleDollarSign, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";

export function LoginForm({ demoEmail, demoPassword }: { demoEmail: string; demoPassword: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filled, setFilled] = useState(false);

  function useDemoCredentials() {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setFilled(true);
    setError("");
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Sign in failed. Please try again.");
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(56,189,248,0.25),transparent_48%),radial-gradient(ellipse_at_bottom_right,rgba(16,185,129,0.19),transparent_46%)]" />
        <div className="relative flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-white/10"><CircleDollarSign className="size-6 text-cyan-300" /></span><div><p className="text-lg font-semibold">Chaser</p><p className="text-xs text-slate-300">Invoice collections agent</p></div></div>
        <div className="relative max-w-xl"><p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-cyan-100"><Sparkles className="size-3.5" /> Demo workspace</p><h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">Get paid with a little more peace of mind.</h1><p className="mt-5 max-w-lg text-base leading-relaxed text-slate-300">Chaser follows up on overdue invoices, works within your policy, and puts exceptions in your hands.</p><div className="mt-10 grid gap-3 sm:grid-cols-2"><Feature icon={ShieldCheck} title="Policy controlled" detail="Every plan stays inside owner-set limits." /><Feature icon={Check} title="Auditable" detail="See why each action happened." /></div></div>
        <p className="relative text-xs text-slate-400">Fictional clients · PayPal mock mode · no real payments</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><span className="inline-flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><CircleDollarSign className="size-6" /></span><p className="mt-3 text-lg font-semibold">Chaser</p></div>
          <div className="mb-8"><p className="text-sm font-medium text-primary">Owner workspace</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">Welcome back</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sign in to review your invoices, approvals, and agent activity.</p></div>

          <button type="button" onClick={useDemoCredentials} className="group mb-6 w-full rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 text-left transition hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <span className="flex items-start justify-between gap-3"><span><span className="block text-sm font-semibold">Try the demo account</span><span className="mt-2 block font-mono text-xs text-muted-foreground">{demoEmail}</span><span className="mt-1 block font-mono text-xs text-muted-foreground">{demoPassword}</span></span><span className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl bg-background text-primary shadow-sm transition group-hover:translate-x-0.5"><ArrowRight className="size-4" /></span></span>
            <span className="mt-3 block text-xs font-medium text-primary">Click to fill the sign-in form</span>
          </button>

          <form onSubmit={signIn} className="space-y-4">
            <div><label htmlFor="email" className="mb-1.5 block text-sm font-medium">Email</label><input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => { setEmail(event.target.value); setFilled(false); }} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="you@example.com" /></div>
            <div><label htmlFor="password" className="mb-1.5 block text-sm font-medium">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => { setPassword(event.target.value); setFilled(false); }} className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="Enter your password" /></div>
            {filled ? <p role="status" className="text-xs text-emerald-700">Demo credentials filled in. Select “Sign in to Chaser” to continue.</p> : null}
            {error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
            <button type="submit" disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}{busy ? "Signing in…" : "Sign in to Chaser"}</button>
          </form>
          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">Single-owner demo access. Session expires after 7 days. Please do not enter real client or payment data.</p>
        </div>
      </section>
    </main>
  );
}

function Feature({ icon: Icon, title, detail }: { icon: typeof ShieldCheck; title: string; detail: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><Icon className="size-4 text-cyan-300" /><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-relaxed text-slate-300">{detail}</p></div>;
}
