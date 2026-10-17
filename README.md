# CloseMate — Finance close, with evidence

**Track:** Money Operations
**One-liner:** CloseMate reconciles supplier invoices against bank activity, highlights exceptions, explains them with AI, and records model traces for review.

This starter uses synthetic demo data only. Matching and money calculations are deterministic application code; the model explains results and suggests checks. It does not initiate payments, alter ledgers, or connect to bank accounts.

## What is implemented

- A reconciliation workspace for a Polish sole proprietorship (JDG) with nine synthetic purchase invoices (PLN, EUR, USD) and separate bank-statement evidence. Vendor NIPs use the unissued `000` tax-office prefix, so none can belong to a real business.
- Invoice model with vendor invoice number, NIP, issue/due dates, net/VAT/gross, VAT rate as printed (23/8/5/0%, `zw`, `np`) and an expense category.
- All amounts are integers in minor units (grosze/cents), rounded half-up to the grosz. Totals are always per currency and never summed across currencies.
- Net + VAT must agree with gross within an explicit 1 grosz/cent tolerance (`VAT_ROUNDING_TOLERANCE_MINOR`); otherwise the invoice is held for review.
- Deterministic matching on gross amount and currency: matched, amount mismatch, missing payment, possible duplicate, and needs review. Payments are never matched across currencies. Overdue state is tracked separately against a fixed demo date.
- Semicolon/UTF-8 CSV export for the accountant with Polish headers.
- CloseMate does not decide tax deductibility, calculate tax liability, or connect to KSeF, a bank, or the tax office.
- Nicrron model explanation via its OpenAI-compatible Chat Completions endpoint, with rule-based fallback if no key is configured or the model fails.
- PRISM traces over the documented HTTP API (TypeScript does **not** require the Python `prismtrace-sdk`).
- Optional ElevenLabs text-to-speech for the selected exception summary.
- Unit tests for the deterministic reconciliation logic.

## Requirements

Use Node.js 22 LTS or newer supported LTS and npm. Current Next.js 16 requires a modern Node version; check `node -v` before starting.

## Run locally

```bash
cp .env.example .env.local
npm install
npm test
npm run typecheck
npm run dev
```

Open http://localhost:3000. The dashboard and deterministic demo work without credentials. To run the live integrations, add the corresponding values to `.env.local` and restart the dev server.

## Environment variables

| Variable | Where to get it | Required? |
|---|---|---|
| `NICRRON_API_KEY` | Nicrron account / event credit redemption | For live AI explanations |
| `NICRRON_MODEL` | Defaults to `nicrron/auto` | Optional |
| `PRISMTRACE_HOST` | Defaults to `https://api.prism.blockconvey.com` | Optional default provided |
| `PRISMTRACE_PROJECT_ID` | PRISM Settings → Project | For trace delivery |
| `PRISMTRACE_API_KEY` | PRISM API Keys | For trace delivery |
| `ELEVENLABS_API_KEY` | ElevenLabs developer dashboard / sponsor resources | For voice summary |
| `ELEVENLABS_VOICE_ID` | ElevenLabs voice library | Optional default provided |

Never commit `.env.local`. Do not put credentials in client components or public `NEXT_PUBLIC_` variables.

## Demonstration path

1. Select `47/10/2026` (Biuro Rachunkowe Przykład): the transfer is PLN 600.00 against a PLN 738.00 gross invoice. It equals the net amount, so the VAT portion looks unpaid, and the invoice is 2 days overdue.
2. Click **Explain with AI**; with Nicrron credentials the model explains the discrepancy and PRISM receives a trace.
3. Select `FV/CW/2026/10/031` (Cowork Demo Kraków): two PLN 1,476.00 transfers reference one invoice.
4. Select `KD/2026/09/12` (Kancelaria Demo Wiśniewska): no payment, 13 days overdue.
5. Select `FV/2026/10/0457` (Sprzęt IT Demo): net + VAT is PLN 1,230.00 but gross says PLN 1,232.00, so it is held for review even though a payment matches the gross.
6. Select `DAL-55120` (Demo API Labs): a USD invoice with only a PLN card payment. It is not matched across currencies.
7. Open **Export for accountant** to download the CSV.
8. Click **Listen** to narrate the currently displayed finding, if ElevenLabs credentials are configured.
9. Open PRISM and show the CloseMate traces. Do not merely say observability was added; verify the events arrived.

## Before public deploy

- Add secrets in the hosting provider's server-side environment settings, not in Git.
- Run `npm test`, `npm run typecheck`, and `npm run build`.
- Test the deployed URL in an incognito window and run at least one live model call.
- Confirm PRISM traces arrive from the deployed environment (serverless providers may need to keep trace delivery alive until completion).
- Keep the demo dataset synthetic. This is a hackathon prototype, not financial, tax, accounting, or investment advice.

## Suggested submission description

**CloseMate gives finance teams a faster, evidence-backed month-end close.** It reconciles invoices with bank activity, catches mismatches, missing payments, and possible duplicates, and explains each exception through a model routed by Nicrron. PRISM traces make the AI's behavior inspectable instead of a black box, while optional ElevenLabs voice briefings help operators scan what needs attention. Calculations are deterministic, and every financial action remains under human control.
