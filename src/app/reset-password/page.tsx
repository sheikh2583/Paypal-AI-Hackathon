import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/password-reset-form";
export const metadata: Metadata = { title: "Choose a new password" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12"><section className="w-full rounded-3xl border bg-card p-8"><h1 className="text-2xl font-semibold">Reset link unavailable</h1><p className="mt-3 text-sm text-muted-foreground">Request a new password reset link from the sign-in page.</p></section></main>;
  return <ResetPasswordForm token={token} />;
}
