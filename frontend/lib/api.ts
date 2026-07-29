import axios from 'axios';
import { getSession, signOut } from 'next-auth/react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

export const api = axios.create({ baseURL: API_BASE });

// Shared promise so concurrent requests on the same page all reuse one getSession() call
// instead of each awaiting it independently. Cleared on 401 so an expired token forces a fresh fetch.
let sessionPromise: Promise<string | null> | null = null;

function getCachedToken(): Promise<string | null> {
  if (!sessionPromise) {
    sessionPromise = getSession().then((s) => s?.accessToken ?? null);
  }
  return sessionPromise;
}

function clearTokenCache() {
  sessionPromise = null;
}

api.interceptors.request.use(async (config) => {
  const token = await getCachedToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      clearTokenCache();
      const session = await getSession();
      if (!session || (session as any).error === 'RefreshAccessTokenError') {
        await signOut({ redirect: true, callbackUrl: '/login' });
      }
    }
    
    if (error.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        error.response.data = JSON.parse(text);
      } catch {
        
      }
    }
    return Promise.reject(error);
  },
);

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (email: string, password: string, role = 'operator') =>
    api.post('/auth/register', { email, password, role }),
  forgotPassword: (email: string, newPassword: string) =>
    api.post('/auth/forgot-password', { email, newPassword }),
  me: () => api.get('/auth/me'),
};

export const jobsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    flagged?: boolean;
  }) => api.get('/jobs', { params }),
  get: (id: string) => api.get(`/jobs/${id}`),
  submitUrl: (url: string, label?: string) =>
    api.post('/jobs', { url, label }),
  submitBulk: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/jobs/bulk', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  cancel: (id: string) => api.delete(`/jobs/${id}`),
  retry: (id: string) => api.post(`/jobs/${id}/retry`),
  pause: (id: string) => api.post(`/jobs/${id}/pause`),
  resume: (id: string) => api.post(`/jobs/${id}/resume`),
  bulkRetry: (payload: { jobIds?: string[]; all?: boolean; onlyFlagged?: boolean }) =>
    api.post('/jobs/bulk-retry', payload),
  bulkDelete: (payload: {
    jobIds?: string[];
    status?: 'completed' | 'failed' | 'flagged';
    all?: boolean;
    confirm: boolean;
  }) => api.post('/jobs/bulk-delete', payload),
  exportFlagged: async (format: 'csv' | 'xlsx' = 'csv') => {
    const res = await api.get('/jobs/flagged/export', {
      params: { format },
      responseType: 'blob',
    });
    await triggerBlobDownload(res as any);
  },
};

export const productsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    category?: string;
    subCategory?: string;
    seller?: string;
    search?: string;
    flagged?: boolean;
    minConfidence?: number;
    maxConfidence?: number;
    sortBy?: string;
    sortOrder?: string;
  }) => api.get('/products', { params }),
  get: (id: string) => api.get(`/products/${id}`),
  images: (id: string) => api.get(`/products/${id}/images`),
  delete: (id: string) => api.delete(`/products/${id}`),
  categories: () => api.get('/products/categories'),
  subcategories: (category?: string) =>
    api.get('/products/subcategories', { params: category ? { category } : undefined }),
  bulkDelete: (payload: {
    productIds?: string[];
    filter?: {
      flagged?: boolean;
      minConfidence?: number;
      maxConfidence?: number;
      category?: string;
      subCategory?: string;
      status?: string;
    };
    confirm: boolean;
  }) => api.post('/products/bulk-delete', payload),
  exportSelected: async (productIds: string[]) => {
    const res = await api.post(
      '/products/export-selected',
      { productIds },
      { responseType: 'blob' },
    );
    await triggerBlobDownload(res as any);
  },
};

interface ExportPayload {
  format: string;
  category?: string;
  subCategory?: string;
  seller?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  productIds?: string[];
}

async function triggerBlobDownload(res: { data: Blob; headers: Record<string, string> }) {
  const disposition = res.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const fileName = match?.[1] ?? `export_${Date.now()}`;
  const blobUrl = window.URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export const exportApi = {
  trigger: (payload: ExportPayload) => api.post('/export', payload),
  list: () => api.get('/export'),
  status: (id: string) => api.get(`/export/${id}/status`),
  download: async (id: string) => {
    const res = await api.get(`/export/${id}/download`, { responseType: 'blob' });
    await triggerBlobDownload(res as any);
  },
  directDownload: async (payload: ExportPayload) => {
    const res = await api.post('/export/direct', payload, { responseType: 'blob' });
    await triggerBlobDownload(res as any);
  },
};

export const sellersApi = {
  list: (params?: { page?: number; limit?: number; search?: string; letter?: string }) =>
    api.get('/sellers', { params }),
  get: (sellerName: string) =>
    api.get(`/sellers/${encodeURIComponent(sellerName)}`),
  categories: (sellerName: string) =>
    api.get(`/sellers/${encodeURIComponent(sellerName)}/categories`),
  subcategories: (sellerName: string, category: string) =>
    api.get(`/sellers/${encodeURIComponent(sellerName)}/subcategories`, {
      params: { category },
    }),
  products: (
    sellerName: string,
    params?: {
      page?: number;
      limit?: number;
      category?: string;
      subCategory?: string;
      sortBy?: string;
      sortOrder?: string;
    },
  ) => api.get(`/sellers/${encodeURIComponent(sellerName)}/products`, { params }),
};

export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  jobs: () => api.get('/dashboard/jobs'),
  failedJobs: () => api.get('/dashboard/jobs/failed'),
  exports: () => api.get('/dashboard/exports'),
};

export const healthApi = {
  check: () => api.get('/health'),
};

export const adminApi = {
  listUsers: () => api.get('/admin/users'),
  createUser: (email: string, password: string, role: string) =>
    api.post('/admin/users', { email, password, role }),
  updateUser: (id: string, updates: { role?: string; active?: boolean }) =>
    api.patch(`/admin/users/${id}`, updates),
  getOverview: () => api.get('/admin/overview'),
  getUserJobCounts: (id: string) => api.get(`/admin/users/${id}/jobs`),
};
