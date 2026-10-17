"use client";

import { REVIEW_FILTER_LABEL, REVIEW_FILTERS, type CurrencySummary, type ReviewFilter } from "@/lib/invoice-review";
import { formatMoney } from "@/lib/money";

type ReviewToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  filter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
  counts: Record<ReviewFilter, number>;
  /** The "Needs review" count depends on saved decisions, which load after hydration. */
  reviewCountsPending: boolean;
};

export function ReviewToolbar({ query, onQueryChange, filter, onFilterChange, counts, reviewCountsPending }: ReviewToolbarProps) {
  return (
    <div className="review-toolbar">
      <div className="search-field">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <label htmlFor="invoice-search" className="sr-only">Search invoices</label>
        <input
          id="invoice-search"
          type="search"
          value={query}
          placeholder="Search invoice no., vendor, NIP or category"
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
        {query && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onQueryChange("")}>×</button>}
      </div>
      <div className="filter-chips" role="group" aria-label="Filter invoices">
        {REVIEW_FILTERS.map((f) => {
          const pending = f === "needs_review" && reviewCountsPending;
          return (
            <button key={f} type="button" className="filter-chip" aria-pressed={filter === f} onClick={() => onFilterChange(f)}>
              {REVIEW_FILTER_LABEL[f]}
              <span className="filter-count">{pending ? <><span aria-hidden="true">…</span><span className="sr-only">count loading</span></> : counts[f]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CurrencySummaryStrip({ summaries }: { summaries: CurrencySummary[] }) {
  if (summaries.length === 0) return null;
  return (
    <section className="currency-summary" aria-labelledby="currency-summary-title">
      <div className="currency-summary-label" id="currency-summary-title">TOTALS IN THIS VIEW · PER CURRENCY, NEVER CONVERTED</div>
      <div className="currency-cards">
        {summaries.map((s) => (
          <div className="currency-card" key={s.currency}>
            <div className="currency-card-top"><span className="currency-code">{s.currency}</span><span>{s.invoiceCount} {s.invoiceCount === 1 ? "invoice" : "invoices"}</span></div>
            <dl>
              <div><dt>Invoiced gross</dt><dd>{formatMoney(s.grossMinor, s.currency)}</dd></div>
              <div><dt>Bank evidence</dt><dd>{formatMoney(s.paidMinor, s.currency)}</dd></div>
              <div><dt>Unpaid</dt><dd className={s.unpaidMinor > 0 ? "amount-warn" : undefined}>{formatMoney(s.unpaidMinor, s.currency)}</dd></div>
              {s.overpaidMinor > 0 && <div><dt>Overpaid</dt><dd className="amount-warn">{formatMoney(s.overpaidMinor, s.currency)}</dd></div>}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
