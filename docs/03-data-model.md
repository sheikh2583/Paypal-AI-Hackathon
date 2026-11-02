# 03 — Data model

SQLite via Drizzle. All money columns are integer cents. All timestamps are ISO-8601 UTC strings. IDs are text (`nanoid`/`cuid`-style) unless noted.

## Tables

### `owner_policy` (single row, id = `default`)
| column | type | notes |
|---|---|---|
| id | text pk | always `default` |
| min_deposit_percent | integer | e.g. 30 |
| max_installments | integer | e.g. 3 (including the deposit) |
| max_plan_days | integer | e.g. 90 — last installment due within N days of acceptance |
| max_discount_percent | integer | e.g. 5 |
| auto_approve_below_cents | integer | plans below this total need no owner sign-off, e.g. 150000 |
| tone | text | `friendly` \| `firm` default tone |
| business_name | text | shown in messages |
| owner_name | text | signs messages |
| updated_at | text | |

### `clients`
| column | type | notes |
|---|---|---|
| id | text pk | |
| name | text | |
| email | text | Sandbox buyer email for real mode |
| persona | text | demo persona key (`dana`, `marcus`, ...) |
| late_count | integer | prior late invoices |
| avg_days_late | real | |
| responsiveness | text | `high` \| `medium` \| `low` |
| notes | text | |

### `invoices`
| column | type | notes |
|---|---|---|
| id | text pk | local id |
| paypal_invoice_id | text unique null | `INV2-...` style in real mode; fake in mock |
| paypal_invoice_url | text null | recipient view URL |
| client_id | text fk | |
| number | text | human invoice number |
| description | text | |
| amount_cents | integer | total |
| paid_cents | integer | default 0 |
| currency | text | `USD` only |
| issued_at | text | |
| due_at | text | |
| status | text | `SENT` \| `OVERDUE` \| `PARTIALLY_PAID` \| `PAID` \| `CANCELLED` \| `SUPERSEDED` |
| parent_invoice_id | text null | for installment children |
| plan_id | text null | plan this invoice belongs to |
| installment_no | integer null | 1-based |
| chase_state | text | `NEW` \| `NUDGED` \| `NEGOTIATING` \| `PLAN_OFFERED` \| `PLAN_ACCEPTED` \| `PLAN_ACTIVE` \| `ESCALATED` \| `RESOLVED` |
| risk_score | integer null | 0–100 |
| risk_factors | text | JSON array of `{factor, impact}` |
| risk_explanation | text null | LLM-written, cached |
| last_agent_run_at | text null | |
| next_followup_at | text null | set by `schedule_followup`; picked up by `POST /api/agent/run-due` |

### `plans`
| column | type | notes |
|---|---|---|
| id | text pk | |
| invoice_id | text fk | the original invoice |
| status | text | `OFFERED` \| `ACCEPTED` \| `ACTIVE` \| `REJECTED` \| `EXPIRED` \| `PENDING_APPROVAL` |
| discount_percent | integer | default 0 |
| total_cents | integer | after discount |
| installments_json | text | array of `{no, amountCents, dueAt}` |
| created_by | text | `agent` \| `owner` |
| approved_by | text null | `policy` (auto) \| `owner` |
| created_at | text | |

### `messages`
| column | type | notes |
|---|---|---|
| id | text pk | |
| invoice_id | text fk | |
| direction | text | `agent_to_client` \| `client_to_agent` \| `system` \| `owner_note` |
| body | text | plain text |
| created_at | text | |

### `approvals`
| column | type | notes |
|---|---|---|
| id | text pk | |
| invoice_id | text fk | |
| plan_id | text null | |
| kind | text | `PLAN_OUT_OF_BOUNDS` \| `PLAN_NEEDS_SIGNOFF` \| `DISCOUNT_REQUEST` \| `DISPUTE` \| `UNCLEAR` \| `ABUSE` \| `UNEXPECTED_PAYMENT` \| `PAYPAL_ERROR` |
| reason | text | agent's explanation |
| recommendation | text | what the agent suggests |
| status | text | `PENDING` \| `APPROVED` \| `REJECTED` \| `EDITED` |
| owner_response | text null | |
| created_at, resolved_at | text | |

### `audit_log`
| column | type | notes |
|---|---|---|
| id | text pk | |
| at | text | |
| actor | text | `agent` \| `owner` \| `system` \| `paypal` |
| action | text | e.g. `tool.send_message`, `policy.deny`, `paypal.invoice.created` |
| invoice_id | text null | |
| input_json | text | redacted |
| result_json | text | redacted |
| ok | integer | 1/0 |

### `webhook_events`
`id` (PayPal event id, pk), `type`, `received_at`, `processed_at`, `payload_json` (redacted). Used for idempotency.

## Indexes

`invoices(status, due_at)`, `invoices(client_id)`, `messages(invoice_id, created_at)`, `audit_log(at)`, `approvals(status)`.

## Seed data

See `docs/07-demo-and-submission.md` for the exact five demo clients/invoices. Seeding is idempotent: it truncates and reinserts. `getNow()` anchors "overdue" days, so due dates in the seed are expressed relative to now (e.g. `-23d`).

## Derived values and seed emails

- `unansweredNudges` (a risk feature) is not stored: it is the number of `agent_to_client` messages since the last `client_to_agent` message for that invoice.
- `risk_score`, `risk_factors` and `risk_explanation` are written by `refreshRisk()` (see `docs/06`).
- Seed emails: in `PAYPAL_MODE=sandbox` every client's `email` is `PAYPAL_SANDBOX_BUYER_EMAIL` so Sandbox invoices reach the buyer account; otherwise use fake `@example.com` addresses.
- `PENDING_APPROVAL` plans always have a matching `PLAN_NEEDS_SIGNOFF` (or `PLAN_OUT_OF_BOUNDS`) approval row.

## Redaction rule

`audit_log` and `webhook_events` must never store secrets, tokens, or full email addresses. Store `d***@example.com`-style masked emails and omit PayPal auth headers.
