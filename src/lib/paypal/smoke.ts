// pnpm paypal:smoke
// Exercises the PayPal client (real or mock) end-to-end.
// Output is redacted: no secrets, masked emails.
// Run with: $env:PAYPAL_MODE="mock"; pnpm paypal:smoke   (mock mode)
//           $env:PAYPAL_MODE="sandbox"; pnpm paypal:smoke (sandbox mode)
import { getPayPalEnv } from "../env";
import { getPayPal } from "./index";

// Ensure the DB is set up for mock mode (kv table must exist).
// For sandbox mode we don't need the DB.

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***@***";
  return `${user.slice(0, 2)}***@${domain}`;
}

async function main() {
  const env = getPayPalEnv();
  console.log(`\n=== Chaser PayPal Smoke Test ===`);
  console.log(`Mode: ${env.mode}`);
  console.log(`Base URL: ${env.baseUrl}`);

  if (env.mode === "sandbox") {
    if (!env.clientId || !env.clientSecret) {
      console.error("ERROR: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required for sandbox mode.");
      process.exit(1);
    }
    if (!env.buyerEmail) {
      console.error("ERROR: PAYPAL_SANDBOX_BUYER_EMAIL is required for sandbox mode.");
      process.exit(1);
    }
    console.log(`Buyer email: ${maskEmail(env.buyerEmail)}`);
    if (env.merchantEmail) {
      console.log(`Merchant email: ${maskEmail(env.merchantEmail)}`);
    }
  }

  const client = getPayPal();
  const requestId = `smoke-${Date.now()}`;
  const buyerEmail = env.buyerEmail ?? "buyer@example.com";
  const number = `SMOKE-${Date.now()}`;

  console.log("\n[1] Creating invoice...");
  const created = await client.createInvoice({
    requestId,
    clientName: "Smoke Test Client",
    clientEmail: buyerEmail,
    number,
    description: "Smoke test invoice",
    amountCents: 1000, // $10.00
    dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });
  console.log(`  Created: ${created.paypalInvoiceId} | Number: ${created.number} | Status: ${created.status}`);

  console.log("\n[2] Sending invoice...");
  await client.sendInvoice(created.paypalInvoiceId);

  console.log("\n[3] Getting invoice...");
  const fetched = await client.getInvoice(created.paypalInvoiceId);
  console.log(`  Status: ${fetched.status}`);
  console.log(`  Amount: $${fetched.amountCents / 100}`);
  console.log(`  recipientViewUrl: ${fetched.recipientViewUrl ?? "(not available yet)"}`);

  if (env.mode === "mock") {
    console.log("\n[4] Simulating payment (mock only)...");
    await client.simulatePayment!(created.paypalInvoiceId);
    const paid = await client.getInvoice(created.paypalInvoiceId);
    console.log(`  Status after payment: ${paid.status} | Paid: $${paid.paidCents / 100}`);
  }

  console.log("\n✓ Smoke test passed.");

  if (fetched.recipientViewUrl) {
    console.log(`\nOpen in browser to test the pay flow:\n  ${fetched.recipientViewUrl}`);
  }
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});

