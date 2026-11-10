import { after } from "next/server";
import { receivePayPalWebhook } from "@/lib/paypal/webhook";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return receivePayPalWebhook(request, after);
}
