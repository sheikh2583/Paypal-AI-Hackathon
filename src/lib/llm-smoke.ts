import { z } from 'zod';

// `pnpm llm:smoke` runs one structured call and one read-only tool loop with the configured provider.
// `pnpm llm:smoke --all` runs both calls for every key and model in the pool and prints a table (D75).
// Keys are only ever shown as "key #N".

async function smokeOne(): Promise<void> {
  const { getLlmEnv } = await import('./env');
  const config = getLlmEnv();
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
  console.log(JSON.stringify({ provider: config.provider, model: config.model, keys: config.apiKeys.length, structured: { ok: true }, toolLoop: { ok: true, tool: 'get_invoice_context', toolCallCount: loop.toolCalls.length } }));
}

type Outcome = 'pass' | 'format' | 'rate limited' | 'key rejected' | 'error';

/** Every key + model combination on its own, with no failover, so each row reflects one combination. */
async function smokeAll(): Promise<number> {
  const { getLlmEnv } = await import('./env');
  const { OpenAICompatibleLLM, LlmRequestError } = await import('./llm');
  const { KeyPool } = await import('./llm-pool');
  const config = getLlmEnv();
  if (config.provider !== 'openai-compatible' || config.apiKeys.length === 0 || !config.baseUrl) {
    console.log('llm:smoke --all needs LLM_API_KEYS (or LLM_API_KEY), LLM_BASE_URL and LLM_MODEL.');
    return 1;
  }
  const models = [...new Set([config.model, config.fallbackModel].filter((value): value is string => Boolean(value)))];
  // A read-only stand-in for get_invoice_context, so the smoke run never writes to the app database.
  const tool = { name: 'get_invoice_context', description: 'Return the invoice details for the given invoice ID.', inputSchema: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'], additionalProperties: false } };
  const rows: Record<string, string | number>[] = [];
  const excluded: string[] = [];
  let passing = 0;

  for (const [keyIndex, key] of config.apiKeys.entries()) {
    for (const model of models) {
      let status = 0;
      const started = Date.now();
      const llm = new OpenAICompatibleLLM(config.baseUrl, [key], model, { pool: new KeyPool(1, [model], Date.now, () => undefined) });
      const record = ({ status: code }: { status: number }) => { status = code; };
      const classify = (error: unknown): Outcome => {
        if (error instanceof LlmRequestError) {
          if (error.status === 429) return 'rate limited';
          if (error.status === 401 || error.status === 403) return 'key rejected';
          if (error.code === 'LLM_INVALID_RESPONSE') return 'format';
        }
        return 'error';
      };
      let structured: Outcome = 'pass';
      let toolLoop: Outcome = 'pass';
      try {
        const result = await llm.structured({ system: 'Return the requested boolean in the provided JSON structure.', input: 'Return {"ok":true}.', schema: z.object({ ok: z.boolean() }), onProviderCall: record });
        if (!result.ok) structured = 'format';
      } catch (error) { structured = classify(error); }
      if (structured === 'pass' || structured === 'format') {
        try {
          const loop = await llm.runToolLoop({
            system: 'Call get_invoice_context exactly once for the provided invoice ID. Do not call any other tool.',
            messages: [{ role: 'user', content: JSON.stringify({ invoiceId: 'smoke-invoice' }) }],
            tools: [tool], maxIterations: 1, toolChoiceName: 'get_invoice_context', onProviderCall: record,
            onToolCall: async () => JSON.stringify({ ok: true, invoice: { id: 'smoke-invoice', amountCents: 90000, status: 'OVERDUE' } }),
          });
          if (loop.toolCalls.length !== 1 || loop.toolCalls[0]?.tool !== 'get_invoice_context' || !loop.toolCalls[0]?.ok) toolLoop = 'format';
        } catch (error) { toolLoop = classify(error); }
      } else toolLoop = structured;
      const pass = structured === 'pass' && toolLoop === 'pass';
      if (pass) passing += 1;
      if (structured === 'format' || toolLoop === 'format') excluded.push(`${keyIndex + 1}:${model}`);
      rows.push({ key: `#${keyIndex + 1}`, model, result: pass ? 'PASS' : 'FAIL', structured, toolLoop, latencyMs: Date.now() - started, status: status || '—' });
    }
  }
  console.table(rows);
  console.log(`${passing}/${rows.length} combinations passed.`);
  if (excluded.length) console.log(`Format failures to leave out of the pool: set LLM_POOL_EXCLUDE=${excluded.join(',')}`);
  return passing > 0 ? 0 : 1;
}

async function main(): Promise<void> {
  const all = process.argv.includes('--all');
  const listed = (process.env.LLM_API_KEYS ?? '').split(',').some((key) => key.trim());
  const selectedProvider = process.env.LLM_PROVIDER?.trim() || (listed || process.env.LLM_API_KEY?.trim() ? 'openai-compatible' : 'anthropic');
  const selectedKey = selectedProvider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : listed ? 'set' : process.env.LLM_API_KEY;
  if (!selectedKey?.trim()) {
    console.log('no key, skipped');
    return;
  }
  try {
    if (all) process.exitCode = await smokeAll();
    else await smokeOne();
  } catch {
    console.error(JSON.stringify({ error: 'LLM smoke failed; details redacted.' }));
    process.exitCode = 1;
  }
}

void main();
