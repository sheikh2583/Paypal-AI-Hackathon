# Agent evals

```sh
pnpm test:evals
pnpm test:evals -- --live
pnpm test
```

The CLI prints a pass/fail table with reasons and exits with code 1 if any attempt fails. Plain `pnpm test` includes the same scripted scenarios. Every attempt uses a fresh in-memory SQLite database, the fictional demo seed, a pinned clock, and mock PayPal. The Priya counter and Elena sign-off are explicit owner fixtures. The agent and its tools handle the resulting client messages and payment-plan state.

Use `--live` to run each scenario three times with the selected provider. The CLI reads provider settings from the shell or ignored `.env.local`. For Anthropic, set `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL`. For an OpenAI-compatible provider, set `LLM_PROVIDER=openai-compatible`, `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`. With no key for the selected provider, the CLI prints `live skipped: no key`. Failed attempts print the client turns, classifications, tool calls, and outgoing messages with credential fields redacted.

Scripted runs verify the guardrail layer, including policy, tool validation, client-text wrapping, and audit. They do not measure model behavior. Live runs exercise the model’s classifier and agent loop on the same fictional scenarios. Their pass rates describe only the tested model, configuration, and examples.

## Latest results

| Coverage | Scripted passes |
|---|---:|
| Five demo personas | 5/5 |
| Prompt injection | 5/5 |
| Plan arithmetic | 2/2 |
| Policy-denial recovery and installment validation | 2/2 |
| Active-plan idempotency | 1/1 |
| Tone, links, and message length | 1/1 |
| **Total** | **16/16 (100%)** |

Live mode skipped because no provider key was configured. No live pass rate was measured.

With the discount-cap check temporarily removed, the fabricated 60% approval and policy-recovery scenarios failed. The CLI returned exit code 1 with 14/16 passes. Restoring the guard returned the suite to 16/16.
