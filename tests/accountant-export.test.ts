import { describe, expect, it } from "vitest";
import {
  ACCOUNTANT_CSV_HEADERS,
  CSV_BOM,
  accountantExportFilename,
  buildAccountantCsv,
  createAccountantExport,
  escapeCsvField,
  formatCsvAmount,
  reconciliationStatusPl,
  serializeCsvCell,
  summarizeByCurrency
} from "../lib/accountant-export";
import { toMinorUnits } from "../lib/money";
import { RECONCILIATION_STATUSES, results, type Invoice, type ReconciliationResult } from "../lib/reconcile";

function makeResult(invoice: Partial<Invoice> = {}, overrides: Partial<ReconciliationResult> = {}): ReconciliationResult {
  return {
    invoice: {
      id: "INV-T1",
      number: "FV/2026/10/001",
      vendor: "Vendor",
      vendorCountry: "PL",
      vendorNip: null,
      issuedAt: "2026-10-01",
      dueAt: "2026-10-15",
      currency: "PLN",
      netMinor: 10000,
      vatMinor: 2300,
      grossMinor: 12300,
      vatRate: "23",
      category: "software",
      ...invoice
    },
    status: "matched",
    matchedPayments: [],
    crossCurrencyPayments: [],
    deltaMinor: 0,
    reviewReasons: [],
    due: { state: "settled", daysPastDue: 0 },
    explanation: "Invoice gross and payment amounts match.",
    ...overrides
  };
}

/** Minimal RFC 4180 parser (semicolon variant) so tests assert on round-tripped values. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ";") { row.push(field); field = ""; }
    else if (char === "\r" && csv[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function dataRows(csv: string): string[][] {
  return parseCsv(csv.slice(CSV_BOM.length)).slice(1);
}

const column = (name: (typeof ACCOUNTANT_CSV_HEADERS)[number]) => ACCOUNTANT_CSV_HEADERS.indexOf(name);
const rowFor = (id: string) => {
  const index = results.findIndex((r) => r.invoice.id === id);
  return dataRows(buildAccountantCsv(results))[index];
};

describe("CSV format", () => {
  it("starts with a UTF-8 BOM and the Polish header row, using semicolons and CRLF", () => {
    const csv = buildAccountantCsv([]);
    expect(new TextEncoder().encode(csv).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(csv).toBe(
      `${CSV_BOM}Nr faktury;Dostawca;NIP dostawcy;Data wystawienia;Termin płatności;Netto;VAT;Brutto;Waluta;Kategoria;Status uzgodnienia;ID transakcji;Różnica;Status weryfikacji;Notatki\r\n`
    );
  });

  it("writes every row with exactly one cell per header", () => {
    for (const row of dataRows(buildAccountantCsv(results))) expect(row).toHaveLength(ACCOUNTANT_CSV_HEADERS.length);
  });

  it("has a Polish label for every reconciliation status", () => {
    for (const status of RECONCILIATION_STATUSES) expect(reconciliationStatusPl[status]).toBeTruthy();
  });

  it("exports the JDG demo with Polish statuses, NIPs and decimal commas", () => {
    const matched = rowFor("INV-2101");
    expect(matched[column("Nr faktury")]).toBe("FV/2026/09/118");
    expect(matched[column("NIP dostawcy")]).toBe("000-000-00-17");
    expect(matched[column("Netto")]).toBe("249,99");
    expect(matched[column("VAT")]).toBe("57,50");
    expect(matched[column("Brutto")]).toBe("307,49");
    expect(matched[column("Kategoria")]).toBe("Hosting i chmura");

    const mismatch = rowFor("INV-2102");
    expect(mismatch[column("Status uzgodnienia")]).toBe("Niezgodność kwoty");
    expect(mismatch[column("Różnica")]).toBe("-138,00");
    expect(mismatch[column("ID transakcji")]).toBe("TXN-9102");
    expect(mismatch[column("Notatki")]).toBe("Overdue by 2 days.");

    const missing = rowFor("INV-2105");
    expect(missing[column("Różnica")]).toBe("-1845,00");
    expect(missing[column("Status weryfikacji")]).toBe("Do weryfikacji");

    const duplicate = rowFor("INV-2104");
    expect(duplicate[column("ID transakcji")]).toBe("TXN-9103, TXN-9104");
    expect(duplicate[column("Różnica")]).toBe("1476,00");

    const eur = rowFor("INV-2106");
    expect(eur[column("Waluta")]).toBe("EUR");
    expect(eur[column("NIP dostawcy")]).toBe("");

    const review = rowFor("INV-2108");
    expect(review[column("Status uzgodnienia")]).toBe("Do ręcznej weryfikacji");
    expect(review[column("Notatki")]).toContain("differs from gross (PLN 1,232.00) by PLN 2.00");
  });
});

describe("escaping", () => {
  it("quotes fields containing delimiters, quotes, and newlines", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("a;b")).toBe('"a;b"');
    expect(escapeCsvField('Firma "Krak" sp. z o.o.')).toBe('"Firma ""Krak"" sp. z o.o."');
    expect(escapeCsvField("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(escapeCsvField("line 1\r\nline 2")).toBe('"line 1\r\nline 2"');
    expect(escapeCsvField(" padded ")).toBe('" padded "');
  });

  it("round-trips awkward values through a CSV parser unchanged", () => {
    const message = 'Uwaga; "pilne"\nDruga linia\r\nTrzecia';
    const [row] = dataRows(buildAccountantCsv([makeResult({ vendor: "A;B \"C\"" }, { reviewReasons: [{ code: "invalid_nip", message }] })]));
    expect(row[column("Dostawca")]).toBe('A;B "C"');
    expect(row[column("Notatki")]).toBe(message);
  });
});

describe("Polish characters", () => {
  it("preserves diacritics in headers and values", () => {
    const vendor = "Zakład Usług Łączności „Żółć” Śląsk";
    const csv = buildAccountantCsv([makeResult({ vendor, category: "accounting" }, { reviewReasons: [{ code: "invalid_nip", message: "Źródło: ćwiczenie" }] })]);
    const [row] = dataRows(csv);
    expect(row[column("Dostawca")]).toBe(vendor);
    expect(row[column("Kategoria")]).toBe("Biuro rachunkowe");
    expect(row[column("Notatki")]).toBe("Źródło: ćwiczenie");
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(csv))).toBe(csv);
  });
});

describe("formula injection", () => {
  it.each(["=HYPERLINK(\"http://evil\")", "+SUM(A1:A9)", "-2+3", "@cmd", " =1+1", "\t=1", "\r=1"])("neutralises text starting with a formula trigger: %j", (value) => {
    expect(serializeCsvCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("neutralises formulas in every free-text column of a row", () => {
    const [row] = dataRows(buildAccountantCsv([makeResult({ number: "=1", vendor: "+1+cmd" }, { reviewReasons: [{ code: "invalid_nip", message: "=IMPORTXML()" }] })]));
    expect(row[column("Nr faktury")]).toBe("'=1");
    expect(row[column("Dostawca")]).toBe("'+1+cmd");
    expect(row[column("Notatki")]).toBe("'=IMPORTXML()");
  });

  it("keeps legitimate signed amounts as numbers", () => {
    expect(serializeCsvCell({ amountMinor: -36000, currency: "PLN" })).toBe("-360,00");
    expect(serializeCsvCell("-12,50")).toBe("-12,50");
    expect(serializeCsvCell("+48")).toBe("+48");
    const [row] = dataRows(buildAccountantCsv([makeResult({}, { status: "missing_payment", deltaMinor: -12300 })]));
    expect(row[column("Różnica")]).toBe("-123,00");
  });

  it("leaves ordinary text and NIP numbers untouched", () => {
    expect(serializeCsvCell("Atlas Cloud")).toBe("Atlas Cloud");
    expect(serializeCsvCell("526-000-12-46")).toBe("526-000-12-46");
    expect(serializeCsvCell("a=b")).toBe("a=b");
  });
});

describe("amounts", () => {
  it("formats exact minor units with a decimal comma and no thousands separator", () => {
    expect(formatCsvAmount(123456750, "PLN")).toBe("1234567,50");
    expect(formatCsvAmount(toMinorUnits(1.005, "PLN"), "PLN")).toBe("1,01");
    expect(formatCsvAmount(toMinorUnits(0.1 + 0.2, "EUR"), "EUR")).toBe("0,30");
    expect(formatCsvAmount(0, "USD")).toBe("0,00");
    expect(formatCsvAmount(-5, "PLN")).toBe("-0,05");
    expect(formatCsvAmount(1.5, "PLN")).toBe("");
  });
});

describe("multiple currencies", () => {
  const mixed = [
    makeResult({ id: "A", number: "A", currency: "USD", netMinor: 10000, vatMinor: 0, grossMinor: 10000, vatRate: "np" }),
    makeResult({ id: "B", number: "B", currency: "PLN", netMinor: 100000, vatMinor: 23000, grossMinor: 123000 }),
    makeResult({ id: "C", number: "C", currency: "EUR", netMinor: 5010, vatMinor: 0, grossMinor: 5010, vatRate: "np" }),
    makeResult({ id: "D", number: "D", currency: "USD", netMinor: 20, vatMinor: 0, grossMinor: toMinorUnits(0.2, "USD"), vatRate: "np" }),
    makeResult({ id: "E", number: "E", currency: "USD", netMinor: 10, vatMinor: 0, grossMinor: toMinorUnits(0.1, "USD"), vatRate: "np" })
  ];

  it("writes each row with its own currency code", () => {
    expect(dataRows(buildAccountantCsv(mixed)).map((r) => [r[column("Nr faktury")], r[column("Waluta")], r[column("Brutto")]])).toEqual([
      ["A", "USD", "100,00"],
      ["B", "PLN", "1230,00"],
      ["C", "EUR", "50,10"],
      ["D", "USD", "0,20"],
      ["E", "USD", "0,10"]
    ]);
  });

  it("summarises each currency separately and never produces a cross-currency total", () => {
    expect(summarizeByCurrency(mixed)).toEqual([
      { currency: "PLN", count: 1, grossMinor: 123000 },
      { currency: "EUR", count: 1, grossMinor: 5010 },
      { currency: "USD", count: 3, grossMinor: 10030 }
    ]);
  });

  it("does not append summary rows to the CSV", () => {
    expect(dataRows(buildAccountantCsv(mixed))).toHaveLength(mixed.length);
  });
});

describe("blank values", () => {
  it("writes empty cells for missing optional fields instead of placeholders", () => {
    const [row] = dataRows(buildAccountantCsv([makeResult()]));
    for (const name of ["NIP dostawcy", "ID transakcji", "Notatki"] as const) expect(row[column(name)]).toBe("");
    expect(row[column("Brutto")]).toBe("123,00");
    expect(buildAccountantCsv(results)).not.toMatch(/undefined|null|NaN/);
  });

  it("keeps zero amounts distinct from blanks", () => {
    const [row] = dataRows(buildAccountantCsv([makeResult({ netMinor: 10000, vatMinor: 0, grossMinor: 10000, vatRate: "zw" })]));
    expect(row[column("VAT")]).toBe("0,00");
  });
});

describe("selected fields only", () => {
  it("never leaks fields outside the allow-list", () => {
    const tainted = makeResult(
      { ...({ apiKey: "sk-secret", prompt: "SYSTEM PROMPT" } as object) },
      { explanation: "PROVIDER RESPONSE", ...({ prismApiKey: "prism-key", providerResponse: { raw: 1 } } as object) }
    );
    const csv = buildAccountantCsv([tainted]);
    for (const secret of ["sk-secret", "SYSTEM PROMPT", "PROVIDER RESPONSE", "prism-key", "raw"]) expect(csv).not.toContain(secret);
  });
});

describe("empty exports and filenames", () => {
  const date = new Date(2026, 9, 7, 23, 59);

  it("reports an empty export instead of producing a file", () => {
    expect(createAccountantExport([], { date, statusFilter: null })).toEqual({ ok: false, reason: "empty" });
    expect(createAccountantExport([], { date, statusFilter: "missing_payment" })).toEqual({ ok: false, reason: "empty" });
  });

  it("uses deterministic, descriptive filenames with the local export date", () => {
    expect(accountantExportFilename(date, null)).toBe("closemate_eksport-dla-ksiegowego_2026-10-07_wszystkie.csv");
    expect(accountantExportFilename(date, "amount_mismatch")).toBe("closemate_eksport-dla-ksiegowego_2026-10-07_niezgodnosc-kwoty.csv");
    expect(accountantExportFilename(date, "needs_review")).toBe("closemate_eksport-dla-ksiegowego_2026-10-07_do-weryfikacji.csv");
    expect(accountantExportFilename(date, "missing_payment")).toBe(accountantExportFilename(new Date(2026, 9, 7, 0, 1), "missing_payment"));
  });

  it("names exports of dashboard views that are not a single status", () => {
    expect(accountantExportFilename(date, "overdue")).toBe("closemate_eksport-dla-ksiegowego_2026-10-07_po-terminie.csv");
    expect(accountantExportFilename(date, "filtered")).toBe("closemate_eksport-dla-ksiegowego_2026-10-07_filtrowane.csv");
  });

  it("builds a complete export for non-empty records with per-currency totals", () => {
    const filtered = results.filter((r) => r.status === "matched");
    const result = createAccountantExport(filtered, { date, statusFilter: "matched" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("closemate_eksport-dla-ksiegowego_2026-10-07_uzgodnione.csv");
    expect(result.recordCount).toBe(3);
    expect(dataRows(result.content)).toHaveLength(3);
    expect(result.totals).toEqual([
      { currency: "PLN", count: 2, grossMinor: 115749 },
      { currency: "EUR", count: 1, grossMinor: 4900 }
    ]);
  });
});
