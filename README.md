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
npm install --legacy-peer-deps
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

Run the common verification commands from the repo root:

```bash
make check
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
- unwrap templates are built from the guaranteed minimum output, so clients may still want to adjust the final unwrap amount after execution if more WEGLD is received.
- This repo is intended as a buildable prototype rather than a polished production release.
