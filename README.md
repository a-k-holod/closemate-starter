# CloseMate — finance close, with evidence

Money Talks 2 AI Finance Hackathon · Money Operations

CloseMate helps a small-business owner reconcile invoices and payment evidence, investigate exceptions, and prepare a structured CSV for an accountant. It reduces finance-operations busywork without making autonomous financial decisions.

> **Synthetic prototype.** Every vendor, NIP, invoice, and payment record is fictional. CloseMate has no production invoice storage, PDF extraction, KSeF connection, bank connection, tax-advice function, or automated accounting. It does not move money or change a ledger.

## Links and submission status

- Repository: https://github.com/a-k-holod/closemate-starter
- Final verified deployment: **[VERIFIED DEPLOYMENT URL — required after the current workspace is deployed and smoke-tested]**
- Submission form: **[SUBMISSION FORM URL — not found in the repository]**
- Previously inspected deployment: https://closemate-starter.vercel.app/ — **not submission-ready**; see [deployment evidence](docs/deployed-smoke-test.md).

The inspected public deployment is a stale six-invoice build from commit `677ae298e2685ca1b35baff055377a55f775a8a0`. It does not contain the current nine-record workflow or CSV export. Its one tested Nicrron request succeeded and produced a PRISM trace, but that old trace contained prohibited vendor, bank-reference, prompt, and model-output text. Do not use that deployment as evidence for the privacy-safe implementation in this workspace.

## The problem

Small-business owners lose time reconciling invoices with payment records, investigating missing or duplicate payments, and assembling review data for an accountant. The work is repetitive but financially sensitive: an unexplained mismatch should not become an automatic payment, refund, ledger entry, or tax conclusion.

## The solution

The current repository:

1. Loads nine synthetic purchase invoices and separate synthetic bank-payment records from `lib/demo-data.ts`.
2. Validates invoice data and reconciles it deterministically in `lib/reconcile.ts`.
3. Separates the automatic status from the reviewer’s local decision.
4. Supports search, status filters, per-currency totals, reviewer notes, and undo.
5. Uses Nicrron to explain one already-computed exception in plain language.
6. Emits a minimized PRISM trace for the model call.
7. Exports all or filtered records as an accountant-oriented CSV.

Statuses are `matched`, `amount_mismatch`, `missing_payment`, `possible_duplicate`, and `needs_review`. Payments are never matched across currencies. Invalid invoice data remains in review even when a payment amount matches.

## Money Operations, not autonomous finance

CloseMate improves the operating workflow around month-end close: it organizes evidence, highlights records that need attention, makes the reason easier to understand, and packages review data for handoff. Financial calculations use integer minor units and deterministic rules. AI never computes an amount, changes a status, initiates a transfer or refund, updates accounting records, or decides tax treatment. A person remains responsible for review and action.

## Sponsor technology

### Nicrron

`app/api/analyze/route.ts` calls Nicrron through its OpenAI-compatible endpoint. The current route accepts only `{ invoiceId, sessionId? }`, resolves the synthetic record server-side, and sends internal IDs, dates, categories, formatted amounts, deterministic statuses, reason codes, and payment evidence. It excludes vendor names, NIPs, invoice numbers, counterparties, bank references, account names, and reviewer notes.

Nicrron is useful here because it turns structured exception evidence into a short explanation while CloseMate retains control of all calculations and statuses. If the provider is unavailable, rate-limited, returns no text, or produces a blocked claim, the app displays its deterministic explanation.

Verified deployment result: one live request on the old public build completed successfully and the UI identified it as `NICRRON AI`. The explanation separated evidence from possible interpretations and required human review. This verifies provider connectivity only; it does not verify the current minimized request contract.

### PRISM

`lib/prism.ts` sends an observability event after a model response. The current event is limited to an internal invoice ID, status and reason enums, outcome category, model, latency, counts, provider status, guardrail flags, agent ID, and session ID. It does not intentionally include prompt text, model output, vendor data, NIP, bank references, or reviewer notes.

PRISM is useful because a reviewer can correlate a visible AI explanation with its model, outcome, latency, and guardrail path without making the trace a second store of financial text.

Verified deployment result: a new trace arrived for the old live request, but inspection found forbidden vendor, bank-reference, prompt, and model-output content with `pii_redacted: false`. The current repository changes the trace shape and has privacy tests, but a privacy-safe trace from a deployment of this version has **not** yet been verified.

## Trust and safety

- Money arithmetic, invoice validation, reconciliation status, due-state calculation, and CSV values are deterministic.
- The model explains supplied results; it has no financial authority.
- Model output is screened for claims that CloseMate moved money, issued a refund, changed a ledger, or made a tax determination. A deterministic fallback is used when screening fails.
- Human review is required before acting on an exception.
- Reviewer notes remain in browser storage and are excluded from export unless explicitly selected.
- Current trace code uses a strict allow-list of IDs, enums, counts, latency, and model metadata.
- API responses are `no-store`; request bodies are JSON-only, size-limited, and field-validated.

## Accountant CSV

The export uses UTF-8 with BOM, semicolon delimiters, CRLF line endings, Polish headers, decimal commas, and exact minor-unit serialization. Formula-like text is neutralized. Reviewer decisions and notes are excluded by default and add two clearly labelled columns only after explicit opt-in.

## Local setup

Requires Node.js 22 LTS or newer.

```bash
cp .env.example .env.local
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

Live AI requires server-side Nicrron credentials. Deployed paid calls also require the configured shared rate limiter. PRISM delivery requires its project ID and API key. Never commit secret values or expose them through `NEXT_PUBLIC_` variables.

## Verification

Re-run on 2026-10-17 against the current workspace:

- `npm test`: **237/237 tests passed** across 11 files.
- `npm run typecheck`: **passed**.
- `npm run build`: **passed** with Next.js 16.4.2.

These checks cover reconciliation scenarios, money and invoice validation, cross-currency behavior, filtering, review state, CSV escaping and opt-in notes, request validation, rate limiting, AI fallbacks and guardrails, and the minimized model/trace payloads. They use test doubles for external providers and are not proof of the current version running in production.

The separate production smoke test verified the older public deployment and documents its failures honestly. A new deployment and repeat smoke test are required before final submission.

## Limitations

- Data is synthetic and bundled with the demo.
- There is no authentication, production database, or production invoice/document storage.
- There is no PDF/OCR extraction, KSeF integration, or bank connectivity.
- There is no tax advice, deductibility decision, payment initiation, refund automation, ledger write, or automated accounting.
- Single-rate invoices are modeled; mixed-rate, corrective, and ambiguous partial-payment cases require review.
- Payment assignment is conservative rather than a globally optimal matching algorithm.
- Reviewer state is local to one browser and disappears if site data is cleared.
- Live output from the optional voice control was not successfully tested and is not part of the submission claims.

See [the three-minute demo script](docs/demo-script.md) and [the submission draft](docs/submission.md).
