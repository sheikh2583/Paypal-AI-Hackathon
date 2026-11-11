import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { runAutopilot } from '@/lib/autopilot';
import { isDemoRequestAuthenticated, unauthorizedResponse } from '@/lib/auth';
import { getAppEnv } from '@/lib/env';

const requestSchema = z.object({}).strict();

/** A scheduler (GitHub Actions cron) authenticates with a shared secret header instead of a session. */
function isScheduledCall(request: Request): boolean {
  const expected = getAppEnv().cronSecret;
  const presented = request.headers.get('x-chaser-cron-secret');
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const scheduled = isScheduledCall(request);
  if (!scheduled && !(await isDemoRequestAuthenticated())) return unauthorizedResponse();
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
    const outcome = await runAutopilot(scheduled ? 'schedule' : 'manual');
    return Response.json({
      ran: outcome.ran,
      reason: outcome.reason,
      dueCount: outcome.dueCount,
      results: outcome.results,
      failed: outcome.failed,
    });
  } catch {
    return Response.json({ error: { code: 'AGENT_RUN_FAILED', message: 'One or more due agent runs failed.' } }, { status: 500 });
  }
}
