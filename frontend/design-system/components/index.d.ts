// Imaging Claims: props of the shared UI in src/components (ui.tsx, PieChart.tsx, AppShell.tsx).
// Documentation only; the app's own types are the source of truth.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/** Rials. Money always travels as rials and is shown as Toman (rial / 10). */
export type Rial = number;
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
export interface StatusLabel { label: string; tone: Tone }
export interface FeeSplit { hospitalRial: Rial; insuranceRial: Rial; managementRial: Rial }
export interface Totals extends FeeSplit {
  received: number;
  accepted: number;
  notBillable: number;
  feeRial: Rial;
  settledHospitalRial: Rial;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'approve';
export type ButtonSize = 'default' | 'large' | 'patient';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Default 'primary'. */
  variant?: ButtonVariant;
  /** Default 'default'. */
  size?: ButtonSize;
  /** Full width. */
  block?: boolean;
  /** Shows the spinner and disables the button. */
  busy?: boolean;
}
export interface ButtonLinkProps { to: string; variant?: ButtonVariant; children: ReactNode }

export interface FieldProps {
  /** Must match the id of the input passed as children. */
  id: string;
  label: string;
  /** Shown under the input with role="alert". Pair with aria-invalid on the input. */
  error?: string | null;
  hint?: ReactNode;
  /** One `<input className="input">`, `<select className="input">` or `<textarea className="input textarea">`. */
  children: ReactNode;
}

export interface ChipProps { status: StatusLabel }
export interface NoticeProps { tone: Tone; children: ReactNode; busy?: boolean }
export interface LoadStateProps { loading: boolean; error: string | null; onRetry?: () => void }
export interface ToastProps { message: string; onDone: () => void }
export interface ResponsiveTableProps { children: ReactNode; wide?: boolean }
export interface CrumbsProps { items: Array<{ label: string; to?: string }> }
export interface DialogProps { open: boolean; title: string; onClose: () => void; children: ReactNode }
export interface MoneyProps { rial: Rial; unit?: boolean }
export interface SplitBarProps { split: FeeSplit; onDark?: boolean }
export interface PaginationProps { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize?: (size: number) => void; label: string }
export interface TotalsBlockProps { totals: Totals; single?: boolean }
export interface PieSlice { label: string; value: number; slot: 1 | 2 | 3 | 4 }
export interface PieChartProps { title: string; slices: PieSlice[]; emptyText: string }
export interface ViewAsBannerProps { name: string; onExit: () => void }
export interface BrandMarkProps { large?: boolean }
export type IconName = 'folder' | 'user' | 'users' | 'chart' | 'inbox' | 'history' | 'building' | 'file' | 'key' | 'pulse' | 'logout';
export interface IconProps { name: IconName; size?: number }
export interface PageTitleProps { title: string; subtitle?: ReactNode; children?: ReactNode }
export interface AuthLayoutProps { tagline: string; children: ReactNode; patient?: boolean; steps?: string[] }
export interface NavItem { to: string; label: string; icon: IconName; badge?: number; match?: (path: string) => boolean }
export interface AppShellProps {
  subtitle: string;
  homeTo: string;
  userName: string;
  userRole: string;
  nav: NavItem[];
  onLogout: () => void;
  banner?: ReactNode;
  className?: string;
  children: ReactNode;
}

export declare function Button(props: ButtonProps): JSX.Element;
export declare function ButtonLink(props: ButtonLinkProps): JSX.Element;
export declare function Field(props: FieldProps): JSX.Element;
/** A password box with an eye button to show or hide the text. Takes the usual input props, except `type`. */
export declare function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>): JSX.Element;
export declare function Chip(props: ChipProps): JSX.Element;
export declare function Notice(props: NoticeProps): JSX.Element;
export declare function LoadState(props: LoadStateProps): JSX.Element | null;
export declare function Toast(props: ToastProps): JSX.Element;
export declare function ResponsiveTable(props: ResponsiveTableProps): JSX.Element;
export declare function Crumbs(props: CrumbsProps): JSX.Element;
export declare function Dialog(props: DialogProps): JSX.Element;
export declare function Money(props: MoneyProps): JSX.Element;
export declare function SplitBar(props: SplitBarProps): JSX.Element;
export declare function TotalsBlock(props: TotalsBlockProps): JSX.Element;
export declare function PieChart(props: PieChartProps): JSX.Element;
export declare function ViewAsBanner(props: ViewAsBannerProps): JSX.Element;
export declare function BrandMark(props: BrandMarkProps): JSX.Element;
export declare function Icon(props: IconProps): JSX.Element;
export declare function PageTitle(props: PageTitleProps): JSX.Element;
export declare function AuthLayout(props: AuthLayoutProps): JSX.Element;
export declare function AppShell(props: AppShellProps): JSX.Element;
/** Wrap anything that renders Link, Crumbs, ButtonLink, ViewAsBanner or AppShell. In-memory in this bundle. */
export declare function RouterProvider(props: { children: ReactNode }): JSX.Element;
export declare function Link(props: { to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element;
