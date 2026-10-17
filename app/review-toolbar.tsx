"use client";

import { REVIEW_FILTERS, type CurrencySummary, type ReviewFilter } from "@/lib/invoice-review";
import type { Locale } from "@/lib/locale";
import { formatMoney } from "@/lib/money";
import type { Messages } from "@/lib/messages";

type ReviewToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  filter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
  counts: Record<ReviewFilter, number>;
  /** The "Needs review" count depends on saved decisions, which load after hydration. */
  reviewCountsPending: boolean;
  t: Messages;
};

export function ReviewToolbar({ query, onQueryChange, filter, onFilterChange, counts, reviewCountsPending, t }: ReviewToolbarProps) {
  return (
    <div className="review-toolbar">
      <div className="search-field">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <label htmlFor="invoice-search" className="sr-only">{t.search.label}</label>
        <input
          id="invoice-search"
          type="search"
          value={query}
          placeholder={t.search.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              onQueryChange("");
            }
          }}
        />
        {query && <button type="button" className="search-clear" aria-label={t.search.clear} onClick={() => onQueryChange("")}>×</button>}
      </div>
      <div className="filter-chips" role="group" aria-label={t.filters.group}>
        {REVIEW_FILTERS.map((f) => {
          const pending = f === "needs_review" && reviewCountsPending;
          return (
            <button key={f} type="button" className="filter-chip" aria-pressed={filter === f} onClick={() => onFilterChange(f)}>
              {t.filters[f]}
              <span className="filter-count">{pending ? <><span aria-hidden="true">…</span><span className="sr-only">{t.filters.countLoading}</span></> : counts[f]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CurrencySummaryStrip({ summaries, locale, t }: { summaries: CurrencySummary[]; locale: Locale; t: Messages }) {
  if (summaries.length === 0) return null;
  return (
    <section className="currency-summary" aria-labelledby="currency-summary-title">
      <div className="currency-summary-label" id="currency-summary-title">{t.currency.title}</div>
      <div className="currency-cards">
        {summaries.map((s) => (
          <div className="currency-card" key={s.currency}>
            <div className="currency-card-top"><span className="currency-code">{s.currency}</span><span>{t.currency.invoices(s.invoiceCount)}</span></div>
            <dl>
              <div><dt>{t.currency.invoiced}</dt><dd>{formatMoney(s.grossMinor, s.currency, locale)}</dd></div>
              <div><dt>{t.currency.evidence}</dt><dd>{formatMoney(s.paidMinor, s.currency, locale)}</dd></div>
              <div><dt>{t.currency.unpaid}</dt><dd className={s.unpaidMinor > 0 ? "amount-warn" : undefined}>{formatMoney(s.unpaidMinor, s.currency, locale)}</dd></div>
              {s.overpaidMinor > 0 && <div><dt>{t.currency.overpaid}</dt><dd className="amount-warn">{formatMoney(s.overpaidMinor, s.currency, locale)}</dd></div>}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
