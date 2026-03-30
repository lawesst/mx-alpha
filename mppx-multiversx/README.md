# MPP MultiversX SDK

A spec-compliant implementation of the **Mobile Payment Protocol (MPP)** for the **MultiversX** blockchain. This SDK provides both client-side and server-side utilities for integrating MPP payments into your agentic applications.

## Features

- **Spec Compliant**: Follows the [MPP Specification](https://github.com/tempoxyz/mpp-specs).
- **BigInt Arithmetic**: Robust decimal handling without floating-point errors.
- **MultiversX Native**: Built-in support for EGLD and ESDT (Elrond Standard Digital Token) transfers.
- **Flexible Verification**: Highly configurable verification logic for both simple and complex payment flows.
- **Advanced Parameters**: Support for `opaque`, `digest` (RFC 9530), `source`, and `currency`.

## Installation

```bash
npm install mppx-multiversx
```

## Usage

### Server-side Initialization

```typescript
import { Mppx } from 'mppx/server';
import { multiversx } from 'mppx-multiversx/server';

const mvxMethod = multiversx({
  decimals: 18,
  chainId: 'D', // Devnet
  currency: 'EGLD',
  verifyTransaction: async ({ txHash, sender, amount, challengeId }) => {
    // Your verification logic here
    // Verify txHash on the blockchain, compare sender, amount, etc.
    return true;
  }
});

const mpp = Mppx.create({
  methods: [mvxMethod],
  secretKey: process.env.MPP_SECRET_KEY,
});
```

### Client-side Usage

```typescript
import { Mppx } from 'mppx/client';
import { multiversx } from 'mppx-multiversx/client';

const client = Mppx.create({
  polyfill: false,
  methods: [
    multiversx.charge({
      signAndSendTransaction: async ({ amount, challenge, currency, recipient, sender }) => {
        // Construct, sign, and broadcast the MultiversX transfer tagged with:
        // `mpp:${challenge.id}`
        return { txHash: '0x...', sender };
      }
    })
  ]
});

const response = await client.fetch('https://api.example.com/paid-resource', {
  context: { sender: 'erd1...' },
});
```

### Paid Intel Example

The repository now includes a runnable example client for the paid facilitator endpoints:

```bash
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
npm run example:paid-intel -- token-risk XMEX-abc123
```

```bash
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
npm run example:paid-intel -- wallet-profile erd1...
```

```bash
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
npm run example:paid-intel -- swap-sim EGLD USDC-c76f1f 1.25
```

```bash
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3000 \
npm run example:paid-intel -- swap-plan USDC-c76f1f RIDE-7d18e9 25
```

See [`examples/paid-intel.ts`](./examples/paid-intel.ts) for the full flow:
- calls the facilitator endpoint and waits for a `402 Payment Required` challenge
- creates the payment credential with `Mppx.create(...).createCredential(...)`
- signs a tagged EGLD or ESDT transfer with `mpp:<challengeId>`
- waits for the transaction to settle onchain before retrying
- prints the JSON report plus `Payment-Receipt`

For live devnet testing, you can increase the wait budget if your transaction confirms slowly:

```bash
MX_PEM_PATH=./wallet.pem \
MX_INTEL_BASE_URL=http://localhost:3100 \
MX_SETTLEMENT_TIMEOUT_MS=90000 \
npm run example:paid-intel -- wallet-profile erd1...
```

The `swap-sim` example now surfaces xExchange-aware route metadata when the facilitator can find live MEX pairs, including bridged routes through `WEGLD-bd4d79`. The `swap-plan` example builds on that and returns an execution-oriented action list with pair addresses, min-output targets, and slippage suggestions.

For supported `swap-plan` actions, the client package also exports `buildTransactionsFromSwapPlan()` from [`mppx-multiversx/client`], which turns the facilitator's `transactionTemplate` objects into unsigned `Transaction` instances using `SmartContractTransactionsFactory`.

## Advanced Verification

The SDK supports `MultiTransferESDT` and `MultiESDTNFTTransfer` verification. It parses the MultiversX `data` field to ensure that multi-token transfers match the expected payment requirements.

## License

MIT
