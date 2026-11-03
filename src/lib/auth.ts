import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getDemoAuthEnv, type DemoAuthEnv } from "@/lib/env";

export const DEMO_SESSION_COOKIE = "chaser_demo_session";
export const DEMO_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

interface DemoSession {
  email: string;
  expiresAt: number;
}

type AuthGlobal = typeof globalThis & { __chaserDemoSessionSecret?: string };

function sessionSecret(config = getDemoAuthEnv()): string {
  if (config.sessionSecret) return config.sessionSecret;
  const root = globalThis as AuthGlobal;
  root.__chaserDemoSessionSecret ??= randomBytes(32).toString("base64url");
  return root.__chaserDemoSessionSecret;
}

function fixedTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function credentialsAreValid(email: string, password: string, config = getDemoAuthEnv()): boolean {
  return fixedTimeEqual(email.trim().toLowerCase(), config.email)
    && fixedTimeEqual(password, config.password);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createDemoSessionToken(
  email: string,
  secret: string,
  expiresAt = Math.floor(Date.now() / 1000) + DEMO_SESSION_MAX_AGE_SECONDS,
): string {
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), expiresAt } satisfies DemoSession)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyDemoSessionToken(
  token: string | undefined,
  secret: string,
  config: DemoAuthEnv = getDemoAuthEnv(),
  nowSeconds = Math.floor(Date.now() / 1000),
): DemoSession | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !fixedTimeEqual(signature, sign(payload, secret))) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const session = parsed as Partial<DemoSession>;
    if (typeof session.email !== "string" || session.email !== config.email) return null;
    if (typeof session.expiresAt !== "number" || session.expiresAt <= nowSeconds) return null;
    return { email: session.email, expiresAt: session.expiresAt };
  } catch {
    return null;
  }
}

export function demoSessionFromCookieHeader(cookieHeader: string | null, config = getDemoAuthEnv()): DemoSession | null {
  const prefix = `${DEMO_SESSION_COOKIE}=`;
  const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  return verifyDemoSessionToken(value, sessionSecret(config), config);
}

export async function getDemoSession(): Promise<DemoSession | null> {
  const cookieStore = await cookies();
  return verifyDemoSessionToken(cookieStore.get(DEMO_SESSION_COOKIE)?.value, sessionSecret(), getDemoAuthEnv());
}

export function demoSessionCookie(email: string, config = getDemoAuthEnv()): string {
  const token = createDemoSessionToken(email, sessionSecret(config));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DEMO_SESSION_COOKIE}=${token}; Path=/; Max-Age=${DEMO_SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearedDemoSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DEMO_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

export function isDemoRequestAuthenticated(request: Request): boolean {
  return demoSessionFromCookieHeader(request.headers.get("cookie")) !== null;
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to use the demo workspace." } }, { status: 401 });
}
