// =============================================================================
// CookiesModule - expone CookiesService globalmente
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { CookiesService } from './cookies.service';

@Global()
@Module({
  providers: [CookiesService],
  exports: [CookiesService],
})
export class CookiesModule {}
