import { normalizeDigits } from './format';

export function isValidMobile(value: string): boolean {
  return /^09\d{9}$/.test(normalizeDigits(value).trim());
}

/** Iranian national ID: 10 digits with a control digit. */
export function isValidNationalId(value: string): boolean {
  const id = normalizeDigits(value).trim();
  if (!/^\d{10}$/.test(id) || /^(\d)\1{9}$/.test(id)) return false;
  const sum = id
    .slice(0, 9)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const remainder = sum % 11;
  const control = Number(id[9]);
  return remainder < 2 ? control === remainder : control === 11 - remainder;
}

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export function documentFileError(file: File): string | null {
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') return 'فقط عکس یا فایل PDF قابل بارگذاری است.';
  if (file.type === 'application/pdf' && file.size > DOCUMENT_MAX_BYTES) return 'حجم فایل باید حداکثر ۱۰ مگابایت باشد.';
  return null;
}

export const ZIP_MAX_BYTES = 2_000_000_000;
