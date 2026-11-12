import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import { ClientLoginForm } from "@/components/client-portal";
import { getClientSession } from "@/lib/client-access";
import { DEMO_CLIENT_ACCOUNTS } from "@/lib/demo-accounts";
import { getAppEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Client sign-in" };
export const dynamic = "force-dynamic";

// Works even on the public demo: clients get real accounts, created by the owner (D77).
export default async function ClientLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  if (await getClientSession()) redirect("/client");
  const { reason } = await searchParams;
  // The published demo account is offered only on the public demo, never on a real deployment.
  const demoAccount = getAppEnv().demoPublic ? DEMO_CLIENT_ACCOUNTS[0] : undefined;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-md">
        <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><CircleDollarSign className="size-6" aria-hidden="true" /></span>
        <p className="mt-6 text-sm font-medium text-primary">Client portal</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">See and pay your invoices</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sign in with the email and password your freelancer set up for you. You&apos;ll see only your own invoices, payment plans and messages.</p>
        <div className="mt-8"><ClientLoginForm
          notice={reason === "not-client" ? "That account isn't linked to a client. Sign in with a client account." : undefined}
          demo={demoAccount ? { name: demoAccount.name, email: demoAccount.email, password: demoAccount.password } : undefined}
        /></div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Running the business? <Link href="/" className="font-medium text-primary hover:underline">Go to the owner workspace</Link></p>
      </div>
    </main>
  );
}
