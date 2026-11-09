// One document, one screen: take or choose a photo, watch it scan, confirm it is readable.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../../api/client';
import type { PatientCase, UploadDocKey } from '../../api/types';
import { Button, buttonClass, Notice } from '../../components/ui';
import { toFaDigits } from '../../lib/format';
import { DOC_LABELS } from '../../lib/labels';
import { prepareScan, type ScannedFile } from '../../lib/scan';
import { documentFileError } from '../../lib/validate';

const SCAN_MS = 2400;

const HELP: Record<UploadDocKey, string> = {
  report: 'گزارش رادیولوژیست از بیمارستان به دست ما نرسیده است. لطفاً از آن عکس بگیرید.',
  prescription: 'نسخه شما از بیمارستان به دست ما نرسیده است. از نسخه‌ای که پزشک برای این تصویربرداری نوشته است عکس بگیرید.',
};

export const SHORT: Record<UploadDocKey, string> = { report: 'گزارش', prescription: 'نسخه' };

export interface StepsInfo {
  labels: string[];
  current: number;
}

/** The patient's path through the case, by name, ending with the send step. */
export function FlowSteps({ labels, current }: StepsInfo) {
  return (
    <ol className="flex short:hidden" aria-label={`مرحله ${toFaDigits(current + 1)} از ${toFaDigits(labels.length)}`}>
      {labels.map((label, index) => (
        <li key={label} className={`relative flex flex-1 flex-col items-center gap-1 text-[0.82em] text-muted not-last:after:absolute not-last:after:start-[calc(50%+18px)] not-last:after:end-[calc(-50%+18px)] not-last:after:top-[15px] not-last:after:h-[3px] not-last:after:rounded-swatch ${index < current ? 'not-last:after:bg-accent' : 'not-last:after:bg-surface-2'}`} aria-current={index === current ? 'step' : undefined}>
          <span className={`flex size-8 items-center justify-center rounded-full font-bold ${index <= current ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-neutral-ink'} ${index === current ? 'outline-4 outline-accent-soft' : ''}`} aria-hidden="true">
            {index < current ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            ) : (
              toFaDigits(index + 1)
            )}
          </span>
          <span className={index === current ? 'font-bold text-ink' : ''}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** A sheet of paper inside a camera frame, showing what the photo should look like. */
function DocIllustration({ docKey }: { docKey: UploadDocKey }) {
  return (
    <div className="relative flex justify-center overflow-hidden rounded-card bg-accent-soft py-3.5 short:hidden [@media(max-height:760px)]:py-2 [&_svg]:relative [@media(max-height:760px)]:[&_svg]:h-27.5 [@media(max-height:760px)]:[&_svg]:w-22" aria-hidden="true">
      <svg viewBox="0 0 160 200" width="150" height="188">
        <rect x="26" y="20" width="108" height="150" rx="6" className="fill-paper stroke-paper-line" />
        <rect x="40" y="36" width="52" height="8" rx="4" className="fill-[#33474f]" />
        <rect x="40" y="56" width="80" height="5" rx="2.5" className="fill-[#c9d2d4]" />
        <rect x="40" y="70" width="80" height="5" rx="2.5" className="fill-[#c9d2d4]" />
        <rect x="40" y="84" width="60" height="5" rx="2.5" className="fill-[#c9d2d4]" />
        {docKey === 'report' ? (
          <>
            <rect x="40" y="100" width="80" height="5" rx="2.5" className="fill-[#c9d2d4]" />
            <rect x="40" y="114" width="70" height="5" rx="2.5" className="fill-[#c9d2d4]" />
            <rect x="40" y="128" width="46" height="5" rx="2.5" className="fill-[#c9d2d4]" />
          </>
        ) : null}
        {docKey === 'prescription' ? <circle cx="102" cy="132" r="16" className="fill-none stroke-[#2d5fa8] stroke-[2.5]" /> : null}
        <path d="M14 34V14h20M126 14h20v20M146 166v20h-20M34 186H14v-20" className="fill-none stroke-accent stroke-4 [stroke-linecap:round] [stroke-linejoin:round]" />
      </svg>
    </div>
  );
}

const TIPS = ['کل برگه داخل کادر باشد', 'جای روشن عکس بگیرید', 'گوشی را ثابت نگه دارید'];

function CameraIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-8 9" />
    </svg>
  );
}

type Phase = 'pick' | 'scanning' | 'confirm';

export function DocumentStep({
  caseId,
  docKey,
  steps,
  onSaved,
  onCancel,
}: {
  caseId: string;
  docKey: UploadDocKey;
  steps?: StepsInfo;
  onSaved: (c: PatientCase) => void;
  onCancel?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [scan, setScan] = useState<ScannedFile | null>(null);
  const [fromCamera, setFromCamera] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const pick = (camera: boolean) => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = documentFileError(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setFromCamera(camera);
    setPhase('scanning');
    const started = Date.now();
    const result = await prepareScan(file);
    setScan(result);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase('confirm'), Math.max(0, SCAN_MS - (Date.now() - started)));
  };

  const accept = async () => {
    if (!scan) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.uploadDocument(caseId, docKey, scan.file));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const label = DOC_LABELS[docKey];

  return (
    <section className="flex flex-col gap-4.5 short:gap-2.5">
      {steps ? <FlowSteps {...steps} /> : null}

      {phase === 'pick' ? (
        <>
          <h1 className="text-center">عکس {label}</h1>
          <DocIllustration docKey={docKey} />
          <p className="text-center text-ink">{HELP[docKey]}</p>
          <div className="photo-tips flex flex-col items-center gap-0.5 rounded-card border-2 border-[#f2b84b] bg-warn-bg px-4 py-3 text-center text-warn-ink [@media(max-height:680px)]:hidden">
            <strong className="flex items-center gap-1.5">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
              </svg>
              برای عکس خوب
            </strong>
            {TIPS.map((tip) => (
              <span key={tip} className="[@media(max-height:800px)]:last:hidden">
                {tip}
              </span>
            ))}
          </div>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <div className="flex flex-col gap-4.5 short:flex-row short:gap-2.5 short:[&>*]:flex-1">
            <label className={`${buttonClass('primary', 'patient')} focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus`}>
              <CameraIcon />
              عکس گرفتن
              <input id="doc-camera" className="sr-only" type="file" accept="image/*" capture="environment" onChange={pick(true)} />
            </label>
            <label className={`${buttonClass('secondary', 'patient')} focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus`}>
              <GalleryIcon />
              انتخاب از گوشی
              <input id="doc-gallery" className="sr-only" type="file" accept="image/*,application/pdf" onChange={pick(false)} />
            </label>
          </div>
          {onCancel ? (
            <Button variant="ghost" size="patient" onClick={onCancel}>
              برگشت
            </Button>
          ) : null}
        </>
      ) : null}

      {phase === 'scanning' ? (
        <>
          <h1 className="text-center">در حال اسکن {label}</h1>
          <div className="relative flex items-center justify-center overflow-hidden rounded-card shadow-card [&_img]:block [&_img]:w-full [&_img]:object-contain min-h-[300px] bg-viewer after:pointer-events-none after:absolute after:inset-0 after:bg-[linear-gradient(var(--color-scan)_2px,transparent_2px),linear-gradient(90deg,var(--color-scan)_2px,transparent_2px)] after:bg-[size:34px_34px] after:opacity-12 [&_img]:max-h-[52dvh]" role="status" aria-label="در حال اسکن">
            {scan?.previewUrl ? <img src={scan.previewUrl} alt="" /> : <div className="h-[300px] w-full" />}
            <span className="pointer-events-none absolute inset-3.5 [background:linear-gradient(var(--color-scan),var(--color-scan))_top_right/34px_4px_no-repeat,linear-gradient(var(--color-scan),var(--color-scan))_top_right/4px_34px_no-repeat,linear-gradient(var(--color-scan),var(--color-scan))_top_left/34px_4px_no-repeat,linear-gradient(var(--color-scan),var(--color-scan))_top_left/4px_34px_no-repeat,linear-gradient(var(--color-scan),var(--color-scan))_bottom_right/34px_4px_no-repeat,linear-gradient(var(--color-scan),var(--color-scan))_bottom_right/4px_34px_no-repeat,linear-gradient(var(--color-scan),var(--color-scan))_bottom_left/34px_4px_no-repeat,linear-gradient(var(--color-scan),var(--color-scan))_bottom_left/4px_34px_no-repeat]" aria-hidden="true" />
            <span className="scan-line absolute inset-x-0 top-0 h-1 animate-scan-sweep bg-scan shadow-[0_0_18px_6px_var(--color-scan)] motion-reduce:top-1/2 motion-reduce:animate-none" aria-hidden="true" />
          </div>
          <p className="text-center text-ink">چند لحظه صبر کنید.</p>
        </>
      ) : null}

      {phase === 'confirm' ? (
        <>
          <h1 className="text-center">این عکس خوانا است؟</h1>
          <div className="relative flex items-center justify-center overflow-hidden rounded-card shadow-card [&_img]:block [&_img]:w-full [&_img]:object-contain bg-surface [&_img]:max-h-[44dvh] max-lg:[&_img]:max-h-[38dvh] short:[&_img]:max-h-[44dvh]">
            {scan?.previewUrl ? <img src={scan.previewUrl} alt={`عکس اسکن‌شده ${label}`} /> : <p className="px-4 py-10 text-center wrap-anywhere [direction:ltr]">{scan?.file.name}</p>}
          </div>
          <p className="text-center text-ink [@media(max-height:800px)]:hidden">نوشته‌ها را نگاه کنید. باید راحت خوانده شوند.</p>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <div className="flex flex-col gap-4.5 short:flex-row short:gap-2.5 short:[&>*]:flex-1">
            <Button size="patient" busy={busy} onClick={() => void accept()}>
              بله، خوانا است
            </Button>
            <label className={`${buttonClass('secondary', 'patient')} focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus`}>
              نه، دوباره عکس می‌گیرم
              {fromCamera ? (
                <input id="doc-retake" className="sr-only" type="file" accept="image/*" capture="environment" onChange={pick(true)} />
              ) : (
                <input id="doc-retake" className="sr-only" type="file" accept="image/*,application/pdf" onChange={pick(false)} />
              )}
            </label>
          </div>
        </>
      ) : null}
    </section>
  );
}
