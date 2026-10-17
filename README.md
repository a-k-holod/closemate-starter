# CloseMate — Finance close, with evidence

**Track:** Money Operations
**One-liner:** CloseMate reconciles supplier invoices against bank activity, highlights exceptions, explains them with AI, and records model traces for review.

This starter uses synthetic demo data only. Matching and money calculations are deterministic application code; the model explains results and suggests checks. It does not initiate payments, alter ledgers, or connect to bank accounts.

## What is implemented

- A polished reconciliation workspace with six synthetic invoices and bank transactions.
- Deterministic matching for matched, amount-mismatch, missing-payment, and possible-duplicate cases.
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

1. Select `INV-2042` (Northstar Analytics): the candidate bank transfer is $2,840 against a $2,480 invoice, a $360 variance.
2. Click **Explain with AI**; with Nicrron credentials the model explains the discrepancy and PRISM receives a trace.
3. Select `INV-2044` (Mercury Design): two $750 payments reference one $750 invoice.
4. Select `INV-2043` (Cedar Workspace): no candidate payment is present.
5. Click **Listen** to narrate the currently displayed finding, if ElevenLabs credentials are configured.
6. Open PRISM and show the CloseMate traces. Do not merely say observability was added; verify the events arrived.

## Before public deploy

- Add secrets in the hosting provider's server-side environment settings, not in Git.
- Run `npm test`, `npm run typecheck`, and `npm run build`.
- Test the deployed URL in an incognito window and run at least one live model call.
- Confirm PRISM traces arrive from the deployed environment (serverless providers may need to keep trace delivery alive until completion).
- Keep the demo dataset synthetic. This is a hackathon prototype, not financial, tax, accounting, or investment advice.

## Suggested submission description

**CloseMate gives finance teams a faster, evidence-backed month-end close.** It reconciles invoices with bank activity, catches mismatches, missing payments, and possible duplicates, and explains each exception through a model routed by Nicrron. PRISM traces make the AI's behavior inspectable instead of a black box, while optional ElevenLabs voice briefings help operators scan what needs attention. Calculations are deterministic, and every financial action remains under human control.
