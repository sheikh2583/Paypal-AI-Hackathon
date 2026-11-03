import { getAuthEnv, type AuthEnv } from "@/lib/env";

export interface AuthEmail {
  to: string;
  subject: string;
  heading: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
  footer?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function authEmailHtml(email: AuthEmail): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#16202a"><main style="max-width:560px;margin:36px auto;padding:32px;background:#fff;border:1px solid #e3e9ef;border-radius:18px"><p style="margin:0 0 22px;color:#155e75;font-weight:700">CHASER</p><h1 style="font-size:24px;margin:0 0 14px">${escapeHtml(email.heading)}</h1><p style="font-size:15px;line-height:1.6;color:#52606d">${escapeHtml(email.message)}</p><p style="margin:28px 0"><a href="${escapeHtml(email.actionUrl)}" style="display:inline-block;background:#075985;color:#fff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">${escapeHtml(email.actionLabel)}</a></p><p style="font-size:12px;line-height:1.6;color:#75818d">If you did not request this, you can ignore this message. ${escapeHtml(email.footer ?? "")}</p></main></body></html>`;
}

export async function sendAuthEmail(message: AuthEmail, config: AuthEnv = getAuthEnv()): Promise<void> {
  if (!config.resendApiKey || !config.emailFrom) {
    throw new Error("Email delivery is not configured (RESEND_API_KEY and AUTH_EMAIL_FROM are required).");
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [message.to],
        subject: message.subject,
        html: authEmailHtml(message),
        text: `${message.heading}\n\n${message.message}\n\n${message.actionLabel}: ${message.actionUrl}\n\nIf you did not request this, ignore this message.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Authentication email delivery failed before the provider responded.");
  }

  if (!response.ok) {
    // Do not include provider response bodies: they can contain addresses or account details.
    throw new Error(`Authentication email provider returned HTTP ${response.status}.`);
  }
}
