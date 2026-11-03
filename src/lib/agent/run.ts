import { getNow } from '../clock';
import { db, type AppDb } from '../db/client';
import { getClient, getInvoice, getMessages, getPolicy, insertMessage, listInvoices, updateInvoice } from '../db/queries';
import { audit } from '../audit';
import { getLLM, type LLM } from '../llm';
import type { AgentRunResult, PayPalClient, RunOutcome, ToolCallRecord } from '../types';
import { buildSystemPrompt, wrapClientMessage } from './prompt';
import { agentTools, handleToolCall } from './tools';
import { refreshRisk } from '../risk/service';

const MAX_TOOL_ITERATIONS = 6;
const RUN_TIMEOUT_MS = 60_000;
const activeInvoices = new Set<string>();

export type AgentRunTrigger = 'manual' | 'due' | 'sim' | 'approval';

export interface AgentRunOptions {
  database?: AppDb;
  llm?: LLM;
  paypal?: PayPalClient;
  timeoutMs?: number;
}

export async function runAgent(
  invoiceId: string,
  trigger: AgentRunTrigger = 'manual',
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  const database = options.database ?? db;
  if (activeInvoices.has(invoiceId)) throw new Error('AGENT_RUN_IN_PROGRESS');
  activeInvoices.add(invoiceId);
  const runId = crypto.randomUUID();
  const startedAt = getNow().toISOString();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const invoice = getInvoice(invoiceId, database);
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
    const client = getClient(invoice.clientId, database);
    const policy = getPolicy(database);
    if (!client || !policy) throw new Error('AGENT_CONTEXT_INCOMPLETE');

    const messages = getMessages(invoiceId, database);
    const lastClientMessage = [...messages].reverse().find((message) => message.direction === 'client_to_agent');
    const unansweredNudges = messages.slice(messages.findLastIndex((message) => message.direction === 'client_to_agent') + 1)
      .filter((message) => message.direction === 'agent_to_client').length;
    const llm = options.llm ?? getLLM(client.persona ?? 'dana');
    const system = buildSystemPrompt({
      minDepositPercent: policy.minDepositPercent,
      maxInstallments: policy.maxInstallments,
      maxPlanDays: policy.maxPlanDays,
      maxDiscountPercent: policy.maxDiscountPercent,
      tone: policy.tone,
    }, policy.ownerName, policy.businessName, policy.tone);

    let result: { summary: string; toolCalls: ToolCallRecord[] };
    if (unansweredNudges >= 4) {
      const input = {
        invoiceId,
        kind: 'UNCLEAR',
        reason: `No response after ${unansweredNudges} reminders.`,
        recommendation: 'Try a personal call or send a final notice for the owner to review.',
      };
      const output = await handleToolCall('escalate_to_owner', input, database, getNow(), options.paypal);
      const parsed = JSON.parse(output) as unknown;
      result = {
        summary: `Escalated invoice ${invoice.number} after ${unansweredNudges} unanswered reminders.`,
        toolCalls: [{ tool: 'escalate_to_owner', input, ok: true, result: parsed, at: getNow().toISOString() }],
      };
    } else {
      let callsDispatched = 0;
      let rejectTimeout!: (reason: Error) => void;
      const timeoutPromise = new Promise<never>((_, reject) => { rejectTimeout = reject; });
      timer = setTimeout(() => {
        controller.abort(new Error('AGENT_RUN_TIMEOUT'));
        rejectTimeout(new Error('AGENT_RUN_TIMEOUT'));
      }, options.timeoutMs ?? RUN_TIMEOUT_MS);
      const work = llm.runToolLoop({
        system,
        messages: [{
          role: 'user',
          content: JSON.stringify({ invoiceId, latestClientMessage: lastClientMessage ? wrapClientMessage(lastClientMessage.body) : null }),
        }],
        tools: agentTools,
        maxIterations: MAX_TOOL_ITERATIONS,
        signal: controller.signal,
        onToolCall: async ({ name, input }) => {
          callsDispatched += 1;
          if (controller.signal.aborted) return JSON.stringify({ ok: false, error: 'AGENT_RUN_TIMEOUT' });
          if (callsDispatched > MAX_TOOL_ITERATIONS) {
            audit({ actor: 'agent', action: 'agent.iteration_cap', invoiceId, input: { name }, result: { ok: false }, ok: false }, database);
            return JSON.stringify({ ok: false, error: 'ITERATION_LIMIT' });
          }
          return handleToolCall(name, input, database, getNow(), options.paypal);
        },
      });
      result = await Promise.race([work, timeoutPromise]);
    }

    const finalState = outcomeFor(result.toolCalls);
    const summary = oneSentence(result.summary, finalState);
    updateInvoice(invoiceId, { lastAgentRunAt: getNow().toISOString() }, database);
    insertMessage({ id: crypto.randomUUID(), invoiceId, direction: 'system', body: summary, createdAt: getNow().toISOString() }, database);
    await refreshRisk(invoiceId, database, getNow());
    audit({ actor: 'agent', action: 'agent_run', invoiceId, input: { runId, trigger, startedAt }, result: { finalState, summary }, ok: true }, database);
    return { runId, finalState, summary, toolCalls: result.toolCalls.slice(0, MAX_TOOL_ITERATIONS) };
  } catch (error) {
    audit({ actor: 'agent', action: 'agent_run', invoiceId, input: { runId, trigger, startedAt }, result: { code: error instanceof Error ? error.message : 'AGENT_RUN_FAILED' }, ok: false }, database);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    updateInvoice(invoiceId, { lastAgentRunAt: getNow().toISOString() }, database);
    activeInvoices.delete(invoiceId);
  }
}

export async function runDueAgents(database: AppDb = db, options: Omit<AgentRunOptions, 'database'> = {}): Promise<AgentRunResult[]> {
  const now = getNow();
  const due = listInvoices(database).map(({ invoice }) => invoice)
    .filter((invoice) => invoice.nextFollowupAt !== null && Date.parse(invoice.nextFollowupAt) <= now.getTime());
  const results: AgentRunResult[] = [];
  for (const invoice of due) results.push(await runAgent(invoice.id, 'due', { ...options, database }));
  return results;
}

export function isAgentRunInProgress(invoiceId: string): boolean {
  return activeInvoices.has(invoiceId);
}

function oneSentence(text: string, outcome: RunOutcome): string {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  const firstSentence = cleaned.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence) return firstSentence;
  const fallback: Record<RunOutcome, string> = {
    NUDGED: 'Sent a reminder about the overdue invoice.',
    PLAN_OFFERED: 'Prepared a payment plan within the owner policy.',
    PLAN_ACTIVE: 'Created the approved installment invoices.',
    ESCALATED: 'Escalated the invoice for owner review.',
    WAITING: 'Scheduled a follow-up for the invoice.',
    NO_ACTION: 'No action was needed for the invoice.',
  };
  return fallback[outcome];
}

function outcomeFor(toolCalls: ToolCallRecord[]): RunOutcome {
  for (const call of [...toolCalls].reverse()) {
    if (!call.ok || !call.result || typeof call.result !== 'object') continue;
    const result = call.result as Record<string, unknown>;
    if (result.needsOwnerApproval === true || result.escalated === true || result.paypalError === true || call.tool === 'escalate_to_owner') return 'ESCALATED';
    if (result.ok === false) continue;
    if (call.tool === 'schedule_followup') return 'WAITING';
    if (call.tool === 'create_plan_invoices') return 'PLAN_ACTIVE';
    if (call.tool === 'propose_payment_plan') return 'PLAN_OFFERED';
    if (call.tool === 'send_message') return 'NUDGED';
  }
  return 'NO_ACTION';
}
