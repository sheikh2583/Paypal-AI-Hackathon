import { getNow } from '../clock';
import { db, type AppDb } from '../db/client';
import { getClient, getInvoice, getMessages, getPlan, getPolicy, insertMessage, listInvoices, listPlansByInvoiceId, updateInvoice } from '../db/queries';
import { audit, auditProviderCall } from '../audit';
import { getLLM, ScriptedLLM, isRetryableLlmError, type LLM, type ToolCallRequest } from '../llm';
import { getLlmEnv } from '../env';
import type { AgentRunResult, PayPalClient, RunOutcome, ToolCallRecord } from '../types';
import { buildSystemPrompt, exposesAgentInstructions, wrapClientMessage } from './prompt';
import { agentTools, handleToolCall } from './tools';
import { refreshRisk } from '../risk/service';

const MAX_TOOL_ITERATIONS = 6;
const RUN_TIMEOUT_MS = 60_000;
const activeInvoices = new Set<string>();

export type AgentRunTrigger = 'manual' | 'due' | 'sim' | 'approval';

export interface AgentRunOptions {
  database?: AppDb;
  llm?: LLM;
  /** Used instead of the generic persona script if the live model fails before any side effect. */
  fallbackLlm?: LLM;
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
  let fallbackUsed = false;

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
    // Once the client has accepted a plan, issuing its invoices is the next step. The model is asked to
    // call that tool first, and is given the plan ID, instead of being trusted to remember it (D79).
    const acceptedPlan = listPlansByInvoiceId(invoiceId, database).find((plan) => plan.status === 'ACCEPTED');
    const requiredTool = acceptedPlan ? 'create_plan_invoices' : undefined;
    const system = buildSystemPrompt({
      minDepositPercent: policy.minDepositPercent,
      maxInstallments: policy.maxInstallments,
      maxPlanDays: policy.maxPlanDays,
      maxDiscountPercent: policy.maxDiscountPercent,
      tone: policy.tone,
    }, policy.ownerName, policy.businessName, policy.tone);
    function executeTool({ name, input }: ToolCallRequest): Promise<string> {
      const args = input as { invoiceId?: unknown; planId?: unknown } | undefined;
      const plan = name === 'create_plan_invoices' && typeof args?.planId === 'string' ? getPlan(args.planId, database) : undefined;
      if ((typeof args?.invoiceId === 'string' && args.invoiceId !== invoiceId) || (plan && plan.invoiceId !== invoiceId)) {
        const result = { ok: false, error: 'TOOL_SCOPE_VIOLATION' };
        audit({ actor: 'agent', action: name, invoiceId, input, result, ok: false }, database);
        return Promise.resolve(JSON.stringify(result));
      }
      return handleToolCall(name, input, database, getNow(), options.paypal);
    }

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
      let sideEffectRan = false;
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
          content: JSON.stringify({
            invoiceId,
            latestClientMessage: lastClientMessage ? wrapClientMessage(lastClientMessage.body) : null,
            ...(acceptedPlan ? { acceptedPlanId: acceptedPlan.id, nextStep: 'The client accepted this plan. Issue its installment invoices with create_plan_invoices, then confirm to the client.' } : {}),
          }),
        }],
        tools: agentTools,
        maxIterations: MAX_TOOL_ITERATIONS,
        signal: controller.signal,
        ...(requiredTool ? { toolChoiceName: requiredTool } : {}),
        onProviderCall: (record) => auditProviderCall(record, { invoiceId, purpose: 'agent_run', provider: getLlmEnv().provider }, database),
        onToolCall: async (call) => {
          const { name } = call;
          callsDispatched += 1;
          if (controller.signal.aborted) return JSON.stringify({ ok: false, error: 'AGENT_RUN_TIMEOUT' });
          if (callsDispatched > MAX_TOOL_ITERATIONS) {
            audit({ actor: 'agent', action: 'agent.iteration_cap', invoiceId, input: { name }, result: { ok: false }, ok: false }, database);
            return JSON.stringify({ ok: false, error: 'ITERATION_LIMIT' });
          }
          if (name !== 'get_invoice_context') sideEffectRan = true;
          return executeTool(call);
        },
      });
      try {
        result = await Promise.race([work, timeoutPromise]);
      } catch (error) {
        const llmEnv = getLlmEnv();
        if (llmEnv.mode !== 'live' || sideEffectRan || !isRetryableLlmError(error)) throw error;
        fallbackUsed = true;
        const reason = error instanceof Error && /^LLM_(HTTP_\d+|TIMEOUT|NETWORK_ERROR|POOL_EXHAUSTED)/.test(error.message)
          ? error.message
          : 'TRANSIENT_PROVIDER_ERROR';
        audit({ actor: 'agent', action: 'llm.fallback', invoiceId, input: { provider: llmEnv.provider, reason }, result: { ok: true, fallback: 'scripted' }, ok: true }, database);
        result = await (options.fallbackLlm ?? new ScriptedLLM(client.persona ?? 'dana')).runToolLoop({
          system, messages: [{ role: 'user', content: JSON.stringify({ invoiceId, latestClientMessage: lastClientMessage ? wrapClientMessage(lastClientMessage.body) : null }) }],
          tools: agentTools, maxIterations: MAX_TOOL_ITERATIONS, signal: controller.signal,
          onToolCall: async (call) => {
            callsDispatched += 1;
            if (callsDispatched > MAX_TOOL_ITERATIONS) {
              audit({ actor: 'agent', action: 'agent.iteration_cap', invoiceId, input: { name: call.name }, result: { ok: false }, ok: false }, database);
              return JSON.stringify({ ok: false, error: 'ITERATION_LIMIT' });
            }
            return executeTool(call);
          },
        });
      }
    }

    const finalState = outcomeFor(result.toolCalls);
    const baseSummary = oneSentence(result.summary, finalState);
    const summary = fallbackUsed
      ? `${baseSummary.replace(/[.!?]$/, '')}; scripted fallback handled a live provider failure.`
      : baseSummary;
    updateInvoice(invoiceId, { lastAgentRunAt: getNow().toISOString() }, database);
    insertMessage({ id: crypto.randomUUID(), invoiceId, direction: 'system', body: summary, createdAt: getNow().toISOString() }, database);
    await refreshRisk(invoiceId, database, getNow());
    audit({ actor: 'agent', action: 'agent_run', invoiceId, input: { runId, trigger, startedAt }, result: { finalState, summary }, ok: true }, database);
    return { runId, finalState, summary, toolCalls: result.toolCalls.slice(0, MAX_TOOL_ITERATIONS) };
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : 'AGENT_RUN_FAILED';
    audit({ actor: 'agent', action: 'agent_run', invoiceId, input: { runId, trigger, startedAt }, result: { code }, ok: false }, database);
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
  // The loop's own cap notice says nothing about what the run achieved, so the outcome sentence replaces it.
  const capNotice = /^Tool iteration limit reached\.?$/i.test(cleaned);
  if (firstSentence && !capNotice && !exposesAgentInstructions(cleaned)) return firstSentence;
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
  const last = lastOutcome(toolCalls);
  const succeeded = (tool: string) => toolCalls.some((call) => call.tool === tool && call.ok
    && typeof call.result === 'object' && call.result !== null && (call.result as Record<string, unknown>).ok === true
    && (call.result as Record<string, unknown>).needsOwnerApproval !== true);
  // A decision handed to the owner outranks the note Chaser sends the client afterwards.
  const escalated = toolCalls.some((call) => call.ok && typeof call.result === 'object' && call.result !== null
    && (call.tool === 'escalate_to_owner' ? (call.result as Record<string, unknown>).ok === true
      : (call.result as Record<string, unknown>).needsOwnerApproval === true || (call.result as Record<string, unknown>).escalated === true));
  if (escalated && (last === 'WAITING' || last === 'NUDGED')) return 'ESCALATED';
  // Issuing the installments (or offering a plan) is the run's real result; a confirmation or follow-up after it does not change that.
  if (last !== 'WAITING' && last !== 'NUDGED') return last;
  if (succeeded('create_plan_invoices')) return 'PLAN_ACTIVE';
  return succeeded('propose_payment_plan') ? 'PLAN_OFFERED' : last;
}

function lastOutcome(toolCalls: ToolCallRecord[]): RunOutcome {
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
