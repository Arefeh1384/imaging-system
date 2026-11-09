"""The main admin panel: every company, hospital, ZIP and case, the fees, and the accounts.

Shapes match frontend/src/api/types.ts (Overview, HospitalDetail, ZipPage, ZipDetail, StaffAccount, PatientAccount...).
"""
from __future__ import annotations

import secrets
import time

from . import db, files, insurance
from .auth import SESSION_SECONDS, _hash as hash_token
from .config import settings
from .errors import ApiError, not_found
from .gateways import send_sms
from .text import invite_sms, latin_digits

UNKNOWN = {'id': 'unknown', 'name': 'مرکز نامشخص (ZIP بدون اطلاعات خوانا)'}
GROUP_OF = {'WAITING_PATIENT': 'waiting-patient', 'PROCESSING': 'processing', 'AT_INSURER': 'at-insurer', 'REJECTED_CONFLICT': 'conflict'}
ZIP_COLUMNS = ('id, file_name, hospital_id, received_at, size_bytes, status, reject_code, reject_reason, case_id, path, study_title, '
               'fee_rial, hospital_rial, insurance_rial, management_rial, settled, settled_at')


# ---------------------------------------------------------------- shared pieces

def _companies() -> dict[str, dict]:
    return {c['id']: c for c in db.all_rows('SELECT id, name FROM companies')}


def _hospital_dict(h: dict) -> dict:
    return {'id': h['id'], 'companyId': h['company_id'] or db.DEFAULT_COMPANY[0], 'name': h['name'],
            'feeRule': {'feeRial': h['fee_rial'] or 0, 'hospitalRial': h['hospital_rial'] or 0,
                        'insuranceRial': h['insurance_rial'] or 0, 'managementRial': h['management_rial'] or 0}}


def _hospitals() -> list[dict]:
    return db.all_rows('SELECT * FROM hospitals ORDER BY name')


def _find_hospital(hospital_id: str) -> tuple[dict, dict]:
    """(hospital, company) for a hospital id; 'unknown' stands for refused ZIPs whose sender could not be read."""
    companies = _companies()
    if hospital_id in (None, '', UNKNOWN['id']):
        company = companies.get(db.DEFAULT_COMPANY[0]) or {'id': db.DEFAULT_COMPANY[0], 'name': db.DEFAULT_COMPANY[1]}
        return {'id': UNKNOWN['id'], 'companyId': company['id'], 'name': UNKNOWN['name'], 'feeRule': {'feeRial': 0, 'hospitalRial': 0, 'insuranceRial': 0, 'managementRial': 0}}, company
    h = db.one('SELECT * FROM hospitals WHERE id = ?', (hospital_id,))
    if not h:
        raise not_found('این مرکز درمانی پیدا نشد.')
    hospital = _hospital_dict(h)
    company = companies.get(hospital['companyId']) or {'id': hospital['companyId'], 'name': db.DEFAULT_COMPANY[1]}
    return hospital, company


def _zips(where: str = '1', params: tuple | list = ()) -> list[dict]:
    return db.all_rows(f'SELECT {ZIP_COLUMNS} FROM zips WHERE {where} ORDER BY received_at DESC, rowid DESC', params)


def _summary(c: dict) -> dict:
    out = {'stage': c['stage']}
    share = (c.get('insurance_share') or {}).get('insurerShareRial')
    if share is not None:
        out['insurerShareRial'] = share
    if c['stage'] == 'REJECTED_CONFLICT' and c.get('conflict'):
        out['conflictReason'] = c['conflict']['reason']
    return out


def _cases_by_id(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    marks = ','.join('?' for _ in ids)
    rows = db.all_rows(f'SELECT c.id, c.stage, c.insurance_share, c.conflict, c.requested_items, p.name AS patient_name '
                       f'FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id IN ({marks})', ids)
    return {r['id']: r for r in rows}


def _rows(zips: list[dict]) -> list[dict]:
    """ZipRow: the ZIP, where it came from, whose it is, and how its case stands."""
    companies = _companies()
    hospitals = {h['id']: h for h in _hospitals()}
    cases = _cases_by_id([z['case_id'] for z in zips if z['case_id']])
    out = []
    for z in zips:
        h = hospitals.get(z['hospital_id'])
        company = companies.get((h or {}).get('company_id') or db.DEFAULT_COMPANY[0]) or {'name': db.DEFAULT_COMPANY[1]}
        c = cases.get(z['case_id'])
        row = {
            'id': z['id'], 'fileName': z['file_name'], 'hospitalId': z['hospital_id'] or UNKNOWN['id'], 'receivedAt': z['received_at'],
            'sizeBytes': z['size_bytes'], 'status': z['status'], 'studyTitle': z['study_title'] or '',
            'missingAtIntake': (c or {}).get('requested_items') or [],
            'feeRial': z['fee_rial'] or 0,
            'split': {'hospitalRial': z['hospital_rial'] or 0, 'insuranceRial': z['insurance_rial'] or 0, 'managementRial': z['management_rial'] or 0},
            'settled': bool(z['settled']),
            'hospitalName': h['name'] if h else UNKNOWN['name'], 'companyName': company['name'],
        }
        for key, column in (('rejectCode', 'reject_code'), ('rejectReason', 'reject_reason'), ('caseId', 'case_id'), ('settledAt', 'settled_at')):
            if z[column]:
                row[key] = z[column]
        if c:
            row['patientName'] = c['patient_name']
            row['caseSummary'] = _summary(c)
        out.append(row)
    return out


def _activity(hospital_id: str | None = None, limit: int = 8) -> list[dict]:
    """The latest things that happened, across cases and refused ZIPs."""
    where, params = '', []
    if hospital_id:
        where, params = 'WHERE z.hospital_id = ?', [hospital_id]
    events = db.all_rows(
        f'SELECT e.id, e.at, e.actor, e.title, z.id AS zip_id, z.file_name, p.name AS patient_name, h.name AS hospital_name '
        f'FROM events e JOIN cases c ON c.id = e.case_id JOIN zips z ON z.id = c.zip_id JOIN patients p ON p.id = c.patient_id '
        f'LEFT JOIN hospitals h ON h.id = z.hospital_id {where} ORDER BY e.at DESC, e.rowid DESC LIMIT ?', [*params, limit])
    refused = db.all_rows(
        f"SELECT z.id AS zip_id, z.received_at AS at, z.status, z.file_name, h.name AS hospital_name FROM zips z "
        f"LEFT JOIN hospitals h ON h.id = z.hospital_id {where + (' AND' if where else 'WHERE')} z.status != 'READY' "
        f"ORDER BY z.received_at DESC LIMIT ?", [*params, limit])
    items = [{'id': e['id'], 'at': e['at'], 'actor': e['actor'], 'title': e['title'], 'zipId': e['zip_id'], 'fileName': e['file_name'],
              'patientName': e['patient_name'], 'hospitalName': e['hospital_name'] or UNKNOWN['name']} for e in events]
    items += [{'id': f"zip-{r['zip_id']}", 'at': r['at'], 'actor': 'SYSTEM', 'title': 'بسته تکراری دریافت شد' if r['status'] == 'DUPLICATE' else 'بسته ZIP رد شد',
               'zipId': r['zip_id'], 'fileName': r['file_name'], 'hospitalName': r['hospital_name'] or UNKNOWN['name']} for r in refused]
    return sorted(items, key=lambda i: i['at'], reverse=True)[:limit]


def _page(items: list, page: int, page_size: int) -> dict:
    page_size = max(1, min(int(page_size or 10), 100))
    last = max(1, -(-len(items) // page_size))
    page = max(1, min(int(page or 1), last))
    return {'items': items[(page - 1) * page_size:page * page_size], 'total': len(items), 'page': page, 'pageSize': page_size}


# ---------------------------------------------------------------- overview, companies, hospitals

def _company_overview(company: dict, hospitals: list[dict], zips: list[dict]) -> dict:
    mine = [h for h in hospitals if (h['company_id'] or db.DEFAULT_COMPANY[0]) == company['id']]
    ids = {h['id'] for h in mine}
    return {'id': company['id'], 'name': company['name'], 'totals': insurance._totals([z for z in zips if z['hospital_id'] in ids]),
            'hospitals': [{**_hospital_dict(h), 'totals': insurance._totals([z for z in zips if z['hospital_id'] == h['id']])} for h in mine]}


def overview() -> dict:
    zips, hospitals = _zips(), _hospitals()
    companies = sorted(_companies().values(), key=lambda c: (c['id'] == db.DEFAULT_COMPANY[0], c['name']))
    cases = db.all_rows('SELECT stage, conflict FROM cases')
    pipeline = {'waiting-patient': 0, 'processing': 0, 'at-insurer': 0, 'conflict': 0, 'conflictByAi': 0, 'conflictByPatient': 0}
    for c in cases:
        pipeline[GROUP_OF[c['stage']]] += 1
        by = (c['conflict'] or {}).get('by') if c['stage'] == 'REJECTED_CONFLICT' else None
        if by == 'AI':
            pipeline['conflictByAi'] += 1
        elif by == 'PATIENT':
            pipeline['conflictByPatient'] += 1
    out_companies = [_company_overview(c, hospitals, zips) for c in companies if any((h['company_id'] or db.DEFAULT_COMPANY[0]) == c['id'] for h in hospitals)]
    unknown = [z for z in zips if not z['hospital_id']]
    if unknown:  # refused ZIPs whose sender couldn't be read still count in the totals
        default = next((c for c in out_companies if c['id'] == db.DEFAULT_COMPANY[0]), None)
        entry = {**_find_hospital(None)[0], 'totals': insurance._totals(unknown)}
        if default:
            default['hospitals'].append(entry)
            default['totals'] = insurance._totals([z for z in zips if z['hospital_id'] in {h['id'] for h in default['hospitals']} or not z['hospital_id']])
        else:
            out_companies.append({'id': db.DEFAULT_COMPANY[0], 'name': db.DEFAULT_COMPANY[1], 'totals': insurance._totals(unknown), 'hospitals': [entry]})
    return {'totals': insurance._totals(zips), 'companies': out_companies, 'pipeline': pipeline, 'recentActivity': _activity()}


def company(company_id: str) -> dict:
    found = next((c for c in overview()['companies'] if c['id'] == company_id), None)
    if not found:
        raise not_found('این شرکت پیدا نشد.')
    return found


def hospital_detail(hospital_id: str) -> dict:
    hospital, comp = _find_hospital(hospital_id)
    zips = _zips('hospital_id IS NULL') if hospital['id'] == UNKNOWN['id'] else _zips('hospital_id = ?', (hospital_id,))
    return {'hospital': hospital, 'company': {'id': comp['id'], 'name': comp['name']}, 'totals': insurance._totals(zips),
            'recentActivity': _activity(None if hospital['id'] == UNKNOWN['id'] else hospital_id, 6)}


def update_fee_rule(hospital_id: str, rule: dict) -> dict:
    hospital, _ = _find_hospital(hospital_id)
    if hospital['id'] == UNKNOWN['id']:
        raise ApiError(400, 'NOT_BILLABLE', 'این ردیف یک مرکز واقعی نیست.')
    values = [int(rule.get(k, 0)) for k in ('feeRial', 'hospitalRial', 'insuranceRial', 'managementRial')]
    if min(values) < 0 or sum(values[1:]) != values[0]:
        raise ApiError(400, 'SPLIT_MISMATCH', 'جمع سهم‌ها باید با کارمزد برابر باشد.')
    db.update('hospitals', {'id': hospital_id}, dict(zip(('fee_rial', 'hospital_rial', 'insurance_rial', 'management_rial'), values)))
    return hospital_detail(hospital_id)


# ---------------------------------------------------------------- ZIPs

def list_zips(search: str, hospital_id: str | None, group: str, page: int, page_size: int) -> dict:
    if hospital_id == UNKNOWN['id']:
        zips = _zips('hospital_id IS NULL')
    elif hospital_id:
        zips = _zips('hospital_id = ?', (hospital_id,))
    else:
        zips = _zips()
    rows = _rows(zips)
    needle = latin_digits(search or '').strip().lower()
    if needle:
        rows = [r for r in rows if needle in r['fileName'].lower() or needle in r['studyTitle'] or needle in (r.get('patientName') or '') or needle in r['hospitalName']]
    if group == 'accepted':
        rows = [r for r in rows if r['status'] == 'READY']
    elif group == 'not-billable':
        rows = [r for r in rows if r['status'] != 'READY']
    elif group == 'unsettled':
        rows = [r for r in rows if r['status'] == 'READY' and not r['settled']]
    elif group in ('waiting-patient', 'processing', 'at-insurer', 'conflict'):
        rows = [r for r in rows if r.get('caseSummary') and GROUP_OF[r['caseSummary']['stage']] == group]
    total = {'feeRial': sum(r['feeRial'] for r in rows), 'hospitalRial': sum(r['split']['hospitalRial'] for r in rows),
             'insuranceRial': sum(r['split']['insuranceRial'] for r in rows), 'managementRial': sum(r['split']['managementRial'] for r in rows)}
    return {**_page(rows, page, page_size), 'sum': total}


def _zip_row(zip_id: str) -> dict:
    z = _zips('id = ?', (zip_id,))
    if not z:
        raise not_found('این ZIP پیدا نشد.')
    return z[0]


def zip_detail(zip_id: str) -> dict:
    z = _zip_row(zip_id)
    hospital, comp = _find_hospital(z['hospital_id'])
    out = {'zip': _rows([z])[0], 'company': {'id': comp['id'], 'name': comp['name']}, 'hospital': hospital}
    if z['case_id']:
        c = db.one('SELECT * FROM cases WHERE id = ?', (z['case_id'],))
        if c:
            out['caseRecord'] = insurance.record_of(c, invite_token=True)
    return out


def zip_file(zip_id: str) -> tuple[bytes, str]:
    z = _zip_row(zip_id)
    if not z['path'] or not files.abs_path(z['path']).exists():
        raise ApiError(404, 'NO_FILE', 'فایل این ZIP نگه داشته نشده است (ZIPهای ردشده پیش از این نسخه نگه داشته نمی‌شدند).')
    return files.abs_path(z['path']).read_bytes(), z['file_name']


def _log_on_case(zip_row: dict, title: str) -> None:
    if zip_row['case_id']:
        db.log_event(zip_row['case_id'], 'ADMIN', title)


def update_split(zip_id: str, split: dict) -> dict:
    z = _zip_row(zip_id)
    if z['status'] != 'READY':
        raise ApiError(409, 'NOT_BILLABLE', 'این فایل کارمزد ندارد.')
    if z['settled']:
        raise ApiError(409, 'SETTLED', 'این فایل تسویه شده و سهم آن قابل تغییر نیست.')
    values = [int(split.get(k, 0)) for k in ('hospitalRial', 'insuranceRial', 'managementRial')]
    if min(values) < 0 or sum(values) != (z['fee_rial'] or 0):
        raise ApiError(400, 'SPLIT_MISMATCH', 'جمع سهم‌ها باید با کارمزد برابر باشد.')
    db.update('zips', {'id': zip_id}, dict(zip(('hospital_rial', 'insurance_rial', 'management_rial'), values)))
    _log_on_case(z, 'سهم‌های کارمزد این ZIP تغییر کرد')
    return zip_detail(zip_id)


def settle(zip_id: str) -> dict:
    z = _zip_row(zip_id)
    if z['status'] != 'READY':
        raise ApiError(409, 'NOT_BILLABLE', 'این فایل کارمزد ندارد.')
    if not z['settled']:
        db.update('zips', {'id': zip_id}, {'settled': 1, 'settled_at': db.now_iso()})
        _log_on_case(z, 'تسویه این ZIP ثبت شد')
    return zip_detail(zip_id)


def resend_invite(case_id: str) -> dict:
    c = db.one('SELECT * FROM cases WHERE id = ?', (case_id,))
    if not c:
        raise not_found()
    if c['stage'] != 'WAITING_PATIENT':
        raise ApiError(409, 'NOT_NEEDED', 'بیمار مدارک را ارسال کرده است.')
    patient = db.one('SELECT mobile FROM patients WHERE id = ?', (c['patient_id'],))
    send_sms(patient['mobile'], invite_sms(f"{settings.portal_url}/c/{c['invite_token']}"), 'REMINDER', case_id)
    db.log_event(case_id, 'ADMIN', 'پیامک یادآوری برای بیمار ارسال شد')
    return zip_detail(c['zip_id'])


# ---------------------------------------------------------------- accounts

def list_staff(role: str, page: int, page_size: int) -> dict:
    rows = db.all_rows('SELECT id, role, name, username, active, created_at FROM staff WHERE role = ? ORDER BY created_at, rowid', (role,))
    items = [{'id': r['id'], 'role': r['role'], 'name': r['name'], 'username': r['username'], 'active': bool(r['active']), 'createdAt': r['created_at']} for r in rows]
    return _page(items, page, page_size)


def list_patients(search: str, page: int, page_size: int) -> dict:
    needle = latin_digits(search or '').strip()
    rows = db.all_rows('SELECT p.*, (SELECT COUNT(*) FROM cases c WHERE c.patient_id = p.id) AS case_count FROM patients p ORDER BY p.created_at DESC, p.rowid DESC')
    items = [{'id': p['id'], 'name': p['name'], 'nationalId': p['national_id'], 'mobile': p['mobile'], 'caseCount': p['case_count'], 'firstInfoDone': bool(p['insurer'])}
             for p in rows if not needle or needle in p['name'] or needle in p['national_id'] or needle in p['mobile']]
    return _page(items, page, page_size)


def list_access_log(page: int, page_size: int) -> dict:
    rows = db.all_rows('SELECT id, at, account_name, account_label FROM access_log ORDER BY at DESC, rowid DESC')
    return _page([{'id': r['id'], 'at': r['at'], 'accountName': r['account_name'], 'accountLabel': r['account_label']} for r in rows], page, page_size)


def _log_access(admin: dict, name: str, label: str) -> None:
    db.insert('access_log', {'id': db.new_id('ac'), 'at': db.now_iso(), 'account_name': name, 'account_label': label, 'admin_name': admin['name']})


def view_as_patient(admin: dict, patient_id: str) -> dict:
    """A patient session the main admin opens to see what the patient sees. Every use is in the access log."""
    p = db.one('SELECT id, name FROM patients WHERE id = ?', (patient_id,))
    if not p:
        raise not_found('این حساب پیدا نشد.')
    token, now = secrets.token_urlsafe(32), time.time()
    db.insert('sessions', {'token_hash': hash_token(token), 'patient_id': p['id'], 'created_at': now, 'expires_at': now + SESSION_SECONDS})
    _log_access(admin, p['name'], 'بیمار')
    return {'role': 'PATIENT', 'token': token, 'patientId': p['id'], 'viewAs': True}


def view_as_staff(admin: dict, account_id: str) -> dict:
    account = db.one("SELECT * FROM staff WHERE id = ? AND role = 'INSURANCE_ADMIN'", (account_id,))
    if not account:
        raise not_found('این حساب پیدا نشد.')
    token, now = secrets.token_urlsafe(32), time.time()
    db.insert('staff_sessions', {'token_hash': hash_token(token), 'staff_id': account['id'], 'created_at': now, 'expires_at': now + SESSION_SECONDS})
    _log_access(admin, account['name'], 'پنل بیمه')
    return {'role': account['role'], 'token': token, 'accountId': account['id'], 'name': account['name'], 'viewAs': True}
