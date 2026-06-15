
export type UserRole = 'admin' | 'operator' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'retry' | 'paused';
export type JobType = 'single' | 'bulk' | 'discovery';

export interface ExtractionJob {
  _id: string;
  sourceUrl: string;
  jobType: JobType;
  status: JobStatus;
  totalProducts: number;
  processedCount: number;
  failedCount: number;
  attempts: number;
  errorMessage: string | null;
  productIds: string[];
  parentJobId?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  submittedBy: string;
  createdAt: string;
  updatedAt: string;
  bullState?: string;
}

export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface SpecItem {
  name: string;
  value: string;
  rawName: string;
  section: 'basic' | 'extended';
  confidence: number;
}

export interface ProductImage {
  originalUrl: string;
  storageUrl: string;
  s3Key: string;
  thumbnailUrl: string;
  isFeatured: boolean;
  width: number;
  height: number;
  sizeBytes: number;
  pHash: string;
  format: string;
}

export interface SellerInfo {
  sellerName: string;
  sellerLogoUrl: string;
  gstNumber: string;
  address: string;
  state: string;
  country: string;
  businessType: string;
  yearsEstablished: number | null;
  numberOfEmployees: string;
  turnover: string;
  legalStatus: string;
  contactDetails: string;
  aajjoProfileUrl: string;
}

export interface Product {
  _id: string;
  productName: string;
  category: string;
  subCategory: string;
  price: number | null;
  currency: string;
  moq: number | null;
  description: string;
  deliveryInformation: string;
  warrantyInformation: string;
  specifications: SpecItem[];
  images: ProductImage[];
  seller: SellerInfo;
  extractionStatus: ExtractionStatus;
  confidenceScore: number;
  isFlagged: boolean;
  sourceUrl: string;
  sourcePlatform: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryInfo {
  name: string;
  productCount: number;
}

export interface SubcategoryInfo {
  name: string;
  productCount: number;
}

export interface Seller {
  sellerName: string;
  sellerLogoUrl: string;
  state: string;
  country: string;
  businessType: string;
  productCount: number;
  gstNumber?: string;
  address?: string;
  yearsEstablished?: number | null;
  numberOfEmployees?: string;
  turnover?: string;
  legalStatus?: string;
  contactDetails?: string;
  aajjoProfileUrl?: string;
}

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'shopify_csv' | 'woocommerce_xml';
export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ExportJob {
  _id: string;
  format: ExportFormat;
  status: ExportStatus;
  filters: Record<string, unknown>;
  rowCount: number;
  fileUrl: string | null;
  expiresAt: string | null;
  generatedBy: string;
  createdAt: string;
}

export interface DashboardStats {
  products: {
    total: number;
    completed: number;
    failed: number;
    flagged: number;
    avgConfidenceScore: number;
  };
  jobs: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    successRate: string;
  };
  categoryBreakdown: { category: string; count: number }[];
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface AdminUser {
  _id: string;
  email: string;
  role: UserRole;
  lastLoginAt: string | null;
  createdAt: string;
  jobCount: number;
  _r?: boolean;
}

export interface AdminOverviewRow {
  userId: string;
  email: string;
  role: UserRole;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  queue: {
    waiting: number;
    active: number;
    delayed: number;
  };
}
