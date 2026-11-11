"use client";

import { useEffect, useState } from "react";

type PaidNotice = { invoiceId: string };

export function PayPalPaidToast({ invoiceId }: { invoiceId: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    function onPaid(event: Event) {
      const detail = (event as CustomEvent<PaidNotice>).detail;
      if (detail?.invoiceId !== invoiceId) return;
      setVisible(true);
      window.setTimeout(() => setVisible(false), 5000);
    }
    window.addEventListener("chaser:invoice-paid", onPaid);
    return () => window.removeEventListener("chaser:invoice-paid", onPaid);
  }, [invoiceId]);
  if (!visible) return null;
  return <p role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-emerald-800 shadow-lg">PayPal payment recorded. Invoice details updated.</p>;
}
