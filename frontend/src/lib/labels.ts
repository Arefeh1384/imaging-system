import type { CaseStage, ConfirmKey, ConflictKind, DocKey, EventActor, StaffRole, UploadDocKey, ZipRow } from '../api/types';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export interface StatusLabel {
  label: string;
  tone: Tone;
}

export const DOC_LABELS: Record<DocKey, string> = {
  prescription: 'نسخه',
  report: 'گزارش رادیولوژیست',
  images: 'تصویر پزشکی',
};

export const UPLOAD_ORDER: UploadDocKey[] = ['prescription', 'report'];
/** The order in which the patient confirms things: first the service, then the prescription. */
export const CONFIRM_ORDER: ConfirmKey[] = ['service', 'prescription'];

export const CONFLICT_LABELS: Record<ConflictKind, string> = {
  PRESCRIPTION_STUDY: 'نسخه با تصویربرداری نمی‌خواند',
  PRESCRIPTION_NAME: 'نام روی نسخه',
  REPORT_IMAGES: 'گزارش با تصویر نمی‌خواند',
  PATIENT_DENIED: 'بیمار خدمت یا نسخه را رد کرد',
  IMAGE_PATIENT: 'تصویر به نام بیمار دیگری است',
};

export function stageLabel(stage: CaseStage): StatusLabel {
  switch (stage) {
    case 'WAITING_PATIENT':
      return { label: 'در انتظار بیمار', tone: 'warn' };
    case 'PROCESSING':
      return { label: 'در حال بررسی', tone: 'info' };
    case 'AT_INSURER':
      return { label: 'ارسال‌شده به بیمه', tone: 'ok' };
    case 'REJECTED_CONFLICT':
      return { label: 'رد: مغایرت اطلاعات', tone: 'bad' };
  }
}

export function zipStatusLabel(zip: Pick<ZipRow, 'status' | 'caseSummary'>): StatusLabel {
  switch (zip.status) {
    case 'REJECTED_INCOMPLETE':
      return { label: 'رد: مدارک ناقص', tone: 'bad' };
    case 'REJECTED_TOO_LARGE':
      return { label: 'رد: حجم بیش از حد', tone: 'bad' };
    case 'DUPLICATE':
      return { label: 'تکراری', tone: 'neutral' };
    default:
      return zip.caseSummary ? stageLabel(zip.caseSummary.stage) : { label: 'پذیرفته‌شده', tone: 'ok' };
  }
}

export const ACTOR_LABELS: Record<EventActor, string> = {
  PATIENT: 'بیمار',
  SYSTEM: 'سامانه',
  AI: 'هوش مصنوعی',
  INSURANCE_ADMIN: 'بیمه',
  ADMIN: 'مدیر کل',
};

export const actorTone = (actor: EventActor): Tone => {
  if (actor === 'PATIENT') return 'info';
  if (actor === 'AI') return 'ok';
  return 'neutral';
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  INSURANCE_ADMIN: 'پنل بیمه',
};

export const homeForRole = (_role: StaffRole): string => '/insurance/admin';
