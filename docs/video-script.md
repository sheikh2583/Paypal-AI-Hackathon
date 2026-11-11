# Three-minute demo script

Record the [hosted Chaser demo](https://paypal-ai-hackathon-9tkr.onrender.com) in **PayPal Sandbox**. Open it before recording so Render Free can wake. Dana’s replies are scripted. Local `pnpm dev` without keys uses mock PayPal. The main cut shows invoice issuance and the payer link. Add a buyer payment shot only after rehearsing and verifying it.

## Timed script

**0:00–0:15 — Problem**  
On screen: open the dashboard. Voiceover: “Maya has five fictional overdue invoices totaling $5,500. Chaser ranks the risk and shows the next action instead of making her chase every client manually.”

**0:15–0:30 — Guardrails**  
On screen: open Policy. Voiceover: “Maya sets the boundaries once: a 30% minimum deposit, at most three installments, and a 5% discount cap. The agent cannot change these values.”

**0:30–1:05 — Dana negotiation**  
On screen: use the guided Dana panel: reminder, client reply, offer. Voiceover: “Dana asks to split her $900 invoice. The scripted client channel is deliberately repeatable. Chaser computes $270 now and two $315 installments, then waits for her acceptance.”

**1:05–1:25 — Create the plan**  
On screen: confirm the plan and open Dana’s invoice. Voiceover: “After the policy check, Chaser creates three installment invoices in PayPal Sandbox. Their amounts add up to $900.”

**1:25–1:50 — PayPal evidence**

On screen: open the deposit’s PayPal panel, point to the invoice ID, then open the stored PayPal link. Return to the dashboard and show **PayPal activity**. Show the empty state if no delivery has arrived. Caption: “PayPal Sandbox · no real money moves.” Voiceover: “Here’s the installment ID and payer link from PayPal. The dashboard lists webhook deliveries when they arrive.”

**1:50–2:20 — Approval**  
On screen: open Priya’s invoice, simulate the 40% request, then open Approvals and show the escalation. Voiceover: “A 40% discount exceeds Maya’s limit. Chaser sends the request to the owner for review.”

**2:20–2:50 — Audit and modes**  
On screen: open Audit and point to the PayPal entries and **Scripted replies** badge. Return to the dashboard and reset the demo. Voiceover: “The audit log shows tool calls and policy decisions. Reset restores the fictional workspace for the next walkthrough.”

**2:50–3:00 — Architecture**  
On screen: show the slide below. Voiceover: “LLM proposes, Zod validates, policy decides, then an effect and audit entry run. PayPal can be mock or Sandbox; the safety boundary stays in code.”

## Shot list

1. `docs/screenshots/dashboard.png` — dashboard with five fictional overdue invoices.
2. Dana invoice before negotiation, then the issued plan and deposit’s PayPal panel.
3. PayPal payer page and dashboard activity card.
4. Approvals page with Priya’s escalation.
5. Audit page and Reset demo.
6. Architecture slide — final ten seconds.

## Ten-second architecture slide

Show five connected boxes: **Client text (untrusted)** → **LLM proposes** → **Zod validates** → **Policy decides** → **Effect + audit**. Below the last box, show **PayPal mock / Sandbox** and **SQLite / Turso** as the two external boundaries. Add the caption: “The model proposes; deterministic code decides.”
