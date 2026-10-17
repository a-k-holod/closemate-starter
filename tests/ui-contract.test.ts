import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoBankPayments, demoInvoices } from "../lib/demo-data";
import { messagesFor } from "../lib/messages";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");
const page = readFileSync(join(root, "app/page.tsx"), "utf8");
const english = messagesFor("en");

/** Flat list of [selector, declarations] pairs, including rules nested in @media blocks. */
function cssRules(source: string): [string, string][] {
  const rules: [string, string][] = [];
  const pattern = /([^{}@]+)\{([^{}]*)\}/g;
  for (const match of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(pattern)) rules.push([match[1].trim(), match[2]]);
  return rules;
}

describe("feedback notices cannot cover controls (regression: sticky notice over reviewer buttons)", () => {
  it("never positions notices as an overlay", () => {
    const noticeRules = cssRules(css).filter(([selector]) => /\.notice/.test(selector));
    expect(noticeRules.length).toBeGreaterThan(0);
    for (const [selector, body] of noticeRules) {
      expect(body, selector).not.toMatch(/position\s*:\s*(sticky|fixed|absolute)/);
      expect(body, selector).not.toMatch(/z-index/);
    }
  });

  it("renders a page-level and a reviewer-panel notice region in normal flow, both announced politely", () => {
    expect(page).toMatch(/<NoticeRegion notice=\{notice\} placement="page"/);
    expect(page).toMatch(/<NoticeRegion notice=\{notice\} placement="detail"/);
    expect(page).toMatch(/className=\{`notice-region notice-region-\$\{placement\}`\} role="status" aria-live="polite"/);
  });

  it("uses a disclosure for the export options rather than an ARIA menu without arrow-key support", () => {
    expect(page).not.toMatch(/role="menu"|role="menuitem"/);
    expect(page).toMatch(/aria-expanded=\{exportMenuOpen\}/);
  });
});

describe("privacy boundaries in the client", () => {
  it("sends only invoiceId, sessionId and locale to the API routes", () => {
    const bodies = [...page.matchAll(/body: JSON\.stringify\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const keys = body.split(",").map((entry) => /^\s*(\w+)/.exec(entry)?.[1] ?? "");
      expect(keys.sort()).toEqual(["invoiceId", "locale", "sessionId"]);
      expect(body).not.toMatch(/note|review\.store|vendor|explanation/i);
    }
  });

  it("does not reference server secrets or NEXT_PUBLIC variables in client code", () => {
    for (const file of ["app/page.tsx", "app/review-panel.tsx", "app/review-toolbar.tsx", "app/locale-switcher.tsx", "lib/use-review-store.ts", "lib/use-locale.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).not.toMatch(/process\.env|NEXT_PUBLIC_|API_KEY/);
    }
  });

  it("states the product limitations and synthetic-data disclaimer on the page", () => {
    expect(english.banner.lead).toBe("Synthetic records only.");
    expect(page).toContain("{t.banner.lead}");
    expect(page).toContain("{t.banner.body}");
    for (const phrase of ["PDF/OCR", "cloud document storage", "bank or KSeF connection", "no tax advice", "deductibility"]) expect(english.banner.body).toContain(phrase);
  });
});

describe("demo data is clearly synthetic", () => {
  it("uses fictional vendor names and NIPs with the unissued 000 tax-office prefix", () => {
    for (const invoice of demoInvoices) {
      expect(invoice.vendor).toMatch(/Demo|Przykład/);
      if (invoice.vendorNip) expect(invoice.vendorNip.startsWith("000")).toBe(true);
    }
    for (const payment of demoBankPayments) expect(payment.counterparty).toMatch(/DEMO|PRZYKLAD/);
  });
});
