import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seedData } from '../dpo/dpo.seed';
import { DpoRecord, ResourceName } from '../dpo/dpo.types';

type DpoDatabase = Record<ResourceName, DpoRecord[]>;

@Injectable()
export class JsonDatabaseService {
  private readonly dbPath: string;
  private data: DpoDatabase;

  constructor() {
    const defaultFileName =
      process.env.NODE_ENV === 'test' ? 'dpo-test-db.json' : 'dpo-db.json';
    this.dbPath =
      process.env.DPO_DB_PATH ?? join(process.cwd(), 'data', defaultFileName);
    this.data = this.load();
  }

  collection(resource: ResourceName): DpoRecord[] {
    this.ensureResource(resource);
    return this.data[resource];
  }

  insert(resource: ResourceName, record: DpoRecord): DpoRecord {
    this.collection(resource).unshift(record);
    this.save();
    return record;
  }

  save(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
  }

  reset(): void {
    this.data = this.cloneSeed();
    this.save();
  }

  private load(): DpoDatabase {
    if (process.env.NODE_ENV === 'test') {
      return this.cloneSeed();
    }

    if (!existsSync(this.dbPath)) {
      const seeded = this.cloneSeed();
      mkdirSync(dirname(this.dbPath), { recursive: true });
      writeFileSync(this.dbPath, JSON.stringify(seeded, null, 2));
      return seeded;
    }

    const parsed = JSON.parse(readFileSync(this.dbPath, 'utf8')) as Partial<
      Record<ResourceName, DpoRecord[]>
    >;
    const completeData = this.cloneSeed();

    for (const resource of Object.keys(seedData) as ResourceName[]) {
      if (Array.isArray(parsed[resource])) {
        completeData[resource] = parsed[resource];
      }
    }

    return completeData;
  }

  private cloneSeed(): DpoDatabase {
    return JSON.parse(JSON.stringify(seedData)) as DpoDatabase;
  }

  private ensureResource(resource: ResourceName): void {
    if (!this.data[resource]) {
      this.data[resource] = [];
    }
  }
}
