/** Send a trace to PRISM over its documented HTTP API. Never let observability break the user workflow. */
export async function emitPrismTrace(input: string, output: string, opts: {
  model: string;
  latencyMs: number;
  sessionId: string;
  agentId?: string;
}): Promise<void> {
  const host = process.env.PRISMTRACE_HOST ?? "https://api.prism.blockconvey.com";
  const projectId = process.env.PRISMTRACE_PROJECT_ID;
  const apiKey = process.env.PRISMTRACE_API_KEY;
  if (!projectId || !apiKey) return;

  try {
    const response = await fetch(`${host.replace(/\/$/, "")}/api/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PRISMtrace-Key": apiKey
      },
      body: JSON.stringify({
        project_id: projectId,
        model: opts.model,
        input_messages: [{ role: "user", content: input }],
        output_message: output,
        latency_ms: Math.max(0, opts.latencyMs),
        session_id: opts.sessionId,
        agent_id: opts.agentId ?? "closemate-reconciliation"
      }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store"
    });
    if (!response.ok) console.warn(`PRISM trace delivery returned ${response.status}`);
  } catch (error) {
    console.warn("PRISM trace delivery failed; continuing without blocking CloseMate.", error);
  }
}
