"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { shortPayPalId } from "@/lib/paypal/display";

export function PayPalCopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return <button type="button" onClick={copy} aria-label={`Copy PayPal invoice ID ${id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs hover:bg-secondary">
    <span className="truncate">{shortPayPalId(id)}</span>{copied ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : <Copy aria-hidden="true" className="size-3.5 shrink-0" />}
  </button>;
}
