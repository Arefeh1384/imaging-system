import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../../api/client';
import type { CaseCounts, ConflictCounts, HospitalStats, Totals } from '../../api/types';
import type { NavItem } from '../../components/AppShell';
import { AiOpinionCard, InsuranceShareCard } from '../../components/case';
import { DocumentPanels } from '../../components/documents';
import { PieChart, type PieSlice } from '../../components/PieChart';
import { AiTag, Pagination, buttonClass, ExpandRow, Field, LoadState, Money, PageTitle, TotalsBlock, ResponsiveTable } from '../../components/ui';
import { formatDate, formatDateTime, formatNumber, formatToman, toFaDigits } from '../../lib/format';
import { CONFLICT_LABELS } from '../../lib/labels';
import { Link, useParams, useSearchParam, useSearchUpdate } from '../../lib/router';
import { usePageParams } from '../../lib/usePageParams';
import { useAsync } from '../../lib/useAsync';
import { InsuranceLayout } from './InsuranceShell';
import { FIELD_ROW, CARD, CARD_FLUSH, INPUT, TEXT_LINK } from '../../components/classes';

const formatPercent = (part: number, whole: number) => `${formatNumber(whole ? Math.round((part / whole) * 100) : 0)}٪`;

const NAV: NavItem[] = [
  { to: '/insurance/admin', label: 'مراکز و نمودارها', icon: 'chart' },
  { to: '/insurance/admin/cases', label: 'پرونده‌ها', icon: 'folder', match: (path) => path.startsWith('/insurance/admin/cases') },
];

const LIVE_MS = 3000;

const statusSlices = (c: CaseCounts): PieSlice[] => [
  { label: 'ارسال‌شده به بیمه', value: c.atInsurer, slot: 3 },
  { label: 'رد به‌خاطر مغایرت', value: c.conflict, slot: 2 },
  { label: 'منتظر بیمار', value: c.waitingPatient, slot: 4 },
  { label: 'در حال بررسی', value: c.processing, slot: 1 },
];

const conflictSlices = (r: ConflictCounts): PieSlice[] => [
  { label: CONFLICT_LABELS.PRESCRIPTION_STUDY, value: r.PRESCRIPTION_STUDY, slot: 1 },
  { label: CONFLICT_LABELS.PRESCRIPTION_NAME, value: r.PRESCRIPTION_NAME, slot: 2 },
  { label: CONFLICT_LABELS.REPORT_IMAGES, value: r.REPORT_IMAGES, slot: 3 },
  { label: CONFLICT_LABELS.PATIENT_DENIED, value: r.PATIENT_DENIED, slot: 4 },
];

const shareSlices = (t: Totals): PieSlice[] => [
  { label: 'سهم بیمارستان', value: t.hospitalRial / 10, slot: 1 },
  { label: 'سهم بیمه', value: t.insuranceRial / 10, slot: 2 },
  { label: 'سهم مدیریت', value: t.managementRial / 10, slot: 3 },
];

function HospitalCharts({ hospital }: { hospital: HospitalStats }) {
  return (
    <section className={`${CARD} flex flex-col gap-2`} aria-label={`نمودارهای ${hospital.name}`}>
      <div className="flex items-start justify-between gap-3 [&_h3]:text-[1.05rem]">
        <div>
          <h3>{hospital.name}</h3>
          <Link className={`${TEXT_LINK} text-small`} to={`/insurance/admin/cases?hospital=${hospital.id}`}>
            دیدن پرونده‌ها
          </Link>
        </div>
        <div className="flex flex-col items-end [&_strong]:text-kpi [&_strong]:leading-[1.2]" title="سهم پرونده‌های ارسال‌شده به بیمه از پرونده‌های پذیرفته‌شده">
          <strong>{formatPercent(hospital.cases.atInsurer, hospital.totals.accepted)}</strong>
          <span className="text-small text-muted">ارسال به بیمه</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 [&>*]:flex-[1_1_250px]">
        <PieChart title="وضعیت پرونده‌ها" slices={statusSlices(hospital.cases)} emptyText="پرونده‌ای نیست." />
        <PieChart title="علت‌های مغایرت" slices={conflictSlices(hospital.conflicts)} emptyText="مغایرتی نبوده است." />
      </div>
    </section>
  );
}

function CentersTable({ hospitals, totals, cases, shareRial }: { hospitals: HospitalStats[]; totals: Totals; cases: CaseCounts; shareRial: number }) {
  return (
    <section className={CARD_FLUSH}>
      <ResponsiveTable>
        <table>
          <caption className="sr-only">مراکز درمانی، پرونده‌ها، سهم بیمه و سهم هر طرف از کارمزد</caption>
          <thead>
            <tr>
              <th scope="col">مرکز درمانی</th>
              <th scope="col" className="text-end">پرونده دریافتی</th>
              <th scope="col" className="text-end">ارسال‌شده به بیمه</th>
              <th scope="col" className="text-end">رد به‌خاطر مغایرت</th>
              <th scope="col" className="text-end">منتظر بیمار یا در حال بررسی</th>
              <th scope="col" className="text-end">سهم بیمه از پرونده‌ها</th>
              <th scope="col" className="text-end">بدون کارمزد</th>
              <th scope="col" className="text-end">جمع کارمزد</th>
              <th scope="col" className="text-end">سهم بیمارستان</th>
              <th scope="col" className="text-end">سهم بیمه</th>
              <th scope="col" className="text-end">سهم مدیریت</th>
            </tr>
          </thead>
          <tbody>
            {hospitals.map((h) => (
              <ExpandRow key={h.id} id={h.id} label={h.name}>
                <td className="whitespace-normal">
                  <Link className="font-semibold text-accent pointer-coarse:inline-flex pointer-coarse:min-h-touch-target pointer-coarse:items-center" to={`/insurance/admin/cases?hospital=${h.id}`}>
                    {h.name}
                  </Link>
                </td>
                <td className="text-end">{formatNumber(h.totals.received)}</td>
                <td className="text-end">{formatNumber(h.cases.atInsurer)}</td>
                <td className="text-end">{formatNumber(h.cases.conflict)}</td>
                <td className="text-end">{formatNumber(h.cases.waitingPatient + h.cases.processing)}</td>
                <td className="text-end font-bold">{formatToman(h.insurerShareRial)}</td>
                <td className="text-end">{formatNumber(h.totals.notBillable)}</td>
                <td className="text-end">{formatToman(h.totals.feeRial)}</td>
                <td className="text-end">{formatToman(h.totals.hospitalRial)}</td>
                <td className="text-end">{formatToman(h.totals.insuranceRial)}</td>
                <td className="text-end">{formatToman(h.totals.managementRial)}</td>
              </ExpandRow>
            ))}
          </tbody>
          <tfoot>
            <ExpandRow id="total" label="جمع کل">
              <td>جمع کل</td>
              <td className="text-end">{formatNumber(totals.received)}</td>
              <td className="text-end">{formatNumber(cases.atInsurer)}</td>
              <td className="text-end">{formatNumber(cases.conflict)}</td>
              <td className="text-end">{formatNumber(cases.waitingPatient + cases.processing)}</td>
              <td className="text-end">{formatToman(shareRial)}</td>
              <td className="text-end">{formatNumber(totals.notBillable)}</td>
              <td className="text-end">{formatToman(totals.feeRial)}</td>
              <td className="text-end">{formatToman(totals.hospitalRial)}</td>
              <td className="text-end">{formatToman(totals.insuranceRial)}</td>
              <td className="text-end">{formatToman(totals.managementRial)}</td>
            </ExpandRow>
          </tfoot>
        </table>
      </ResponsiveTable>
    </section>
  );
}

export function InsuranceDashboardPage() {
  const { data, loading, error, reload } = useAsync(() => api.getInsuranceDashboard(), [], LIVE_MS);
  return (
    <InsuranceLayout role="INSURANCE_ADMIN" nav={NAV}>
      <PageTitle title="مراکز درمانی" subtitle="هر مرکز چقدر پرونده فرستاده و بر آن‌ها چه گذشته است" />
      {!data ? (
        <LoadState loading={loading} error={error} onRetry={() => void reload()} />
      ) : (
        <>
          <TotalsBlock totals={data.totals} />
          <section className={`${CARD} flex flex-col gap-2`} aria-label="نمای کلی">
            <h2>نمای کلی</h2>
            <div className="flex flex-wrap gap-4 [&>*]:flex-[1_1_250px] ">
              <PieChart title="وضعیت پرونده‌ها" slices={statusSlices(data.cases)} emptyText="پرونده‌ای نیست." />
              <PieChart title="علت‌های مغایرت" slices={conflictSlices(data.conflicts)} emptyText="مغایرتی نبوده است." />
              <PieChart title="سهم از کارمزد (تومان)" slices={shareSlices(data.totals)} emptyText="کارمزدی ثبت نشده است." />
            </div>
          </section>
          <CentersTable hospitals={data.hospitals} totals={data.totals} cases={data.cases} shareRial={data.insurerShareRial} />
          <h2>نمودار هر مرکز درمانی</h2>
          <div className="hospital-charts flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_min(100%,520px)]">
            {data.hospitals.map((h) => (
              <HospitalCharts key={h.id} hospital={h} />
            ))}
          </div>
          <p className="text-small text-muted">پرونده‌هایی که مغایرت داشتند هرگز به پنل بیمه نمی‌رسند. سهم بیمه از پرونده‌ها با تعرفه هر نوع تصویربرداری حساب شده است. مبالغ به تومان است.</p>
        </>
      )}
    </InsuranceLayout>
  );
}

export function InsuranceCasesPage() {
  const [hospital] = useSearchParam('hospital');
  const updateSearch = useSearchUpdate();
  const { page, pageSize, setPage, setPageSize } = usePageParams();
  const dashboard = useAsync(() => api.getInsuranceDashboard(), []);
  const { data, loading, error, reload } = useAsync(() => api.listInsuranceCases({ hospitalId: hospital || undefined, page, pageSize }), [hospital, page, pageSize], LIVE_MS, { keepPrevious: true });
  return (
    <InsuranceLayout role="INSURANCE_ADMIN" nav={NAV}>
      <PageTitle title="پرونده‌ها" subtitle={data ? `${formatNumber(data.total)} پرونده که هوش مصنوعی در آن‌ها مغایرتی ندید` : undefined} />
      <div className={`${CARD} ${FIELD_ROW}`}>
        <Field id="case-hospital" label="مرکز درمانی">
          <select id="case-hospital" className={INPUT} value={hospital} onChange={(e) => updateSearch({ hospital: e.target.value, page: '' })}>
            <option value="">همه مراکز</option>
            {(dashboard.data?.hospitals ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!data ? (
        <LoadState loading={loading} error={error} onRetry={() => void reload()} />
      ) : (
        <section className={CARD_FLUSH}>
          <ResponsiveTable keep={[0, 3]}>
            <table>
              <caption className="sr-only">پرونده‌های رسیده به بیمه و سهم بیمه هر کدام</caption>
              <thead>
                <tr>
                  <th scope="col">بیمار و تصویربرداری</th>
                  <th scope="col">مرکز درمانی</th>
                  <th scope="col">تاریخ ارسال</th>
                  <th scope="col" className="text-end">سهم بیمه</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <ExpandRow key={r.caseId} id={r.caseId} label={r.patientName}>
                    <td className="group/cell relative min-w-[160px] whitespace-normal hover:bg-accent-soft/50">
                      <Link className="case-link flex flex-col items-start gap-0.5 no-underline after:absolute after:inset-0 after:content-['']" to={`/insurance/admin/cases/${r.caseId}`}>
                        <span className="font-bold text-accent underline underline-offset-4 group-hover/cell:decoration-2">{r.patientName}</span>
                        <span className="text-small font-normal text-muted">{r.studyTitle}</span>
                      </Link>
                    </td>
                    <td className="whitespace-normal">{r.hospitalName}</td>
                    <td>{formatDate(r.submittedAt ?? r.receivedAt)}</td>
                    <td className="text-end font-bold">{r.insurerShareRial !== undefined ? formatToman(r.insurerShareRial) : '—'}</td>
                  </ExpandRow>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
          {data.total === 0 ? <p className="p-4 text-center text-muted">پرونده‌ای با این مشخصات پیدا نشد.</p> : null}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} label="پرونده‌ها" />
        </section>
      )}
    </InsuranceLayout>
  );
}

/** One case: the prescription, the doctor's opinion, the pictures, and the share the AI worked out. */
export function InsuranceCasePage() {
  const { caseId } = useParams();
  const { data: record, loading, error, reload } = useAsync(() => api.getInsuranceCase(caseId), [caseId]);

  // The header wraps on narrower screens, and the side column has to stay clear of it.
  const head = useRef<HTMLElement>(null);
  const [headHeight, setHeadHeight] = useState(104);
  const hasRecord = !!record;
  useLayoutEffect(() => {
    const node = head.current;
    if (!node) return;
    const measure = () => setHeadHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasRecord]);

  return (
    <InsuranceLayout role="INSURANCE_ADMIN" nav={NAV}>
      {!record ? (
        <LoadState loading={loading} error={error} onRetry={() => void reload()} />
      ) : (
        <>
          <header ref={head} className="review-head sticky top-0 z-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5 border-b border-line bg-surface pt-4 pb-5 max-lg:static">
            <div className="flex min-w-0 flex-[1_1_420px] flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className="inline-flex size-15 flex-none items-center justify-center rounded-full bg-nav-bg text-[1.3rem] font-bold text-nav-ink" aria-hidden="true">
                {record.patient.name.slice(0, 1)}
              </span>
              <div className="[&_h1]:text-[1.6rem]">
                <h1>{record.patient.name}</h1>
                <p className="text-small text-muted">
                  {record.study.title}، {record.hospitalName}
                </p>
                <p className="text-small text-muted">
                  کد ملی {toFaDigits(record.patient.nationalId)}، تاریخ تولد {toFaDigits(record.patient.birthDate)}
                </p>
              </div>
              <p className="ai-ok inline-flex flex-wrap items-center gap-1.5 rounded-control bg-ok-bg px-3 py-2 text-label font-semibold text-ok-ink" role="status">
                <AiTag />
                مغایرتی دیده نشد
              </p>
            </div>
            <Link className={buttonClass('secondary')} to="/insurance/admin/cases">
              برگشت به پرونده‌ها
            </Link>
          </header>

          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-[999_1_500px] rounded-card bg-surface-2 p-4.5 max-lg:bg-transparent max-lg:p-0">
              <DocumentPanels key={record.id} record={record} keys={['prescription', 'report', 'images']} alarms={[]} titles={{ report: 'نظر پزشک (گزارش رادیولوژیست)' }} />
            </div>
            <aside style={{ '--head-h': `${headHeight}px` } as CSSProperties} className="flex max-w-full min-w-0 flex-[1_1_320px] flex-col gap-4 min-[992px]:sticky min-[992px]:top-[calc(var(--head-h)+8px)] min-[992px]:max-h-[calc(100dvh-var(--head-h)-16px)] min-[992px]:overflow-y-auto">
              {record.insuranceShare ? (
                <section className={`${CARD} flex flex-col gap-2`} aria-label="سهم بیمه">
                  <InsuranceShareCard share={record.insuranceShare} />
                  <div className="flex flex-col gap-1 text-small">
                    {record.trackingNumber ? (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">شماره پیگیری</span>
                        <bdi dir="ltr">{record.trackingNumber}</bdi>
                      </div>
                    ) : null}
                    {record.submittedAt ? (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">ارسال بیمار</span>
                        <span>{formatDateTime(record.submittedAt)}</span>
                      </div>
                    ) : null}
                    {record.patient.insurance ? (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">بیمه‌نامه</span>
                        <bdi dir="ltr">{record.patient.insurance.policyNumber}</bdi>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
              <section className={`${CARD} flex flex-col gap-2`}>
                <h2>بررسی هوش مصنوعی</h2>
                <AiOpinionCard opinion={record.aiOpinion} />
              </section>
              <p className="text-small text-muted">
                بیمار نسخه، گزارش و تصویر رسیده از بیمارستان را تأیید کرده است. سهم بیمه <Money rial={record.insuranceShare?.insurerShareRial ?? 0} /> از تعرفه بیمه حساب شده است.
              </p>
            </aside>
          </div>
        </>
      )}
    </InsuranceLayout>
  );
}
