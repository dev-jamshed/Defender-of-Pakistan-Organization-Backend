import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DpoController } from './dpo.controller';
import { DpoService } from './dpo.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DpoController],
  providers: [DpoService],
  exports: [DpoService],
})
export class DpoModule {}
