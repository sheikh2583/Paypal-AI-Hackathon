import { z } from "zod";
import { advanceDemoTime, demoError, guardDemoRoute } from "@/lib/demo";

const inputSchema = z.strictObject({ days: z.int().min(1).max(365) });

export async function POST(request: Request): Promise<Response> {
  const denied = await guardDemoRoute();
  if (denied) return denied;
  const parsed = inputSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return demoError(400, "VALIDATION_ERROR", "Days must be a whole number from 1 to 365.");
  try {
    const result = await advanceDemoTime(parsed.data.days);
    return Response.json({ ...result, message: `Advanced demo time by ${parsed.data.days} days.` });
  } catch {
    return demoError(500, "ADVANCE_TIME_FAILED", "Could not advance demo time.");
  }
}
