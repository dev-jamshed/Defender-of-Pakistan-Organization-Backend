import { Module } from '@nestjs/common';
import { JsonDatabaseService } from './json-database.service';

@Module({
  providers: [JsonDatabaseService],
  exports: [JsonDatabaseService],
})
export class DatabaseModule {}
