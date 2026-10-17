# Deployed CloseMate smoke test

Tested `https://closemate-starter.vercel.app/` on 2026-10-17 around 18:12–18:15 UTC.

Scope: production deployment only. One successful live AI request was made. No voice-provider call succeeded, no load test was run, and no credentials are included below.

## Executive result

**FAIL.** The public alias serves a stale six-invoice, USD-only build rather than the nine-invoice multi-currency workflow in the current workspace. The one AI request worked, and a genuinely new PRISM trace arrived, but that deployed trace contains data forbidden by the privacy contract. The deployed API responses also lack `Cache-Control: no-store`.

Deployment evidence:

- Vercel reports production deployment `dpl_G6kqTmEhm8WQb466ndq5VwMsWpW8` as `READY`, from commit `677ae298e2685ca1b35baff055377a55f775a8a0`.
- The local workspace is based on `a6c593193e46469d121b034831a17adb27cc44b4`, with additional uncommitted work. Local-only behavior was not treated as deployed evidence.

## 1. Access

- **PASS — Homepage loads.** Direct browser navigation rendered the CloseMate dashboard with title `CloseMate — Finance close, with evidence`. An independent unauthenticated request returned HTTP 200. The navigation timing API also reported status 200, and the page’s core CSS/JavaScript resources loaded without a visible application error.
- **FAIL — Synthetic-data banner.** No element with `role="note"` or `role="alert"` was present, and the rendered page did not contain the expected `Synthetic records only` banner. A small footer says `Demo data only`, which is not the requested banner.
- **FAIL — Product limitations are clearly explained.** The page says `Read-only demo`, `No real accounts connected`, and that CloseMate does not initiate transfers or change the ledger. It does not clearly disclose the fuller limitations expected here, including no PDF/OCR import, cloud document storage, bank/KSeF connection, or tax/deductibility advice.
- **PASS — Public judge access.** Both browser navigation and an unauthenticated HTTP request reached the application directly. The response body was not a Vercel Authentication/login page.

## 2. Dashboard

- **FAIL — Nine synthetic invoices.** The rendered table and footer showed exactly 6 invoices, not 9.
- **FAIL — PLN, EUR, and USD totals shown separately.** Every rendered record was USD. No per-currency totals strip was present.
- **FAIL — Search and filter chips.** No search field or filter chips exist in the deployed DOM, so they could not be exercised.
- **FAIL — Review, undo, and reviewer notes.** These controls are absent from the deployed build.
- **PASS — Notices do not block controls.** Before the AI request there was no notice/overlay, and all existing actionable buttons were enabled. The post-analysis notice rendered in normal flow and did not disable the other controls. This does not compensate for the missing controls above.

## 3. Financial workflow

- **PASS — Amount mismatch.** `INV-2042` displayed an invoice total of USD 2,480.00 and payment total of USD 2,840.00, a USD 360.00 overage. It was labeled `Amount mismatch`, told the reviewer to keep it open and investigate, and said no payment or refund had been initiated.
- **PASS — Suspected duplicate.** `INV-2044` was labeled `Possible duplicate`, with a USD 750.00 invoice and two transfers totaling USD 1,500.00. The recommendation was to verify both transactions before requesting a recall or refund; it was not presented as safely settled.
- **PASS — Missing payment.** `INV-2043` was labeled `Missing payment`, showed no candidate transaction and no payment total, and explicitly said not to mark it paid without evidence.
- **NOT VERIFIED — Different currencies never match.** The deployed dataset is USD-only, so no cross-currency case exists to test. The current local implementation cannot substitute for deployed evidence.

## 4. AI

- **PASS — Exactly one successful live request.** `Explain with AI` was clicked once for the amount-mismatch invoice. No second successful analysis request was made.
- **PASS — Mode shown.** The UI displayed `NICRRON AI`, not `RULE-BASED DEMO`.
- **PASS — Evidence versus assumptions.** The explanation labeled recorded invoice/payment details as facts and possible interpretations as hypotheses that the data could not confirm. It required human review before action.
- **PASS — No claim that money moved.** The explanation recommended checks and confirmation; it did not claim that CloseMate transferred, paid, refunded, or changed a ledger.
- **PASS — Latency/error recorded.** UI latency was 4,491 ms; browser request duration was 5,302 ms. The PRISM trace recorded 2,524 ms. No user-visible error appeared. The success notice said `Nicrron analysis complete · PRISM trace sent.`

The full prompt and provider response are intentionally omitted from this report.

## 5. PRISM

- **PASS — A new trace arrived.** The newest trace was created at `2026-10-17T18:13:30.440544Z`, seconds after this test’s request. Its session identified the tested `INV-2042`, and its agent was `closemate-reconciliation`. Older traces were present but were not used as proof.
- **PASS — Actual fields inspected.** The trace detail contained: `id`, `project_id`, `trace_id`, `model`, `input_messages`, `output_message`, `latency_ms`, token counts, `cost_usd`, `user_identifier`, `session_id`, `spans`, `metadata`, `guardrail_flags`, `pii_redacted`, `created_at`, `evaluation`, `db_spans`, and `related_traces`. Observed values included model `nicrron/auto`, latency 2,524 ms, `pii_redacted: false`, and no guardrail flags.
- **FAIL — Privacy-safe content.** The new trace contained the vendor name, a bank payment reference, the full task/model input, and the full model output. It therefore violates the required privacy shape. No NIP pattern, reviewer note, or known local credential was detected in this trace, but those absences do not offset the confirmed prohibited content.

## 6. Security

- **PASS — Request schemas inspected, with a deployment mismatch found.** The deployed client sends full `invoice`, `payments`, `status`, and `sessionId` values to `/api/analyze`, and sends client-authored `text` plus `sessionId` to `/api/speak`. This is the old deployed contract. The current local routes instead intend to accept only `{ invoiceId, sessionId? }`, resolve financial evidence server-side, reject extra fields, and cap JSON bodies at 2,048 bytes.
- **PASS — Invalid analysis request rejected.** A malformed, non-secret JSON request to `/api/analyze` returned HTTP 400 with `Request body must be JSON.` It did not invoke another successful AI call.
- **FAIL — Invalid speak request handling.** A malformed JSON request returned HTTP 503 for missing voice configuration before reporting a schema error. Validation therefore was not demonstrated at the endpoint boundary.
- **FAIL — Speak rejects client-supplied text.** The deployed JavaScript explicitly constructs `/api/speak` requests with a client-supplied `text` field. A non-secret text payload reached the endpoint and received the same configuration-level 503, not a rejection of the `text` field. No voice synthesis succeeded.
- **FAIL — Analysis responses use `Cache-Control: no-store`.** The observed `/api/analyze` 400 response had `Cache-Control: public, max-age=0, must-revalidate`, not `no-store`. The successful response was not repeated solely to re-inspect headers because that would violate the one-successful-AI-request limit.
- **PASS — No rate-limit stress test.** No repeated paid-provider or rate-limit test was performed.

## 7. Export

- **FAIL — Export filtered records as CSV.** No export control exists in the deployed application, so no CSV could be downloaded.
- **NOT VERIFIED — Polish headers and characters.** No deployed CSV was obtainable.
- **NOT VERIFIED — Notes excluded by default.** No deployed export or reviewer-note workflow exists.
- **NOT VERIFIED — Reviewer notes require explicit selection.** No deployed opt-in control exists.

## Remaining risks

1. The judge-facing alias does not contain the current nine-invoice, multi-currency, review, filtering, or export implementation.
2. The deployed PRISM integration stores forbidden business-identifying input and complete model text.
3. Deployed API responses are publicly cacheable rather than `no-store`.
4. The deployed voice contract accepts client-authored text, and configuration checks can run before request validation.
5. Cross-currency matching and CSV encoding/content remain untested on the deployed artifact because those features are absent.
