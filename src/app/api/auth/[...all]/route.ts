import { toNextJsHandler } from "better-auth/next-js";
import { auth, authNotConfiguredResponse, ensureAuthSchema, getAuthReadiness, getOwnerAccountExists } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { getAuthEnv } from "@/lib/env";

const handlers = toNextJsHandler(auth);

export async function GET(request: Request): Promise<Response> {
  await ensureAuthSchema();
  return handlers.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  await ensureAuthSchema();
  if (!getAuthReadiness().ready) return authNotConfiguredResponse();

  const url = new URL(request.url);
  if (url.pathname === "/api/auth/sign-up/email") {
    const authEnv = getAuthEnv();
    if (await getOwnerAccountExists()) {
      return Response.json({ error: { code: "OWNER_ALREADY_CREATED", message: "The single owner account has already been created." } }, { status: 403 });
    }

    let payload: unknown;
    try {
      payload = await request.clone().json();
    } catch {
      return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
    }
    const email = typeof payload === "object" && payload !== null && "email" in payload && typeof payload.email === "string"
      ? payload.email.trim().toLowerCase()
      : "";
    if (!authEnv.ownerEmail || email !== authEnv.ownerEmail) {
      return Response.json({ error: { code: "OWNER_EMAIL_REQUIRED", message: "Set up only the configured owner email address." } }, { status: 403 });
    }

    const response = await handlers.POST(request);
    if (response.ok) {
      // Enable email OTP before the owner can complete sign-in; no first-factor-only session is issued.
      db.$client.prepare('UPDATE "user" SET "twoFactorEnabled" = 1 WHERE lower(email) = ?').run(authEnv.ownerEmail);
    }
    return response;
  }

  return handlers.POST(request);
}
