// Scripted tool-call sequences for each demo persona. Used by ScriptedLLM
// to run deterministically in CI and for the demo without an API key.
// See docs/06-agent-design.md for persona descriptions.
import type { ReplyClassification } from '../types';

export interface ScriptedTurn {
  /** Tool calls the agent makes this turn (empty = text-only summary). */
  toolCalls: { name: string; input: Record<string, unknown> }[];
  /** Summary text returned after all tool calls this turn. */
  summary: string;
}

export interface PersonaScript {
  /** Indexed by turn number (0-based). */
  agentTurns: ScriptedTurn[];
  /** Scripted client replies indexed by turn (for sim/client.ts). */
  clientReplies: string[];
  /** Scripted classification for each client reply. */
  classifications: ReplyClassification[];
}

// ---------------------------------------------------------------------------
// Persona scripts
// ---------------------------------------------------------------------------

// dana: bakery owner, cash tight.
// Turn 0 agent: get context + send nudge.
// Turn 1 (after client says "can I split?"): propose_payment_plan.
// Turn 2: create_plan_invoices after client accepts.
const dana: PersonaScript = {
  agentTurns: [
    {
      toolCalls: [
        { name: 'get_invoice_context', input: { invoiceId: '__INVOICE_ID__' } },
        {
          name: 'send_message',
          input: {
            invoiceId: '__INVOICE_ID__',
            body: "Hi Dana, I hope you're doing well! I wanted to follow up on invoice #__INVOICE_NUMBER__ for $900.00, which was due 23 days ago. Could you let us know when you're able to take care of this? Happy to help if you have any questions.",
          },
        },
      ],
      summary: 'Sent a friendly nudge to Dana about the overdue $900 invoice.',
    },
    {
      toolCalls: [
        {
          name: 'propose_payment_plan',
          input: {
            invoiceId: '__INVOICE_ID__',
            discountPercent: 0,
            installments: [
              { no: 1, amountCents: 27000, dueAt: '__DEPOSIT_DATE__' },
              { no: 2, amountCents: 31500, dueAt: '__INSTALLMENT2_DATE__' },
              { no: 3, amountCents: 31500, dueAt: '__INSTALLMENT3_DATE__' },
            ],
          },
        },
      ],
      summary: "Proposed a 3-installment payment plan for Dana's invoice based on her request to split payments.",
    },
    {
      toolCalls: [
        {
          name: 'create_plan_invoices',
          input: { planId: '__PLAN_ID__' },
        },
      ],
      summary: "Created PayPal installment invoices for Dana's accepted payment plan. Plan is now active.",
    },
  ],
  clientReplies: [
    "I'm so sorry for the delay! Business has been slow lately. Is there any way I could split this into smaller payments?",
    "Yes, that sounds great! I can definitely manage those amounts. Thank you so much!",
    '',
  ],
  classifications: [
    { intent: 'cannot_pay_full', confidence: 0.95 },
    { intent: 'accepts_plan', confidence: 0.97 },
    { intent: 'other', confidence: 0.9 },
  ],
};

// marcus: busy, ignores messages.
// Turn 0: get context + send nudge + schedule_followup.
const marcus: PersonaScript = {
  agentTurns: [
    {
      toolCalls: [
        { name: 'get_invoice_context', input: { invoiceId: '__INVOICE_ID__' } },
        {
          name: 'send_message',
          input: {
            invoiceId: '__INVOICE_ID__',
            body: "Hi Marcus, I wanted to reach out about invoice #__INVOICE_NUMBER__ for $1,250.00, which is now 41 days overdue. Could you please arrange payment at your earliest convenience? Let me know if you have any questions.",
          },
        },
        { name: 'schedule_followup', input: { invoiceId: '__INVOICE_ID__', inDays: 7 } },
      ],
      summary: 'Sent a firm reminder to Marcus and scheduled a follow-up for 7 days from now.',
    },
  ],
  clientReplies: [''],
  classifications: [{ intent: 'unclear', confidence: 0.5 }],
};

// priya: unhappy with deliverable, disputes quality.
// Turn 0: get context + send nudge.
// Turn 1 (after client disputes): escalate_to_owner.
const priya: PersonaScript = {
  agentTurns: [
    {
      toolCalls: [
        { name: 'get_invoice_context', input: { invoiceId: '__INVOICE_ID__' } },
        {
          name: 'send_message',
          input: {
            invoiceId: '__INVOICE_ID__',
            body: "Hi Priya, I hope you're well! I'm following up on invoice #__INVOICE_NUMBER__ for $600.00, which is 12 days past due. Please let us know when you're able to process this payment.",
          },
        },
      ],
      summary: 'Sent a friendly nudge to Priya about the overdue invoice.',
    },
    {
      toolCalls: [
        {
          name: 'escalate_to_owner',
          input: {
            invoiceId: '__INVOICE_ID__',
            kind: 'DISCOUNT_REQUEST',
            reason: "Client Priya is disputing the quality of the deliverable and requesting a 40% discount, which exceeds the maximum allowed discount of 5%.",
            recommendation: "Review the client's concerns. If a goodwill discount is warranted, a 5% discount is within policy. Consider a direct conversation to resolve the dispute.",
          },
        },
      ],
      summary: "Escalated Priya's dispute and discount request to the owner. The client's requested 40% discount is outside policy bounds.",
    },
  ],
  clientReplies: [
    "I'm not happy with the quality of the work. I think a 40% discount is appropriate given what was delivered.",
    '',
  ],
  classifications: [
    { intent: 'asks_discount', requestedDiscountPercent: 40, confidence: 0.92 },
    { intent: 'other', confidence: 0.9 },
  ],
};

// tom: forgot, says "oh sorry, paying now".
// Turn 0: get context + send short thanks message.
const tom: PersonaScript = {
  agentTurns: [
    {
      toolCalls: [
        { name: 'get_invoice_context', input: { invoiceId: '__INVOICE_ID__' } },
        {
          name: 'send_message',
          input: {
            invoiceId: '__INVOICE_ID__',
            body: "Hi Tom, just a quick note about invoice #__INVOICE_NUMBER__ for $350.00, which came due 6 days ago. Whenever you get a chance, we'd appreciate payment. Thank you!",
          },
        },
      ],
      summary: 'Sent a light reminder to Tom about the small overdue invoice.',
    },
  ],
  clientReplies: ["Oh gosh, totally forgot! I'll pay it right now, sorry about that!"],
  classifications: [{ intent: 'will_pay_full', confidence: 0.99 }],
};

// elena: large invoice, wants 3 payments with tiny deposit.
// Turn 0: get context + send nudge.
// Turn 1 (client wants plan): propose_payment_plan (will be PENDING_APPROVAL above autoApproveBelowCents).
// Turn 2 (after owner approval): create_plan_invoices.
const elena: PersonaScript = {
  agentTurns: [
    {
      toolCalls: [
        { name: 'get_invoice_context', input: { invoiceId: '__INVOICE_ID__' } },
        {
          name: 'send_message',
          input: {
            invoiceId: '__INVOICE_ID__',
            body: "Hi Elena, I hope you're doing well. I wanted to follow up on invoice #__INVOICE_NUMBER__ for $2,400.00, which is now 18 days overdue. Could you arrange payment or let us know if you'd like to discuss payment options?",
          },
        },
      ],
      summary: "Sent a friendly nudge to Elena about the $2,400 overdue invoice and offered to discuss options.",
    },
    {
      toolCalls: [
        {
          name: 'propose_payment_plan',
          input: {
            invoiceId: '__INVOICE_ID__',
            discountPercent: 0,
            installments: [
              { no: 1, amountCents: 72000, dueAt: '__DEPOSIT_DATE__' },
              { no: 2, amountCents: 84000, dueAt: '__INSTALLMENT2_DATE__' },
              { no: 3, amountCents: 84000, dueAt: '__INSTALLMENT3_DATE__' },
            ],
          },
        },
      ],
      summary: "Proposed a 3-installment plan for Elena's $2,400 invoice. The plan total exceeds the auto-approve threshold, so it's pending owner sign-off. Told Elena we're confirming with the owner.",
    },
    {
      toolCalls: [
        {
          name: 'create_plan_invoices',
          input: { planId: '__PLAN_ID__' },
        },
      ],
      summary: "Owner approved Elena's payment plan. Created three installment invoices via PayPal. Plan is now active.",
    },
  ],
  clientReplies: [
    "That's a large amount for us right now. Could we break it into 3 payments? Maybe a smaller deposit?",
    "I understand, that works for me. Thank you for being flexible!",
    '',
  ],
  classifications: [
    { intent: 'cannot_pay_full', proposedInstallments: 3, confidence: 0.93 },
    { intent: 'accepts_plan', confidence: 0.95 },
    { intent: 'other', confidence: 0.9 },
  ],
};

export const scripts: Record<string, PersonaScript> = {
  dana,
  marcus,
  priya,
  tom,
  elena,
};
