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

I would add real client channels, more currencies, and more payment providers after the single-owner demo is proven. Live PayPal is intentionally out of scope; the current integration is for mock money and PayPal Sandbox test money only.

## Try it

The hosted demo is [paypal-ai-hackathon-9tkr.onrender.com](https://paypal-ai-hackathon-9tkr.onrender.com). It uses fictional data, free hosting, and public demo mode; the first request can take about a minute. The default walkthrough uses mock PayPal. I did not treat a real Sandbox payment as verified for this write-up unless the separate hosted Sandbox run is rechecked.

## Built with

Next.js, TypeScript, React, Tailwind, Zod, Drizzle, Vitest, Better Auth, Turso/libSQL, SQLite, PayPal Invoicing v2, and a scripted/configurable LLM adapter.

## AI-tool disclosure to confirm

Repo evidence: `AGENTS.md` names Claude Code, Cursor, GitHub Copilot, and Codex; `.kiro/specs/` contains a Kiro spec. These repository artifacts do not prove the complete tool history. I must confirm the final tool list and use the hackathon's required disclosure format. These tools are not part of the runtime.
