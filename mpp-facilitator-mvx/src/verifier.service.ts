import { Injectable, Logger } from '@nestjs/common';
import { ApiNetworkProvider } from '@multiversx/sdk-network-providers';
import { StorageService } from './storage.service';
import { Address } from '@multiversx/sdk-core';

interface IAddress {
  toBech32(): string;
}

interface IAddressValue {
  value: string;
}

interface ITransaction {
  status:
    | string
    | {
        isSuccessful(): boolean;
        isPending(): boolean;
        isFailed(): boolean;
        isInvalid(): boolean;
      };
  sender: string | IAddress | IAddressValue;
  receiver: string | IAddress | IAddressValue;
  value: string | { toString(): string };
  data?: Buffer | string;
}

/**
 * Parses ESDTTransfer data payload.
 * Format: ESDTTransfer@<tokenHex>@<amountHex>[@<mppTagHex>]
 */
function parseEsdtTransfer(
  data: string,
): { token: string; amount: string; mppTag?: string } | null {
  const parts = data.split('@');
  if (parts.length < 3) return null;

  const functionName = parts[0];
  if (functionName !== 'ESDTTransfer') return null;

  try {
    const token = Buffer.from(parts[1], 'hex').toString('utf-8');
    const amount = BigInt('0x' + parts[2]).toString();

    // Optional mpp tag in the 4th part (index 3)
    let mppTag: string | undefined;
    if (parts.length >= 4) {
      const extraData = Buffer.from(parts[3], 'hex').toString('utf-8');
      if (extraData.startsWith('mpp:')) {
        mppTag = extraData;
      }
    }

    return { token, amount, mppTag };
  } catch {
    return null;
  }
}

/**
 * Parses MultiESDTNFTTransfer or MultiTransferESDT data payload.
 * MultiESDTNFTTransfer@<receiverHex>@<numTransfers>@<token1Hex>@<nonce1Hex>@<amount1Hex>@...
 * MultiTransferESDT@<receiverHex>@<numTransfers>@<token1Hex>@<amount1Hex>@... (nonce usually omitted or zero)
 */
function parseMultiEsdtTransfer(data: string): {
  transfers: { token: string; amount: string }[];
  receiver: string;
  mppTag?: string;
} | null {
  const parts = data.split('@');
  if (parts.length < 5) return null;

  const functionName = parts[0];
  const isMultiESDTNFTTransfer = functionName === 'MultiESDTNFTTransfer';
  const isMultiTransferESDT = functionName === 'MultiTransferESDT';

  if (!isMultiESDTNFTTransfer && !isMultiTransferESDT) {
    return null;
  }

  try {
    const receiverHex = parts[1];
    const numTransfersHex = parts[2];
    const numTransfers = parseInt(numTransfersHex, 16);
    if (isNaN(numTransfers) || numTransfers === 0) return null;

    const receiver = (
      new Address(receiverHex) as unknown as IAddress
    ).toBech32();
    const transfers: { token: string; amount: string }[] = [];

    // Step size depends on the function
    const step = isMultiESDTNFTTransfer ? 3 : 2;

    for (let i = 0; i < numTransfers; i++) {
      const base = 3 + i * step;
      if (base + (step - 1) >= parts.length) break;

      const tokenHex = parts[base];
      // For MultiESDTNFTTransfer, amount is at base + 2 (token, nonce, amount)
      // For MultiTransferESDT, amount is at base + 1 (token, amount)
      const amountHex = isMultiESDTNFTTransfer
        ? parts[base + 2]
        : parts[base + 1];

      const token = Buffer.from(tokenHex, 'hex').toString('utf-8');
      const amount = BigInt('0x' + amountHex).toString();
      transfers.push({ token, amount });
    }

    let mppTag: string | undefined;
    // The mpp tag could be anywhere after the transfers
    const tagStartIndex = 3 + numTransfers * step;
    for (let i = tagStartIndex; i < parts.length; i++) {
      try {
        const extraData = Buffer.from(parts[i], 'hex').toString('utf-8');
        if (extraData.startsWith('mpp:')) {
          mppTag = extraData;
          break;
        }
      } catch {
        /* ignore */
      }
    }

    return { transfers, receiver, mppTag };
  } catch {
    return null;
  }
}

@Injectable()
export class VerifierService {
  private provider: ApiNetworkProvider;
  private readonly logger = new Logger(VerifierService.name);

  constructor(private readonly storageService: StorageService) {
    const apiUrl =
      process.env.MVX_API_URL || 'https://devnet-api.multiversx.com';
    this.provider = new ApiNetworkProvider(apiUrl);
  }

  /**
   * Verifies that the transaction for the given challenge is valid, successful,
   * and matches the expected amount, sender, receiver, and currency.
   */
  async verifyTransaction(
    txHash: string,
    expectedSender: string,
    challengeId: string,
    expectedAmount: string,
    expectedCurrency: string,
    source?: string,
    opaque?: Record<string, string>,
    digest?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const opaqueStr = opaque ? this.stableStringify(opaque) : undefined;
    this.logger.log(
      `Verifying tx ${txHash} for challenge ${challengeId} (source=${source}, opaque=${opaqueStr}, digest=${digest})`,
    );

    try {
      // 1. Idempotency Check
      const existing = await this.storageService.get(challengeId);
      if (existing && existing.status === 'completed') {
        if (existing.txHash === txHash) {
          this.logger.log(`Idempotency hit: cached success for ${challengeId}`);
          return { success: true };
        }
        return {
          success: false,
          error: 'Challenge already settled with a different transaction',
        };
      }

      if (!existing || existing.status === 'failed') {
        return {
          success: false,
          error: 'Challenge not found or already failed',
        };
      }

      // 2. Advanced Parameters Verification (MPP Spec)
      // Opaque validation: must match stored value (which is bound to challenge ID)
      if (existing.opaque) {
        const receivedOpaqueStr = opaque ? this.stableStringify(opaque) : undefined;
        if (existing.opaque !== receivedOpaqueStr) {
          return {
            success: false,
            error: `Opaque mismatch: expected ${existing.opaque}, got ${receivedOpaqueStr}`,
          };
        }
      }

      // Digest validation: bound to request body (RFC 9530)
      if (existing.digest && existing.digest !== digest) {
        return {
          success: false,
          error: `Digest mismatch: expected ${existing.digest}, got ${digest}`,
        };
      }

      // Source validation: payer identifier (DID format)
      if (existing.source && existing.source !== source) {
        return {
          success: false,
          error: `Source mismatch: expected ${existing.source}, got ${source}`,
        };
      }

      // 3. Challenge Expiry Check
      if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
        await this.storageService.updateStatus(challengeId, 'failed');
        return { success: false, error: 'Challenge has expired' };
      }

      // 4. Fetch Transaction from Blockchain
      let tx: ITransaction;
      try {
        const txData = await this.provider.getTransaction(txHash);
        tx = txData as unknown as ITransaction;
      } catch {
        return {
          success: false,
          error: 'Transaction not found on the network',
        };
      }

      // 5. Status Verification
      if (!this.isSuccessfulStatus(tx.status)) {
        const errorMsg = this.isPendingStatus(tx.status)
          ? 'Transaction is still pending'
          : 'Transaction failed or is invalid';
        return { success: false, error: errorMsg };
      }

      // 6. Sender Verification
      if (this.asBech32(tx.sender) !== expectedSender) {
        return {
          success: false,
          error: 'Transaction sender does not match expected sender',
        };
      }

      // 7. Amount & Receiver Verification (EGLD vs ESDT)
      const dataStr = this.decodeTransactionData(tx.data);
      const isEsdt = expectedCurrency !== 'EGLD';

      if (isEsdt) {
        // Parse ESDT transfer or MultiESDT transfer from data field
        const esdtData = parseEsdtTransfer(dataStr);
        const multiEsdtData = !esdtData
          ? parseMultiEsdtTransfer(dataStr)
          : null;

        if (esdtData) {
          // Single ESDT Transfer
          if (esdtData.token !== expectedCurrency) {
            return {
              success: false,
              error: `Token mismatch: expected ${expectedCurrency}, got ${esdtData.token}`,
            };
          }
          if (esdtData.amount !== expectedAmount) {
            return {
              success: false,
              error: `Amount mismatch: expected ${expectedAmount}, got ${esdtData.amount}`,
            };
          }
          if (
            existing.receiver &&
            this.asBech32(tx.receiver) !== existing.receiver
          ) {
            return {
              success: false,
              error: `Receiver mismatch: expected ${existing.receiver}, got ${this.asBech32(tx.receiver)}`,
            };
          }
        } else if (multiEsdtData) {
          // Multi ESDT Transfer - scan all transfers
          const hasMatch = multiEsdtData.transfers.some(
            (t) => t.token === expectedCurrency && t.amount === expectedAmount,
          );
          if (!hasMatch) {
            return {
              success: false,
              error: `No transfer matches expected token ${expectedCurrency} and amount ${expectedAmount}`,
            };
          }
          if (
            existing.receiver &&
            multiEsdtData.receiver !== existing.receiver
          ) {
            return {
              success: false,
              error: `Receiver mismatch: expected ${existing.receiver}, got ${multiEsdtData.receiver}`,
            };
          }
        } else {
          return {
            success: false,
            error:
              'Expected ESDT transfer but data payload format is unrecognized',
          };
        }
      } else {
        // EGLD: verify value and receiver directly
        const txValue = tx.value?.toString() || '0';
        if (txValue !== expectedAmount) {
          return {
            success: false,
            error: `Amount mismatch: expected ${expectedAmount}, got ${txValue}`,
          };
        }

        if (existing.receiver && this.asBech32(tx.receiver) !== existing.receiver) {
          return {
            success: false,
            error: 'Receiver does not match expected address',
          };
        }
      }

      // 8. Data Payload Tagging Verification (MPP Core)
      const expectedDataVariants = [
        challengeId,
        `mpp:${challengeId}`,
        Buffer.from(challengeId).toString('hex'),
        Buffer.from(`mpp:${challengeId}`).toString('hex'),
      ];

      let dataMatches = false;
      for (const variant of expectedDataVariants) {
        if (dataStr.includes(variant)) {
          dataMatches = true;
          break;
        }
      }

      if (!dataMatches) {
        return {
          success: false,
          error: 'Data payload does not contain the required challenge ID tag',
        };
      }

      // 9. Mark as completed
      await this.storageService.updateStatus(challengeId, 'completed', txHash);
      this.logger.log(
        `Transaction ${txHash} verified successfully for challenge ${challengeId}`,
      );

      return { success: true };
    } catch (error) {
      this.logger.error(`Error verifying transaction: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortValue(value));
  }

  private isSuccessfulStatus(status: ITransaction['status']): boolean {
    if (typeof status === 'string') {
      return status.toLowerCase() === 'success';
    }

    return status.isSuccessful();
  }

  private isPendingStatus(status: ITransaction['status']): boolean {
    if (typeof status === 'string') {
      return status.toLowerCase() === 'pending';
    }

    return status.isPending();
  }

  private asBech32(value: string | IAddress | IAddressValue): string {
    if (typeof value === 'string') {
      return value;
    }

    if ('value' in value && typeof value.value === 'string') {
      return value.value;
    }

    if ('toBech32' in value) {
      return value.toBech32();
    }

    throw new Error('Unsupported address value');
  }

  private decodeTransactionData(data?: Buffer | string): string {
    if (!data) return '';

    if (typeof data === 'string') {
      try {
        return Buffer.from(data, 'base64').toString('utf8');
      } catch {
        return data;
      }
    }

    return data.toString('utf8');
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entryValue]) => [key, this.sortValue(entryValue)]),
      );
    }

    return value;
  }
}
