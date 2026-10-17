"use client";

import { useMemo, useRef, useState } from "react";
import { demoExplanation, invoices, payments, results, type ReconciliationResult, type ReconciliationStatus } from "@/lib/reconcile";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
const statusLabel: Record<ReconciliationStatus, string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  missing_payment: "Missing payment",
  possible_duplicate: "Possible duplicate"
};

function statusClass(status: ReconciliationStatus) {
  return `status status-${status}`;
}

export default function Home() {
  const [active, setActive] = useState<ReconciliationResult>(results.find((r) => r.status !== "matched") ?? results[0]);
  const [explanations, setExplanations] = useState<Record<string, { text: string; mode: "nicrron" | "rules"; latencyMs?: number }>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [speakLoading, setSpeakLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef("");
  const [runCount, setRunCount] = useState(1);

  const matchedCount = results.filter((r) => r.status === "matched").length;
  const exceptions = results.filter((r) => r.status !== "matched");
  const reconciledValue = results.filter((r) => r.status === "matched").reduce((sum, r) => sum + r.invoice.amount, 0);
  const currentExplanation = explanations[active.invoice.id]?.text ?? demoExplanation(active);

  const paymentReference = useMemo(() => {
    if (!active.matchedPayments.length) return "No candidate payment";
    return active.matchedPayments.map((p) => `${p.id} · ${p.reference}`).join(" | ");
  }, [active]);

  async function analyze() {
    setLoading(true);
    setNotice("");
    const sessionId = `closemate-demo-${active.invoice.id}-${Date.now()}`;
    sessionRef.current = sessionId;
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice: active.invoice,
          payments: active.matchedPayments,
          status: active.status,
          sessionId
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analysis failed.");
      setExplanations((prev) => ({ ...prev, [active.invoice.id]: { text: data.explanation, mode: data.mode, latencyMs: data.latencyMs } }));
      setNotice(data.mode === "nicrron" ? `Nicrron analysis complete${data.traceConfigured ? " · PRISM trace sent" : " · PRISM credentials not configured"}.` : "Rules-based demo explanation shown. Add a Nicrron API key to run the AI analysis.");
      setRunCount((n) => n + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function speak() {
    setSpeakLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${active.invoice.vendor}. Invoice ${active.invoice.id}. ${currentExplanation}`,
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
      setNotice(error instanceof Error ? error.message : "Voice generation failed.");
    } finally {
      setSpeakLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">C</span><span>closemate</span><span className="beta">BETA</span></div>
        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace"><span className="workspace-icon">N</span><span><strong>Northstar Studio</strong><small>Finance operations</small></span><span className="chevron">⌄</span></button>
        <nav className="nav-list" aria-label="Main navigation">
          <div className="nav-section">OPERATIONS</div>
          <button className="nav-item"><span>▦</span> Overview</button>
          <button className="nav-item nav-active"><span>⇄</span> Reconciliation <span className="nav-count">3</span></button>
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
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> MONTH-END CLOSE · OCTOBER 2026</div><h1>Reconciliation, <em>under control.</em></h1><p className="subtitle">Find the exceptions. Understand the why. Close with evidence.</p></div><button className="button button-primary" onClick={() => { setRunCount((n) => n + 1); setNotice("Reconciliation re-run on the sample data. No money moved."); }}>↻ <span>Run reconciliation</span></button></div>

          <div className="kpi-grid">
            <div className="kpi-card"><div className="kpi-top"><span>Invoices reviewed</span><span className="kpi-icon icon-slate">▤</span></div><div className="kpi-value">{invoices.length}<span className="kpi-unit"> invoices</span></div><div className="kpi-foot"><span className="foot-dot neutral" />Across sample bank activity</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>Reconciled</span><span className="kpi-icon icon-green">✓</span></div><div className="kpi-value">{matchedCount}<span className="kpi-unit"> of {invoices.length}</span></div><div className="kpi-foot"><span className="foot-dot good" />{money(reconciledValue)} matched with evidence</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>Exceptions to review</span><span className="kpi-icon icon-amber">!</span></div><div className="kpi-value">{exceptions.length}<span className="kpi-unit"> need attention</span></div><div className="kpi-foot"><span className="foot-dot warning" />No automatic payment actions</div></div>
            <div className="kpi-card"><div className="kpi-top"><span>Potential exposure</span><span className="kpi-icon icon-purple">⌁</span></div><div className="kpi-value">{money(360 + 750)}<span className="kpi-unit"> flagged</span></div><div className="kpi-foot"><span className="foot-dot neutral" />Mismatch + duplicate candidate</div></div>
          </div>

          <div className="content-grid">
            <section className="panel reconciliation-panel">
              <div className="panel-header"><div><h2>Invoice reconciliation</h2><p>Bank activity matched against supplier invoices</p></div><button className="ghost-button" onClick={() => setNotice("Showing the seeded October demo dataset.")}>Sample data <span>⌄</span></button></div>
              <div className="table-scroll"><table><thead><tr><th>INVOICE / VENDOR</th><th>INVOICE AMOUNT</th><th>PAYMENT</th><th>STATUS</th><th></th></tr></thead><tbody>
                {results.map((result) => <tr key={result.invoice.id} className={active.invoice.id === result.invoice.id ? "selected-row" : ""} onClick={() => setActive(result)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setActive(result); }}>
                  <td><div className="invoice-cell"><span className={`vendor-avatar avatar-${result.status}`}>{result.invoice.vendor.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span><span><strong>{result.invoice.vendor}</strong><small>{result.invoice.id}</small></span></div></td>
                  <td><strong className="amount-cell">{money(result.invoice.amount)}</strong><small className="date-cell">Due {new Date(`${result.invoice.dueAt}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></td>
                  <td><span className="payment-cell">{result.matchedPayments.length ? money(result.matchedPayments.reduce((s, p) => s + p.amount, 0)) : "—"}</span><small className="date-cell">{result.matchedPayments.length ? result.matchedPayments.length > 1 ? `${result.matchedPayments.length} transfers` : result.matchedPayments[0].date : "No payment found"}</small></td>
                  <td><span className={statusClass(result.status)}><span className="status-dot" />{statusLabel[result.status]}</span></td><td className="row-chevron">›</td>
                </tr>)}
              </tbody></table></div>
              <div className="table-footer"><span>Showing 6 of 6 invoices</span><span className="table-footer-right"><span className="mini-green" /> {matchedCount} matched <span className="mini-amber" /> {exceptions.length} exceptions</span></div>
            </section>

            <aside className="panel detail-panel">
              <div className="detail-topline"><span className="detail-label">EXCEPTION REVIEW</span><span className="detail-number">{String(results.findIndex((r) => r.invoice.id === active.invoice.id) + 1).padStart(2, "0")} / 06</span></div>
              <div className="detail-vendor"><span className={`vendor-avatar large avatar-${active.status}`}>{active.invoice.vendor.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span><div><h2>{active.invoice.vendor}</h2><p>{active.invoice.id} · Due {active.invoice.dueAt}</p></div></div>
              <span className={statusClass(active.status)}><span className="status-dot" />{statusLabel[active.status]}</span>
              <div className="compare-box"><div><span>INVOICE TOTAL</span><strong>{money(active.invoice.amount)}</strong></div><div className="compare-divider">{active.status === "missing_payment" ? "?" : active.status === "matched" ? "=" : "↔"}</div><div><span>PAYMENT TOTAL</span><strong>{active.matchedPayments.length ? money(active.matchedPayments.reduce((sum, p) => sum + p.amount, 0)) : "—"}</strong></div></div>
              <div className="detail-block"><div className="detail-block-heading"><span>⌁</span> Evidence found</div><p>{paymentReference}</p>{active.matchedPayments.length > 0 && <div className="evidence-row"><span className="evidence-check">✓</span><span>Bank record found</span><span className="evidence-date">{active.matchedPayments[0].date}</span></div>}{active.matchedPayments.length === 0 && <div className="evidence-row evidence-missing"><span>!</span><span>No candidate transaction found</span></div>}</div>
              <div className="ai-card"><div className="ai-card-head"><span className="ai-sparkle">✳</span><div><strong>CloseMate insight</strong><small>AI-assisted · Human approval required</small></div><span className="ai-live-dot" /></div><p className="ai-explanation">{currentExplanation}</p>{explanations[active.invoice.id] && <div className="analysis-meta"><span className={explanations[active.invoice.id].mode === "nicrron" ? "meta-live" : "meta-demo"}>{explanations[active.invoice.id].mode === "nicrron" ? "NICRRON AI" : "RULE-BASED DEMO"}</span>{explanations[active.invoice.id].latencyMs !== undefined && <span>{explanations[active.invoice.id].latencyMs} ms</span>}</div>}</div>
              <div className="detail-actions"><button className="button button-primary analyze-button" onClick={analyze} disabled={loading}>{loading ? <><span className="spinner" /> Analyzing…</> : <><span>✳</span> Explain with AI</>}</button><button className="button button-secondary" onClick={speak} disabled={speakLoading}>{speakLoading ? "Preparing voice…" : "♫ Listen"}</button></div>
              <div className="human-note"><span>◈</span><p><strong>Human-in-the-loop</strong> — CloseMate explains and flags. It never initiates a transfer or changes your ledger.</p></div>
            </aside>
          </div>

          <div className="bottom-grid">
            <div className="bottom-card"><div className="bottom-icon icon-purple">◉</div><div><div className="bottom-title">AI observability <span className="integration-pill">PRISM</span></div><p>Model explanations are traceable by session, with latency and failure fallback captured when configured.</p></div><span className="bottom-arrow">↗</span></div>
            <div className="bottom-card"><div className="bottom-icon icon-blue">⌘</div><div><div className="bottom-title">Model routing <span className="integration-pill">NICRRON</span></div><p>Use one OpenAI-compatible endpoint for model access; fallback rules keep the demo usable.</p></div><span className="bottom-arrow">↗</span></div>
            <div className="bottom-card"><div className="bottom-icon icon-orange">♫</div><div><div className="bottom-title">Voice briefing <span className="integration-pill">ELEVENLABS</span></div><p>Listen to an exception summary when the voice API key is configured.</p></div><span className="bottom-arrow">↗</span></div>
          </div>
          {notice && <div className="notice" role="status"><span>ⓘ</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}
          <footer className="footer"><span>© 2026 CloseMate · Built for Money Talks 2</span><span>Demo data only <span className="footer-separator">·</span> No real accounts connected <span className="footer-separator">·</span> Run #{runCount}</span></footer>
        </div>
      </section>
      <audio ref={audioRef} className="hidden-audio" onEnded={(e) => { URL.revokeObjectURL(e.currentTarget.src); }} />
    </main>
  );
}
