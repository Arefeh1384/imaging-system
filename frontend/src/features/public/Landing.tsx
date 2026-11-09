import { apiMode } from '../../api/client';
import { Icon, type IconName } from '../../components/AppShell';
import { BrandMark, buttonClass, Notice } from '../../components/ui';
import { Link } from '../../lib/router';
import { CARD, GUTTER } from '../../components/classes';

const ENTRIES: Array<{ to: string; title: string; text: string; action: string; icon: IconName; border: string; iconTone: string; button: string }> = [
  { to: '/portal/login', title: 'بیمار', text: 'مدارک خود را کامل کنید و برای بیمه بفرستید.', action: 'ورود بیمار', icon: 'user', border: 'border-accent', iconTone: 'bg-accent-soft text-accent-soft-ink', button: '' },
  { to: '/insurance/login', title: 'بیمه دانا', text: 'پرونده‌های بررسی‌شده و سهم بیمه', action: 'ورود بیمه', icon: 'pulse', border: 'border-share-insurance', iconTone: 'bg-warn-bg text-warn-ink', button: 'bg-ink' },
  { to: '/admin/login', title: 'مدیریت کل', text: 'بیمارستان‌ها، کارمزدها و همه حساب‌ها', action: 'ورود مدیر', icon: 'building', border: 'border-share-management', iconTone: 'bg-neutral-bg text-neutral-ink', button: 'bg-ink' },
];

export function Landing() {
  return (
    <main className="block min-h-dvh">
      <header className={`${GUTTER} relative overflow-hidden bg-nav-bg bg-[repeating-radial-gradient(circle_at_8%_110%,transparent_0_46px,rgb(120_150_255/16%)_46px_47px)] pt-18 pb-35 text-nav-ink max-lg:pt-10 max-lg:pb-25`}>
        <div className="relative mx-auto flex max-w-[1000px] 2xl:max-w-[1280px] flex-col items-start gap-3 [&_h1]:text-[clamp(1.9rem,5vw,3.6rem)] [&_h1]:leading-[1.35] [&_h1]:font-extrabold [&_p]:text-[clamp(1.05rem,1.6vw,1.3rem)] [&_p]:text-[#c3cbe4]">
          <BrandMark large />
          <h1>سامانه مدارک تصویربرداری و بیمه</h1>
          <p>از دریافت مدارک بیمارستان تا ارسال به بیمه، در یک مسیر ساده.</p>
        </div>
      </header>
      <div className={`${GUTTER} relative mx-auto -mt-21 flex max-w-[1048px] 2xl:max-w-[1328px] flex-col gap-4 pb-10`}>
        <div className="flex flex-wrap gap-3.5 [&>*]:min-w-0 [&>*]:flex-[1_1_220px]">
          {ENTRIES.map((entry) => (
            <Link key={entry.to} to={entry.to} className={`flex flex-col items-start gap-1.5 rounded-[20px] border-t-4 bg-surface p-5 text-inherit no-underline shadow-card lg:p-7 transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 [&>.text-muted]:mb-3.5 [&>strong]:text-[1.5rem] ${entry.border}`} aria-label={entry.action}>
              <span className={`mb-1.5 inline-flex size-14 items-center justify-center rounded-2xl ${entry.iconTone}`}>
                <Icon name={entry.icon} size={26} />
              </span>
              <strong>{entry.title}</strong>
              <span className="text-muted">{entry.text}</span>
              <span className={`${buttonClass()} mt-auto w-full ${entry.button}`}>{entry.action}</span>
            </Link>
          ))}
        </div>
        {apiMode === 'mock' ? <Notice tone="warn">این نسخه هنوز به سرور وصل نیست و داده‌های نمونه را در همین مرورگر نگه می‌دارد.</Notice> : null}
        {apiMode === 'hybrid' ? <Notice tone="warn">پنل بیمار و پنل بیمه به سرور وصل‌اند. پنل مدیر هنوز داده‌های نمونه را نشان می‌دهد.</Notice> : null}
      </div>
    </main>
  );
}

export function NotFound() {
  return (
    <main className={`${GUTTER} block min-h-dvh flex items-center`}>
      <div className="mx-auto flex w-full max-w-[1000px] 2xl:max-w-[1280px] flex-col gap-6 py-8">
        <div className={`${CARD} flex flex-col gap-4`}>
          <h1>این صفحه پیدا نشد</h1>
          <p className="text-muted">نشانی را بررسی کنید یا به صفحه اصلی برگردید.</p>
          <div>
            <Link className={buttonClass()} to="/">
              صفحه اصلی
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
