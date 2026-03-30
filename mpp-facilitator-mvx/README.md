# MPP Facilitator (MultiversX)

A high-performance facilitator microservice for the **Mobile Payment Protocol (MPP)** integration on **MultiversX**. It manages payment challenges, verifies on-chain transactions, and provides an OpenAPI-compliant discovery endpoint.

## Features

- **Transaction Verification**: Robust parsing and validation of EGLD and ESDT transfers.
- **Multi-Transfer Support**: Correctly handles `MultiTransferESDT` and `MultiESDTNFTTransfer` formats.
- **Advanced Compliance**: Support for `opaque` data, `digest` body binding, and `source` identification.
- **Service Discovery**: Automated OpenAPI 3.1.0 generation with `x-service-info` and `x-payment-info` extensions.
- **Paid Intel Endpoints**: Includes `token-risk`, `wallet-profile`, `swap-sim`, and `swap-plan` endpoints for agent-facing MultiversX intelligence.
- **xExchange-aware Quotes**: `swap-sim` prefers live xExchange MEX pair metadata and falls back to public token metadata heuristics when no active route exists.
- **Execution Planning**: `swap-plan` returns an execution-oriented action list with pair addresses, min-output targets, and slippage suggestions for fixed-input swaps.
- **Transaction Templates**: `swap-plan` now embeds smart-contract execute templates for supported pair hops, plus optional EGLD wrap/unwrap templates when a WEGLD swap contract address is configured.
- **Security**: HMAC-SHA256 bound challenge IDs, rate limiting, and TTL-based challenge expiration.
- **Production Ready**: Full test coverage and environment-driven configuration.

## Configuration

The service is configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Listening port for the application | `3000` |
| `MPP_SECRET_KEY` | **Required**. Secret key for signing challenge IDs | N/A |
| `MPP_DEFAULT_CURRENCY` | Default token ticker (e.g., EGLD, WEGLD-abd123) | `EGLD` |
| `MPP_CHAIN_ID` | MultiversX Chain ID (D=Devnet, T=Testnet, 1=Mainnet) | `D` |
| `MPP_TOKEN_DECIMALS` | Decimals for the payment token | `18` |
| `MPP_REALM` | Service identifier for the WWW-Authenticate header | `agentic-payments-mvx` |
| `MPP_RELAY_RATE_LIMIT` | Max requests per window for relayed calls | `100` |
| `MPP_RECIPIENT` | **Required for paid intel endpoints.** Payment recipient bech32 address | N/A |
| `MPP_TOKEN_RISK_PRICE` | Human-readable price for `GET /intel/token-risk` | `0.05` |
| `MPP_WALLET_PROFILE_PRICE` | Human-readable price for `GET /intel/wallet-profile` | `0.10` |
| `MPP_SWAP_SIM_PRICE` | Human-readable price for `GET /intel/swap-sim` | `0.07` |
| `MPP_SWAP_PLAN_PRICE` | Human-readable price for `GET /intel/swap-plan` | `0.12` |
| `MPP_WEGLD_SWAP_ADDRESS` | Optional WEGLD swap contract address used to attach executable `wrap-egld` / `unwrap-egld` templates | N/A |
| `MPP_WEGLD_SWAP_GAS_LIMIT` | Gas limit used for WEGLD wrap and unwrap templates | `10000000` |
| `MVX_ANALYTICS_API_URL` | Base URL for public analytics lookups | `https://api.multiversx.com` |

## Discovery Endpoint

The service automatically serves payment metadata via:
- `GET /openapi.json`
- `GET /intel/token-risk?token=<identifier>`
- `GET /intel/wallet-profile?address=<bech32>`
- `GET /intel/swap-sim?from=<asset>&to=<asset>&amount=<decimal>`
- `GET /intel/swap-plan?from=<asset>&to=<asset>&amount=<decimal>`

This file is used by AI agents to understand how to pay for services using MPP.

## Local Devnet Smoke Test

Start the facilitator with a recipient wallet and devnet settings:

```bash
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

Then run the example client from [`mppx-multiversx`](../mppx-multiversx):

```bash
cd ../mppx-multiversx
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
npm run example:paid-intel -- wallet-profile erd1...
```

The expected flow is:
- the first request returns `402 Payment Required`
- the client broadcasts a tagged MultiversX payment with `mpp:<challengeId>`
- the facilitator verifies the onchain payment and returns `200 OK`
- the response includes a `Payment-Receipt` header

## License

MIT
