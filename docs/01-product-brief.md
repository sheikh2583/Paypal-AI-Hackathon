# 01 — Product brief

## One-liner

Chaser is an AI agent that gets freelancers and micro-businesses paid: it chases overdue PayPal invoices, negotiates payment plans within the owner's limits, and issues the installment invoices itself.

## Problem

Late payment is a chronic cash-flow problem for freelancers and small shops. Chasing is awkward and time-consuming. Owners either nag too hard and lose the client, or give up and absorb the loss. Negotiating a payment plan by hand means back-and-forth, math, and creating new invoices.

## Users

- **Owner** (primary): a freelancer or micro-business owner who invoices through PayPal. Wants to be paid without damaging the relationship and without spending hours on it.
- **Client** (secondary): the person who owes money. Wants flexibility and a polite, clear, easy way to pay. Interacts through messages and PayPal's invoice page.

## What the product does

1. **Triage.** Scores each overdue invoice with a deterministic risk score (days overdue, amount, client history, response behavior), then explains it in plain language.
2. **Follow up.** Writes reminders in the right tone for each client; escalates gradually.
3. **Negotiate.** If a client can't pay in full, proposes a payment plan **within owner-set bounds** (minimum deposit, max installments, max duration, max discount).
4. **Transact.** After the client accepts, creates the installment invoices through PayPal, sends them, and tracks payment.
5. **Escalate.** Anything outside bounds (bigger discount, dispute, unclear intent, abusive message) goes to an **approval inbox** with the agent's recommendation. The owner approves, edits or rejects.
6. **Account.** An **audit log** shows every action the agent took, with inputs and results.

## Principles

- **Bounded autonomy.** The agent proposes; deterministic code decides what's allowed. Trust is the point.
- **Relationship first.** Messages are polite and human. Never threatening, never misleading, never false urgency.
- **Transparent.** The owner can always see what happened and why.
- **Boring where money moves.** Integer cents, validated, logged.

## Core user stories (must ship)

- As an owner, I see overdue invoices ranked by risk, with a reason for each.
- As an owner, I set my negotiation limits once (policy) and trust the agent to stay inside them.
- As an owner, I see the agent's conversation with each client.
- As a client (simulated in the demo), I can say I can't pay in full and receive a reasonable plan.
- As an owner, when a request is out of bounds, it lands in my approval inbox with a recommendation.
- As an owner, I see payments arrive and invoice status update without refreshing.
- As an owner, I can inspect an audit log of agent actions.

## Nice-to-have (only if everything above is solid)

- Client risk history sparkline
- "Why did the agent do this?" explainer on each audit entry
- Tone slider (friendly ↔ firm) per client
- Export audit log as CSV

## Explicit non-goals

Real email/SMS delivery, multi-currency, multi-user accounts/auth, real client onboarding, live PayPal, mobile app. Messages are shown in the UI as the "channel".

## Success criteria for the hackathon

- The 3-minute demo (docs/07) runs end to end without a hiccup, in real Sandbox mode and in mock mode.
- A judge can understand the value in 15 seconds and the safety model in 60.
- Visible, meaningful use of PayPal (Invoicing API, payments/webhooks) and AI (tool-using agent, negotiation, risk explanation).
- Clean repo, clear README, short video, honest write-up.

## Naming and tone

Name: **Chaser**. Voice: calm, helpful, professional. UI copy is plain and short. Avoid hype words.
