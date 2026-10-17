# CloseMate — three-minute demo script

## Required pre-demo gate

Do not record against the previously tested `https://closemate-starter.vercel.app/`. On 2026-10-17 it served an older six-invoice build with no CSV export, and its PRISM trace contained prohibited business text.

Before recording:

1. Put the final URL here: **[VERIFIED DEPLOYMENT URL]**.
2. Open it in a private window and confirm it shows nine invoices, PLN/EUR/USD summaries, filters, review controls, and **Export for accountant**.
3. Run one Nicrron explanation and confirm the UI badge says **NICRRON AI**, not **RULE-BASED DEMO**.
4. Find that exact session in PRISM. Confirm its trace contains only the minimized event/status/reason payload and outcome metadata—no vendor, NIP, invoice number, bank reference, prompt, model output, reviewer note, or secret.
5. Download one filtered CSV and inspect it.
6. Clear local review decisions before recording.

If any check fails, do not claim it passed. Fix or disclose the failure before submission.

## Three-minute walkthrough

**0:00–0:20 — Problem and boundary**

> “Small-business owners spend time matching invoices to payment evidence and preparing a clean handoff for their accountant. CloseMate organizes that review. All records here are synthetic; calculations and statuses are deterministic, and AI only explains.”

Point to the PLN, EUR, and USD summaries.

> “Currencies stay separate. CloseMate does not convert them, move money, or write to a ledger.”

**0:20–0:50 — Invoice/payment mismatch**

Select **Amount mismatch**, then **Biuro Rachunkowe Przykład · 47/10/2026**.

> “The invoice gross is PLN 738.00, while the candidate transfer is PLN 600.00—the net amount. The PLN 138.00 gap may be unpaid VAT, and the item is two days overdue. The Auto check is a rules result, not approval.”

**0:50–1:10 — Duplicate and missing-payment cases**

Select **Possible duplicate**, then **Cowork Demo Kraków · FV/CW/2026/10/031**.

> “Two PLN 1,476.00 transfers reference one invoice. CloseMate flags a possible duplicate and PLN 1,476.00 of excess evidence; it does not request a refund.”

Select **Missing payment**, then **Kancelaria Demo Wiśniewska · KD/2026/09/12**.

> “No candidate payment was found, and the invoice is 13 days overdue. CloseMate will not mark it paid without evidence.”

**1:10–1:45 — Live AI explanation**

On the missing-payment record, click **Explain with AI**. Wait for **NICRRON AI**.

> “Nicrron explains the exception after CloseMate has calculated it. The current endpoint sends minimized structured evidence, not vendor names, NIPs, invoice numbers, bank references, or reviewer notes. A guardrail replaces unsupported action or tax claims with the deterministic explanation.”

If the badge says **RULE-BASED DEMO**, say:

> “The live model call did not complete, so this is the deterministic fallback. I am not presenting it as live AI.”

**1:45–2:10 — Corresponding PRISM trace**

Switch to PRISM and find the session beginning `closemate-demo-INV-2105-` created by the request just shown.

Show:

- agent `closemate-reconciliation`;
- model and observed latency;
- outcome such as `model_ok` or a named fallback;
- input fields `event`, `invoiceRef`, `reconciliationStatus`, and `reviewReasonCodes`;
- output metadata such as outcome and output character count.

> “PRISM lets us audit which model path ran and whether a fallback or guardrail was used. The trace is designed to minimize sensitive data rather than copy the financial narrative.”

If the trace is missing or contains prohibited text, state that plainly and stop using it as positive evidence.

**2:10–2:40 — Filtered accountant export**

Return to CloseMate. Select **Needs review**, then **Export for accountant → Filtered records**. Leave **Include my reviewer decisions & notes** off. Open the downloaded CSV.

> “The export includes only the filtered records, with Polish headers, semicolons, decimal commas, and the automatic reconciliation status. Local reviewer notes stay out unless the reviewer explicitly opts in.”

**2:40–3:00 — Human-review boundary**

Mark the selected item **Needs review** or **Reviewed**, and optionally add a short synthetic note.

> “This decision is made by a person and stored only in this browser. CloseMate organizes evidence and explains exceptions. It does not connect to a bank or KSeF, initiate payments or refunds, provide tax advice, or automate accounting. Final action remains with the owner and accountant.”
