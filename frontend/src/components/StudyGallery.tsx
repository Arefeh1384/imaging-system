// The 4 or 5 PNG pictures the backend makes from the DICOM study. Click one to see it large.
import { useState } from 'react';
import { api } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Dialog, LoadState } from './ui';

/**
 * Keeps the grid even. With five pictures the first one is shown large beside the other four,
 * so no picture is left alone on the last row, on a phone or on a wide screen.
 */
export function galleryLayout(count: number) {
  const grid = count === 4 || count === 5 ? 'grid grid-cols-2 gap-2.5 @min-[460px]:grid-cols-4' : 'grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5';
  const item = (index: number) => (count === 5 && index === 0 ? 'col-span-2 @min-[460px]:row-span-2' : '');
  return { grid, item };
}

export function StudyGallery({ caseId }: { caseId: string }) {
  const images = useAsync(() => api.getStudyImages(caseId), [caseId]);
  const [open, setOpen] = useState<number | null>(null);
  if (!images.data) return <LoadState loading={images.loading} error={images.error} onRetry={() => void images.reload()} />;
  const list = images.data;
  if (list.length === 0) return <p className="text-small text-muted">تصویری ساخته نشده است.</p>;
  const current = open !== null ? list[open] : null;
  const layout = galleryLayout(list.length);
  return (
    <>
      <div className="@container max-w-[720px]">
        <div className={`study-gallery ${layout.grid}`}>
          {list.map((image, index) => (
            <button key={image.id} type="button" className={`group flex flex-col overflow-hidden rounded-thumb bg-viewer text-viewer-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${layout.item(index)}`} aria-label={`بزرگ‌نمایی ${image.label}`} onClick={() => setOpen(index)}>
              <img className="block min-h-0 w-full flex-1 object-contain transition-opacity group-hover:opacity-85 [aspect-ratio:1]" src={image.url} alt={image.label} />
              <span className="px-2 py-1 text-caption">{image.label}</span>
            </button>
          ))}
        </div>
      </div>
      <Dialog open={current !== null} title={current?.label ?? ''} onClose={() => setOpen(null)}>
        {current && open !== null ? (
          <div className="flex flex-col gap-3">
            <img className="w-full rounded-thumb bg-viewer" src={current.url} alt={current.label} />
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="min-h-10 rounded-control bg-surface-2 px-4 font-semibold disabled:opacity-40" disabled={open === 0} onClick={() => setOpen(open - 1)}>
                قبلی
              </button>
              <span className="text-small text-muted tabular-nums">
                {open + 1} / {list.length}
              </span>
              <button type="button" className="min-h-10 rounded-control bg-surface-2 px-4 font-semibold disabled:opacity-40" disabled={open === list.length - 1} onClick={() => setOpen(open + 1)}>
                بعدی
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
