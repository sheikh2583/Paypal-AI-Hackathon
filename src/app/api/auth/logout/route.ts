import { clearedDemoSessionCookie } from "@/lib/auth";

export async function POST(): Promise<Response> {
  return Response.json({ ok: true }, {
    headers: {
      "Set-Cookie": clearedDemoSessionCookie(),
      "Cache-Control": "no-store",
    },
  });
}
