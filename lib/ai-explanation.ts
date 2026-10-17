import { EXPENSE_CATEGORIES, VAT_RATE_LABEL } from "./invoice";
import type { Locale } from "./locale";
import { parseLocale } from "./locale";
import { formatMoney } from "./money";
import type { PrismTraceEvent, TraceOutcome } from "./prism";
import { checkRateLimit, type RateLimitStore } from "./rate-limit";
import { demoExplanation, type BankPayment, type ReconciliationResult, type ReviewReasonCode } from "./reconcile";

/** Fixed, non-identifying descriptions so the model never receives NIPs, invoice numbers or vendor names. */
export const REVIEW_REASON_SUMMARY: Record<ReviewReasonCode, string> = {
  invalid_amount: "Amounts on the record are not whole minor units.",
  non_positive_amount: "Gross is not positive or net/VAT is negative.",
  vat_sum_mismatch: "Net + VAT differs from gross by more than the 1 minor-unit rounding tolerance.",
  vat_rate_mismatch: "VAT amount does not match the VAT rate printed on the document.",
  invalid_vat_rate: "VAT rate on the record is not a supported Polish rate.",
  invalid_nip: "Vendor tax ID fails the Polish NIP checksum.",
  missing_nip: "Polish vendor has no tax ID on record.",
  invalid_date: "Issue or due date is not a valid calendar date.",
  due_before_issue: "Due date is earlier than the issue date.",
  unsupported_currency: "Currency is not supported.",
  duplicate_invoice_number: "The same invoice number from this vendor is recorded more than once.",
  cross_currency_payment: "Related bank evidence is in a different currency; currencies are never matched or converted.",
  shared_payment: "One bank payment exactly matches more than one invoice and is not counted for any of them."
};

const describeEvidence = (payment: BankPayment, locale: Locale) => ({ id: payment.id, bookedAt: payment.bookedAt, amount: formatMoney(payment.amountMinor, payment.currency, locale) });

/**
 * The approved data flow to Nicrron: internal IDs, category, dates, pre-formatted amounts, statuses and
 * reason codes. Vendor names, NIP, invoice numbers, counterparty names, transfer titles, account names
 * and reviewer notes are deliberately excluded. `responseLocale` is the server-validated enum.
 */
export function buildModelInput(result: ReconciliationResult, locale: Locale = "en") {
  const { invoice } = result;
  const money = (minor: number) => formatMoney(minor, invoice.currency, locale);
  const linked = result.matchedPayments;
  return {
    responseLocale: locale,
    task: "Explain one reconciliation result for a Polish sole proprietorship (JDG) and recommend safe next steps for a human reviewer.",
    invoice: {
      ref: invoice.id,
      vendorType: invoice.vendorCountry === "PL" ? "Polish vendor" : `foreign vendor (${invoice.vendorCountry})`,
      category: EXPENSE_CATEGORIES[invoice.category]?.label ?? "Uncategorised",
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      currency: invoice.currency,
      net: money(invoice.netMinor),
      vat: money(invoice.vatMinor),
      gross: money(invoice.grossMinor),
      netPlusVat: money(invoice.netMinor + invoice.vatMinor),
      vatRateOnDocument: VAT_RATE_LABEL[invoice.vatRate] ?? "unknown"
    },
    reconciliation: {
      status: result.status,
      dueState: result.due.state,
      daysPastDue: result.due.daysPastDue,
      linkedPaymentsTotalMinusGross: money(result.deltaMinor),
      linkedPaymentEqualsNet: linked.length === 1 && linked[0].amountMinor === invoice.netMinor && invoice.vatMinor > 0,
      reviewReasons: result.reviewReasons.map((r) => ({ code: r.code, meaning: REVIEW_REASON_SUMMARY[r.code] }))
    },
    bankEvidenceSameCurrency: linked.map((payment) => describeEvidence(payment, locale)),
    bankEvidenceOtherCurrencyNotMatched: result.crossCurrencyPayments.map((payment) => describeEvidence(payment, locale))
  };
}

export const SYSTEM_PROMPT = [
  "You are CloseMate, a cautious finance operations assistant for a Polish sole proprietorship (JDG). Reply in English, in 2-4 short sentences of plain text.",
  "All amounts, statuses and dates are deterministic inputs computed by CloseMate. Do not recalculate, convert between currencies, or change them.",
  "Start with what the supplied records show (known evidence). Label anything else as a possible explanation, using words such as 'possibly' or 'may'.",
  "CloseMate has read-only access: it cannot move money, issue refunds, contact vendors or change any ledger. Never state or imply that a payment, transfer, refund or ledger change was made by you or by CloseMate, and never claim a payment exists beyond the supplied bank evidence.",
  "For any status other than matched, end by recommending that a person reviews the item before acting.",
  "Do not decide whether an expense or VAT is deductible, do not estimate tax liability, and do not claim any connection to KSeF, a bank or a tax authority; suggest confirming such questions with the accountant.",
  "Use only the supplied synthetic record."
].join(" ");

/** Server-controlled language instruction. The client never supplies this sentence. */
export function systemPromptFor(locale: Locale): string {
  if (locale !== "pl") return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT.replace(
    "Reply in English,",
    "Reply only in Polish (locale: pl),"
  )} The entire answer must be Polish. Explain only the supplied evidence, label anything beyond it as a possible explanation, and recommend human review in Polish, for example: „Osoba powinna sprawdzić tę pozycję, zanim zostaną podjęte jakiekolwiek działania.”`;
}

export const MAX_EXPLANATION_CHARS = 1200;

const NEGATION = /(\bno\b|\bnot\b|\bnever\b|\bcannot\b|n't\b|\bwithout\b|\bunable\b)/i;
const PL_NEGATION = /(?<![\p{L}\p{N}_])(?:nie|nigdy)(?![\p{L}\p{N}_])/iu;
const RISKY_CLAIMS: { flag: string; pattern: RegExp; unless?: RegExp }[] = [
  { flag: "agent_action_claim", pattern: /\b(i|we|closemate)\s+(have\s+|has\s+|just\s+|already\s+)?(transferred|sent|paid|refunded|initiated|executed|scheduled|booked|posted|recorded|updated|adjusted|corrected|approved|reconciled)\b/i },
  { flag: "agent_action_claim", pattern: /(?<![\p{L}\p{N}_])(?:przelałem|przelałam|przelaliśmy|przelał|wysłałem|wysłałam|wysłaliśmy|zapłaciłem|zapłaciłam|zapłaciliśmy|zwróciłem|zwróciłam|zainicjowałem|zainicjowałam|zaksięgowałem|zatwierdziłem|uzgodniłem)(?![\p{L}\p{N}_])/iu },
  { flag: "agent_action_claim", pattern: /(?<![\p{L}\p{N}_])closemate\s+(?:przelał|zwrócił|zaksięgował|zatwierdził|uzgodnił)(?![\p{L}\p{N}_])/iu },
  { flag: "ledger_change_claim", pattern: /\b(ledger|books|accounting records?)\b[^.]*\b(has|have|was|were)\s+been\s+(updated|changed|adjusted|corrected|posted)\b|\b(ledger|books)\s+(was|were)\s+(updated|changed|adjusted|corrected)\b/i },
  { flag: "ledger_change_claim", pattern: /(?<![\p{L}\p{N}_])(?:księgi|ewidencja)(?![\p{L}\p{N}_])[^.]*?(?<![\p{L}\p{N}_])(?:zostały|została)(?![\p{L}\p{N}_])\s+(?:zaktualizowane|zaktualizowana|zmienione|zmieniona|skorygowane)/iu },
  { flag: "refund_claim", pattern: /\brefund\b[^.]*\b(has been|was|is being|have been)\s+(issued|initiated|processed|sent|requested|made)\b/i },
  { flag: "refund_claim", pattern: /(?<![\p{L}\p{N}_])zwrot(?![\p{L}\p{N}_])[^.]*?(?<![\p{L}\p{N}_])(?:został|została)(?![\p{L}\p{N}_])\s+(?:wystawiony|zrealizowany|wysłany|wykonany|zlecony)/iu },
  { flag: "tax_determination", pattern: /\b(is|are)\s+(fully\s+|partly\s+|partially\s+)?(tax[- ])?deductible\b/i, unless: /\b(whether|accountant)\b/i },
  { flag: "tax_determination", pattern: /(?<![\p{L}\p{N}_])(?:jest|są)(?![\p{L}\p{N}_])\s+(?:w pełni\s+|częściowo\s+)?(?:odliczaln\p{L}*|podlega odliczeniu)/iu, unless: /(?<![\p{L}\p{N}_])(?:księgow|whether|accountant)(?![\p{L}\p{N}_])/iu },
  { flag: "external_system_claim", pattern: /\b(submitted|sent|reported|filed)\s+(it\s+)?to\s+(ksef|the tax (office|authority))\b/i },
  { flag: "external_system_claim", pattern: /(?<![\p{L}\p{N}_])(?:przesłałem|przesłano|wysłałem|wysłano|zgłosiłem|zgłoszono|złożyłem|złożono)(?![\p{L}\p{N}_])[^.]*?(?<![\p{L}\p{N}_])(?:ksef|urzędu skarbowego|urzędowi skarbowemu)(?![\p{L}\p{N}_])/iu }
];

export type GuardrailResult = { ok: true } | { ok: false; flags: string[] };

/** Deterministic screen for claims the model is not allowed to make. Negated sentences are allowed. */
export function screenModelOutput(text: string): GuardrailResult {
  const flags = new Set<string>();
  if (text.length > MAX_EXPLANATION_CHARS) flags.add("too_long");
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (NEGATION.test(sentence) || PL_NEGATION.test(sentence)) continue;
    for (const { flag, pattern, unless } of RISKY_CLAIMS) if (pattern.test(sentence) && !unless?.test(sentence)) flags.add(flag);
  }
  return flags.size ? { ok: false, flags: [...flags] } : { ok: true };
}

export const HUMAN_REVIEW_NOTICE = "A person should review this item before any action is taken.";

const EN_REVIEW = /\b(review|verify|check|confirm)\b/i;
const PL_REVIEW = /(?<![\p{L}\p{N}_])(?:przegl[aą]d|sprawd|zweryfik|potwierd|weryfikac)\p{L}*/iu;

export function humanReviewNotice(locale: Locale = "en"): string {
  return locale === "pl" ? "Osoba powinna sprawdzić tę pozycję, zanim zostaną podjęte jakiekolwiek działania." : HUMAN_REVIEW_NOTICE;
}

export function ensureHumanReviewRecommendation(text: string, result: ReconciliationResult, locale: Locale = "en"): { text: string; appended: boolean } {
  if (result.status === "matched" || EN_REVIEW.test(text) || PL_REVIEW.test(text)) return { text, appended: false };
  return { text: `${text} ${humanReviewNotice(locale)}`, appended: true };
}

export type ModelCompletion = (request: { model: string; system: string; user: string }) => Promise<string | null | undefined>;

export type FallbackReason =
  | "no_api_key"
  | "rate_limit_unconfigured"
  | "rate_limited"
  | "rate_limit_store_error"
  | "provider_error"
  | "provider_timeout"
  | "empty_output"
  | "guardrail_blocked";

export type AnalyzeResponseBody = {
  explanation: string;
  mode: "nicrron" | "rules";
  model: string | null;
  fallbackReason: FallbackReason | null;
  traceConfigured: boolean;
  latencyMs: number;
};

export type AnalyzeDeps = {
  /** Null when NICRRON_API_KEY is not configured. */
  complete: ModelCompletion | null;
  model: string;
  rateLimitStore: RateLimitStore | null;
  traceConfigured: boolean;
  /** Called at most once; the route schedules delivery after the response. */
  trace: (event: PrismTraceEvent) => void;
  now?: () => number;
};

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /timeout|timed out|abort/i.test(`${error.name} ${error.message}`);
}

/** Never throws for provider problems: every failure path returns the deterministic explanation. */
export async function analyzeInvoice(
  input: { result: ReconciliationResult; sessionId: string; clientKey: string; locale?: unknown },
  deps: AnalyzeDeps
): Promise<{ status: number; body: AnalyzeResponseBody; retryAfterSeconds?: number }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const { result, sessionId, clientKey } = input;
  const locale = parseLocale(input.locale);
  const fallbackText = demoExplanation(result, locale);
  const respond = (status: number, body: Omit<AnalyzeResponseBody, "traceConfigured" | "latencyMs">, retryAfterSeconds?: number) => ({
    status,
    body: { ...body, traceConfigured: deps.traceConfigured, latencyMs: Math.max(0, now() - started) },
    ...(retryAfterSeconds ? { retryAfterSeconds } : {})
  });
  const rules = (fallbackReason: FallbackReason) => ({ explanation: fallbackText, mode: "rules" as const, model: null, fallbackReason });
  const trace = (outcome: TraceOutcome, extra: Partial<PrismTraceEvent["attributes"]> = {}, model = deps.model) =>
    deps.trace({
      event: "analyze.explanation",
      agentId: "closemate-reconciliation",
      sessionId,
      model,
      latencyMs: now() - started,
      outcome,
      attributes: { invoiceRef: result.invoice.id, reconciliationStatus: result.status, reviewReasonCodes: result.reviewReasons.map((r) => r.code), locale, ...extra }
    });

  if (!deps.complete) {
    trace("rules_no_api_key", {}, "rules-fallback");
    return respond(200, rules("no_api_key"));
  }

  const limit = await checkRateLimit(deps.rateLimitStore, "analyze", clientKey, now);
  if (!limit.allowed) {
    if (limit.reason === "limited") return respond(429, rules("rate_limited"), limit.retryAfterSeconds);
    return respond(200, rules(limit.reason === "unconfigured" ? "rate_limit_unconfigured" : "rate_limit_store_error"));
  }

  let text: string | null | undefined;
  try {
    text = (await deps.complete({ model: deps.model, system: systemPromptFor(locale), user: JSON.stringify(buildModelInput(result, locale)) }))?.trim();
  } catch (error) {
    const timeout = isTimeout(error);
    const providerStatus = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;
    console.error(`Nicrron request failed (${timeout ? "timeout" : providerStatus ?? (error instanceof Error ? error.name : "unknown")}); using deterministic fallback.`);
    trace(timeout ? "provider_timeout_fallback" : "provider_error_fallback", providerStatus ? { providerStatus } : {});
    return respond(200, rules(timeout ? "provider_timeout" : "provider_error"));
  }

  if (!text) {
    trace("empty_output_fallback", { outputChars: 0 });
    return respond(200, rules("empty_output"));
  }
  const screened = screenModelOutput(text);
  if (!screened.ok) {
    trace("guardrail_fallback", { outputChars: text.length, guardrailFlags: screened.flags });
    return respond(200, rules("guardrail_blocked"));
  }
  const final = ensureHumanReviewRecommendation(text, result, locale);
  trace(final.appended ? "model_ok_appended_review_notice" : "model_ok", { outputChars: final.text.length });
  return respond(200, { explanation: final.text, mode: "nicrron", model: deps.model, fallbackReason: null });
}
