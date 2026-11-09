// The PACS admin panel: how much each medical center has sent. Counts only, nothing about patients.
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, isPacsAdminMock, showDemoAccounts } from '../../api/client';
import type { SendPeriod, SendVolume } from '../../api/types';
import { AppShell, type NavItem } from '../../components/AppShell';
import { AuthLayout, Button, buttonClass, ExpandRow, Field, LoadState, Notice, PageTitle, PasswordInput, ResponsiveTable } from '../../components/ui';
import { CARD, CARD_FLUSH, INPUT, TEXT_LINK } from '../../components/classes';
import { formatBytes, formatDate, formatDateTime, formatNumber, formatShortDate } from '../../lib/format';
import { Link, Redirect, useNavigate, useSearchParam } from '../../lib/router';
import { clearPacsSession, getPacsSession, setPacsSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';

const LIVE_MS = 5000;
const NAV: NavItem[] = [{ to: '/pacs-admin', label: 'ارسال‌ها', icon: 'inbox' }];

const PERIODS: Array<{ value: SendPeriod; label: string; phrase: string }> = [
  { value: 'today', label: 'امروز', phrase: 'امروز' },
  { value: '7d', label: '۷ روز', phrase: 'در ۷ روز اخیر' },
  { value: '30d', label: '۳۰ روز', phrase: 'در ۳۰ روز اخیر' },
  { value: 'all', label: 'همه', phrase: 'از ابتدا تا امروز' },
];

const percent = (part: number, whole: number) => `${formatNumber(whole ? Math.round((part / whole) * 100) : 0)}٪`;

export function PacsAdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setPacsSession(await api.pacsAdminLogin({ username, password }));
      navigate('/pacs-admin', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout tagline="پنل مدیر PACS">
      <div>
        <h1>ورود مدیر PACS</h1>
        <p className="text-small text-muted">ببینید هر مرکز درمانی چند بسته ZIP فرستاده است</p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field id="username" label="نام کاربری">
          <input id="username" className={INPUT} dir="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field id="password" label="رمز عبور">
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {showDemoAccounts ? (
          <div className="text-caption text-muted">
            حساب آزمایشی: <bdi dir="ltr">pacs-admin / pacs1234</bdi>
          </div>
        ) : null}
        <Button type="submit" busy={busy} disabled={!username || !password}>
          ورود
        </Button>
      </form>
      <Link className={TEXT_LINK} to="/">
        بازگشت به صفحه اصلی
      </Link>
    </AuthLayout>
  );
}

function PacsLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const session = getPacsSession();
  if (!session) return <Redirect to="/pacs-admin/login" />;
  return (
    <AppShell
      subtitle="پنل مدیر PACS"
      homeTo="/pacs-admin"
      userName={session.name}
      userRole="مدیر PACS"
      nav={NAV}
      sample={isPacsAdminMock}
      onLogout={() => {
        clearPacsSession();
        navigate('/pacs-admin/login', { replace: true });
      }}
    >
      <div className="flex flex-col gap-4">{children}</div>
    </AppShell>
  );
}

function PeriodSwitch({ value, onChange }: { value: SendPeriod; onChange: (next: SendPeriod) => void }) {
  return (
    <div className="period-switch flex flex-wrap gap-1.5" role="group" aria-label="بازه زمانی">
      {PERIODS.map((p) => (
        <button key={p.value} type="button" aria-pressed={p.value === value} className={buttonClass(p.value === value ? 'primary' : 'secondary')} onClick={() => onChange(p.value)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** The headline: how many ZIPs arrived in the period. */
function TotalCard({ data, phrase }: { data: SendVolume; phrase: string }) {
  const active = data.centers.filter((c) => c.sent > 0).length;
  return (
    <section className={`${CARD} send-total flex flex-wrap items-end justify-between gap-x-8 gap-y-3`} aria-label="جمع ارسال‌ها">
      <div className="flex flex-col">
        <span className="text-muted">{phrase}</span>
        <strong className="send-total-value text-[clamp(2.6rem,6vw,3.6rem)] leading-[1.2] font-extrabold tabular-nums">{formatNumber(data.total.sent)}</strong>
        <span className="font-semibold">بسته ZIP از {formatNumber(active)} مرکز درمانی</span>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-5 gap-y-1 text-small [&_dd]:text-end [&_dd]:font-semibold [&_dd]:tabular-nums [&_dt]:text-muted">
        <dt>پذیرفته</dt>
        <dd>{formatNumber(data.total.accepted)}</dd>
        <dt>رد شده (ناقص، تکراری یا خراب)</dt>
        <dd>{formatNumber(data.total.rejected)}</dd>
        <dt>حجم</dt>
        <dd>{formatBytes(data.total.sizeBytes)}</dd>
      </dl>
    </section>
  );
}

/** One bar per day, oldest on the right, as Persian reads. */
function DailyBars({ daily }: { daily: SendVolume['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.sent));
  const busiest = daily.reduce((best, d) => (d.sent > best.sent ? d : best), daily[0]);
  return (
    <section className={`${CARD} daily-bars flex flex-col gap-3`} aria-labelledby="daily-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="daily-title">ارسال روزانه</h2>
        {busiest && busiest.sent > 0 ? (
          <span className="text-small text-muted">
            بیشترین: {formatNumber(busiest.sent)} ZIP در {formatDate(busiest.date)}
          </span>
        ) : null}
      </div>
      <div className="relative flex h-36 items-end gap-[3px] border-b border-line" aria-hidden="true">
        {daily.map((d) => (
          <div
            key={d.date}
            className={`min-w-[3px] flex-1 rounded-t-[3px] ${d.sent ? 'bg-[var(--color-chart-1)]' : 'bg-line'}`}
            style={{ height: d.sent ? `${Math.max(6, (d.sent / max) * 100)}%` : '2px' }}
            title={`${formatDate(d.date)}: ${formatNumber(d.sent)}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-caption text-muted" aria-hidden="true">
        <span>{formatShortDate(daily[0].date)}</span>
        <span>{formatShortDate(daily[daily.length - 1].date)}</span>
      </div>
      <table className="sr-only">
        <caption>تعداد ZIP دریافتی در هر روز</caption>
        <tbody>
          {daily
            .filter((d) => d.sent > 0)
            .map((d) => (
              <tr key={d.date}>
                <th scope="row">{formatDate(d.date)}</th>
                <td>{formatNumber(d.sent)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}

function CentersTable({ data }: { data: SendVolume }) {
  const total = data.total.sent;
  return (
    <section className={CARD_FLUSH}>
      <ResponsiveTable keep={[0, 1]}>
        <table className="centers-volume">
          <caption className="sr-only">تعداد ZIP فرستاده‌شده از هر مرکز درمانی</caption>
          <thead>
            <tr>
              <th scope="col">مرکز درمانی</th>
              <th scope="col" className="text-end">ارسال‌ها</th>
              <th scope="col">سهم از کل</th>
              <th scope="col" className="text-end">پذیرفته</th>
              <th scope="col" className="text-end">رد شده</th>
              <th scope="col" className="text-end">حجم</th>
              <th scope="col">آخرین ارسال</th>
            </tr>
          </thead>
          <tbody>
            {data.centers.map((c) => (
              <ExpandRow key={c.id} id={c.id} label={c.name}>
                <td className={`whitespace-normal font-semibold ${c.sent ? '' : 'text-muted'}`}>{c.name}</td>
                <td className="text-end text-[1.1em] font-bold tabular-nums">{formatNumber(c.sent)}</td>
                <td>
                  <span className="flex min-w-32 items-center gap-2">
                    <span className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
                      <span className="block h-full rounded-pill bg-[var(--color-chart-1)]" style={{ width: total ? `${(c.sent / total) * 100}%` : 0 }} />
                    </span>
                    <span className="w-10 text-end tabular-nums">{percent(c.sent, total)}</span>
                  </span>
                </td>
                <td className="text-end tabular-nums">{formatNumber(c.accepted)}</td>
                <td className="text-end tabular-nums">{formatNumber(c.rejected)}</td>
                <td className="text-end">{formatBytes(c.sizeBytes)}</td>
                <td>{c.lastSentAt ? formatDateTime(c.lastSentAt) : <span className="text-muted">در این بازه چیزی نفرستاده</span>}</td>
              </ExpandRow>
            ))}
          </tbody>
          <tfoot>
            <ExpandRow id="total" label="جمع">
              <td>جمع</td>
              <td className="text-end tabular-nums">{formatNumber(total)}</td>
              <td>{total ? '۱۰۰٪' : '—'}</td>
              <td className="text-end tabular-nums">{formatNumber(data.total.accepted)}</td>
              <td className="text-end tabular-nums">{formatNumber(data.total.rejected)}</td>
              <td className="text-end">{formatBytes(data.total.sizeBytes)}</td>
              <td />
            </ExpandRow>
          </tfoot>
        </table>
      </ResponsiveTable>
    </section>
  );
}

export function PacsVolumePage() {
  const [param, setParam] = useSearchParam('period');
  const period: SendPeriod = PERIODS.some((p) => p.value === param) ? (param as SendPeriod) : '30d';
  const { data, loading, error, reload } = useAsync(() => api.getSendVolume(period), [period], LIVE_MS, { keepPrevious: true });
  const phrase = PERIODS.find((p) => p.value === period)?.phrase ?? '';

  return (
    <PacsLayout>
      <PageTitle title="ارسال‌ها از مراکز درمانی" subtitle="هر مرکز درمانی چند بسته ZIP به سامانه فرستاده است">
        <PeriodSwitch value={period} onChange={(next) => setParam(next === '30d' ? '' : next)} />
      </PageTitle>
      {!data ? (
        <LoadState loading={loading} error={error} onRetry={() => void reload()} />
      ) : (
        <>
          <TotalCard data={data} phrase={phrase} />
          {period !== 'today' && data.daily.length > 1 ? <DailyBars daily={data.daily} /> : null}
          {data.centers.length ? <CentersTable data={data} /> : <Notice tone="info">هنوز هیچ مرکز درمانی ZIP نفرستاده است.</Notice>}
          <p className="text-small text-muted">هر ZIP یک بار شمرده می‌شود، چه پذیرفته شده باشد چه رد. روزها به وقت تهران است. این پنل اطلاعات بیماران را نشان نمی‌دهد.</p>
        </>
      )}
    </PacsLayout>
  );
}
