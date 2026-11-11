# Chaser — Devpost draft

I'll pay you Friday. Friday rarely comes.

**Elevator pitch:** “I’ll pay you Friday.” Friday never came. Chaser is the AI that chases overdue invoices for you, politely, and can’t promise anything you haven’t approved.

## Inspiration

Late invoices turn a small business owner's workday into awkward follow-up. I wanted to explore the gap between an AI that can write a reminder and an agent that can safely handle the next money-related step.

## What it does

Chaser ranks overdue fictional invoices, drafts a short follow-up, classifies a client's reply, and proposes a payment plan inside the owner's limits. It can create PayPal installment invoices, track payment, and send requests outside policy to an approval inbox. The UI conversation is simulated; it is not email or SMS delivery.

## How I built it

I built a Next.js and TypeScript App Router application with Drizzle, local SQLite for development, and Turso/libSQL for persistent hosting. A direct PayPal Invoicing v2 client has mock and Sandbox modes. A small adapter supports scripted replies or a configured LLM. Webhooks and a polling reconciler update invoice state.

## Safety design

The model proposes. Zod validates tool arguments. Deterministic policy code decides. Only then does an effect run, and the action is audited. Client text is labelled untrusted data, money is integer cents, discount and installment limits are enforced in code, and unclear or out-of-bounds requests require owner review. Prompt-injection cases are covered by scripted evals. Scripted runs verify the guardrail layer, not model behavior.

## Challenges

The hard parts were making odd-cent plan arithmetic exact, keeping a demo repeatable, and handling PayPal Sandbox timing and webhook delivery on free hosting. Persistent Turso storage matters because a Render restart must not erase the owner or business state.

## What I'm proud of

The same policy and audit path is used by the mock flow and the PayPal client boundary. A judge can inspect why an action was allowed or escalated instead of trusting a hidden prompt.

## What I learned

LLMs are useful for language and classification, but they should not own limits or payment state. Small deterministic services make those decisions testable.

## What's next

I would add live, free-text client replies and a payment behavior score that ranks clients by how late they pay and how they respond to reminders or payment plans. The guided replies today are scripted.

## Test the demo

Open [Chaser](https://paypal-ai-hackathon-9tkr.onrender.com). No Chaser login is required. Allow about a minute for Render Free to wake. The hosted demo uses fictional data and PayPal Sandbox test money. Local `pnpm dev` without keys uses mock PayPal.

1. Start on the dashboard. A reset workspace shows five overdue invoices totaling $5,500.
2. Open Dana Whitfield’s invoice and click **Start with a reminder**.
3. Click **Continue to Dana’s reply** to see the scripted split request. Review the $270 deposit and two $315 installments, then click **Confirm plan and create invoices**.
4. Review the PayPal panel and installment list. Open **Deposit** for the linked invoice’s ID and **Open in PayPal** link. The dashboard’s **PayPal activity** card lists deliveries as they arrive.
5. Open the PayPal panel on any invoice to see the live Sandbox invoice ID and link, and the PayPal activity card for verified webhook events. Use an issued installment to see a linked Sandbox invoice.
6. Open **Audit log** to see the tool and policy decisions.
7. Open Priya’s invoice and click **Simulate Priya’s 40% discount request**. Check **Approvals** for the escalation.
8. On the dashboard, click **Reset demo** and confirm to restore the fictional workspace.

**Optional: Pay as the buyer before resetting.** Open the deposit’s **Open in PayPal** link. PayPal Sandbox asks for the Personal buyer account `sb-ciade53821110@personal.example.com` and password **[PASTE BUYER PASSWORD]**. This uses test money. On Nov 11, 2026, a hosted Sandbox buyer payment produced an `INVOICING.INVOICE.PAID` webhook that Chaser verified and recorded.

## Built with

Next.js, TypeScript, React, Tailwind, Zod, Drizzle, Vitest, Better Auth, Turso/libSQL, SQLite, PayPal Invoicing v2, and a scripted/configurable LLM adapter.

## AI-tool disclosure to confirm

Repo evidence: `AGENTS.md` names Claude Code, Cursor, GitHub Copilot, and Codex; `.kiro/specs/` contains a Kiro spec. These repository artifacts do not prove the complete tool history. I must confirm the final tool list and use the hackathon's required disclosure format. These tools are not part of the runtime.
