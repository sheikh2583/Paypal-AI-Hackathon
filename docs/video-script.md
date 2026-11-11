# Three-minute demo script

Record the [hosted Chaser demo](https://paypal-ai-hackathon-9tkr.onrender.com) in **PayPal Sandbox**. Open it a minute before recording so Render Free can wake, and click **Reset demo** first. Dana’s and Priya’s guided replies are scripted so the walkthrough is repeatable; the free-text reply box uses the live model when a provider is configured. Add a buyer payment shot only after rehearsing it.

## Timed script

**0:00–0:15 — Problem**  
On screen: dashboard. Voiceover: “Maya has five overdue invoices worth $5,500. Chasing them is awkward and slow. Chaser is the collections agent that does it for her, and it can’t promise anything she hasn’t approved.”

**0:15–0:30 — Guardrails**  
On screen: Policy page. Voiceover: “She sets the limits once: a 30% minimum deposit, at most three installments, a 5% discount cap. These live in code, not in a prompt. The model proposes; the policy engine decides.”

**0:30–1:05 — Dana negotiation**  
On screen: dashboard walkthrough card, click through reminder, reply, plan. Voiceover: “Dana asks to split her $900 invoice. Chaser computes a $270 deposit and two $315 installments, inside the limits, and waits for her yes.”

**1:05–1:30 — PayPal issues the plan**  
On screen: confirm plan, open Dana’s invoice, show the three installment invoices and the deposit’s PayPal ID and payer link. Caption: “PayPal Sandbox · test money only.” Voiceover: “The moment she agrees, Chaser creates three real invoices through PayPal Invoicing. Here’s the deposit’s PayPal ID and the payer link. Webhooks come back verified.”

**1:30–1:55 — Out of policy goes to a human**  
On screen: Priya’s invoice, click “Priya asks for 40% off”, then Approvals. Voiceover: “Priya wants 40% off. That’s above Maya’s cap, so Chaser escalates instead of deciding. Maya gets an email, and the approval inbox shows the reason and a recommendation.”

**1:55–2:20 — Live AI, free text**  
If live AI is on: on screen, Marcus’s invoice, type “Can I get 20% off if I pay today?” in Reply as Marcus. Voiceover: “With a live model, a client can say anything. Chaser treats it as untrusted text, answers in Maya’s tone, and still can’t exceed the cap.”  
If scripted: on screen, Client reliability. Voiceover: “Chaser also ranks clients by how they actually pay, from this account’s own records, with the reasons spelled out.”

**2:20–2:45 — Autopilot and the audit log**  
On screen: dashboard Autopilot card, switch it on, click “Run a sweep now”; then Audit log. Voiceover: “Switch on Autopilot and Chaser sweeps due invoices every thirty minutes. Every tool call, every policy decision and every PayPal event lands in the audit log in plain language, with the raw record one click away.”

**2:45–3:00 — Architecture and close**  
On screen: the slide below. Voiceover: “Client text in, model proposes, Zod validates, policy decides, then PayPal acts and the audit log records it. Built with PayPal Invoicing, Render, Turso and Resend. Chaser: collections that never overstep.”

## Shot list

1. Dashboard with five overdue invoices and the Autopilot card.
2. Policy page.
3. Dana walkthrough, then her invoice with the three PayPal installment IDs.
4. Priya’s request and the Approvals page (email mention).
5. Reply-as-client box on Marcus (live) or Client reliability (scripted).
6. Audit log with the summary tiles.
7. Architecture slide, final fifteen seconds.

## Architecture slide

Five boxes: **Client text (untrusted)** → **LLM proposes** → **Zod validates** → **Policy decides** → **PayPal acts + audit**. Below: **PayPal Sandbox**, **Turso**, **Resend**, **Render**. Caption: “The model proposes; deterministic code decides.”
