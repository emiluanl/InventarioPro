// =============================================================================
// ReportsController - agregados para el panel de reportes
// =============================================================================

import { BadRequestException, Controller, Get, Query } from '@nestjs/common';

import { ReportsService } from './reports.service';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Gasto del usuario, opcionalmente filtrado por año (?year=2026). */
  @Get('spending')
  spending(@CurrentUser() user: AuthUser, @Query('year') year?: string) {
    let parsed: number | undefined;
    if (year !== undefined) {
      parsed = Number(year);
      if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
        throw new BadRequestException('Año inválido.');
      }
    }
    return this.reports.spendingReport(user.id, parsed);
  }
}
