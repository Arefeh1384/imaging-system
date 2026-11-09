// Documents shown open on the page, so the insurer reads them without clicking anything.
import { useState } from 'react';
import { isMockMode } from '../api/client';
import type { CaseRecord, DocKey, UploadDocKey } from '../api/types';
import { formatDate, toFaDigits } from '../lib/format';
import { DOC_LABELS } from '../lib/labels';
import { StudyGallery } from './StudyGallery';
import { Dialog, AiTag } from './ui';

function SamplePaper({ record, docKey }: { record: CaseRecord; docKey: UploadDocKey }) {
  const titles: Record<UploadDocKey, string> = { prescription: 'نسخه پزشک', report: 'گزارش رادیولوژی' };
  return (
    <article className="paper relative flex min-h-60 flex-1 flex-col gap-3 rounded-thumb border border-paper-line bg-paper p-4.5 text-paper-ink">
      <header className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-b-2 border-paper-ink pb-2">
        <strong>{titles[docKey]}</strong>
        <span>{record.hospitalName}</span>
      </header>
      <dl className="flex flex-col gap-1.5 text-[0.92rem] [&_dd]:font-semibold [&>div]:flex [&>div]:flex-wrap [&>div]:justify-between [&>div]:gap-x-3 [&>div]:gap-y-0.5 [&>div]:border-b [&>div]:border-dashed [&>div]:border-paper-line [&>div]:pb-1">
        <div>
          <dt>نام بیمار</dt>
          <dd>{record.patient.name}</dd>
        </div>
        <div>
          <dt>خدمت</dt>
          <dd>{record.study.title}</dd>
        </div>
        <div>
          <dt>تاریخ</dt>
          <dd>{formatDate(record.receivedAt)}</dd>
        </div>
      </dl>
      {docKey === 'prescription' ? <span className="mt-auto -rotate-12 self-end rounded-full border-2 border-[#2d5fa8] px-2.5 py-3.5 text-[0.75rem] text-[#2d5fa8]">مهر پزشک</span> : null}
      <span className="absolute start-3 bottom-2 text-[0.72rem] text-[#5a6a70]">نمونه</span>
    </article>
  );
}

function FileBody({ record, docKey, onZoom }: { record: CaseRecord; docKey: UploadDocKey; onZoom: (url: string) => void }) {
  const file = record.documents[docKey];
  if (!file) return <p className="text-muted text-small px-2 py-7 text-center">این مدرک هنوز نرسیده است.</p>;

  if (file.eRxId) return <ERxBody record={record} eRxId={file.eRxId} />;
  if (file.previewDataUrl) {
    return (
      <button type="button" className="block w-full cursor-zoom-in [&_img]:block [&_img]:max-h-105 [&_img]:w-full [&_img]:rounded-thumb [&_img]:bg-surface-2 [&_img]:object-contain" aria-label={`بزرگ‌نمایی ${DOC_LABELS[docKey]}`} onClick={() => onZoom(file.previewDataUrl as string)}>
        <img src={file.previewDataUrl} alt={DOC_LABELS[docKey]} />
      </button>
    );
  }
  if (file.reportText) {
    return (
      <article className="paper relative flex min-h-60 flex-1 flex-col gap-3 rounded-thumb border border-paper-line bg-paper p-4.5 text-paper-ink">
        <header className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-b-2 border-paper-ink pb-2">
          <strong>گزارش رادیولوژی</strong>
          <span>{file.reportDoctor}</span>
        </header>
        <p className="leading-loose">{file.reportText}</p>
      </article>
    );
  }
  if (isMockMode) return <SamplePaper record={record} docKey={docKey} />;
  return <p className="text-muted text-small px-2 py-7 text-center">{file.fileName}</p>;
}

/** An electronic prescription: the code the patient typed, and what the system fetched with it. */
function ERxBody({ record, eRxId }: { record: CaseRecord; eRxId: string }) {
  return (
    <article className="paper erx relative flex min-h-60 flex-1 flex-col gap-3 rounded-thumb border border-paper-line bg-paper p-4.5 text-paper-ink">
      <header className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-b-2 border-paper-ink pb-2">
        <strong>نسخه الکترونیک</strong>
        <bdi dir="ltr">{toFaDigits(eRxId)}</bdi>
      </header>
      {record.reviewedAt ? (
        <dl className="flex flex-col gap-1.5 text-[0.92rem] [&_dd]:font-semibold [&>div]:flex [&>div]:flex-wrap [&>div]:justify-between [&>div]:gap-x-3 [&>div]:gap-y-0.5 [&>div]:border-b [&>div]:border-dashed [&>div]:border-paper-line [&>div]:pb-1">
          <div>
            <dt>نام بیمار</dt>
            <dd>{record.patient.name}</dd>
          </div>
          <div>
            <dt>خدمت</dt>
            <dd>{record.study.title}</dd>
          </div>
          <div>
            <dt>دریافت از سامانه نسخه</dt>
            <dd>{formatDate(record.reviewedAt)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-small">بیمار شناسه را ثبت کرده است. نسخه هنگام بررسی پرونده از سامانه نسخه الکترونیک دریافت می‌شود.</p>
      )}
      {isMockMode ? <span className="absolute start-3 bottom-2 text-[0.72rem] text-[#5a6a70]">نمونه</span> : null}
    </article>
  );
}

export interface DocAlarm {
  target: DocKey;
  title: string;
  detail: string;
}

export function DocumentPanels({ record, keys, alarms, titles }: { record: CaseRecord; keys: DocKey[]; alarms: DocAlarm[]; titles?: Partial<Record<DocKey, string>> }) {
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
        {keys.map((key) => {
          const mine = alarms.filter((a) => a.target === key);
          const file = key === 'images' ? null : record.documents[key];
          const source = key === 'images' ? 'از مرکز درمانی' : file ? (file.source === 'PACS' ? 'از بیمارستان' : 'از بیمار') : '';
          return (
            <section key={key} id={`doc-${key}`} className={`doc-panel flex min-w-0 scroll-mt-[110px] flex-col gap-2.5 rounded-2xl bg-surface p-3.5 max-lg:scroll-mt-3 [&.is-flashing]:animate-flash-alarm motion-reduce:[&.is-flashing]:animate-none ${key === 'images' ? 'col-span-full' : 'nth-3:col-span-full nth-3:[&>article]:min-h-0'} ${mine.length ? 'has-alarm border-2 border-share-insurance' : 'border border-line max-lg:border-transparent'}`} aria-label={titles?.[key] ?? DOC_LABELS[key]}>
              <header className="flex items-baseline justify-between gap-2">
                <h3>{titles?.[key] ?? DOC_LABELS[key]}</h3>
                <span className="text-small text-muted">{source}</span>
              </header>
              {mine.map((alarm) => (
                <div key={alarm.title} className="flex flex-col rounded-control bg-warn-bg px-3 py-2 text-[0.88rem] text-warn-ink" role="note">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AiTag />
                    <strong>{alarm.title}</strong>
                  </div>
                  <span>{alarm.detail}</span>
                </div>
              ))}
              {key === 'images' ? <StudyGallery caseId={record.id} /> : <FileBody record={record} docKey={key} onZoom={setZoom} />}
            </section>
          );
        })}
      </div>
      <Dialog open={zoom !== null} title="بزرگ‌نمایی" onClose={() => setZoom(null)}>
        {zoom ? <img src={zoom} alt="" style={{ width: '100%' }} /> : null}
      </Dialog>
    </>
  );
}
