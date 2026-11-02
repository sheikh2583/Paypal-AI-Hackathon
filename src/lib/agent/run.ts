import { getNow } from '../clock';
import { db, type AppDb } from '../db/client';
import { getClient, getInvoice, getMessages, getPolicy, updateInvoice } from '../db/queries';
import { audit } from '../audit';
import { getLLM } from '../llm';
import type { AgentRunResult, RunOutcome } from '../types';
import { buildSystemPrompt, wrapClientMessage } from './prompt';
import { agentTools, handleToolCall } from './tools';

const MAX_TOOL_ITERATIONS = 6;
const RUN_TIMEOUT_MS = 30_000;

export async function runAgent(invoiceId: string, database: AppDb = db): Promise<AgentRunResult> {
  const invoice = getInvoice(invoiceId, database);
  if (!invoice) throw new Error('INVOICE_NOT_FOUND');
  const client = getClient(invoice.clientId, database);
  const policy = getPolicy(database);
  if (!client || !policy) throw new Error('AGENT_CONTEXT_INCOMPLETE');

  const messages = getMessages(invoiceId, database);
  const lastClientMessage = [...messages].reverse().find((message) => message.direction === 'client_to_agent');
  const llm = getLLM(client.persona ?? 'dana');
  const work = llm.runToolLoop({
    system: buildSystemPrompt({
      minDepositPercent: policy.minDepositPercent,
      maxInstallments: policy.maxInstallments,
      maxPlanDays: policy.maxPlanDays,
      maxDiscountPercent: policy.maxDiscountPercent,
      tone: policy.tone,
    }, policy.ownerName, policy.businessName, policy.tone),
    messages: [{
      role: 'user',
      content: JSON.stringify({ invoiceId, latestClientMessage: lastClientMessage ? wrapClientMessage(lastClientMessage.body) : null }),
    }],
    tools: agentTools,
    maxIterations: MAX_TOOL_ITERATIONS,
    onToolCall: ({ name, input }) => handleToolCall(name, input, database, getNow()),
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const runId = crypto.randomUUID();
  try {
    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AGENT_RUN_TIMEOUT')), RUN_TIMEOUT_MS); }),
    ]);
    const finalState = outcomeFor(result.toolCalls);
    updateInvoice(invoiceId, { lastAgentRunAt: getNow().toISOString() }, database);
    audit({ actor: 'agent', action: 'agent_run', invoiceId, input: { runId }, result: { finalState, summary: result.summary }, ok: true }, database);
    return { runId, finalState, summary: result.summary, toolCalls: result.toolCalls };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function outcomeFor(toolCalls: AgentRunResult['toolCalls']): RunOutcome {
  for (const call of [...toolCalls].reverse()) {
    if (!call.ok || !call.result || typeof call.result !== 'object') continue;
    const result = call.result as Record<string, unknown>;
    if (result.ok === false) continue;
    if (call.tool === 'schedule_followup') return 'WAITING';
    if (call.tool === 'escalate_to_owner' || result.needsOwnerApproval === true || result.escalated === true) return 'ESCALATED';
    if (call.tool === 'create_plan_invoices') return 'PLAN_ACTIVE';
    if (call.tool === 'propose_payment_plan') return 'PLAN_OFFERED';
    if (call.tool === 'send_message') return 'NUDGED';
  }
  return 'NO_ACTION';
}
