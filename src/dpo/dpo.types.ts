export type ResourceName =
  | 'members'
  | 'membership-applications'
  | 'membership-renewals'
  | 'membership-cards'
  | 'designation-applications'
  | 'active-designations'
  | 'designation-renewals'
  | 'designation-master-list'
  | 'geographic-areas'
  | 'wireless-devices'
  | 'complaints'
  | 'payments'
  | 'welfare-campaigns'
  | 'donations'
  | 'gallery-albums'
  | 'cms-pages'
  | 'card-templates'
  | 'notification-templates'
  | 'notification-logs'
  | 'admin-users'
  | 'roles'
  | 'reports'
  | 'settings'
  | 'audit-logs';

export type DpoStatus =
  | 'draft'
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'active'
  | 'inactive'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'suspended'
  | 'rejected'
  | 'resolved'
  | 'closed'
  | 'published'
  | 'archived';

export type DpoRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status?: DpoStatus;
  [key: string]: unknown;
};

export type ResourceSchema = {
  resource: ResourceName;
  title: string;
  description: string;
  searchableFields: string[];
  filterFields: string[];
  defaultSort: string;
};

export type ListQuery = {
  q?: string;
  status?: string;
  paymentStatus?: string;
  country?: string;
  province?: string;
  district?: string;
  priority?: string;
  category?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
};

export type ListResponse = {
  data: DpoRecord[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

export type DashboardSummary = {
  kpis: Record<string, number | string>;
  charts: Record<string, unknown>;
  recent: Record<string, DpoRecord[]>;
};
