// Sample mode only. In production, ZIP files arrive from each hospital's PACS
// connector through the ingestion API, so this page disappears with the mock.
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api, mockTools } from '../../api/client';
import type { IngestInput, IngestResult, IngestScenario } from '../../api/types';
import { Button, ButtonLink, Field, LoadState, Notice, PageTitle } from '../../components/ui';
import { formatBytes, toFaDigits } from '../../lib/format';
import { useNavigate } from '../../lib/router';
import { useAsync } from '../../lib/useAsync';
import { isValidMobile } from '../../lib/validate';
import { FIELD_ROW, CARD, INPUT } from '../../components/classes';

const SCENARIOS: Array<{ value: IngestScenario; label: string }> = [
  { value: 'COMPLETE', label: 'بسته کامل، با نسخه' },
  { value: 'NO_PRESCRIPTION', label: 'بدون نسخه' },
  { value: 'NO_REPORT', label: 'بدون گزارش رادیولوژیست' },
  { value: 'NO_PRESCRIPTION_NO_REPORT', label: 'بدون نسخه و گزارش' },
  { value: 'NO_IMAGES', label: 'بدون تصویر پزشکی: رد می‌شود' },
  { value: 'TOO_LARGE', label: 'حجم بیش از ۲ گیگابایت: رد می‌شود' },
  { value: 'DUPLICATE', label: 'بسته تکراری' },
];

export function PacsSimulator() {
  const navigate = useNavigate();
  const overview = useAsync(() => api.getOverview(), []);
  const [hospitalId, setHospitalId] = useState('h1');
  const [scenario, setScenario] = useState<IngestScenario>('NO_PRESCRIPTION');
  const [aiResult, setAiResult] = useState<IngestInput['aiResult']>('OK');
  const [modality, setModality] = useState('CT');
  const [patientName, setPatientName] = useState('مینا شریفی');
  const [mobile, setMobile] = useState('09127770000');
  const [studyTitle, setStudyTitle] = useState('سی‌تی‌اسکن قفسه سینه');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [resetDone, setResetDone] = useState(false);

  const hospitals = overview.data?.companies.flatMap((c) => c.hospitals) ?? [];
  const mobileOk = isValidMobile(mobile);

  const tools = mockTools;
  if (!tools) return <Notice tone="neutral">این صفحه فقط در حالت نمونه در دسترس است.</Notice>;
  if (!overview.data) return <LoadState loading={overview.loading} error={overview.error} />;

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    if (picked && !picked.name.toLowerCase().endsWith('.zip')) {
      setFileError('فقط فایل با پسوند zip قابل انتخاب است.');
      setFile(null);
      return;
    }
    setFileError(null);
    setFile(picked);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mobileOk) return;
    setBusy(true);
    setResult(
      await tools.simulateIngest({
        hospitalId,
        scenario,
        aiResult,
        patientName,
        mobile,
        studyTitle,
        modality,
        file: file ? { name: file.name, size: file.size } : undefined,
      }),
    );
    setBusy(false);
  };

  const reset = async () => {
    await tools.resetData();
    setResult(null);
    setResetDone(true);
    await overview.reload();
  };

  return (
    <>
      <PageTitle title="شبیه‌ساز دریافت از PACS" subtitle="در نسخه نهایی، فایل از رابط هر بیمارستان می‌رسد. این صفحه تا زمان اتصال سرور همان رویداد را می‌سازد تا مسیر کامل را آزمایش کنید." />
      <div className="flex flex-wrap items-start gap-5">
        <section className={`${CARD} min-w-0 flex-[999_1_520px]`}>
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <div className={FIELD_ROW}>
              <Field id="sim-hospital" label="بیمارستان">
                <select id="sim-hospital" className={INPUT} value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
                  {hospitals.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="sim-scenario" label="محتوای بسته">
                <select id="sim-scenario" className={INPUT} value={scenario} onChange={(e) => setScenario(e.target.value as IngestScenario)}>
                  {SCENARIOS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="sim-name" label="نام بیمار">
                <input id="sim-name" className={INPUT} value={patientName} onChange={(e) => setPatientName(e.target.value)} />
              </Field>
              <Field id="sim-mobile" label="موبایل بیمار" error={mobileOk ? null : 'شماره ۱۱ رقمی با ۰۹ شروع می‌شود.'}>
                <input id="sim-mobile" className={INPUT} dir="ltr" value={mobile} aria-invalid={!mobileOk} onChange={(e) => setMobile(e.target.value)} />
              </Field>
              <Field id="sim-study" label="مطالعه">
                <input id="sim-study" className={INPUT} value={studyTitle} onChange={(e) => setStudyTitle(e.target.value)} />
              </Field>
              <Field id="sim-modality" label="نوع تصویربرداری" hint="سهم بیمه از تعرفه همین نوع حساب می‌شود.">
                <select id="sim-modality" className={INPUT} value={modality} onChange={(e) => setModality(e.target.value)}>
                  <option value="CT">سی‌تی‌اسکن</option>
                  <option value="MR">ام‌آر‌آی</option>
                  <option value="DX">رادیوگرافی</option>
                  <option value="US">سونوگرافی</option>
                </select>
              </Field>
              <Field id="sim-ai" label="بررسی هوش مصنوعی پس از ارسال بیمار">
                <select id="sim-ai" className={INPUT} value={aiResult} onChange={(e) => setAiResult(e.target.value as IngestInput['aiResult'])}>
                  <option value="OK">بدون مغایرت: می‌رود برای بیمه</option>
                  <option value="PRESCRIPTION_STUDY">مغایرت: نسخه با تصویربرداری نمی‌خواند</option>
                  <option value="PRESCRIPTION_NAME">مغایرت: نام روی نسخه</option>
                  <option value="REPORT_IMAGES">مغایرت: گزارش با تصویر نمی‌خواند</option>
                </select>
              </Field>
              <Field
                id="sim-file"
                label="فایل ZIP (اختیاری)"
                error={fileError}
                hint={file ? `${file.name}، ${formatBytes(file.size)}` : 'فقط نام و حجم فایل خوانده می‌شود و فایل جایی ارسال نمی‌شود.'}
              >
                <input id="sim-file" className={INPUT} type="file" accept=".zip" style={{ paddingBlock: 8 }} onChange={pick} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" busy={busy} disabled={!mobileOk}>
                دریافت ZIP
              </Button>
              <Button variant="secondary" onClick={() => void reset()}>
                بازنشانی داده‌های نمونه
              </Button>
            </div>
            {resetDone ? <Notice tone="ok">داده‌های نمونه به حالت اول برگشت.</Notice> : null}
          </form>
        </section>

        <aside className="split-side min-w-0 flex-[1_1_300px] flex flex-col gap-4">
          <section className={`${CARD} flex flex-col gap-2`}>
            <h2>نتیجه دریافت</h2>
            {!result ? <p className="text-muted text-small">پس از «دریافت ZIP»، نتیجه و متن پیامک بیمار اینجا نمایش داده می‌شود.</p> : null}
            {result?.caseRecord ? (
              <>
                <Notice tone="ok">بسته پذیرفته شد و پرونده ساخته شد.</Notice>
                <div className="text-small text-muted">پیامک ارسال‌شده به بیمار:</div>
                <div className="sms-bubble rounded-card bg-surface-2 px-3.5 py-2.5 wrap-anywhere text-small">{result.caseRecord.sms[0].text}</div>
                <div className="text-small text-muted">
                  ورود بیمار: کد ملی {toFaDigits(result.caseRecord.patient.nationalId)} و موبایل {toFaDigits(result.caseRecord.patient.mobile)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => navigate(`/c/${result.caseRecord?.inviteToken}`)}>باز کردن پیوند بیمار</Button>
                  <ButtonLink variant="secondary" to={`/admin/zips/${result.zip.id}`}>
                    دیدن ZIP
                  </ButtonLink>
                </div>
              </>
            ) : null}
            {result && !result.caseRecord ? (
              <>
                <Notice tone={result.zip.status === 'DUPLICATE' ? 'neutral' : 'bad'}>{result.zip.rejectReason}</Notice>
                <div className="text-small text-muted">
                  کد خطا: <span className="font-mono text-code [direction:ltr] [unicode-bidi:isolate]">{result.zip.rejectCode}</span>. پیامکی ارسال نشد.
                </div>
                <div>
                  <ButtonLink variant="secondary" to={`/admin/zips/${result.zip.id}`}>
                    دیدن رسید
                  </ButtonLink>
                </div>
              </>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}
