import { BadRequestException } from '@nestjs/common';
import { JsonDatabaseService } from '../database/json-database.service';
import { DpoService } from './dpo.service';

describe('DpoService', () => {
  let service: DpoService;

  beforeEach(() => {
    delete process.env.DPO_DB_PATH;
    service = new DpoService(new JsonDatabaseService());
  });

  it('returns dashboard KPIs', () => {
    const dashboard = service.getDashboard();

    expect(dashboard.kpis.totalMembers).toBeGreaterThan(0);
    expect(dashboard.kpis.monthlyRevenue).toBeGreaterThan(0);
    expect(dashboard.recent.complaints.length).toBeGreaterThan(0);
  });

  it('blocks duplicate active designation in same area', () => {
    const application = service.create('designation-applications', {
      applicant: 'Test User',
      designation: 'District Coordinator',
      wing: 'Welfare',
      province: 'Sindh',
      district: 'Karachi',
      area: 'Gulshan',
      paymentStatus: 'paid',
      status: 'pending',
    });

    expect(() =>
      service.runAction('designation-applications', application.id, 'approve'),
    ).toThrow(BadRequestException);
  });
});
