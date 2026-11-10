# Three-minute demo script

This cut uses the deterministic mock flow. Put the caption **“Mock PayPal payment — no money moves”** on the payment shot. A real Sandbox payment was not counted as verified for this script.

## Timed script

**0:00–0:15 — Problem**  
On screen: open the dashboard. Voiceover: “Maya has five fictional overdue invoices totaling $5,500. Chaser ranks the risk and shows the next action instead of making her chase every client manually.”

**0:15–0:30 — Guardrails**  
On screen: open Policy. Voiceover: “Maya sets the boundaries once: a 30% minimum deposit, at most three installments, and a 5% discount cap. The agent cannot change these values.”

**0:30–1:05 — Dana negotiation**  
On screen: use the guided Dana panel: reminder, client reply, offer. Voiceover: “Dana asks to split her $900 invoice. The scripted client channel is deliberately repeatable. Chaser computes $270 now and two $315 installments, then waits for her acceptance.”

**1:05–1:25 — Create the plan**  
On screen: accept the offer and open Dana's invoice. Voiceover: “The plan is created only after the policy check succeeds. The conversation, schedule, and tool calls are visible together.”

**1:25–1:50 — Payment fallback**  
On screen: click the mock deposit control; show the paid cents and active plan. Caption: “Mock PayPal payment — no money moves.” Voiceover: “This recording uses the local mock provider. It follows the same reconciliation path without opening a real PayPal page.”

**1:50–2:20 — Approval**  
On screen: open Approvals, choose Priya, simulate the 40% request, then send the 5% goodwill counter. Voiceover: “A request outside the discount limit is not promised. It becomes an approval, and the owner's bounded counter is recorded.”

**2:20–2:50 — Audit and modes**  
On screen: open Audit and point to the Live AI / Scripted replies indicator. Voiceover: “Every tool call and policy decision is auditable. Scripted replies are honest demo fixtures; a configured provider can be selected separately.”

**2:50–3:00 — Architecture**  
On screen: show the slide below. Voiceover: “LLM proposes, Zod validates, policy decides, then an effect and audit entry run. PayPal can be mock or Sandbox; the safety boundary stays in code.”

## Shot list

1. `docs/screenshots/dashboard.png` — dashboard with five fictional overdue invoices.
2. `docs/screenshots/negotiation.png` — guided Dana conversation and plan.
3. Approvals page — Priya escalation and bounded counter.
4. Audit page — tool calls, policy decisions, and payment update.
5. Architecture slide — final ten seconds.

## Ten-second architecture slide

Show five connected boxes: **Client text (untrusted)** → **LLM proposes** → **Zod validates** → **Policy decides** → **Effect + audit**. Below the last box, show **PayPal mock / Sandbox** and **SQLite / Turso** as the two external boundaries. Add the caption: “The model proposes; deterministic code decides.”
