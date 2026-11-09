import { useState } from 'react';
import { api, mockTools } from '../../api/client';
import type { CaseRecord, UploadDocKey, ZipDetail } from '../../api/types';
import { AiOpinionCard, CaseDocuments, InsuranceShareCard } from '../../components/case';
import { chipClass, Button, Chip, Crumbs, Dialog, LoadState, Money, Notice, SplitBar } from '../../components/ui';
import { displayValue, formatDateTime, toFaDigits } from '../../lib/format';
import { ACTOR_LABELS, actorTone, DOC_LABELS, stageLabel, zipStatusLabel } from '../../lib/labels';
import { useNavigate, useParams } from '../../lib/router';
import { useAsync } from '../../lib/useAsync';
import { SplitForm } from './FinancePages';
import { ZipDownload, zipTitle } from './zipParts';
import { CARD, LIST_ROW } from '../../components/classes';

export function ZipDetailPage() {
  const { zipId } = useParams();
  const { data, loading, error, reload, setData } = useAsync(() => api.getZip(zipId), [zipId], 3000);
  if (!data) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;
  const { zip, hospital, company, caseRecord } = data;

  return (
    <>
      <Crumbs
        items={[
          { label: 'همه شرکت‌ها', to: '/admin' },
          { label: company.name, to: `/admin/companies/${company.id}` },
          { label: hospital.name, to: `/admin/hospitals/${hospital.id}` },
          { label: zipTitle(zip) },
        ]}
      />
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="zip-title">{zipTitle(zip)}</h1>
          <div className="text-muted">
            {hospital.name}، {formatDateTime(zip.receivedAt)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Chip status={zipStatusLabel(zip)} />
            <span className="text-small text-muted">{zip.studyTitle}</span>
          </div>
        </div>
        <ZipDownload zip={zip} />
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[999_1_520px] flex flex-col gap-4">
          {zip.rejectReason ? (
            <section className={`${CARD} flex flex-col gap-2`}>
              <h2>رسید و خطای بسته</h2>
              <Notice tone={zip.status === 'DUPLICATE' ? 'neutral' : 'bad'}>{zip.rejectReason}</Notice>
              <div className="text-small text-muted">
                کد خطا: <span className="font-mono text-code [direction:ltr] [unicode-bidi:isolate]">{zip.rejectCode}</span>
              </div>
              <p className="text-small text-muted">برای این بسته پرونده، پیامک و کارمزدی ایجاد نشده و فقط همین رسید نگه داشته می‌شود.</p>
            </section>
          ) : null}
          {caseRecord ? <CaseSections record={caseRecord} missing={zip.missingAtIntake} onChange={setData} /> : null}
        </div>
        <aside className="split-side min-w-0 flex-[1_1_300px] flex flex-col gap-4">
          {caseRecord ? <OutcomeCard record={caseRecord} /> : null}
          <FeeCard detail={data} onChange={setData} />
        </aside>
      </div>
    </>
  );
}

/** The check runs on its own later. Sample mode can run it at once. */
function ReviewNow({ caseId }: { caseId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="text-small text-muted">بیمار تأیید کرده است. نسخه دریافت و با تصویر مقایسه می‌شود و نتیجه برای بیمار پیامک می‌شود.</p>
      {mockTools ? (
        <Button
          variant="secondary"
          busy={busy}
          onClick={() => {
            setBusy(true);
            void mockTools?.runReview(caseId).then(() => window.location.reload());
          }}
        >
          انجام بررسی الان (حالت نمونه)
        </Button>
      ) : null}
    </>
  );
}

/** Where the case ended up: with the insurer and its share, or rejected and why. Shown first because it is what the main admin looks for. */
function OutcomeCard({ record }: { record: CaseRecord }) {
  return (
    <section className={`${CARD} flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>نتیجه پرونده</h2>
        <Chip status={stageLabel(record.stage)} />
      </div>
      <div className="flex justify-between gap-2 text-small">
        <span className="text-muted">تأیید خدمت توسط بیمار</span>
        <span>{record.confirmedItems.includes('service') ? 'بله' : record.conflict?.kind === 'PATIENT_DENIED' ? 'نه، خدمت را رد کرد' : 'هنوز نه'}</span>
      </div>
      {record.insuranceShare ? <InsuranceShareCard share={record.insuranceShare} /> : null}
      {record.conflict ? (
        <>
          <Notice tone="bad">{record.conflict.reason}</Notice>
          <div className="text-small text-muted">
            {record.conflict.by === 'AI' ? 'هوش مصنوعی' : 'بیمار'} در {formatDateTime(record.conflict.at)} مغایرت را ثبت کرد. پیامک تماس با مرکز درمانی برای بیمار ارسال شد.
          </div>
        </>
      ) : null}
      {record.stage === 'WAITING_PATIENT' ? <p className="text-small text-muted">بیمار هنوز پرونده را تأیید نکرده است.</p> : null}
      {record.stage === 'PROCESSING' ? <ReviewNow caseId={record.id} /> : null}
    </section>
  );
}

function FeeCard({ detail, onChange }: { detail: ZipDetail; onChange: (d: ZipDetail) => void }) {
  const { zip, hospital } = detail;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (zip.status !== 'READY') {
    return (
      <section className={`${CARD} flex flex-col gap-2`}>
        <h2>سهم کارمزد این ZIP</h2>
        <p className="text-muted">این فایل به‌عنوان پرونده جدید پذیرفته نشده و کارمزد ندارد.</p>
      </section>
    );
  }

  const rule = hospital.feeRule;
  const settle = async () => {
    setBusy(true);
    onChange(await api.settleZip(zip.id));
    setBusy(false);
    setConfirming(false);
  };

  return (
    <section className={`${CARD} flex flex-col gap-2`}>
      <h2>سهم کارمزد این ZIP</h2>
      <div className="flex flex-wrap items-center gap-2 justify-between text-small">
        <span className="text-muted">کارمزد خدمت</span>
        <strong>
          <Money rial={zip.feeRial} />
        </strong>
      </div>
      <SplitBar split={zip.split} />
      <SplitForm
        key={`${zip.id}-${zip.settled}`}
        idPrefix="split"
        locked={zip.settled}
        initial={{ feeRial: zip.feeRial, ...zip.split }}
        saveLabel="ذخیره سهم‌ها"
        onSave={async (next) => {
          onChange(await api.updateZipSplit(zip.id, { hospitalRial: next.hospitalRial, insuranceRial: next.insuranceRial, managementRial: next.managementRial }));
        }}
        extraActions={(setValues) =>
          rule.feeRial === zip.feeRial ? (
            <Button variant="secondary" onClick={() => setValues(rule)}>
              قاعده پیش‌فرض
            </Button>
          ) : null
        }
      />
      {zip.settled ? (
        <Notice tone="neutral">{`تسویه در ${formatDateTime(zip.settledAt ?? zip.receivedAt)} ثبت شده و سهم‌ها قفل است. اصلاح فقط با سند معکوس انجام می‌شود.`}</Notice>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          ثبت تسویه
        </Button>
      )}
      <Dialog open={confirming} title="ثبت تسویه این ZIP" onClose={() => setConfirming(false)}>
        <div className="flex flex-col gap-4">
          <p>پس از ثبت تسویه، سهم‌های این فایل قفل می‌شود و دیگر قابل ویرایش نیست.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button busy={busy} onClick={() => void settle()}>
              ثبت تسویه
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

function CaseSections({ record, missing, onChange }: { record: CaseRecord; missing: UploadDocKey[]; onChange: (d: ZipDetail) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    setBusy(true);
    onChange(await api.resendInvite(record.id));
    setBusy(false);
  };

  return (
    <>
      <section className={`${CARD} flex flex-col gap-2`}>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <h2>پرونده بیمار: {record.patient.name}</h2>
          <Chip status={stageLabel(record.stage)} />
        </div>
        <div className="text-small text-muted">
          کد ملی {toFaDigits(record.patient.nationalId)}، موبایل {toFaDigits(record.patient.mobile)}، تاریخ تولد {toFaDigits(record.patient.birthDate)}
        </div>
        {record.patient.insurance ? (
          <div className="text-small text-muted">
            {record.patient.insurance.insurer}، بیمه‌نامه <bdi dir="ltr">{displayValue(record.patient.insurance.policyNumber)}</bdi>، نسبت: {record.patient.insurance.relation}
          </div>
        ) : (
          <div className="text-small text-muted">بیمار هنوز اطلاعات بیمه را ثبت نکرده است.</div>
        )}
        {missing.length > 0 ? <Notice tone="neutral">این مدارک در ZIP نبود و بیمار باید بارگذاری کند: {missing.map((k) => DOC_LABELS[k]).join('، ')}</Notice> : null}
        <CaseDocuments record={record} keys={['prescription', 'report', 'images']} />
      </section>

      <section className={`${CARD} flex flex-col gap-2`}>
        <h2>بررسی هوش مصنوعی</h2>
        <AiOpinionCard opinion={record.aiOpinion} />
      </section>

      <section className={`${CARD} flex flex-col gap-2`}>
        <h2>رویدادهای پرونده</h2>
        <div className="overflow-hidden rounded-card border border-line">
          {[...record.events].reverse().map((event) => (
            <div key={event.id} className={LIST_ROW}>
              <div className="list-main min-w-0 flex-[1_1_240px]">
                <div className="font-bold text-small">{event.title}</div>
                <div className="text-small text-muted">{formatDateTime(event.at)}</div>
              </div>
              <span className={chipClass(actorTone(event.actor))}>{ACTOR_LABELS[event.actor]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={`${CARD} flex flex-col gap-2`}>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <h2>پیامک‌ها</h2>
          {record.stage === 'WAITING_PATIENT' ? (
            <Button variant="secondary" busy={busy} onClick={() => void resend()}>
              ارسال یادآوری
            </Button>
          ) : null}
        </div>
        {record.sms.map((sms) => (
          <div key={sms.id} className="flex flex-col gap-2">
            <div className="text-small text-muted">
              {sms.kind === 'INVITE' ? 'دعوت' : sms.kind === 'REMINDER' ? 'یادآوری' : sms.kind === 'SENT' ? 'ارسال به بیمه' : 'مغایرت: تماس با مرکز درمانی'}، {formatDateTime(sms.sentAt)}، {sms.delivery === 'DELIVERED' ? 'تحویل شد' : 'ارسال شد'}
            </div>
            <div className="sms-bubble rounded-card bg-surface-2 px-3.5 py-2.5 wrap-anywhere text-small">{sms.text}</div>
          </div>
        ))}
      </section>

      {mockTools ? (
        <section className={`${CARD} flex flex-col gap-2`}>
          <h2>ابزار حالت نمونه</h2>
          <p className="text-small text-muted">این بخش جای رویدادهایی است که بعداً از پیامک و مرکز درمانی می‌آید و با اتصال سرور حذف می‌شود.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => navigate(`/c/${record.inviteToken}`)}>
              باز کردن پیوند پیامک بیمار
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
