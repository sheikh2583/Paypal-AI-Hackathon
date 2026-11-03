import { z } from 'zod';
import { runAgent } from '@/lib/agent/run';
import { isDemoRequestAuthenticated, unauthorizedResponse } from '@/lib/auth';

const requestSchema = z.object({ invoiceId: z.string().min(1) });

export async function POST(request: Request): Promise<Response> {
  if (!isDemoRequestAuthenticated(request)) return unauthorizedResponse();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'invoiceId is required.' } }, { status: 400 });
  }
  try {
    return Response.json(await runAgent(parsed.data.invoiceId, 'manual'));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AGENT_RUN_FAILED';
    const status = code === 'AGENT_RUN_IN_PROGRESS' ? 409 : code === 'INVOICE_NOT_FOUND' ? 404 : code === 'AGENT_RUN_TIMEOUT' ? 504 : 500;
    return Response.json({ error: { code, message: code === 'AGENT_RUN_IN_PROGRESS' ? 'An agent run is already in progress for this invoice.' : code === 'INVOICE_NOT_FOUND' ? 'Invoice was not found.' : code === 'AGENT_RUN_TIMEOUT' ? 'Agent run exceeded its time limit.' : 'Agent run failed.' } }, { status });
  }
}
