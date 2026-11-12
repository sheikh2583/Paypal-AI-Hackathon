# Chaser — Devpost draft

I'll pay you Friday. Friday rarely comes.

**Elevator pitch:** “I’ll pay you Friday.” Friday never came. Chaser is the AI that chases overdue invoices for you, politely, and can’t promise anything you haven’t approved.

## Inspiration

Late invoices turn a small business owner's workday into awkward follow-up. I wanted to explore the gap between an AI that can write a reminder and an agent that can safely handle the next money-related step.

## What it does

Chaser ranks overdue fictional invoices, drafts a short follow-up, classifies a client’s reply, and proposes a payment plan inside the owner’s limits. It can create PayPal installment invoices, track payment, and send requests outside policy to an approval inbox. It emails the owner through Resend when a decision is needed, and the Approvals card notes that the email went out. An Autopilot switch lets the owner check due invoices on demand, or on a schedule once a cron secret is configured. With a live model configured, a judge can reply as the client in free text and watch the agent answer within policy; if the provider is busy, a scripted fallback answers and the audit log says so. The guided Dana and Priya steps stay scripted so the walkthrough is repeatable. Client reliability ranks the owner’s clients from their own invoice and payment records and explains each score.

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

Live free-text replies work with a configured provider; next is a tuned model and prompt that passes the full live eval suite, then real client email delivery. Cross-freelancer reliability pooling would need minimum sample sizes and a way for clients to dispute records.

## Test the demo

Open [Chaser](https://paypal-ai-hackathon-9tkr.onrender.com). No Chaser login is required. Allow about a minute for Render Free to wake. The hosted demo uses fictional data and PayPal Sandbox test money. Local `pnpm dev` without keys uses mock PayPal. The hosted demo skips sign-in so you can look around; the owner sign-in a real workspace uses (password, a one-time code emailed to the owner, email verification and password reset) is shown read-only from **See the owner sign-in** in the sidebar.

**Client portal.** Clients have real accounts. Open **Client portal sign-in** in the sidebar (or `/client/login`) and sign in as Dana with [PASTE DANA EMAIL] / [PASTE DANA PASSWORD]. You see only Dana’s invoices, her payment plan and PayPal pay links, and you can reply to Chaser as her; another client’s invoice is not reachable.

1. Start on the dashboard. The **Start here** panel explains the demo and offers two stories. A reset workspace shows **Outstanding $5,500.00** and **5 open invoices**, with the **PayPal Sandbox** badge in the sidebar.
2. Click **Start Dana’s story**. On Dana’s page, click **Start with a reminder**.
3. Click **Continue to Dana’s reply** to see the scripted split request. Review the $270 deposit and two $315 installments, then click **Confirm plan and create invoices**.
4. In **Payment plan**, check that the three installments show **Sum of installments = original invoice**. Each row shows its PayPal Sandbox invoice ID and an **Open in PayPal** link. Open **Deposit** to see its **PayPal** panel. The dashboard’s **PayPal activity** card lists signature-verified webhook events as they arrive.
5. Open **Audit log** to see the tool calls and policy decisions, with the raw record behind each entry.
6. Back on the dashboard, click **Start Priya’s story**, then **Priya asks for 40% off**. The request is above the 5% cap, so it goes to **Approvals** instead of being decided. Click **Answer Priya in Approvals**, where you can click **Send 5% goodwill counter**.
7. Open **Client reliability** to see the clients ranked by how they pay, with a breakdown for each score.
8. To start over, open **Demo tools** in the Start here panel, click **Reset demo** and confirm. Every visitor shares one workspace, and resets have a 10-second cooldown.

**Optional: Pay as the buyer before resetting.** Open the deposit’s **Open in PayPal** link. PayPal Sandbox asks for the Personal buyer account `sb-ciade53821110@personal.example.com` and password **[PASTE BUYER PASSWORD]**. This uses test money. On Nov 11, 2026, a hosted Sandbox buyer payment produced an `INVOICING.INVOICE.PAID` webhook that Chaser verified and recorded.

## Built with

Next.js, TypeScript, React, Tailwind, Zod, Drizzle, Vitest, Better Auth with Resend for owner sign-in email, Turso/libSQL, SQLite, PayPal Invoicing v2 with verified webhooks, Render for hosting, and a scripted/configurable LLM adapter.

## AI-tool disclosure to confirm

Repo evidence: `AGENTS.md` names Claude Code, Cursor, GitHub Copilot, and Codex; `.kiro/specs/` contains a Kiro spec. These repository artifacts do not prove the complete tool history. I must confirm the final tool list and use the hackathon's required disclosure format. These tools are not part of the runtime.
