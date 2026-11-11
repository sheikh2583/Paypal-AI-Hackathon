import { z } from 'zod';
import { MAX_REPLY_CHARS, replyAsClient } from '@/lib/agent/reply';
import { isDemoRequestAuthenticated, unauthorizedResponse } from '@/lib/auth';

const requestSchema = z.object({ invoiceId: z.string().min(1), text: z.string().trim().min(1).max(MAX_REPLY_CHARS) }).strict();

const errors: Record<string, { status: number; message: string }> = {
  LIVE_AI_REQUIRED: { status: 409, message: 'Free-text replies need a live AI provider. This deployment runs the guided demo.' },
  INVOICE_NOT_FOUND: { status: 404, message: 'Invoice was not found.' },
  INVOICE_CLOSED: { status: 409, message: 'This invoice is closed, so there is nothing left to negotiate.' },
  REPLY_TOO_SOON: { status: 429, message: 'Give Chaser a few seconds to answer the last message first.' },
  AGENT_RUN_IN_PROGRESS: { status: 409, message: 'Chaser is still working on this invoice.' },
  AGENT_RUN_TIMEOUT: { status: 504, message: 'The AI provider took too long. Try again in a moment.' },
};

export async function POST(request: Request): Promise<Response> {
  if (!(await isDemoRequestAuthenticated())) return unauthorizedResponse();
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 }); }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: { code: 'VALIDATION_ERROR', message: `invoiceId and a reply of 1 to ${MAX_REPLY_CHARS} characters are required.` } }, { status: 400 });
  try {
    return Response.json(await replyAsClient(parsed.data.invoiceId, parsed.data.text));
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'REPLY_FAILED';
    // The agent's tool calls are already audited; a provider failure on the final model turn
    // leaves the conversation and approvals up to date, so report it as partial rather than failed.
    if (/^LLM_(HTTP_\d+|TIMEOUT|NETWORK_ERROR|INVALID_RESPONSE|REQUEST_FAILED)$/.test(raw)) {
      return Response.json({ partial: true, code: raw, message: 'Chaser acted on the reply, but the AI provider dropped its final confirmation. The conversation below is up to date.' });
    }
    const code = errors[raw] ? raw : 'REPLY_FAILED';
    const known = errors[code] ?? { status: 500, message: 'Chaser could not process that reply.' };
    if (code === 'REPLY_FAILED') console.warn(`[reply] unexpected failure: ${raw.replace(/[^A-Z0-9_]/gi, '').slice(0, 40)}`);
    return Response.json({ error: { code, message: known.message } }, { status: known.status });
  }
}
