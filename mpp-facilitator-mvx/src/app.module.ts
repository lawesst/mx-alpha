import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StorageService } from './storage.service';
import { VerifierService } from './verifier.service';
import { MppxService } from './mppx.service';
import { RelayerService } from './relayer.service';
import { DiscoveryController } from './discovery.controller';
import { PrismaService } from './prisma.service';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { PaymentGatewayService } from './payment-gateway.service';
import { IntelController } from './intel.controller';
import { IntelService } from './intel.service';
import { AuditReportsController } from './audit-reports.controller';
import { AuditReportsService } from './audit-reports.service';

@Module({
  imports: [],
  controllers: [
    AppController,
    DiscoveryController,
    SessionController,
    IntelController,
    AuditReportsController,
  ],
  providers: [
    AppService,
    PrismaService,
    StorageService,
    VerifierService,
    MppxService,
    RelayerService,
    SessionService,
    PaymentGatewayService,
    IntelService,
    AuditReportsService,
  ],
})
export class AppModule {}
