import type { ApprovalRow, InvoiceRow, PlanRow } from '../types';

// The Stage column already names the state, so these say what happens next, not the state again.
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function nextAction(
  invoice: InvoiceRow,
  plan: PlanRow | null,
  approvals: ApprovalRow[],
  installments: ReadonlyArray<Pick<InvoiceRow, 'dueAt' | 'status'>> = [],
): string {
  if (invoice.status === 'PAID' || invoice.chaseState === 'RESOLVED') return 'Paid';
  if (approvals.some((approval) => approval.status === 'PENDING') || plan?.status === 'PENDING_APPROVAL') return 'Answer in Approvals';

  if (plan?.status === 'ACTIVE') {
    const [nextDue] = installments
      .filter(({ status }) => status === 'SENT' || status === 'OVERDUE' || status === 'PARTIALLY_PAID')
      .map(({ dueAt }) => dueAt)
      .sort();
    return nextDue ? `Next installment due ${shortDate(nextDue)}` : 'Review payment plan';
  }

  if (invoice.nextFollowupAt) return `Follow up on ${shortDate(invoice.nextFollowupAt)}`;
  if (['NUDGED', 'NEGOTIATING', 'PLAN_OFFERED', 'PLAN_ACCEPTED', 'ESCALATED'].includes(invoice.chaseState)) return 'Waiting for client reply';
  return 'Send first reminder';
}
