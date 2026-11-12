import { z } from 'zod';
import { MAX_REPLY_CHARS, replyAsClient } from '@/lib/agent/reply';
import { clientOwnsInvoice, getClientSession } from '@/lib/client-access';

// A signed-in client answers Chaser about one of their own invoices (D77). The text is the same
// untrusted client input the agent already handles; policy and approvals apply unchanged.
const requestSchema = z.object({ invoiceId: z.string().min(1), text: z.string().trim().min(1).max(MAX_REPLY_CHARS) }).strict();

const errors: Record<string, { status: number; message: string }> = {
  LIVE_AI_REQUIRED: { status: 409, message: 'Replies need the live AI, which is switched off right now. Please try again later.' },
  INVOICE_NOT_FOUND: { status: 404, message: 'That invoice was not found.' },
  INVOICE_CLOSED: { status: 409, message: 'This invoice is already settled, so there is nothing left to discuss.' },
  REPLY_TOO_SOON: { status: 429, message: 'Give Chaser a few seconds to answer your last message first.' },
  AGENT_RUN_IN_PROGRESS: { status: 409, message: 'Chaser is still answering. Try again in a moment.' },
  AGENT_RUN_TIMEOUT: { status: 504, message: 'The AI took too long to answer. Try again in a moment.' },
};

export async function POST(request: Request): Promise<Response> {
  const session = await getClientSession();
  if (!session) return Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to reply.' } }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 }); }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: { code: 'VALIDATION_ERROR', message: `Write a reply of 1 to ${MAX_REPLY_CHARS} characters.` } }, { status: 400 });
  // Answer "not found" for someone else's invoice, so invoice IDs reveal nothing about other clients.
  if (!clientOwnsInvoice(session.clientId, parsed.data.invoiceId)) return Response.json({ error: { code: 'INVOICE_NOT_FOUND', message: errors.INVOICE_NOT_FOUND.message } }, { status: 404 });
  try {
    const result = await replyAsClient(parsed.data.invoiceId, parsed.data.text);
    // Clients see what Chaser said and did, not the internal classification.
    return Response.json({ ok: true, summary: result.run.summary });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'REPLY_FAILED';
    if (/^LLM_/.test(code)) return Response.json({ ok: true, partial: true, summary: 'Chaser received your message. Its answer is in the conversation below.' });
    const known = errors[code] ?? { status: 500, message: 'Your message could not be sent. Please try again.' };
    return Response.json({ error: { code: errors[code] ? code : 'REPLY_FAILED', message: known.message } }, { status: known.status });
  }
}
