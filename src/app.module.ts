import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DpoModule } from './dpo/dpo.module';

@Module({
  imports: [DpoModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
