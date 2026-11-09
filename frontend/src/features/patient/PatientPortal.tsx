import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, isPatientMock } from '../../api/client';
import type { PatientCase, PatientProfile, UploadDocKey } from '../../api/types';
import { AppShell, type NavItem } from '../../components/AppShell';
import { buttonClass, LINK_BUTTON, Button, Chip, LoadState, Notice, ViewAsBanner } from '../../components/ui';
import { displayValue, formatDate, formatNumber, normalizeDigits, toFaDigits } from '../../lib/format';
import { type StatusLabel } from '../../lib/labels';
import { INSURERS, RELATIONS } from '../../lib/options';
import { Link, Redirect, useNavigate, useParams } from '../../lib/router';
import { clearPatientSession, getPatientSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { DocumentStep, FlowSteps } from './DocumentStep';
import { ConfirmStep, PrescriptionChoice } from './ConfirmStep';
import { PATIENT_CARD, PATIENT_INPUT, PATIENT_ROW } from '../../components/classes';

function ReadOnlyRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className={PATIENT_ROW}>
      <span className="text-[0.92em] text-muted">{label}</span>
      <strong dir={ltr ? 'ltr' : undefined}>{value}</strong>
    </div>
  );
}

function PacsDetails({ profile }: { profile: PatientProfile }) {
  return (
    <div className={PATIENT_CARD}>
      <ReadOnlyRow label="نام" value={profile.name} />
      <ReadOnlyRow label="کد ملی" value={toFaDigits(profile.nationalId)} ltr />
      <ReadOnlyRow label="موبایل" value={toFaDigits(profile.mobile)} ltr />
      <ReadOnlyRow label="تاریخ تولد" value={toFaDigits(profile.birthDate)} ltr />
    </div>
  );
}

/** Shown once, on the first visit. Hospital data is only displayed; the patient adds the rest. */
function FirstInfoDialog({ onDone }: { profile: PatientProfile; onDone: (p: PatientProfile) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [insurer, setInsurer] = useState(INSURERS[0]);
  const [policyNumber, setPolicyNumber] = useState('');
  const [relation, setRelation] = useState(RELATIONS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ref.current && !ref.current.open) {
      ref.current.showModal();
      ref.current.querySelector('h1')?.focus();
    }
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!normalizeDigits(policyNumber).trim()) {
      setError('شماره بیمه‌نامه را بنویسید.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await api.saveFirstInfo({ insurer, policyNumber, relation }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="patient max-h-[calc(100dvh-16px)] w-[min(520px,calc(100vw-16px))] rounded-card border border-line bg-surface text-patient-body leading-[1.75] text-ink open:flex open:flex-col open:overflow-hidden max-sm:mx-0 max-sm:mt-auto max-sm:mb-0 max-sm:max-h-[94dvh] max-sm:w-full max-sm:max-w-full max-sm:animate-sheet-up max-sm:rounded-b-none max-sm:border-0 motion-reduce:animate-none" aria-labelledby="first-info-title" onCancel={(e) => e.preventDefault()}>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} noValidate>
        <div className="flex flex-col gap-4.5 min-h-0 flex-1 overflow-y-auto p-5 [&_h1:focus]:outline-none">
        <h1 id="first-info-title" tabIndex={-1}>
          خوش آمدید
        </h1>
        <p className="text-ink">برای اولین ورود، لطفاً اطلاعات بیمه خود را بنویسید:</p>
        <div className="flex flex-col gap-1.5 [&_label]:font-medium">
          <label htmlFor="insurer">شرکت بیمه</label>
          <select id="insurer" className={PATIENT_INPUT} value={insurer} onChange={(e) => setInsurer(e.target.value)}>
            {INSURERS.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 [&_label]:font-medium">
          <label htmlFor="policyNumber">شماره بیمه‌نامه</label>
          <input id="policyNumber" className={PATIENT_INPUT} dir="ltr" value={policyNumber} aria-invalid={!!error} onChange={(e) => setPolicyNumber(e.target.value)} />
          {error ? (
            <div className="font-medium text-bad-ink" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5 [&_label]:font-medium">
          <label htmlFor="relation">نسبت شما با بیمه‌شده</label>
          <select id="relation" className={PATIENT_INPUT} value={relation} onChange={(e) => setRelation(e.target.value)}>
            {RELATIONS.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        </div>
        <div className="border-t border-line bg-surface px-5 pt-3 pb-[calc(14px+env(safe-area-inset-bottom,0px))] [&_button]:w-full">
          <Button type="submit" size="patient" busy={busy}>
            ثبت و ادامه
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/** The signed-in patient's name, for documents shown back to them. */
function PatientName({ children }: { children: (name: string) => ReactNode }) {
  const profile = useAsync(() => api.getMyProfile(), []);
  return <>{children(profile.data?.name ?? '')}</>;
}

function PatientLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const session = getPatientSession();
  const profile = useAsync(() => (session ? api.getMyProfile() : Promise.resolve(null)), [session?.patientId]);

  if (!session) return <Redirect to="/portal/login" />;
  const me = profile.data;
  return (
    <AppShell
      subtitle="پورتال بیمار"
      homeTo="/portal"
      sample={isPatientMock}
      userName={me?.name ?? ''}
      userRole="بیمار"
      nav={PATIENT_NAV}
      onLogout={() => {
        clearPatientSession();
        navigate('/portal/login', { replace: true });
      }}
      banner={session.viewAs && me ? <ViewAsBanner name={me.name} onExit={clearPatientSession} /> : null}
      className="patient text-patient-body leading-[1.75]"
    >
      {me ? children : <LoadState loading={profile.loading} error={profile.error} />}
      {me?.needsFirstInfo ? <FirstInfoDialog profile={me} onDone={(p) => profile.setData(p)} /> : null}
    </AppShell>
  );
}

const PATIENT_NAV: NavItem[] = [
  { to: '/portal', label: 'پرونده‌های من', icon: 'folder', match: (path) => path === '/portal' || path.startsWith('/portal/cases') },
  { to: '/portal/profile', label: 'پروفایل', icon: 'user' },
];

function patientStatus(c: PatientCase): StatusLabel {
  switch (c.stage) {
    case 'AT_INSURER':
      return { label: 'ارسال‌شده به بیمه', tone: 'ok' };
    case 'PROCESSING':
      return { label: 'در حال بررسی، نتیجه پیامک می‌شود', tone: 'info' };
    case 'REJECTED_CONFLICT':
      return { label: 'مغایرت: با مرکز تماس بگیرید', tone: 'bad' };
    default:
      return { label: 'منتظر شما', tone: 'warn' };
  }
}

/** Three plain steps, so a patient can tell where a case is at a glance. */
function CaseProgress({ c, onDark }: { c: PatientCase; onDark?: boolean }) {
  const reached = c.stage === 'AT_INSURER' ? 3 : c.stage === 'REJECTED_CONFLICT' || c.stage === 'PROCESSING' ? 2 : 1;
  const steps = ['تکمیل مدارک', 'بررسی مدارک', 'ارسال به بیمه'];
  return (
    <ol className={`mt-1.5 mb-0.5 flex text-[0.72em] ${onDark ? 'text-nav-muted' : 'text-muted'}`} aria-label="مراحل پرونده">
      {steps.map((step, index) => {
        const on = index < reached;
        return (
          <li key={step} className={`flex flex-1 flex-col gap-1.5 ${on ? `font-semibold ${onDark ? 'text-nav-ink' : 'text-ink'}` : ''}`} aria-current={index === reached - 1 ? 'step' : undefined}>
            <span className={`me-1 h-1.5 rounded-pill ${on ? 'bg-accent' : 'bg-surface-2'}`} aria-hidden="true" />
            {step}
          </li>
        );
      })}
    </ol>
  );
}

export function CaseListPage() {
  return (
    <PatientLayout>
      <CaseList />
    </PatientLayout>
  );
}

function CaseList() {
  const { data, loading, error, reload } = useAsync(() => api.listMyCases(), [], 4000);
  if (!data) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;
  if (data.length === 0) {
    return (
      <div className="flex flex-col gap-4.5 mx-auto w-full max-w-[620px] text-center">
        <h1>پرونده‌ای پیدا نشد</h1>
        <p className="text-ink">وقتی مدارک شما آماده شود، پیامک می‌گیرید.</p>
      </div>
    );
  }
  const needsAction = (c: PatientCase) => c.stage === 'WAITING_PATIENT';
  const ordered = [...data].sort((a, b) => Number(needsAction(b)) - Number(needsAction(a)));
  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-4.5">
      <div className="text-center">
        <h1>پرونده‌های من</h1>
        <p className="text-muted">{formatNumber(data.length)} پرونده</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,380px),1fr))] gap-3.5">
        {ordered.map((c) => (
          <Link key={c.id} to={`/portal/cases/${c.id}`} className={`case-card flex flex-col gap-2.5 rounded-card px-6 py-5.5 no-underline ${needsAction(c) ? 'bg-nav-bg bg-[repeating-radial-gradient(circle_at_0%_50%,transparent_0_40px,rgb(120_150_255/14%)_40px_41px)] text-nav-ink outline-2 outline-accent [&_.text-muted]:text-nav-muted' : 'border border-line bg-surface text-inherit hover:border-[#c8cdd8] max-lg:border-transparent'}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 leading-[1.5]">
              <strong>{c.studyTitle}</strong>
              <Chip status={patientStatus(c)} />
            </div>
            <span className="text-[0.92em] text-muted">
              {c.hospitalName}، {formatDate(c.receivedAt)}
            </span>
            <CaseProgress c={c} onDark={needsAction(c)} />
            {needsAction(c) ? <span className={`${buttonClass('primary', 'patient')} text-[1em]`}>ادامه تکمیل مدارک</span> : <span className="font-bold text-accent">دیدن پرونده</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ProfilePage() {
  return (
    <PatientLayout>
      <Profile />
    </PatientLayout>
  );
}

function Profile() {
  const { data: me, loading, error, reload, setData } = useAsync(() => api.getMyProfile(), []);
  const [editing, setEditing] = useState(false);
  const [policyNumber, setPolicyNumber] = useState('');
  const [relation, setRelation] = useState(RELATIONS[0]);
  const [insurer, setInsurer] = useState(INSURERS[0]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!me) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;

  const startEdit = () => {
    setPolicyNumber(me.insurance?.policyNumber ?? '');
    setRelation(me.insurance?.relation ?? RELATIONS[0]);
    setInsurer(me.insurance?.insurer ?? INSURERS[0]);
    setFormError(null);
    setSaved(false);
    setEditing(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!policyNumber.trim()) {
      setFormError('شماره بیمه‌نامه را بنویسید.');
      return;
    }
    setBusy(true);
    try {
      setData(await api.saveFirstInfo({ insurer, policyNumber, relation }));
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4.5 mx-auto w-full max-w-[620px]">
      <div className="relative flex items-center gap-4 overflow-hidden rounded-card bg-nav-bg p-5.5 text-nav-ink">
        <span className="pointer-events-none absolute -end-60 -top-60 size-[560px] rounded-full bg-[repeating-radial-gradient(circle,transparent_0_38px,var(--color-nav-active)_38px_40px)] opacity-80" aria-hidden="true" />
        <span className="relative inline-flex size-18 flex-none items-center justify-center rounded-full bg-surface text-[1.8rem] font-bold text-accent" aria-hidden="true">
          {me.name.slice(0, 1)}
        </span>
        <div>
          <h1>{me.name}</h1>
          <div dir="ltr" className="relative text-end text-nav-muted">
            {toFaDigits(me.mobile)}
          </div>
        </div>
      </div>
      <section className="flex flex-col gap-2.5">
        <h2>اطلاعات شما</h2>
        <PacsDetails profile={me} />
        <p className="text-[0.92em] text-muted">این اطلاعات از بیمارستان رسیده است. اگر اشتباه است، به مرکز درمانی خبر دهید.</p>
      </section>
      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <h2>اطلاعات بیمه</h2>
          {!editing ? (
            <button type="button" className={LINK_BUTTON} onClick={startEdit}>
              ویرایش
            </button>
          ) : null}
        </div>
        {saved ? <Notice tone="ok">اطلاعات بیمه ذخیره شد.</Notice> : null}
        {editing ? (
          <form className={`${PATIENT_CARD} flex flex-col gap-3.5 py-4`} onSubmit={save} noValidate>
            <div className="flex flex-col gap-1.5 [&_label]:font-medium">
              <label htmlFor="profileInsurer">شرکت بیمه</label>
              <select id="profileInsurer" className={PATIENT_INPUT} value={insurer} onChange={(e) => setInsurer(e.target.value)}>
                {INSURERS.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 [&_label]:font-medium">
              <label htmlFor="profilePolicy">شماره بیمه‌نامه</label>
              <input id="profilePolicy" className={PATIENT_INPUT} dir="ltr" value={policyNumber} aria-invalid={!!formError} onChange={(e) => setPolicyNumber(e.target.value)} />
              {formError ? (
                <div className="font-medium text-bad-ink" role="alert">
                  {formError}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5 [&_label]:font-medium">
              <label htmlFor="profileRelation">نسبت شما با بیمه‌شده</label>
              <select id="profileRelation" className={PATIENT_INPUT} value={relation} onChange={(e) => setRelation(e.target.value)}>
                {RELATIONS.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </div>
            <Button type="submit" size="patient" busy={busy}>
              ذخیره
            </Button>
            <Button variant="ghost" size="patient" onClick={() => setEditing(false)}>
              انصراف
            </Button>
          </form>
        ) : me.insurance ? (
          <div className={PATIENT_CARD}>
            <ReadOnlyRow label="بیمه" value={me.insurance.insurer} />
            <ReadOnlyRow label="شماره بیمه‌نامه" value={displayValue(me.insurance.policyNumber)} ltr />
            <ReadOnlyRow label="نسبت" value={me.insurance.relation} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function CaseFlowPage() {
  return (
    <PatientLayout>
      <div className="mx-auto w-full max-w-[620px]">
        <PatientName>{(name) => <CaseFlow patientName={name} />}</PatientName>
      </div>
    </PatientLayout>
  );
}

function BigCheck() {
  return (
    <svg className="big-check" aria-hidden="true" viewBox="0 0 120 120" width="150" height="150">
      <circle className="fill-ok-bg stroke-ok-ink stroke-6" cx="60" cy="60" r="54" />
      <path className="animate-check-draw fill-none stroke-ok-ink stroke-11 [stroke-dasharray:90] [stroke-linecap:round] [stroke-linejoin:round] motion-reduce:animate-none" d="M36 62l17 17 32-36" />
    </svg>
  );
}

function CaseFlow({ patientName }: { patientName: string }) {
  const { caseId } = useParams();
  const { data, loading, error, reload, setData } = useAsync(() => api.getMyCase(caseId), [caseId], 4000);
  const [replace, setReplace] = useState<UploadDocKey | null>(null);
  const [paperRx, setPaperRx] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  if (!data) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;
  const c = data;

  if (c.stage === 'REJECTED_CONFLICT') return <ConflictScreen c={c} />;
  if (c.stage === 'AT_INSURER') return <SentScreen c={c} />;
  if (c.stage === 'PROCESSING') return <ProcessingScreen c={c} fresh={justSent} />;

  const submit = async () => {
    setSending(true);
    setSendError(null);
    try {
      setData(await api.submitCase(c.id));
      setJustSent(true);
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (replace) {
    return <DocumentStep key={replace} caseId={c.id} docKey={replace} onSaved={(next) => { setData(next); setReplace(null); }} onCancel={() => setReplace(null)} />;
  }

  // The service first, then the prescription (confirm it, or add it), then a missing report, then confirm.
  const rxFromHospital = c.confirmItems.includes('prescription');
  const reportRequested = c.requestedItems.includes('report');
  const labels = ['خدمت', 'نسخه', ...(reportRequested ? ['گزارش'] : []), 'تأیید'];
  const at = (label: string) => ({ labels, current: labels.indexOf(label) });

  if (!c.confirmedItems.includes('service')) {
    return <ConfirmStep key="service" c={c} item="service" patientName={patientName} steps={at('خدمت')} onDone={setData} />;
  }
  if (rxFromHospital && !c.confirmedItems.includes('prescription')) {
    return <ConfirmStep key="prescription" c={c} item="prescription" patientName={patientName} steps={at('نسخه')} onDone={setData} />;
  }
  if (c.requiredItems.includes('prescription')) {
    return paperRx ? (
      <DocumentStep key="prescription" caseId={c.id} docKey="prescription" steps={at('نسخه')} onSaved={(next) => { setData(next); setPaperRx(false); }} onCancel={() => setPaperRx(false)} />
    ) : (
      <PrescriptionChoice c={c} steps={at('نسخه')} onPaper={() => setPaperRx(true)} onDone={setData} />
    );
  }
  if (c.requiredItems.includes('report')) {
    return <DocumentStep key="report" caseId={c.id} docKey="report" steps={at('گزارش')} onSaved={setData} />;
  }

  const rx = c.documents.find((d) => d.key === 'prescription');
  const rxLine = rx?.eRxId ? `نسخه الکترونیک، شناسه ${toFaDigits(rx.eRxId)}` : rx?.source === 'PACS' ? 'از بیمارستان، تأیید شما' : 'عکس نسخه';

  // Everything is answered: the only thing left is the confirm button.
  return (
    <div className="flex flex-col gap-4.5">
      <FlowSteps labels={labels} current={labels.length - 1} />
      <h1 className="text-center">همه چیز آماده است</h1>
      <div className={PATIENT_CARD}>
        <SummaryRow label="خدمت" detail={`${c.studyTitle}، ${formatDate(c.receivedAt)}`} />
        <SummaryRow label="نسخه" detail={rxLine} action={rx?.source === 'PATIENT' && !rx.eRxId ? () => setReplace('prescription') : undefined} />
        {reportRequested ? <SummaryRow label="گزارش رادیولوژیست" detail="عکس گزارش" action={() => setReplace('report')} /> : null}
      </div>
      {sendError ? <Notice tone="bad">{sendError}</Notice> : null}
      <Button variant="approve" size="patient" className="min-h-[68px] text-[1.2em]" busy={sending} onClick={() => void submit()}>
        تأیید
      </Button>
      <p className="text-center text-muted">بعد از تأیید، پرونده شما بررسی می‌شود و نتیجه را با پیامک خبر می‌دهیم.</p>
    </div>
  );
}

function SummaryRow({ label, detail, action }: { label: string; detail: string; action?: () => void }) {
  return (
    <div className={PATIENT_ROW}>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-ok-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
          {label}
        </span>
        <span className="ps-8 text-[0.92em] text-muted">{detail}</span>
      </span>
      {action ? (
        <button type="button" className={LINK_BUTTON} onClick={action}>
          عکس دوباره
        </button>
      ) : null}
    </div>
  );
}

/** Another service from the same visit still waiting, so the patient goes straight on to it. */
function NextCase({ current }: { current: string }) {
  const cases = useAsync(() => api.listMyCases(), [current]);
  const next = cases.data?.find((c) => c.id !== current && c.stage === 'WAITING_PATIENT');
  if (!next) return null;
  return (
    <div className="next-case flex flex-col gap-2 rounded-card border-2 border-accent/30 bg-accent-soft px-4.5 py-3.5 text-center">
      <p>
        یک خدمت دیگر هم منتظر تأیید شماست: <strong>{next.studyTitle}</strong>، {formatDate(next.receivedAt)}
      </p>
      <Link className={buttonClass('primary', 'patient')} to={`/portal/cases/${next.id}`}>
        رفتن به خدمت بعدی
      </Link>
    </div>
  );
}

function CaseFacts({ c }: { c: PatientCase }) {
  return (
    <div className={`${PATIENT_CARD} w-full text-start`}>
      <ReadOnlyRow label="تصویربرداری" value={c.studyTitle} />
      <ReadOnlyRow label="مرکز درمانی" value={c.hospitalName} />
      <ReadOnlyRow label="تاریخ" value={formatDate(c.receivedAt)} />
      {c.trackingNumber ? <ReadOnlyRow label="شماره پیگیری" value={displayValue(c.trackingNumber)} ltr /> : null}
    </div>
  );
}

/** Confirmed and waiting: the check takes a while, and the result comes by SMS. */
function ProcessingScreen({ c, fresh }: { c: PatientCase; fresh: boolean }) {
  return (
    <div className="processing-screen flex flex-col gap-4.5">
      <div className="flex flex-col items-center gap-2.5 text-center [&_.big-check]:size-28">
        {fresh ? (
          <BigCheck />
        ) : (
          <span className="flex size-24 items-center justify-center rounded-full bg-info-bg text-info-ink" aria-hidden="true">
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
        )}
        <h1>{fresh ? 'تأیید شما ثبت شد' : 'پرونده شما در حال بررسی است'}</h1>
        <p className="text-ink">مدارک شما بررسی می‌شود. این کار کمی زمان می‌برد. نتیجه را با پیامک به شما خبر می‌دهیم و لازم نیست اینجا منتظر بمانید.</p>
      </div>
      <CaseFacts c={c} />
      <NextCase current={c.id} />
    </div>
  );
}

/** Checked and complete: the case went to the insurer. No amount and no promise of payment for the patient. */
function SentScreen({ c }: { c: PatientCase }) {
  return (
    <div className="sent-screen flex flex-col gap-4.5">
      <div className="flex flex-col items-center gap-2.5 text-center [&_.big-check]:size-28">
        <BigCheck />
        <h1>پرونده شما کامل است و برای بیمه ارسال شد</h1>
        <p className="text-ink">این خبر را با پیامک هم برایتان فرستادیم.</p>
      </div>
      <CaseFacts c={c} />
      <NextCase current={c.id} />
    </div>
  );
}

/** The documents did not match. The patient calls the center, which sends them again. */
function ConflictScreen({ c }: { c: PatientCase }) {
  return (
    <div className="conflict-screen flex flex-col gap-4.5">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="flex size-24 items-center justify-center rounded-full bg-bad-bg text-bad-ink" aria-hidden="true">
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4L2.5 20h19zM12 10v4.5M12 17.5v.01" />
          </svg>
        </span>
        <h1>اطلاعات پرونده با هم مغایرت دارد</h1>
      </div>
      {c.conflictReason ? (
        <div className="rounded-card border-2 border-bad-ink/30 bg-bad-bg px-4.5 py-3.5 text-center font-semibold text-bad-ink">{c.conflictReason}</div>
      ) : null}
      <p className="text-center text-ink">
        پرونده شما برای بیمه ارسال نشد. لطفاً با <strong>{c.hospitalName}</strong> تماس بگیرید تا اطلاعات درست را دوباره بفرستند. این پیام را با پیامک هم برایتان فرستادیم.
      </p>
      <CaseFacts c={c} />
    </div>
  );
}
