import { toNextJsHandler } from "better-auth/next-js";
import { auth, authNotConfiguredResponse, ensureAuthSchema, getAuthReadiness, getOwnerAccountExists } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { getAuthEnv } from "@/lib/env";
import { consumeEmailVerificationToken, resetPasswordIdentifier } from "@/lib/auth-tokens";
import { isDemoClientEmail } from "@/lib/demo-accounts";

const handlers = toNextJsHandler(auth);

const CLIENT_LOCKED_ENDPOINTS = new Set([
  "/change-password", "/change-email", "/update-user", "/delete-user",
  "/revoke-session", "/revoke-sessions", "/revoke-other-sessions",
  "/link-social", "/unlink-account",
  "/two-factor/enable", "/two-factor/disable", "/two-factor/generate-backup-codes",
]);

export async function GET(request: Request): Promise<Response> {
  await ensureAuthSchema();
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/verify-email") {
    const token = url.searchParams.get("token");
    if (!token || !consumeEmailVerificationToken(db.$client, token)) {
      return Response.json({ error: { code: "INVALID_VERIFICATION_LINK", message: "This verification link is invalid, expired, or already used. Request a new one." } }, { status: 400 });
    }
  }
  return handlers.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  await ensureAuthSchema();
  if (!getAuthReadiness().ready) return authNotConfiguredResponse();

  const url = new URL(request.url);
  // Client accounts, including the published demo one, are managed by the owner (D77, D78).
  // Blocking these stops one visitor from changing the demo password or ending other visitors' sessions.
  if (CLIENT_LOCKED_ENDPOINTS.has(url.pathname.replace(/^\/api\/auth/, ""))) {
    const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
    if (session && session.user.email.toLowerCase() !== getAuthEnv().ownerEmail) {
      return Response.json({ error: { code: "CLIENT_ACCOUNT_LOCKED", message: "Client accounts are managed by the business owner." } }, { status: 403 });
    }
  }
  if (url.pathname === "/api/auth/request-password-reset") {
    const body = await request.clone().json().catch(() => null) as { email?: unknown } | null;
    if (typeof body?.email === "string" && isDemoClientEmail(body.email)) {
      return Response.json({ error: { code: "CLIENT_ACCOUNT_LOCKED", message: "The demo account's password can't be reset." } }, { status: 403 });
    }
  }
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

  if (url.pathname === "/api/auth/reset-password") {
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
    }
    if (typeof body === "object" && body !== null && "token" in body && typeof body.token === "string") {
      body.token = resetPasswordIdentifier(body.token).slice("reset-password:".length);
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      return handlers.POST(new Request(request, { headers, body: JSON.stringify(body) }));
    }
  }

  return handlers.POST(request);
}
