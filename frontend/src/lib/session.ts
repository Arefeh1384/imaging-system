import type { AdminSession, PatientSession, StaffSession } from '../api/types';
import { readTabJson, removeKey, removeTabKey, writeTabJson } from './storage';

const PATIENT_KEY = 'imaging.session.patient';
const STAFF_KEY = 'imaging.session.staff';
const ADMIN_KEY = 'imaging.session.admin';

// Sign-ins last until the tab is closed, so a shared computer doesn't stay signed in.
// Earlier versions kept them permanently, so clear those.
removeKey(PATIENT_KEY);
removeKey(ADMIN_KEY);

export const getPatientSession = () => readTabJson<PatientSession>(PATIENT_KEY);
export const setPatientSession = (s: PatientSession) => writeTabJson(PATIENT_KEY, s);
export const clearPatientSession = () => removeTabKey(PATIENT_KEY);

export const getStaffSession = () => readTabJson<StaffSession>(STAFF_KEY);
export const setStaffSession = (s: StaffSession) => writeTabJson(STAFF_KEY, s);
export const clearStaffSession = () => removeTabKey(STAFF_KEY);

export const getAdminSession = () => readTabJson<AdminSession>(ADMIN_KEY);
export const setAdminSession = (s: AdminSession) => writeTabJson(ADMIN_KEY, s);
export const clearAdminSession = () => removeTabKey(ADMIN_KEY);

export function getSessionToken(): string | null {
  const path = typeof location !== 'undefined' ? location.pathname : '';
  if (path.startsWith('/admin')) return getAdminSession()?.token ?? null;
  if (path.startsWith('/insurance')) return getStaffSession()?.token ?? null;
  return getPatientSession()?.token ?? null;
}
