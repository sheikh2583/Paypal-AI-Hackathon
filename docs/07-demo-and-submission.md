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

**0:00–0:20 — The problem.** "Maya is a freelancer. She has $5,500 in overdue invoices and no time to chase them." Dashboard shows five seeded invoices, risk levels, chase state, and the next suggested action.

**0:20–0:45 — Guardrails.** Open Policy: "Maya sets the limits once. The agent can never exceed them." Show min deposit, installments, discount cap.

**0:45–1:30 — Negotiation (Dana).** Use the guided Dana panel and advance its three steps: send the reminder; add Dana's scripted “Can I split this?” reply and get a policy-checked offer; then simulate her acceptance and issue three mock installment invoices. The plan is $270 now (30%) + $315 + $315. Open Dana's invoice to show the conversation, plan schedule, and audit trail.

**1:30–2:10 — PayPal.** In the default mock mode, select “Simulate $270 deposit payment” on Dana's invoice. Show the deposit change to paid and the installment plan remain active. This is a deterministic mock payment, not a real PayPal transaction. If presenting a separately configured Sandbox run, use the PayPal Sandbox invoice page and buyer account instead.

**2:10–2:40 — Safety (Priya).** Priya demands a 40% discount. Agent does not promise anything and escalates (`DISCOUNT_REQUEST`). In the Approvals inbox Maya declines the 40% and sends a 5% goodwill counter instead (within policy, but her call); Chaser relays it to Priya.

**2:40–3:00 — Trust.** Open the Audit log: every tool call and policy decision with timestamps. Close with the one-line value prop and "Built with PayPal Invoicing and Claude."

Backup path for the full walkthrough: `PAYPAL_MODE=mock` and scripted LLM mode, same UI; no provider or PayPal credentials are required.

### Presenter setup and click path

1. Configure `AUTH_OWNER_EMAIL`, a private `BETTER_AUTH_SECRET` (at least 32 characters), `RESEND_API_KEY`, and `RESEND_FROM`. `APP_BASE_URL` is used to create email links. Start with `pnpm dev`, open `/setup`, create the one owner account, verify the email link, then sign in with the password and emailed OTP. No public demo credentials are provided.
2. The Dashboard shows the five fictional overdue invoices, risk levels, current chase states, and next actions. Use the Policy page to explain the owner's boundaries.
3. In “Walk through Dana’s payment plan,” the three highlighted stages show progress. Click the stage-specific button once per step; the latest action and any scripted client reply appear below it. The plan numbers are generated under policy and should be explained as a $270 deposit plus two $315 installments.
4. Open Dana's invoice to show the conversation and installment schedule. Click the clearly labelled mock deposit payment button to finish the payment segment. Use “Reset demo” after the presentation to open the in-app confirmation dialog, restore the fictional seed state, and clear the accumulated demo activity.

The guided sequence uses `ScriptedLLM` regardless of provider configuration. In mock mode, the deposit control calls the demo payment route with a local invoice ID and the reconciler updates the workspace over SSE. In Sandbox, open the PayPal invoice link and pay as the Sandbox buyer.

The owner authentication uses Better Auth sessions stored in SQLite. Protect `BETTER_AUTH_SECRET` and `RESEND_API_KEY` as deployment secrets. `onboarding@resend.dev` is a testing sender and is restricted to Resend's eligible test recipient; it does not enable mail to arbitrary users. Real-user delivery requires a domain you own and verify with Resend, then setting `RESEND_FROM` to that verified sender. Password reset is available from the sign-in page. Client messaging and PayPal remain simulated in the guided demo.

## Demo mode checklist (Person C)

- Guided Dana steps with visible progress and contextual action labels
- One-click "Reset demo" (reseeds fictional data and clears demo activity; confirmation required)
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
