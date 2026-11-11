"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LiveUpdates() {
  const router = useRouter();
  useEffect(() => {
    const events = new EventSource("/api/events");
    let refresh: ReturnType<typeof setTimeout> | undefined;
    function refreshSoon() {
      clearTimeout(refresh);
      refresh = setTimeout(() => router.refresh(), 150);
    }
    events.onmessage = (message) => {
      refreshSoon();
      try {
        const event = JSON.parse(message.data) as { type?: string; invoiceId?: string };
        if (event.type === "invoice.paid" && event.invoiceId) {
          window.dispatchEvent(new CustomEvent("chaser:invoice-paid", { detail: { invoiceId: event.invoiceId } }));
        }
      } catch {
        // A malformed or non-JSON notification still triggers the regular server refresh.
      }
    };
    // Refresh on connect as events emitted during a reconnect are not replayed.
    events.onopen = refreshSoon;
    return () => {
      clearTimeout(refresh);
      events.close();
    };
  }, [router]);
  return null;
}
