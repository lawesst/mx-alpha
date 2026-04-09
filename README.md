# mx-alpha

`mx-alpha` is a reference implementation for paid AI-agent tooling on MultiversX.

It shows how an agent can:

- discover a paid HTTP endpoint
- receive a `402 Payment Required` challenge
- pay that challenge on MultiversX using MPP
- retry with proof of payment
- receive premium JSON intelligence or an execution-ready swap plan

This repo packages the working prototype we built on top of the MultiversX blog repos:

- `mpp-facilitator-mvx`: paid intel API with `token-risk`, `wallet-profile`, `swap-sim`, and `swap-plan`
- `mppx-multiversx`: MultiversX MPP SDK plus a paid-intel demo client

## What Is Included

- One-shot paid HTTP endpoints over MPP
- xExchange-aware route simulation
- Execution planning for fixed-input swaps
- Transaction templates in `swap-plan`
- EGLD wrap and unwrap templates when `MPP_WEGLD_SWAP_ADDRESS` is configured
- Previous-output references for chained swap actions, with conservative fallbacks
- Client-side transaction construction into unsigned MultiversX transactions
- Step-by-step client-side execution that can reuse actual prior-step outputs at runtime
- Structured failure reporting for partially executed swap plans
- Pre-broadcast execution policy guards for strategy, action count, contract allowlists, and suggested slippage/deadline checks
- Dry-run swap simulation before broadcast, including sequential simulated output chaining
- Richer execution reporting that compares preflight simulation with real execution per action
- Optional JSON audit export for paid runs, dry-runs, and execution failures
- Optional one-step audit upload from the example client back into the facilitator
- Resumable pending-payment state so slow devnet confirmations do not trigger duplicate payments on rerun
- Report indexing that summarizes many saved audit runs into JSON, Markdown, and static HTML artifacts
- Facilitator-side audit ingestion with list, detail, and summary APIs for stored paid-run reports
- Audit lookup by payment transaction hash
- A root smoke runner that starts the facilitator, retries pending payments, uploads the audit report, and verifies ingestion

## What The Product Does

The facilitator exposes paid endpoints for:

- token due diligence with `token-risk`
- wallet behavior summaries with `wallet-profile`
- route estimation with `swap-sim`
- execution planning with `swap-plan`

The SDK and example client show how an agent can pay for those endpoints, turn the returned swap actions into unsigned MultiversX transactions, dry-run them against the chain, and optionally execute supported plans step by step while carrying forward real outputs between actions.

## Repo Layout

```text
mx-alpha/
  LICENSE
  Makefile
  mpp-facilitator-mvx/
  mppx-multiversx/
  scripts/
```

## Quick Start

Build the SDK first so the facilitator can consume the local package:

```bash
cd mppx-multiversx
npm install
npm run build
```

Or use the root helper:

```bash
make build-sdk
```

Then install and start the facilitator:

```bash
cd ../mpp-facilitator-mvx
npm install
PORT=3000 \
DATABASE_URL=file:./dev.db \
MPP_SECRET_KEY=local-dev-secret \
MPP_RECIPIENT=erd1... \
MPP_WEGLD_SWAP_ADDRESS=erd1... \
MPP_DEFAULT_CURRENCY=EGLD \
MPP_CHAIN_ID=D \
MPP_TOKEN_DECIMALS=18 \
npm run start
```

The facilitator start scripts build the local SDK first and bootstrap the SQLite schema at runtime, so a fresh local database no longer needs manual Prisma setup before the first boot.

Run the paid client example:

```bash
cd ../mppx-multiversx
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
npm run example:paid-intel -- swap-plan USDC-c76f1f RIDE-7d18e9 25
```

Run the same example with step-by-step execution enabled:

```bash
cd ../mppx-multiversx
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
MX_EXECUTE_SWAP_PLAN=true \
npm run example:paid-intel -- swap-plan EGLD RIDE-7d18e9 1.25
```

Run a dry-run without broadcasting:

```bash
cd ../mppx-multiversx
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
MX_SIMULATE_SWAP_PLAN=true \
npm run example:paid-intel -- swap-plan EGLD RIDE-7d18e9 1.25
```

Persist an audit report while running the example:

```bash
cd ../mppx-multiversx
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
MX_EXECUTE_SWAP_PLAN=true \
MX_REPORT_DIR=./reports \
npm run example:paid-intel -- swap-plan EGLD RIDE-7d18e9 1.25
```

Persist and upload the same audit report back into the facilitator:

```bash
cd ../mppx-multiversx
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
MX_EXECUTE_SWAP_PLAN=true \
MX_REPORT_DIR=./reports \
MX_UPLOAD_AUDIT_REPORT=true \
npm run example:paid-intel -- swap-plan EGLD RIDE-7d18e9 1.25
```

When devnet settlement is slow, rerun the same command and the example will resume from the saved pending payment state instead of broadcasting a new payment. By default it stores that state under `./.paid-intel-state`, and you can override it with `MX_PAYMENT_STATE_DIR` or `MX_PAYMENT_STATE_FILE`.

Index the saved reports:

```bash
cd ../mppx-multiversx
npm run example:report-index -- ./reports
```

Run the common verification commands from the repo root:

```bash
make check
```

Or build a report index from the repo root:

```bash
make report-index
```

Run the full local smoke flow from the repo root:

```bash
MX_SMOKE_PEM_PATH=/absolute/path/to/payer.pem \
MX_SMOKE_RESOURCE_ADDRESS=erd1... \
MX_SMOKE_RECIPIENT=erd1... \
make smoke-paid-upload
```

Ingest a saved audit report into the facilitator:

```bash
curl \
  -X POST \
  -H 'Content-Type: application/json' \
  --data @mppx-multiversx/reports/example-report.json \
  http://localhost:3000/audit-reports
```

## Notes

- `swap-plan` emits pair-hop templates by default and can also emit EGLD wrap/unwrap templates when `MPP_WEGLD_SWAP_ADDRESS` is set.
- downstream swap hops and final unwrap actions can reference the previous action's output, so clients can either use safe fallback amounts or inject actual outputs at runtime.
- the SDK can now execute supported swap-plan actions sequentially and reuse the actual completed output of each step when constructing the next one.
- the SDK can also simulate supported swap-plan actions sequentially, using simulated outputs to dry-run later hops before any broadcast happens.
- successful executions can now include both the pre-broadcast simulations and per-hop output deltas between simulated and actual results.
- failed on-chain steps now raise a structured execution error that preserves partial progress and per-step status for debugging or recovery flows.
- failed dry-runs now raise a structured simulation error with partial preflight state preserved.
- the SDK can also reject risky or unexpected plans before signing by enforcing an execution policy over strategy, receivers, action types, and suggested route limits.
- the example runner performs pre-broadcast simulation by default when live execution is enabled, unless `MX_SKIP_PREBROADCAST_SIMULATION=true` is set.
- the example runner can now persist a JSON audit report with the payment receipt, request metadata, dry-run details, and execution outcome when `MX_REPORT_DIR` or `MX_REPORT_FILE` is set.
- the example runner now persists resumable pending-payment state under `./.paid-intel-state` unless you override it with `MX_PAYMENT_STATE_DIR` or `MX_PAYMENT_STATE_FILE`.
- the repo now includes a small indexer that scans saved reports and writes `index.json`, `latest-success.json`, and `summary.md` so repeated runs are easier to review.
- the report indexer now also writes a static `index.html` dashboard for quick browser-based review.
- the facilitator can now look up the latest stored audit report for a given payment transaction via `GET /audit-reports/by-payment/<txHash>`.
- the facilitator can now inspect a payment challenge directly via `GET /challenges/<id>`, including the latest verifier attempt count, observed tx status, verifier status, and error details.
- unwrap templates are built from the guaranteed minimum output, so clients may still want to adjust the final unwrap amount after execution if more WEGLD is received.
- This repo is intended as a buildable prototype rather than a polished production release.
