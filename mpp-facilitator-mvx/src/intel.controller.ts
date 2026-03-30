import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { IntelService } from './intel.service';
import { PaymentGatewayService } from './payment-gateway.service';

@Controller('intel')
export class IntelController {
  constructor(
    private readonly intelService: IntelService,
    private readonly paymentGatewayService: PaymentGatewayService,
  ) {}

  @Get('token-risk')
  async getTokenRisk(
    @Query('token') token: string,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
  ) {
    if (!token) {
      throw new BadRequestException('Query parameter "token" is required');
    }

    await this.paymentGatewayService.handleCharge(req, res, {
      amount: process.env.MPP_TOKEN_RISK_PRICE || '0.05',
      recipient: this.getRecipient(),
      opaque: { resource: 'token-risk', token },
      onAuthorized: () => this.intelService.getTokenRisk(token),
    });
  }

  @Get('wallet-profile')
  async getWalletProfile(
    @Query('address') address: string,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
  ) {
    if (!address) {
      throw new BadRequestException('Query parameter "address" is required');
    }

    await this.paymentGatewayService.handleCharge(req, res, {
      amount: process.env.MPP_WALLET_PROFILE_PRICE || '0.10',
      recipient: this.getRecipient(),
      opaque: { resource: 'wallet-profile', address },
      onAuthorized: () => this.intelService.getWalletProfile(address),
    });
  }

  @Get('swap-sim')
  async getSwapSimulation(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('amount') amount: string,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
  ) {
    if (!from) {
      throw new BadRequestException('Query parameter "from" is required');
    }
    if (!to) {
      throw new BadRequestException('Query parameter "to" is required');
    }
    if (!amount) {
      throw new BadRequestException('Query parameter "amount" is required');
    }

    await this.paymentGatewayService.handleCharge(req, res, {
      amount: process.env.MPP_SWAP_SIM_PRICE || '0.07',
      recipient: this.getRecipient(),
      opaque: { resource: 'swap-sim', from, to, amount },
      onAuthorized: () => this.intelService.getSwapSimulation(from, to, amount),
    });
  }

  @Get('swap-plan')
  async getSwapPlan(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('amount') amount: string,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
  ) {
    if (!from) {
      throw new BadRequestException('Query parameter "from" is required');
    }
    if (!to) {
      throw new BadRequestException('Query parameter "to" is required');
    }
    if (!amount) {
      throw new BadRequestException('Query parameter "amount" is required');
    }

    await this.paymentGatewayService.handleCharge(req, res, {
      amount: process.env.MPP_SWAP_PLAN_PRICE || '0.12',
      recipient: this.getRecipient(),
      opaque: { resource: 'swap-plan', from, to, amount },
      onAuthorized: () => this.intelService.getSwapExecutionPlan(from, to, amount),
    });
  }

  private getRecipient(): string {
    const recipient = process.env.MPP_RECIPIENT;
    if (!recipient) {
      throw new InternalServerErrorException(
        'MPP_RECIPIENT environment variable is required for paid intel endpoints',
      );
    }
    return recipient;
  }
}
