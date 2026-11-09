const number = new Intl.NumberFormat('fa-IR');
const dateFormat = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatNumber = (n: number) => number.format(n);

/** Money travels as rials and is displayed as Toman. */
export const rialToToman = (rial: number) => Math.round(rial / 10);
export const tomanToRial = (toman: number) => toman * 10;
export const formatToman = (rial: number) => number.format(rialToToman(rial));

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatShortDate = (iso: string) => shortDateFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

export function formatBytes(bytes: number): string {
  const gb = bytes / 1e9;
  if (gb >= 1) return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(gb)} گیگابایت`;
  const mb = bytes / 1e6;
  if (mb >= 1) return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(mb)} مگابایت`;
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(bytes / 1e3)} کیلوبایت`;
}

export const toFaDigits = (value: string | number) =>
  String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** Keeps codes with Latin letters, such as PL-5007, exactly as they are typed. */
export const displayValue = (value: string) => (/[A-Za-z]/.test(value) ? value : toFaDigits(value));

export function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** Reads a typed amount that may use Persian digits and thousands separators. */
export function parseWholeNumber(value: string): number | null {
  const clean = normalizeDigits(value).replace(/[,٬\s]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  return Number(clean);
}

export function maskMobile(mobile: string): string {
  return toFaDigits(`${mobile.slice(0, 4)} ••• ${mobile.slice(-4)}`);
}

/** How long ago, in the plain words a reviewer scans for. */
export function formatDaysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'امروز';
  if (days === 1) return 'دیروز';
  return `${number.format(days)} روز پیش`;
}
