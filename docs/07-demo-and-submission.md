# 07 — Demo and submission

## Judging fit (from the hackathon's published categories)

| Category | How Chaser competes |
|---|---|
| Best Use of Agentic Commerce | An agent transacts on a business's behalf (issues invoices, structures payment) under hard limits |
| Best Use of PayPal + AI | Invoicing API + payment tracking drive the core loop; AI does triage, negotiation, classification |
| Most Impactful | Late payment hurts freelancers and micro-businesses worldwide |
| Best Demo Delivery | Tight 3-minute story with a live, visible payment |
| Most Creative | Negotiation inside owner-defined bounds, with an approval inbox and audit trail |

## Seed data (exact scenario)

Owner: **Maya Rahman**, business **Rahman Design Studio** (fictional). Policy: min deposit 30%, max 3 installments, max 90 days, max discount 5%, auto-approve plans below $1,500, tone friendly.

| Client | Invoice | Amount | Days overdue | Persona | Notes |
|---|---|---|---|---|---|
| Dana Whitfield (Bright Path Bakery) | Brand identity package | $900 | 23 | `dana` | late_count 1, responsive |
| Marcus Lee (Lee Logistics) | Website refresh | $1,250 | 41 | `marcus` | late_count 3, low responsiveness |
| Priya Nair (Nair Wellness) | Social media kit | $600 | 12 | `priya` | late_count 0 |
| Tom Brennan (Brennan Tools) | Logo update | $350 | 6 | `tom` | late_count 0 |
| Elena Cruz (Cruz Interiors) | Catalog design | $2,400 | 18 | `elena` | large; above auto-approve threshold |

(Use clearly fictional names and addresses. Never real people. In `PAYPAL_MODE=sandbox` the seed gives every client the `PAYPAL_SANDBOX_BUYER_EMAIL`; otherwise fake `@example.com` addresses.)

Elena's plan exceeds the auto-approve threshold, so her journey demonstrates the owner sign-off flow (`PLAN_NEEDS_SIGNOFF`); it is optional in the 3-minute script and a good extra for the video or Q&A.

## 3-minute demo script

**0:00–0:20 — The problem.** "Maya is a freelancer. She has $5,500 in overdue invoices and no time to chase them." Dashboard shows 5 invoices ranked by risk with reasons.

**0:20–0:45 — Guardrails.** Open Policy: "Maya sets the limits once. The agent can never exceed them." Show min deposit, installments, discount cap.

**0:45–1:30 — Negotiation (Dana).** Run Chaser on Dana's invoice: agent sends a friendly reminder. Simulated reply: "Sorry, things are tight this month. Can I split this?" Agent proposes $270 now (30%) + $315 + $315 over 60 days. Dana: "That works!" Agent confirms.

**1:30–2:10 — PayPal.** Chaser creates and sends the three installment invoices via PayPal. Open the PayPal invoice page for the deposit, pay it (Sandbox buyer), and watch the dashboard update live: deposit marked paid, plan active.

**2:10–2:40 — Safety (Priya).** Priya demands a 40% discount. Agent does not promise anything and escalates (`DISCOUNT_REQUEST`). In the Approvals inbox Maya declines the 40% and sends a 5% goodwill counter instead (within policy, but her call); Chaser relays it to Priya.

**2:40–3:00 — Trust.** Open the Audit log: every tool call and policy decision with timestamps. Close with the one-line value prop and "Built with PayPal Invoicing and Claude."

Backup path for every step: mock mode + scripted LLM mode, same UI.

**Current guided UI:** the Dashboard lists live seeded invoice state and includes “Run next Dana step.” Use it once for the reminder, again for Dana's scripted split-payment reply and policy-checked proposal, and a third time for her acceptance and mock PayPal installment invoices. On Dana's invoice detail, “Simulate deposit payment” pays the first mock installment and refreshes the invoice state. Reset demo restores the fictional seed scenario after a presentation. The guided sequence uses `ScriptedLLM`, so it works without any provider key and does not send real client messages or real payments.

## Demo mode checklist (Person C)

- One-click "Reset demo" (reseeds, clears audit)
- "Advance time" control to make invoices overdue on cue
- "Simulate payment" button as a fallback to the PayPal page
- Presenter-friendly UI: large type, no dev chrome, dark/light OK, no scrollbars in the main flow
- Pre-recorded fallback video of the live flow

## Video

3 minutes max. Screen recording with voiceover (or captions). Record in the most stable mode. Show the real PayPal Sandbox payment at least once. Add a short architecture slide (10 seconds) showing the safety pipeline.

## Devpost write-up outline

1. **Inspiration** — late payments; the gap between "AI can write an email" and "AI can safely handle money"
2. **What it does** — the six capabilities in `01-product-brief.md`
3. **How we built it** — stack, PayPal Invoicing, webhooks + reconciler, tool-using agent, policy engine, mock mode
4. **Safety design** — proposes/validates/decides; approvals; audit; injection evals
5. **Challenges** — Sandbox quirks, LLM variance, making negotiation deterministic where money is involved
6. **Accomplishments** — end-to-end live payment; eval suite
7. **What we learned**
8. **What's next** — real channels (email/WhatsApp), multi-currency, Venmo, subscriptions, learning client behavior
9. **Built with** — Next.js, TypeScript, SQLite, PayPal Invoicing API, PayPal MCP/Agent Toolkit (dev), Claude

Include: repo link, demo video link, screenshots (dashboard, negotiation, approvals, audit), setup instructions, and honest notes on what is simulated (client channel, Sandbox money).

## Submission checklist

- [ ] Repo public (or shared as the rules require), README with setup in under 10 minutes
- [ ] `.env.example` complete, no secrets committed (run a secrets scan)
- [ ] Demo video uploaded and public
- [ ] Devpost text complete, screenshots added
- [ ] Verified exact deadline time and eligibility/rules on Devpost
- [ ] All three teammates added to the Devpost team
- [ ] Submitted on Nov 11; re-check on Nov 12 morning
