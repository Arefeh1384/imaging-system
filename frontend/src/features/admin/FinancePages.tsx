import { ZipDownload, zipTitle } from './zipParts';
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { api } from '../../api/client';
import type { ActivityItem, CaseGroup, FeeRule, OverviewCompany, Pipeline, ZipFilter, ZipRow, ZipPage } from '../../api/types';
import { Pagination, noticeClass, Button, Chip, Crumbs, Field, LoadState, Money, Notice, PageTitle, TotalsBlock, ResponsiveTable, ExpandRow } from '../../components/ui';
import { formatDateTime, formatNumber, formatShortDate, formatToman, parseWholeNumber, rialToToman, tomanToRial, toFaDigits } from '../../lib/format';
import { ACTOR_LABELS, actorTone, zipStatusLabel } from '../../lib/labels';
import type { Tone } from '../../lib/labels';
import { Link, useParams, useSearchParam, useSearchUpdate } from '../../lib/router';
import { usePageParams } from '../../lib/usePageParams';
import { useAsync } from '../../lib/useAsync';
import { FIELD_ROW, CARD, CARD_FLUSH, CARD_HEAD, INPUT, TEXT_LINK } from '../../components/classes';

function HospitalTable({ company }: { company: OverviewCompany }) {
  const t = company.totals;
  return (
    <section className={CARD_FLUSH}>
      <div className={CARD_HEAD}>
        <h2>{company.name}</h2>
        <Link className={`${TEXT_LINK} text-small`} to={`/admin/companies/${company.id}`}>
          صفحه شرکت
        </Link>
      </div>
      <ResponsiveTable>
        <table>
          <caption className="sr-only">بیمارستان‌های {company.name}</caption>
          <thead>
            <tr>
              <th scope="col">بیمارستان</th>
              <th scope="col" className="text-end">عایدی بیمارستان</th>
              <th scope="col" className="text-end">ZIP دریافتی</th>
              <th scope="col" className="text-end">پذیرفته‌شده</th>
              <th scope="col" className="text-end">بدون کارمزد</th>
              <th scope="col" className="text-end">جمع کارمزد</th>
              <th scope="col" className="text-end">سهم بیمه</th>
              <th scope="col" className="text-end">سهم مدیریت</th>
            </tr>
          </thead>
          <tbody>
            {company.hospitals.map((h) => (
              <ExpandRow key={h.id} id={h.id} label={h.name}>
                <td>
                  <Link className="font-semibold text-accent pointer-coarse:inline-flex pointer-coarse:min-h-touch-target pointer-coarse:items-center" to={`/admin/hospitals/${h.id}`}>
                    {h.name}
                  </Link>
                </td>
                <td className="text-end font-bold">{formatToman(h.totals.hospitalRial)}</td>
                <td className="text-end">{formatNumber(h.totals.received)}</td>
                <td className="text-end">{formatNumber(h.totals.accepted)}</td>
                <td className="text-end">{formatNumber(h.totals.notBillable)}</td>
                <td className="text-end">{formatToman(h.totals.feeRial)}</td>
                <td className="text-end">{formatToman(h.totals.insuranceRial)}</td>
                <td className="text-end">{formatToman(h.totals.managementRial)}</td>
              </ExpandRow>
            ))}
          </tbody>
          <tfoot>
            <ExpandRow id="total" label="جمع شرکت">
              <td>جمع شرکت</td>
              <td className="text-end">{formatToman(t.hospitalRial)}</td>
              <td className="text-end">{formatNumber(t.received)}</td>
              <td className="text-end">{formatNumber(t.accepted)}</td>
              <td className="text-end">{formatNumber(t.notBillable)}</td>
              <td className="text-end">{formatToman(t.feeRial)}</td>
              <td className="text-end">{formatToman(t.insuranceRial)}</td>
              <td className="text-end">{formatToman(t.managementRial)}</td>
            </ExpandRow>
          </tfoot>
        </table>
      </ResponsiveTable>
    </section>
  );
}

const LIVE_REFRESH_MS = 3000;

const PIPELINE: Array<{ group: CaseGroup; label: string }> = [
  { group: 'waiting-patient', label: 'در انتظار بیمار' },
  { group: 'processing', label: 'در حال بررسی' },
  { group: 'at-insurer', label: 'ارسال‌شده به بیمه' },
];

/** Where cases are right now: the path a case follows, and the ones rejected for a conflict set apart. */
function PipelineBlock({ pipeline }: { pipeline: Pipeline }) {
  return (
    <section className="flex flex-wrap gap-2.5" aria-label="وضعیت پرونده‌ها">
      <div className="grid min-w-0 flex-[999_1_420px] grid-cols-3 overflow-hidden rounded-card border border-line bg-surface max-sm:grid-cols-2">
        {PIPELINE.map((step) => (
          <Link key={step.group} className="pipe relative flex flex-col gap-0.5 px-4 py-3.5 text-inherit no-underline not-last:after:absolute not-last:after:top-1/2 not-last:after:-end-[7px] not-last:after:z-1 not-last:after:size-3.5 not-last:after:border-b-2 not-last:after:border-l-2 not-last:after:border-line-strong not-last:after:[transform:translateY(-50%)_rotate(45deg)] hover:bg-surface-2 data-[group=at-insurer]:bg-ok-bg data-[group=at-insurer]:text-ok-ink" to={`/admin/zips?group=${step.group}`} data-group={step.group}>
            <span className="pipe-value text-[1.8rem] leading-[1.4] font-bold tabular-nums">{formatNumber(pipeline[step.group])}</span>
            <span className="text-small">{step.label}</span>
          </Link>
        ))}
      </div>
      <Link className="pipe flex flex-[1_1_200px] flex-col gap-0.5 rounded-card bg-bad-bg px-4 py-3.5 font-semibold text-bad-ink no-underline" to="/admin/zips?group=conflict" data-group="conflict">
        <span className="pipe-value text-[1.8rem] leading-[1.4] font-bold tabular-nums">{formatNumber(pipeline.conflict)}</span>
        <span className="text-small">رد به‌خاطر مغایرت</span>
        <span className="conflict-split text-caption font-normal">
          {formatNumber(pipeline.conflictByAi)} با بررسی هوش مصنوعی، {formatNumber(pipeline.conflictByPatient)} به گفته بیمار
        </span>
      </Link>
    </section>
  );
}

const ACTIVITY_DOT: Partial<Record<Tone, string>> = { info: 'after:bg-accent', ok: 'after:bg-ok-ink' };

function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <section className="rounded-card bg-surface-2 p-4.5" aria-label="آخرین فعالیت‌ها">
      <h2>آخرین فعالیت‌ها</h2>
      {items.length === 0 ? <p className="text-small text-muted">هنوز فعالیتی ثبت نشده است.</p> : null}
      <ol className="mt-3 lg:max-2xl:grid lg:max-2xl:grid-cols-2 lg:max-2xl:gap-x-7">
        {items.map((item) => (
          <li key={item.id} className={`relative ps-5.5 pb-3.5 before:absolute before:start-1 before:top-2 before:-bottom-2 before:w-0.5 before:bg-line last:before:hidden after:absolute after:start-0 after:top-[7px] after:size-2.5 after:rounded-full lg:max-2xl:before:hidden [&_a]:flex [&_a]:flex-col [&_a]:text-inherit [&_a]:no-underline ${ACTIVITY_DOT[actorTone(item.actor)] ?? 'after:bg-line-strong'}`}>
            <Link className="group" to={`/admin/zips/${item.zipId}`} aria-label={`${item.title}، ${item.patientName ?? item.hospitalName}`}>
              <span className="leading-[1.5] font-semibold group-hover:text-accent">{item.title}</span>
              <span className="text-small text-muted">
                {item.patientName ? `${item.patientName}، ` : ''}
                {item.hospitalName}
              </span>
              <span className="text-small text-muted">
                {ACTOR_LABELS[item.actor]}، {formatDateTime(item.at)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

const MONEY_NOTE = 'همه مبالغ به تومان است. عایدی یعنی سهم درآمد بیمارستان، پیش از کسر هزینه‌ها. فایل‌های ردشده و تکراری کارمزد ندارند.';

export function OverviewPage() {
  const { data, loading, error, reload } = useAsync(() => api.getOverview(), [], LIVE_REFRESH_MS);
  if (!data) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;
  return (
    <>
      <PageTitle title="شرکت‌ها و بیمارستان‌ها" />
      <PipelineBlock pipeline={data.pipeline} />
      <TotalsBlock totals={data.totals} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex flex-col gap-4">
          {data.companies.map((company) => (
            <HospitalTable key={company.id} company={company} />
          ))}
          <p className="text-small text-muted">{MONEY_NOTE}</p>
        </div>
        <ActivityList items={data.recentActivity.slice(0, 6)} />
      </div>
    </>
  );
}

export function CompanyPage() {
  const { companyId } = useParams();
  const { data, loading, error, reload } = useAsync(() => api.getCompany(companyId), [companyId], LIVE_REFRESH_MS);
  if (!data) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;
  return (
    <>
      <Crumbs items={[{ label: 'همه شرکت‌ها', to: '/admin' }, { label: data.name }]} />
      <h1>{data.name}</h1>
      <TotalsBlock totals={data.totals} />
      <HospitalTable company={data} />
      <p className="text-small text-muted">{MONEY_NOTE}</p>
    </>
  );
}

function ZipTable({ data, onPage, onPageSize }: { data: ZipPage; onPage: (page: number) => void; onPageSize: (size: number) => void; showHospital?: boolean }) {
  const { items: rows, sum, total } = data;
  const amount = (z: ZipRow, rial: number) => (z.status === 'READY' ? formatToman(rial) : '—');
  return (
    <section className={CARD_FLUSH}>
      <ResponsiveTable keep={[0, 1, 3]}>
        <table>
          <caption className="sr-only">فهرست فایل‌های ZIP و سهم هر طرف از کارمزد</caption>
          <thead>
            <tr>
              <th scope="col">بیمار، مرکز درمانی و تاریخ</th>
              <th scope="col">وضعیت</th>
              <th scope="col" className="text-end">کارمزد</th>
              <th scope="col" className="text-end">بیمارستان</th>
              <th scope="col" className="text-end">بیمه</th>
              <th scope="col" className="text-end">مدیریت</th>
              <th scope="col">سهم بیمه یا علت رد</th>
              <th scope="col">فایل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((z) => (
              <ExpandRow key={z.id} id={z.id} label={zipTitle(z)}>
                <td className="group/cell relative min-w-[160px] whitespace-normal hover:bg-accent-soft/50">
                  {/* The whole cell opens the package; the stretched link also covers the cell padding. */}
                  <Link className="zip-link flex flex-col items-start gap-0.5 no-underline after:absolute after:inset-0 after:content-['']" to={`/admin/zips/${z.id}`}>
                    <span className="font-bold text-accent underline underline-offset-4 group-hover/cell:decoration-2">{zipTitle(z)}</span>
                    <span className="text-small font-normal text-muted">
                      {z.hospitalName}، {formatShortDate(z.receivedAt)}
                    </span>
                    <span className="text-small font-normal text-muted">{z.studyTitle}</span>
                  </Link>
                </td>
                <td>
                  <div className="flex flex-col items-start gap-0.5">
                    <Chip status={zipStatusLabel(z)} />
                    {z.status === 'READY' ? <span className="text-small text-muted">{z.settled ? 'تسویه‌شده' : 'تسویه‌نشده'}</span> : null}
                  </div>
                </td>
                <td className="text-end">{amount(z, z.feeRial)}</td>
                <td className="text-end font-bold">{amount(z, z.split.hospitalRial)}</td>
                <td className="text-end">{amount(z, z.split.insuranceRial)}</td>
                <td className="text-end">{amount(z, z.split.managementRial)}</td>
                <td className="min-w-[140px] whitespace-normal text-small">
                  {z.caseSummary?.insurerShareRial !== undefined ? (
                    <span className="font-semibold">{formatToman(z.caseSummary.insurerShareRial)}</span>
                  ) : z.caseSummary?.conflictReason ? (
                    <span className="text-bad-ink">{z.caseSummary.conflictReason}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <ZipDownload zip={z} compact />
                </td>
              </ExpandRow>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted">
                  فایلی با این مشخصات پیدا نشد.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <ExpandRow id="total" label="جمع فایل‌ها">
              <td colSpan={2}>جمع همه {formatNumber(total)} فایل</td>
              <td className="text-end">{formatToman(sum.feeRial)}</td>
              <td className="text-end">{formatToman(sum.hospitalRial)}</td>
              <td className="text-end">{formatToman(sum.insuranceRial)}</td>
              <td className="text-end">{formatToman(sum.managementRial)}</td>
              <td />
              <td />
            </ExpandRow>
          </tfoot>
        </table>
      </ResponsiveTable>
      <Pagination page={data.page} pageSize={data.pageSize} total={total} onPage={onPage} onPageSize={onPageSize} label="فایل‌ها" />
    </section>
  );
}

export function SplitForm({
  idPrefix,
  initial,
  feeEditable,
  locked,
  saveLabel,
  onSave,
  extraActions,
}: {
  idPrefix: string;
  initial: FeeRule;
  feeEditable?: boolean;
  locked?: boolean;
  saveLabel: string;
  onSave: (rule: FeeRule) => Promise<void>;
  extraActions?: (setValues: (rule: FeeRule) => void) => ReactNode;
}) {
  const asText = (rial: number) => toFaDigits(rialToToman(rial));
  const [fee, setFee] = useState(asText(initial.feeRial));
  const [hospital, setHospital] = useState(asText(initial.hospitalRial));
  const [insurance, setInsurance] = useState(asText(initial.insuranceRial));
  const [management, setManagement] = useState(asText(initial.managementRial));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = parseWholeNumber(fee);
  const h = parseWholeNumber(hospital);
  const i = parseWholeNumber(insurance);
  const m = parseWholeNumber(management);
  const valid = f !== null && h !== null && i !== null && m !== null;
  const sum = h !== null && i !== null && m !== null ? h + i + m : null;
  const balanced = valid && sum === f;

  const setValues = (rule: FeeRule) => {
    setFee(asText(rule.feeRial));
    setHospital(asText(rule.hospitalRial));
    setInsurance(asText(rule.insuranceRial));
    setManagement(asText(rule.managementRial));
    setSaved(false);
  };

  const edit = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setSaved(false);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!balanced || f === null || h === null || i === null || m === null) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ feeRial: tomanToRial(f), hospitalRial: tomanToRial(h), insuranceRial: tomanToRial(i), managementRial: tomanToRial(m) });
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit} noValidate>
      {feeEditable ? (
        <Field id={`${idPrefix}-fee`} label="کارمزد هر ZIP (تومان)">
          <input id={`${idPrefix}-fee`} className={`${INPUT} tabular-nums`} inputMode="numeric" dir="ltr" value={fee} onChange={edit(setFee)} disabled={locked} />
        </Field>
      ) : null}
      <Field id={`${idPrefix}-hospital`} label="سهم بیمارستان (تومان)">
        <input id={`${idPrefix}-hospital`} className={`${INPUT} tabular-nums`} inputMode="numeric" dir="ltr" value={hospital} onChange={edit(setHospital)} disabled={locked} />
      </Field>
      <Field id={`${idPrefix}-insurance`} label="سهم بیمه (تومان)">
        <input id={`${idPrefix}-insurance`} className={`${INPUT} tabular-nums`} inputMode="numeric" dir="ltr" value={insurance} onChange={edit(setInsurance)} disabled={locked} />
      </Field>
      <Field id={`${idPrefix}-management`} label="سهم مدیریت (تومان)">
        <input id={`${idPrefix}-management`} className={`${INPUT} tabular-nums`} inputMode="numeric" dir="ltr" value={management} onChange={edit(setManagement)} disabled={locked} />
      </Field>
      <div className={`${noticeClass(balanced ? 'ok' : 'bad')} flex flex-wrap items-center justify-between gap-2`}>
        <span>جمع سهم‌ها</span>
        <span className="tabular-nums">
          {sum === null || f === null ? 'فقط عدد وارد کنید' : `${formatNumber(sum)} از ${formatNumber(f)}`}
        </span>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {saved ? <Notice tone="ok">ذخیره شد و جمع‌های بیمارستان و شرکت به‌روز شد.</Notice> : null}
      {!locked ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" busy={busy} disabled={!balanced}>
            {saveLabel}
          </Button>
          {extraActions?.(setValues)}
        </div>
      ) : null}
    </form>
  );
}

export function HospitalPage() {
  const { hospitalId } = useParams();
  const { data, loading, error, reload, setData } = useAsync(() => api.getHospital(hospitalId), [hospitalId], LIVE_REFRESH_MS);
  const { page, pageSize, setPage, setPageSize } = usePageParams();
  const zips = useAsync(() => api.listZips({ hospitalId, page, pageSize }), [hospitalId, page, pageSize], LIVE_REFRESH_MS, { keepPrevious: true });
  if (!data) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;
  const { hospital, company, totals } = data;
  return (
    <>
      <Crumbs items={[{ label: 'همه شرکت‌ها', to: '/admin' }, { label: company.name, to: `/admin/companies/${company.id}` }, { label: hospital.name }]} />
      <div>
        <div className="text-small text-muted">{company.name}</div>
        <h1>{hospital.name}</h1>
      </div>
      <div className="rounded-[20px] bg-hero px-5 py-4.5 text-hero-ink">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div>
            <div className="text-small">عایدی کل بیمارستان از همه ZIPهای PACS</div>
            <div className="text-[2.1rem] leading-[1.3] font-bold tabular-nums">
              <Money rial={totals.hospitalRial} unit={false} /> <span className="text-[0.95rem] font-medium">تومان</span>
            </div>
          </div>
          <div className="text-small">
            تسویه‌شده {formatToman(totals.settledHospitalRial)}، مانده {formatToman(totals.hospitalRial - totals.settledHospitalRial)}، پیش از کسر هزینه‌ها
          </div>
        </div>
      </div>
      <TotalsBlock totals={totals} single />
      {zips.data ? <ZipTable data={zips.data} onPage={setPage} onPageSize={setPageSize} /> : <LoadState loading={zips.loading} error={zips.error} onRetry={() => void zips.reload()} />}
      <ActivityList items={data.recentActivity} />
      <details className={CARD}>
        <summary className="font-bold" style={{ cursor: 'pointer', minHeight: 28 }}>
          قاعده پیش‌فرض کارمزد این بیمارستان
        </summary>
        <div className="flex flex-col gap-2" style={{ marginTop: 12, maxWidth: 420 }}>
          <p className="text-small text-muted">این قاعده فقط برای ZIPهای جدید اعمال می‌شود و سهم فایل‌های قبلی را تغییر نمی‌دهد.</p>
          <SplitForm
            key={JSON.stringify(hospital.feeRule)}
            idPrefix="rule"
            feeEditable
            initial={hospital.feeRule}
            saveLabel="ذخیره قاعده"
            onSave={async (rule) => {
              setData(await api.updateHospitalFeeRule(hospital.id, rule));
            }}
          />
        </div>
      </details>
    </>
  );
}

const GROUPS: Array<{ value: NonNullable<ZipFilter['group']>; label: string }> = [
  { value: 'all', label: 'همه' },
  { value: 'accepted', label: 'پذیرفته‌شده' },
  { value: 'not-billable', label: 'ردشده و تکراری' },
  { value: 'waiting-patient', label: 'در انتظار بیمار' },
  { value: 'processing', label: 'در حال بررسی' },
  { value: 'at-insurer', label: 'ارسال‌شده به بیمه' },
  { value: 'conflict', label: 'رد به‌خاطر مغایرت' },
  { value: 'unsettled', label: 'تسویه‌نشده' },
];

export function ZipListPage() {
  const [groupParam] = useSearchParam('group');
  const [search, setSearch] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const group = (groupParam || 'all') as NonNullable<ZipFilter['group']>;
  const overview = useAsync(() => api.getOverview(), []);
  const { page, pageSize, setPage, setPageSize } = usePageParams();
  const updateSearch = useSearchUpdate();
  const { data, loading, error, reload } = useAsync(() => api.listZips({ group, search, hospitalId, page, pageSize }), [group, search, hospitalId, page, pageSize], LIVE_REFRESH_MS, { keepPrevious: true });
  const hospitals = overview.data?.companies.flatMap((c) => c.hospitals) ?? [];

  return (
    <>
      <PageTitle title="همه فایل‌های ZIP" />
      <div className={`${CARD} ${FIELD_ROW}`}>
        <Field id="zip-search" label="جستجو">
          <input id="zip-search" className={INPUT} placeholder="نام بیمار، مرکز درمانی یا مطالعه" value={search} onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }} />
        </Field>
        <Field id="zip-hospital" label="بیمارستان">
          <select id="zip-hospital" className={INPUT} value={hospitalId} onChange={(e) => {
              setHospitalId(e.target.value);
              setPage(1);
            }}>
            <option value="">همه بیمارستان‌ها</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="zip-group" label="وضعیت">
          <select id="zip-group" className={INPUT} value={group} onChange={(e) => updateSearch({ group: e.target.value === 'all' ? '' : e.target.value, page: '' })}>
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {data ? <ZipTable data={data} onPage={setPage} onPageSize={setPageSize} showHospital /> : <LoadState loading={loading} error={error} onRetry={() => void reload()} />}
    </>
  );
}
