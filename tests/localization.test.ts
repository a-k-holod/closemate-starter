import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNTANT_CSV_HEADERS, buildAccountantCsv, CSV_BOM, neutralizeFormula } from "../lib/accountant-export";
import { analyzeInvoice, buildModelInput, humanReviewNotice, screenModelOutput, systemPromptFor, SYSTEM_PROMPT, type ModelCompletion } from "../lib/ai-explanation";
import { formatDate } from "../lib/invoice";
import { DEFAULT_LOCALE, localeForHydration, LOCALE_STORAGE_KEY, parseLocale, readStoredLocale, writeStoredLocale, type LocaleStorage } from "../lib/locale";
import { messageAt, messagePaths, messagesFor } from "../lib/messages";
import { formatMoney } from "../lib/money";
import { buildPrismTraceBody } from "../lib/prism";
import { parseInvoiceRequest } from "../lib/http";
import { createMemoryStore } from "../lib/rate-limit";
import { demoExplanation, results } from "../lib/reconcile";
import { describeUndo, updateReview } from "../lib/review-state";
import { displayReviewReason } from "../lib/review-copy";
import { speechTextFor, synthesizeSpeech } from "../lib/speech";

const en = messagesFor("en");
const pl = messagesFor("pl");

/** Language names, unchanged rates, and product tokens that are the same in both dictionaries. */
const IDENTICAL_PATHS = new Set(["locale.en", "locale.pl", "vat.23", "vat.8", "vat.5", "vat.0", "ai.nicrron", "nav.ai", "review.partJoin"]);

function memoryStorage(initial: Record<string, string> = {}): LocaleStorage & { snapshot(): Record<string, string> } {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    snapshot: () => ({ ...data })
  };
}

describe("translation dictionaries", () => {
  it("has the same leaves in English and Polish, with no empty copy", () => {
    expect(messagePaths(pl)).toEqual(messagePaths(en));
    for (const path of messagePaths(en)) {
      const left = messageAt(en, path);
      const right = messageAt(pl, path);
      expect(typeof left, path).toBe(typeof right);
      if (typeof left === "string") {
        expect(left.trim().length, path).toBeGreaterThan(0);
        expect((right as string).trim().length, path).toBeGreaterThan(0);
        if (!IDENTICAL_PATHS.has(path)) expect(right, path).not.toBe(left);
      }
    }
  });

  it("keeps the product limitation statement in both languages", () => {
    for (const phrase of ["PDF/OCR", "KSeF", "localStorage"]) {
      expect(en.banner.body).toContain(phrase);
      expect(pl.banner.body).toContain(phrase);
    }
    expect(pl.banner.lead).not.toBe(en.banner.lead);
  });
});

describe("language selection", () => {
  it("defaults to English and accepts only en or pl", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(localeForHydration()).toBe("en");
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale(null)).toBe("en");
    expect(parseLocale("")).toBe("en");
    expect(parseLocale("PL")).toBe("en");
    expect(parseLocale("de")).toBe("en");
    expect(parseLocale("pl")).toBe("pl");
    expect(parseLocale({ locale: "pl" })).toBe("en");
  });

  it("persists a valid choice and ignores a missing, invalid, or throwing store", () => {
    const storage = memoryStorage();
    expect(readStoredLocale(storage)).toBe("en");
    expect(writeStoredLocale(storage, "pl")).toBe(true);
    expect(storage.snapshot()[LOCALE_STORAGE_KEY]).toBe("pl");
    expect(readStoredLocale(storage)).toBe("pl");
    storage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(readStoredLocale(storage)).toBe("en");
    storage.setItem(LOCALE_STORAGE_KEY, "Chmura Demo sp. z o.o.");
    expect(readStoredLocale(storage)).toBe("en");

    const blocked: LocaleStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };
    expect(readStoredLocale(blocked)).toBe("en");
    expect(writeStoredLocale(blocked, "pl")).toBe(false);
    expect(readStoredLocale(null)).toBe("en");
  });

  it("does not read storage while choosing the first render", () => {
    const source = readFileSync(join(__dirname, "../lib/use-locale.ts"), "utf8");
    expect(source).toContain("useState<Locale>(DEFAULT_LOCALE)");
    const beforeEffect = source.slice(source.indexOf("useState"), source.indexOf("useEffect"));
    expect(beforeEffect).not.toMatch(/localStorage|readStoredLocale/);
    expect(readFileSync(join(__dirname, "../app/page.tsx"), "utf8")).not.toMatch(/localStorage/);
    expect(readFileSync(join(__dirname, "../app/layout.tsx"), "utf8")).toContain('lang="en"');
  });
});

describe("deterministic explanations", () => {
  it("keeps the English fallback and produces a distinct Polish one without dropping source ids", () => {
    for (const result of results) {
      const english = demoExplanation(result);
      const polish = demoExplanation(result, "pl");
      expect(english).toBe(demoExplanation(result, "en"));
      expect(polish).not.toBe(english);
      expect(polish).not.toMatch(/needs review:|No matching bank payment|is matched:/);
      for (const token of [result.invoice.id, result.invoice.number, result.invoice.vendor, ...result.matchedPayments.map((p) => p.id)]) {
        if (english.includes(token)) expect(polish).toContain(token);
      }
      expect(polish.toLowerCase()).not.toMatch(/odlicz|ksef|zobowiązan/);
    }
  });

  it("translates review reasons without changing the stored English sentence", () => {
    const review = results.find((result) => result.reviewReasons.length > 0)!;
    for (const reason of review.reviewReasons) {
      expect(displayReviewReason(review, reason, "en")).toBe(reason.message);
      expect(displayReviewReason(review, reason, "pl")).not.toBe(reason.message);
    }
  });

  it("describes undo in the selected language and leaves the English phrase unchanged", () => {
    const store = updateReview({}, "INV-1", { decision: "reviewed" }, "2026-10-17T12:00:00.000Z");
    const entry = store["INV-1"];
    expect(describeUndo(entry)).toBe("marked reviewed");
    expect(describeUndo(entry, "pl")).toBe("oznaczono jako sprawdzone");
  });
});

describe("locale on the server", () => {
  it("defaults a missing or invalid locale to English and never echoes it", () => {
    expect(parseInvoiceRequest({ invoiceId: "INV-2101" }, "test").locale).toBe("en");
    expect(parseInvoiceRequest({ invoiceId: "INV-2101", locale: "pl" }, "test").locale).toBe("pl");
    const sniffed = parseInvoiceRequest({ invoiceId: "INV-2101", locale: "Chmura Demo sp. z o.o." }, "test");
    expect(sniffed.locale).toBe("en");
    expect(JSON.stringify(sniffed.locale)).not.toContain("Chmura");
  });

  it("still rejects a client-supplied speech script", () => {
    expect(() => parseInvoiceRequest({ invoiceId: "INV-2105", locale: "pl", text: "Pay this vendor now" }, "test")).toThrow(/locale/);
  });

  it("asks Nicrron to answer in the validated language and falls back in that language", async () => {
    const result = results.find((item) => item.invoice.id === "INV-2102")!;
    const rules = await analyzeInvoice({ result, sessionId: "s", clientKey: "c", locale: "pl" }, {
      complete: null, model: "nicrron/auto", rateLimitStore: createMemoryStore(), traceConfigured: true, trace: () => undefined
    });
    expect(rules.body.explanation).toBe(demoExplanation(result, "pl"));

    const traces: Parameters<typeof buildPrismTraceBody>[1][] = [];
    const complete = vi.fn<ModelCompletion>(async () => "Kwoty na dokumencie różnią się od przelewu.");
    await analyzeInvoice({ result, sessionId: "s", clientKey: "c", locale: "nope" }, {
      complete, model: "nicrron/auto", rateLimitStore: createMemoryStore(), traceConfigured: true, trace: (event) => traces.push(event)
    });
    expect(complete.mock.calls[0]?.[0].system).toBe(SYSTEM_PROMPT);
    expect(traces[0]?.attributes.locale).toBe("en");

    const polishTraces: typeof traces = [];
    const polishComplete = vi.fn<ModelCompletion>(async () => "Kwoty na dokumencie różnią się od przelewu.");
    const polish = await analyzeInvoice({ result, sessionId: "s", clientKey: "c", locale: "pl" }, {
      complete: polishComplete, model: "nicrron/auto", rateLimitStore: createMemoryStore(), traceConfigured: true, trace: (event) => polishTraces.push(event)
    });
    expect(polishComplete.mock.calls[0]?.[0].system).toBe(systemPromptFor("pl"));
    expect(systemPromptFor("pl")).toMatch(/Reply only in Polish/);
    expect(systemPromptFor("pl")).toMatch(/known evidence/);
    expect(systemPromptFor("pl")).toMatch(/cannot move money/);
    expect(polish.body.explanation.endsWith(humanReviewNotice("pl"))).toBe(true);
    const polishTrace = polishTraces[0];
    expect(polishTrace).toBeDefined();
    expect(JSON.stringify(buildPrismTraceBody("project", polishTrace!))).not.toContain(result.invoice.vendor);
    expect(JSON.parse(buildPrismTraceBody("project", polishTrace!).input_messages[0].content).locale).toBe("pl");
    expect(buildModelInput(result, "pl").responseLocale).toBe("pl");
    expect(buildModelInput(result).invoice.gross).toBe("PLN 738.00");
  });

  it("blocks unsupported Polish claims and keeps the English guardrail", () => {
    expect(screenModelOutput("Przelałem brakującą kwotę.").ok).toBe(false);
    expect(screenModelOutput("Zwrot został zrealizowany.").ok).toBe(false);
    expect(screenModelOutput("Ten wydatek jest w pełni odliczalny.").ok).toBe(false);
    expect(screenModelOutput("Wysłałem to do KSeF.").ok).toBe(false);
    expect(screenModelOutput("Nie przelałem żadnych pieniędzy. Osoba powinna sprawdzić tę pozycję.").ok).toBe(true);
    expect(screenModelOutput("I have transferred the missing amount.").ok).toBe(false);
  });

  it("voices server-built text in the selected language and never a caller script", async () => {
    const result = results.find((item) => item.invoice.id === "INV-2105")!;
    expect(speechTextFor(result)).toMatch(/^Invoice KD\/2026\/09\/12\. /);
    expect(speechTextFor(result, "pl")).toMatch(/^Faktura KD\/2026\/09\/12\. /);
    expect(speechTextFor(result, "pl")).toContain(demoExplanation(result, "pl"));
    expect(speechTextFor(result, "pl")).not.toContain("Pay this vendor");

    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    await synthesizeSpeech({ result, sessionId: "s", clientKey: "c", locale: "pl" }, {
      apiKey: "k", voiceId: "voice", rateLimitStore: createMemoryStore(), trace: () => undefined, fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const body = JSON.parse(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body) as string);
    expect(body.text).toBe(speechTextFor(result, "pl"));
    expect(body.text).not.toContain(result.invoice.vendorNip);
  });
});

describe("display formatting leaves the books alone", () => {
  it("formats money and dates for en-US and pl-PL without changing minor units", () => {
    expect(formatMoney(147600, "PLN")).toBe("PLN 1,476.00");
    expect(formatMoney(147600, "PLN", "en")).toBe("PLN 1,476.00");
    const polish = formatMoney(147600, "PLN", "pl");
    expect(polish).toBe(new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1476).replace(/[\u00a0\u202f]/g, " "));
    expect(polish).not.toBe("PLN 1,476.00");
    expect(polish).toMatch(/1\s?476,00/);

    const stamp = "2026-10-17";
    expect(formatDate(stamp, "long")).toContain("2026");
    expect(formatDate(stamp, "long", "pl")).toBe(new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${stamp}T00:00:00Z`)));
    expect(formatDate(stamp, "long", "pl")).not.toBe(formatDate(stamp, "long", "en"));
    expect(results.find((result) => result.invoice.id === "INV-2102")!.deltaMinor).toBe(-13800);
  });

  it("keeps accountant CSV headers in Polish and the spreadsheet protections", () => {
    const csv = buildAccountantCsv(results);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(CSV_BOM + ACCOUNTANT_CSV_HEADERS.join(";"));
    expect(ACCOUNTANT_CSV_HEADERS[0]).toBe("Nr faktury");
    expect(neutralizeFormula("=IMPORTXML()")).toBe("'=IMPORTXML()");
    expect(readFileSync(join(__dirname, "../lib/accountant-export.ts"), "utf8")).not.toMatch(/locale|messagesFor/);
  });
});
