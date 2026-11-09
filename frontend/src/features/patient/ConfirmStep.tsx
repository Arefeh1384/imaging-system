// The patient confirms, one question per screen: that they had this service, and that the prescription is theirs.
import { useState, type FormEvent } from 'react';
import { api, isPatientMock } from '../../api/client';
import type { ConfirmKey, PatientCase } from '../../api/types';
import { Button, Dialog, Notice } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { PATIENT_CARD, PATIENT_INPUT } from '../../components/classes';
import { FlowSteps, type StepsInfo } from './DocumentStep';

const PAPER = 'paper relative flex min-h-56 flex-col gap-3 rounded-thumb border border-paper-line bg-paper p-4.5 text-start text-paper-ink';
const PAPER_ROWS = 'flex flex-col gap-1.5 text-[0.92rem] [&_dd]:font-semibold [&>div]:flex [&>div]:flex-wrap [&>div]:justify-between [&>div]:gap-x-3 [&>div]:gap-y-0.5 [&>div]:border-b [&>div]:border-dashed [&>div]:border-paper-line [&>div]:pb-1';

/** The prescription that came in the ZIP, as the patient will recognise it. */
function HospitalPrescription({ c, patientName }: { c: PatientCase; patientName: string }) {
  const doc = c.documents.find((d) => d.key === 'prescription');
  if (doc?.previewDataUrl) return <img className="w-full rounded-thumb bg-surface-2 object-contain" src={doc.previewDataUrl} alt="نسخه" />;
  if (!isPatientMock) return <p className="rounded-card bg-surface-2 px-4 py-8 text-center wrap-anywhere [direction:ltr]">{doc?.fileName}</p>;
  return (
    <article className={PAPER}>
      <header className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-b-2 border-paper-ink pb-2">
        <strong>نسخه پزشک</strong>
        <span>{c.hospitalName}</span>
      </header>
      <dl className={PAPER_ROWS}>
        <div>
          <dt>نام بیمار</dt>
          <dd>{patientName}</dd>
        </div>
        <div>
          <dt>خدمت</dt>
          <dd>{c.studyTitle}</dd>
        </div>
      </dl>
      <span className="mt-auto -rotate-12 self-end rounded-full border-2 border-[#2d5fa8] px-2.5 py-3.5 text-[0.75rem] text-[#2d5fa8]">مهر پزشک</span>
      <span className="absolute start-3 bottom-2 text-[0.72rem] text-[#5a6a70]">نمونه</span>
    </article>
  );
}

/** The service as one plain sentence, so the patient can say whether it really happened. */
function ServiceQuestion({ c }: { c: PatientCase }) {
  return (
    <div className={`${PATIENT_CARD} service-card`}>
      <div className="flex flex-col gap-3 px-5 py-4.5 text-center">
        <p className="text-[1.15em] leading-[1.9]">
          آیا در تاریخ <strong>{formatDate(c.receivedAt)}</strong> برای <strong>{c.studyTitle}</strong> به <strong>{c.hospitalName}</strong> مراجعه کردید؟
        </p>
      </div>
    </div>
  );
}

const TEXT: Record<ConfirmKey, { title: string; yes: string; no: string; noTitle: string }> = {
  service: { title: 'این خدمت را گرفته‌اید؟', yes: 'بله، این خدمت را گرفته‌ام', no: 'نه، نگرفته‌ام', noTitle: 'این خدمت را نگرفته‌اید؟' },
  prescription: { title: 'این نسخه مال شماست؟', yes: 'بله، نسخه من است', no: 'نه، نسخه من نیست', noTitle: 'این نسخه مال شما نیست؟' },
};

export function ConfirmStep({ c, item, patientName, steps, onDone }: { c: PatientCase; item: ConfirmKey; patientName: string; steps: StepsInfo; onDone: (next: PatientCase) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = TEXT[item];

  const answer = async (yes: boolean) => {
    setBusy(yes ? 'yes' : 'no');
    setError(null);
    try {
      onDone(await api.confirmItem(c.id, item, yes));
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
      setAsking(false);
    }
  };

  return (
    <section className="confirm-step flex flex-col gap-4.5 short:gap-2.5">
      <FlowSteps {...steps} />
      <h1 className="text-center">{text.title}</h1>
      {item === 'service' ? <ServiceQuestion c={c} /> : <HospitalPrescription c={c} patientName={patientName} />}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="flex flex-col gap-3 short:flex-row short:[&>*]:flex-1">
        <Button size="patient" busy={busy === 'yes'} disabled={busy !== null} onClick={() => void answer(true)}>
          {text.yes}
        </Button>
        <Button variant="danger" size="patient" disabled={busy !== null} onClick={() => setAsking(true)}>
          {text.no}
        </Button>
      </div>
      <Dialog open={asking} title={text.noTitle} onClose={() => setAsking(false)}>
        <div className="patient flex flex-col gap-4 text-patient-body leading-[1.75]">
          <p>اگر مطمئن هستید، پرونده برای بیمه فرستاده نمی‌شود و باید با {c.hospitalName} تماس بگیرید تا اطلاعات درست را دوباره بفرستند.</p>
          <Button variant="dangerSolid" size="patient" busy={busy === 'no'} onClick={() => void answer(false)}>
            {text.no}
          </Button>
          <Button variant="secondary" size="patient" disabled={busy !== null} onClick={() => setAsking(false)}>
            برگشت
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

/** The prescription was not in the ZIP: an electronic one is a code, a paper one is a photo. */
export function PrescriptionChoice({ c, steps, onPaper, onDone }: { c: PatientCase; steps: StepsInfo; onPaper: () => void; onDone: (next: PatientCase) => void }) {
  const [electronic, setElectronic] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      setError('شناسه نسخه الکترونیک را بنویسید.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await api.submitERx(c.id, code));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (electronic) {
    return (
      <form className="erx-step flex flex-col gap-4.5" onSubmit={submit} noValidate>
        <FlowSteps {...steps} />
        <h1 className="text-center">شناسه نسخه الکترونیک</h1>
        <p className="text-center text-ink">شناسه یا کد رهگیری نسخه را از پیامکی که پزشک یا داروخانه برایتان فرستاده است بنویسید.</p>
        <div className="flex flex-col gap-1.5 [&_label]:font-medium">
          <label htmlFor="erx">شناسه نسخه</label>
          <input id="erx" className={`${PATIENT_INPUT} text-center tracking-[0.12em] tabular-nums`} dir="ltr" inputMode="numeric" autoComplete="off" value={code} aria-invalid={!!error} onChange={(e) => setCode(e.target.value)} />
          {error ? (
            <div className="font-medium text-bad-ink" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <Button type="submit" size="patient" busy={busy}>
          ثبت شناسه
        </Button>
        <Button variant="secondary" size="patient" onClick={() => setElectronic(false)}>
          برگشت
        </Button>
      </form>
    );
  }

  return (
    <section className="rx-choice flex flex-col gap-4.5">
      <FlowSteps {...steps} />
      <h1 className="text-center">نسخه شما</h1>
      <p className="text-center text-ink">نسخه این تصویربرداری از بیمارستان به دست ما نرسیده است. نسخه شما کدام است؟</p>
      <Button size="patient" onClick={() => setElectronic(true)}>
        نسخه الکترونیک دارم
      </Button>
      <Button variant="secondary" size="patient" onClick={onPaper}>
        نسخه کاغذی دارم، عکس می‌گیرم
      </Button>
    </section>
  );
}
