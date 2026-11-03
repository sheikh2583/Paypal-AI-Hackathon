// Zod-validated environment. Every variable in .env.example is covered here
// (env.test.ts enforces that). Nothing is parsed at import time: each getter
// validates only its own group, so e.g. the UI shell never needs PayPal keys.
import { z } from "zod";

/** Anything shaped like process.env; lets tests pass plain objects. */
export type EnvSource = Record<string, string | undefined>;

// .env.example ships blank values ("DEMO_NOW="); treat blank as "unset" so
// defaults apply.
const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const appSchema = z.object({
  APP_BASE_URL: z.preprocess(blankToUndefined, z.url().default("http://localhost:3000")),
  DATABASE_PATH: z.preprocess(blankToUndefined, z.string().default("./data/chaser.db")),
  DEMO_NOW: z.preprocess(
    blankToUndefined,
    z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date or datetime")
      .optional(),
  ),
});

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

const llmSchema = z.object({
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.preprocess(blankToUndefined, z.string().default("claude-sonnet-5-5")),
  LLM_PROVIDER: z.preprocess(blankToUndefined, z.enum(["anthropic", "openai-compatible"]).optional()),
  LLM_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
  LLM_API_KEY: optionalString,
  LLM_MODEL: z.preprocess(blankToUndefined, z.string().optional()),
  LLM_MAX_HISTORY: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).default(20)),
  LLM_MODE: z.preprocess(blankToUndefined, z.enum(["auto", "live", "scripted"]).default("auto")),
});

// ---------------------------------------------------------------------------
// PayPal (Sandbox only — hard rule 3)
// ---------------------------------------------------------------------------

const paypalSchema = z
  .object({
    PAYPAL_MODE: z.preprocess(blankToUndefined, z.enum(["mock", "sandbox"]).default("mock")),
    PAYPAL_BASE_URL: z.preprocess(
      blankToUndefined,
      z
        .url()
        .default(SANDBOX_BASE_URL)
        // Refuse anything that is not a sandbox host so a live URL can never be configured.
        .refine((u) => new URL(u).hostname.includes("sandbox"), "must be a PayPal Sandbox URL"),
    ),
    PAYPAL_CLIENT_ID: optionalString,
    PAYPAL_CLIENT_SECRET: optionalString,
    PAYPAL_WEBHOOK_ID: optionalString,
    PAYPAL_SANDBOX_MERCHANT_EMAIL: optionalString,
    PAYPAL_SANDBOX_BUYER_EMAIL: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.PAYPAL_MODE !== "sandbox") return;
    for (const key of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "required when PAYPAL_MODE=sandbox",
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Single-owner authentication and transactional email
// ---------------------------------------------------------------------------

const authSchema = z.object({
  AUTH_OWNER_EMAIL: z.preprocess(blankToUndefined, z.email().optional()),
  BETTER_AUTH_URL: z.preprocess(blankToUndefined, z.url().default("http://localhost:3000")),
  BETTER_AUTH_SECRET: z.preprocess(blankToUndefined, z.string().min(32).optional()),
  RESEND_API_KEY: optionalString,
  AUTH_EMAIL_FROM: optionalString,
});

/** Every variable the app reads. env.test.ts checks this against .env.example. */
export const ENV_KEYS: readonly string[] = [
  ...Object.keys(appSchema.shape),
  ...Object.keys(llmSchema.shape),
  ...Object.keys(paypalSchema.shape),
  ...Object.keys(authSchema.shape),
];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EnvError extends Error {
  constructor(public readonly issues: { key: string; message: string }[]) {
    // Variable names and reasons only — never values, which may be secrets.
    super(
      `Invalid environment: ${issues.map((i) => `${i.key} (${i.message})`).join("; ")}`,
    );
    this.name = "EnvError";
  }
}

function parseGroup<S extends z.ZodType>(schema: S, source: EnvSource): z.output<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => ({ key: String(i.path[0] ?? "(env)"), message: i.message })),
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Typed getters
// ---------------------------------------------------------------------------

export interface AppEnv {
  appBaseUrl: string;
  databasePath: string;
  /** Pinned "today" for the demo, if set. Consumed by src/lib/clock.ts. */
  demoNow: string | undefined;
}

export function getAppEnv(source: EnvSource = process.env): AppEnv {
  const e = parseGroup(appSchema, source);
  return {
    appBaseUrl: e.APP_BASE_URL,
    databasePath: e.DATABASE_PATH,
    demoNow: e.DEMO_NOW,
  };
}

export type ResolvedLlmMode = "live" | "scripted";

export interface LlmEnv {
  provider: "anthropic" | "openai-compatible";
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string;
  maxHistory: number;
  /** What was configured: auto | live | scripted. */
  configuredMode: "auto" | "live" | "scripted";
  /** What will actually run. auto → scripted without an API key, live with one. */
  mode: ResolvedLlmMode;
}

export function getLlmEnv(source: EnvSource = process.env): LlmEnv {
  const e = parseGroup(llmSchema, source);
  const provider = e.LLM_PROVIDER ?? (e.LLM_API_KEY ? "openai-compatible" : "anthropic");
  const apiKey = provider === "anthropic" ? e.ANTHROPIC_API_KEY : e.LLM_API_KEY;
  const hasKey = Boolean(apiKey);
  if (e.LLM_MODE === "live" && !hasKey) {
    throw new EnvError([
      { key: provider === "anthropic" ? "ANTHROPIC_API_KEY" : "LLM_API_KEY", message: "required when LLM_MODE=live" },
    ]);
  }
  const mode: ResolvedLlmMode =
    e.LLM_MODE === "auto" ? (hasKey ? "live" : "scripted") : e.LLM_MODE;
  if (mode === "live" && provider === "openai-compatible" && !e.LLM_BASE_URL) {
    throw new EnvError([{ key: "LLM_BASE_URL", message: "required for openai-compatible provider" }]);
  }
  if (mode === "live" && provider === "openai-compatible" && !e.LLM_MODEL) {
    throw new EnvError([{ key: "LLM_MODEL", message: "required for openai-compatible provider" }]);
  }
  return {
    provider,
    baseUrl: e.LLM_BASE_URL,
    apiKey,
    model: provider === "anthropic" ? e.ANTHROPIC_MODEL : (e.LLM_MODEL ?? ""),
    maxHistory: e.LLM_MAX_HISTORY,
    configuredMode: e.LLM_MODE,
    mode,
  };
}

export interface PayPalEnv {
  mode: "mock" | "sandbox";
  baseUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  webhookId: string | undefined;
  merchantEmail: string | undefined;
  buyerEmail: string | undefined;
}

export function getPayPalEnv(source: EnvSource = process.env): PayPalEnv {
  const e = parseGroup(paypalSchema, source);
  return {
    mode: e.PAYPAL_MODE,
    baseUrl: e.PAYPAL_BASE_URL,
    clientId: e.PAYPAL_CLIENT_ID,
    clientSecret: e.PAYPAL_CLIENT_SECRET,
    webhookId: e.PAYPAL_WEBHOOK_ID,
    merchantEmail: e.PAYPAL_SANDBOX_MERCHANT_EMAIL,
    buyerEmail: e.PAYPAL_SANDBOX_BUYER_EMAIL,
  };
}

export interface AuthEnv {
  ownerEmail: string | undefined;
  baseUrl: string;
  secret: string | undefined;
  resendApiKey: string | undefined;
  emailFrom: string | undefined;
}

export function getAuthEnv(source: EnvSource = process.env): AuthEnv {
  const e = parseGroup(authSchema, source);
  return {
    ownerEmail: e.AUTH_OWNER_EMAIL?.toLowerCase(),
    baseUrl: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    resendApiKey: e.RESEND_API_KEY,
    emailFrom: e.AUTH_EMAIL_FROM,
  };
}
