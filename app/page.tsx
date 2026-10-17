"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createAccountantExport, type ExportScope } from "@/lib/accountant-export";
import { DEMO_AS_OF, DEMO_BUSINESS } from "@/lib/demo-data";
import { displayReviewReason } from "@/lib/review-copy";
import { EXPENSE_CATEGORIES, formatDate, formatNip } from "@/lib/invoice";
import { countByFilter, countReviewQueue, filterResults, reviewQueueState, summarizeByCurrency, type ReviewFilter } from "@/lib/invoice-review";
import type { Locale } from "@/lib/locale";
import { useLocale } from "@/lib/use-locale";
import { formatCurrencyTotals, formatMoney, sumSameCurrency, totalsByCurrency } from "@/lib/money";
import { demoExplanation, invoices, results, type ReconciliationResult, type ReconciliationStatus } from "@/lib/reconcile";
import { getReviewEntry, reviewDecisions, type ReviewPatch } from "@/lib/review-state";
import { useReviewStore, type ReviewStorageProblem } from "@/lib/use-review-store";
import type { Messages } from "@/lib/messages";
import { LocaleSwitcher } from "./locale-switcher";
import { ReviewPanel } from "./review-panel";
import { CurrencySummaryStrip, ReviewToolbar } from "./review-toolbar";

const KNOWN_INVOICE_IDS: ReadonlySet<string> = new Set(results.map((r) => r.invoice.id));

type NoticePlacement = "page" | "detail";
type StoredExplanation = { text: string; mode: "nicrron" | "rules"; latencyMs?: number; locale: Locale };

function storageText(problem: ReviewStorageProblem, t: Messages) {
  if (problem.code === "dropped") return t.storage.dropped(problem.count);
  if (problem.code === "unreadable") return t.storage.unreadable;
  if (problem.code === "blocked") return t.storage.blocked;
  return t.storage.saveFailed;
}

function NoticeRegion({ notice, placement, onDismiss, dismissLabel }: { notice: { text: string; tone: "info" | "warning"; placement: NoticePlacement } | null; placement: NoticePlacement; onDismiss: () => void; dismissLabel: string }) {
  const current = notice?.placement === placement ? notice : null;
  return (
    <div className={`notice-region notice-region-${placement}`} role="status" aria-live="polite">
      {current && <div className={`notice notice-${current.tone}`}><span aria-hidden="true">{current.tone === "warning" ? "!" : "ⓘ"}</span>{current.text}<button type="button" onClick={onDismiss} aria-label={dismissLabel}>×</button></div>}
    </div>
  );
}

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

function DueChip({ result, label }: { result: ReconciliationResult; label: (days: number) => string }) {
  if (result.due.state !== "overdue") return null;
  return <span className="due-chip">{label(result.due.daysPastDue)}</span>;
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
  const { locale, setLocale, t } = useLocale();
  const [active, setActive] = useState<ReconciliationResult>(results.find((r) => r.status !== "matched") ?? results[0]);
  const [explanations, setExplanations] = useState<Record<string, StoredExplanation>>({});
  const [loading, setLoading] = useState(false);
  // Notices render in normal document flow next to the control that caused them, never as an overlay.
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "warning"; placement: NoticePlacement } | null>(null);
  const showNotice = (text: string, tone: "info" | "warning" = "info", placement: NoticePlacement = "detail") => setNotice(text ? { text, tone, placement } : null);
  const [includeReviewInExport, setIncludeReviewInExport] = useState(false);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
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
  const reconciledValue = formatCurrencyTotals(totalsByCurrency(results.filter((r) => r.status === "matched"), (r) => ({ amountMinor: r.invoice.grossMinor, currency: r.invoice.currency })), t.kpi.nothing, locale);
  const decisions = useMemo(() => reviewDecisions(review.store), [review.store]);
  const filteredResults = useMemo(() => filterResults(results, query, filter, decisions), [query, filter, decisions]);
  const filterCounts = useMemo(() => countByFilter(results, query, decisions), [query, decisions]);
  const currencySummaries = useMemo(() => summarizeByCurrency(filteredResults), [filteredResults]);
  const queueCounts = useMemo(() => countReviewQueue(results, decisions), [decisions]);
  const activeEntry = getReviewEntry(review.store, active.invoice.id);
  const activeQueueState = reviewQueueState(active, decisions[active.invoice.id]);
  const activeIndex = filteredResults.findIndex((r) => r.invoice.id === active.invoice.id);
  const savedExplanation = explanations[active.invoice.id];
  const currentExplanation = savedExplanation?.locale === locale ? savedExplanation.text : demoExplanation(active, locale);

  function selectLocale(next: Locale) {
    setLocale(next);
    setNotice(null);
  }

  function selectResult(result: ReconciliationResult) {
    if (result.invoice.id !== active.invoice.id) setNotice((current) => (current?.placement === "detail" ? null : current));
    setActive(result);
    if (window.matchMedia("(max-width: 920px)").matches) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      detailRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  function applyReview(patch: ReviewPatch) {
    const { id, number } = active.invoice;
    if (!review.update(id, patch)) return;
    const saved = review.status === "unavailable" ? t.review.keptUntilReload : t.review.savedInBrowser;
    const parts: string[] = [];
    if (patch.decision !== undefined) parts.push(patch.decision === "reviewed" ? t.review.markedReviewed : patch.decision === "needs_review" ? t.review.flagged : t.review.decisionCleared);
    if (patch.note !== undefined) parts.push(t.review.noteSaved);
    showNotice(t.review.savedNotice(number, parts.join(t.review.partJoin), saved));
  }

  function undoActiveReview() {
    if (review.undo(active.invoice.id)) showNotice(t.review.undoNotice(active.invoice.number));
  }

  function resetAllReviews() {
    if (!window.confirm(t.banner.confirmClear)) return;
    review.resetAll();
    showNotice(t.banner.cleared, "info", "page");
  }

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExportMenuOpen(false);
      exportTriggerRef.current?.focus();
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
    const result = createAccountantExport(records, { date: new Date(), statusFilter: exportScope, review: includeReviewInExport ? review.store : undefined });
    if (!result.ok) {
      showNotice(exportScope ? t.export.emptyFiltered : t.export.emptyAll, "warning", "page");
      return;
    }
    downloadTextFile(result.filename, result.content, "text/csv;charset=utf-8");
    const totals = result.totals.map((entry) => `${formatMoney(entry.grossMinor, entry.currency, locale)} ${t.export.gross}`).join(" · ");
    showNotice(t.export.exported(result.recordCount, result.filename, totals, result.includesReviewerNotes), "info", "page");
  }

  const paymentReference = useMemo(() => {
    const linked = active.matchedPayments.map((p) => `${p.id} · ${p.bookedAt} · ${formatMoney(p.amountMinor, p.currency, locale)} · ${p.reference}`);
    const other = active.crossCurrencyPayments.map((p) => `${p.id} · ${formatMoney(p.amountMinor, p.currency, locale)} · ${p.reference} (${t.detail.differentCurrency})`);
    const all = [...linked, ...other];
    return all.length ? all.join(" | ") : t.detail.noCandidate;
  }, [active, locale, t]);

  async function analyze() {
    setLoading(true);
    showNotice("");
    const sessionId = `closemate-demo-${active.invoice.id}-${Date.now()}`;
    sessionRef.current = sessionId;
    const requestedLocale = locale;
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: requestedLocale, invoiceId: active.invoice.id, sessionId })
      });
      const data = await response.json().catch(() => ({}));
      if (typeof data.explanation !== "string") throw new Error(data.error || t.ai.failed);
      setExplanations((prev) => ({ ...prev, [active.invoice.id]: { text: data.explanation, mode: data.mode === "nicrron" ? "nicrron" : "rules", latencyMs: data.latencyMs, locale: requestedLocale } }));
      const trace = data.traceConfigured ? t.ai.traceQueued : t.ai.traceOff;
      if (data.mode === "nicrron") showNotice(t.ai.nicrronDone(trace));
      else {
        const reason = typeof data.fallbackReason === "string" && data.fallbackReason in t.fallback ? data.fallbackReason as keyof typeof t.fallback : "unknown";
        showNotice(t.ai.rulesShown(t.fallback[reason], trace), data.fallbackReason === "no_api_key" ? "info" : "warning");
      }
      setRunCount((n) => n + 1);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t.ai.generic, "warning");
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
          body: JSON.stringify({ locale, invoiceId: active.invoice.id, sessionId: sessionRef.current || `closemate-voice-${active.invoice.id}-${Date.now()}` })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t.ai.voiceFailed);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play();
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t.ai.voiceFailed, "warning");
    } finally {
      setSpeakLoading(false);
    }
  }

  const filterSummary = [filter === "all" ? "" : t.filters[filter], query.trim() ? t.export.search(query.trim()) : ""].filter(Boolean).join(" · ") || t.export.noFilter;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">C</span><span>closemate</span><span className="beta">BETA</span></div>
        <div className="workspace-label">{t.nav.workspace}</div>
        <button className="workspace"><span className="workspace-icon">{DEMO_BUSINESS.name[0]}</span><span><strong>{DEMO_BUSINESS.name}</strong><small>{DEMO_BUSINESS.form} · {t.nav.purchaseInvoices}</small></span><span className="chevron">⌄</span></button>
        <nav className="nav-list" aria-label={t.nav.main}>
          <div className="nav-section">{t.nav.operations}</div>
          <button className="nav-item"><span>▦</span> {t.nav.overview}</button>
          <button className="nav-item nav-active"><span>⇄</span> {t.nav.reconciliation} <span className="nav-count">{exceptions.length}</span></button>
          <button className="nav-item"><span>▤</span> {t.nav.invoices}</button>
          <button className="nav-item"><span>↗</span> {t.nav.payments}</button>
          <div className="nav-section nav-section-spaced">{t.nav.intelligence}</div>
          <button className="nav-item"><span>✳</span> {t.nav.ai} <span className="online-dot" /></button>
          <button className="nav-item"><span>◉</span> {t.nav.audit}</button>
        </nav>
        <div className="sidebar-bottom"><div className="avatar">AH</div><div><strong>{t.nav.team}</strong><small>{t.nav.demoWorkspace}</small></div><span className="more">•••</span></div>
      </aside>

      <section className="main-content">
        <header className="topbar"><div className="breadcrumb">{t.topbar.financeOps} <span>/</span> {t.topbar.reconciliation}</div><div className="topbar-right"><LocaleSwitcher locale={locale} label={t.locale.group} names={{ en: t.locale.en, pl: t.locale.pl }} onChange={selectLocale} /><span className="safe-pill"><span className="tiny-dot" /> {t.topbar.readOnly}</span><button className="help-button" aria-label={t.topbar.help}>?</button></div></header>

        <div className="page-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> {t.heading.eyebrow}</div><h1>{t.heading.titleLead} <em>{t.heading.titleEm}</em></h1><p className="subtitle">{t.heading.subtitle}</p></div>
            <div className="heading-actions">
              <div className="export-menu" ref={exportMenuRef}>
                <button ref={exportTriggerRef} type="button" className="button button-secondary" aria-expanded={exportMenuOpen} aria-controls="export-menu" onClick={() => setExportMenuOpen((open) => !open)}>⤓ <span>{t.export.button}</span> <span className="button-caret">⌄</span></button>
                {exportMenuOpen && <div className="export-popover" id="export-menu" role="group" aria-label={t.export.menu}>
                  <div className="export-popover-label">{t.export.format}</div>
                  <button type="button" className="export-option" onClick={() => exportForAccountant("all")}><strong>{t.export.all}</strong><small>{t.export.allDetail(results.length)}</small></button>
                  <button type="button" className="export-option" onClick={() => exportForAccountant("filtered")}><strong>{t.export.filtered}</strong><small>{t.export.filteredDetail(filteredResults.length, filterSummary)}</small></button>
                  <label className="export-include">
                    <input type="checkbox" checked={includeReviewInExport} disabled={reviewLoading} onChange={(e) => setIncludeReviewInExport(e.target.checked)} />
                    <span><strong>{t.export.includeTitle}</strong><small>{t.export.includeHelp}</small></span>
                  </label>
                </div>}
              </div>
              <button type="button" className="button button-primary" onClick={() => { setRunCount((n) => n + 1); showNotice(t.actions.rerunNotice, "info", "page"); }}>↻ <span>{t.actions.run}</span></button>
            </div>
          </div>

          <div className="demo-banner" role="note">
            <span aria-hidden="true">ⓘ</span>
            <p><strong>{t.banner.lead}</strong> {t.banner.body}</p>
            {review.status !== "loading" && Object.keys(review.store).length > 0 && <button type="button" className="ghost-button" onClick={resetAllReviews}>{t.banner.clear}</button>}
          </div>
          {review.problem && <div className={`demo-banner demo-banner-${review.problem.tone}`} role="alert"><span aria-hidden="true">!</span><p>{storageText(review.problem, t)}</p></div>}
          <NoticeRegion notice={notice} placement="page" onDismiss={() => showNotice("")} dismissLabel={t.notice.dismiss} />

          <div className="kpi-grid">
            <div className="kpi-card"><div className="kpi-top"><span>{t.kpi.signOff}</span><span className="kpi-icon icon-slate">▤</span></div><div className="kpi-value">{reviewLoading ? "—" : queueCounts.reviewed}<span className="kpi-unit">{t.kpi.reviewedUnit(invoices.length)}</span></div><div className="kpi-foot"><span className="foot-dot neutral" />{reviewLoading ? t.kpi.loadingDecisions : t.kpi.awaiting(queueCounts.awaiting + queueCounts.flagged)}</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>{t.kpi.reconciled}</span><span className="kpi-icon icon-green">✓</span></div><div className="kpi-value">{matchedCount}<span className="kpi-unit">{t.kpi.ofTotal(invoices.length)}</span></div><div className="kpi-foot"><span className="foot-dot good" />{t.kpi.matchedEvidence(reconciledValue)}</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>{t.kpi.exceptions}</span><span className="kpi-icon icon-amber">!</span></div><div className="kpi-value">{exceptions.length}<span className="kpi-unit">{t.kpi.needAttention(exceptions.length)}</span></div><div className="kpi-foot"><span className="foot-dot warning" />{t.kpi.overdue(overdueCount)}</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>{t.kpi.exposure}</span><span className="kpi-icon icon-purple">⌁</span></div><div className="kpi-value">{formatCurrencyTotals(exposureTotals, formatMoney(0, "PLN", locale), locale)}<span className="kpi-unit">{t.kpi.flagged}</span></div><div className="kpi-foot"><span className="foot-dot neutral" />{t.kpi.exposureFoot}</div></div>
          </div>

          <div className="content-grid">
            <section className="panel reconciliation-panel">
              <div className="panel-header"><div><h2>{t.panel.title}</h2><p>{t.panel.subtitle(formatDate(DEMO_AS_OF, "long", locale))}</p></div><div className="panel-header-actions"><button type="button" className="ghost-button" onClick={() => showNotice(t.actions.sampleNotice, "info", "page")}>{t.actions.sample} <span>⌄</span></button></div></div>
              <ReviewToolbar query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} counts={filterCounts} reviewCountsPending={reviewLoading} t={t} />
              <CurrencySummaryStrip summaries={currencySummaries} locale={locale} t={t} />
              {filteredResults.length === 0 ? (
                <div className="empty-state" role="status">
                  <strong>{t.empty.title}</strong>
                  <p>{query.trim() ? t.empty.search(query.trim(), filter === "all" ? "" : t.filters[filter]) : filter === "needs_review" ? t.empty.signedOff : t.empty.noneInFilter(t.filters[filter])}</p>
                  <div className="empty-state-actions">
                    {query && <button type="button" className="ghost-button" onClick={() => setQuery("")}>{t.empty.clearSearch}</button>}
                    {filter !== "all" && <button type="button" className="ghost-button" onClick={() => setFilter("all")}>{t.empty.showAll}</button>}
                  </div>
                </div>
              ) : <div className="table-scroll"><table><caption className="sr-only">{t.table.caption(filter === "all" ? "" : t.filters[filter], query.trim())}</caption><thead><tr><th scope="col">{t.table.invoiceVendor}</th><th scope="col">{t.table.invoiceAmount}</th><th scope="col">{t.table.payment}</th><th scope="col">{t.table.autoStatus}</th><th><span className="sr-only">{t.panel.open}</span></th></tr></thead><tbody>
                {filteredResults.map((result) => {
                  const selected = active.invoice.id === result.invoice.id;
                  const decision = decisions[result.invoice.id];
                  const hasNote = Boolean(getReviewEntry(review.store, result.invoice.id).note);
                  return <tr key={result.invoice.id} className={selected ? "selected-row" : ""} onClick={() => selectResult(result)}>
                  <td><button type="button" className="row-select" aria-current={selected ? "true" : undefined} aria-label={t.table.select(result.invoice.number)} onClick={(e) => { e.stopPropagation(); selectResult(result); }}><span className="invoice-cell"><span className={`vendor-avatar avatar-${result.status}`} aria-hidden="true">{initials(result.invoice.vendor)}</span><span><strong>{result.invoice.vendor}</strong><small>{result.invoice.number} · {locale === "pl" ? EXPENSE_CATEGORIES[result.invoice.category].polish : EXPENSE_CATEGORIES[result.invoice.category].label}</small></span></span></button></td>
                  <td><strong className="amount-cell">{formatMoney(result.invoice.grossMinor, result.invoice.currency, locale)}</strong><small className="date-cell">{t.table.due(formatDate(result.invoice.dueAt, "short", locale))} <DueChip result={result} label={t.table.overdue} /></small></td>
                  <td><span className="payment-cell">{result.matchedPayments.length ? formatMoney(paymentTotal(result), result.invoice.currency, locale) : "—"}</span><small className="date-cell">{result.matchedPayments.length ? result.matchedPayments.length > 1 ? t.table.transfers(result.matchedPayments.length) : result.matchedPayments[0].bookedAt : result.crossCurrencyPayments.length ? t.table.otherCurrency(result.crossCurrencyPayments[0].currency) : t.table.noPayment}</small></td>
                  <td><span className={statusClass(result.status)}><span className="status-dot" />{t.status[result.status]}</span>{!reviewLoading && (decision || hasNote) && <small className="review-chips">{decision && <span className={`review-chip review-chip-${decision}`} title={t.table.decisionTitle}>{decision === "reviewed" ? t.table.reviewed : t.table.flagged}</span>}{hasNote && <span className="review-chip" title={t.table.noteTitle}>{t.table.note}</span>}</small>}</td><td className="row-chevron" aria-hidden="true">›</td>
                </tr>;
                })}
              </tbody></table></div>}
              <div className="table-footer" aria-live="polite"><span>{t.table.showing(filteredResults.length, results.length)}</span><span className="table-footer-right"><span className="mini-green" /> {t.table.matched(filteredResults.filter((r) => r.status === "matched").length)} <span className="mini-amber" /> {t.table.exceptions(filteredResults.filter((r) => r.status !== "matched").length)}</span></div>
            </section>

            <aside className="panel detail-panel" ref={detailRef} aria-label={t.table.select(active.invoice.number)}>
              <div className="detail-topline"><span className="detail-label">{t.detail.eyebrow}</span><span className="detail-number">{activeIndex >= 0 ? t.detail.position(activeIndex + 1, filteredResults.length) : t.detail.hidden}</span></div>
              <div className="detail-vendor"><span className={`vendor-avatar large avatar-${active.status}`}>{initials(active.invoice.vendor)}</span><div><h2>{active.invoice.vendor}</h2><p>{active.invoice.number} · {active.invoice.vendorNip ? t.detail.nip(formatNip(active.invoice.vendorNip)) : t.detail.foreignVendor(active.invoice.vendorCountry)}</p></div></div>
              <div className="detail-statuses"><span className="detail-label">{t.detail.autoCheck}</span><span className={statusClass(active.status)} title={t.detail.autoTitle}><span className="status-dot" />{t.status[active.status]}</span><DueChip result={active} label={t.table.overdue} /></div>
              <div className="compare-box"><div><span>{t.detail.invoiceGross}</span><strong>{formatMoney(active.invoice.grossMinor, active.invoice.currency, locale)}</strong></div><div className="compare-divider">{active.status === "missing_payment" ? "?" : active.status === "matched" ? "=" : "↔"}</div><div><span>{t.detail.paymentTotal}</span><strong>{active.matchedPayments.length ? formatMoney(paymentTotal(active), active.invoice.currency, locale) : "—"}</strong></div></div>
              <dl className="invoice-facts">
                <div><dt>{t.detail.net}</dt><dd>{formatMoney(active.invoice.netMinor, active.invoice.currency, locale)}</dd></div>
                <div><dt>{t.detail.vat(t.vat[active.invoice.vatRate])}</dt><dd>{formatMoney(active.invoice.vatMinor, active.invoice.currency, locale)}</dd></div>
                <div><dt>{t.detail.issuedDue}</dt><dd>{formatDate(active.invoice.issuedAt, "short", locale)} → {formatDate(active.invoice.dueAt, "long", locale)}</dd></div>
                <div><dt>{t.detail.category}</dt><dd>{locale === "pl" ? EXPENSE_CATEGORIES[active.invoice.category].polish : EXPENSE_CATEGORIES[active.invoice.category].label} <small>({locale === "pl" ? EXPENSE_CATEGORIES[active.invoice.category].label : EXPENSE_CATEGORIES[active.invoice.category].polish})</small></dd></div>
              </dl>
              {active.reviewReasons.length > 0 && <div className="detail-block review-block"><div className="detail-block-heading"><span>!</span> {t.detail.why}</div><ul>{active.reviewReasons.map((reason) => <li key={reason.code}>{displayReviewReason(active, reason, locale)}</li>)}</ul></div>}
              <div className="detail-block"><div className="detail-block-heading"><span>⌁</span> {t.detail.evidence}</div><p>{paymentReference}</p>{active.matchedPayments.length > 0 && <div className="evidence-row"><span className="evidence-check">✓</span><span>{t.detail.bankFound(active.matchedPayments[0].account)}</span><span className="evidence-date">{active.matchedPayments[0].bookedAt}</span></div>}{active.matchedPayments.length === 0 && <div className="evidence-row evidence-missing"><span>!</span><span>{active.crossCurrencyPayments.length ? t.detail.otherOnly : t.detail.noneFound}</span></div>}</div>
              <div className="ai-card"><div className="ai-card-head"><span className="ai-sparkle">✳</span><div><strong>{t.ai.title}</strong><small>{t.ai.subtitle}</small></div><span className="ai-live-dot" /></div><p className="ai-explanation">{currentExplanation}</p>{savedExplanation?.locale === locale && <div className="analysis-meta"><span className={savedExplanation.mode === "nicrron" ? "meta-live" : "meta-demo"}>{savedExplanation.mode === "nicrron" ? t.ai.nicrron : t.ai.rules}</span>{savedExplanation.latencyMs !== undefined && <span>{savedExplanation.latencyMs} ms</span>}</div>}</div>
              <div className="detail-actions"><button type="button" className="button button-primary analyze-button" onClick={analyze} disabled={loading}>{loading ? <><span className="spinner" /> {t.ai.analyzing}</> : <><span>✳</span> {t.ai.explain}</>}</button><button type="button" className="button button-secondary" onClick={speak} disabled={speakLoading} title={t.ai.listenTitle}>{speakLoading ? t.ai.preparing : t.ai.listen}</button></div>
              <ReviewPanel key={active.invoice.id} entry={activeEntry} queueState={activeQueueState} storageStatus={review.status} locale={locale} t={t} onUpdate={applyReview} onUndo={undoActiveReview} />
              <NoticeRegion notice={notice} placement="detail" onDismiss={() => showNotice("")} dismissLabel={t.notice.dismiss} />
              <div className="human-note"><span>◈</span><p><strong>{t.human.lead}</strong> — {t.human.body}</p></div>
            </aside>
          </div>

          <div className="bottom-grid">
            <div className="bottom-card"><div className="bottom-icon icon-purple">◉</div><div><div className="bottom-title">{t.bottom.observabilityTitle} <span className="integration-pill">PRISM</span></div><p>{t.bottom.observability}</p></div><span className="bottom-arrow">↗</span></div>
            <div className="bottom-card"><div className="bottom-icon icon-blue">⌘</div><div><div className="bottom-title">{t.bottom.routingTitle} <span className="integration-pill">NICRRON</span></div><p>{t.bottom.routing}</p></div><span className="bottom-arrow">↗</span></div>
            <div className="bottom-card"><div className="bottom-icon icon-orange">♫</div><div><div className="bottom-title">{t.bottom.voiceTitle} <span className="integration-pill">ELEVENLABS</span></div><p>{t.bottom.voice}</p></div><span className="bottom-arrow">↗</span></div>
          </div>
          <footer className="footer"><span>{t.footer.copyright}</span><span>{t.footer.synthetic} <span className="footer-separator">·</span> {t.footer.noConnection} <span className="footer-separator">·</span> {t.footer.notAdvice} <span className="footer-separator">·</span> {t.footer.run(runCount)}</span></footer>
        </div>
      </section>
      <audio ref={audioRef} className="hidden-audio" onEnded={(e) => { URL.revokeObjectURL(e.currentTarget.src); }} />
    </main>
  );
}
