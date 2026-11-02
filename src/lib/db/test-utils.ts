import { openDb, type AppDb } from "./client";

/** Test-only in-memory schema; tests must never use the app's ./data database. */
export function createTestDb(): AppDb {
  const database = openDb(":memory:");
  database.$client.exec(`
    CREATE TABLE owner_policy (
      id text PRIMARY KEY, min_deposit_percent integer NOT NULL, max_installments integer NOT NULL,
      max_plan_days integer NOT NULL, max_discount_percent integer NOT NULL,
      auto_approve_below_cents integer NOT NULL, tone text NOT NULL,
      business_name text NOT NULL, owner_name text NOT NULL,
      updated_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE clients (
      id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, persona text,
      late_count integer NOT NULL DEFAULT 0, avg_days_late real NOT NULL DEFAULT 0,
      responsiveness text NOT NULL, notes text
    );
    CREATE TABLE invoices (
      id text PRIMARY KEY, paypal_invoice_id text, paypal_invoice_url text,
      client_id text NOT NULL REFERENCES clients(id), number text NOT NULL UNIQUE,
      description text NOT NULL, amount_cents integer NOT NULL, paid_cents integer NOT NULL DEFAULT 0,
      currency text NOT NULL DEFAULT 'USD', issued_at text NOT NULL, due_at text NOT NULL,
      status text NOT NULL, parent_invoice_id text REFERENCES invoices(id), plan_id text,
      installment_no integer, chase_state text NOT NULL DEFAULT 'NEW', risk_score integer,
      risk_factors text NOT NULL DEFAULT '[]', risk_explanation text, last_agent_run_at text,
      next_followup_at text
    );
    CREATE TABLE plans (
      id text PRIMARY KEY, invoice_id text NOT NULL REFERENCES invoices(id), status text NOT NULL,
      discount_percent integer NOT NULL, total_cents integer NOT NULL, installments_json text NOT NULL,
      created_by text NOT NULL, approved_by text, created_at text NOT NULL
    );
    CREATE TABLE messages (
      id text PRIMARY KEY, invoice_id text NOT NULL REFERENCES invoices(id), direction text NOT NULL,
      body text NOT NULL, created_at text NOT NULL
    );
    CREATE TABLE approvals (
      id text PRIMARY KEY, invoice_id text NOT NULL REFERENCES invoices(id),
      plan_id text REFERENCES plans(id), kind text NOT NULL, reason text NOT NULL,
      recommendation text NOT NULL, status text NOT NULL DEFAULT 'PENDING', owner_response text,
      created_at text NOT NULL, resolved_at text
    );
    CREATE TABLE audit_log (
      id text PRIMARY KEY, at text NOT NULL, actor text NOT NULL, action text NOT NULL,
      invoice_id text, input_json text NOT NULL, result_json text NOT NULL, ok integer NOT NULL
    );
    CREATE TABLE webhook_events (
      id text PRIMARY KEY, event_type text NOT NULL, payload_json text NOT NULL,
      received_at text NOT NULL, processed_at text
    );
    CREATE TABLE mock_paypal_invoices (
      id text PRIMARY KEY, number text NOT NULL UNIQUE, amount_cents integer NOT NULL,
      paid_cents integer NOT NULL DEFAULT 0, status text NOT NULL,
      recipient_view_url text NOT NULL, created_at text NOT NULL
    );
    CREATE TABLE kv (key text PRIMARY KEY, value text NOT NULL);
  `);
  return database;
}

export function closeTestDb(database: AppDb): void {
  database.$client.close();
}
