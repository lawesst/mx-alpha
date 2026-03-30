import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Logger,
  UseInterceptors,
} from '@nestjs/common';
import { SessionService } from './session.service';

@Controller('sessions')
export class SessionController {
  private readonly logger = new Logger(SessionController.name);

  constructor(private readonly sessionService: SessionService) {}

  @Post()
  async createSession(
    @Body()
    data: {
      channelId: string;
      employer: string;
      receiver: string;
      tokenId: string;
      amountLocked: string;
    },
  ) {
    this.logger.log(`Received request to create session: ${data.channelId}`);
    return this.sessionService.createSession(data);
  }

  @Get(':channelId')
  async getSession(@Param('channelId') channelId: string) {
    return this.sessionService.getSession(channelId);
  }

  @Post(':channelId/vouchers')
  async addVoucher(
    @Param('channelId') channelId: string,
    @Body()
    data: {
      amount: string;
      nonce: number;
      signature: string;
    },
  ) {
    this.logger.log(`Received voucher for session: ${channelId}`);
    return this.sessionService.addVoucher(channelId, data);
  }

  @Get()
  async listSessions() {
    return this.sessionService.listActiveSessions();
  }
}
