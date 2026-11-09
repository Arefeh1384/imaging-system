import { useState, type FormEvent, type ReactNode } from 'react';
import { api, insuranceShowsSample, showDemoAccounts } from '../../api/client';
import type { StaffRole } from '../../api/types';
import { AppShell, type NavItem } from '../../components/AppShell';
import { AuthLayout, Button, Field, Notice, ViewAsBanner, PasswordInput } from '../../components/ui';
import { homeForRole, ROLE_LABELS } from '../../lib/labels';
import { Link, Redirect, useNavigate } from '../../lib/router';
import { clearStaffSession, getStaffSession, setStaffSession } from '../../lib/session';
import { INPUT, TEXT_LINK } from '../../components/classes';

export function InsuranceLogin() {
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
      const session = await api.insuranceLogin({ username, password });
      setStaffSession(session);
      navigate(homeForRole(session.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout tagline="پنل بیمه دانا">
      <div>
        <h1>ورود به پنل بیمه</h1>
        <p className="text-small text-muted">پرونده‌هایی که هوش مصنوعی بررسی کرده و سهم بیمه آن‌ها</p>
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
            حساب آزمایشی: <bdi dir="ltr">dana-admin / dana1234</bdi>
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

export function InsuranceLayout({ role, nav, children }: { role: StaffRole; nav: NavItem[]; children: ReactNode }) {
  const navigate = useNavigate();
  const session = getStaffSession();
  if (!session) return <Redirect to="/insurance/login" />;
  if (session.role !== role) return <Redirect to={homeForRole(session.role)} />;

  return (
    <AppShell
      subtitle={ROLE_LABELS[role]}
      homeTo={homeForRole(role)}
      userName={session.name}
      userRole={ROLE_LABELS[role]}
      nav={nav}
      onLogout={() => {
        clearStaffSession();
        navigate('/insurance/login', { replace: true });
      }}
      banner={session.viewAs ? <ViewAsBanner name={session.name} onExit={clearStaffSession} /> : null}
      sample={insuranceShowsSample()}
    >
      <div className="flex flex-col gap-4">{children}</div>
    </AppShell>
  );
}
