// Case views shared by the insurance panel and the main admin panel.
import { useState } from 'react';
import type { AiOpinion, CaseRecord, DocKey, InsuranceShare } from '../api/types';
import { formatDateTime, formatNumber, toFaDigits } from '../lib/format';
import { DOC_LABELS } from '../lib/labels';
import { StudyGallery } from './StudyGallery';
import { chipClass, noticeClass, Dialog, Money, AiTag } from './ui';
import { LIST_ROW } from './classes';

function DocumentBody({ record, doc }: { record: CaseRecord; doc: DocKey }) {
  if (doc === 'images') return <StudyGallery caseId={record.id} />;
  const file = record.documents[doc];
  if (!file) return <p className="text-muted">این مدرک هنوز بارگذاری نشده است.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-small text-muted">
        {file.source === 'PACS' ? 'رسیده از PACS' : 'بارگذاری توسط بیمار'}، {formatDateTime(file.addedAt)}
      </div>
      {file.eRxId ? <p>نسخه الکترونیک، شناسه <bdi dir="ltr">{toFaDigits(file.eRxId)}</bdi>{record.reviewedAt ? '، دریافت‌شده از سامانه نسخه' : '، هنوز دریافت نشده'}</p> : null}
      {file.reportText ? (
        <div className="flex flex-col gap-2">
          <div className="text-small text-muted">امضاشده توسط {file.reportDoctor}</div>
          <p>{file.reportText}</p>
        </div>
      ) : null}
      {file.previewDataUrl ? <img src={file.previewDataUrl} alt={DOC_LABELS[doc]} /> : null}
      {!file.reportText && !file.previewDataUrl && !file.eRxId ? <p className="text-muted">پیش‌نمایش این فایل پس از اتصال به سرور نمایش داده می‌شود.</p> : null}
    </div>
  );
}

/** How the prescription got here, and whether the patient confirmed it. */
function confirmation(record: CaseRecord, key: DocKey): string | null {
  if (key !== 'prescription') return null;
  const doc = record.documents.prescription;
  if (doc?.eRxId) return `نسخه الکترونیک، شناسه ${toFaDigits(doc.eRxId)}`;
  if (!record.confirmItems.includes('prescription')) return null;
  if (record.confirmedItems.includes('prescription')) return 'تأیید بیمار';
  if (record.conflict?.kind === 'PATIENT_DENIED' && record.confirmedItems.includes('service')) return 'بیمار گفت نسخه مال او نیست';
  return 'منتظر تأیید بیمار';
}

export function CaseDocuments({ record, keys }: { record: CaseRecord; keys: DocKey[] }) {
  const [open, setOpen] = useState<DocKey | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2.5 [&>*]:flex-[1_1_190px]">
        {keys.map((key) => {
          const file = key === 'images' ? null : record.documents[key];
          const meta = key === 'images' ? `${record.study.title}، ${formatNumber(record.study.imageCount)} تصویر` : file ? (file.source === 'PACS' ? 'رسیده از PACS' : 'از بیمار') : 'بارگذاری نشده';
          const confirmed = confirmation(record, key);
          return (
            <button key={key} type="button" className={`flex min-h-22 flex-col gap-0.5 rounded-card border px-3.5 py-3 text-start hover:border-line-strong ${key === 'images' ? 'doc-card-viewer border-viewer bg-viewer text-viewer-ink [&_.text-muted]:text-viewer-ink' : 'border-line bg-surface'}`} onClick={() => setOpen(key)}>
              <span className="font-bold">{DOC_LABELS[key]}</span>
              <span className="text-small text-muted">{meta}</span>
              {confirmed ? <span className="text-small text-muted">{confirmed}</span> : null}
            </button>
          );
        })}
      </div>
      <Dialog open={open !== null} title={open ? DOC_LABELS[open] : ''} onClose={() => setOpen(null)}>
        {open ? <DocumentBody record={record} doc={open} /> : null}
      </Dialog>
    </>
  );
}

export function AiOpinionCard({ opinion }: { opinion?: AiOpinion }) {
  if (!opinion) return <p className="text-muted text-small">هوش مصنوعی هنوز این پرونده را بررسی نکرده است. بررسی بعد از ارسال بیمار انجام می‌شود.</p>;
  const conflict = opinion.result === 'CONFLICT';
  return (
    <div className="flex flex-col gap-2">
      <div className={`${noticeClass(conflict ? 'bad' : 'ok')} flex flex-wrap items-center gap-2`}>
        <AiTag />
        {opinion.summary}
      </div>
      <div className="overflow-hidden rounded-card border border-line">
        {opinion.findings.map((f) => (
          <div className={LIST_ROW} key={f.title}>
            <div className="list-main min-w-0 flex-[1_1_240px]">
              <div className="font-bold text-small">{f.title}</div>
              <div className="text-small text-muted">{f.detail}</div>
            </div>
            <span className={chipClass(f.result === 'PASS' ? 'ok' : 'bad')}>{f.result === 'PASS' ? 'هم‌خوان' : 'مغایرت'}</span>
          </div>
        ))}
      </div>
      <p className="text-small text-muted">{opinion.modelVersion}، {formatDateTime(opinion.createdAt)}</p>
    </div>
  );
}

/** What the insurance pays, as the AI worked it out from the price list. */
export function InsuranceShareCard({ share }: { share: InsuranceShare }) {
  return (
    <div className="ai-share flex flex-col gap-1 rounded-card bg-nav-bg bg-[repeating-radial-gradient(circle_at_0%_100%,transparent_0_30px,rgb(120_150_255/14%)_30px_31px)] px-5.5 py-4 text-nav-ink">
      <span className="flex flex-wrap items-center gap-2 text-small text-nav-muted">
        <AiTag />
        سهم بیمه
      </span>
      <strong className="ai-share-value text-[1.7rem] leading-[1.5] font-bold whitespace-nowrap tabular-nums">
        <Money rial={share.insurerShareRial} />
      </strong>
      <span className="text-small text-nav-muted">
        تعرفه {share.tariffTitle}، {share.tariffVersion}
      </span>
    </div>
  );
}
