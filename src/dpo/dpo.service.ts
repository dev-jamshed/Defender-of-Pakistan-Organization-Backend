import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JsonDatabaseService } from '../database/json-database.service';
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

@Injectable()
export class DpoService {
  private readonly schemas = new Map<ResourceName, ResourceSchema>(
    resourceSchemas.map((schema) => [schema.resource, schema]),
  );

  constructor(private readonly database: JsonDatabaseService) {}

  getHealth() {
    return {
      name: 'Defender of Pakistan Organization API',
      shortCode: 'DPO',
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  getSchemas(): ResourceSchema[] {
    return resourceSchemas;
  }

  getDashboard(): DashboardSummary {
    const members = this.collection('members');
    const applications = this.collection('membership-applications');
    const designations = this.collection('active-designations');
    const designationApplications = this.collection('designation-applications');
    const complaints = this.collection('complaints');
    const payments = this.collection('payments');
    const donations = this.collection('donations');
    const devices = this.collection('wireless-devices');

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

  list(resource: ResourceName, query: ListQuery = {}): ListResponse {
    const schema = this.schema(resource);
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 25), 1), 100);
    const filtered = this.collection(resource).filter((record) => {
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

  get(resource: ResourceName, id: string): DpoRecord {
    const record = this.collection(resource).find((item) => item.id === id);
    if (!record) {
      throw new NotFoundException(`${resource} record not found`);
    }

    return record;
  }

  create(resource: ResourceName, payload: Record<string, unknown>): DpoRecord {
    this.schema(resource);
    const timestamp = new Date().toISOString();
    const record: DpoRecord = {
      id: this.nextId(resource),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...payload,
      status: this.toStatus(payload.status),
    };

    this.database.insert(resource, record);
    this.audit('system', 'create', resource, record.id, { payload });
    return record;
  }

  update(
    resource: ResourceName,
    id: string,
    payload: Record<string, unknown>,
  ): DpoRecord {
    const record = this.get(resource, id);
    Object.assign(record, payload, { updatedAt: new Date().toISOString() });
    this.database.save();
    this.audit('system', 'update', resource, id, { payload });
    return record;
  }

  runAction(
    resource: ResourceName,
    id: string,
    action: string,
    payload: Record<string, unknown> = {},
  ) {
    const record = this.get(resource, id);

    if (resource === 'designation-applications' && action === 'approve') {
      this.assertNoDuplicateDesignation(record);
      const activeDesignation = this.create('active-designations', {
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
      this.update(resource, id, { status: 'approved' });
      return { record: this.get(resource, id), activeDesignation };
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
      this.update(resource, id, {
        status: nextStatus,
        lastAction: action,
        actionPayload: payload,
      });
    } else {
      this.update(resource, id, { lastAction: action, actionPayload: payload });
    }

    this.audit('system', action, resource, id, payload);
    return { record: this.get(resource, id), action };
  }

  verifyMember(membershipNumber: string) {
    const member = this.collection('members').find(
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

  verifyWirelessDevice(imei: string) {
    const device = this.collection('wireless-devices').find(
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

  trackComplaint(complaintNumber: string) {
    const complaint = this.collection('complaints').find(
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

  getPublicCms() {
    return this.collection('cms-pages').filter(
      (page) => page.status === 'published',
    );
  }

  getPublicGallery() {
    return this.collection('gallery-albums').filter(
      (album) => album.status === 'published',
    );
  }

  getPublicWelfare() {
    return this.collection('welfare-campaigns').filter(
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

  private collection(resource: ResourceName): DpoRecord[] {
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

  private assertNoDuplicateDesignation(record: DpoRecord) {
    const duplicate = this.collection('active-designations').find(
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

  private audit(
    actor: string,
    action: string,
    resource: string,
    resourceId: string,
    meta: unknown,
  ) {
    const timestamp = new Date().toISOString();
    this.database.insert('audit-logs', {
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
