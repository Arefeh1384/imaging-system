// The real backend client. Paths are proposals for the backend team, except the
// ingestion flow, which is owned by the PACS connector and not called from here.
import { ApiError, type ApiClient } from './types';
import { getSessionToken } from '../lib/session';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('NETWORK', 'اتصال به سامانه برقرار نشد. اینترنت خود را بررسی و دوباره تلاش کنید.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(body?.code ?? `HTTP_${res.status}`, body?.message ?? 'درخواست انجام نشد. دوباره تلاش کنید.');
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('BAD_RESPONSE', 'پاسخ سرور قابل خواندن نیست. کمی بعد دوباره تلاش کنید.');
  }
}

/** A file instead of JSON: DICOM images. */
async function download(path: string): Promise<Blob> {
  const headers = new Headers({ Accept: 'application/zip' });
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { headers });
  } catch {
    throw new ApiError('NETWORK', 'اتصال به سامانه برقرار نشد. اینترنت خود را بررسی کنید.');
  }
  if (!res.ok) throw new ApiError(`HTTP_${res.status}`, 'فایل از سرور دریافت نشد. دوباره تلاش کنید.');
  return res.blob();
}

/** Builds ?page=2&pageSize=10&... and leaves out anything empty. */
function query(params: object): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') q.set(key, String(value));
  });
  const text = q.toString();
  return text ? `?${text}` : '';
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const httpApi: ApiClient = {
  getInvite: (token) => request(`/portal/invites/${encodeURIComponent(token)}`),
  patientRequestCode: (input) => post('/portal/login/code', input),
  patientVerifyCode: (input) => post('/portal/login/verify', input),
  getMyProfile: () => request('/portal/me'),
  saveFirstInfo: (input) => put('/portal/me/insurance', input),
  listMyCases: () => request('/portal/cases'),
  getMyCase: (id) => request(`/portal/cases/${id}`),
  uploadDocument: (id, key, file) => {
    const form = new FormData();
    form.set('file', file);
    return request(`/portal/cases/${id}/documents/${key}`, { method: 'PUT', body: form });
  },
  confirmItem: (id, key, yes) => post(`/portal/cases/${id}/confirm/${key}`, { yes }),
  submitERx: (id, eRxId) => post(`/portal/cases/${id}/e-prescription`, { eRxId }),
  submitCase: (id) => post(`/portal/cases/${id}/submit`),

  insuranceLogin: (input) => post('/insurance/login', input),
  getInsuranceDashboard: () => request('/insurance/dashboard'),
  listInsuranceCases: (filter) => request(`/insurance/cases${query(filter)}`),
  getInsuranceCase: (id) => request(`/insurance/cases/${id}`),

  getStudyImages: (id) => request(`/imaging/cases/${id}/images`),
  pacsAdminLogin: (input) => post('/pacs-admin/login', input),
  getSendVolume: (period) => request(`/pacs-admin/volume${query({ period })}`),

  adminLogin: (input) => post('/admin/login', input),
  getOverview: () => request('/admin/overview'),
  getCompany: (id) => request(`/admin/companies/${id}`),
  getHospital: (id) => request(`/admin/hospitals/${id}`),
  listZips: (filter) => request(`/admin/zips${query(filter)}`),
  getZip: (id) => request(`/admin/zips/${id}`),
  downloadZip: (id) => download(`/admin/zips/${id}/file`),
  updateZipSplit: (id, split) => put(`/admin/zips/${id}/split`, split),
  settleZip: (id) => post(`/admin/zips/${id}/settle`),
  updateHospitalFeeRule: (id, rule) => put(`/admin/hospitals/${id}/fee-rule`, rule),
  resendInvite: (caseId) => post(`/admin/cases/${caseId}/resend-invite`),
  listAllStaff: (filter) => request(`/admin/accounts/staff${query(filter)}`),
  listPatients: (filter) => request(`/admin/accounts/patients${query(filter)}`),
  listAccessLog: (req) => request(`/admin/accounts/access-log${query(req)}`),
  viewAsPatient: (id) => post(`/admin/accounts/patients/${id}/view-as`),
  viewAsStaff: (id) => post(`/admin/accounts/staff/${id}/view-as`),
};
