// Free-text client replies: the owner (or a judge) plays the client, the live model
// classifies the text as untrusted data, and the normal bounded agent run follows.
import { getNow } from '../clock';
import { db, type AppDb } from '../db/client';
import { getClient, getInvoice, getMessages, insertMessage } from '../db/queries';
import { getLlmEnv } from '../env';
import { emit } from '../events';
import { getLLM, type LLM } from '../llm';
import type { AgentRunResult, ReplyClassification } from '../types';
import { applyClassification, classifyClientReply } from './classify';
import { runAgent } from './run';

export const MAX_REPLY_CHARS = 600;
const COOLDOWN_MS = 5_000;
const OPEN = new Set(['SENT', 'OVERDUE', 'PARTIALLY_PAID']);
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export interface ClientReplyResult {
  classification: ReplyClassification;
  run: AgentRunResult;
}

export async function replyAsClient(
  invoiceId: string,
  text: string,
  options: { database?: AppDb; llm?: LLM } = {},
): Promise<ClientReplyResult> {
  const database = options.database ?? db;
  if (!options.llm && getLlmEnv().mode !== 'live') throw new Error('LIVE_AI_REQUIRED');
  const body = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!body || body.length > MAX_REPLY_CHARS) throw new Error('REPLY_INVALID');
  const invoice = getInvoice(invoiceId, database);
  if (!invoice) throw new Error('INVOICE_NOT_FOUND');
  if (!OPEN.has(invoice.status) || invoice.chaseState === 'RESOLVED') throw new Error('INVOICE_CLOSED');
  const client = getClient(invoice.clientId, database);
  if (!client) throw new Error('INVOICE_NOT_FOUND');

  const now = getNow(database);
  const lastReply = [...getMessages(invoiceId, database)].reverse().find((message) => message.direction === 'client_to_agent');
  if (lastReply && now.getTime() - Date.parse(lastReply.createdAt) < COOLDOWN_MS) throw new Error('REPLY_TOO_SOON');

  insertMessage({ id: crypto.randomUUID(), invoiceId, direction: 'client_to_agent', body, createdAt: now.toISOString() }, database);
  emit({ type: 'message.created', invoiceId, at: now.toISOString() });

  const llm = options.llm ?? getLLM(client.persona ?? 'dana');
  const context = `Invoice ${invoice.number} for ${money(invoice.amountCents)} was due ${invoice.dueAt.slice(0, 10)}; status ${invoice.status}; stage ${invoice.chaseState}.`;
  let classification: ReplyClassification;
  try {
    classification = await classifyClientReply(body, context, client.persona ?? undefined, llm);
  } catch {
    // A failed classification is treated as unclear; the agent run still decides what to do.
    classification = { intent: 'unclear', confidence: 0 };
  }
  const effective = applyClassification(invoiceId, classification, database);
  const run = await runAgent(invoiceId, 'manual', { database, llm: options.llm });
  return { classification: effective, run };
}
