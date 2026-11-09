import { useState } from 'react';
import { api } from '../../api/client';
import type { ZipRow } from '../../api/types';
import { buttonClass, LINK_BUTTON } from '../../components/ui';

/** A package is known by whose it is, not by the PACS file name. */
export function zipTitle(zip: Pick<ZipRow, 'patientName'>): string {
  return zip.patientName ?? 'بیمار نامشخص';
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

/** Downloads the ZIP. The saved file keeps its original name, which is no longer shown on screen. */
export function ZipDownload({ zip, compact }: { zip: Pick<ZipRow, 'id' | 'fileName' | 'patientName'>; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.downloadZip(zip.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = zip.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        className={`zip-download ${compact ? `${LINK_BUTTON} inline-flex items-center gap-1 pointer-coarse:min-h-touch-target` : buttonClass('secondary')}`}
        aria-label={`دانلود فایل ZIP ${zipTitle(zip)}`}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void save()}
      >
        <DownloadIcon />
        {busy ? 'در حال آماده‌سازی…' : compact ? 'دانلود' : 'دانلود فایل ZIP'}
      </button>
      {error ? (
        <span className="text-small text-bad-ink" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
