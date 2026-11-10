# 05 — PayPal integration

> **Verify before relying.** This doc is written from general knowledge of PayPal's public APIs and has not been checked line by line against current documentation. Before implementing, have the agent check the current PayPal developer docs (developer.paypal.com) for the Invoicing v2 API, authentication, webhooks and the Sandbox. Where this doc and the official docs disagree, the official docs win; record the difference in `docs/DECISIONS.md`.

## What we use PayPal for

| Need | PayPal capability | Notes |
|---|---|---|
| Represent what the client owes | **Invoicing API (v2)** | Create, send, get, cancel invoices; recipient pays on PayPal's hosted invoice page |
| Know when a client paid | **Webhooks** (invoice paid events) + **polling fallback** | Webhooks need a public URL (ngrok / cloudflared) |
| Developer tooling for agents | **PayPal MCP server / Agent Toolkit** | Optional: lets the IDE agent explore Sandbox through MCP (see `.mcp.json.example`). Our app's runtime integration uses direct REST for control and determinism. |
| Auth | **OAuth 2.0 client credentials** | Token endpoint on the Sandbox base URL |

We deliberately do **not** build checkout buttons, subscriptions, payouts or disputes in the MVP.

## Sandbox setup checklist (Person A, do by Nov 3)

1. Create a PayPal developer account and log in to the developer dashboard.
2. Create a **Sandbox app** (REST API app) → copy Client ID and Secret into `.env.local`.
3. In Sandbox accounts, locate or create: one **Business** account (the invoicer) and one **Personal** account (the buyer/client). Note both emails.
4. Set `PAYPAL_SANDBOX_BUYER_EMAIL` to the personal account email. Real-mode invoices are sent to this address.
5. Make sure the app has Invoicing permissions/features enabled (check app feature settings in the dashboard).
6. Run the smoke script (prompt 03): get a token → create an invoice → send it → fetch it → open `recipientViewUrl` → pay with the Sandbox buyer account → fetch again and confirm `PAID`.
7. Webhooks: start a tunnel to `localhost:3000`, add a webhook in the dashboard pointing to `https://<tunnel>/api/webhooks/paypal` subscribed to invoice events (paid, cancelled, refunded), copy the Webhook ID to `PAYPAL_WEBHOOK_ID`.
8. Capture 2–3 real response JSONs (redacted) into `src/lib/paypal/__fixtures__/` so the mock can mirror real shapes.

## Auth

- `POST {BASE}/v1/oauth2/token`, HTTP Basic (`client_id:client_secret`), body `grant_type=client_credentials`.
- Cache the token in memory until ~60 s before `expires_in`. Never log it.

## Invoicing flow we implement

1. **createInvoice** → `POST {BASE}/v2/invoicing/invoices` with a body containing `detail` (invoice number, currency `USD`, due date/payment term, note), `invoicer` (business name/email), `primary_recipients` (client name/email) and `items` (one line item: description, quantity 1, unit amount as a decimal string). Send a `PayPal-Request-Id` header (our `requestId`) for idempotency.
   - Invoice numbers must be unique per account; if the API offers a "generate next invoice number" endpoint, use it, otherwise generate `CHSR-<yyyymmdd>-<seq>`.
2. **sendInvoice** → `POST {BASE}/v2/invoicing/invoices/{id}/send`. This emails the recipient (Sandbox buyer) and makes the hosted invoice page available.
3. **getInvoice** → `GET {BASE}/v2/invoicing/invoices/{id}`; map `status` (e.g. `DRAFT`, `SENT`, `PAID`, `PARTIALLY_PAID`, `CANCELLED`) and payment amounts into our `PayPalInvoice`.
4. **cancelInvoice** → `POST {BASE}/v2/invoicing/invoices/{id}/cancel` (used if a plan is rejected after invoices were created, or in demo reset).

**Installment plans** are modeled as **N separate invoices** (deposit + installments), each with its own due date, linked to the original via `parent_invoice_id`/`plan_id`. The original invoice becomes `SUPERSEDED` (cancelled in PayPal if still unpaid, with a note referencing the plan). Rationale: simple status tracking, per-installment payment links, and a clear demo.

*Alternative if time allows:* a single invoice with partial payments enabled. Not the MVP.

## Money mapping

`src/lib/paypal/map.ts` is the only place that converts: `centsToDecimalString(12345) -> "123.45"`, `decimalStringToCents("123.45") -> 12345`. Unit-test with edge cases (`0.1 + 0.2` style traps, `"100"`, `"100.5"`).

## Webhooks

- Endpoint: `POST /api/webhooks/paypal`.
- Verify the signature using PayPal's webhook verification (call PayPal's verify-webhook-signature endpoint with the transmission headers and `PAYPAL_WEBHOOK_ID`) in sandbox mode. In mock mode, accept a fixed local test header.
- Idempotency: insert `webhook_events` by event id first; if it already exists, return 200 and stop.
- Respond `200` quickly, then process: look up the local invoice by `paypal_invoice_id`, call `getInvoice` to read the authoritative state, update `paid_cents`/`status`, emit an event, audit it.
- Subscribe to the six events in PayPal's [Invoicing webhook catalog](https://developer.paypal.com/platforms/invoicing/reference/invoicing-webhooks/). The listener also accepts `INVOICING.INVOICE.SENT` if delivered. See D57 and [the runbook](runbook.md).

## Polling fallback (always implement)

A shared reconciler reads PayPal state for linked open invoices and superseded originals. Dashboard and invoice-list reads coalesce within 5 s. A 10 s interval starts on the first such read in dev or the public demo. Mock payment reconciles the affected invoice immediately. The fallback also retries accepted webhook work left pending after an error.

## Mock mode

`PAYPAL_MODE=mock` swaps in `mock.ts`:
- Generates fake IDs (`MOCK-INV2-<n>`) and a fake `recipientViewUrl` that points to a local page `/mock-paypal/invoice/[id]` with a "Pay now" button (so the demo can show a pay step with no PayPal dependency).
- Stores state in the same SQLite DB (`mock_paypal_invoices` table) so it survives reloads.
- `simulatePayment` updates the mock provider record. The shared reconciler then updates the local invoice and emits the same events the webhook would.
- Response shapes must match `__fixtures__`; a contract test compares keys of mock vs fixtures.

## Known risks

- Sandbox emails don't deliver to real inboxes; use the `recipientViewUrl` from `getInvoice` and the Sandbox buyer account.
- Sandbox can be slow or flaky; keep the mock-mode demo as the safety net and record the demo video in whichever mode is stable.
- Invoice number collisions: include a per-run suffix in the number during development.
- Never put real people's data in Sandbox.
