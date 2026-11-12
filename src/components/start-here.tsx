import Link from "next/link";
import { ArrowRight, Check, Settings2 } from "lucide-react";
import { DemoControls } from "./demo-controls";

export type StoryState = "new" | "in-progress" | "done";

export interface StartHereProps {
  ownerFirstName: string;
  outstandingLabel: string;
  clientCount: number;
  maxDiscountPercent: number;
  paypalMode: "mock" | "sandbox";
  dana: { state: StoryState; step: number };
  priya: { state: StoryState };
  showReset: boolean;
}

/** The judge's first screen: who they are, the two stories to try, and where everything else lives. */
export function StartHere({ ownerFirstName, outstandingLabel, clientCount, maxDiscountPercent, paypalMode, dana, priya, showReset }: StartHereProps) {
  const money = paypalMode === "sandbox"
    ? "Invoices are real PayPal Sandbox invoices paid with test money, so nothing is charged."
    : "PayPal is simulated here, so nothing is charged.";
  return (
    <section aria-labelledby="start-here-title" className="rounded-2xl border border-primary/25 bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Start here</p>
      <h2 id="start-here-title" className="mt-1 text-lg font-semibold">You’re {ownerFirstName}, a freelancer owed {outstandingLabel} by {clientCount} clients.</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Chaser follows up on the late invoices for you. It can offer payment plans, but only inside limits you set, and it asks you before going past them. Try the two short stories below. {money}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <StoryCard
          number={1}
          title="Dana asks to split her bill"
          body="Chaser sends a reminder, offers a plan inside your limits, and creates the PayPal invoices when she agrees."
          href="/invoices/invoice-dana-900"
          state={dana.state}
          progress={dana.state === "in-progress" ? `Step ${dana.step + 1} of 3` : undefined}
          cta={dana.state === "new" ? "Start Dana’s story" : dana.state === "done" ? "See Dana’s plan" : "Continue Dana’s story"}
        />
        <StoryCard
          number={2}
          title="Priya asks for 40% off"
          body={`That’s more than your ${maxDiscountPercent}% limit, so Chaser doesn’t decide. It brings the request to you.`}
          href={priya.state === "done" ? "/approvals" : "/invoices/invoice-priya-600"}
          state={priya.state}
          cta={priya.state === "done" ? "Answer Priya in Approvals" : "Start Priya’s story"}
        />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Afterwards, the <Link href="/audit" className="font-medium text-primary underline">Audit log</Link> shows every step Chaser took and why, and <Link href="/clients" className="font-medium text-primary underline">Client reliability</Link> ranks who pays on time.
      </p>
      <details className="group mt-4 rounded-xl border bg-background/60 px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <Settings2 className="size-4" aria-hidden="true" /> Demo tools <span className="text-xs font-normal">· move time forward or reset</span>
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">Everyone viewing this demo shares one workspace. Moving time makes more invoices overdue; resetting starts both stories over for everyone.</p>
          <DemoControls compact paypalMode={paypalMode} showTimeControls showReset={showReset} />
        </div>
      </details>
    </section>
  );
}

function StoryCard({ number, title, body, href, state, progress, cta }: {
  number: number; title: string; body: string; href: string; state: StoryState; progress?: string; cta: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{number}</span>
        {state === "done"
          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"><Check className="size-3.5" aria-hidden="true" /> Done</span>
          : progress ? <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{progress}</span> : null}
      </div>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 flex-1 text-sm text-muted-foreground">{body}</p>
      <Link href={href} className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90">
        {cta} <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
