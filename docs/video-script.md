# Demo video script (2:45)

Record the [hosted Chaser demo](https://paypal-ai-hackathon-9tkr.onrender.com) in **PayPal Sandbox**. Open it a minute before recording so Render Free can wake, and open **Demo tools** in the Start here panel and click **Reset demo** once before you start. Do it once more after recording; resets have a 10-second cooldown.

Every shot below was checked on Nov 12, 2026; recheck the labels on the hosted site once before recording. Dana’s and Priya’s replies are scripted so the walkthrough is repeatable. You can say Chaser emails Maya when a decision is needed: the Approvals card shows “Chaser emailed you about this decision” and the audit log records it. Don’t claim scheduled Autopilot sweeps: the hosted demo has no schedule configured.

## Timed script

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:12 | Dashboard: the **Start here** panel, then **Outstanding $5,500.00** | “I’ll pay you Friday. Friday never came. Maya is a freelancer with five overdue invoices, and chasing them is the worst part of her week.” |
| 0:12–0:25 | Sidebar **PayPal Sandbox** badge, then the **Your limits** card | “Chaser chases them for her. It’s wired to PayPal Invoicing, Sandbox test money here, and it works inside rules she sets once.” |
| 0:25–0:40 | **Policy** page | “At least 30% up front, no more than three payments, never more than 5% off. These rules live in code. The AI can suggest a plan, but the code decides.” |
| 0:40–0:58 | Click **Start Dana’s story**, then **Start with a reminder** | “Dana owes $900 and is 23 days late. Chaser sends a friendly reminder in Maya’s tone.” |
| 0:58–1:15 | Click **Continue to Dana’s reply** | “Dana asks to split it. Chaser offers $270 now and two payments of $315, inside Maya’s limits.” |
| 1:15–1:35 | Click **Confirm plan and create invoices**. **Payment plan** shows Active and **Sum of installments = original invoice** | “She says yes, and Chaser creates three real PayPal invoices. They add up to exactly $900.” |
| 1:35–1:55 | Open **Deposit**: the **PayPal** panel with the invoice ID and **Open in PayPal** | “Here’s the deposit’s PayPal invoice ID and the link Dana pays from. When PayPal reports a payment, Chaser checks the signature before it believes it.” |
| 1:55–2:15 | Dashboard, **Start Priya’s story**, click **Priya asks for 40% off**, then **Answer Priya in Approvals** | “Priya wants 40% off. That’s over Maya’s limit, so Chaser doesn’t decide. It brings it to Maya with the reason and a suggested reply.” |
| 2:15–2:28 | **Client reliability** | “Chaser also ranks clients by how they actually pay, from Maya’s own records, and explains every score.” |
| 2:28–2:40 | **Audit log** summary tiles, expand one entry | “Every message, decision and PayPal event is written down, so Maya can see exactly why anything happened.” |
| 2:40–2:45 | Dashboard | “Chaser. It chases the money and never promises what you didn’t approve.” |

## Optional clip: buyer payment (about 25 seconds)

Record this as its own take, after the plan step and before any reset. Open the deposit’s **Open in PayPal** link in a private window and pay as the Personal Sandbox buyer. Return to Chaser and show **PayPal activity** listing the paid event and the deposit marked Paid. The status can update through reconciliation before the webhook appears.

Voiceover: “Dana pays in PayPal, PayPal tells Chaser, and the invoice updates by itself.”

If you use this clip, cut the Client reliability shot to stay under 2:45.

## Optional clip: live AI reply

Only if a live reply has been checked on the hosted site that day. On Marcus’s invoice, type “Could you take 20% off if I pay today?” and click **Send as Marcus**. Use it only if the activity shows a live answer, not the scripted fallback note.

Voiceover: “With a live model, a client can write anything. Chaser treats it as untrusted text and still can’t go past the 5% cap.”

## Shot list

1. Dashboard with $5,500 outstanding and the PayPal Sandbox badge.
2. Policy page.
3. Dana walkthrough, then her payment plan with the three PayPal installment IDs.
4. Deposit’s PayPal panel.
5. Priya’s request and the Approvals page.
6. Client reliability.
7. Audit log with the summary tiles.

## Architecture slide

Five boxes: **Client text (untrusted)** → **LLM proposes** → **Zod validates** → **Policy decides** → **PayPal acts + audit**. Below: **PayPal Sandbox**, **Turso**, **Render**. Caption: “The model proposes; deterministic code decides.”
