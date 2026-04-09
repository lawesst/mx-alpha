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
        status?: string;
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
      const failVerification = async (parameters: {
        error: string;
        verificationStatus: string;
        observedTxStatus?: string;
      }): Promise<{ success: false; error: string }> => {
        if (existing) {
          await this.storageService.recordVerificationAttempt(existing.id, {
            attemptedTxHash: txHash,
            observedTxStatus: parameters.observedTxStatus,
            verificationStatus: parameters.verificationStatus,
            verificationError: parameters.error,
          });
        }

        return {
          success: false,
          error: parameters.error,
        };
      };

      const succeedVerification = async (
        verificationStatus: string,
        observedTxStatus: string,
      ): Promise<{ success: true }> => {
        await this.storageService.recordVerificationAttempt(challengeId, {
          attemptedTxHash: txHash,
          observedTxStatus,
          verificationStatus,
          verificationError: null,
        });

        return { success: true };
      };

      if (existing && existing.status === 'completed') {
        if (existing.txHash === txHash) {
          this.logger.log(`Idempotency hit: cached success for ${challengeId}`);
          return succeedVerification('cached-success', 'completed');
        }
        return failVerification({
          error: 'Challenge already settled with a different transaction',
          verificationStatus: 'completed-mismatch',
          observedTxStatus: 'completed',
        });
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
          return failVerification({
            error: `Opaque mismatch: expected ${existing.opaque}, got ${receivedOpaqueStr}`,
            verificationStatus: 'opaque-mismatch',
            observedTxStatus: 'challenge-metadata-mismatch',
          });
        }
      }

      // Digest validation: bound to request body (RFC 9530)
      if (existing.digest && existing.digest !== digest) {
        return failVerification({
          error: `Digest mismatch: expected ${existing.digest}, got ${digest}`,
          verificationStatus: 'digest-mismatch',
          observedTxStatus: 'challenge-metadata-mismatch',
        });
      }

      // Source validation: payer identifier (DID format)
      if (existing.source && existing.source !== source) {
        return failVerification({
          error: `Source mismatch: expected ${existing.source}, got ${source}`,
          verificationStatus: 'source-mismatch',
          observedTxStatus: 'challenge-metadata-mismatch',
        });
      }

      // 3. Challenge Expiry Check
      if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
        await this.storageService.updateStatus(challengeId, 'failed');
        return failVerification({
          error: 'Challenge has expired',
          verificationStatus: 'challenge-expired',
          observedTxStatus: 'expired',
        });
      }

      // 4. Fetch Transaction from Blockchain
      let tx: ITransaction;
      try {
        const txData = await this.provider.getTransaction(txHash);
        tx = txData as unknown as ITransaction;
      } catch {
        return failVerification({
          error: 'Transaction not found on the network',
          verificationStatus: 'tx-not-found',
          observedTxStatus: 'not-found',
        });
      }

      // 5. Status Verification
      const observedTxStatus = this.getObservedTxStatus(tx.status);
      if (!this.isSuccessfulStatus(tx.status)) {
        const errorMsg = this.isPendingStatus(tx.status)
          ? 'Transaction is still pending'
          : 'Transaction failed or is invalid';
        return failVerification({
          error: errorMsg,
          verificationStatus: this.isPendingStatus(tx.status)
            ? 'tx-pending'
            : 'tx-not-successful',
          observedTxStatus,
        });
      }

      // 6. Sender Verification
      if (this.asBech32(tx.sender) !== expectedSender) {
        return failVerification({
          error: 'Transaction sender does not match expected sender',
          verificationStatus: 'sender-mismatch',
          observedTxStatus,
        });
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
            return failVerification({
              error: `Token mismatch: expected ${expectedCurrency}, got ${esdtData.token}`,
              verificationStatus: 'token-mismatch',
              observedTxStatus,
            });
          }
          if (esdtData.amount !== expectedAmount) {
            return failVerification({
              error: `Amount mismatch: expected ${expectedAmount}, got ${esdtData.amount}`,
              verificationStatus: 'amount-mismatch',
              observedTxStatus,
            });
          }
          if (
            existing.receiver &&
            this.asBech32(tx.receiver) !== existing.receiver
          ) {
            return failVerification({
              error: `Receiver mismatch: expected ${existing.receiver}, got ${this.asBech32(tx.receiver)}`,
              verificationStatus: 'receiver-mismatch',
              observedTxStatus,
            });
          }
        } else if (multiEsdtData) {
          // Multi ESDT Transfer - scan all transfers
          const hasMatch = multiEsdtData.transfers.some(
            (t) => t.token === expectedCurrency && t.amount === expectedAmount,
          );
          if (!hasMatch) {
            return failVerification({
              error: `No transfer matches expected token ${expectedCurrency} and amount ${expectedAmount}`,
              verificationStatus: 'expected-transfer-not-found',
              observedTxStatus,
            });
          }
          if (
            existing.receiver &&
            multiEsdtData.receiver !== existing.receiver
          ) {
            return failVerification({
              error: `Receiver mismatch: expected ${existing.receiver}, got ${multiEsdtData.receiver}`,
              verificationStatus: 'receiver-mismatch',
              observedTxStatus,
            });
          }
        } else {
          return failVerification({
            error:
              'Expected ESDT transfer but data payload format is unrecognized',
            verificationStatus: 'unparseable-esdt-transfer',
            observedTxStatus,
          });
        }
      } else {
        // EGLD: verify value and receiver directly
        const txValue = tx.value?.toString() || '0';
        if (txValue !== expectedAmount) {
          return failVerification({
            error: `Amount mismatch: expected ${expectedAmount}, got ${txValue}`,
            verificationStatus: 'amount-mismatch',
            observedTxStatus,
          });
        }

        if (existing.receiver && this.asBech32(tx.receiver) !== existing.receiver) {
          return failVerification({
            error: 'Receiver does not match expected address',
            verificationStatus: 'receiver-mismatch',
            observedTxStatus,
          });
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
        return failVerification({
          error: 'Data payload does not contain the required challenge ID tag',
          verificationStatus: 'challenge-tag-missing',
          observedTxStatus,
        });
      }

      // 9. Mark as completed
      await this.storageService.updateStatus(challengeId, 'completed', txHash);
      this.logger.log(
        `Transaction ${txHash} verified successfully for challenge ${challengeId}`,
      );

      return succeedVerification('success', observedTxStatus);
    } catch (error) {
      this.logger.error(`Error verifying transaction: ${error}`);
      const existing = await this.storageService.get(challengeId);
      if (existing) {
        await this.storageService.recordVerificationAttempt(existing.id, {
          attemptedTxHash: txHash,
          observedTxStatus: 'exception',
          verificationStatus: 'verification-exception',
          verificationError:
            error instanceof Error ? error.message : String(error),
        });
      }
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
    return this.getObservedTxStatus(status) === 'success';
  }

  private isPendingStatus(status: ITransaction['status']): boolean {
    return this.getObservedTxStatus(status) === 'pending';
  }

  private getObservedTxStatus(status: ITransaction['status']): string {
    if (typeof status === 'string') {
      return status.toLowerCase();
    }

    if (typeof status.status === 'string' && status.status.trim().length > 0) {
      return status.status.toLowerCase();
    }

    if (this.readStatusFlag(status, 'isSuccessful')) {
      return 'success';
    }

    if (this.readStatusFlag(status, 'isPending')) {
      return 'pending';
    }

    if (this.readStatusFlag(status, 'isInvalid')) {
      return 'invalid';
    }

    if (this.readStatusFlag(status, 'isFailed')) {
      return 'fail';
    }

    return 'unknown';
  }

  private readStatusFlag(
    status: Exclude<ITransaction['status'], string>,
    key: 'isSuccessful' | 'isPending' | 'isFailed' | 'isInvalid',
  ): boolean {
    const candidate = status[key];
    if (typeof candidate !== 'function') {
      return false;
    }

    try {
      return Boolean(candidate.call(status));
    } catch {
      return false;
    }
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
