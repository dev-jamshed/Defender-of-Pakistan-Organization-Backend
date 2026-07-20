import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import {
  DashboardSummary,
  DpoRecord,
  DpoStatus,
  ListQuery,
  ListResponse,
  ResourceName,
  ResourceSchema,
} from './dpo.types';
import { resourceSchemas } from './dpo.seed';

const dashboardResources: ResourceName[] = [
  'members',
  'membership-applications',
  'active-designations',
  'designation-applications',
  'complaints',
  'payments',
  'donations',
  'wireless-devices',
];

@Injectable()
export class DpoService {
  private readonly schemas = new Map<ResourceName, ResourceSchema>(
    resourceSchemas.map((schema) => [schema.resource, schema]),
  );

  constructor(private readonly database: PrismaDatabaseService) {}

  getHealth() {
    return {
      name: 'Defenders of Pakistan Organization API',
      shortCode: 'DPO',
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  getSchemas(): ResourceSchema[] {
    return resourceSchemas;
  }

  async getDatabaseStatus() {
    return this.database.stats(
      resourceSchemas.map((schema) => schema.resource),
    );
  }

  async getDashboard(): Promise<DashboardSummary> {
    const data = await this.database.allCollections(dashboardResources);
    const members = data.members;
    const applications = data['membership-applications'];
    const designations = data['active-designations'];
    const designationApplications = data['designation-applications'];
    const complaints = data.complaints;
    const payments = data.payments;
    const donations = data.donations;
    const devices = data['wireless-devices'];

    const paidPayments = payments.filter(
      (payment) => payment.status === 'paid',
    );
    const totalRevenue = paidPayments.reduce(
      (sum, payment) => sum + Number(payment.totalAmount ?? 0),
      0,
    );
    const totalDonations = donations.reduce(
      (sum, donation) => sum + Number(donation.amount ?? 0),
      0,
    );

    return {
      kpis: {
        totalMembers: members.length,
        pendingApplications: applications.filter(
          (item) => item.status === 'pending',
        ).length,
        activeMembers: members.filter((item) => item.status === 'active')
          .length,
        expiredMembers: members.filter((item) => item.status === 'expired')
          .length,
        totalDesignations: designations.length,
        pendingDesignations: designationApplications.filter(
          (item) => item.status === 'pending',
        ).length,
        openComplaints: complaints.filter(
          (item) => !['resolved', 'closed'].includes(String(item.status)),
        ).length,
        urgentComplaints: complaints.filter((item) => item.priority === 'high')
          .length,
        todayPayments: paidPayments.length,
        monthlyRevenue: totalRevenue,
        totalDonations,
        activeWirelessDevices: devices.filter(
          (item) => item.status === 'active',
        ).length,
      },
      charts: {
        membershipApplicationsByMonth: [
          { month: 'Jan', applications: 210, approved: 180 },
          { month: 'Feb', applications: 240, approved: 205 },
          { month: 'Mar', applications: 320, approved: 286 },
          { month: 'Apr', applications: 410, approved: 350 },
          { month: 'May', applications: 376, approved: 330 },
          { month: 'Jun', applications: 452, approved: 398 },
        ],
        revenueByMonth: [
          { month: 'Jan', revenue: 1250000 },
          { month: 'Feb', revenue: 1710000 },
          { month: 'Mar', revenue: 2200000 },
          { month: 'Apr', revenue: 2640000 },
          { month: 'May', revenue: 2870000 },
          { month: 'Jun', revenue: totalRevenue },
        ],
        complaintCategories: this.countBy(complaints, 'category'),
        paymentSuccessFailureRatio: this.countBy(payments, 'status'),
      },
      recent: {
        membershipApplications: applications.slice(0, 5),
        complaints: complaints.slice(0, 5),
        payments: payments.slice(0, 5),
      },
    };
  }

  async list(
    resource: ResourceName,
    query: ListQuery = {},
  ): Promise<ListResponse> {
    const schema = this.schema(resource);
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 25), 1), 100);
    const collection = await this.collection(resource);
    const filtered = collection.filter((record) => {
      const searchMatch =
        !query.q ||
        schema.searchableFields.some((field) =>
          this.includes(record[field], query.q),
        );
      const filtersMatch = schema.filterFields.every((field) => {
        const value = query[field as keyof ListQuery];
        return (
          !value ||
          this.toText(record[field]).toLowerCase() ===
            this.toText(value).toLowerCase()
        );
      });
      const statusMatch =
        !query.status ||
        this.toText(record.status).toLowerCase() === query.status.toLowerCase();

      return searchMatch && filtersMatch && statusMatch;
    });

    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    return {
      data,
      meta: {
        total: filtered.length,
        page,
        limit,
        totalPages: Math.max(Math.ceil(filtered.length / limit), 1),
      },
    };
  }

  async get(resource: ResourceName, id: string): Promise<DpoRecord> {
    const record = (await this.collection(resource)).find(
      (item) => item.id === id,
    );
    if (!record) {
      throw new NotFoundException(`${resource} record not found`);
    }

    return record;
  }

  async create(
    resource: ResourceName,
    payload: Record<string, unknown>,
  ): Promise<DpoRecord> {
    this.schema(resource);
    const timestamp = new Date().toISOString();
    const record: DpoRecord = {
      id: this.nextId(resource),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...payload,
      status: this.toStatus(payload.status),
    };

    await this.database.insert(resource, record);
    await this.audit('system', 'create', resource, record.id, { payload });
    return record;
  }

  async update(
    resource: ResourceName,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<DpoRecord> {
    const record = await this.get(resource, id);
    Object.assign(record, payload, { updatedAt: new Date().toISOString() });
    await this.database.update(resource, id, record);
    await this.audit('system', 'update', resource, id, { payload });
    return record;
  }

  async runAction(
    resource: ResourceName,
    id: string,
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const record = await this.get(resource, id);

    if (resource === 'designation-applications' && action === 'approve') {
      await this.assertNoDuplicateDesignation(record);
      const activeDesignation = await this.create('active-designations', {
        holder: record.applicant,
        membershipNumber: payload.membershipNumber ?? null,
        designation: record.designation,
        wing: record.wing,
        province: record.province,
        district: record.district,
        area: record.area,
        status: 'active',
        issueDate: new Date().toISOString().slice(0, 10),
        expiryDate: payload.expiryDate ?? null,
      });
      await this.update(resource, id, { status: 'approved' });
      return { record: await this.get(resource, id), activeDesignation };
    }

    const actionStatusMap: Record<string, DpoStatus> = {
      approve: 'approved',
      reject: 'rejected',
      suspend: 'suspended',
      reactivate: 'active',
      resolve: 'resolved',
      close: 'closed',
      publish: 'published',
      archive: 'archived',
      markPaid: 'paid',
      fail: 'failed',
    };

    const nextStatus = actionStatusMap[action];
    if (nextStatus) {
      await this.update(resource, id, {
        status: nextStatus,
        lastAction: action,
        actionPayload: payload,
      });
    } else {
      await this.update(resource, id, {
        lastAction: action,
        actionPayload: payload,
      });
    }

    await this.audit('system', action, resource, id, payload);
    return { record: await this.get(resource, id), action };
  }

  async verifyMember(membershipNumber: string) {
    const member = (await this.collection('members')).find(
      (item) => item.membershipNumber === membershipNumber,
    );
    return {
      verified: Boolean(member && member.status === 'active'),
      member: member
        ? {
            membershipNumber: member.membershipNumber,
            name: member.name,
            status: member.status,
            issueDate: member.issueDate,
            expiryDate: member.expiryDate,
          }
        : null,
    };
  }

  async verifyWirelessDevice(imei: string) {
    const device = (await this.collection('wireless-devices')).find(
      (item) => item.imei === imei,
    );
    return {
      verified: Boolean(device && device.status === 'active'),
      device: device
        ? {
            imei: device.imei,
            brand: device.brand,
            model: device.model,
            registrationNumber: device.registrationNumber,
            status: device.status,
            expiryDate: device.expiryDate,
          }
        : null,
    };
  }

  async trackComplaint(complaintNumber: string) {
    const complaint = (await this.collection('complaints')).find(
      (item) => item.complaintNumber === complaintNumber,
    );
    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }

    return {
      complaintNumber: complaint.complaintNumber,
      status: complaint.status,
      priority: complaint.priority,
      subject: complaint.subject,
      publicResponse: complaint.publicResponse,
      submittedDate: complaint.submittedDate,
      updatedAt: complaint.updatedAt,
    };
  }

  async getPublicCms() {
    return (await this.collection('cms-pages')).filter(
      (page) => page.status === 'published',
    );
  }

  async getPublicGallery() {
    return (await this.collection('gallery-albums')).filter(
      (album) => album.status === 'published',
    );
  }

  async getPublicWelfare() {
    return (await this.collection('welfare-campaigns')).filter(
      (campaign) => campaign.status === 'published',
    );
  }

  private schema(resource: ResourceName): ResourceSchema {
    const schema = this.schemas.get(resource);
    if (!schema) {
      throw new NotFoundException(`Unsupported resource: ${resource}`);
    }

    return schema;
  }

  private async collection(resource: ResourceName): Promise<DpoRecord[]> {
    this.schema(resource);
    return this.database.collection(resource);
  }

  private includes(value: unknown, query?: string): boolean {
    return this.toText(value)
      .toLowerCase()
      .includes(this.toText(query).toLowerCase());
  }

  private countBy(records: DpoRecord[], field: string) {
    return records.reduce<Record<string, number>>((acc, record) => {
      const key = this.toText(record[field]) || 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }

  private toText(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value);
  }

  private toStatus(value: unknown): DpoStatus {
    const allowed: DpoStatus[] = [
      'draft',
      'pending',
      'under_review',
      'approved',
      'active',
      'paid',
      'failed',
      'expired',
      'suspended',
      'rejected',
      'resolved',
      'closed',
      'published',
      'archived',
    ];

    return allowed.includes(value as DpoStatus)
      ? (value as DpoStatus)
      : 'pending';
  }

  private nextId(resource: ResourceName) {
    return `${resource.replaceAll('-', '_')}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  private async assertNoDuplicateDesignation(record: DpoRecord) {
    const duplicate = (await this.collection('active-designations')).find(
      (designation) =>
        designation.status === 'active' &&
        designation.designation === record.designation &&
        designation.area === record.area &&
        designation.district === record.district,
    );

    if (duplicate) {
      throw new BadRequestException(
        'Same area same active designation duplicate not allowed',
      );
    }
  }

  private async audit(
    actor: string,
    action: string,
    resource: string,
    resourceId: string,
    meta: unknown,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.database.insert('audit-logs', {
      id: this.nextId('audit-logs'),
      createdAt: timestamp,
      updatedAt: timestamp,
      actor,
      action,
      resource,
      resourceId,
      meta,
      ipAddress: '127.0.0.1',
      userAgent: 'api',
    });
  }
}
