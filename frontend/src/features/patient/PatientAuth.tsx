import { useState, type FormEvent } from 'react';
import { api, isMockMode } from '../../api/client';
import type { OtpChallenge } from '../../api/types';
import { Button, Field, LoadState, Notice } from '../../components/ui';
import { Link, useNavigate, useParams } from '../../lib/router';
import { useAsync } from '../../lib/useAsync';
import { setPatientSession } from '../../lib/session';
import { toFaDigits } from '../../lib/format';
import { CARD, GUTTER, INPUT, TEXT_LINK } from '../../components/classes';

function OtpForm({ challenge, onVerified }: { challenge: OtpChallenge; onVerified: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.verifyOtp({ challengeId: challenge.challengeId, code });
      setPatientSession(session);
      onVerified();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <p className="text-muted">
        کد تأیید به شماره <bdi dir="ltr">{challenge.maskedMobile}</bdi> ارسال شد.
      </p>
      <Field id="otp" label="کد تأیید" error={error} hint={challenge.devCode ? `در حالت نمونه، کد ${toFaDigits(challenge.devCode)} است.` : undefined}>
        <input
          id="otp"
          className={INPUT}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          aria-invalid={!!error}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
      </Field>
      <Button type="submit" busy={busy} disabled={!code.trim()}>
        تأیید و ورود
      </Button>
    </form>
  );
}

export function PatientLogin() {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setChallenge(await api.requestOtp({ mobile }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={GUTTER}>
      <div className="">
        <div className={`${CARD} flex flex-col gap-4`}>
          <h1>ورود بیمار</h1>
          {challenge ? (
            <OtpForm challenge={challenge} onVerified={() => navigate('/portal', { replace: true })} />
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
              <Field id="mobile" label="شماره موبایل" error={error} hint={`شماره‌ای که در بیمارستان ثبت کرده‌اید.${isMockMode ? ' در حالت نمونه: ۰۹۱۲۰۰۰۴۵۲۱' : ''}`}>
                <input
                  id="mobile"
                  className={INPUT}
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  value={mobile}
                  aria-invalid={!!error}
                  onChange={(e) => setMobile(e.target.value)}
                />
              </Field>
              <Button type="submit" busy={busy} disabled={!mobile.trim()}>
                دریافت کد تأیید
              </Button>
            </form>
          )}
          <Link className={TEXT_LINK} to="/">
            بازگشت به صفحه اصلی
          </Link>
        </div>
      </div>
    </main>
  );
}

/** Where the SMS link lands. The link alone gives no access: the patient must confirm by OTP. */
export function InviteEntry() {
  const { token } = useParams();
  const navigate = useNavigate();
  const invite = useAsync(() => api.getInvite(token), [token]);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setChallenge(await api.requestOtp({ inviteToken: token }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openCase = async () => {
    const cases = await api.listMyCases();
    const match = cases.find((c) => c.inviteToken === token);
    navigate(match ? `/portal/cases/${match.id}` : '/portal', { replace: true });
  };

  return (
    <main className={GUTTER}>
      <div className="">
        <div className={`${CARD} flex flex-col gap-4`}>
          <h1>مدارک شما آماده است</h1>
          <LoadState loading={invite.loading} error={invite.error} />
          {invite.data && !challenge ? (
            <div className="flex flex-col gap-4">
              <p className="text-muted">
                برای دیدن مدارک، تکمیل اطلاعات و بارگذاری نسخه، شماره <bdi dir="ltr">{invite.data.maskedMobile}</bdi> را با کد پیامکی تأیید کنید.
              </p>
              {error ? <Notice tone="bad">{error}</Notice> : null}
              <Button busy={busy} onClick={send}>
                ارسال کد تأیید
              </Button>
            </div>
          ) : null}
          {challenge ? <OtpForm challenge={challenge} onVerified={() => void openCase()} /> : null}
        </div>
      </div>
    </main>
  );
}
