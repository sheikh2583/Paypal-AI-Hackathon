import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/password-reset-form";
import { getAppEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  // The server refuses reset requests on the public demo (D83), so say so instead of showing a form that cannot work.
  if (getAppEnv().demoPublic) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Password reset is off in this demo</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">This public demo opens Maya&apos;s workspace without a password. In a real workspace, the owner resets their password here and gets a one-time link by email.</p>
          <Link href="/" className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Open Maya&apos;s workspace</Link>
        </div>
      </main>
    );
  }
  return <ForgotPasswordForm />;
}
