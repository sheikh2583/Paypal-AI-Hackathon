import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return (
    <section role="status" className="grid min-h-64 place-content-center justify-items-center gap-3 rounded-2xl border bg-card px-6 text-center">
      <LoaderCircle aria-hidden="true" className="size-7 text-primary motion-safe:animate-spin" />
      <h1 className="text-2xl font-semibold">Chaser is waking up</h1>
      <p className="text-sm text-muted-foreground">Getting your demo workspace ready. This can take about a minute after the hosted service has been idle.</p>
    </section>
  );
}
