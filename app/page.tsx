"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createAccountantExport, type ExportScope } from "@/lib/accountant-export";
import { DEMO_AS_OF, DEMO_BUSINESS } from "@/lib/demo-data";
import { EXPENSE_CATEGORIES, formatDate, formatNip, VAT_RATE_LABEL } from "@/lib/invoice";
import { countByFilter, countReviewQueue, filterResults, REVIEW_FILTER_LABEL, reviewQueueState, summarizeByCurrency, type ReviewFilter } from "@/lib/invoice-review";
import { formatCurrencyTotals, formatMoney, sumSameCurrency, totalsByCurrency } from "@/lib/money";
import { demoExplanation, invoices, results, type ReconciliationResult, type ReconciliationStatus } from "@/lib/reconcile";
import { getReviewEntry, reviewDecisions, type ReviewPatch } from "@/lib/review-state";
import { useReviewStore } from "@/lib/use-review-store";
import { ReviewPanel } from "./review-panel";
import { CurrencySummaryStrip, ReviewToolbar } from "./review-toolbar";

const statusLabel: Record<ReconciliationStatus, string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  missing_payment: "Missing payment",
  possible_duplicate: "Possible duplicate",
  needs_review: "Needs review"
};
const KNOWN_INVOICE_IDS: ReadonlySet<string> = new Set(results.map((r) => r.invoice.id));

function exportScopeFor(filter: ReviewFilter, query: string): ExportScope | null {
  if (query.trim()) return "filtered";
  if (filter === "all") return null;
  if (filter === "overdue") return "overdue";
  // The reviewer queue mixes statuses and local decisions, so it is not a single reconciliation status.
  if (filter === "needs_review") return "filtered";
  return filter;
}

function statusClass(status: ReconciliationStatus) {
  return `status status-${status}`;
}

function paymentTotal(result: ReconciliationResult) {
  return sumSameCurrency(result.matchedPayments, result.invoice.currency);
}

function initials(vendor: string) {
  return vendor.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
}

function DueChip({ result }: { result: ReconciliationResult }) {
  if (result.due.state !== "overdue") return null;
  return <span className="due-chip">{result.due.daysPastDue}d overdue</span>;
}

/** Amount the business may have overpaid or still owes on exceptions, per currency. */
const exposureTotals = totalsByCurrency(
  results.filter((r) => r.status === "amount_mismatch" || r.status === "possible_duplicate"),
  (r) => ({ amountMinor: Math.abs(r.deltaMinor), currency: r.invoice.currency })
);

function downloadTextFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Home() {
  const [active, setActive] = useState<ReconciliationResult>(results.find((r) => r.status !== "matched") ?? results[0]);
  const [explanations, setExplanations] = useState<Record<string, { text: string; mode: "nicrron" | "rules"; latencyMs?: number }>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "warning" } | null>(null);
  const showNotice = (text: string, tone: "info" | "warning" = "info") => setNotice(text ? { text, tone } : null);
  const [speakLoading, setSpeakLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef("");
  const [runCount, setRunCount] = useState(1);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const review = useReviewStore(KNOWN_INVOICE_IDS);
  const reviewLoading = review.status === "loading";

  const matchedCount = results.filter((r) => r.status === "matched").length;
  const exceptions = results.filter((r) => r.status !== "matched");
  const overdueCount = results.filter((r) => r.due.state === "overdue").length;
  const reconciledValue = formatCurrencyTotals(totalsByCurrency(results.filter((r) => r.status === "matched"), (r) => ({ amountMinor: r.invoice.grossMinor, currency: r.invoice.currency })), "Nothing");
  const decisions = useMemo(() => reviewDecisions(review.store), [review.store]);
  const filteredResults = useMemo(() => filterResults(results, query, filter, decisions), [query, filter, decisions]);
  const filterCounts = useMemo(() => countByFilter(results, query, decisions), [query, decisions]);
  const currencySummaries = useMemo(() => summarizeByCurrency(filteredResults), [filteredResults]);
  const queueCounts = useMemo(() => countReviewQueue(results, decisions), [decisions]);
  const activeEntry = getReviewEntry(review.store, active.invoice.id);
  const activeQueueState = reviewQueueState(active, decisions[active.invoice.id]);
  const activeIndex = filteredResults.findIndex((r) => r.invoice.id === active.invoice.id);
  const currentExplanation = explanations[active.invoice.id]?.text ?? demoExplanation(active);

  function selectResult(result: ReconciliationResult) {
    setActive(result);
    if (window.matchMedia("(max-width: 920px)").matches) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      detailRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  function applyReview(patch: ReviewPatch) {
    const { id, number } = active.invoice;
    if (!review.update(id, patch)) return;
    const saved = review.status === "unavailable" ? "kept until you reload (storage blocked)" : "saved in this browser only";
    const parts: string[] = [];
    if (patch.decision !== undefined) parts.push(patch.decision === "reviewed" ? "marked reviewed" : patch.decision === "needs_review" ? "flagged for review" : "decision cleared");
    if (patch.note !== undefined) parts.push("note saved");
    showNotice(`${number} ${parts.join(" + ")} · ${saved}.`);
  }

  function undoActiveReview() {
    if (review.undo(active.invoice.id)) showNotice(`Undid the last review change on ${active.invoice.number}.`);
  }

  function resetAllReviews() {
    if (!window.confirm("Clear every review decision and note saved in this browser? This cannot be undone.")) return;
    review.resetAll();
    showNotice("All demo review decisions were cleared from this browser.");
  }

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [exportMenuOpen]);

  function exportForAccountant(scope: "all" | "filtered") {
    setExportMenuOpen(false);
    const exportScope = scope === "filtered" ? exportScopeFor(filter, query) : null;
    const records = exportScope ? filteredResults : results;
    const result = createAccountantExport(records, { date: new Date(), statusFilter: exportScope });
    if (!result.ok) {
      showNotice(exportScope ? "No records to export: no invoices match the current search and filter." : "No records to export.", "warning");
      return;
    }
    downloadTextFile(result.filename, result.content, "text/csv;charset=utf-8");
    const totals = result.totals.map((t) => `${formatMoney(t.grossMinor, t.currency)} gross`).join(" · ");
    showNotice(`Exported ${result.recordCount} ${result.recordCount === 1 ? "record" : "records"} to ${result.filename} · ${totals}.`);
  }

  const paymentReference = useMemo(() => {
    const linked = active.matchedPayments.map((p) => `${p.id} · ${p.bookedAt} · ${formatMoney(p.amountMinor, p.currency)} · ${p.reference}`);
    const other = active.crossCurrencyPayments.map((p) => `${p.id} · ${formatMoney(p.amountMinor, p.currency)} · ${p.reference} (different currency, not matched)`);
    const all = [...linked, ...other];
    return all.length ? all.join(" | ") : "No candidate payment";
  }, [active]);

  async function analyze() {
    setLoading(true);
    showNotice("");
    const sessionId = `closemate-demo-${active.invoice.id}-${Date.now()}`;
    sessionRef.current = sessionId;
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: active.invoice.id, sessionId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analysis failed.");
      setExplanations((prev) => ({ ...prev, [active.invoice.id]: { text: data.explanation, mode: data.mode, latencyMs: data.latencyMs } }));
      showNotice(data.mode === "nicrron" ? `Nicrron analysis complete${data.traceConfigured ? " · PRISM trace sent" : " · PRISM credentials not configured"}.` : "Rules-based demo explanation shown. Add a Nicrron API key to run the AI analysis.");
      setRunCount((n) => n + 1);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function speak() {
    setSpeakLoading(true);
    showNotice("");
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${active.invoice.vendor}. Invoice ${active.invoice.number}. ${currentExplanation}`,
          sessionId: sessionRef.current || `closemate-voice-${active.invoice.id}-${Date.now()}`
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Voice generation failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play();
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Voice generation failed.");
    } finally {
      setSpeakLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">C</span><span>closemate</span><span className="beta">BETA</span></div>
        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace"><span className="workspace-icon">{DEMO_BUSINESS.name[0]}</span><span><strong>{DEMO_BUSINESS.name}</strong><small>{DEMO_BUSINESS.form} · Purchase invoices</small></span><span className="chevron">⌄</span></button>
        <nav className="nav-list" aria-label="Main navigation">
          <div className="nav-section">OPERATIONS</div>
          <button className="nav-item"><span>▦</span> Overview</button>
          <button className="nav-item nav-active"><span>⇄</span> Reconciliation <span className="nav-count">{exceptions.length}</span></button>
          <button className="nav-item"><span>▤</span> Invoices</button>
          <button className="nav-item"><span>↗</span> Payments</button>
          <div className="nav-section nav-section-spaced">INTELLIGENCE</div>
          <button className="nav-item"><span>✳</span> CloseMate AI <span className="online-dot" /></button>
          <button className="nav-item"><span>◉</span> Audit trail</button>
        </nav>
        <div className="sidebar-bottom"><div className="avatar">AH</div><div><strong>Finance team</strong><small>Demo workspace</small></div><span className="more">•••</span></div>
      </aside>

      <section className="main-content">
        <header className="topbar"><div className="breadcrumb">Finance operations <span>/</span> Reconciliation</div><div className="topbar-right"><span className="safe-pill"><span className="tiny-dot" /> Read-only demo</span><button className="help-button" aria-label="Help">?</button></div></header>

        <div className="page-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> MONTH-END CLOSE · OCTOBER 2026</div><h1>Reconciliation, <em>under control.</em></h1><p className="subtitle">Find the exceptions. Understand the why. Close with evidence.</p></div>
            <div className="heading-actions">
              <div className="export-menu" ref={exportMenuRef}>
                <button className="button button-secondary" aria-haspopup="menu" aria-expanded={exportMenuOpen} aria-controls="export-menu" onClick={() => setExportMenuOpen((open) => !open)}>⤓ <span>Export for accountant</span> <span className="button-caret">⌄</span></button>
                {exportMenuOpen && <div className="export-popover" id="export-menu" role="menu" aria-label="Export for accountant">
                  <div className="export-popover-label">CSV · UTF-8 · SEMICOLON</div>
                  <button role="menuitem" className="export-option" onClick={() => exportForAccountant("all")}><strong>All records</strong><small>{results.length} invoices · every status</small></button>
                  <button role="menuitem" className="export-option" onClick={() => exportForAccountant("filtered")}><strong>Filtered records</strong><small>{filteredResults.length} {filteredResults.length === 1 ? "invoice" : "invoices"} · {[filter === "all" ? "" : REVIEW_FILTER_LABEL[filter], query.trim() ? `search “${query.trim()}”` : ""].filter(Boolean).join(" · ") || "no filter applied"}</small></button>
                </div>}
              </div>
              <button className="button button-primary" onClick={() => { setRunCount((n) => n + 1); showNotice("Reconciliation re-run on the sample data. No money moved."); }}>↻ <span>Run reconciliation</span></button>
            </div>
          </div>

          <div className="demo-banner" role="note">
            <span aria-hidden="true">ⓘ</span>
            <p><strong>Synthetic records only.</strong> Every vendor, NIP, invoice and bank payment on this page is fictional. Review decisions and notes are stored only in this browser (localStorage). They are never uploaded or sent to CloseMate AI, Nicrron or PRISM.</p>
            {review.status !== "loading" && Object.keys(review.store).length > 0 && <button type="button" className="ghost-button" onClick={resetAllReviews}>Clear my review decisions</button>}
          </div>
          {review.problem && <div className={`demo-banner demo-banner-${review.problem.tone}`} role="alert"><span aria-hidden="true">!</span><p>{review.problem.text}</p></div>}

          <div className="kpi-grid">
            <div className="kpi-card"><div className="kpi-top"><span>Reviewer sign-off</span><span className="kpi-icon icon-slate">▤</span></div><div className="kpi-value">{reviewLoading ? "—" : queueCounts.reviewed}<span className="kpi-unit"> of {invoices.length} reviewed</span></div><div className="kpi-foot"><span className="foot-dot neutral" />{reviewLoading ? "Loading saved decisions…" : `${queueCounts.awaiting + queueCounts.flagged} awaiting review · this browser only`}</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>Reconciled</span><span className="kpi-icon icon-green">✓</span></div><div className="kpi-value">{matchedCount}<span className="kpi-unit"> of {invoices.length}</span></div><div className="kpi-foot"><span className="foot-dot good" />{reconciledValue} matched with evidence</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>Exceptions to review</span><span className="kpi-icon icon-amber">!</span></div><div className="kpi-value">{exceptions.length}<span className="kpi-unit"> need attention</span></div><div className="kpi-foot"><span className="foot-dot warning" />{overdueCount} overdue · no automatic payment actions</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>Potential exposure</span><span className="kpi-icon icon-purple">⌁</span></div><div className="kpi-value">{formatCurrencyTotals(exposureTotals, formatMoney(0, "PLN"))}<span className="kpi-unit"> flagged</span></div><div className="kpi-foot"><span className="foot-dot neutral" />Mismatch gap + duplicate excess, per currency</div></div>
          </div>

          <div className="content-grid">
            <section className="panel reconciliation-panel">
              <div className="panel-header"><div><h2>Invoice reconciliation</h2><p>Bank statement evidence matched to purchase invoices on gross amount and currency · as of {formatDate(DEMO_AS_OF, "long")}</p></div><div className="panel-header-actions"><button className="ghost-button" onClick={() => showNotice("Showing the seeded October demo dataset.")}>Sample data <span>⌄</span></button></div></div>
              <ReviewToolbar query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} counts={filterCounts} reviewCountsPending={reviewLoading} />
              <CurrencySummaryStrip summaries={currencySummaries} />
              {filteredResults.length === 0 ? (
                <div className="empty-state" role="status">
                  <strong>No invoices match</strong>
                  <p>{query.trim() ? `Nothing matches “${query.trim()}”${filter === "all" ? "" : ` in ${REVIEW_FILTER_LABEL[filter]}`}. Try an invoice number, vendor, NIP or category.` : filter === "needs_review" ? "Every exception has been signed off. Nice work." : `No invoices are currently ${REVIEW_FILTER_LABEL[filter].toLowerCase()}.`}</p>
                  <div className="empty-state-actions">
                    {query && <button type="button" className="ghost-button" onClick={() => setQuery("")}>Clear search</button>}
                    {filter !== "all" && <button type="button" className="ghost-button" onClick={() => setFilter("all")}>Show all invoices</button>}
                  </div>
                </div>
              ) : <div className="table-scroll"><table><caption className="sr-only">Invoices{filter === "all" ? "" : `, filtered to ${REVIEW_FILTER_LABEL[filter]}`}{query.trim() ? `, matching “${query.trim()}”` : ""}. Select an invoice to review it.</caption><thead><tr><th scope="col">INVOICE / VENDOR</th><th scope="col">INVOICE AMOUNT</th><th scope="col">PAYMENT</th><th scope="col">STATUS</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>
                {filteredResults.map((result) => {
                  const selected = active.invoice.id === result.invoice.id;
                  const decision = decisions[result.invoice.id];
                  const hasNote = Boolean(getReviewEntry(review.store, result.invoice.id).note);
                  return <tr key={result.invoice.id} className={selected ? "selected-row" : ""} onClick={() => selectResult(result)}>
                  <td><button type="button" className="row-select" aria-current={selected ? "true" : undefined} onClick={(e) => { e.stopPropagation(); selectResult(result); }}><span className="invoice-cell"><span className={`vendor-avatar avatar-${result.status}`} aria-hidden="true">{initials(result.invoice.vendor)}</span><span><strong>{result.invoice.vendor}</strong><small>{result.invoice.number} · {EXPENSE_CATEGORIES[result.invoice.category].label}</small></span></span></button></td>
                  <td><strong className="amount-cell">{formatMoney(result.invoice.grossMinor, result.invoice.currency)}</strong><small className="date-cell">Due {formatDate(result.invoice.dueAt)} <DueChip result={result} /></small></td>
                  <td><span className="payment-cell">{result.matchedPayments.length ? formatMoney(paymentTotal(result), result.invoice.currency) : "—"}</span><small className="date-cell">{result.matchedPayments.length ? result.matchedPayments.length > 1 ? `${result.matchedPayments.length} transfers` : result.matchedPayments[0].bookedAt : result.crossCurrencyPayments.length ? `${result.crossCurrencyPayments[0].currency} payment · not matched` : "No payment found"}</small></td>
                  <td><span className={statusClass(result.status)}><span className="status-dot" />{statusLabel[result.status]}</span>{!reviewLoading && (decision || hasNote) && <small className="review-chips">{decision && <span className={`review-chip review-chip-${decision}`}>{decision === "reviewed" ? "✓ Reviewed" : "⚑ Flagged"}</span>}{hasNote && <span className="review-chip" title="Has a reviewer note">✎ Note</span>}</small>}</td><td className="row-chevron" aria-hidden="true">›</td>
                </tr>;
                })}
              </tbody></table></div>}
              <div className="table-footer" aria-live="polite"><span>Showing {filteredResults.length} of {results.length} invoices</span><span className="table-footer-right"><span className="mini-green" /> {filteredResults.filter((r) => r.status === "matched").length} matched <span className="mini-amber" /> {filteredResults.filter((r) => r.status !== "matched").length} exceptions</span></div>
            </section>

            <aside className="panel detail-panel" ref={detailRef} aria-label={`Review ${active.invoice.number}`}>
              <div className="detail-topline"><span className="detail-label">EXCEPTION REVIEW</span><span className="detail-number">{activeIndex >= 0 ? `${String(activeIndex + 1).padStart(2, "0")} / ${String(filteredResults.length).padStart(2, "0")}` : "Hidden by current filter"}</span></div>
              <div className="detail-vendor"><span className={`vendor-avatar large avatar-${active.status}`}>{initials(active.invoice.vendor)}</span><div><h2>{active.invoice.vendor}</h2><p>{active.invoice.number} · {active.invoice.vendorNip ? `NIP ${formatNip(active.invoice.vendorNip)}` : `Foreign vendor (${active.invoice.vendorCountry})`}</p></div></div>
              <div className="detail-statuses"><span className={statusClass(active.status)}><span className="status-dot" />{statusLabel[active.status]}</span><DueChip result={active} /></div>
              <div className="compare-box"><div><span>INVOICE GROSS</span><strong>{formatMoney(active.invoice.grossMinor, active.invoice.currency)}</strong></div><div className="compare-divider">{active.status === "missing_payment" ? "?" : active.status === "matched" ? "=" : "↔"}</div><div><span>PAYMENT TOTAL</span><strong>{active.matchedPayments.length ? formatMoney(paymentTotal(active), active.invoice.currency) : "—"}</strong></div></div>
              <dl className="invoice-facts">
                <div><dt>Net</dt><dd>{formatMoney(active.invoice.netMinor, active.invoice.currency)}</dd></div>
                <div><dt>VAT · {VAT_RATE_LABEL[active.invoice.vatRate]}</dt><dd>{formatMoney(active.invoice.vatMinor, active.invoice.currency)}</dd></div>
                <div><dt>Issued / due</dt><dd>{formatDate(active.invoice.issuedAt)} → {formatDate(active.invoice.dueAt, "long")}</dd></div>
                <div><dt>Category</dt><dd>{EXPENSE_CATEGORIES[active.invoice.category].label} <small>({EXPENSE_CATEGORIES[active.invoice.category].polish})</small></dd></div>
              </dl>
              {active.reviewReasons.length > 0 && <div className="detail-block review-block"><div className="detail-block-heading"><span>!</span> Why this needs review</div><ul>{active.reviewReasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul></div>}
              <div className="detail-block"><div className="detail-block-heading"><span>⌁</span> Evidence found</div><p>{paymentReference}</p>{active.matchedPayments.length > 0 && <div className="evidence-row"><span className="evidence-check">✓</span><span>Bank record found · {active.matchedPayments[0].account}</span><span className="evidence-date">{active.matchedPayments[0].bookedAt}</span></div>}{active.matchedPayments.length === 0 && <div className="evidence-row evidence-missing"><span>!</span><span>{active.crossCurrencyPayments.length ? "Only other-currency evidence found; not matched" : "No candidate transaction found"}</span></div>}</div>
              <div className="ai-card"><div className="ai-card-head"><span className="ai-sparkle">✳</span><div><strong>CloseMate insight</strong><small>AI-assisted · Human approval required</small></div><span className="ai-live-dot" /></div><p className="ai-explanation">{currentExplanation}</p>{explanations[active.invoice.id] && <div className="analysis-meta"><span className={explanations[active.invoice.id].mode === "nicrron" ? "meta-live" : "meta-demo"}>{explanations[active.invoice.id].mode === "nicrron" ? "NICRRON AI" : "RULE-BASED DEMO"}</span>{explanations[active.invoice.id].latencyMs !== undefined && <span>{explanations[active.invoice.id].latencyMs} ms</span>}</div>}</div>
              <div className="detail-actions"><button className="button button-primary analyze-button" onClick={analyze} disabled={loading}>{loading ? <><span className="spinner" /> Analyzing…</> : <><span>✳</span> Explain with AI</>}</button><button className="button button-secondary" onClick={speak} disabled={speakLoading}>{speakLoading ? "Preparing voice…" : "♫ Listen"}</button></div>
              <ReviewPanel key={active.invoice.id} entry={activeEntry} queueState={activeQueueState} storageStatus={review.status} onUpdate={applyReview} onUndo={undoActiveReview} />
              <div className="human-note"><span>◈</span><p><strong>Human-in-the-loop</strong> — CloseMate explains and flags. It never initiates a transfer or changes your ledger, and it does not decide tax deductibility or tax liability; confirm those with your accountant.</p></div>
            </aside>
          </div>

          <div className="bottom-grid">
            <div className="bottom-card"><div className="bottom-icon icon-purple">◉</div><div><div className="bottom-title">AI observability <span className="integration-pill">PRISM</span></div><p>Model explanations are traceable by session, with latency and failure fallback captured when configured.</p></div><span className="bottom-arrow">↗</span></div>
            <div className="bottom-card"><div className="bottom-icon icon-blue">⌘</div><div><div className="bottom-title">Model routing <span className="integration-pill">NICRRON</span></div><p>Use one OpenAI-compatible endpoint for model access; fallback rules keep the demo usable.</p></div><span className="bottom-arrow">↗</span></div>
            <div className="bottom-card"><div className="bottom-icon icon-orange">♫</div><div><div className="bottom-title">Voice briefing <span className="integration-pill">ELEVENLABS</span></div><p>Listen to an exception summary when the voice API key is configured.</p></div><span className="bottom-arrow">↗</span></div>
          </div>
          <div className="notice-region" role="status" aria-live="polite">{notice && <div className={`notice notice-${notice.tone}`}><span>{notice.tone === "warning" ? "!" : "ⓘ"}</span>{notice.text}<button onClick={() => showNotice("")} aria-label="Dismiss notice">×</button></div>}</div>
          <footer className="footer"><span>© 2026 CloseMate · Built for Money Talks 2</span><span>Synthetic demo data <span className="footer-separator">·</span> No bank, KSeF or tax-office connection <span className="footer-separator">·</span> Not tax advice <span className="footer-separator">·</span> Run #{runCount}</span></footer>
        </div>
      </section>
      <audio ref={audioRef} className="hidden-audio" onEnded={(e) => { URL.revokeObjectURL(e.currentTarget.src); }} />
    </main>
  );
}
