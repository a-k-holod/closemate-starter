import OpenAI from "openai";
import { NextResponse } from "next/server";
import { demoExplanation, type Invoice, type Payment, type ReconciliationStatus } from "@/lib/reconcile";
import { emitPrismTrace } from "@/lib/prism";

export const runtime = "nodejs";

const fallback = (status: ReconciliationStatus, invoice: Invoice, payments: Payment[]) => {
  const amount = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  if (status === "amount_mismatch") {
    const p = payments[0];
    const delta = (p?.amount ?? 0) - invoice.amount;
    return `${invoice.id} needs review: the invoice is ${amount(invoice.amount)}, while ${p?.id ?? "the candidate payment"} is ${amount(p?.amount ?? 0)} (${amount(Math.abs(delta))} ${delta >= 0 ? "higher" : "lower"}). Compare tax, a credit note, or a duplicate charge before approving an adjustment. No payment or refund has been initiated.`;
  }
  if (status === "missing_payment") return `No matching payment was found for ${invoice.vendor} (${invoice.id}, ${amount(invoice.amount)}). Check pending payments, alternate vendor names, and whether the bank statement is complete. Do not mark the invoice paid without evidence.`;
  if (status === "possible_duplicate") return `${payments.length} payments reference ${invoice.id}. Check both transactions against the bank and vendor ledger before requesting a recall or refund.`;
  return `${invoice.id} is matched to the available bank evidence. Preserve the transaction reference for audit.`;
};

export async function POST(request: Request) {
  const started = Date.now();
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const invoice = body?.invoice as Invoice | undefined;
  const payments = body?.payments as Payment[] | undefined;
  const status = body?.status as ReconciliationStatus | undefined;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.slice(0, 120) : `closemate-${Date.now()}`;

  if (!invoice || typeof invoice.id !== "string" || typeof invoice.vendor !== "string" || typeof invoice.amount !== "number" || !Array.isArray(payments) || !["matched", "amount_mismatch", "missing_payment", "possible_duplicate"].includes(status ?? "")) {
    return NextResponse.json({ error: "Invalid invoice reconciliation payload." }, { status: 400 });
  }
  const safePayments = payments.slice(0, 8).filter((p) => p && typeof p.id === "string" && typeof p.vendor === "string" && typeof p.amount === "number");
  const fallbackText = fallback(status!, invoice, safePayments);
  const model = process.env.NICRRON_MODEL || "nicrron/auto";
  const input = JSON.stringify({ task: "Explain one reconciliation exception and recommend safe next steps", invoice, status, candidatePayments: safePayments });
  let explanation = fallbackText;
  let mode: "nicrron" | "rules" = "rules";

  if (process.env.NICRRON_API_KEY) {
    try {
      const client = new OpenAI({
        apiKey: process.env.NICRRON_API_KEY,
        baseURL: "https://api.nicrron.ai/v1",
        timeout: 20000,
        maxRetries: 0
      });
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.15,
        messages: [
          {
            role: "system",
            content: "You are CloseMate, a cautious finance operations assistant. Explain the supplied reconciliation result in 2-4 concise sentences. All amounts and matching statuses are deterministic inputs; do not recalculate or change them. Distinguish facts from hypotheses. Never claim a payment happened. Never initiate or instruct automatic movement of money. Recommend human review for mismatches, missing payments, or possible duplicates. Use only the provided synthetic records."
          },
          { role: "user", content: input }
        ]
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (text) {
        explanation = text;
        mode = "nicrron";
      }
      await emitPrismTrace(input, explanation, { model, latencyMs: Date.now() - started, sessionId });
    } catch (error) {
      console.error("Nicrron request failed; using deterministic fallback.", error);
      await emitPrismTrace(input, `MODEL_ERROR: ${String(error).slice(0, 500)}\nFallback: ${fallbackText}`, { model, latencyMs: Date.now() - started, sessionId });
    }
  } else {
    await emitPrismTrace(input, explanation, { model: "rules-fallback", latencyMs: Date.now() - started, sessionId });
  }

  return NextResponse.json({ explanation, mode, model: mode === "nicrron" ? model : null, traceConfigured: Boolean(process.env.PRISMTRACE_API_KEY && process.env.PRISMTRACE_PROJECT_ID), latencyMs: Date.now() - started });
}
