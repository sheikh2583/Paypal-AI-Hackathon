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
    // Refresh on connect as events emitted during a reconnect are not replayed.
    events.onopen = refreshSoon;
    events.onmessage = refreshSoon;
    return () => {
      clearTimeout(refresh);
      events.close();
    };
  }, [router]);
  return null;
}
