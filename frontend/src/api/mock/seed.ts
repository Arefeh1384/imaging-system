// Sample data for working without a backend. All people, amounts and dates are invented.
// The company and hospital names are the design document's own structure examples.
import type { AiOpinion, CaseEvent, CaseRecord, CaseStage, Company, ConfirmKey, ConflictKind, DocumentFile, FeeRule, InsuranceInfo, InsuranceShare, StaffRole, UploadDocKey, ZipPackage, ZipStatus } from '../types';
import { DOC_LABELS } from '../../lib/labels';

export interface MockPatient {
  id: string;
  name: string;
  nationalId: string;
  mobile: string;
  birthDate: string;
  insurance?: InsuranceInfo;
}

export interface MockStaff {
  id: string;
  role: StaffRole;
  name: string;
  username: string;
  password: string;
  active: boolean;
  createdAt: string;
}

/** What the AI will find when this case is sent. Kept out of what any screen receives. */
export type MockAiResult = 'OK' | Exclude<ConflictKind, 'PATIENT_DENIED'>;

export interface MockCase extends CaseRecord {
  /** processAt: when the check runs on its own, in milliseconds. Sample mode stands in for the real fetch and comparison. */
  mock: { aiResult: MockAiResult; processAt?: number };
}

export interface MockDb {
  companies: Company[];
  zips: ZipPackage[];
  cases: MockCase[];
  patients: MockPatient[];
  staff: MockStaff[];
  accessLog: Array<{ id: string; at: string; accountName: string; accountLabel: string }>;
  sequence: number;
}

export const DEFAULT_RULE: FeeRule = { feeRial: 100_000, hospitalRial: 30_000, insuranceRial: 30_000, managementRial: 40_000 };
const ZERO = { hospitalRial: 0, insuranceRial: 0, managementRial: 0 };
const AI_MODEL = 'مدل نمونه ۰٫۲';

/** The insurer's fixed amount per type of imaging. Illustrative until the real price list arrives. */
const TARIFF: Record<string, { title: string; toman: number }> = {
  MR: { title: 'ام‌آر‌آی', toman: 1_500_000 },
  CT: { title: 'سی‌تی‌اسکن', toman: 1_200_000 },
  US: { title: 'سونوگرافی', toman: 400_000 },
  DX: { title: 'رادیوگرافی', toman: 250_000 },
};
const TARIFF_VERSION = 'تعرفه نمونه بیمه دانا، ۱۴۰۵';

export function insuranceShareFor(modality: string, createdAt: string): InsuranceShare {
  const tariff = TARIFF[modality] ?? { title: 'سایر تصویربرداری‌ها', toman: 500_000 };
  return { tariffTitle: tariff.title, insurerShareRial: tariff.toman * 10, tariffVersion: TARIFF_VERSION, createdAt };
}

export const CONFLICT_REASONS: Record<Exclude<ConflictKind, 'PATIENT_DENIED'>, string> = {
  PRESCRIPTION_STUDY: 'خدمت نوشته‌شده در نسخه با تصویربرداری انجام‌شده یکسان نیست.',
  PRESCRIPTION_NAME: 'نام روی نسخه با نام بیمار یکسان نیست.',
  REPORT_IMAGES: 'گزارش رادیولوژیست به این تصویربرداری مربوط نیست.',
  IMAGE_PATIENT: 'تصویر پزشکی به نام بیمار دیگری است.',
};

export const deniedReason = (key: ConfirmKey) => (key === 'service' ? 'بیمار گفت این خدمت را دریافت نکرده است.' : 'بیمار گفت نسخه مال او نیست.');

/** Invented, valid-format identity details, as a PACS manifest would carry them. */
export function identityFor(mobile: string): { nationalId: string; birthDate: string } {
  const base = mobile.slice(-9);
  const sum = base.split('').reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const remainder = sum % 11;
  const control = remainder < 2 ? remainder : 11 - remainder;
  const n = Number(mobile.slice(-4));
  const pad = (v: number) => String(v).padStart(2, '0');
  return { nationalId: `${base}${control}`, birthDate: `13${50 + (n % 40)}/${pad((n % 12) + 1)}/${pad((n % 28) + 1)}` };
}

/** The AI compares the documents with each other and with the patient. */
export function buildOpinion(studyTitle: string, result: MockAiResult, createdAt: string): AiOpinion {
  const check = (kind: MockAiResult, ok: { title: string; detail: string }, target: 'prescription' | 'report') =>
    result === kind ? { title: CONFLICT_REASONS[kind as keyof typeof CONFLICT_REASONS], detail: 'پرونده برای بیمه ارسال نشد و بیمار باید با مرکز درمانی تماس بگیرد.', result: 'CONFLICT' as const, target } : { ...ok, result: 'PASS' as const, target };
  return {
    result: result === 'OK' ? 'OK' : 'CONFLICT',
    summary: result === 'OK' ? 'نسخه، گزارش و تصویر با هم و با مشخصات بیمار هم‌خوانی دارند.' : CONFLICT_REASONS[result],
    findings: [
      check('PRESCRIPTION_STUDY', { title: 'نسخه با تصویربرداری هم‌خوانی دارد', detail: `در نسخه، خدمت «${studyTitle}» ثبت شده است.` }, 'prescription'),
      check('PRESCRIPTION_NAME', { title: 'نام روی نسخه درست است', detail: 'نام و کد ملی روی نسخه با پرونده یکسان است.' }, 'prescription'),
      check('REPORT_IMAGES', { title: 'گزارش با تصویر هم‌خوانی دارد', detail: 'گزارش رادیولوژیست به همین تصویربرداری مربوط است.' }, 'report'),
    ],
    modelVersion: AI_MODEL,
    createdAt,
  };
}

export function inviteSms(token: string, sentAt: string, id: string) {
  return {
    id,
    kind: 'INVITE' as const,
    sentAt,
    delivery: 'DELIVERED' as const,
    text: `سامانه تصویربرداری و بیمه: کار پرونده شما را جلو بردیم. لطفاً وارد پنل کاربری خود شوید و کارتان را ادامه دهید: https://portal.example/c/${token}`,
  };
}

export function sentSms(trackingNumber: string, sentAt: string, id: string) {
  return {
    id,
    kind: 'SENT' as const,
    sentAt,
    delivery: 'DELIVERED' as const,
    text: `سامانه تصویربرداری و بیمه: پرونده شما کامل است و برای بیمه ارسال شد. شماره پیگیری: ${trackingNumber}`,
  };
}

export function conflictSms(hospitalName: string, sentAt: string, id: string) {
  return {
    id,
    kind: 'CONFLICT' as const,
    sentAt,
    delivery: 'SENT' as const,
    text: `اطلاعات پرونده تصویربرداری شما با هم مغایرت دارد و برای بیمه ارسال نشد. لطفاً با ${hospitalName} تماس بگیرید تا اطلاعات را دوباره بفرستند.`,
  };
}

export function pacsDocument(key: UploadDocKey, at: string, study: string): DocumentFile {
  if (key === 'prescription') {
    return { key, source: 'PACS', fileName: 'prescription.pdf', mimeType: 'application/pdf', sizeBytes: 120_000, addedAt: at };
  }
  return {
    key,
    source: 'PACS',
    fileName: 'radiology-report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 150_000,
    addedAt: at,
    reportDoctor: 'دکتر الف. کریمی',
    reportText: `گزارش نهایی ${study}: یافتهٔ حاد مشاهده نشد.`,
  };
}

export function patientDocument(key: UploadDocKey, at: string): DocumentFile {
  return { key, source: 'PATIENT', fileName: `${key}.jpg`, mimeType: 'image/jpeg', sizeBytes: 420_000, addedAt: at };
}

/** An electronic prescription: only its code is known until the system fetches it. */
export function eRxDocument(eRxId: string, at: string): DocumentFile {
  return { key: 'prescription', source: 'PATIENT', fileName: 'e-prescription', mimeType: 'application/x-e-prescription', sizeBytes: 0, addedAt: at, eRxId };
}

/** The patient always confirms the service, and the prescription only when it came in the ZIP. */
export function itemsToConfirm(documents: CaseRecord['documents']): ConfirmKey[] {
  return documents.prescription?.source === 'PACS' ? ['service', 'prescription'] : ['service'];
}

function iso(date: string, time = '07:30'): string {
  return `${date}T${time}:00.000Z`;
}

interface CaseSeed {
  no: string;
  hospitalId: string;
  hospitalName: string;
  date: string;
  study: string;
  modality: string;
  images: number;
  gb: number;
  patientId: string;
  stage: CaseStage;
  /** Not in the ZIP, so the patient uploads it. */
  missing?: UploadDocKey[];
  settled?: boolean;
  token?: string;
  aiResult?: MockAiResult;
  /** The patient said no to this. */
  denied?: ConfirmKey;
  /** The patient typed this electronic prescription code instead of uploading a photo. */
  eRx?: string;
}

function makeCase(s: CaseSeed, patients: MockPatient[]): { zip: ZipPackage; caseRecord: MockCase } {
  const id = `case-${s.no}`;
  const token = s.token ?? `tk${s.no}`;
  const missing = s.missing ?? [];
  const patient = patients.find((p) => p.id === s.patientId);
  if (!patient) throw new Error(`Unknown patient ${s.patientId}`);
  const aiResult = s.aiResult ?? 'OK';

  const documents: CaseRecord['documents'] = {};
  (['prescription', 'report'] as UploadDocKey[]).forEach((key) => {
    if (!missing.includes(key)) documents[key] = pacsDocument(key, iso(s.date), s.study);
  });
  const confirmItems = itemsToConfirm(documents);

  const c: MockCase = {
    id,
    zipId: `encounter-${s.no}`,
    hospitalId: s.hospitalId,
    hospitalName: s.hospitalName,
    receivedAt: iso(s.date),
    patient: { id: patient.id, name: patient.name, mobile: patient.mobile, nationalId: patient.nationalId, birthDate: patient.birthDate, insurance: patient.insurance },
    study: { title: s.study, modality: s.modality, imageCount: s.images },
    stage: s.stage,
    documents,
    requestedItems: [...missing],
    requiredItems: [...missing],
    confirmItems,
    confirmedItems: [],
    inviteToken: token,
    sms: [inviteSms(token, iso(s.date, '07:31'), `sms-${s.no}`)],
    events: [],
    mock: { aiResult },
  };

  const log = (time: string, actor: CaseEvent['actor'], title: string) => {
    c.events.push({ id: `${id}-${c.events.length}`, at: iso(s.date, time), actor, title });
  };

  log('07:30', 'SYSTEM', missing.length ? `فایل ZIP دریافت شد. ${missing.map((k) => DOC_LABELS[k]).join(' و ')} در بسته نبود` : 'فایل ZIP از PACS دریافت شد');
  log('07:31', 'SYSTEM', 'پیامک دعوت برای بیمار ارسال شد');

  if (s.stage !== 'WAITING_PATIENT') {
    log('10:30', 'PATIENT', 'بیمار وارد سامانه شد');
    if (s.denied === 'service') {
      c.conflict = { kind: 'PATIENT_DENIED', reason: deniedReason('service'), by: 'PATIENT', at: iso(s.date, '10:32') };
      log('10:32', 'PATIENT', deniedReason('service'));
    } else {
      c.confirmedItems = ['service'];
      log('10:32', 'PATIENT', 'بیمار تأیید کرد این خدمت را دریافت کرده است');
      missing.forEach((key) => {
        if (key === 'prescription' && s.eRx) {
          documents.prescription = eRxDocument(s.eRx, iso(s.date, '10:40'));
          log('10:40', 'PATIENT', 'بیمار شناسه نسخه الکترونیک را ثبت کرد');
        } else {
          documents[key] = patientDocument(key, iso(s.date, '10:40'));
          log('10:40', 'PATIENT', `بیمار ${DOC_LABELS[key]} را بارگذاری کرد`);
        }
      });
      c.requiredItems = [];
      if (s.denied === 'prescription') {
        c.conflict = { kind: 'PATIENT_DENIED', reason: deniedReason('prescription'), by: 'PATIENT', at: iso(s.date, '10:44') };
        log('10:44', 'PATIENT', deniedReason('prescription'));
      } else {
        c.confirmedItems = [...confirmItems];
        if (confirmItems.includes('prescription')) log('10:44', 'PATIENT', 'بیمار تأیید کرد نسخه مال اوست');
        log('10:45', 'PATIENT', 'بیمار پرونده را تأیید کرد و بررسی شروع شد');
        c.trackingNumber = `DN-${s.no}`;
        c.submittedAt = iso(s.date, '10:45');
        if (s.stage === 'PROCESSING') {
          // Waits for the check. In sample mode it runs from the main admin's ZIP page.
          c.mock.processAt = Number.MAX_SAFE_INTEGER;
        } else {
          if (s.eRx) log('11:40', 'SYSTEM', 'نسخه الکترونیک از سامانه نسخه دریافت شد');
          c.aiOpinion = buildOpinion(s.study, aiResult, iso(s.date, '11:41'));
          c.reviewedAt = iso(s.date, '11:41');
          if (aiResult === 'OK') {
            c.insuranceShare = insuranceShareFor(s.modality, iso(s.date, '11:41'));
            log('11:41', 'AI', 'هوش مصنوعی مغایرتی ندید و سهم بیمه را حساب کرد');
            c.sms.push(sentSms(c.trackingNumber, iso(s.date, '11:42'), `sms-${s.no}-s`));
            log('11:42', 'SYSTEM', 'پیامک ارسال به بیمه برای بیمار فرستاده شد');
          } else {
            c.conflict = { kind: aiResult, reason: CONFLICT_REASONS[aiResult], by: 'AI', at: iso(s.date, '11:41') };
            log('11:41', 'AI', `هوش مصنوعی مغایرت دید: ${CONFLICT_REASONS[aiResult]}`);
          }
        }
      }
    }
    if (c.conflict) {
      c.sms.push(conflictSms(s.hospitalName, iso(s.date, '11:42'), `sms-${s.no}-c`));
      log('11:42', 'SYSTEM', 'پیامک مغایرت برای بیمار ارسال شد');
    }
  }

  if (s.settled) log('16:00', 'ADMIN', 'تسویه این ZIP ثبت شد');

  const zip: ZipPackage = {
    id: c.zipId,
    fileName: `${c.zipId}.zip`,
    hospitalId: s.hospitalId,
    receivedAt: iso(s.date),
    sizeBytes: s.gb * 1e9,
    status: 'READY',
    studyTitle: s.study,
    missingAtIntake: missing,
    caseId: id,
    feeRial: DEFAULT_RULE.feeRial,
    split: { hospitalRial: DEFAULT_RULE.hospitalRial, insuranceRial: DEFAULT_RULE.insuranceRial, managementRial: DEFAULT_RULE.managementRial },
    settled: !!s.settled,
    settledAt: s.settled ? iso(s.date, '16:00') : undefined,
  };
  return { zip, caseRecord: c };
}

function rejectedZip(id: string, hospitalId: string, date: string, study: string, gb: number, status: ZipStatus, code: string, reason: string): ZipPackage {
  return {
    id,
    fileName: `${id}.zip`,
    hospitalId,
    receivedAt: iso(date),
    sizeBytes: gb * 1e9,
    status,
    studyTitle: study,
    rejectCode: code,
    rejectReason: reason,
    missingAtIntake: [],
    feeRial: 0,
    split: ZERO,
    settled: false,
  };
}

export function createSeed(): MockDb {
  const H1 = 'بیمارستان امام حسین';
  const H2 = 'بیمارستان بقیه‌الله';
  const H3 = 'بیمارستان نمونه ج';
  const H4 = 'بیمارستان نمونه د';

  const companies: Company[] = [
    {
      id: 'c1',
      name: 'شرکت دکتر نیکان',
      hospitals: [
        { id: 'h1', companyId: 'c1', name: H1, feeRule: { ...DEFAULT_RULE } },
        { id: 'h2', companyId: 'c1', name: H2, feeRule: { ...DEFAULT_RULE } },
      ],
    },
    {
      id: 'c2',
      name: 'شرکت نمونه دوم',
      hospitals: [
        { id: 'h3', companyId: 'c2', name: H3, feeRule: { ...DEFAULT_RULE } },
        { id: 'h4', companyId: 'c2', name: H4, feeRule: { ...DEFAULT_RULE } },
      ],
    },
  ];

  const insurance = (no: string): InsuranceInfo => ({ insurer: 'بیمه دانا', policyNumber: `DN-${no}`, relation: 'خود شخص' });
  const person = (id: string, name: string, mobile: string, done = true): MockPatient => ({ id, name, mobile, ...identityFor(mobile), insurance: done ? insurance(mobile.slice(-4)) : undefined });

  const patients: MockPatient[] = [
    person('p-sara', 'سارا رحیمی', '09120004521', false),
    person('p-ali', 'علی موسوی', '09120001111'),
    person('p-maryam', 'مریم کاظمی', '09120002222'),
    person('p-hossein', 'حسین نوری', '09120003333'),
    person('p-narges', 'نرگس عباسی', '09120004444'),
    person('p-reza', 'رضا احمدی', '09120005555'),
    person('p-leila', 'لیلا صادقی', '09120006666'),
    person('p-omid', 'امید کریمی', '09120007777'),
    person('p-zahra', 'زهرا جعفری', '09120008888'),
    person('p-bahram', 'بهرام رستمی', '09120009999', false),
    person('p-fatemeh', 'فاطمه مرادی', '09121110000'),
    person('p-mehdi', 'مهدی قاسمی', '09122220000'),
    person('p-shima', 'شیما حیدری', '09123330000'),
  ];

  const staff: MockStaff[] = [{ id: 'st-admin', role: 'INSURANCE_ADMIN', name: 'بیمه دانا', username: 'dana-admin', password: 'dana1234', active: true, createdAt: iso('2026-10-01') }];

  const seeds: CaseSeed[] = [
    { no: '1042', hospitalId: 'h1', hospitalName: H1, date: '2026-10-28', study: 'سی‌تی‌اسکن قفسه سینه', modality: 'CT', images: 124, gb: 1.4, patientId: 'p-sara', stage: 'WAITING_PATIENT', missing: ['prescription'], token: '7Kx2Qp' },
    { no: '1048', hospitalId: 'h1', hospitalName: H1, date: '2026-10-28', study: 'سونوگرافی شکم', modality: 'US', images: 26, gb: 0.3, patientId: 'p-sara', stage: 'WAITING_PATIENT', token: '7Kx2Qr' },
    { no: '1043', hospitalId: 'h1', hospitalName: H1, date: '2026-10-27', study: 'ام‌آر‌آی مغز', modality: 'MR', images: 210, gb: 1.8, patientId: 'p-ali', stage: 'AT_INSURER', missing: ['prescription'], settled: true },
    { no: '1044', hospitalId: 'h1', hospitalName: H1, date: '2026-10-25', study: 'رادیوگرافی زانو', modality: 'DX', images: 4, gb: 0.2, patientId: 'p-ali', stage: 'AT_INSURER', settled: true },
    { no: '1047', hospitalId: 'h1', hospitalName: H1, date: '2026-10-22', study: 'سی‌تی‌اسکن شکم', modality: 'CT', images: 148, gb: 1.6, patientId: 'p-maryam', stage: 'REJECTED_CONFLICT', missing: ['prescription'], aiResult: 'PRESCRIPTION_STUDY' },
    { no: '2011', hospitalId: 'h2', hospitalName: H2, date: '2026-10-29', study: 'ام‌آر‌آی ستون فقرات', modality: 'MR', images: 230, gb: 1.9, patientId: 'p-hossein', stage: 'AT_INSURER', settled: true },
    { no: '2012', hospitalId: 'h2', hospitalName: H2, date: '2026-10-26', study: 'سی‌تی‌اسکن قفسه سینه', modality: 'CT', images: 118, gb: 1.2, patientId: 'p-narges', stage: 'REJECTED_CONFLICT', denied: 'service' },
    { no: '2014', hospitalId: 'h2', hospitalName: H2, date: '2026-10-21', study: 'ام‌آر‌آی زانو', modality: 'MR', images: 160, gb: 1.5, patientId: 'p-reza', stage: 'AT_INSURER', missing: ['prescription'], eRx: '14057788123' },
    { no: '2015', hospitalId: 'h2', hospitalName: H2, date: '2026-10-20', study: 'سونوگرافی شکم', modality: 'US', images: 28, gb: 0.3, patientId: 'p-leila', stage: 'WAITING_PATIENT' },
    { no: '3021', hospitalId: 'h3', hospitalName: H3, date: '2026-10-28', study: 'سی‌تی‌اسکن سینوس', modality: 'CT', images: 90, gb: 0.9, patientId: 'p-omid', stage: 'AT_INSURER', missing: ['prescription'], settled: true },
    { no: '3022', hospitalId: 'h3', hospitalName: H3, date: '2026-10-26', study: 'ام‌آر‌آی مغز', modality: 'MR', images: 205, gb: 1.7, patientId: 'p-zahra', stage: 'REJECTED_CONFLICT', missing: ['prescription'], aiResult: 'PRESCRIPTION_NAME' },
    { no: '3024', hospitalId: 'h3', hospitalName: H3, date: '2026-10-19', study: 'رادیوگرافی قفسه سینه', modality: 'DX', images: 2, gb: 0.1, patientId: 'p-bahram', stage: 'WAITING_PATIENT', missing: ['prescription', 'report'] },
    { no: '4031', hospitalId: 'h4', hospitalName: H4, date: '2026-10-30', study: 'سی‌تی‌اسکن قفسه سینه', modality: 'CT', images: 120, gb: 1.3, patientId: 'p-fatemeh', stage: 'PROCESSING', missing: ['prescription'], eRx: '14059900456' },
    { no: '4032', hospitalId: 'h4', hospitalName: H4, date: '2026-10-27', study: 'سونوگرافی شکم', modality: 'US', images: 30, gb: 0.2, patientId: 'p-mehdi', stage: 'AT_INSURER', settled: true },
    { no: '4033', hospitalId: 'h4', hospitalName: H4, date: '2026-10-18', study: 'ام‌آر‌آی شانه', modality: 'MR', images: 170, gb: 1.6, patientId: 'p-shima', stage: 'AT_INSURER', missing: ['prescription'], settled: true },
  ];

  const built = seeds.map((s) => makeCase(s, patients));
  const rejected: ZipPackage[] = [
    rejectedZip('encounter-1045', 'h1', '2026-10-24', 'سی‌تی‌اسکن شکم', 1.1, 'REJECTED_INCOMPLETE', 'MISSING_IMAGES', 'تصویر پزشکی در بسته نیست. یک ZIP کامل و اصلاح‌شده لازم است.'),
    rejectedZip('encounter-1044-dup', 'h1', '2026-10-25', 'رادیوگرافی زانو', 0.2, 'DUPLICATE', 'DUPLICATE_PACKAGE', 'این بسته تکرار encounter-1044 است. پرونده و کارمزد جدیدی ایجاد نشد.'),
    rejectedZip('encounter-2013', 'h2', '2026-10-23', 'ام‌آر‌آی لگن', 2.3, 'REJECTED_TOO_LARGE', 'ZIP_SIZE_LIMIT_EXCEEDED', 'حجم ZIP بیش از حد مجاز است. حجم فایل باید حداکثر ۲ گیگابایت باشد.'),
    rejectedZip('encounter-3023', 'h3', '2026-10-24', 'سی‌تی‌اسکن قفسه سینه', 1.2, 'REJECTED_INCOMPLETE', 'MISSING_PATIENT_DETAILS', 'مشخصات بیمار در بسته نیست. یک ZIP کامل و اصلاح‌شده لازم است.'),
  ];

  return {
    companies,
    zips: [...built.map((b) => b.zip), ...rejected],
    cases: built.map((b) => b.caseRecord),
    patients,
    staff,
    accessLog: [],
    sequence: 5000,
  };
}
