import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seedData } from '../dpo/dpo.seed';
import { DpoRecord, ResourceName } from '../dpo/dpo.types';

type StoredDpoRecord = {
  id: string;
  resource: string;
  status: string | null;
  dataJson: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaDatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly dbPath: string;
  private readonly prisma: PrismaClient;

  constructor() {
    this.dbPath =
      process.env.DATABASE_FILE_PATH ??
      join(
        process.cwd(),
        'data',
        process.env.NODE_ENV === 'test' ? 'dpo-test.sqlite' : 'dpo.sqlite',
      );
    mkdirSync(dirname(this.dbPath), { recursive: true });

    const adapter = new PrismaBetterSqlite3({ url: this.dbPath });
    this.prisma = new PrismaClient({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    await this.ensureSchema();
    await this.syncSeedRecords();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async collection(resource: ResourceName): Promise<DpoRecord[]> {
    const records = await this.prisma.dpoRecord.findMany({
      where: { resource },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record) => this.fromStored(record));
  }

  async allCollections(
    resources: ResourceName[],
  ): Promise<Record<ResourceName, DpoRecord[]>> {
    const storedRecords = await this.prisma.dpoRecord.findMany({
      where: { resource: { in: resources } },
      orderBy: { createdAt: 'desc' },
    });
    const grouped = {} as Record<ResourceName, DpoRecord[]>;
    for (const resource of resources) {
      grouped[resource] = [];
    }

    for (const record of storedRecords) {
      grouped[record.resource as ResourceName].push(this.fromStored(record));
    }

    return grouped;
  }

  async insert(resource: ResourceName, record: DpoRecord): Promise<DpoRecord> {
    await this.prisma.dpoRecord.create({
      data: this.toStored(resource, record),
    });
    return record;
  }

  async update(
    resource: ResourceName,
    id: string,
    record: DpoRecord,
  ): Promise<DpoRecord> {
    await this.prisma.dpoRecord.update({
      where: { id },
      data: {
        resource,
        status: this.toOptionalString(record.status),
        dataJson: JSON.stringify(record),
        updatedAt: new Date(record.updatedAt),
      },
    });
    return record;
  }

  async delete(resource: ResourceName, id: string): Promise<void> {
    await this.prisma.dpoRecord.delete({
      where: { id },
    });
  }

  async reset(): Promise<void> {
    await this.ensureSchema();
    await this.prisma.dpoRecord.deleteMany();
    await this.seed();
  }

  async stats(resources: ResourceName[]) {
    const rows = await this.prisma.dpoRecord.groupBy({
      by: ['resource'],
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      resources.map((resource) => [resource, 0]),
    ) as Record<ResourceName, number>;

    for (const row of rows) {
      counts[row.resource as ResourceName] = row._count._all;
    }

    return {
      engine: 'prisma',
      provider: 'sqlite',
      databaseFile: this.dbPath,
      totalRecords: rows.reduce((sum, row) => sum + row._count._all, 0),
      resourceCounts: counts,
    };
  }

  private async ensureSchema(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS DpoRecord (
        id TEXT PRIMARY KEY NOT NULL,
        resource TEXT NOT NULL,
        status TEXT,
        dataJson TEXT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS DpoRecord_resource_idx ON DpoRecord(resource);',
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS DpoRecord_resource_status_idx ON DpoRecord(resource, status);',
    );
  }

  private async seed(): Promise<void> {
    const rows = Object.entries(seedData).flatMap(([resource, records]) =>
      records.map((record) => this.toStored(resource as ResourceName, record)),
    );

    if (rows.length > 0) {
      await this.prisma.dpoRecord.createMany({ data: rows });
    }
  }

  private async syncSeedRecords(): Promise<void> {
    for (const [resource, records] of Object.entries(seedData)) {
      for (const record of records) {
        const data = this.toStored(resource as ResourceName, record);
        if (resource === 'settings') {
          const existing = await this.prisma.dpoRecord.findUnique({
            where: { id: record.id },
          });
          if (existing) {
            continue;
          }
        }
        if (resource === 'cms-pages') {
          const existing = await this.prisma.dpoRecord.findUnique({
            where: { id: record.id },
          });
          if (existing) {
            const existingRecord = this.fromStored(existing);
            const merged = this.mergeMissingRecord(existingRecord, record);
            await this.prisma.dpoRecord.update({
              where: { id: record.id },
              data: {
                resource: data.resource,
                status: this.toOptionalString(merged.status),
                dataJson: JSON.stringify(merged),
                updatedAt: new Date(merged.updatedAt),
              },
            });
            continue;
          }
        }
        await this.prisma.dpoRecord.upsert({
          where: { id: record.id },
          create: data,
          update: {
            resource: data.resource,
            status: data.status,
            dataJson: data.dataJson,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          },
        });
      }
    }
  }

  private mergeMissingRecord(
    existing: DpoRecord,
    fallback: DpoRecord,
  ): DpoRecord {
    const merged = this.mergeMissingValue(existing, fallback) as DpoRecord;
    return {
      ...merged,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }

  private mergeMissingValue(existing: unknown, fallback: unknown): unknown {
    if (this.hasContent(existing)) {
      if (
        existing &&
        fallback &&
        typeof existing === 'object' &&
        typeof fallback === 'object' &&
        !Array.isArray(existing) &&
        !Array.isArray(fallback)
      ) {
        const merged: Record<string, unknown> = {
          ...(existing as Record<string, unknown>),
        };
        for (const [key, value] of Object.entries(
          fallback as Record<string, unknown>,
        )) {
          merged[key] = this.mergeMissingValue(merged[key], value);
        }
        return merged;
      }
      return existing;
    }
    return fallback;
  }

  private hasContent(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  private toStored(resource: ResourceName, record: DpoRecord) {
    return {
      id: record.id,
      resource,
      status: this.toOptionalString(record.status),
      dataJson: JSON.stringify(record),
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }

  private fromStored(record: StoredDpoRecord): DpoRecord {
    return JSON.parse(record.dataJson) as DpoRecord;
  }

  private toOptionalString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }
}
