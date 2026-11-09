import { useState, type FormEvent, type ReactNode } from 'react';
import { api, isMockMode, showDemoAccounts } from '../../api/client';
import { AppShell, type NavItem } from '../../components/AppShell';
import { AuthLayout, Button, Field, Notice, PasswordInput } from '../../components/ui';
import { Link, Redirect, useNavigate, usePath } from '../../lib/router';
import { clearAdminSession, getAdminSession, setAdminSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { INPUT, TEXT_LINK } from '../../components/classes';

export function AdminLogin() {
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
      setAdminSession(await api.adminLogin({ username, password }));
      navigate('/admin', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout tagline="مدیریت کل">
      <h1>ورود مدیر</h1>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field id="username" label="نام کاربری">
          <input id="username" className={INPUT} dir="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field id="password" label="رمز عبور">
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {showDemoAccounts ? (
          <p className="text-caption text-muted">
            حساب آزمایشی: <bdi dir="ltr">admin / admin1234</bdi>
          </p>
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

export function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const path = usePath();
  const session = getAdminSession();
  const overview = useAsync(() => api.getOverview(), [path], 3000);

  if (!session) return <Redirect to="/admin/login" />;

  const nav: NavItem[] = [
    {
      to: '/admin',
      label: 'بیمارستان‌ها',
      icon: 'building',
      match: (p) => p === '/admin' || p.startsWith('/admin/companies') || p.startsWith('/admin/hospitals'),
    },
    { to: '/admin/zips', label: 'فایل‌های ZIP', icon: 'file', badge: overview.data?.pipeline.conflict, match: (p) => p.startsWith('/admin/zips') },
    { to: '/admin/accounts', label: 'حساب‌ها', icon: 'key' },
  ];
  if (isMockMode) nav.push({ to: '/admin/pacs-simulator', label: 'شبیه‌ساز PACS', icon: 'pulse' });

  return (
    <AppShell
      subtitle="مدیریت کل"
      homeTo="/admin"
      userName={session.name}
      userRole="مدیر کل سامانه"
      nav={nav}
      onLogout={() => {
        clearAdminSession();
        navigate('/admin/login', { replace: true });
      }}
    >
      <div className="flex flex-col gap-4">{children}</div>
    </AppShell>
  );
}
