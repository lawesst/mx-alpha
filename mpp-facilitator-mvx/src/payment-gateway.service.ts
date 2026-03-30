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

type ChargeOptions<T> = {
  amount: string;
  recipient: string;
  digest?: string;
  opaque?: Record<string, string>;
  source?: string;
  onAuthorized: () => Promise<T>;
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

    if (challengeId) {
      await this.storageService.save({
        id: challengeId,
        txHash: '',
        payer: options.source || '',
        receiver: options.recipient,
        amount: this.parseUnits(
          options.amount,
          parseInt(process.env.MPP_TOKEN_DECIMALS || '18', 10),
        ),
        currency: process.env.MPP_DEFAULT_CURRENCY || 'EGLD',
        chainId: process.env.MPP_CHAIN_ID || 'D',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: expires ? new Date(expires) : null,
        opaque: options.opaque ? this.stableStringify(options.opaque) : null,
        digest: options.digest || null,
        source: options.source || null,
      });
    } else {
      this.logger.warn('Unable to persist challenge because no challenge ID was found');
    }

    res.status(402).json({
      type: 'https://mpp.dev/errors/payment-required',
      title: 'Payment Required',
      status: 402,
      detail: `This resource requires a payment of ${options.amount} ${
        process.env.MPP_DEFAULT_CURRENCY || 'EGLD'
      }.`,
      challengeId,
      challenge,
    });
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
