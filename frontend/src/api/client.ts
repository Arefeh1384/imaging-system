import type { ApiClient, MockTools } from './types';
import { httpApi } from './http';
import { mockApi, mockToolsImpl } from './mock';

/**
 * mock: everything runs on sample data in this browser.
 * http: everything goes to the backend at VITE_API_BASE_URL.
 * hybrid: the patient panel goes to the backend; the main admin and insurance panels stay on sample data,
 * because the backend only has the patient side so far.
 */
export const apiMode: 'mock' | 'http' | 'hybrid' =
  import.meta.env.VITE_API_MODE === 'http' ? 'http' : import.meta.env.VITE_API_MODE === 'hybrid' ? 'hybrid' : 'mock';

/** True where sample data is shown: everywhere in mock mode, and the admin and insurance panels in hybrid mode. */
export const isMockMode = apiMode !== 'http';

/** True only when the patient panel itself runs on sample data. */
export const isPatientMock = apiMode === 'mock';

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

function hybrid(): ApiClient {
  const out = { ...mockApi } as Record<keyof ApiClient, unknown>;
  for (const key of PATIENT_METHODS) out[key] = httpApi[key];
  return out as ApiClient;
}

/** The only place that decides which backend the screens talk to. */
export const api: ApiClient = apiMode === 'http' ? httpApi : apiMode === 'hybrid' ? hybrid() : mockApi;

/** Null when connected to a real backend, which hides every sample-only control. */
export const mockTools: MockTools | null = isMockMode ? mockToolsImpl : null;
