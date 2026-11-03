import type { Metadata } from "next";
import { BadgeCheck, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db/client";
import { getPolicy } from "@/lib/db/queries";

export const metadata: Metadata = { title: "Policy" };
export const dynamic = "force-dynamic";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function PolicyPage() {
  const policy = getPolicy(db);
  return <div className="space-y-6"><PageHeader title="Owner policy" description="These limits are enforced in code for every payment-plan proposal." />
    {!policy ? <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Policy is unavailable. Reset the demo data to restore the owner’s settings.</div> : <>
      <section className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-accent text-primary"><SlidersHorizontal className="size-5" /></span><div><h2 className="font-semibold">{policy.businessName}</h2><p className="text-sm text-muted-foreground">Collection policy for {policy.ownerName}</p></div><span className="ml-auto hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 sm:inline-flex"><BadgeCheck className="size-3.5" /> Enforced</span></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Rule label="Minimum deposit" value={`${policy.minDepositPercent}%`} detail="of the plan total" /><Rule label="Maximum installments" value={String(policy.maxInstallments)} detail="including the deposit" /><Rule label="Maximum plan duration" value={`${policy.maxPlanDays} days`} detail="from plan acceptance" /><Rule label="Maximum discount" value={`${policy.maxDiscountPercent}%`} detail="any higher request is denied" /><Rule label="Owner sign-off" value={money(policy.autoApproveBelowCents)} detail="plans at or above this need approval" /><Rule label="Message tone" value={policy.tone} detail="used in client follow-ups" /></div>
      </section><p className="text-sm text-muted-foreground">The agent can suggest a plan. The policy service validates it and decides whether it can be offered or must wait for your approval.</p>
    </>}
  </div>;
}

function Rule({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-xl bg-secondary/60 p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold capitalize">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>; }
