import type {
  ClientReliability, ReliabilityClient, ReliabilityEvent, ReliabilityInvoice,
} from "./types";

const DAY_MS = 86_400_000;
const WEIGHTS = { timeliness: 40, planAdherence: 25, behaviour: 20, exposure: 15 };
const OPEN = new Set(["SENT", "OVERDUE", "PARTIALLY_PAID"]);

function utcDay(value: string | Date): number {
  return Math.floor((typeof value === "string" ? Date.parse(value) : value.getTime()) / DAY_MS);
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  return groups;
}

function timingStats(samples: number[]) {
  const onTime = samples.filter((days) => days === 0).length;
  const late = samples.filter((days) => days > 0);
  return {
    onTime,
    avgDaysLate: late.length
      ? late.reduce((sum, days) => sum + days, 0) / late.length
      : samples.length ? 0 : null,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Scores current obligations as of the supplied clock, with no external dependencies. */
export function computeReliability(
  clients: readonly ReliabilityClient[],
  invoices: readonly ReliabilityInvoice[],
  installments: readonly ReliabilityInvoice[],
  events: readonly ReliabilityEvent[],
  now: Date,
): ClientReliability[] {
  const today = utcDay(now);
  const eventsByInvoice = groupBy(events, (event) => event.invoiceId);
  const clientIds = new Set(clients.map((client) => client.id));
  const installmentIds = new Set(installments.map((invoice) => invoice.id));
  const obligations = [...invoices.filter((invoice) => !installmentIds.has(invoice.id)), ...installments]
    .filter((invoice) => clientIds.has(invoice.clientId) && (invoice.status === "PAID" || OPEN.has(invoice.status)))
    .map((invoice) => {
      const due = utcDay(invoice.dueAt);
      const settled = invoice.status === "PAID";
      const remaining = settled ? 0 : Math.max(0, invoice.amountCents - invoice.paidCents);
      const overdue = remaining > 0 && due < today;
      const evidence = eventsByInvoice.get(invoice.id) ?? [];
      const observed = evidence.reduce((latest, event) => {
        const at = Date.parse(event.at);
        return event.kind === "payment_observed" && at <= now.getTime() ? Math.max(latest, at) : latest;
      }, -Infinity);
      const lateDays = settled && Number.isFinite(observed) && Number.isFinite(due)
        ? Math.max(0, utcDay(new Date(observed)) - due)
        : overdue ? today - due : null;
      return { invoice, settled, remaining, overdue, due, lateDays };
    });
  const totalOverdue = obligations.reduce((sum, row) => sum + (row.overdue ? row.remaining : 0), 0);
  const byClient = groupBy(obligations, (row) => row.invoice.clientId);

  // Keep recorded discount requests on superseded or cancelled invoices attributable to the client.
  const discounts = new Set(events.filter((event) =>
    event.kind === "discount_escalation" && Date.parse(event.at) <= now.getTime(),
  ).map((event) => event.invoiceId));
  const allByClient = groupBy([...invoices, ...installments], (invoice) => invoice.clientId);

  const results = clients.map((client): ClientReliability => {
    const rows = byClient.get(client.id) ?? [];
    const eligible = rows.some((row) => row.settled || (row.remaining > 0 && row.due <= today));
    const outstandingCents = rows.reduce((sum, row) => sum + row.remaining, 0);
    const overdueCents = rows.reduce((sum, row) => sum + (row.overdue ? row.remaining : 0), 0);
    const timing = rows.flatMap(({ lateDays }) => lateDays === null ? [] : [lateDays]);
    const planTiming = rows.flatMap(({ invoice, lateDays }) =>
      installmentIds.has(invoice.id) && lateDays !== null ? [lateDays] : []);
    const { onTime, avgDaysLate } = timingStats(timing);
    const onTimeInstallments = planTiming.filter((days) => days === 0).length;
    const severity = timing.reduce((sum, days) => sum + Math.min(days, 30), 0);
    const discountCount = new Set((allByClient.get(client.id) ?? [])
      .filter(({ id }) => discounts.has(id)).map(({ id }) => id)).size;
    const share = totalOverdue === 0 ? 0 : overdueCents / totalOverdue;
    const breakdown = {
      timeliness: {
        points: timing.length ? 20 * (onTime / timing.length + 1 - severity / (30 * timing.length)) : null,
        weight: WEIGHTS.timeliness,
        explanation: timing.length ? `${onTime} of ${timing.length} timed obligations on time. Longer delays cost more, up to 30 days per obligation.` : "No dated payments or overdue balances to assess.",
      },
      planAdherence: {
        points: planTiming.length ? WEIGHTS.planAdherence * onTimeInstallments / planTiming.length : null,
        weight: WEIGHTS.planAdherence,
        explanation: planTiming.length ? `${onTimeInstallments} of ${planTiming.length} assessable installments paid by the due date. Unpaid overdue installments count as late.` : "No installments with a recorded payment date or an overdue balance.",
      },
      behaviour: {
        points: eligible ? Math.max(0, WEIGHTS.behaviour - 5 * discountCount) : null,
        weight: WEIGHTS.behaviour,
        explanation: discountCount ? `${discountCount} invoice(s) with a recorded discount escalation. Each costs 5 points.` : "No recorded discount escalations.",
      },
      exposure: {
        points: eligible ? WEIGHTS.exposure * (1 - share) : null,
        weight: WEIGHTS.exposure,
        explanation: totalOverdue ? `${(share * 100).toFixed(1)}% of this workspace’s overdue balance.` : "The workspace has no overdue balance.",
      },
    };
    const available = Object.values(breakdown).filter((component) => component.points !== null);
    const weight = available.reduce((sum, component) => sum + component.weight, 0);
    const earned = available.reduce((sum, component) => sum + (component.points ?? 0), 0);
    const score = eligible ? Math.round(100 * earned / weight) : null;
    const grade = score === null ? null : score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";
    return { client, score, grade, rank: null, outstandingCents, avgDaysLate, breakdown };
  }).sort((a, b) =>
    (b.score ?? -1) - (a.score ?? -1) ||
    a.outstandingCents - b.outstandingCents ||
    compareText(a.client.name.toLowerCase(), b.client.name.toLowerCase()) ||
    compareText(a.client.id, b.client.id));

  return results.map((result, index) => ({ ...result, rank: result.score === null ? null : index + 1 }));
}
