import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { getAuthEnv } from "@/lib/env";
import { sendAuthEmail } from "@/lib/auth-email";

const settings = getAuthEnv();
const buildOrLocalSecret = randomBytes(32).toString("base64url");

export const auth = betterAuth({
  appName: "Chaser",
  baseURL: settings.baseUrl,
  secret: settings.secret ?? buildOrLocalSecret,
  database: db.$client,
  trustedOrigins: [settings.baseUrl],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 14,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your Chaser password",
        heading: "Choose a new password",
        message: "We received a request to reset the password for your Chaser owner account.",
        actionLabel: "Reset password",
        actionUrl: url,
        footer: "This link expires automatically and can only be used once.",
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Verify your Chaser email",
        heading: "Verify your email address",
        message: "Confirm that this email belongs to you to activate your Chaser owner account.",
        actionLabel: "Verify email",
        actionUrl: url,
        footer: "If you did not create this account, ignore this message.",
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
  },
  advanced: {
    useSecureCookies: settings.baseUrl.startsWith("https://"),
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: settings.baseUrl.startsWith("https://"),
    },
  },
  plugins: [
    twoFactor({
      otpOptions: {
        async sendOTP({ user, otp }) {
          await sendAuthEmail({
            to: user.email,
            subject: "Your Chaser sign-in code",
            heading: "Confirm it’s you",
            message: `Your one-time sign-in code is ${otp}. It expires shortly and can only be used once.`,
            actionLabel: "Return to Chaser",
            actionUrl: `${settings.baseUrl}/login`,
          });
        },
      },
    }),
  ],
});

let authSchemaReady: Promise<void> | undefined;

/** Better Auth owns its auth tables and applies its migrations to the shared SQLite file. */
export function ensureAuthSchema(): Promise<void> {
  authSchemaReady ??= auth.$context.then(async (context) => {
    await context.runMigrations();
  });
  return authSchemaReady;
}

export function getAuthReadiness(): { ready: boolean; missing: string[] } {
  const required: Array<[keyof ReturnType<typeof getAuthEnv>, string]> = [
    ["ownerEmail", "AUTH_OWNER_EMAIL"],
    ["secret", "BETTER_AUTH_SECRET"],
    ["resendApiKey", "RESEND_API_KEY"],
    ["emailFrom", "AUTH_EMAIL_FROM"],
  ];
  const missing = required.filter(([key]) => !settings[key]).map(([, name]) => name);
  return { ready: missing.length === 0, missing };
}

export async function getOwnerAccountExists(): Promise<boolean> {
  await ensureAuthSchema();
  const row = db.$client.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number };
  return row.count > 0;
}

export async function getDemoSession() {
  if (!getAuthReadiness().ready) return null;
  await ensureAuthSchema();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if (session.user.email.toLowerCase() !== settings.ownerEmail) return null;
  if (!session.user.emailVerified || !session.user.twoFactorEnabled) return null;
  return session;
}

export async function isDemoRequestAuthenticated(): Promise<boolean> {
  return (await getDemoSession()) !== null;
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in and complete email verification to use the owner workspace." } }, { status: 401 });
}

export function authNotConfiguredResponse(): Response {
  const { missing } = getAuthReadiness();
  return Response.json({ error: { code: "AUTH_NOT_CONFIGURED", message: `Authentication needs configuration: ${missing.join(", ")}.` } }, { status: 503 });
}
