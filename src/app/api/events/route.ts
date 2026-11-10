import { isDemoRequestAuthenticated, unauthorizedResponse } from "@/lib/auth";
import { subscribe } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await isDemoRequestAuthenticated())) return unauthorizedResponse();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      function close() {
        if (closed) return;
        cleanup();
        controller.close();
      }
      function send(frame: string) {
        if (closed) return;
        if ((controller.desiredSize ?? 0) <= 0) return close();
        controller.enqueue(encoder.encode(frame));
      }
      const unsubscribe = subscribe((event) => send(`data: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), 15_000);
      heartbeat.unref();
      cleanup = () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
      };
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) close();
      else send("retry: 3000\n: connected\n\n");
    },
    cancel() { cleanup(); },
  }, { highWaterMark: 32 });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
