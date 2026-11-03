import { z } from 'zod';

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.log('no key, skipped');
    return;
  }
  try {
    const { createLiveLLM } = await import('./llm');
    const { listInvoices } = await import('./db/queries');
    const { agentTools, handleToolCall } = await import('./agent/tools');
    const { getNow } = await import('./clock');
    const { db } = await import('./db/client');
    const llm = createLiveLLM();
    const structured = await llm.structured({
      system: 'Return the requested boolean in the provided JSON structure.',
      input: 'Return {"ok":true}.',
      schema: z.object({ ok: z.boolean() }),
    });
    if (!structured.ok) throw new Error('Structured response failed validation.');

    const invoice = listInvoices()[0]?.invoice;
    if (!invoice) throw new Error('No seeded invoice found. Seed the database before running llm:smoke.');
    const contextTool = agentTools.find((tool) => tool.name === 'get_invoice_context');
    if (!contextTool) throw new Error('Read-only invoice context tool is unavailable.');
    const loop = await llm.runToolLoop({
      system: 'Call get_invoice_context exactly once for the provided invoice ID. Do not call any other tool.',
      messages: [{ role: 'user', content: JSON.stringify({ invoiceId: invoice.id }) }],
      tools: [contextTool],
      maxIterations: 1,
      toolChoiceName: 'get_invoice_context',
      onToolCall: ({ name, input }) => handleToolCall(name, input, db, getNow()),
    });
    if (loop.toolCalls.length !== 1 || loop.toolCalls[0]?.tool !== 'get_invoice_context' || !loop.toolCalls[0]?.ok) {
      throw new Error('The read-only tool loop did not complete successfully.');
    }
    console.log(JSON.stringify({ structured: { ok: true }, toolLoop: { ok: true, tool: 'get_invoice_context', toolCallCount: loop.toolCalls.length } }));
  } catch {
    console.error(JSON.stringify({ error: 'LLM smoke failed; details redacted.' }));
    process.exitCode = 1;
  }
}

void main();
