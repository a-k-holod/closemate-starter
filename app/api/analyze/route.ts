import OpenAI from "openai";
import { NextResponse } from "next/server";
import { EXPENSE_CATEGORIES, formatNip, VAT_RATE_LABEL } from "@/lib/invoice";
import { formatMoney } from "@/lib/money";
import { demoExplanation, results, type BankPayment, type ReconciliationResult } from "@/lib/reconcile";
import { emitPrismTrace } from "@/lib/prism";

export const runtime = "nodejs";

const describePayment = (p: BankPayment) => ({ id: p.id, bookedAt: p.bookedAt, amount: formatMoney(p.amountMinor, p.currency), counterparty: p.counterparty, reference: p.reference, account: p.account });

/** Amounts are pre-formatted strings so the model never does arithmetic on them. */
function modelInput(result: ReconciliationResult) {
  const { invoice } = result;
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  return {
    task: "Explain one reconciliation result for a Polish sole proprietorship (JDG) and recommend safe next steps",
    invoice: {
      id: invoice.id,
      number: invoice.number,
      vendor: invoice.vendor,
      vendorNip: invoice.vendorNip ? formatNip(invoice.vendorNip) : `none (foreign vendor, ${invoice.vendorCountry})`,
      category: EXPENSE_CATEGORIES[invoice.category].label,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      net: money(invoice.netMinor),
      vat: money(invoice.vatMinor),
      gross: money(invoice.grossMinor),
      vatRateOnDocument: VAT_RATE_LABEL[invoice.vatRate]
    },
    status: result.status,
    dueState: result.due.state,
    daysPastDue: result.due.daysPastDue,
    difference: money(result.deltaMinor),
    reviewReasons: result.reviewReasons.map((r) => r.message),
    linkedPayments: result.matchedPayments.map(describePayment),
    otherCurrencyPayments: result.crossCurrencyPayments.map(describePayment),
    deterministicSummary: demoExplanation(result)
  };
}

const SYSTEM_PROMPT = [
  "You are CloseMate, a cautious finance operations assistant for a Polish sole proprietorship (JDG). Reply in English.",
  "Explain the supplied reconciliation result in 2-4 concise sentences. All amounts, statuses and due dates are deterministic inputs; do not recalculate, convert between currencies, or change them.",
  "Distinguish facts from hypotheses. Never claim a payment happened. Never initiate or instruct automatic movement of money. Recommend human review for mismatches, missing payments, possible duplicates and items held for review.",
  "Do not decide whether an expense or VAT is deductible, do not estimate tax liability, and do not claim any connection to KSeF or a tax authority; suggest confirming such questions with the accountant.",
  "Use only the provided synthetic records."
].join(" ");

export async function POST(request: Request) {
  const started = Date.now();
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : typeof body?.invoice?.id === "string" ? body.invoice.id : undefined;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.slice(0, 120) : `closemate-${Date.now()}`;

  const result = invoiceId ? results.find((r) => r.invoice.id === invoiceId) : undefined;
  if (!result) {
    return NextResponse.json({ error: "Unknown invoice. Only the synthetic demo invoices can be analyzed." }, { status: 400 });
  }

  const fallbackText = demoExplanation(result);
  const model = process.env.NICRRON_MODEL || "nicrron/auto";
  const input = JSON.stringify(modelInput(result));
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
          { role: "system", content: SYSTEM_PROMPT },
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
