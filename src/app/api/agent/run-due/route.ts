import { z } from 'zod';
import { runDueAgents } from '@/lib/agent/run';

const requestSchema = z.object({}).strict();

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  let parsedBody: unknown = {};
  if (raw.trim()) {
    try { parsedBody = JSON.parse(raw) as unknown; }
    catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 }); }
  }
  if (!requestSchema.safeParse(parsedBody).success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'This endpoint does not accept request fields.' } }, { status: 400 });
  }
  try {
    return Response.json(await runDueAgents());
  } catch {
    return Response.json({ error: { code: 'AGENT_RUN_FAILED', message: 'One or more due agent runs failed.' } }, { status: 500 });
  }
}
