import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuditReportsService,
  PaidIntelAuditReportStatus,
} from './audit-reports.service';

@Controller('audit-reports')
export class AuditReportsController {
  constructor(private readonly auditReportsService: AuditReportsService) {}

  @Post()
  async ingestReport(@Body() body: unknown) {
    return this.auditReportsService.ingestReport(body);
  }

  @Get()
  async listReports(
    @Query('endpoint') endpoint?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditReportsService.listReports({
      endpoint,
      status: parseStatus(status),
      limit: parseLimit(limit),
    });
  }

  @Get('summary')
  async getSummary(@Query('endpoint') endpoint?: string) {
    return this.auditReportsService.getSummary({ endpoint });
  }

  @Get(':id')
  async getReport(@Param('id') id: string) {
    if (!id) {
      throw new BadRequestException('Path parameter "id" is required');
    }

    return this.auditReportsService.getReport(id);
  }
}

function parseStatus(
  status?: string,
): PaidIntelAuditReportStatus | undefined {
  if (status === undefined) {
    return undefined;
  }
  if (status === 'success' || status === 'error') {
    return status;
  }
  throw new BadRequestException(
    'Query parameter "status" must be "success" or "error"',
  );
}

function parseLimit(limit?: string): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BadRequestException(
      'Query parameter "limit" must be an integer between 1 and 100',
    );
  }
  return parsed;
}
