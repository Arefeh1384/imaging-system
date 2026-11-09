import type { ApiClient, MockTools } from './types';
import { getStaffSession } from '../lib/session';
import { httpApi } from './http';
import { mockApi, mockToolsImpl } from './mock';

/**
 * mock: everything runs on sample data in this browser.
 * http: everything goes to the backend at VITE_API_BASE_URL.
 * hybrid: the patient, insurance and PACS admin panels go to the backend; the main admin panel stays on sample data,
 * because the backend doesn't have the admin side yet.
 */
export const apiMode: 'mock' | 'http' | 'hybrid' =
  import.meta.env.VITE_API_MODE === 'http' ? 'http' : import.meta.env.VITE_API_MODE === 'hybrid' ? 'hybrid' : 'mock';

/** True where sample data is shown: everywhere in mock mode, and the main admin panel in hybrid mode. */
export const isMockMode = apiMode !== 'http';

/** Shows the test accounts on the sign-in pages: always on sample data, and on a test server built with VITE_DEMO_ACCOUNTS=true. */
export const showDemoAccounts = isMockMode || import.meta.env.VITE_DEMO_ACCOUNTS === 'true';

/** True only when the patient panel itself runs on sample data. */
export const isPatientMock = apiMode === 'mock';

/** True only when the PACS admin panel runs on sample data. */
export const isPacsAdminMock = apiMode === 'mock';

/** True only when the insurance panel runs on sample data. */
export const isInsuranceMock = apiMode === 'mock';

/** Whether the insurance panel is showing sample data right now: in mock mode, or in hybrid mode when the
 * sample main admin opened it with "view as". With the real backend, "view as" shows real data. */
export const insuranceShowsSample = () => isInsuranceMock || (apiMode === 'hybrid' && !!getStaffSession()?.viewAs);

const PATIENT_METHODS = [
  'getInvite',
  'patientRequestCode',
  'patientVerifyCode',
  'getMyProfile',
  'saveFirstInfo',
  'listMyCases',
  'getMyCase',
  'uploadDocument',
  'confirmItem',
  'submitERx',
  'submitCase',
] as const satisfies ReadonlyArray<keyof ApiClient>;

const PACS_ADMIN_METHODS = ['pacsAdminLogin', 'getSendVolume'] as const satisfies ReadonlyArray<keyof ApiClient>;

const INSURANCE_METHODS = ['insuranceLogin', 'getInsuranceDashboard', 'listInsuranceCases', 'getInsuranceCase'] as const satisfies ReadonlyArray<keyof ApiClient>;

/** The main admin's "view as" opens the insurance panel with a sample session, so it stays on sample data. */
const insuranceIsLive = () => !getStaffSession()?.viewAs;

function hybrid(): ApiClient {
  const out = { ...mockApi } as Record<keyof ApiClient, unknown>;
  for (const key of PATIENT_METHODS) out[key] = httpApi[key];
  for (const key of PACS_ADMIN_METHODS) out[key] = httpApi[key];
  for (const key of INSURANCE_METHODS) {
    out[key] = (...args: unknown[]) => ((insuranceIsLive() || key === 'insuranceLogin' ? httpApi[key] : mockApi[key]) as (...a: unknown[]) => unknown)(...args);
  }
  // Pictures: from the backend in the insurance panel, from the sample data in the main admin's ZIP pages.
  out.getStudyImages = (caseId: string) =>
    location.pathname.startsWith('/insurance') && insuranceIsLive() ? httpApi.getStudyImages(caseId) : mockApi.getStudyImages(caseId);
  return out as ApiClient;
}

/** The only place that decides which backend the screens talk to. */
export const api: ApiClient = apiMode === 'http' ? httpApi : apiMode === 'hybrid' ? hybrid() : mockApi;

/** Null when connected to a real backend, which hides every sample-only control. */
export const mockTools: MockTools | null = isMockMode ? mockToolsImpl : null;
