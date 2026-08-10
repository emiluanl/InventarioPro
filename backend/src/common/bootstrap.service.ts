// =============================================================================
// BootstrapService - tareas de arranque (seed de categorías del sistema)
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { CategoriesService } from '../categories/categories.service';

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly categories: CategoriesService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.categories.seedSystemCategories();
      this.logger.log('Categorías del sistema verificadas.');
    } catch (err) {
      this.logger.error(
        `No se pudieron sembrar las categorías del sistema: ${(err as Error).message}`,
      );
    }
  }
}
