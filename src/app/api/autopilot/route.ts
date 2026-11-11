import { z } from "zod";
import { getAutopilotStatus, setAutopilotEnabled } from "@/lib/autopilot";
import { isDemoRequestAuthenticated, unauthorizedResponse } from "@/lib/auth";

const bodySchema = z.object({ enabled: z.boolean() }).strict();

export async function GET(): Promise<Response> {
  if (!(await isDemoRequestAuthenticated())) return unauthorizedResponse();
  return Response.json(getAutopilotStatus());
}

export async function POST(request: Request): Promise<Response> {
  if (!(await isDemoRequestAuthenticated())) return unauthorizedResponse();
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "enabled must be true or false." } }, { status: 400 });
  setAutopilotEnabled(parsed.data.enabled);
  return Response.json(getAutopilotStatus());
}
