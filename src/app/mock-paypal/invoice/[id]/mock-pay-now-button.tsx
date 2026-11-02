"use client";
import { useState } from "react";

export default function MockPayNowButton({ paypalInvoiceId }: { paypalInvoiceId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "paid" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handlePay() {
    setState("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/mock-paypal/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paypalInvoiceId }),
      });
      const data = (await res.json()) as { error?: { code: string; message: string } };
      if (!res.ok) {
        setErrorMsg(data.error?.message ?? `Error ${res.status}`);
        setState("error");
        return;
      }
      setState("paid");
    } catch {
      setErrorMsg("Network error — please try again.");
      setState("error");
    }
  }

  if (state === "paid") {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-center">
        <p className="font-semibold text-green-700">✓ Payment recorded! You can close this page.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => void handlePay()}
        disabled={state === "loading"}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === "loading" ? "Processing…" : "Pay now (sandbox mock)"}
      </button>
      {state === "error" && (
        <p className="text-center text-sm text-red-600">{errorMsg}</p>
      )}
    </div>
  );
}

