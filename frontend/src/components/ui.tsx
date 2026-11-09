import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, useNavigate } from '../lib/router';
import { formatNumber, formatToman, toFaDigits } from '../lib/format';
import { PAGE_SIZES } from '../lib/usePageParams';
import type { StatusLabel, Tone } from '../lib/labels';
import type { FeeSplit, Totals } from '../api/types';
import { GUTTER, INPUT, LIST_ROW } from './classes';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid' | 'approve';
type ButtonSize = 'default' | 'large' | 'patient';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-accent px-5 text-accent-ink hover:not-disabled:bg-[#2249c4]',
  secondary: 'border-transparent bg-surface-2 px-5 text-ink hover:not-disabled:bg-line',
  ghost: 'border-transparent bg-transparent px-2.5 text-accent',
  danger: 'border-[#e6c4c0] bg-surface px-5 text-bad-ink hover:not-disabled:bg-bad-bg',
  dangerSolid: 'border-transparent bg-[#c4352b] px-5 text-accent-ink hover:not-disabled:bg-[#a92b22]',
  approve: 'border-transparent bg-[#1f8a5a] px-5 text-accent-ink hover:not-disabled:bg-[#197a4f]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: 'min-h-12 rounded-control whitespace-nowrap',
  large: 'min-h-14 rounded-control whitespace-nowrap',
  patient: 'min-h-patient-target w-full rounded-[14px] text-patient-button whitespace-normal short:min-h-12',
};

/** For links and labels that look like buttons. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'default', block = false) {
  return `inline-flex items-center justify-center gap-2 border font-bold no-underline transition-[filter,background-color] duration-[120ms] active:[transform:scale(0.985)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:active:[transform:none] ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${block ? 'w-full' : ''}`;
}

export const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok-ink',
  warn: 'bg-warn-bg text-warn-ink',
  bad: 'bg-bad-bg text-bad-ink',
  info: 'bg-accent-soft text-accent-soft-ink',
  neutral: 'bg-neutral-bg text-neutral-ink',
};

export const chipClass = (tone: Tone) =>
  `chip inline-flex items-center gap-1.5 rounded-pill px-2.5 py-[3px] text-caption font-semibold whitespace-nowrap before:size-[7px] before:flex-none before:rounded-full before:bg-current ${TONE_CLASSES[tone]}`;

export const noticeClass = (tone: Tone) => `notice rounded-card px-4 py-3 font-medium ${TONE_CLASSES[tone]}`;

export const LINK_BUTTON = 'min-h-7 px-1 font-semibold text-accent underline pointer-coarse:min-h-touch-target';

export function Button({
  variant = 'primary',
  size = 'default',
  block,
  busy,
  children,
  className,
  ...rest
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${buttonClass(variant, size, block)} ${className ?? ''}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="size-4.5 flex-none animate-spinner rounded-full border-2 border-current border-e-transparent motion-reduce:animate-none" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant = 'primary', children }: { to: string; variant?: ButtonVariant; children: ReactNode }) {
  return (
    <Link to={to} className={buttonClass(variant)}>
      {children}
    </Link>
  );
}

export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string | null; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 [&_label]:text-label [&_label]:font-semibold">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <div className="text-caption text-muted">{hint}</div> : null}
      {error ? (
        <div className="text-small text-bad-ink" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** A password box with an eye to show or hide what was typed. */
export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...rest} type={visible ? 'text' : 'password'} dir="ltr" spellCheck={false} autoCapitalize="off" className={`${INPUT} pr-12 [&::-ms-clear]:hidden [&::-ms-reveal]:hidden ${className ?? ''}`} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-control text-muted hover:text-ink"
        aria-label={visible ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
        title={visible ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((v) => !v)}
      >
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
          {visible ? <path d="M4 4l16 16" /> : null}
        </svg>
      </button>
    </div>
  );
}

/** The sparkle that marks anything the AI said, as opposed to a person or the hospital. */
export function AiSparkle({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="flex-none">
      <path d="M11 2.5l1.9 5.6 5.6 1.9-5.6 1.9L11 17.5l-1.9-5.6L3.5 10l5.6-1.9z" />
      <path d="M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
    </svg>
  );
}

/** A small label saying this is the AI's opinion. It takes the colour of whatever it sits in. */
export function AiTag({ short }: { short?: boolean }) {
  return (
    <span className="ai-tag inline-flex flex-none items-center gap-1 rounded-pill bg-current/12 px-2 py-0.5 text-caption leading-[1.5] font-bold whitespace-nowrap">
      <AiSparkle size={13} />
      {short ? 'AI' : 'هوش مصنوعی'}
    </span>
  );
}

/** Asks before something the person may regret, such as turning off someone's account. */
export function ConfirmDialog({ open, title, children, confirmLabel, busy, onConfirm, onCancel }: { open: boolean; title: string; children: ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <div className="text-ink">{children}</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="dangerSolid" busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            انصراف
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function Chip({ status }: { status: StatusLabel }) {
  return <span className={chipClass(status.tone)}>{status.label}</span>;
}

export function Notice({ tone, children, busy }: { tone: Tone; children: ReactNode; busy?: boolean }) {
  return (
    <div className={`${noticeClass(tone)} ${busy ? 'flex flex-wrap items-center gap-2' : ''}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {busy ? <span className="size-4.5 flex-none animate-spinner rounded-full border-2 border-current border-e-transparent motion-reduce:animate-none" aria-hidden="true" /> : null}
      <span>{children}</span>
    </div>
  );
}

export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry?: () => void }) {
  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <Notice tone="bad">{error}</Notice>
        {onRetry ? (
          <div>
            <Button variant="secondary" onClick={onRetry}>
              تلاش دوباره
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex flex-col gap-3 [&_span]:h-19 [&_span]:animate-shimmer [&_span]:rounded-card [&_span]:bg-[linear-gradient(90deg,var(--color-surface-2),var(--color-surface),var(--color-surface-2))] [&_span]:bg-[length:300%_100%] motion-reduce:[&_span]:animate-none [&_span:first-child]:h-8.5 [&_span:first-child]:w-2/5" role="status" aria-label="در حال بارگذاری">
        <span />
        <span />
        <span />
      </div>
    );
  }
  return null;
}

/** A short confirmation that does not push the page content around. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 4500);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="fixed start-1/2 bottom-6 z-40 flex max-w-[min(520px,calc(100vw-32px))] animate-toast-in items-center gap-2.5 rounded-toast bg-nav-bg px-4.5 py-3 font-medium text-nav-ink shadow-toast [transform:translateX(50%)] motion-reduce:animate-none max-lg:bottom-[calc(84px+env(safe-area-inset-bottom,0px))]" role="status">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
      {message}
    </div>
  );
}

/** What a table looks like once it no longer fits: each row is a stack of labeled lines. */
const STACKED = [
  'data-stacked:[&_table]:block data-stacked:[&_tbody]:block data-stacked:[&_tfoot]:block data-stacked:[&_thead]:hidden',
  'data-stacked:[&_tr]:block data-stacked:[&_tr]:w-full data-stacked:[&_tr]:border-t data-stacked:[&_tr]:border-line data-stacked:[&_tr]:px-3.5 data-stacked:[&_tr]:py-2.5 data-stacked:[&_tbody_tr:first-child]:border-t-0',
  'data-stacked:[&_td]:flex data-stacked:[&_td]:w-full data-stacked:[&_td]:min-w-0 data-stacked:[&_td]:justify-between data-stacked:[&_td]:gap-3 data-stacked:[&_td]:border-0 data-stacked:[&_td]:px-0 data-stacked:[&_td]:py-1 data-stacked:[&_td]:text-start data-stacked:[&_td]:whitespace-normal',
  'data-stacked:[&_td:empty]:hidden data-stacked:[&_td:first-child]:font-bold',
  'data-stacked:[&_td[data-label]]:before:flex-none data-stacked:[&_td[data-label]]:before:text-[0.85rem] data-stacked:[&_td[data-label]]:before:font-normal data-stacked:[&_td[data-label]]:before:text-muted data-stacked:[&_td[data-label]]:before:content-[attr(data-label)]',
  'data-stacked:[&_td[data-label]>div]:items-end data-stacked:[&_td[data-label]>div]:text-end',
  'data-stacked:[&_tfoot_td]:bg-transparent data-stacked:[&_tfoot_tr]:bg-accent-soft data-stacked:[&_tfoot_tr]:text-accent-soft-ink',
  // Two columns of lines once there is room for them.
  '@min-[560px]:data-stacked:[&_tr]:grid @min-[560px]:data-stacked:[&_tr]:grid-cols-2 @min-[560px]:data-stacked:[&_tr]:gap-x-8 @min-[560px]:data-stacked:[&_td:first-child]:col-span-full',
  // Folded rows keep only their main lines, and the toggle exists only in the stacked view.
  'data-stacked:[&_tr[data-compact]>td:not([data-keep]):not(.row-toggle)]:hidden',
  '[&_td.row-toggle]:hidden data-stacked:[&_td.row-toggle]:flex data-stacked:[&_td.row-toggle]:pt-1.5 @min-[560px]:data-stacked:[&_td.row-toggle]:col-span-full',
].join(' ');

/** Which row of a list or table is open. Only one at a time, so opening a row folds the last one. */
const ExpandContext = createContext<{ open: string | null; toggle: (key: string) => void } | null>(null);

function useExpandState() {
  const [open, setOpen] = useState<string | null>(null);
  return { open, toggle: (key: string) => setOpen((current) => (current === key ? null : key)) };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`flex-none transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ExpandToggle({ open, label, onClick, className = '' }: { open: boolean; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={`expand-toggle inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control px-3 text-small font-semibold text-accent hover:bg-accent-soft ${className}`}
      aria-expanded={open}
      aria-label={`${open ? 'بستن جزئیات' : 'جزئیات بیشتر'} ${label}`}
      onClick={onClick}
    >
      {open ? 'بستن' : 'جزئیات'}
      <Chevron open={open} />
    </button>
  );
}

/**
 * A table row that folds on phones. Folded, it shows only the columns the table keeps
 * (see `keep` on ResponsiveTable) and a button to open the rest.
 */
export function ExpandRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const ctx = useContext(ExpandContext);
  const open = ctx?.open === id;
  return (
    <tr data-compact={open ? undefined : ''} data-open={open ? '' : undefined}>
      {children}
      <td className="row-toggle">
        <ExpandToggle open={open} label={label} className="w-full bg-surface-2" onClick={() => ctx?.toggle(id)} />
      </td>
    </tr>
  );
}

/** Wraps rows of `ExpandItem` so that only one of them is open at a time. */
export function ExpandList({ children }: { children: ReactNode }) {
  return <ExpandContext.Provider value={useExpandState()}>{children}</ExpandContext.Provider>;
}

/**
 * A list row that folds on phones: the summary and a button to open it, which shows
 * the details and actions. From tablet width up everything is shown and there is no button.
 */
export function ExpandItem({ id, label, summary, details, actions }: { id: string; label: string; summary: ReactNode; details?: ReactNode; actions?: ReactNode }) {
  const ctx = useContext(ExpandContext);
  const open = ctx?.open === id;
  return (
    <div className={`${LIST_ROW} expand-item max-md:flex-nowrap max-md:items-start`} data-open={open ? '' : undefined}>
      <div className="list-main min-w-0 flex-1 md:flex-[1_1_240px]">
        {summary}
        {details ? <div className={open ? 'mt-0.5' : 'max-md:hidden'}>{details}</div> : null}
        {actions ? <div className={`mt-2 flex flex-wrap items-center gap-2 md:hidden ${open ? '' : 'hidden'}`}>{actions}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 max-md:hidden">{actions}</div> : null}
      {details || actions ? <ExpandToggle open={open} label={label} className="flex-none md:hidden" onClick={() => ctx?.toggle(id)} /> : null}
    </div>
  );
}

/**
 * Shows a table when it fits and labeled rows when it doesn't, so nothing scrolls sideways.
 * It measures the table itself rather than the screen, so it is right on any device,
 * with any number of columns, and with long names in the data.
 */
export function ResponsiveTable({ children, keep = [0, 1] }: { children: ReactNode; /** Columns a folded row still shows on phones. */ keep?: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const expand = useExpandState();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const headers = Array.from(root.querySelectorAll('thead th')).map((th) => th.textContent ?? '');
    root.querySelectorAll('tbody tr, tfoot tr').forEach((row) => {
      let column = 0;
      Array.from((row as HTMLTableRowElement).cells).forEach((cell) => {
        if (cell.classList.contains('row-toggle')) return;
        if (column > 0 && cell.colSpan === 1) cell.setAttribute('data-label', headers[column] ?? '');
        else cell.removeAttribute('data-label');
        if (keep.includes(column) || cell.colSpan > 1) cell.setAttribute('data-keep', '');
        else cell.removeAttribute('data-keep');
        column += cell.colSpan;
      });
    });
  });

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const measure = () => {
      const table = root.querySelector('table');
      if (!table) return;
      root.removeAttribute('data-stacked');
      if (table.offsetWidth > root.clientWidth + 1) root.setAttribute('data-stacked', '');
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [children]);

  return (
    <ExpandContext.Provider value={expand}>
      <div ref={ref} className={`@container overflow-x-auto ${STACKED}`}>
        {children}
      </div>
    </ExpandContext.Provider>
  );
}

/** Page numbers to show: the ends, and the neighbours of the current page. */
function pageList(page: number, last: number): Array<number | 'gap'> {
  const wanted = new Set([1, last, page - 1, page, page + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1] > 1) out.push('gap');
    out.push(n);
  });
  return out;
}

const PAGE_BUTTON = 'inline-flex min-h-touch-target min-w-touch-target items-center justify-center rounded-control px-2.5 font-semibold tabular-nums hover:not-disabled:not-aria-[current=page]:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink';

/** Goes under every long list. Each page is loaded from the server on its own. */
export function Pagination({ page, pageSize, total, onPage, onPageSize, label }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize?: (size: number) => void; label: string }) {
  const nav = useRef<HTMLElement>(null);
  if (total === 0) return null;
  const last = Math.max(Math.ceil(total / pageSize), 1);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const go = (next: number) => {
    onPage(next);
    // Long pages end far below the top of the list: bring the start of the new page back into view.
    const list = nav.current?.parentElement;
    if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: 'start' });
  };

  return (
    <nav ref={nav} className="pagination flex flex-col items-center justify-center gap-2 border-t border-line px-3.5 py-2.5 text-center text-small" aria-label={`صفحه‌های ${label}`}>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-muted">
        <span role="status">
          نمایش {formatNumber(from)} تا {formatNumber(to)} از {formatNumber(total)}
        </span>
        {onPageSize ? (
          <label className="flex items-center gap-1.5">
            در هر صفحه
            <select className="min-h-9 rounded-control border border-line bg-surface px-2 text-ink" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {formatNumber(size)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {last > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-0.5">
          <button type="button" className={PAGE_BUTTON} disabled={page <= 1} onClick={() => go(page - 1)}>
            قبلی
          </button>
          {pageList(page, last).map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} className="px-1 text-muted" aria-hidden="true">
                …
              </span>
            ) : (
              <button key={item} type="button" className={`${PAGE_BUTTON} ${item === page || item === 1 || item === last ? '' : 'max-sm:hidden'}`} aria-label={`صفحه ${formatNumber(item)}`} aria-current={item === page ? 'page' : undefined} onClick={() => go(item)}>
                {formatNumber(item)}
              </button>
            ),
          )}
          <button type="button" className={PAGE_BUTTON} disabled={page >= last} onClick={() => go(page + 1)}>
            بعدی
          </button>
        </div>
      ) : null}
    </nav>
  );
}

export function Crumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="مسیر صفحه" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-label [&_a]:inline-flex [&_a]:min-h-touch-target [&_a]:items-center [&_a]:font-semibold">
      {items.map((item, index) => (
        <span className="flex flex-wrap items-center gap-2" key={item.label}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-muted">
              /
            </span>
          ) : null}
          {item.to ? (
            <Link to={item.to}>{item.label}</Link>
          ) : (
            <span aria-current="page" className="font-bold">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog ref={ref} className="max-h-[calc(100vh-48px)] w-[min(620px,calc(100vw-32px))] rounded-card border border-line bg-surface text-ink" onClose={onClose} aria-label={title}>
      {open ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <h2>{title}</h2>
            <Button variant="ghost" onClick={onClose}>
              بستن
            </Button>
          </div>
          <div className="p-4">{children}</div>
        </>
      ) : null}
    </dialog>
  );
}

export function Money({ rial, unit = true }: { rial: number; unit?: boolean }) {
  return (
    <span className="tabular-nums">
      {formatToman(rial)}
      {unit ? ' تومان' : ''}
    </span>
  );
}

/** `onDark` is for the navy money band, where the hospital share needs a lighter blue. */
export function SplitBar({ split, onDark }: { split: FeeSplit; onDark?: boolean }) {
  const total = split.hospitalRial + split.insuranceRial + split.managementRial;
  const width = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div
      className={`flex h-3.5 gap-0.5 overflow-hidden rounded-split ${onDark ? 'bg-nav-active' : 'bg-surface-2'}`}
      role="img"
      aria-label={`سهم بیمارستان ${formatToman(split.hospitalRial)}، بیمه ${formatToman(split.insuranceRial)}، مدیریت ${formatToman(split.managementRial)} تومان`}
    >
      <div className={onDark ? 'bg-[#5b83ff]' : 'bg-share-hospital'} style={{ width: width(split.hospitalRial) }} />
      <div className="bg-share-insurance" style={{ width: width(split.insuranceRial) }} />
      <div className="bg-share-management" style={{ width: width(split.managementRial) }} />
    </div>
  );
}

export function TotalsBlock({ totals, single }: { totals: Totals; single?: boolean }) {
  const count = new Intl.NumberFormat('fa-IR');
  const shares = [
    { label: single ? 'سهم بیمارستان' : 'سهم بیمارستان‌ها', rial: totals.hospitalRial, swatch: 'bg-[#5b83ff]' },
    { label: 'سهم بیمه', rial: totals.insuranceRial, swatch: 'bg-share-insurance' },
    { label: 'سهم مدیریت', rial: totals.managementRial, swatch: 'bg-share-management' },
  ];
  const label = 'flex items-center gap-1.5 text-caption font-medium text-nav-muted';
  const figure = 'kpi-value text-figure leading-[1.35] font-extrabold tabular-nums';
  return (
    <section
      className="flex flex-wrap gap-x-9 gap-y-4.5 rounded-[20px] bg-nav-bg bg-[repeating-radial-gradient(circle_at_0%_100%,transparent_0_44px,rgb(120_150_255/14%)_44px_45px)] px-7.5 py-6.5 text-nav-ink shadow-card"
      aria-label="خلاصه فایل‌ها و کارمزد"
    >
      <div className="flex flex-wrap gap-x-9 gap-y-3.5">
        <div>
          <div className={label}>فایل‌های ZIP دریافتی</div>
          <div className={figure}>{count.format(totals.received)}</div>
          <div className="text-micro text-nav-muted">
            {count.format(totals.accepted)} پذیرفته‌شده، {count.format(totals.notBillable)} بدون کارمزد
          </div>
        </div>
        <div>
          <div className={label}>جمع کارمزد</div>
          <div className={figure}>{formatToman(totals.feeRial)}</div>
          <div className="text-micro text-nav-muted">تومان</div>
        </div>
      </div>
      <div className="flex min-w-0 flex-[1_1_340px] flex-col justify-center gap-3">
        <SplitBar split={totals} onDark />
        <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
          {shares.map((share) => (
            <div key={share.label} className="max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-2">
              <div className={label}>
                <span aria-hidden="true" className={`size-2.5 flex-none rounded-swatch ${share.swatch}`} />
                {share.label}
              </div>
              <div className="kpi-value text-heading leading-[1.35] font-bold tabular-nums">{formatToman(share.rial)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ViewAsBanner({ name, onExit }: { name: string; onExit: () => void }) {
  const navigate = useNavigate();
  return (
    <div className={`${GUTTER} bg-accent-soft py-1.5 text-label text-accent-soft-ink`} role="status">
      <div className="mx-auto w-full max-w-page flex flex-wrap items-center gap-2 justify-between">
        <span>
          مدیر کل، شما داخل حساب <strong>{name}</strong> هستید.
        </span>
        <button
          type="button"
          className={LINK_BUTTON}
          onClick={() => {
            onExit();
            navigate('/admin/accounts');
          }}
        >
          برگشت به پنل مدیریت
        </button>
      </div>
    </div>
  );
}

export function BrandMark({ large }: { large?: boolean }) {
  const size = large ? 30 : 20;
  return (
    <span className={`flex flex-none items-center justify-center bg-accent text-accent-ink ${large ? 'size-13 rounded-card' : 'size-8.5 rounded-mark'}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 4v5M12 15v5M4 12h5M15 12h5" />
      </svg>
    </span>
  );
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="text-muted">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** The sign-in pages: a brand panel beside the form on wide screens, above it on phones. */
export function AuthLayout({ tagline, children, patient, steps }: { tagline: string; children: ReactNode; patient?: boolean; steps?: string[] }) {
  return (
    <div className={`flex min-h-dvh max-lg:block ${patient ? 'patient text-patient-body leading-[1.75]' : ''}`}>
      <aside className="relative flex max-w-[520px] flex-[0_0_38%] flex-col justify-center gap-4.5 overflow-hidden bg-nav-bg bg-[repeating-radial-gradient(circle_at_100%_100%,transparent_0_46px,rgb(120_150_255/16%)_46px_47px)] px-8 py-12 text-nav-ink xl:px-14 max-lg:max-w-none max-lg:flex-row max-lg:items-center max-lg:justify-start max-lg:px-5 max-lg:py-4.5 max-lg:[&>span:first-child]:size-10.5">
        <BrandMark large />
        <div className="[&_span]:text-nav-muted [&_strong]:block [&_strong]:text-[1.5rem] [&_strong]:leading-[1.4] max-lg:[&_strong]:text-[1rem]">
          <strong>سامانه مدارک تصویربرداری و بیمه</strong>
          <span>{tagline}</span>
        </div>
        {steps ? (
          <ol className="mt-8 flex flex-col gap-5.5 max-lg:hidden">
            {steps.map((step, index) => (
              <li key={step} className={`flex items-center gap-2.5 text-[1.25rem] ${index === 0 ? 'font-bold text-nav-ink' : 'font-medium text-[#c3cbe4]'}`}>
                <span className={`inline-flex size-10 flex-none items-center justify-center rounded-full border-[1.5px] text-[1rem] font-bold ${index === 0 ? 'border-accent bg-accent' : 'border-[#3b4a7a]'}`}>{toFaDigits(index + 1)}</span>
                {step}
              </li>
            ))}
          </ol>
        ) : null}
      </aside>
      <main className={`${GUTTER} flex min-w-0 flex-1 items-center justify-center py-8 max-lg:block max-lg:pt-6 max-lg:pb-10`}>
        <div className="flex w-full max-w-110 flex-col gap-5 max-lg:mx-auto">{children}</div>
      </main>
    </div>
  );
}
