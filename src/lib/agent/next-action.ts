import type { ApprovalRow, InvoiceRow, PlanRow } from '../types';

export function nextAction(
  invoice: InvoiceRow,
  plan: PlanRow | null,
  approvals: ApprovalRow[],
  now: Date,
): string {
  if (invoice.status === 'PAID' || invoice.chaseState === 'RESOLVED') return 'Paid';
  if (approvals.some((approval) => approval.status === 'PENDING') || plan?.status === 'PENDING_APPROVAL') return 'Needs your approval';

  if (plan?.status === 'ACTIVE') {
    const today = now.toISOString().slice(0, 10);
    const next = [...plan.installments].sort((a, b) => a.no - b.no).find((installment) => installment.dueAt.slice(0, 10) >= today)
      ?? [...plan.installments].sort((a, b) => a.no - b.no).at(-1);
    return `Plan active — next installment due ${next?.dueAt.slice(0, 10) ?? 'date pending'}`;
  }

  if (invoice.nextFollowupAt) return `Follow up on ${invoice.nextFollowupAt.slice(0, 10)}`;
  if (['NUDGED', 'NEGOTIATING', 'PLAN_OFFERED', 'PLAN_ACCEPTED', 'ESCALATED'].includes(invoice.chaseState)) return 'Waiting for client reply';
  return 'Send first reminder';
}
