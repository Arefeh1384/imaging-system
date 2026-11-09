// The main admin reviews nothing, but can open every account in the system.
// Each opening is recorded, and actions taken there are marked as done by the admin.
import { useState } from 'react';
import { api } from '../../api/client';
import type { StaffRole } from '../../api/types';
import { Button, LoadState, Notice, PageTitle, Pagination, ExpandItem, ExpandList } from '../../components/ui';
import { formatDateTime, formatNumber, toFaDigits } from '../../lib/format';
import { homeForRole, ROLE_LABELS } from '../../lib/labels';
import { useNavigate } from '../../lib/router';
import { setPatientSession, setStaffSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { usePageParams } from '../../lib/usePageParams';
import { INPUT } from '../../components/classes';
import { CARD_FLUSH, CARD_HEAD, LIST_ROW } from '../../components/classes';

const STAFF_GROUPS: Array<{ role: StaffRole; title: string }> = [{ role: 'INSURANCE_ADMIN', title: 'پنل بیمه' }];

function StaffGroup({ role, title, onOpen }: { role: StaffRole; title: string; onOpen: (id: string) => void }) {
  const { page, pageSize, setPage } = usePageParams(role.toLowerCase());
  const { data, loading, error, reload } = useAsync(() => api.listAllStaff({ role, page, pageSize }), [role, page, pageSize], undefined, { keepPrevious: true });
  return (
    <section className={CARD_FLUSH} aria-label={title}>
      <div className={CARD_HEAD}>
        <h2>{title}</h2>
      </div>
      {!data ? <LoadState loading={loading} error={error} onRetry={() => void reload()} /> : null}
      <ExpandList>
        {data?.items.map((a) => (
          <ExpandItem
            key={a.id}
            id={a.id}
            label={a.name}
            summary={<div className="font-bold">{a.name}</div>}
            details={
              <div className="text-small text-muted">
                {ROLE_LABELS[a.role]}، <bdi dir="ltr">{a.username}</bdi>، {a.active ? 'فعال' : 'غیرفعال'}
              </div>
            }
            actions={
              <Button variant="secondary" aria-label={`باز کردن حساب ${a.name}`} onClick={() => onOpen(a.id)}>
                باز کردن حساب
              </Button>
            }
          />
        ))}
      </ExpandList>
      {data ? <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} label={title} /> : null}
    </section>
  );
}

function PatientList({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const { page, pageSize, setPage, setPageSize } = usePageParams('patients');
  const { data, loading, error, reload } = useAsync(() => api.listPatients({ search, page, pageSize }), [search, page, pageSize], undefined, { keepPrevious: true });
  return (
    <section className={CARD_FLUSH} aria-label="بیماران">
      <div className={CARD_HEAD}>
        <h2>بیماران</h2>
        <label className="w-full max-w-72">
          <span className="sr-only">جستجوی بیمار</span>
          <input
            id="patient-search"
            className={INPUT}
            placeholder="نام، کد ملی یا موبایل"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {!data ? <LoadState loading={loading} error={error} onRetry={() => void reload()} /> : null}
      {data?.total === 0 ? <p className="p-4 text-center text-muted">بیماری با این مشخصات پیدا نشد.</p> : null}
      <ExpandList>
        {data?.items.map((p) => (
          <ExpandItem
            key={p.id}
            id={p.id}
            label={p.name}
            summary={<div className="font-bold">{p.name}</div>}
            details={<div className="text-small text-muted">کد ملی {toFaDigits(p.nationalId)}، موبایل {toFaDigits(p.mobile)}، {formatNumber(p.caseCount)} پرونده{p.firstInfoDone ? '' : '، اطلاعات بیمه ثبت نشده'}</div>}
            actions={
              <Button variant="secondary" aria-label={`باز کردن حساب ${p.name}`} onClick={() => onOpen(p.id)}>
                باز کردن حساب
              </Button>
            }
          />
        ))}
      </ExpandList>
      {data ? <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} label="بیماران" /> : null}
    </section>
  );
}

function AccessLog() {
  const { page, pageSize, setPage } = usePageParams('log');
  const { data, loading, error, reload } = useAsync(() => api.listAccessLog({ page, pageSize }), [page, pageSize], undefined, { keepPrevious: true });
  return (
    <section className={CARD_FLUSH} aria-label="سابقه ورود مدیر کل به حساب‌ها">
      <div className={CARD_HEAD}>
        <h2>سابقه ورود مدیر کل به حساب‌ها</h2>
      </div>
      {!data ? <LoadState loading={loading} error={error} onRetry={() => void reload()} /> : null}
      {data?.total === 0 ? <p className={`${LIST_ROW} text-small text-muted`}>هنوز حسابی باز نشده است.</p> : null}
      {data?.items.map((item) => (
        <div key={item.id} className={LIST_ROW}>
          <div className="list-main min-w-0 flex-[1_1_240px]">
            <div className="text-small font-bold">
              {item.accountName}، {item.accountLabel}
            </div>
            <div className="text-small text-muted">{formatDateTime(item.at)}</div>
          </div>
        </div>
      ))}
      {data ? <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} label="سابقه ورود" /> : null}
    </section>
  );
}

export function AccountsPage() {
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);

  const openStaff = async (id: string) => {
    setActionError(null);
    try {
      const session = await api.viewAsStaff(id);
      setStaffSession(session);
      navigate(homeForRole(session.role));
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const openPatient = async (id: string) => {
    setActionError(null);
    try {
      setPatientSession(await api.viewAsPatient(id));
      navigate('/portal');
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  return (
    <>
      <PageTitle title="همه حساب‌ها" subtitle="هر بار که حسابی را باز کنید ثبت می‌شود و کارهایی که در آن انجام دهید با نام مدیر کل در پرونده می‌ماند." />
      {actionError ? <Notice tone="bad">{actionError}</Notice> : null}
      {STAFF_GROUPS.map((group) => (
        <StaffGroup key={group.role} role={group.role} title={group.title} onOpen={(id) => void openStaff(id)} />
      ))}
      <PatientList onOpen={(id) => void openPatient(id)} />
      <AccessLog />
    </>
  );
}
