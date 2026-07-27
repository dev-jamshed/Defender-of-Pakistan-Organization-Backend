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

  it('requires each identity document type for public applications', async () => {
    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const documents = ['front-one.png', 'front-two.png', 'front-three.png'].map(
      (name) => ({
        kind: 'cnic-front',
        label: 'CNIC Front',
        name,
        dataUrl: image,
      }),
    );

    await expect(
      service.submitMembershipApplication({
        name: 'Test Applicant',
        phone: '03001234567',
        membershipType: 'General',
        termsAccepted: true,
        documents,
      }),
    ).rejects.toThrow('CNIC front, CNIC back and profile photo are required');
  });

  it('blocks designation approval until structured documents are verified', async () => {
    const application = await service.create('designation-applications', {
      applicant: 'Document Review Applicant',
      designation: 'President',
      wing: 'General',
      province: 'Sindh',
      district: 'Hyderabad',
      area: 'Latifabad',
      paymentStatus: 'paid',
      documents: [
        {
          kind: 'cnic-front',
          url: '/uploads/test/front.png',
          status: 'pending',
        },
      ],
      documentsVerified: false,
      status: 'pending',
    });

    await expect(
      service.runAction('designation-applications', application.id, 'approve'),
    ).rejects.toThrow('Verify all uploaded documents before approval');
  });
});
