import { z } from "zod";
import { credentialsAreValid, demoSessionCookie } from "@/lib/auth";
import { getDemoAuthEnv } from "@/lib/env";

const inputSchema = z.object({ email: z.email(), password: z.string().min(1).max(256) }).strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "Enter your demo email and password." } }, { status: 400 });
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email and password." } }, { status: 400 });
  }

  const config = getDemoAuthEnv();
  if (!credentialsAreValid(parsed.data.email, parsed.data.password, config)) {
    return Response.json({ error: { code: "INVALID_CREDENTIALS", message: "That email and password do not match the demo account." } }, { status: 401 });
  }

  return Response.json({ ok: true }, {
    headers: {
      "Set-Cookie": demoSessionCookie(config.email, config),
      "Cache-Control": "no-store",
    },
  });
}
