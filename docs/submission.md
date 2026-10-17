# CloseMate — Money Talks 2 submission draft

- **Track:** Money Operations
- **Repository:** https://github.com/a-k-holod/closemate-starter
- **Verified final deployment:** **[VERIFIED DEPLOYMENT URL]**
- **Submission form:** **[SUBMISSION FORM URL]**

## One-line pitch

CloseMate helps a small-business owner reconcile synthetic invoices and payment evidence, understand exceptions, and export review data for an accountant—while deterministic rules retain financial authority and AI remains explanatory.

## The problem

Small-business owners spend valuable time comparing invoices with payment records, investigating mismatches or possible duplicates, and preparing a structured handoff for an accountant. The work is repetitive, but the consequences are financial: a weak match or plausible-sounding AI response must not trigger a payment, refund, ledger change, or tax conclusion.

## The solution

CloseMate presents nine synthetic purchase invoices and separate synthetic payment records in a review queue. Deterministic code validates each invoice and labels it as matched, amount mismatch, missing payment, possible duplicate, or needing review. Search, filters, per-currency summaries, evidence details, local reviewer decisions, and notes help the owner work through exceptions.

For one selected exception, Nicrron can generate a short explanation from minimized structured evidence. PRISM records the model path and outcome. The owner can export all or filtered records as an accountant-oriented CSV; reviewer decisions and notes are excluded unless explicitly selected.

## Why this is Money Operations

CloseMate improves the process around month-end close:

- organizes invoice and payment evidence;
- makes exception queues easier to review;
- separates automatic checks from human decisions;
- explains why a record needs attention;
- packages filtered data for accountant handoff.

It does not attempt autonomous finance. Money arithmetic, validation, matching, status selection, due-state calculation, and export values are deterministic. AI does not calculate or approve anything. CloseMate cannot initiate a transfer or refund, change a ledger, submit to KSeF, or decide tax treatment.

## How it works

1. `lib/demo-data.ts` supplies nine fictional invoices and eight fictional payment records in PLN, EUR, and USD.
2. `lib/invoice.ts` validates amounts, VAT consistency, dates, currencies, and Polish NIP checksums.
3. `lib/reconcile.ts` links likely evidence conservatively, refuses cross-currency matches, and produces deterministic statuses and deltas.
4. The dashboard keeps the automatic result separate from the reviewer’s decision, which is stored only in browser local storage.
5. `/api/analyze` accepts an invoice ID, resolves the record server-side, and asks Nicrron to explain the precomputed result.
6. Unsafe, empty, unavailable, or rate-limited model output falls back to a deterministic explanation.
7. `lib/prism.ts` emits minimized model-run metadata to PRISM.
8. `lib/accountant-export.ts` generates the filtered or complete CSV.

## Sponsor technology

### Nicrron

CloseMate uses Nicrron’s OpenAI-compatible API for exception explanations. The current implementation sends internal IDs, record type, category, dates, formatted amounts, deterministic status, reason codes, and relevant payment IDs/dates/amounts. It excludes vendor names, NIPs, invoice numbers, counterparties, transfer references, account names, and reviewer notes.

This integration is useful because natural-language explanation is valuable after deterministic reconciliation has identified an exception. The model can distinguish known evidence from a possible explanation and suggest a human check without becoming the source of financial truth.

Verified result: on 2026-10-17, one live Nicrron request succeeded on the existing public deployment. The UI displayed `NICRRON AI`; the answer distinguished evidence from hypotheses, recommended human review, and did not claim that money moved. That deployment is an older build, so this result verifies connectivity and behavior of the old version, not the current minimized request contract.

### PRISM

The current integration records agent ID, session ID, internal invoice ID, reconciliation status, reason codes, model, observed latency, outcome, counts, provider status, and guardrail flags. This makes it possible to correlate a visible explanation with the model and fallback path while minimizing the financial content copied into observability.

Verified result: a new PRISM trace arrived for the live request above and matched its invoice session. However, the old deployed trace also contained a vendor name, bank reference, full model input, and full model output, with `pii_redacted: false`. That is a failed privacy result, not a success claim.

The current repository replaces that old trace shape with a strict minimized payload. Automated tests verify that seeded vendor data, NIPs, invoice numbers, bank references, reviewer notes, prompts, model text, and credentials do not appear in generated trace bodies. A privacy-safe live trace from a deployment of the current repository remains to be verified.

## Trust and safety

- Financial calculations use deterministic integer-minor-unit code.
- Payments in different currencies are never matched or converted.
- AI explains a supplied result; it cannot change the result.
- The prompt requires evidence/hypothesis separation and human review.
- A deterministic screen blocks specified money-movement, ledger-change, refund, external-system, and tax claims; blocked output falls back to rules. This pattern screen is a safety layer, not a proof that all possible bad wording is impossible.
- Reviewer notes stay in the browser and are not sent to the model or PRISM.
- Trace data is allow-listed to internal IDs, enums, counts, timing, model, and outcome metadata.
- Human review is required before any real-world action.

## Demonstration

The three-minute walkthrough in `docs/demo-script.md` shows:

1. a PLN 738.00 invoice with a PLN 600.00 candidate payment;
2. two PLN 1,476.00 transfers referencing one invoice;
3. an overdue invoice with no candidate payment;
4. a live Nicrron explanation for that missing-payment exception;
5. the PRISM trace with the same session ID;
6. a filtered accountant CSV; and
7. the explicit boundary between automatic checks and human sign-off.

Only show steps 4 and 5 as successful live sponsor integrations after the final deployment has passed the pre-demo gate.

## Verification evidence

Current workspace, rerun 2026-10-17:

- 237 of 237 automated tests passed across 11 test files.
- TypeScript type-check passed.
- Next.js 16.4.2 production build passed.

The test suite covers deterministic money logic, invoice validation, all reconciliation statuses, cross-currency handling, review state, filters, CSV formatting and injection defenses, API validation, rate limiting, model fallbacks, output guardrails, and model/trace privacy. External-provider tests use fakes unless explicitly identified as the single live request above.

Existing public deployment, tested 2026-10-17:

- homepage publicly accessible;
- stale six-invoice, USD-only build;
- amount-mismatch, duplicate, and missing-payment cases visible;
- one successful live Nicrron explanation;
- one corresponding PRISM trace received;
- trace privacy failed;
- no filtered CSV control;
- current nine-invoice workflow not deployed.

The complete evidence is in `docs/deployed-smoke-test.md`.

## Limitations

- All records are synthetic and bundled with the prototype.
- There is no production invoice storage or document-management system.
- There is no PDF or OCR extraction.
- There is no KSeF connection.
- There is no bank connectivity.
- There is no authentication or multi-user authorization.
- There is no tax advice or automated deductibility decision.
- There is no payment, refund, ledger, or accounting automation.
- Mixed-rate, corrective, and ambiguous partial-payment cases require manual review.
- Payment assignment is conservative, not a globally optimal matcher.
- Reviewer decisions and notes are local to one browser.
- Live output from the optional voice control was not successfully tested and is not included in the submission claims.
- The final deployment URL is not yet verified against the current workspace.

## Before submitting

- [ ] Deploy the current workspace without changing its documented behavior.
- [ ] Replace **[VERIFIED DEPLOYMENT URL]** after a fresh public smoke test.
- [ ] Verify one live Nicrron explanation on that exact deployment.
- [ ] Inspect the corresponding PRISM trace and confirm the minimized privacy shape.
- [ ] Verify the filtered CSV download on the deployed build.
- [ ] Replace **[SUBMISSION FORM URL]** when the organizer link is known.

## Information still required from the organizers

- [ ] Official submission form URL.
- [ ] Repository visibility and judging-access rules.
- [ ] Final deadline and timezone.
- [ ] Video host, format, and maximum length.
- [ ] Sponsor-track proof requirements.
- [ ] Required team-member, consent, or eligibility fields.
