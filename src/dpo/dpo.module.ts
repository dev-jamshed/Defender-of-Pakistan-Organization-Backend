import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AdminAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DpoController } from './dpo.controller';
import { DpoService } from './dpo.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DpoController],
  providers: [AuthService, AdminAuthGuard, DpoService],
  exports: [DpoService],
})
export class DpoModule {}
