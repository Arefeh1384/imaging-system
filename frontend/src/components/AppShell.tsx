// The one layout every signed-in account uses: a menu on the right on wide screens,
// and a bar of buttons along the bottom on phones. It is the same menu in both cases.
import type { ReactNode } from 'react';
import { formatNumber } from '../lib/format';
import { Link, usePath } from '../lib/router';
import { isMockMode } from '../api/client';
import { BrandMark, Button } from './ui';
import { GUTTER } from './classes';

export type IconName = 'folder' | 'user' | 'users' | 'chart' | 'inbox' | 'history' | 'building' | 'file' | 'key' | 'pulse' | 'logout';

const ICONS: Record<IconName, ReactNode> = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.2-4 4.2-6 8-6s6.8 2 8 6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.9-3.4 3.3-5 6.5-5s5.6 1.6 6.5 5" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 15.4c1.8.7 3 2.2 3.5 4.6" />
    </>
  ),
  chart: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15.5 3.7A9 9 0 0 1 20.3 8.5h-4.8z" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13l2.5-8h11L20 13v6H4z" />
      <path d="M4 13h5l1.5 2.5h3L15 13h5" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4.5l3 1.8" />
    </>
  ),
  building: (
    <>
      <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18" />
      <path d="M12 7v5M9.5 9.5h5M10 21v-4h4v4" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5M12 11v6M9.5 13h5M9.5 15h5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4.5" />
      <path d="M11.2 11.8L20 3M16 7l3 3M13.5 9.5l2 2" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />,
  logout: (
    <>
      <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </>
  ),
};

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
  /** When a section covers more than one address. */
  match?: (path: string) => boolean;
}

export function AppShell({
  subtitle,
  homeTo,
  userName,
  userRole,
  nav,
  onLogout,
  banner,
  className,
  sample = isMockMode,
  children,
}: {
  subtitle: string;
  homeTo: string;
  userName: string;
  userRole: string;
  nav: NavItem[];
  onLogout: () => void;
  banner?: ReactNode;
  className?: string;
  /** Shows the sample-data badge. Defaults to whether this build runs on sample data. */
  sample?: boolean;
  children: ReactNode;
}) {
  const path = usePath();
  const isActive = (item: NavItem) => (item.match ? item.match(path) : path === item.to);
  const initial = userName.slice(0, 1);

  return (
    <div className={`flex min-h-dvh max-lg:block ${className ?? ''}`}>
      <aside className="shell-side sticky top-0 flex h-dvh w-side-menu flex-none flex-col gap-7 overflow-hidden bg-bg px-4 py-5.5 text-ink lg:max-wide:w-24 lg:max-wide:gap-5 lg:max-wide:px-2 max-lg:fixed max-lg:inset-x-0 max-lg:top-auto max-lg:bottom-0 max-lg:z-20 max-lg:h-auto max-lg:w-auto max-lg:overflow-visible max-lg:border-t max-lg:border-line max-lg:bg-surface max-lg:pt-1.5 max-lg:pr-[max(6px,env(safe-area-inset-right,0px))] max-lg:pb-[calc(6px+env(safe-area-inset-bottom,0px))] max-lg:pl-[max(6px,env(safe-area-inset-left,0px))] max-lg:shadow-sheet short:pt-0.5 short:pb-[calc(2px+env(safe-area-inset-bottom,0px))]">
        <Link to={homeTo} className="relative z-1 flex items-center gap-2.5 px-2 py-0.5 text-inherit no-underline max-lg:hidden lg:max-wide:justify-center lg:max-wide:px-0 [&_small]:block [&_small]:text-micro [&_small]:text-muted [&_strong]:block [&_strong]:leading-[1.4] [.patient_&]:text-body">
          <BrandMark />
          <span className="lg:max-wide:hidden">
            <strong>تصویربرداری و بیمه</strong>
            <small>{subtitle}</small>
          </span>
        </Link>
        <nav className="relative z-1 flex flex-1 flex-col gap-1 max-lg:flex-row max-lg:gap-0.5" aria-label="منوی اصلی">
          {nav.map((item) => (
            <Link key={item.to} to={item.to} className="group flex min-h-12 items-center gap-3 rounded-control px-3 font-medium text-neutral-ink no-underline hover:bg-line aria-[current=page]:bg-surface aria-[current=page]:font-bold aria-[current=page]:text-ink aria-[current=page]:shadow-[0_1px_2px_rgb(16_24_40/6%)] [.patient_&]:text-body max-lg:relative max-lg:min-h-14 max-lg:min-w-0 max-lg:flex-1 max-lg:flex-col max-lg:justify-center max-lg:gap-0.5 max-lg:px-0.5 max-lg:py-1 max-lg:text-center max-lg:text-[0.74rem] max-lg:leading-[1.25] max-lg:text-muted max-lg:hover:bg-transparent max-lg:aria-[current=page]:bg-transparent max-lg:aria-[current=page]:text-accent max-lg:aria-[current=page]:shadow-none max-lg:[.patient_&]:text-[0.8rem] short:min-h-10 short:flex-row short:gap-1.5 lg:max-wide:relative lg:max-wide:flex-col lg:max-wide:justify-center lg:max-wide:gap-1 lg:max-wide:px-1 lg:max-wide:py-2 lg:max-wide:text-center lg:max-wide:text-[0.72rem] lg:max-wide:leading-[1.25] lg:max-wide:[.patient_&]:text-[0.72rem]" aria-current={isActive(item) ? 'page' : undefined}>
              <span className="nav-icon inline-flex max-lg:h-7.5 max-lg:w-14.5 max-lg:items-center max-lg:justify-center max-lg:rounded-pill group-aria-[current=page]:text-accent max-lg:group-aria-[current=page]:bg-accent-soft short:h-auto short:w-auto">
                <Icon name={item.icon} />
              </span>
              <span className="flex-1 max-lg:flex-none lg:max-wide:flex-none">{item.label}</span>
              {item.badge ? <span className="min-w-[22px] rounded-pill bg-accent px-1.5 text-center text-micro font-bold text-accent-ink max-lg:absolute max-lg:end-[14%] max-lg:top-0.5 max-lg:min-w-[18px] max-lg:px-1 max-lg:text-[0.68rem] lg:max-wide:absolute lg:max-wide:end-1.5 lg:max-wide:top-1 lg:max-wide:min-w-[18px] lg:max-wide:px-1 lg:max-wide:text-[0.68rem]">{formatNumber(item.badge)}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="relative z-1 flex flex-col gap-2 max-lg:hidden [.patient_&]:text-body">
          {sample ? <span className="self-start rounded-pill bg-warn-bg px-2.5 py-0.5 text-[0.75rem] text-warn-ink lg:max-wide:hidden" title="اطلاعات نمونه است و فقط در همین مرورگر ذخیره می‌شود.">داده‌های نمونه</span> : null}
          <div className="flex min-h-touch-target items-center gap-2.5 rounded-[14px] bg-surface p-3 lg:max-wide:justify-center lg:max-wide:bg-transparent lg:max-wide:p-0 [&_small]:block [&_small]:text-micro [&_small]:text-muted [&_strong]:block [&_strong]:leading-[1.4]">
            <span className="inline-flex size-9.5 flex-none items-center justify-center rounded-full bg-nav-bg font-bold text-nav-ink" title={userName} aria-hidden="true">
              {initial}
            </span>
            <span className="lg:max-wide:hidden">
              <strong>{userName}</strong>
              <small>{userRole}</small>
            </span>
          </div>
          <button type="button" className="flex min-h-touch-target cursor-pointer items-center gap-2.5 rounded-control px-3 text-neutral-ink hover:bg-line lg:max-wide:flex-col lg:max-wide:justify-center lg:max-wide:gap-0.5 lg:max-wide:px-1 lg:max-wide:py-1.5 lg:max-wide:text-[0.72rem]" onClick={onLogout}>
            <Icon name="logout" size={20} />
            خروج
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`${GUTTER} hidden items-center justify-between gap-2 border-b border-line bg-surface py-1.5 max-lg:flex`}>
          <Link to={homeTo} className="flex min-w-0 items-center gap-2.5 text-inherit no-underline [&_small]:block [&_small]:text-micro [&_small]:leading-[1.35] [&_small]:text-muted [&_strong]:block [&_strong]:leading-[1.35]">
            <BrandMark />
            <span>
              <strong>{userName || 'تصویربرداری و بیمه'}</strong>
              <small>{userRole}</small>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {sample ? <span className="self-center rounded-pill bg-warn-bg px-2.5 py-0.5 text-[0.75rem] text-warn-ink">نمونه</span> : null}
            <Button variant="ghost" onClick={onLogout}>
              <Icon name="logout" size={20} />
              خروج
            </Button>
          </div>
        </header>
        {banner}
        <main className="m-3 ms-0 flex-1 rounded-[20px] bg-surface px-6 pt-8 pb-14 wide:px-8 min-[1440px]:px-12 min-[1440px]:pt-10 max-lg:m-0 max-lg:rounded-none max-lg:bg-bg max-lg:px-4 max-lg:pt-5 max-lg:pb-[calc(96px+env(safe-area-inset-bottom,0px))] short:pb-[calc(64px+env(safe-area-inset-bottom,0px))]">
          <div className="mx-auto w-full max-w-[1240px] 2xl:max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
