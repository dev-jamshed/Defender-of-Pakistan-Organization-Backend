import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import { AuthService } from './auth.service';
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

  constructor(
    private readonly database: PrismaDatabaseService,
    private readonly authService: AuthService,
  ) {}

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

  async login(email: string, password: string) {
    const normalizedEmail = this.toText(email).trim().toLowerCase();
    const admin = (await this.collection('admin-users')).find(
      (user) =>
        this.toText(user.email).toLowerCase() === normalizedEmail &&
        user.status !== 'suspended',
    );
    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const hasPasswordHash = typeof admin.passwordHash === 'string';
    const validPassword = hasPasswordHash
      ? this.authService.verifyPassword(password, admin.passwordHash)
      : password === (process.env.DPO_BOOTSTRAP_ADMIN_PASSWORD ?? 'admin123');

    if (!validPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!hasPasswordHash) {
      admin.passwordHash = this.authService.hashPassword(password);
    }
    admin.lastLoginAt = new Date().toISOString();
    await this.database.update('admin-users', admin.id, admin);

    const user = {
      id: admin.id,
      name: this.toText(admin.name) || 'Admin',
      email: this.toText(admin.email),
      role: this.toText(admin.role) || 'Admin',
    };

    return {
      token: this.authService.signToken(user),
      user,
    };
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
    await this.notifyAdmin('created', resource, record);
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
    await this.notifyAdmin('updated', resource, record);
    return record;
  }

  async delete(
    resource: ResourceName,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.get(resource, id);
    await this.database.delete(resource, id);
    await this.audit('system', 'delete', resource, id, {});
    await this.notifyAdmin('deleted', resource, { id } as DpoRecord);
    return { id, deleted: true };
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
      unpublish: 'draft',
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
    const identifier = this.toText(membershipNumber).trim().toLowerCase();
    const members = await this.collection('members');
    const designations = await this.collection('active-designations');
    const member = members.find((item) => {
      const membershipMatch =
        this.toText(item.membershipNumber).toLowerCase() === identifier;
      const maskedCnicMatch =
        this.toText(item.cnicMasked).toLowerCase() === identifier;
      return membershipMatch || maskedCnicMatch;
    });
    const designation = member
      ? designations.find(
          (item) =>
            item.status === 'active' &&
            this.toText(item.membershipNumber) ===
              this.toText(member.membershipNumber),
        )
      : null;
    return {
      verified: Boolean(member && member.status === 'active'),
      member: member
        ? {
            membershipNumber: member.membershipNumber,
            name: member.name,
            photo: member.photo ?? member.profilePhoto ?? null,
            membershipType: member.membershipType,
            designation: designation?.designation ?? member.designation ?? null,
            region:
              designation?.district ??
              member.district ??
              designation?.province ??
              member.country ??
              null,
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
      category: complaint.category,
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

  async getPublicSite() {
    const [
      cmsPages,
      galleryAlbums,
      welfareCampaigns,
      members,
      activeDesignations,
      settings,
    ] = await Promise.all([
      this.collection('cms-pages'),
      this.collection('gallery-albums'),
      this.collection('welfare-campaigns'),
      this.collection('members'),
      this.collection('active-designations'),
      this.collection('settings'),
    ]);

    const publishedCms = cmsPages.filter((page) => page.status === 'published');
    const publishedGallery = galleryAlbums.filter(
      (album) => album.status === 'published',
    );
    const publishedWelfare = welfareCampaigns.filter(
      (campaign) => campaign.status === 'published',
    );
    const activeMembers = members.filter(
      (member) => member.status === 'active',
    );
    const activeLeaders = activeDesignations.filter(
      (designation) => designation.status === 'active',
    );

    return {
      cms: publishedCms,
      settings: settings
        .filter((setting) => setting.status === 'active')
        .filter((setting) =>
          ['organization', 'branding', 'membership', 'fees'].includes(
            this.toText(setting.group),
          ),
        ),
      gallery: publishedGallery,
      welfare: publishedWelfare,
      leadership: activeLeaders.map((leader) => this.publicLeader(leader)),
      news: this.publicNewsFromCms(publishedCms),
      stats: {
        activeMembers: activeMembers.length,
        projectsCompleted: publishedWelfare.filter(
          (campaign) =>
            this.toText(campaign.status) === 'published' &&
            campaign.endDate &&
            new Date(this.toText(campaign.endDate)).getTime() < Date.now(),
        ).length,
        volunteers: activeMembers.filter((member) =>
          this.toText(member.membershipType)
            .toLowerCase()
            .includes('volunteer'),
        ).length,
        regions: new Set(
          activeMembers
            .map((member) => this.toText(member.district || member.country))
            .filter(Boolean),
        ).size,
      },
    };
  }

  async getPublicLeadership() {
    return (await this.collection('active-designations'))
      .filter((leader) => leader.status === 'active')
      .map((leader) => this.publicLeader(leader));
  }

  async getPublicLeadershipProfile(id: string) {
    const leader = (await this.collection('active-designations')).find(
      (item) => item.id === id && item.status === 'active',
    );
    if (!leader) {
      throw new NotFoundException('Leadership profile not found');
    }
    return this.publicLeader(leader);
  }

  async getPublicNews() {
    return this.publicNewsFromCms(await this.getPublicCms());
  }

  async getPublicLegalPage(slug: string) {
    const page = (await this.collection('cms-pages')).find(
      (item) =>
        item.status === 'published' &&
        this.toText(item.slug).toLowerCase() === slug.toLowerCase() &&
        ['privacy-policy', 'terms-and-conditions', 'refund-policy'].includes(
          this.toText(item.slug),
        ),
    );
    if (!page) {
      throw new NotFoundException('Legal page not found');
    }
    return page;
  }

  async submitMembershipApplication(payload: Record<string, unknown>) {
    const name = this.toText(payload.name).trim();
    const phone = this.toText(payload.phone).trim();
    const membershipType = this.toText(payload.membershipType).trim();
    if (!name || !phone || !membershipType) {
      throw new BadRequestException(
        'Name, phone and membership type are required',
      );
    }

    return this.create('membership-applications', {
      applicationNumber: `APP-${new Date().getFullYear()}-${Date.now()}`,
      name,
      cnicMasked: this.maskCnic(payload.cnic ?? payload.cnicMasked),
      phone,
      email: this.toText(payload.email).trim() || null,
      country: this.toText(payload.country).trim() || 'Pakistan',
      province: this.toText(payload.province).trim() || null,
      district: this.toText(payload.district).trim() || null,
      address: this.toText(payload.address).trim() || null,
      membershipType,
      paymentStatus: 'pending',
      documents: Array.isArray(payload.documents) ? payload.documents : [],
      status: 'pending',
      termsAccepted: Boolean(payload.termsAccepted),
    });
  }

  async lookupMembershipRenewal(identifier: string) {
    const member = await this.findMember(identifier);
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    const fee = await this.settingValue('membership_fee_pk');
    return {
      member: this.publicMember(member),
      currentExpiry: member.expiryDate ?? null,
      eligible: ['active', 'expired'].includes(this.toText(member.status)),
      fee: fee ?? null,
    };
  }

  async submitMembershipRenewal(payload: Record<string, unknown>) {
    const member = await this.findMember(
      this.toText(payload.membershipNumber || payload.identifier),
    );
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    return this.create('membership-renewals', {
      renewalNumber: `REN-${new Date().getFullYear()}-${Date.now()}`,
      membershipNumber: member.membershipNumber,
      name: member.name,
      district: member.district,
      paymentStatus: 'pending',
      status: 'pending',
      requestedExpiryDate: payload.requestedExpiryDate ?? null,
      documents: Array.isArray(payload.documents) ? payload.documents : [],
    });
  }

  async submitCardRegeneration(payload: Record<string, unknown>) {
    const member = await this.findMember(
      this.toText(payload.membershipNumber || payload.identifier),
    );
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    return this.create('membership-renewals', {
      renewalNumber: `CARD-REG-${new Date().getFullYear()}-${Date.now()}`,
      membershipNumber: member.membershipNumber,
      name: member.name,
      district: member.district,
      requestType: 'card_regeneration',
      reason: payload.reason ?? null,
      paymentStatus: 'pending',
      status: 'pending',
      documents: Array.isArray(payload.documents) ? payload.documents : [],
    });
  }

  async submitContact(payload: Record<string, unknown>) {
    const subject = this.toText(payload.subject).trim();
    const name = this.toText(payload.name).trim();
    if (!subject || !name) {
      throw new BadRequestException('Name and subject are required');
    }
    return this.create('complaints', {
      complaintNumber: `CNT-${Date.now()}`,
      name,
      email: this.toText(payload.email).trim() || null,
      phone: this.toText(payload.phone).trim() || null,
      category: 'Contact',
      priority: 'medium',
      subject,
      description: this.toText(payload.message || payload.description).trim(),
      status: 'pending',
      submittedDate: new Date().toISOString().slice(0, 10),
      publicResponse: null,
    });
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

  private async findMember(identifier: string) {
    const value = this.toText(identifier).trim().toLowerCase();
    return (await this.collection('members')).find(
      (member) =>
        this.toText(member.membershipNumber).toLowerCase() === value ||
        this.toText(member.cnicMasked).toLowerCase() === value,
    );
  }

  private publicMember(member: DpoRecord) {
    return {
      membershipNumber: member.membershipNumber,
      name: member.name,
      photo: member.photo ?? member.profilePhoto ?? null,
      membershipType: member.membershipType,
      district: member.district,
      country: member.country,
      issueDate: member.issueDate,
      expiryDate: member.expiryDate,
      status: member.status,
    };
  }

  private publicLeader(leader: DpoRecord) {
    return {
      id: leader.id,
      name: leader.holder ?? leader.name,
      photo: leader.photo ?? leader.profilePhoto ?? null,
      designation: leader.designation,
      region: leader.area ?? leader.district ?? leader.province,
      district: leader.district,
      province: leader.province,
      wing: leader.wing,
      biography: leader.biography ?? null,
      responsibilities: leader.responsibilities ?? null,
      issueDate: leader.issueDate,
      expiryDate: leader.expiryDate,
      status: leader.status,
    };
  }

  private publicNewsFromCms(pages: DpoRecord[]) {
    return pages
      .filter((page) =>
        ['news', 'article', 'notice'].includes(this.toText(page.type)),
      )
      .map((page) => ({
        id: page.id,
        slug: page.slug,
        titleEnglish: page.titleEnglish,
        titleUrdu: page.titleUrdu,
        category: page.category ?? page.type,
        image: page.image ?? null,
        excerpt: page.excerpt ?? null,
        content: page.content ?? null,
        publishedAt: page.publishedAt ?? page.createdAt,
        createdAt: page.createdAt,
      }));
  }

  private async settingValue(key: string) {
    const setting = (await this.collection('settings')).find(
      (item) => item.status === 'active' && item.key === key,
    );
    return setting?.value;
  }

  private maskCnic(value: unknown) {
    const text = this.toText(value).replace(/\D/g, '');
    if (text.length < 6) {
      return '';
    }
    return `${text.slice(0, 5)}-*****-${text.slice(-1)}`;
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

  private async notifyAdmin(
    action: string,
    resource: ResourceName,
    record: DpoRecord,
  ): Promise<void> {
    if (['notification-logs', 'audit-logs'].includes(resource)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const title =
      this.toText(record.name) ||
      this.toText(record.applicant) ||
      this.toText(record.holder) ||
      this.toText(record.titleEnglish) ||
      this.toText(record.subject) ||
      this.toText(record.id);

    await this.database.insert('notification-logs', {
      id: this.nextId('notification-logs'),
      createdAt: timestamp,
      updatedAt: timestamp,
      recipient: 'admin',
      channel: 'system',
      event: `${resource}.${action}`,
      subject: `${this.titleText(resource)} ${action}`,
      message: `${this.titleText(resource)} ${title} was ${action}.`,
      resource,
      resourceId: record.id,
      status: 'active',
      sentAt: timestamp,
    });
  }

  private titleText(value: string): string {
    return value
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
