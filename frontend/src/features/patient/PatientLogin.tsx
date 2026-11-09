import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, isPatientMock } from '../../api/client';
import type { OtpChallenge } from '../../api/types';
import { AuthLayout, Button, Notice } from '../../components/ui';
import { normalizeDigits, toFaDigits } from '../../lib/format';
import { Link, useNavigate, useParams } from '../../lib/router';
import { setPatientSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { isValidMobile, isValidNationalId } from '../../lib/validate';
import { PATIENT_INPUT, TEXT_LINK } from '../../components/classes';

const PATIENT_STEPS = ['وارد سامانه می‌شوید', 'از مدارک ناقص عکس می‌گیرید', 'پرونده را برای بیمه می‌فرستید'];

/** Second step: the code that was sent by SMS. It submits itself once every digit is in. */
function CodeStep({ challenge, maskedMobile, onVerified, onResend, onBack }: { challenge: OtpChallenge; maskedMobile: string; onVerified: (code: string) => Promise<void>; onResend: () => Promise<void>; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [sentAgain, setSentAgain] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(challenge.resendInSeconds);
  const input = useRef<HTMLInputElement>(null);

  // A new challenge restarts the clock. The code on screen no longer applies.
  useEffect(() => {
    setCode('');
    setError(null);
    setNeedsNewCode(false);
    const started = Date.now();
    const tick = () => {
      const passed = (Date.now() - started) / 1000;
      setSecondsLeft(Math.max(0, Math.ceil(challenge.resendInSeconds - passed)));
      if (passed >= challenge.expiresInSeconds) {
        setNeedsNewCode(true);
        setError('زمان این کد تمام شده است. کد تازه بگیرید.');
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    input.current?.focus();
    return () => window.clearInterval(timer);
  }, [challenge.challengeId]);

  const verify = async (value: string) => {
    if (needsNewCode) return;
    if (value.length !== challenge.codeLength) {
      setError(`کد ${toFaDigits(challenge.codeLength)} رقمی پیامک‌شده را کامل بنویسید.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onVerified(value);
    } catch (err) {
      const failure = err as Error & { code?: string };
      setError(failure.message);
      setBusy(false);
      setCode('');
      if (failure.code === 'CODE_EXPIRED' || failure.code === 'TOO_MANY_ATTEMPTS') setNeedsNewCode(true);
      else requestAnimationFrame(() => input.current?.focus());
    }
  };

  const resend = async () => {
    setResending(true);
    setSentAgain(false);
    setError(null);
    try {
      await onResend();
      setSentAgain(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResending(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4.5"
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void verify(code);
      }}
    >
      <p>
        کد ورود به شماره <bdi dir="ltr">{maskedMobile}</bdi> پیامک شد.
      </p>
      <div className="flex flex-col gap-1.5 [&_label]:font-medium">
        <label htmlFor="otp">
          کد <strong>{toFaDigits(challenge.codeLength)} رقمی</strong> پیامک‌شده
        </label>
        <input
          ref={input}
          id="otp"
          className={`${PATIENT_INPUT} text-center text-[1.5em] font-bold tracking-[0.35em] tabular-nums disabled:bg-surface-2`}
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={needsNewCode}
          aria-invalid={!!error}
          value={toFaDigits(code)}
          onChange={(event) => {
            const next = normalizeDigits(event.target.value).replace(/\D/g, '').slice(0, challenge.codeLength);
            setCode(next);
            setError(null);
            if (next.length === challenge.codeLength && !busy) void verify(next);
          }}
        />
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {sentAgain && !error ? <Notice tone="ok">کد تازه پیامک شد.</Notice> : null}
      {challenge.sampleCode ? (
        <Notice tone="warn">
          <span className="otp-sample">
            حالت آزمایشی: پیامک واقعی فرستاده نمی‌شود. کد شما <bdi dir="ltr">{toFaDigits(challenge.sampleCode)}</bdi>
          </span>
        </Notice>
      ) : null}
      {needsNewCode ? null : (
        <Button type="submit" size="patient" busy={busy}>
          ورود
        </Button>
      )}
      {needsNewCode || secondsLeft === 0 ? (
        <Button variant={needsNewCode ? 'primary' : 'secondary'} size="patient" busy={resending} onClick={() => void resend()}>
          گرفتن کد تازه
        </Button>
      ) : (
        <p className="resend-wait text-center text-muted tabular-nums" role="timer">
          اگر پیامک نرسید، تا {toFaDigits(secondsLeft)} ثانیه دیگر می‌توانید کد تازه بگیرید.
        </p>
      )}
      <button type="button" className={`${TEXT_LINK} self-center`} onClick={onBack}>
        اصلاح کد ملی یا شماره موبایل
      </button>
    </form>
  );
}

function LoginForm({ caseId, devHint }: { caseId?: string; devHint?: { nationalId: string; mobile: string } }) {
  const navigate = useNavigate();
  const [nationalId, setNationalId] = useState('');
  const [mobile, setMobile] = useState('');
  const [errors, setErrors] = useState<{ nationalId?: string; mobile?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);

  /** Straight to the work: the case that needs them, or the list when there is a choice. */
  const landing = async (): Promise<string> => {
    if (caseId) return `/portal/cases/${caseId}`;
    const cases = await api.listMyCases();
    const open = cases.filter((c) => c.stage === 'WAITING_PATIENT');
    if (open.length === 1) return `/portal/cases/${open[0].id}`;
    return '/portal';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: { nationalId?: string; mobile?: string } = {};
    if (!isValidNationalId(nationalId)) next.nationalId = 'کد ملی باید ۱۰ رقم و درست باشد.';
    if (!isValidMobile(mobile)) next.mobile = 'شماره موبایل باید ۱۱ رقم باشد و با ۰۹ شروع شود.';
    setErrors(next);
    setFormError(null);
    if (next.nationalId || next.mobile) return;
    setBusy(true);
    try {
      setChallenge(await api.patientRequestCode({ nationalId, mobile }));
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <CodeStep
        challenge={challenge}
        maskedMobile={toFaDigits(challenge.maskedMobile)}
        onVerified={async (code) => {
          setPatientSession(await api.patientVerifyCode({ challengeId: challenge.challengeId, code }));
          navigate(await landing(), { replace: true });
        }}
        onResend={async () => setChallenge(await api.patientRequestCode({ nationalId, mobile }))}
        onBack={() => setChallenge(null)}
      />
    );
  }

  return (
    <form className="flex flex-col gap-4.5" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-1.5 [&_label]:font-medium">
        <label htmlFor="nationalId">
          <strong>کد ملی شما</strong>
        </label>
        <input
          id="nationalId"
          className={PATIENT_INPUT}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          value={nationalId}
          aria-invalid={!!errors.nationalId}
          aria-describedby="nationalId-help"
          onChange={(e) => setNationalId(e.target.value)}
        />
        <div id="nationalId-help" className="text-[0.9em] text-muted">
          کد ملی ۱۰ رقمی خود را بنویسید.
        </div>
        {errors.nationalId ? (
          <div className="font-medium text-bad-ink" role="alert">
            {errors.nationalId}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 [&_label]:font-medium">
        <label htmlFor="mobile">
          <strong>شماره موبایل شما</strong>
        </label>
        <input
          id="mobile"
          className={PATIENT_INPUT}
          dir="ltr"
          inputMode="tel"
          autoComplete="off"
          value={mobile}
          aria-invalid={!!errors.mobile}
          aria-describedby="mobile-help"
          onChange={(e) => setMobile(e.target.value)}
        />
        <div id="mobile-help" className="text-[0.9em] text-muted">
          شماره‌ای که پیامک به آن آمده است، مثل ۰۹۱۲۱۲۳۴۵۶۷. کد ورود به همین شماره پیامک می‌شود.
        </div>
        {errors.mobile ? (
          <div className="font-medium text-bad-ink" role="alert">
            {errors.mobile}
          </div>
        ) : null}
      </div>
      {formError ? <Notice tone="bad">{formError}</Notice> : null}
      {isPatientMock || devHint ? (
        <Notice tone="warn">
          حالت آزمایشی: کد ملی {toFaDigits(devHint?.nationalId ?? '1200045211')} و موبایل {toFaDigits(devHint?.mobile ?? '09120004521')}
        </Notice>
      ) : null}
      <Button type="submit" size="patient" busy={busy}>
        گرفتن کد ورود
      </Button>
    </form>
  );
}

export function PatientLogin() {
  return (
    <AuthLayout patient tagline="پورتال بیمار" steps={PATIENT_STEPS}>
      <h1>ورود به پرونده</h1>
      <LoginForm />
      <Link className={TEXT_LINK} to="/">
        صفحه اصلی
      </Link>
    </AuthLayout>
  );
}

/** Where the SMS link lands. */
export function InviteEntry() {
  const { token } = useParams();
  const invite = useAsync(() => api.getInvite(token), [token]);
  return (
    <AuthLayout patient tagline={invite.data?.hospitalName ?? 'پورتال بیمار'} steps={PATIENT_STEPS}>
      <h1>مدارک شما آماده است</h1>
      {invite.error ? <Notice tone="bad">{invite.error}</Notice> : null}
      {invite.data ? <LoginForm caseId={invite.data.caseId} devHint={invite.data.devHint} /> : null}
    </AuthLayout>
  );
}
