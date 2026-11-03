import { z } from 'zod';
import { getNow } from '@/lib/clock';
import { getClient, getInvoice, getMessages, insertMessage, listPlansByInvoiceId } from '@/lib/db/queries';
import { db } from '@/lib/db/client';
import { ScriptedLLM } from '@/lib/llm';
import { applyClassification } from '@/lib/agent/classify';
import { runAgent } from '@/lib/agent/run';
import { scripts } from '@/lib/agent/scripts';

const inputSchema = z.object({ invoiceId: z.string().min(1) }).strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 }); }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'invoiceId is required.' } }, { status: 400 });

  const { invoiceId } = parsed.data;
  const invoice = getInvoice(invoiceId, db);
  if (!invoice) return Response.json({ error: { code: 'INVOICE_NOT_FOUND', message: 'Invoice was not found.' } }, { status: 404 });
  const client = getClient(invoice.clientId, db);
  const script = client?.persona ? scripts[client.persona] : undefined;
  if (!client || !script || client.persona !== 'dana') {
    return Response.json({ error: { code: 'DEMO_FLOW_UNAVAILABLE', message: 'The guided demo currently supports Dana’s invoice.' } }, { status: 400 });
  }

  const replies = getMessages(invoiceId, db).filter((message) => message.direction === 'client_to_agent');
  const plans = listPlansByInvoiceId(invoiceId, db);
  const latestPlan = plans[0];
  let replyText: string | null = null;
  let turn: number;

  if (latestPlan?.status === 'ACTIVE') {
    return Response.json({ done: true, message: 'Dana’s plan is active. Simulate the deposit payment below to finish the walkthrough.' });
  } else if (latestPlan?.status === 'OFFERED') {
    replyText = script.clientReplies[1] ?? null;
    turn = 2;
  } else if (latestPlan?.status === 'ACCEPTED') {
    turn = 2;
  } else if (replies.length === 0 && !getMessages(invoiceId, db).some((message) => message.direction === 'agent_to_client')) {
    turn = 0;
  } else if (replies.length === 0) {
    replyText = script.clientReplies[0] ?? null;
    turn = 1;
  } else if (replies.length === 1 && !latestPlan) {
    turn = 1;
  } else {
    return Response.json({ done: true, message: 'No further scripted negotiation step is available.' });
  }

  if (replyText) {
    const classification = script.classifications[replies.length === 0 ? 0 : 1];
    if (!classification) return Response.json({ error: { code: 'DEMO_SCRIPT_INCOMPLETE', message: 'The scripted client reply has no classification.' } }, { status: 500 });
    insertMessage({ id: crypto.randomUUID(), invoiceId, direction: 'client_to_agent', body: replyText, createdAt: getNow().toISOString() }, db);
    applyClassification(invoiceId, classification, db);
  }

  try {
    const run = await runAgent(invoiceId, 'sim', { database: db, llm: new ScriptedLLM(client.persona, turn, invoice.planId) });
    return Response.json({ done: false, reply: replyText, run });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AGENT_RUN_FAILED';
    const status = code === 'AGENT_RUN_IN_PROGRESS' ? 409 : 500;
    return Response.json({ error: { code, message: code === 'AGENT_RUN_IN_PROGRESS' ? 'An agent run is already in progress.' : 'The demo step could not complete.' } }, { status });
  }
}
