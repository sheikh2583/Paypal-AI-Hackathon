import type { ApprovalRow, InvoiceRow, PlanRow } from '../types';

export function nextAction(
  invoice: InvoiceRow,
  plan: PlanRow | null,
  approvals: ApprovalRow[],
  installments: ReadonlyArray<Pick<InvoiceRow, 'dueAt' | 'status'>> = [],
): string {
  if (invoice.status === 'PAID' || invoice.chaseState === 'RESOLVED') return 'Paid';
  if (approvals.some((approval) => approval.status === 'PENDING') || plan?.status === 'PENDING_APPROVAL') return 'Needs your approval';

  if (plan?.status === 'ACTIVE') {
    const [nextDue] = installments
      .filter(({ status }) => status === 'SENT' || status === 'OVERDUE' || status === 'PARTIALLY_PAID')
      .map(({ dueAt }) => dueAt)
      .sort();
    return nextDue ? `Plan active — next installment due ${nextDue.slice(0, 10)}` : 'Review payment plan';
  }

  if (invoice.nextFollowupAt) return `Follow up on ${invoice.nextFollowupAt.slice(0, 10)}`;
  if (['NUDGED', 'NEGOTIATING', 'PLAN_OFFERED', 'PLAN_ACCEPTED', 'ESCALATED'].includes(invoice.chaseState)) return 'Waiting for client reply';
  return 'Send first reminder';
}
