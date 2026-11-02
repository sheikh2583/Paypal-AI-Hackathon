// OAuth2 client-credentials token fetch with in-memory cache.
// Refreshes ~60 seconds before expiry. Never logs tokens or secrets.
import type { PayPalEnv } from "../env";

interface TokenCache {
  token: string;
  expiresAt: number; // ms since epoch
}

// Module-level cache; one entry per base URL (supports test overrides).
const cache = new Map<string, TokenCache>();

// Exported only for tests that need to clear the cache between runs.
export function clearTokenCache(): void {
  cache.clear();
}

async function fetchToken(env: PayPalEnv): Promise<TokenCache> {
  const credentials = Buffer.from(
    `${env.clientId}:${env.clientSecret}`,
  ).toString("base64");

  const response = await fetch(`${env.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Accept-Language": "en_US",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // Never include the body verbatim (may contain secrets/keys).
    throw new Error(`PayPal token request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("PayPal token response missing access_token");
  }

  const expiresInMs = ((data.expires_in ?? 32400) - 60) * 1000; // refresh 60s early
  return {
    token: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };
}

/**
 * Returns a valid Bearer token, fetching a new one only when the cached
 * token is missing or within 60 seconds of expiry.
 * Never logs the token value.
 */
export async function getAccessToken(env: PayPalEnv): Promise<string> {
  const cached = cache.get(env.baseUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  const fresh = await fetchToken(env);
  cache.set(env.baseUrl, fresh);
  return fresh.token;
}

