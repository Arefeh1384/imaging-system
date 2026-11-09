// Local stand-in for the backend. It keeps its data in the browser.
import {
  ApiError,
  type ActivityItem,
  type AdminSession,
  type ApiClient,
  type CaseCounts,
  type CaseEvent,
  type CaseGroup,
  type CaseRecord,
  type CaseRow,
  type CaseSummary,
  type Company,
  type ConflictCounts,
  type FeeSplit,
  type Hospital,
  type HospitalDetail,
  type IngestInput,
  type MockTools,
  type Overview,
  type OverviewCompany,
  type PatientCase,
  type Page,
  type PageRequest,
  type PatientProfile,
  type Pipeline,
  type StaffAccount,
  type StaffRole,
  type StaffSession,
  type StudyImage,
  type Totals,
  type UploadDocKey,
  type ZipDetail,
  type ZipPackage,
  type ZipRow,
} from '../types';
import { normalizeDigits, toFaDigits } from '../../lib/format';
import { DOC_LABELS } from '../../lib/labels';
import { INSURERS } from '../../lib/options';
import { DEFAULT_PAGE_SIZE } from '../../lib/usePageParams';
import { getAdminSession, getPatientSession, getStaffSession } from '../../lib/session';
import { sampleInstance, samplePreviews, sampleSeries } from './dicomSample';
import { makeZip } from '../../lib/zip';
import { readJson, removeKey, writeJson } from '../../lib/storage';
import { documentFileError, isValidMobile, ZIP_MAX_BYTES } from '../../lib/validate';
import { buildOpinion, CONFLICT_REASONS, conflictSms, createSeed, deniedReason, eRxDocument, identityFor, insuranceShareFor, inviteSms, itemsToConfirm, pacsDocument, sentSms, type MockCase, type MockDb, type MockPatient } from './seed';

const DB_KEY = 'imaging.mock.db.v10';
/** How long sample mode waits before the check runs on its own. The real fetch and comparison take half an hour to an hour. */
/** How long the sample waits before checking a confirmed case. The real check runs 30 to 60 minutes later. */
const REVIEW_DELAY_MS = 20_000;
function reviewDelay(): number {
  try {
    const set = Number(localStorage.getItem('imaging.mock.reviewDelayMs'));
    return set > 0 ? set : REVIEW_DELAY_MS;
  } catch {
    return REVIEW_DELAY_MS;
  }
}

const OTP_KEY = 'imaging.mock.otp.v1';
const OTP_EXPIRES_SECONDS = 120;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

interface MockOtp {
  id: string;
  patientId: string;
  code: string;
  sentAt: number;
  expiresAt: number;
  attempts: number;
}

const loadOtps = (): Record<string, MockOtp> => readJson<Record<string, MockOtp>>(OTP_KEY) ?? {};
const saveOtps = (codes: Record<string, MockOtp>): void => writeJson(OTP_KEY, codes);

function load(): MockDb {
  const db = readJson<MockDb>(DB_KEY) ?? createSeed();
  const now = Date.now();
  const due = db.cases.filter((c) => c.stage === 'PROCESSING' && (c.mock.processAt ?? 0) <= now);
  if (due.length > 0) {
    due.forEach((c) => runCheck(db, c));
    save(db);
  }
  return db;
}

/**
 * Stands in for the backend's later work: fetch the e-prescription, compare everything with the images,
 * then send the case to the insurer or reject it, and tell the patient by SMS either way.
 */
function runCheck(db: MockDb, c: MockCase): void {
  const now = new Date().toISOString();
  if (c.documents.prescription?.eRxId) logEvent(db, c, 'SYSTEM', 'نسخه الکترونیک از سامانه نسخه دریافت شد');
  c.aiOpinion = buildOpinion(c.study.title, c.mock.aiResult, now);
  c.reviewedAt = now;
  delete c.mock.processAt;
  db.sequence += 1;
  if (c.mock.aiResult === 'OK') {
    c.insuranceShare = insuranceShareFor(c.study.modality, now);
    c.stage = 'AT_INSURER';
    logEvent(db, c, 'AI', 'هوش مصنوعی مغایرتی ندید و سهم بیمه را حساب کرد');
    c.sms.push(sentSms(c.trackingNumber ?? '', now, `sms-${db.sequence}`));
    logEvent(db, c, 'SYSTEM', 'پیامک ارسال به بیمه برای بیمار فرستاده شد');
  } else {
    c.conflict = { kind: c.mock.aiResult, reason: CONFLICT_REASONS[c.mock.aiResult], by: 'AI', at: now };
    logEvent(db, c, 'AI', `هوش مصنوعی مغایرت دید: ${CONFLICT_REASONS[c.mock.aiResult]}`);
    rejectForConflict(db, c);
  }
}

function save(db: MockDb): void {
  writeJson(DB_KEY, db);
}

const wait = (ms = 150) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function logEvent(db: MockDb, c: MockCase, actor: CaseEvent['actor'], title: string, viewAs?: boolean): void {
  db.sequence += 1;
  c.events.push({ id: `ev-${db.sequence}`, at: new Date().toISOString(), actor, title: viewAs ? `${title} (توسط مدیر کل)` : title });
}

function findCase(db: MockDb, id: string): MockCase {
  const c = db.cases.find((x) => x.id === id);
  if (!c) throw new ApiError('NOT_FOUND', 'این پرونده پیدا نشد.');
  return c;
}

function findZip(db: MockDb, id: string): ZipPackage {
  const z = db.zips.find((x) => x.id === id);
  if (!z) throw new ApiError('NOT_FOUND', 'این فایل ZIP پیدا نشد.');
  return z;
}

function findHospital(db: MockDb, id: string): { hospital: Hospital; company: Company } {
  for (const company of db.companies) {
    const hospital = company.hospitals.find((h) => h.id === id);
    if (hospital) return { hospital, company };
  }
  throw new ApiError('NOT_FOUND', 'این بیمارستان پیدا نشد.');
}

function allHospitals(db: MockDb): Hospital[] {
  return db.companies.flatMap((c) => c.hospitals);
}

function groupOf(c: CaseRecord): CaseGroup {
  switch (c.stage) {
    case 'AT_INSURER':
      return 'at-insurer';
    case 'PROCESSING':
      return 'processing';
    case 'REJECTED_CONFLICT':
      return 'conflict';
    default:
      return 'waiting-patient';
  }
}

function summaryOf(c: CaseRecord): CaseSummary {
  return { stage: c.stage, insurerShareRial: c.insuranceShare?.insurerShareRial, conflictReason: c.conflict?.reason };
}

function toCaseRow(c: MockCase): CaseRow {
  return {
    caseId: c.id,
    zipId: c.zipId,
    hospitalId: c.hospitalId,
    hospitalName: c.hospitalName,
    patientName: c.patient.name,
    studyTitle: c.study.title,
    receivedAt: c.receivedAt,
    submittedAt: c.submittedAt,
    stage: c.stage,
    insurerShareRial: c.insuranceShare?.insurerShareRial,
  };
}

/** Strips everything the patient must not receive: the AI's findings and the insurance share. */
function toPatientCase(c: MockCase): PatientCase {
  return {
    id: c.id,
    hospitalName: c.hospitalName,
    receivedAt: c.receivedAt,
    studyTitle: c.study.title,
    stage: c.stage,
    documents: Object.values(c.documents).map((d) => ({ key: d.key, source: d.source, fileName: d.fileName, previewDataUrl: d.previewDataUrl, eRxId: d.eRxId })),
    requestedItems: [...c.requestedItems],
    requiredItems: [...c.requiredItems],
    confirmItems: [...c.confirmItems],
    confirmedItems: [...c.confirmedItems],
    conflictReason: c.conflict?.reason,
    trackingNumber: c.trackingNumber,
    submittedAt: c.submittedAt,
  };
}

function toStaffCase(c: MockCase): CaseRecord {
  const { mock: _mock, ...rest } = clone(c);
  return rest;
}

function totalsOf(zips: ZipPackage[]): Totals {
  const t: Totals = { received: zips.length, accepted: 0, notBillable: 0, feeRial: 0, hospitalRial: 0, insuranceRial: 0, managementRial: 0, settledHospitalRial: 0 };
  zips.forEach((z) => {
    if (z.status === 'READY') t.accepted += 1;
    else t.notBillable += 1;
    t.feeRial += z.feeRial;
    t.hospitalRial += z.split.hospitalRial;
    t.insuranceRial += z.split.insuranceRial;
    t.managementRial += z.split.managementRial;
    if (z.settled) t.settledHospitalRial += z.split.hospitalRial;
  });
  return t;
}

function toRow(db: MockDb, z: ZipPackage): ZipRow {
  const { hospital, company } = findHospital(db, z.hospitalId);
  const c = z.caseId ? db.cases.find((x) => x.id === z.caseId) : undefined;
  return { ...clone(z), hospitalName: hospital.name, companyName: company.name, patientName: c?.patient.name, caseSummary: c ? summaryOf(c) : undefined };
}

function companyOverview(db: MockDb, company: Company): OverviewCompany {
  const ids = company.hospitals.map((h) => h.id);
  return {
    id: company.id,
    name: company.name,
    totals: totalsOf(db.zips.filter((z) => ids.includes(z.hospitalId))),
    hospitals: company.hospitals.map((h) => ({ ...h, totals: totalsOf(db.zips.filter((z) => z.hospitalId === h.id)) })),
  };
}

function activityOf(db: MockDb, hospitalId?: string, limit = 8): ActivityItem[] {
  const items: ActivityItem[] = [];
  db.zips
    .filter((z) => !hospitalId || z.hospitalId === hospitalId)
    .forEach((z) => {
      const hospitalName = findHospital(db, z.hospitalId).hospital.name;
      const c = z.caseId ? db.cases.find((x) => x.id === z.caseId) : undefined;
      if (c) {
        c.events.forEach((e) => items.push({ ...e, zipId: z.id, fileName: z.fileName, patientName: c.patient.name, hospitalName }));
      } else {
        items.push({ id: `zip-${z.id}`, at: z.receivedAt, actor: 'SYSTEM', title: z.status === 'DUPLICATE' ? 'بسته تکراری دریافت شد' : 'بسته ZIP رد شد', zipId: z.id, fileName: z.fileName, hospitalName });
      }
    });
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

function zipDetail(db: MockDb, zipId: string): ZipDetail {
  const zip = findZip(db, zipId);
  const { hospital, company } = findHospital(db, zip.hospitalId);
  const c = zip.caseId ? db.cases.find((x) => x.id === zip.caseId) : undefined;
  return { zip: toRow(db, zip), hospital: clone(hospital), company: { id: company.id, name: company.name }, caseRecord: c ? toStaffCase(c) : undefined };
}

function hospitalDetail(db: MockDb, id: string): HospitalDetail {
  const { hospital, company } = findHospital(db, id);
  const zips = db.zips.filter((z) => z.hospitalId === id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return { hospital: clone(hospital), company: { id: company.id, name: company.name }, totals: totalsOf(zips), recentActivity: activityOf(db, id, 6) };
}

function countCases(cases: MockCase[]): CaseCounts {
  const counts: CaseCounts = { atInsurer: 0, waitingPatient: 0, processing: 0, conflict: 0 };
  cases.forEach((c) => {
    const group = groupOf(c);
    if (group === 'at-insurer') counts.atInsurer += 1;
    else if (group === 'conflict') counts.conflict += 1;
    else if (group === 'processing') counts.processing += 1;
    else counts.waitingPatient += 1;
  });
  return counts;
}

function countConflicts(cases: MockCase[]): ConflictCounts {
  const counts: ConflictCounts = { PRESCRIPTION_STUDY: 0, PRESCRIPTION_NAME: 0, REPORT_IMAGES: 0, PATIENT_DENIED: 0 };
  cases.forEach((c) => {
    if (c.conflict) counts[c.conflict.kind] += 1;
  });
  return counts;
}

const shareOf = (cases: MockCase[]) => cases.reduce((sum, c) => sum + (c.stage === 'AT_INSURER' ? c.insuranceShare?.insurerShareRial ?? 0 : 0), 0);

function currentPatient(db: MockDb): MockPatient {
  const session = getPatientSession();
  const patient = session && db.patients.find((p) => p.id === session.patientId);
  if (!patient) throw new ApiError('UNAUTHORIZED', 'لطفاً دوباره وارد شوید.');
  return patient;
}

function myCase(db: MockDb, caseId: string): MockCase {
  const patient = currentPatient(db);
  const c = findCase(db, caseId);
  if (c.patient.id !== patient.id) throw new ApiError('NOT_FOUND', 'این پرونده پیدا نشد.');
  return c;
}

function requireStaff(role: StaffRole): StaffSession {
  const session = getStaffSession();
  if (!session || session.role !== role) throw new ApiError('UNAUTHORIZED', 'لطفاً دوباره وارد شوید.');
  return session;
}

const MAX_PAGE_SIZE = 100;

/** The same rule the real server must follow: never return more than one page. */
function paginate<T>(rows: T[], request: PageRequest): Page<T> {
  const pageSize = Math.min(Math.max(request.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const lastPage = Math.max(Math.ceil(rows.length / pageSize), 1);
  const page = Math.min(Math.max(request.page ?? 1, 1), lastPage);
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

/** Set VITE_MOCK_EXTRA_ROWS=10000 to see how the long lists behave with a lot of data. */
const EXTRA_ROWS = Number(import.meta.env.VITE_MOCK_EXTRA_ROWS) || 0;

function profileOf(p: MockPatient): PatientProfile {
  return { name: p.name, nationalId: p.nationalId, mobile: p.mobile, birthDate: p.birthDate, insurance: p.insurance, needsFirstInfo: !p.insurance };
}

function staffAccounts(db: MockDb): StaffAccount[] {
  return db.staff.map((s) => ({ id: s.id, role: s.role, name: s.name, username: s.username, active: s.active, createdAt: s.createdAt }));
}

/** Compresses an image for the sample store. The real upload sends the file itself. */
async function storedPreview(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 700 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return undefined;
  }
}

/** The backend makes these PNGs from the DICOM study once. Sample mode draws them in the browser and keeps them. */
const previewCache = new Map<string, StudyImage[]>();

function studyImages(c: MockCase): StudyImage[] {
  const key = `${c.id}:${c.study.modality}:${c.study.title}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  const images = samplePreviews(c).map((p, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = p.width;
    canvas.height = p.height;
    const ctx = canvas.getContext('2d');
    const pixels = new ImageData(p.width, p.height);
    for (let i = 0; i < p.gray.length; i += 1) {
      pixels.data[i * 4] = p.gray[i];
      pixels.data[i * 4 + 1] = p.gray[i];
      pixels.data[i * 4 + 2] = p.gray[i];
      pixels.data[i * 4 + 3] = 255;
    }
    ctx?.putImageData(pixels, 0, 0);
    return { id: `${c.id}-img-${index + 1}`, label: p.label, url: canvas.toDataURL('image/png'), width: p.width, height: p.height };
  });
  previewCache.set(key, images);
  return images;
}

function rejectForConflict(db: MockDb, c: MockCase) {
  db.sequence += 1;
  c.stage = 'REJECTED_CONFLICT';
  c.sms.push(conflictSms(c.hospitalName, new Date().toISOString(), `sms-${db.sequence}`));
  logEvent(db, c, 'SYSTEM', 'پیامک مغایرت برای بیمار ارسال شد');
}

export const mockApi: ApiClient = {
  async getInvite(token) {
    await wait();
    const db = load();
    const c = db.cases.find((x) => x.inviteToken === token);
    if (!c) throw new ApiError('INVITE_INVALID', 'این پیوند معتبر نیست.');
    return { caseId: c.id, hospitalName: c.hospitalName, devHint: { nationalId: c.patient.nationalId, mobile: c.patient.mobile } };
  },

  async patientRequestCode({ nationalId, mobile }) {
    await wait(250);
    const db = load();
    const id = normalizeDigits(nationalId).trim();
    const phone = normalizeDigits(mobile).trim();
    const patient = db.patients.find((p) => p.nationalId === id && p.mobile === phone);
    if (!patient) throw new ApiError('INVALID_LOGIN', 'کد ملی یا شماره موبایل درست نیست. دوباره بررسی کنید.');
    const now = Date.now();
    const codes = loadOtps();
    // Asking again too soon sends no second SMS: the code already on its way still works.
    let otp = Object.values(codes).find((o) => o.patientId === patient.id && o.expiresAt > now && o.attempts < OTP_MAX_ATTEMPTS && now - o.sentAt < OTP_RESEND_SECONDS * 1000);
    if (!otp) {
      for (const key of Object.keys(codes)) if (codes[key].patientId === patient.id) delete codes[key];
      db.sequence += 1;
      otp = { id: `otp-${db.sequence}-${now}`, patientId: patient.id, code: String(10_000 + Math.floor(Math.random() * 90_000)), sentAt: now, expiresAt: now + OTP_EXPIRES_SECONDS * 1000, attempts: 0 };
      codes[otp.id] = otp;
      saveOtps(codes);
      save(db);
    }
    return {
      challengeId: otp.id,
      maskedMobile: `${phone.slice(0, 4)}***${phone.slice(-4)}`,
      codeLength: otp.code.length,
      expiresInSeconds: Math.ceil((otp.expiresAt - now) / 1000),
      resendInSeconds: Math.max(0, Math.ceil((otp.sentAt + OTP_RESEND_SECONDS * 1000 - now) / 1000)),
      sampleCode: otp.code,
    };
  },

  async patientVerifyCode({ challengeId, code }) {
    await wait(250);
    const codes = loadOtps();
    const otp = codes[challengeId];
    if (!otp || otp.expiresAt <= Date.now()) {
      delete codes[challengeId];
      saveOtps(codes);
      throw new ApiError('CODE_EXPIRED', 'زمان این کد تمام شده است. کد تازه بگیرید.');
    }
    if (normalizeDigits(code).trim() !== otp.code) {
      otp.attempts += 1;
      const left = OTP_MAX_ATTEMPTS - otp.attempts;
      if (left <= 0) {
        delete codes[challengeId];
        saveOtps(codes);
        throw new ApiError('TOO_MANY_ATTEMPTS', 'کد چند بار اشتباه وارد شد. کد تازه بگیرید.');
      }
      saveOtps(codes);
      throw new ApiError('WRONG_CODE', `این کد درست نیست. ${toFaDigits(left)} بار دیگر می‌توانید امتحان کنید.`);
    }
    delete codes[challengeId];
    saveOtps(codes);
    const db = load();
    const patient = db.patients.find((p) => p.id === otp.patientId);
    if (!patient) throw new ApiError('INVALID_LOGIN', 'کد ملی یا شماره موبایل درست نیست. دوباره بررسی کنید.');
    db.cases
      .filter((c) => c.patient.id === patient.id && c.stage === 'WAITING_PATIENT' && !c.events.some((e) => e.title === 'بیمار وارد سامانه شد'))
      .forEach((c) => logEvent(db, c, 'PATIENT', 'بیمار وارد سامانه شد'));
    save(db);
    return { role: 'PATIENT', token: `patient-${patient.id}`, patientId: patient.id };
  },

  async getMyProfile() {
    await wait(60);
    return profileOf(currentPatient(load()));
  },

  async saveFirstInfo(input) {
    await wait(250);
    const db = load();
    const patient = currentPatient(db);
    if (!input.policyNumber.trim()) throw new ApiError('INVALID_POLICY', 'شماره بیمه‌نامه را بنویسید.');
    if (!INSURERS.includes(input.insurer)) throw new ApiError('INVALID_INSURER', 'شرکت بیمه را انتخاب کنید.');
    patient.insurance = { insurer: input.insurer, policyNumber: normalizeDigits(input.policyNumber).trim(), relation: input.relation };
    db.cases
      .filter((c) => c.patient.id === patient.id)
      .forEach((c) => {
        c.patient.insurance = patient.insurance;
        logEvent(db, c, 'PATIENT', 'بیمار اطلاعات بیمه را ثبت کرد', getPatientSession()?.viewAs);
      });
    save(db);
    return profileOf(patient);
  },

  async listMyCases() {
    await wait();
    const db = load();
    const patient = currentPatient(db);
    return db.cases
      .filter((c) => c.patient.id === patient.id)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .map(toPatientCase);
  },

  async getMyCase(id) {
    await wait(60);
    return toPatientCase(myCase(load(), id));
  },

  async uploadDocument(id, key, file, previewDataUrl) {
    await wait(350);
    const db = load();
    const c = myCase(db, id);
    const problem = documentFileError(file);
    if (problem) throw new ApiError('INVALID_FILE', problem);
    if (c.stage !== 'WAITING_PATIENT') throw new ApiError('NOT_OPEN', 'این پرونده الان قابل تغییر نیست.');
    if (c.documents[key]?.source === 'PACS') throw new ApiError('NOT_NEEDED', 'این مدرک از بیمارستان رسیده است.');
    c.documents[key] = {
      key,
      source: 'PATIENT',
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      addedAt: new Date().toISOString(),
      previewDataUrl: previewDataUrl ?? (await storedPreview(file)),
    };
    c.requiredItems = c.requiredItems.filter((k) => k !== key);
    logEvent(db, c, 'PATIENT', `بیمار ${DOC_LABELS[key]} را بارگذاری کرد`, getPatientSession()?.viewAs);
    save(db);
    return toPatientCase(c);
  },

  async confirmItem(id, key, yes) {
    await wait(250);
    const db = load();
    const c = myCase(db, id);
    if (c.stage !== 'WAITING_PATIENT') throw new ApiError('NOT_OPEN', 'این پرونده الان قابل تغییر نیست.');
    if (!c.confirmItems.includes(key)) throw new ApiError('NOT_NEEDED', 'این مورد نیازی به تأیید ندارد.');
    const viewAs = getPatientSession()?.viewAs;
    if (yes) {
      if (!c.confirmedItems.includes(key)) c.confirmedItems.push(key);
      logEvent(db, c, 'PATIENT', key === 'service' ? 'بیمار تأیید کرد این خدمت را دریافت کرده است' : 'بیمار تأیید کرد نسخه مال اوست', viewAs);
    } else {
      c.conflict = { kind: 'PATIENT_DENIED', reason: deniedReason(key), by: 'PATIENT', at: new Date().toISOString() };
      logEvent(db, c, 'PATIENT', deniedReason(key), viewAs);
      rejectForConflict(db, c);
    }
    save(db);
    return toPatientCase(c);
  },

  async submitERx(id, eRxId) {
    await wait(250);
    const db = load();
    const c = myCase(db, id);
    if (c.stage !== 'WAITING_PATIENT') throw new ApiError('NOT_OPEN', 'این پرونده الان قابل تغییر نیست.');
    if (c.documents.prescription?.source === 'PACS') throw new ApiError('NOT_NEEDED', 'نسخه شما از بیمارستان رسیده است.');
    const code = normalizeDigits(eRxId).replace(/[\s-]/g, '');
    if (!/^[0-9A-Za-z]{6,24}$/.test(code)) throw new ApiError('INVALID_ERX', 'شناسه نسخه الکترونیک را درست بنویسید. فقط عدد و حرف انگلیسی، دست‌کم ۶ نویسه.');
    c.documents.prescription = eRxDocument(code, new Date().toISOString());
    c.requiredItems = c.requiredItems.filter((k) => k !== 'prescription');
    logEvent(db, c, 'PATIENT', 'بیمار شناسه نسخه الکترونیک را ثبت کرد', getPatientSession()?.viewAs);
    save(db);
    return toPatientCase(c);
  },

  async submitCase(id) {
    await wait(400);
    const db = load();
    const c = myCase(db, id);
    if (c.stage !== 'WAITING_PATIENT') return toPatientCase(c);
    if (c.confirmItems.some((k) => !c.confirmedItems.includes(k))) throw new ApiError('NOT_CONFIRMED', 'اول خدمت و نسخه را تأیید کنید.');
    if (c.requiredItems.length > 0) throw new ApiError('NOT_READY', 'هنوز همه مدارک ثبت نشده است.');
    if (!c.trackingNumber) c.trackingNumber = `DN-${c.id.replace('case-', '')}`;
    c.submittedAt = new Date().toISOString();
    c.stage = 'PROCESSING';
    c.mock.processAt = Date.now() + reviewDelay();
    logEvent(db, c, 'PATIENT', 'بیمار پرونده را تأیید کرد و بررسی شروع شد', getPatientSession()?.viewAs);
    save(db);
    return toPatientCase(c);
  },

  async insuranceLogin({ username, password }) {
    await wait(250);
    const db = load();
    const account = db.staff.find((s) => s.username === username.trim() && s.password === password);
    if (!account) throw new ApiError('INVALID_LOGIN', 'نام کاربری یا رمز عبور درست نیست.');
    if (!account.active) throw new ApiError('INACTIVE', 'این حساب غیرفعال است.');
    return { role: account.role, token: `staff-${account.id}`, accountId: account.id, name: account.name };
  },

  async getInsuranceDashboard() {
    await wait();
    requireStaff('INSURANCE_ADMIN');
    const db = load();
    return {
      totals: totalsOf(db.zips),
      cases: countCases(db.cases),
      conflicts: countConflicts(db.cases),
      insurerShareRial: shareOf(db.cases),
      hospitals: allHospitals(db).map((h) => {
        const cases = db.cases.filter((c) => c.hospitalId === h.id);
        return { id: h.id, name: h.name, totals: totalsOf(db.zips.filter((z) => z.hospitalId === h.id)), cases: countCases(cases), conflicts: countConflicts(cases), insurerShareRial: shareOf(cases) };
      }),
    };
  },

  async listInsuranceCases({ hospitalId, ...request }) {
    await wait();
    requireStaff('INSURANCE_ADMIN');
    const cases = load().cases.filter((c) => c.stage === 'AT_INSURER' && (!hospitalId || c.hospitalId === hospitalId));
    const rows = cases.sort((a, b) => (b.submittedAt ?? b.receivedAt).localeCompare(a.submittedAt ?? a.receivedAt)).map(toCaseRow);
    if (rows.length > 0) {
      for (let i = 0; i < EXTRA_ROWS; i += 1) rows.push({ ...rows[i % cases.length], caseId: `extra-${i}`, patientName: `بیمار نمونه ${i + 1}` });
    }
    return paginate(rows, request);
  },

  async getInsuranceCase(id) {
    await wait(100);
    requireStaff('INSURANCE_ADMIN');
    const c = findCase(load(), id);
    // Cases with a conflict or still with the patient never reach the insurance panel.
    if (c.stage !== 'AT_INSURER') throw new ApiError('NOT_FOUND', 'این پرونده در پنل بیمه نیست.');
    return toStaffCase(c);
  },

  async getStudyImages(id) {
    await wait(120);
    const c = findCase(load(), id);
    if (!getAdminSession()) {
      requireStaff('INSURANCE_ADMIN');
      if (c.stage !== 'AT_INSURER') throw new ApiError('NOT_FOUND', 'این پرونده در پنل بیمه نیست.');
    }
    return studyImages(c);
  },

  async adminLogin({ username, password }) {
    await wait(250);
    if (username.trim() !== 'admin' || password !== 'admin1234') {
      throw new ApiError('INVALID_LOGIN', 'نام کاربری یا رمز عبور درست نیست.');
    }
    const session: AdminSession = { role: 'admin', token: 'admin-token', name: 'مدیر کل' };
    return session;
  },

  async getOverview() {
    await wait();
    const db = load();
    const overview: Overview = {
      totals: totalsOf(db.zips),
      companies: db.companies.map((c) => companyOverview(db, c)),
      pipeline: db.cases.reduce<Pipeline>(
        (counts, c) => {
          counts[groupOf(c)] += 1;
          if (c.conflict?.by === 'AI') counts.conflictByAi += 1;
          if (c.conflict?.by === 'PATIENT') counts.conflictByPatient += 1;
          return counts;
        },
        { 'waiting-patient': 0, processing: 0, 'at-insurer': 0, conflict: 0, conflictByAi: 0, conflictByPatient: 0 },
      ),
      recentActivity: activityOf(db),
    };
    return overview;
  },

  async getCompany(id) {
    await wait();
    const db = load();
    const company = db.companies.find((c) => c.id === id);
    if (!company) throw new ApiError('NOT_FOUND', 'این شرکت پیدا نشد.');
    return companyOverview(db, company);
  },

  async getHospital(id) {
    await wait();
    return hospitalDetail(load(), id);
  },

  async listZips(filter) {
    await wait();
    const db = load();
    const search = normalizeDigits(filter.search ?? '').trim().toLowerCase();
    const matched = db.zips
      .filter((z) => !filter.hospitalId || z.hospitalId === filter.hospitalId)
      .filter((z) => {
        if (!search) return true;
        const name = db.cases.find((c) => c.id === z.caseId)?.patient.name ?? '';
        const hospital = allHospitals(db).find((h) => h.id === z.hospitalId)?.name ?? '';
        return z.fileName.toLowerCase().includes(search) || z.studyTitle.includes(search) || name.includes(search) || hospital.includes(search);
      })
      .filter((z) => {
        switch (filter.group) {
          case 'accepted':
            return z.status === 'READY';
          case 'not-billable':
            return z.status !== 'READY';
          case 'unsettled':
            return z.status === 'READY' && !z.settled;
          case 'all':
          case undefined:
            return true;
          default: {
            const c = db.cases.find((x) => x.id === z.caseId);
            return !!c && groupOf(c) === filter.group;
          }
        }
      })
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const rows = matched.map((z) => toRow(db, z));
    const seeds = EXTRA_ROWS ? db.zips.filter((z) => !filter.hospitalId || z.hospitalId === filter.hospitalId).map((z) => toRow(db, z)) : [];
    if (seeds.length > 0) {
      for (let i = 0; i < EXTRA_ROWS; i += 1) {
        const fileName = `extra-${i + 1}.zip`;
        if (!search || fileName.includes(search)) rows.push({ ...seeds[i % seeds.length], id: `extra-${i}`, fileName });
      }
    }
    const sum = rows.reduce(
      (t, z) => ({
        feeRial: t.feeRial + z.feeRial,
        hospitalRial: t.hospitalRial + z.split.hospitalRial,
        insuranceRial: t.insuranceRial + z.split.insuranceRial,
        managementRial: t.managementRial + z.split.managementRial,
      }),
      { feeRial: 0, hospitalRial: 0, insuranceRial: 0, managementRial: 0 },
    );
    return { ...paginate(rows, filter), sum };
  },

  async getZip(id) {
    await wait(100);
    return zipDetail(load(), id);
  },

  async downloadZip(id) {
    await wait(200);
    if (!getAdminSession()) throw new ApiError('UNAUTHORIZED', 'لطفاً دوباره وارد شوید.');
    const db = load();
    const zip = findZip(db, id);
    const c = zip.caseId ? db.cases.find((x) => x.id === zip.caseId) : undefined;
    // Sample mode keeps no uploaded bytes, so the package is rebuilt: what it held and one image.
    const manifest = {
      fileName: zip.fileName,
      receivedAt: zip.receivedAt,
      hospitalId: zip.hospitalId,
      study: zip.studyTitle,
      status: zip.status,
      ...(zip.rejectReason ? { rejectCode: zip.rejectCode, rejectReason: zip.rejectReason } : {}),
      ...(c ? { patient: { name: c.patient.name, nationalId: c.patient.nationalId }, documents: Object.values(c.documents).flatMap((d) => (d && d.source === 'PACS' ? [d.fileName] : [])) } : {}),
    };
    const files: Array<{ name: string; data: Uint8Array | string }> = [{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) }];
    if (c) {
      const series = sampleSeries(c)[0];
      if (series) files.push({ name: 'DICOM/IM0001.dcm', data: new Uint8Array(sampleInstance(c, series.id, 0)) });
    }
    return makeZip(files, new Date(zip.receivedAt));
  },

  async updateZipSplit(id, split: FeeSplit) {
    await wait();
    const db = load();
    const zip = findZip(db, id);
    if (zip.status !== 'READY') throw new ApiError('NOT_BILLABLE', 'این فایل کارمزد ندارد.');
    if (zip.settled) throw new ApiError('SETTLED', 'این فایل تسویه شده و سهم آن قابل تغییر نیست.');
    if (split.hospitalRial + split.insuranceRial + split.managementRial !== zip.feeRial) {
      throw new ApiError('SPLIT_MISMATCH', 'جمع سهم‌ها باید با کارمزد برابر باشد.');
    }
    zip.split = { ...split };
    const edited = db.cases.find((c) => c.id === zip.caseId);
    if (edited) logEvent(db, edited, 'ADMIN', 'سهم‌های کارمزد این ZIP تغییر کرد');
    save(db);
    return zipDetail(db, id);
  },

  async settleZip(id) {
    await wait();
    const db = load();
    const zip = findZip(db, id);
    if (zip.status !== 'READY') throw new ApiError('NOT_BILLABLE', 'این فایل کارمزد ندارد.');
    zip.settled = true;
    zip.settledAt = new Date().toISOString();
    const settled = db.cases.find((c) => c.id === zip.caseId);
    if (settled) logEvent(db, settled, 'ADMIN', 'تسویه این ZIP ثبت شد');
    save(db);
    return zipDetail(db, id);
  },

  async updateHospitalFeeRule(id, rule) {
    await wait();
    const db = load();
    if (rule.hospitalRial + rule.insuranceRial + rule.managementRial !== rule.feeRial) {
      throw new ApiError('SPLIT_MISMATCH', 'جمع سهم‌ها باید با کارمزد برابر باشد.');
    }
    findHospital(db, id).hospital.feeRule = { ...rule };
    save(db);
    return hospitalDetail(db, id);
  },

  async resendInvite(caseId) {
    await wait();
    const db = load();
    const c = findCase(db, caseId);
    if (c.stage !== 'WAITING_PATIENT') throw new ApiError('NOT_NEEDED', 'بیمار مدارک را ارسال کرده است.');
    db.sequence += 1;
    c.sms.push({ ...inviteSms(c.inviteToken, new Date().toISOString(), `sms-${db.sequence}`), kind: 'REMINDER', delivery: 'SENT' });
    logEvent(db, c, 'ADMIN', 'پیامک یادآوری برای بیمار ارسال شد');
    save(db);
    return zipDetail(db, c.zipId);
  },

  async listAllStaff({ role, ...request }) {
    await wait();
    return paginate(
      staffAccounts(load()).filter((a) => a.role === role),
      request,
    );
  },

  async listPatients({ search, ...request }) {
    await wait();
    const db = load();
    const needle = normalizeDigits(search ?? '').trim();
    const rows = db.patients
      .filter((p) => !needle || p.name.includes(needle) || p.nationalId.includes(needle) || p.mobile.includes(needle))
      .map((p) => ({
        id: p.id,
        name: p.name,
        nationalId: p.nationalId,
        mobile: p.mobile,
        caseCount: db.cases.filter((c) => c.patient.id === p.id).length,
        firstInfoDone: !!p.insurance,
      }));
    if (!needle) for (let i = 0; i < EXTRA_ROWS; i += 1) rows.push({ ...rows[i % db.patients.length], id: `extra-${i}`, name: `بیمار نمونه ${i + 1}` });
    return paginate(rows, request);
  },

  async listAccessLog(request) {
    await wait();
    return paginate([...load().accessLog].reverse(), request);
  },

  async viewAsPatient(patientId) {
    await wait();
    const db = load();
    const patient = db.patients.find((p) => p.id === patientId);
    if (!patient) throw new ApiError('NOT_FOUND', 'این حساب پیدا نشد.');
    db.sequence += 1;
    db.accessLog.push({ id: `ac-${db.sequence}`, at: new Date().toISOString(), accountName: patient.name, accountLabel: 'بیمار' });
    save(db);
    return { role: 'PATIENT', token: `patient-${patient.id}`, patientId: patient.id, viewAs: true };
  },

  async viewAsStaff(accountId) {
    await wait();
    const db = load();
    const account = db.staff.find((s) => s.id === accountId);
    if (!account) throw new ApiError('NOT_FOUND', 'این حساب پیدا نشد.');
    db.sequence += 1;
    const label = 'پنل بیمه';
    db.accessLog.push({ id: `ac-${db.sequence}`, at: new Date().toISOString(), accountName: account.name, accountLabel: label });
    save(db);
    return { role: account.role, token: `staff-${account.id}`, accountId: account.id, name: account.name, viewAs: true };
  },
};

export const mockToolsImpl: MockTools = {
  async simulateIngest(input: IngestInput) {
    await wait(600);
    const db = load();
    db.sequence += 1;
    const no = String(db.sequence);
    const now = new Date().toISOString();
    const id = `encounter-${no}`;
    const { hospital } = findHospital(db, input.hospitalId);
    const sizeBytes = input.file?.size ?? (input.scenario === 'TOO_LARGE' ? 2.3e9 : 1.2e9);
    const scenario = sizeBytes > ZIP_MAX_BYTES ? 'TOO_LARGE' : input.scenario;

    const base: ZipPackage = {
      id,
      fileName: input.file?.name ?? `${id}.zip`,
      hospitalId: input.hospitalId,
      receivedAt: now,
      sizeBytes,
      status: 'READY',
      studyTitle: input.studyTitle,
      missingAtIntake: [],
      feeRial: 0,
      split: { hospitalRial: 0, insuranceRial: 0, managementRial: 0 },
      settled: false,
    };

    const rejections: Partial<Record<IngestInput['scenario'], Pick<ZipPackage, 'status' | 'rejectCode' | 'rejectReason'>>> = {
      NO_IMAGES: { status: 'REJECTED_INCOMPLETE', rejectCode: 'MISSING_IMAGES', rejectReason: 'تصویر پزشکی در بسته نیست. یک ZIP کامل و اصلاح‌شده لازم است.' },
      TOO_LARGE: { status: 'REJECTED_TOO_LARGE', rejectCode: 'ZIP_SIZE_LIMIT_EXCEEDED', rejectReason: 'حجم ZIP بیش از حد مجاز است. حجم فایل باید حداکثر ۲ گیگابایت باشد.' },
      DUPLICATE: { status: 'DUPLICATE', rejectCode: 'DUPLICATE_PACKAGE', rejectReason: 'این بسته تکراری است. پرونده و کارمزد جدیدی ایجاد نشد.' },
    };
    const rejection = rejections[scenario];
    if (rejection) {
      const zip = { ...base, ...rejection };
      db.zips.push(zip);
      save(db);
      return { zip };
    }

    const missing: UploadDocKey[] =
      scenario === 'NO_PRESCRIPTION' ? ['prescription'] : scenario === 'NO_REPORT' ? ['report'] : scenario === 'NO_PRESCRIPTION_NO_REPORT' ? ['prescription', 'report'] : [];
    const rule = hospital.feeRule;
    const zip: ZipPackage = {
      ...base,
      missingAtIntake: missing,
      caseId: `case-${no}`,
      feeRial: rule.feeRial,
      split: { hospitalRial: rule.hospitalRial, insuranceRial: rule.insuranceRial, managementRial: rule.managementRial },
    };

    const mobile = normalizeDigits(input.mobile).trim();
    if (!isValidMobile(mobile)) throw new ApiError('INVALID_MOBILE', 'شماره موبایل درست نیست.');
    const identity = identityFor(mobile);
    let patient = db.patients.find((p) => p.nationalId === identity.nationalId && p.mobile === mobile);
    if (!patient) {
      patient = { id: `p-${no}`, name: input.patientName, mobile, ...identity };
      db.patients.push(patient);
    }

    const token = `t${no}`;
    const documents: CaseRecord['documents'] = {};
    (['prescription', 'report'] as UploadDocKey[]).forEach((key) => {
      if (!missing.includes(key)) documents[key] = pacsDocument(key, now, input.studyTitle);
    });
    const c: MockCase = {
      id: `case-${no}`,
      zipId: id,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      receivedAt: now,
      patient: { id: patient.id, name: patient.name, mobile, nationalId: patient.nationalId, birthDate: patient.birthDate, insurance: patient.insurance },
      study: { title: input.studyTitle, modality: input.modality, imageCount: input.modality === 'DX' ? 4 : 120 },
      stage: 'WAITING_PATIENT',
      documents,
      requestedItems: [...missing],
      requiredItems: [...missing],
      confirmItems: itemsToConfirm(documents),
      confirmedItems: [],
      inviteToken: token,
      sms: [inviteSms(token, now, `sms-${no}`)],
      events: [],
      mock: { aiResult: input.aiResult },
    };
    logEvent(db, c, 'SYSTEM', missing.length ? `فایل ZIP دریافت شد. ${missing.map((k) => DOC_LABELS[k]).join(' و ')} در بسته نبود` : 'فایل ZIP از PACS دریافت شد');
    logEvent(db, c, 'SYSTEM', 'پیامک دعوت برای بیمار ارسال شد');
    db.zips.push(zip);
    db.cases.push(c);
    save(db);
    return { zip, caseRecord: toStaffCase(c) };
  },

  async runReview(caseId: string) {
    await wait(300);
    const db = load();
    const c = findCase(db, caseId);
    if (c.stage !== 'PROCESSING') throw new ApiError('NOT_OPEN', 'این پرونده در حال بررسی نیست.');
    runCheck(db, c);
    save(db);
  },

  async resetData() {
    await wait();
    removeKey(DB_KEY);
  },
};
