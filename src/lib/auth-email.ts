import { getAuthEnv, type AuthEnv } from "@/lib/env";
import { Resend } from "resend";

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
  if (!config.resendApiKey || !config.resendFrom) {
    throw new Error("Email delivery is not configured (RESEND_API_KEY and RESEND_FROM are required).");
  }

  let actionUrl: URL;
  try {
    actionUrl = new URL(message.actionUrl);
    if (actionUrl.origin !== new URL(config.baseUrl).origin) throw new Error();
  } catch {
    throw new Error("Authentication email link must use the configured application origin.");
  }

  const resend = new Resend(config.resendApiKey);
  try {
    const { error } = await resend.emails.send({
      from: config.resendFrom,
      to: [message.to],
      subject: message.subject,
      html: authEmailHtml({ ...message, actionUrl: actionUrl.toString() }),
      text: `${message.heading}\n\n${message.message}\n\n${message.actionLabel}: ${actionUrl.toString()}\n\nIf you did not request this, ignore this message.`,
    });
    if (error) throw new Error("provider rejected the email request");
  } catch {
    // Deliberately discard SDK errors; they may contain addresses or provider details.
    throw new Error("Authentication email provider rejected the request.");
  }
}
