import { Injectable, Logger } from '@nestjs/common';
import { Mppx } from 'mppx/server';
import { charge, session, subscription } from 'mppx-multiversx/server';
import { VerifierService } from './verifier.service';

@Injectable()
export class MppxService {
  public instance: any; // ReturnType<typeof Mppx.create> has generic issues in some TS versions
  public mvxChargeMethod: any;
  public mvxSessionMethod: any;
  public mvxSubscriptionMethod: any;
  private readonly logger = new Logger(MppxService.name);

  constructor(private verifierService: VerifierService) {
    const secretKey = process.env.MPP_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        'MPP_SECRET_KEY environment variable is required. ' +
          'Generate a strong random key for HMAC-bound challenge IDs.',
      );
    }

    const currency = process.env.MPP_DEFAULT_CURRENCY || 'EGLD';
    const chainId = process.env.MPP_CHAIN_ID || 'D';
    const decimals = parseInt(process.env.MPP_TOKEN_DECIMALS || '18', 10);

    const verifyCb = async ({
      txHash,
      sender,
      challengeId,
      amount,
      currency: txCurrency,
      source,
      opaque,
      digest,
    }: {
      txHash: string;
      sender: string;
      challengeId: string;
      amount: string;
      currency?: string;
      source?: string;
      opaque?: Record<string, string>;
      digest?: string;
      duration?: string;
      interval?: string;
    }) => {
      return await this.verifierService.verifyTransaction(
        txHash,
        sender,
        challengeId,
        amount,
        txCurrency || currency,
        source,
        opaque,
        digest,
      );
    };

    this.mvxChargeMethod = charge({
      decimals,
      chainId,
      currency,
      verifyTransaction: verifyCb,
    });

    this.mvxSessionMethod = session({
      decimals,
      chainId,
      currency,
      verifyTransaction: verifyCb,
    });

    this.mvxSubscriptionMethod = subscription({
      decimals,
      chainId,
      currency,
      verifyTransaction: verifyCb,
    });

    this.instance = Mppx.create({
      methods: [
        this.mvxChargeMethod,
        this.mvxSessionMethod,
        this.mvxSubscriptionMethod,
      ] as any[],
      realm: process.env.MPP_REALM || 'agentic-payments-mvx',
      secretKey,
    });

    this.logger.log(
      `MPP initialized: currency=${currency}, chainId=${chainId}, decimals=${decimals}`,
    );
  }
}
