import axios from 'axios';
import { getSession, signOut } from 'next-auth/react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

export const api = axios.create({ baseURL: API_BASE });

// Attach JWT from NextAuth session on every request
api.interceptors.request.use(async (config) => {
  const session = await getSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

// On 401, force a session re-check; if the session error flag is set redirect to login
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      const session = await getSession();
      if (!session || (session as any).error === 'RefreshAccessTokenError') {
        await signOut({ redirect: true, callbackUrl: '/login' });
      }
    }
    return Promise.reject(error);
  },
);

// ── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (email: string, password: string, role = 'operator') =>
    api.post('/auth/register', { email, password, role }),
  me: () => api.get('/auth/me'),
};

// ── Jobs ──────────────────────────────────────────────────────────────────
export const jobsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
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
};

// ── Products ──────────────────────────────────────────────────────────────
export const productsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    category?: string;
    subCategory?: string;
    seller?: string;
    flagged?: boolean;
    minConfidence?: number;
    sortBy?: string;
    sortOrder?: string;
  }) => api.get('/products', { params }),
  get: (id: string) => api.get(`/products/${id}`),
  images: (id: string) => api.get(`/products/${id}/images`),
  delete: (id: string) => api.delete(`/products/${id}`),
  categories: () => api.get('/products/categories'),
  subcategories: (category: string) =>
    api.get('/products/subcategories', { params: { category } }),
};

// ── Export ────────────────────────────────────────────────────────────────

interface ExportPayload {
  format: string;
  category?: string;
  subCategory?: string;
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
  // Async queue-based export (returns job ID, poll for completion)
  trigger: (payload: ExportPayload) => api.post('/export', payload),
  list: () => api.get('/export'),
  status: (id: string) => api.get(`/export/${id}/status`),
  // Download a previously completed async export
  download: async (id: string) => {
    const res = await api.get(`/export/${id}/download`, { responseType: 'blob' });
    await triggerBlobDownload(res as any);
  },
  // Direct streaming download — no DB record, no polling needed
  directDownload: async (payload: ExportPayload) => {
    const res = await api.post('/export/direct', payload, { responseType: 'blob' });
    await triggerBlobDownload(res as any);
  },
};

// ── Dashboard ─────────────────────────────────────────────────────────────
export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  jobs: () => api.get('/dashboard/jobs'),
  failedJobs: () => api.get('/dashboard/jobs/failed'),
  exports: () => api.get('/dashboard/exports'),
};

// ── Health ────────────────────────────────────────────────────────────────
export const healthApi = {
  check: () => api.get('/health'),
};
