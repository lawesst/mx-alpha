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
- Client-side transaction construction into unsigned MultiversX transactions

## What The Product Does

The facilitator exposes paid endpoints for:

- token due diligence with `token-risk`
- wallet behavior summaries with `wallet-profile`
- route estimation with `swap-sim`
- execution planning with `swap-plan`

The SDK and example client show how an agent can pay for those endpoints and turn the returned swap actions into unsigned MultiversX transactions.

## Repo Layout

```text
mx-alpha/
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

Then install and start the facilitator:

```bash
cd ../mpp-facilitator-mvx
npm install --legacy-peer-deps
PORT=3000 \
DATABASE_URL=file:./dev.db \
MPP_SECRET_KEY=local-dev-secret \
MPP_RECIPIENT=erd1... \
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

## Notes

- `swap-plan` currently emits transaction templates for supported `swap-fixed-input` pair hops.
- `wrap-egld` and `unwrap-egld` actions are still advisory and do not yet include templates.
- This repo is intended as a buildable prototype rather than a polished production release.
