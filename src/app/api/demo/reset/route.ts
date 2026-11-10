import { z } from 'zod';
import { guardDemoRoute, resetDemo, withDemoMutation } from '@/lib/demo';

const inputSchema = z.object({}).strict();

export async function POST(request: Request): Promise<Response> {
  const denied = await guardDemoRoute();
  if (denied) return denied;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 }); }
  if (!inputSchema.safeParse(body).success) return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'This endpoint does not accept fields.' } }, { status: 400 });
  return withDemoMutation('reset', resetDemo);
}
