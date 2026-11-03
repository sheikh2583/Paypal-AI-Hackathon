import { z } from 'zod';
import { getPayPalEnv } from '@/lib/env';
import { getNow } from '@/lib/clock';
import { db } from '@/lib/db/client';
import { seedDatabase } from '@/lib/db/seed';
import { isDemoRequestAuthenticated, unauthorizedResponse } from '@/lib/auth';

const inputSchema = z.object({}).strict();

export async function POST(request: Request): Promise<Response> {
  if (!isDemoRequestAuthenticated(request)) return unauthorizedResponse();
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 }); }
  if (!inputSchema.safeParse(body).success) return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'This endpoint does not accept fields.' } }, { status: 400 });
  if (getPayPalEnv().mode !== 'mock') return Response.json({ error: { code: 'MOCK_ONLY', message: 'Demo reset is only available in mock mode.' } }, { status: 409 });
  try {
    const invoices = await seedDatabase(db, { paypalMode: 'mock' }, getNow());
    return Response.json({ reset: true, invoiceCount: invoices.length });
  } catch {
    return Response.json({ error: { code: 'DEMO_RESET_FAILED', message: 'The demo data could not be reset.' } }, { status: 500 });
  }
}
