import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { MppxService } from './mppx.service';
import { StorageService } from './storage.service';
import type { SettlementRecord } from './storage.service';

type ChargeOptions<T> = {
  amount: string;
  recipient: string;
  digest?: string;
  opaque?: Record<string, string>;
  source?: string;
  onAuthorized: () => Promise<T>;
};

type VerificationState = 'pending' | 'verified' | 'failed';

type PaymentProblemDetail = {
  type: string;
  title: string;
  status: 402;
  detail: string;
  challengeId?: string;
  challenge: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  verificationState?: VerificationState;
  verification?: {
    challengeStatus: string;
    attempts: number;
    lastCheckedAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    observedTxStatus: string | null;
    txHash: string | null;
  };
};

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(
    private readonly mppxService: MppxService,
    private readonly storageService: StorageService,
  ) {}

  async handleCharge<T>(
    req: ExpressRequest,
    res: ExpressResponse,
    options: ChargeOptions<T>,
  ): Promise<void> {
    const fetchReq = this.toFetchRequest(req);
    const composeResult = this.mppxService.instance.compose([
      this.mppxService.mvxChargeMethod,
      {
        amount: options.amount,
        recipient: options.recipient,
        digest: options.digest,
        meta: options.opaque,
      },
    ]);

    const result = await composeResult(fetchReq);

    if (result.status === 402) {
      await this.handleChallengeResponse(res, result.challenge as Response, options);
      return;
    }

    if (result.status === 200) {
      const payload = await options.onAuthorized();
      const receiptResponse = result.withReceipt(
        new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as Response;

      receiptResponse.headers.forEach((value: string, key: string) =>
        res.setHeader(key, value),
      );
      res.status(200).type('application/json').send(await receiptResponse.text());
      return;
    }

    throw new InternalServerErrorException('Unexpected payment gateway status');
  }

  private toFetchRequest(req: ExpressRequest): Request {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    return new Request(fullUrl, {
      method: req.method,
      headers: req.headers as HeadersInit,
    });
  }

  private async handleChallengeResponse(
    res: ExpressResponse,
    challengeResponse: Response,
    options: Omit<ChargeOptions<unknown>, 'onAuthorized'>,
  ): Promise<void> {
    challengeResponse.headers.forEach((value: string, key: string) =>
      res.setHeader(key, value),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/problem+json');

    const challengeHeader = challengeResponse.headers.get('www-authenticate') || '';
    const challenge = await challengeResponse.text();
    const challengeId =
      this.extractQuotedValue(challengeHeader, 'id') ||
      this.extractQuotedValue(challenge, 'id');
    const expires =
      this.extractQuotedValue(challengeHeader, 'expires') ||
      this.extractQuotedValue(challenge, 'expires');
    let storedChallenge: SettlementRecord | null = null;

    if (challengeId) {
      const existingChallenge = await this.storageService.get(challengeId);
      await this.storageService.save({
        id: challengeId,
        ...(existingChallenge
          ? {}
          : {
              txHash: '',
              payer: options.source || '',
              status: 'pending',
              createdAt: new Date(),
            }),
        receiver: options.recipient,
        amount: this.parseUnits(
          options.amount,
          parseInt(process.env.MPP_TOKEN_DECIMALS || '18', 10),
        ),
        currency: process.env.MPP_DEFAULT_CURRENCY || 'EGLD',
        chainId: process.env.MPP_CHAIN_ID || 'D',
        updatedAt: new Date(),
        expiresAt: expires ? new Date(expires) : null,
        opaque: options.opaque ? this.stableStringify(options.opaque) : null,
        digest: options.digest || null,
        source: options.source || null,
      });
      storedChallenge = await this.storageService.get(challengeId);
    } else {
      this.logger.warn('Unable to persist challenge because no challenge ID was found');
    }

    const problemDetail = this.buildPaymentRequiredProblemDetail({
      amount: options.amount,
      currency: process.env.MPP_DEFAULT_CURRENCY || 'EGLD',
      challengeId,
      challenge,
      challengeRecord: storedChallenge,
    });

    if (problemDetail.retryAfterSeconds) {
      res.setHeader('Retry-After', String(problemDetail.retryAfterSeconds));
    }

    res.status(402).json(problemDetail);
  }

  private extractQuotedValue(input: string, key: string): string | undefined {
    const match = input.match(new RegExp(`${key}="([^"]+)"`));
    return match ? match[1] : undefined;
  }

  private parseUnits(amount: string, decimals: number): string {
    const [whole = '0', fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFraction).toString();
  }

  private buildPaymentRequiredProblemDetail(parameters: {
    amount: string;
    currency: string;
    challengeId?: string;
    challenge: string;
    challengeRecord?: SettlementRecord | null;
  }): PaymentProblemDetail {
    const baseDetail: PaymentProblemDetail = {
      type: 'https://mpp.dev/errors/payment-required',
      title: 'Payment Required',
      status: 402,
      detail: `This resource requires a payment of ${parameters.amount} ${parameters.currency}.`,
      challengeId: parameters.challengeId,
      challenge: parameters.challenge,
    };
    const challengeRecord = parameters.challengeRecord;

    if (!challengeRecord || challengeRecord.verificationAttempts === 0) {
      return baseDetail;
    }

    const verification = this.serializeVerificationDetails(challengeRecord);
    const retryAfterSeconds = this.getRetryAfterSeconds();

    if (this.isVerifiedVerificationState(challengeRecord)) {
      return {
        ...baseDetail,
        type: 'https://mpp.dev/errors/payment-verification-catch-up',
        title: 'Payment Received, Authorization Catching Up',
        detail:
          'The facilitator has already verified a payment for this challenge. ' +
          'Retry the same request with the same credential shortly instead of paying again.',
        retryable: true,
        retryAfterSeconds,
        verificationState: 'verified',
        verification,
      };
    }

    if (this.isPendingVerificationState(challengeRecord)) {
      return {
        ...baseDetail,
        type: 'https://mpp.dev/errors/payment-verification-pending',
        title: 'Payment Verification Pending',
        detail:
          'A payment attempt is already being tracked for this challenge, but verification is still catching up. ' +
          'Retry the same request with the same credential instead of paying again.',
        retryable: true,
        retryAfterSeconds,
        verificationState: 'pending',
        verification,
      };
    }

    return {
      ...baseDetail,
      type: 'https://mpp.dev/errors/payment-verification-failed',
      title: 'Previous Payment Attempt Could Not Be Verified',
      detail: challengeRecord.lastVerificationError
        ? `The last payment attempt for this challenge could not be verified: ${challengeRecord.lastVerificationError}`
        : 'The last payment attempt for this challenge could not be verified. Submit a corrected payment or request a new challenge.',
      verificationState: 'failed',
      verification,
    };
  }

  private serializeVerificationDetails(
    challengeRecord: SettlementRecord,
  ): NonNullable<PaymentProblemDetail['verification']> {
    return {
      challengeStatus: challengeRecord.status,
      attempts: challengeRecord.verificationAttempts,
      lastCheckedAt: challengeRecord.lastVerificationAt
        ? challengeRecord.lastVerificationAt.toISOString()
        : null,
      lastStatus: challengeRecord.lastVerificationStatus,
      lastError: challengeRecord.lastVerificationError,
      observedTxStatus: challengeRecord.lastObservedTxStatus,
      txHash:
        challengeRecord.lastVerificationTxHash || challengeRecord.txHash || null,
    };
  }

  private isVerifiedVerificationState(
    challengeRecord: SettlementRecord,
  ): boolean {
    return (
      challengeRecord.status === 'completed' ||
      challengeRecord.lastVerificationStatus === 'success' ||
      challengeRecord.lastVerificationStatus === 'cached-success'
    );
  }

  private isPendingVerificationState(
    challengeRecord: SettlementRecord,
  ): boolean {
    const pendingStatuses = new Set(['tx-pending', 'tx-not-found']);
    const pendingObservedStatuses = new Set(['pending', 'not-found']);

    return (
      (challengeRecord.lastVerificationStatus
        ? pendingStatuses.has(challengeRecord.lastVerificationStatus)
        : false) ||
      (challengeRecord.lastObservedTxStatus
        ? pendingObservedStatuses.has(challengeRecord.lastObservedTxStatus)
        : false)
    );
  }

  private getRetryAfterSeconds(): number {
    const value = parseInt(
      process.env.MPP_VERIFICATION_RETRY_AFTER_SECONDS || '3',
      10,
    );

    if (Number.isNaN(value) || value <= 0) {
      return 3;
    }

    return value;
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortValue(value));
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
