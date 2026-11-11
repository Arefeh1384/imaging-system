// The data contract between this frontend and the backend.
// All money values are whole rials. The UI displays Toman.

export type Rial = number;

export type ZipStatus = 'READY' | 'REJECTED_INCOMPLETE' | 'REJECTED_TOO_LARGE' | 'DUPLICATE';

/**
 * Documents that can be missing from the ZIP, so the patient uploads them.
 * The prescription is sometimes in the ZIP and sometimes not.
 * The medical images only ever come from the medical center.
 */
export type UploadDocKey = 'prescription' | 'report';
export type DocKey = UploadDocKey | 'images';

/**
 * What the patient confirms: that they had this service (this imaging, on this date, at this center),
 * and, when the prescription came in the ZIP, that it is theirs. The images and the report need no confirming.
 */
export type ConfirmKey = 'service' | 'prescription';

/** Where a case is right now. A case has one stage at a time. */
export type CaseStage =
  /** The patient has to confirm the service and the prescription, add what is missing, and press confirm. */
  | 'WAITING_PATIENT'
  /** The patient confirmed. The system fetches what it needs (such as the e-prescription) and the AI compares it with the images. The result goes to the patient by SMS. */
  | 'PROCESSING'
  /** The AI found no conflict and worked out the insurance share. The case is in the insurance panel. */
  | 'AT_INSURER'
  /** The AI found a conflict, or the patient said a document is not theirs. The patient was told by SMS to call the center. */
  | 'REJECTED_CONFLICT';

export type StaffRole = 'INSURANCE_ADMIN';

/** Why a case was rejected for a conflict. */
export type ConflictKind = 'PRESCRIPTION_STUDY' | 'PRESCRIPTION_NAME' | 'REPORT_IMAGES' | 'PATIENT_DENIED' | 'IMAGE_PATIENT';

export interface FeeSplit {
  hospitalRial: Rial;
  insuranceRial: Rial;
  managementRial: Rial;
}

export interface FeeRule extends FeeSplit {
  feeRial: Rial;
}

export interface Hospital {
  id: string;
  companyId: string;
  name: string;
  feeRule: FeeRule;
}

export interface Company {
  id: string;
  name: string;
  hospitals: Hospital[];
}

export interface Totals {
  received: number;
  accepted: number;
  notBillable: number;
  feeRial: Rial;
  hospitalRial: Rial;
  insuranceRial: Rial;
  managementRial: Rial;
  settledHospitalRial: Rial;
}

export interface ZipPackage {
  id: string;
  fileName: string;
  hospitalId: string;
  receivedAt: string;
  sizeBytes: number;
  status: ZipStatus;
  studyTitle: string;
  rejectCode?: string;
  rejectReason?: string;
  /** Optional documents that were not inside the ZIP, so the patient must upload them. */
  missingAtIntake: UploadDocKey[];
  caseId?: string;
  feeRial: Rial;
  split: FeeSplit;
  settled: boolean;
  settledAt?: string;
}

export interface DocumentFile {
  key: UploadDocKey;
  source: 'PACS' | 'PATIENT';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: string;
  previewDataUrl?: string;
  /** Readable content for documents that arrived from PACS. */
  reportText?: string;
  reportDoctor?: string;
  /** An electronic prescription: the patient typed its code instead of uploading a photo. */
  eRxId?: string;
}

export interface InsuranceInfo {
  insurer: string;
  policyNumber: string;
  relation: string;
}

export interface AiFinding {
  title: string;
  detail: string;
  result: 'PASS' | 'CONFLICT';
  /** The document this finding is about. */
  target: DocKey;
  /** Why it failed: the details disagree, the document can't be read, or it isn't the right document. */
  problem?: 'NONE' | 'MISMATCH' | 'UNREADABLE' | 'NOT_THE_DOCUMENT';
}

/** The AI compares the prescription, the report, the images and the patient's details. */
export interface AiOpinion {
  result: 'OK' | 'CONFLICT';
  /** The model's own summary, word for word. */
  summary: string;
  findings: AiFinding[];
  /** Which checker answered, such as "OpenRouter (google/gemma-4-31b-it:free)". */
  modelVersion: string;
  /** False when the check ran without AI (the backend's test checker). Missing means AI. */
  byAi?: boolean;
  /** The model's reply exactly as it came. */
  rawAnswer?: string;
  createdAt: string;
}

/** What the insurance pays for this case: a fixed amount per type of imaging. */
export interface InsuranceShare {
  /** The type of imaging the amount was taken from, such as MRI. */
  tariffTitle: string;
  insurerShareRial: Rial;
  /** Which price list was used. */
  tariffVersion: string;
  createdAt: string;
}

export interface CaseConflict {
  kind: ConflictKind;
  /** Said plainly, so the patient and the main admin both understand it. */
  reason: string;
  by: 'AI' | 'PATIENT';
  at: string;
}

/** One picture made from the DICOM study, as a PNG. */
/** PACS admin panel: how much each medical center sent. Counts only, nothing about patients. */
export type SendPeriod = 'today' | '7d' | '30d' | 'all';

export interface CenterVolume {
  id: string;
  name: string;
  /** ZIPs received from this center in the period, accepted or not. */
  sent: number;
  accepted: number;
  rejected: number;
  sizeBytes: number;
  lastSentAt?: string;
}

export interface SendVolume {
  period: SendPeriod;
  /** First day of the period (Tehran time); null when nothing has been sent at all. */
  from: string | null;
  to: string;
  total: { sent: number; accepted: number; rejected: number; sizeBytes: number };
  /** Every known center, most sends first, including centers that sent nothing in the period. */
  centers: CenterVolume[];
  /** One entry per day of the period, oldest first. */
  daily: Array<{ date: string; sent: number }>;
}

export interface PacsAdminSession {
  token: string;
  name: string;
}

export interface StudyImage {
  id: string;
  label: string;
  url: string;
  width: number;
  height: number;
}

export interface SmsEvent {
  id: string;
  kind: 'INVITE' | 'REMINDER' | 'CONFLICT' | 'SENT';
  sentAt: string;
  delivery: 'SENT' | 'DELIVERED';
  text: string;
}

export type EventActor = 'PATIENT' | 'SYSTEM' | 'AI' | 'INSURANCE_ADMIN' | 'ADMIN';

export interface CaseEvent {
  id: string;
  at: string;
  actor: EventActor;
  title: string;
}

/** A case as staff and the main admin see it. */
export interface CaseRecord {
  id: string;
  zipId: string;
  hospitalId: string;
  hospitalName: string;
  receivedAt: string;
  patient: {
    id: string;
    name: string;
    mobile: string;
    nationalId: string;
    birthDate: string;
    insurance?: InsuranceInfo;
  };
  study: {
    title: string;
    modality: string;
    imageCount: number;
  };
  stage: CaseStage;
  documents: Partial<Record<UploadDocKey, DocumentFile>>;
  /** What was missing from the ZIP, so the patient was asked to upload it. */
  requestedItems: UploadDocKey[];
  /** Of those, what is still missing. */
  requiredItems: UploadDocKey[];
  /** What the patient confirms: always the service, and the prescription when it came in the ZIP. */
  confirmItems: ConfirmKey[];
  /** Of those, what the patient has confirmed. */
  confirmedItems: ConfirmKey[];
  trackingNumber?: string;
  /** When the patient pressed confirm. */
  submittedAt?: string;
  /** When the check finished and the case went to the insurer or was rejected. */
  reviewedAt?: string;
  aiOpinion?: AiOpinion;
  insuranceShare?: InsuranceShare;
  conflict?: CaseConflict;
  inviteToken: string;
  sms: SmsEvent[];
  events: CaseEvent[];
}

/**
 * A case as the patient sees it. It holds no AI results or amounts,
 * so they cannot reach the patient's phone at all.
 */
export interface PatientCase {
  id: string;
  hospitalName: string;
  receivedAt: string;
  studyTitle: string;
  stage: CaseStage;
  documents: Array<Pick<DocumentFile, 'key' | 'source' | 'fileName' | 'previewDataUrl' | 'eRxId'>>;
  requestedItems: UploadDocKey[];
  requiredItems: UploadDocKey[];
  confirmItems: ConfirmKey[];
  confirmedItems: ConfirmKey[];
  /** Only when the case was rejected for a conflict: what to tell the patient. */
  conflictReason?: string;
  trackingNumber?: string;
  submittedAt?: string;
}

export interface PatientProfile {
  name: string;
  nationalId: string;
  mobile: string;
  birthDate: string;
  insurance?: InsuranceInfo;
  needsFirstInfo: boolean;
}

export interface CaseSummary {
  stage: CaseStage;
  insurerShareRial?: Rial;
  conflictReason?: string;
}

export interface ZipRow extends ZipPackage {
  hospitalName: string;
  companyName: string;
  patientName?: string;
  caseSummary?: CaseSummary;
}

export interface ActivityItem extends CaseEvent {
  zipId: string;
  fileName: string;
  patientName?: string;
  hospitalName: string;
}

export type CaseGroup = 'waiting-patient' | 'processing' | 'at-insurer' | 'conflict';
export type Pipeline = Record<CaseGroup, number> & {
  /** Conflicts split by who found them. */
  conflictByAi: number;
  conflictByPatient: number;
};

export interface OverviewCompany {
  id: string;
  name: string;
  totals: Totals;
  hospitals: Array<Hospital & { totals: Totals }>;
}

export interface Overview {
  totals: Totals;
  companies: OverviewCompany[];
  pipeline: Pipeline;
  recentActivity: ActivityItem[];
}

export interface HospitalDetail {
  hospital: Hospital;
  company: Pick<Company, 'id' | 'name'>;
  totals: Totals;
  recentActivity: ActivityItem[];
}

export interface ZipDetail {
  zip: ZipRow;
  company: Pick<Company, 'id' | 'name'>;
  hospital: Hospital;
  caseRecord?: CaseRecord;
}

export interface ZipFilter {
  search?: string;
  hospitalId?: string;
  group?: 'all' | 'accepted' | 'not-billable' | 'unsettled' | CaseGroup;
}

/** One row in the insurance panel's list. */
export interface CaseRow {
  caseId: string;
  zipId: string;
  hospitalId: string;
  hospitalName: string;
  patientName: string;
  studyTitle: string;
  receivedAt: string;
  submittedAt?: string;
  stage: CaseStage;
  insurerShareRial?: Rial;
}

export type ConflictCounts = Record<ConflictKind, number>;

export interface CaseCounts {
  atInsurer: number;
  waitingPatient: number;
  processing: number;
  conflict: number;
}

export interface HospitalStats {
  id: string;
  name: string;
  totals: Totals;
  cases: CaseCounts;
  conflicts: ConflictCounts;
  /** What the insurance pays for the cases in its panel. */
  insurerShareRial: Rial;
}

export interface InsuranceDashboard {
  totals: Totals;
  cases: CaseCounts;
  conflicts: ConflictCounts;
  insurerShareRial: Rial;
  hospitals: HospitalStats[];
}

export interface StaffAccount {
  id: string;
  role: StaffRole;
  name: string;
  username: string;
  active: boolean;
  createdAt: string;
}

export interface PatientAccount {
  id: string;
  name: string;
  nationalId: string;
  mobile: string;
  caseCount: number;
  firstInfoDone: boolean;
}

export interface AccessLogItem {
  id: string;
  at: string;
  accountName: string;
  accountLabel: string;
}

export interface InviteInfo {
  caseId: string;
  hospitalName: string;
  /** Only returned by the local sample mode. A real backend never returns this. */
  devHint?: { nationalId: string; mobile: string };
}

/** A one-time code was sent by SMS. The code itself only ever travels by SMS. */
export interface OtpChallenge {
  challengeId: string;
  /** The number it went to, partly hidden, like 0912***4521. */
  maskedMobile: string;
  codeLength: number;
  expiresInSeconds: number;
  /** How long until another SMS can be requested. */
  resendInSeconds: number;
  /** Sample mode only, because no real SMS is sent there. A real backend never returns this. */
  sampleCode?: string;
}

export interface PatientSession {
  role: 'PATIENT';
  token: string;
  patientId: string;
  /** Set when the main admin opened this account. */
  viewAs?: boolean;
}

export interface StaffSession {
  role: StaffRole;
  token: string;
  accountId: string;
  name: string;
  viewAs?: boolean;
}

export interface AdminSession {
  role: 'admin';
  token: string;
  name: string;
}

/** Everything the screens need. Swap the implementation, and the screens stay the same. */
/** Every list from the database comes one page at a time. The server caps pageSize at 100. */
export interface PageRequest {
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  /** How many rows match in total, not just on this page. */
  total: number;
  /** The page actually returned: the last one, if the requested page no longer exists. */
  page: number;
  pageSize: number;
}

/** A page of ZIPs, with totals for everything that matches, not only the rows on this page. */
export interface ZipPage extends Page<ZipRow> {
  sum: FeeSplit & { feeRial: Rial };
}

export interface ApiClient {
  // Patient portal
  getInvite(token: string): Promise<InviteInfo>;
  /** Checks the national ID and mobile together. If they match, sends a code to that mobile. */
  patientRequestCode(input: { nationalId: string; mobile: string }): Promise<OtpChallenge>;
  patientVerifyCode(input: { challengeId: string; code: string }): Promise<PatientSession>;
  getMyProfile(): Promise<PatientProfile>;
  saveFirstInfo(input: InsuranceInfo): Promise<PatientProfile>;
  listMyCases(): Promise<PatientCase[]>;
  getMyCase(caseId: string): Promise<PatientCase>;
  uploadDocument(caseId: string, key: UploadDocKey, file: File, previewDataUrl?: string): Promise<PatientCase>;
  /**
   * The patient confirms the case. It moves to PROCESSING and the patient is told the result will come by SMS.
   * Later the system fetches the e-prescription and the AI compares everything: no conflict, it goes to the insurer with its share
   * and the patient gets an SMS; a conflict, it is rejected and the patient gets an SMS to call the center.
   */
  submitCase(caseId: string): Promise<PatientCase>;

  /** The patient says whether they had the service, or whether the prescription is theirs. «No» rejects the case for a conflict. */
  confirmItem(caseId: string, key: ConfirmKey, yes: boolean): Promise<PatientCase>;
  /** An electronic prescription: the patient types its code instead of uploading a photo. */
  submitERx(caseId: string, eRxId: string): Promise<PatientCase>;

  // Insurance panel
  insuranceLogin(input: { username: string; password: string }): Promise<StaffSession>;
  getInsuranceDashboard(): Promise<InsuranceDashboard>;
  /** Only the cases the AI passed. */
  listInsuranceCases(filter: { hospitalId?: string } & PageRequest): Promise<Page<CaseRow>>;
  getInsuranceCase(caseId: string): Promise<CaseRecord>;

  /** 4 or 5 PNG pictures made from the DICOM study. For the insurance panel and the main admin. */
  getStudyImages(caseId: string): Promise<StudyImage[]>;

  // PACS admin panel
  pacsAdminLogin(input: { username: string; password: string }): Promise<PacsAdminSession>;
  getSendVolume(period: SendPeriod): Promise<SendVolume>;

  // Main admin panel
  adminLogin(input: { username: string; password: string }): Promise<AdminSession>;
  getOverview(): Promise<Overview>;
  getCompany(companyId: string): Promise<OverviewCompany>;
  getHospital(hospitalId: string): Promise<HospitalDetail>;
  listZips(filter: ZipFilter & PageRequest): Promise<ZipPage>;
  getZip(zipId: string): Promise<ZipDetail>;
  /** The package as the hospital's PACS sent it. */
  downloadZip(zipId: string): Promise<Blob>;
  updateZipSplit(zipId: string, split: FeeSplit): Promise<ZipDetail>;
  settleZip(zipId: string): Promise<ZipDetail>;
  updateHospitalFeeRule(hospitalId: string, rule: FeeRule): Promise<HospitalDetail>;
  resendInvite(caseId: string): Promise<ZipDetail>;
  listAllStaff(filter: { role: StaffRole } & PageRequest): Promise<Page<StaffAccount>>;
  listPatients(filter: { search?: string } & PageRequest): Promise<Page<PatientAccount>>;
  listAccessLog(request: PageRequest): Promise<Page<AccessLogItem>>;
  viewAsPatient(patientId: string): Promise<PatientSession>;
  viewAsStaff(accountId: string): Promise<StaffSession>;
}

/** Stand-ins for events that a backend or PACS will produce later. */
export type IngestScenario = 'COMPLETE' | 'NO_PRESCRIPTION' | 'NO_REPORT' | 'NO_PRESCRIPTION_NO_REPORT' | 'NO_IMAGES' | 'TOO_LARGE' | 'DUPLICATE';

export interface IngestInput {
  hospitalId: string;
  scenario: IngestScenario;
  /** What the AI will find when the patient sends the case. */
  aiResult: 'OK' | Exclude<ConflictKind, 'PATIENT_DENIED'>;
  patientName: string;
  mobile: string;
  studyTitle: string;
  modality: string;
  file?: { name: string; size: number };
}

export interface IngestResult {
  zip: ZipPackage;
  caseRecord?: CaseRecord;
}

export interface MockTools {
  simulateIngest(input: IngestInput): Promise<IngestResult>;
  /** Runs the check on a case in PROCESSING now, instead of waiting for it. */
  runReview(caseId: string): Promise<void>;
  resetData(): Promise<void>;
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}
