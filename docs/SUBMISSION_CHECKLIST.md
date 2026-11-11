# Submission checklist

Status is based on repository evidence and the documented demo path. Items needing an external upload, account check, or final human confirmation remain open.

- [x] [README](../README.md) distinguishes local mock mode from the hosted PayPal Sandbox demo and links the PayPal panel and activity feed screenshots.
- [x] Root [MIT License](../LICENSE) is in the public repository.
- [x] `.env.example` documents the app's environment keys, including `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `DEMO_PUBLIC`.
- [x] Mock scripted eval command and guardrail scope are documented.
- [x] [Video script](video-script.md), [judge walkthrough](devpost.md#test-the-demo), and [Sandbox runbook](runbook.md) distinguish scripted replies from PayPal Sandbox invoicing.
- [x] Hosted public dashboard returned HTTP 200 without a session. Dana’s issued plan showed three Sandbox installment IDs and a stored payer link that reached PayPal.
- [ ] Supply the optional Personal buyer password privately. The public docs keep `[PASTE BUYER PASSWORD]`.
- [ ] Confirm the public hosted demo remains reachable through December 15, 2026; free hosting can sleep.
- [ ] Record and publish an English YouTube video under three minutes. Show hosted Sandbox issuance and the payer link. Include a buyer payment shot only after verifying it.
- [x] Refresh the six README screenshots using the local mock app: dashboard, Dana before negotiation, issued plan and PayPal panel, activity feed, approvals inbox, and audit log.
- [ ] Confirm the exact Devpost deadline, eligibility, and rules on the submission page.
- [ ] Confirm the AI-tool disclosure (Claude Code, Cursor, GitHub Copilot, Codex, and any Kiro use) matches the tools actually used.
- [ ] Add all required teammates to the Devpost team, if applicable.
- [ ] Submit on the evening of November 11, 2026, Dhaka time.
- [ ] Recheck the submission and hosted link on the morning of November 12, 2026, Dhaka time.
- [ ] For the optional hosted payment shot, verify a Sandbox buyer payment and the resulting invoice update, and retain redacted evidence.
