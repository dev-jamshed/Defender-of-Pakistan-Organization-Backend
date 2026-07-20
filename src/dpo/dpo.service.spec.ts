import { BadRequestException } from '@nestjs/common';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import { DpoService } from './dpo.service';

describe('DpoService', () => {
  let service: DpoService;
  let database: PrismaDatabaseService;

  beforeEach(async () => {
    process.env.DATABASE_FILE_PATH = ':memory:';
    database = new PrismaDatabaseService();
    await database.onModuleInit();
    service = new DpoService(database);
  });

  afterEach(async () => {
    await database.onModuleDestroy();
    delete process.env.DATABASE_FILE_PATH;
  });

  it('returns dashboard KPIs', async () => {
    const dashboard = await service.getDashboard();

    expect(dashboard.kpis.totalMembers).toBeGreaterThan(0);
    expect(dashboard.kpis.monthlyRevenue).toBeGreaterThan(0);
    expect(dashboard.recent.complaints.length).toBeGreaterThan(0);
  });

  it('blocks duplicate active designation in same area', async () => {
    const application = await service.create('designation-applications', {
      applicant: 'Test User',
      designation: 'District Coordinator',
      wing: 'Welfare',
      province: 'Sindh',
      district: 'Karachi',
      area: 'Gulshan',
      paymentStatus: 'paid',
      status: 'pending',
    });

    await expect(
      service.runAction('designation-applications', application.id, 'approve'),
    ).rejects.toThrow(BadRequestException);
  });
});
