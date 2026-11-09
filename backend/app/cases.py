"""The patient's side of a case: what they see, and what they can do with it."""
from __future__ import annotations

import re
import time

from . import db, files
from .config import settings
from .errors import ApiError, not_found, not_open
from .gateways import send_sms
from .text import conflict_sms, denied_reason, latin_digits

INSURERS = ['بیمه دانا']
RELATIONS = ['خود شخص', 'همسر', 'فرزند', 'پدر یا مادر']
DOC_LABELS = {'prescription': 'نسخه', 'report': 'گزارش رادیولوژیست'}
UPLOAD_MAX_BYTES = 10 * 1024 * 1024


def profile_of(patient: dict) -> dict:
    out = {'name': patient['name'], 'nationalId': patient['national_id'], 'mobile': patient['mobile'],
           'birthDate': patient.get('birth_date') or '', 'needsFirstInfo': not patient.get('insurer')}
    if patient.get('insurer'):
        out['insurance'] = {'insurer': patient['insurer'], 'policyNumber': patient['policy_number'], 'relation': patient['relation']}
    return out


def save_insurance(patient: dict, insurer: str, policy_number: str, relation: str) -> dict:
    policy = latin_digits(policy_number).strip()
    if not policy:
        raise ApiError(400, 'INVALID_POLICY', 'شماره بیمه‌نامه را بنویسید.')
    if insurer not in INSURERS:
        raise ApiError(400, 'INVALID_INSURER', 'شرکت بیمه را انتخاب کنید.')
    if relation not in RELATIONS:
        raise ApiError(400, 'INVALID_RELATION', 'نسبت با بیمه‌شده را انتخاب کنید.')
    db.update('patients', {'id': patient['id']}, {'insurer': insurer, 'policy_number': policy, 'relation': relation})
    for c in db.all_rows('SELECT id FROM cases WHERE patient_id = ?', (patient['id'],)):
        db.log_event(c['id'], 'PATIENT', 'بیمار اطلاعات بیمه را ثبت کرد')
    return profile_of(db.one('SELECT * FROM patients WHERE id = ?', (patient['id'],)))


def _documents(case_id: str) -> list[dict]:
    return db.all_rows('SELECT * FROM documents WHERE case_id = ? ORDER BY key', (case_id,))


def to_patient_case(c: dict) -> dict:
    """No AI result and no amount here: the patient never receives those."""
    hospital = db.one('SELECT name FROM hospitals WHERE id = ?', (c['hospital_id'],))
    docs = []
    for d in _documents(c['id']):
        item = {'key': d['key'], 'source': d['source'], 'fileName': d['file_name'] or ''}
        preview = files.data_url(d['preview_path'])
        if preview:
            item['previewDataUrl'] = preview
        if d['erx_id']:
            item['eRxId'] = d['erx_id']
        docs.append(item)
    out = {
        'id': c['id'],
        'hospitalName': hospital['name'] if hospital else '',
        # The date the patient had the imaging, which is what the service question asks about.
        'receivedAt': f"{c['study_date']}T09:00:00+03:30",
        'studyTitle': c['study_title'],
        'stage': c['stage'],
        'documents': docs,
        'requestedItems': c['requested_items'],
        'requiredItems': c['required_items'],
        'confirmItems': c['confirm_items'],
        'confirmedItems': c['confirmed_items'],
    }
    if c['stage'] == 'REJECTED_CONFLICT' and c['conflict']:
        out['conflictReason'] = c['conflict']['reason']
    for key, column in (('trackingNumber', 'tracking_number'), ('submittedAt', 'submitted_at')):
        if c[column]:
            out[key] = c[column]
    return out


def list_cases(patient: dict) -> list[dict]:
    rows = db.all_rows('SELECT * FROM cases WHERE patient_id = ? ORDER BY study_date DESC, received_at DESC', (patient['id'],))
    return [to_patient_case(c) for c in rows]


def my_case(patient: dict, case_id: str) -> dict:
    c = db.one('SELECT * FROM cases WHERE id = ?', (case_id,))
    if not c or c['patient_id'] != patient['id']:
        raise not_found()
    return c


def _open_case(patient: dict, case_id: str) -> dict:
    c = my_case(patient, case_id)
    if c['stage'] != 'WAITING_PATIENT':
        raise not_open()
    return c


def reject_for_conflict(c: dict, kind: str, reason: str, by: str) -> None:
    db.update('cases', {'id': c['id']}, {'stage': 'REJECTED_CONFLICT', 'conflict': {'kind': kind, 'reason': reason, 'by': by, 'at': db.now_iso()}, 'process_at': None})
    patient = db.one('SELECT mobile FROM patients WHERE id = ?', (c['patient_id'],))
    hospital = db.one('SELECT name FROM hospitals WHERE id = ?', (c['hospital_id'],))
    send_sms(patient['mobile'], conflict_sms(hospital['name'] if hospital else 'مرکز درمانی'), 'CONFLICT', c['id'])
    db.log_event(c['id'], 'SYSTEM', 'پیامک مغایرت برای بیمار فرستاده شد')


def upload_document(patient: dict, case_id: str, key: str, file_name: str, mime: str, data: bytes) -> dict:
    if key not in DOC_LABELS:
        raise not_found('این نوع مدرک وجود ندارد.')
    c = _open_case(patient, case_id)
    if not (mime.startswith('image/') or mime == 'application/pdf'):
        raise ApiError(400, 'INVALID_FILE', 'فقط عکس یا فایل PDF قابل بارگذاری است.')
    if len(data) > UPLOAD_MAX_BYTES:
        raise ApiError(400, 'INVALID_FILE', 'حجم فایل باید حداکثر ۱۰ مگابایت باشد.')
    existing = db.one('SELECT source FROM documents WHERE case_id = ? AND key = ?', (case_id, key))
    if existing and existing['source'] == 'PACS':
        raise ApiError(409, 'NOT_NEEDED', 'این مدرک از بیمارستان رسیده است.')
    suffix = {'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf', 'image/webp': '.webp', 'image/heic': '.heic'}.get(mime, '.bin')
    folder = files.case_dir(case_id)
    stamp = int(time.time())
    path = folder / f'{key}-patient-{stamp}{suffix}'
    path.write_bytes(data)
    preview = files.make_preview(data)
    preview_rel = None
    if preview:
        ppath = folder / f'{key}-patient-{stamp}-preview.jpg'
        ppath.write_bytes(preview)
        preview_rel = files.rel(ppath)
    db.execute('DELETE FROM documents WHERE case_id = ? AND key = ?', (case_id, key))
    db.insert('documents', {'case_id': case_id, 'key': key, 'source': 'PATIENT', 'file_name': file_name, 'mime_type': mime, 'size_bytes': len(data),
                            'added_at': db.now_iso(), 'path': files.rel(path), 'preview_path': preview_rel})
    db.update('cases', {'id': case_id}, {'required_items': [k for k in c['required_items'] if k != key]})
    db.log_event(case_id, 'PATIENT', f'بیمار {DOC_LABELS[key]} را بارگذاری کرد')
    return to_patient_case(my_case(patient, case_id))


def confirm_item(patient: dict, case_id: str, key: str, yes: bool) -> dict:
    c = _open_case(patient, case_id)
    if key not in c['confirm_items']:
        raise ApiError(409, 'NOT_NEEDED', 'این مورد نیازی به تأیید ندارد.')
    if yes:
        if key not in c['confirmed_items']:
            db.update('cases', {'id': case_id}, {'confirmed_items': [*c['confirmed_items'], key]})
        db.log_event(case_id, 'PATIENT', 'بیمار تأیید کرد این خدمت را دریافت کرده است' if key == 'service' else 'بیمار تأیید کرد نسخه مال اوست')
    else:
        db.log_event(case_id, 'PATIENT', denied_reason(key))
        reject_for_conflict(c, 'PATIENT_DENIED', denied_reason(key), 'PATIENT')
    return to_patient_case(my_case(patient, case_id))


def submit_erx(patient: dict, case_id: str, erx_id: str) -> dict:
    c = _open_case(patient, case_id)
    existing = db.one('SELECT source FROM documents WHERE case_id = ? AND key = ?', (case_id, 'prescription'))
    if existing and existing['source'] == 'PACS':
        raise ApiError(409, 'NOT_NEEDED', 'نسخه شما از بیمارستان رسیده است.')
    code = re.sub(r'[\s-]', '', latin_digits(erx_id))
    if not re.fullmatch(r'[0-9A-Za-z]{6,24}', code):
        raise ApiError(400, 'INVALID_ERX', 'شناسه نسخه الکترونیک را درست بنویسید. فقط عدد و حرف انگلیسی، دست‌کم ۶ نویسه.')
    db.execute('DELETE FROM documents WHERE case_id = ? AND key = ?', (case_id, 'prescription'))
    db.insert('documents', {'case_id': case_id, 'key': 'prescription', 'source': 'PATIENT', 'file_name': f'نسخه الکترونیک {code}',
                            'mime_type': 'application/x-eprescription', 'added_at': db.now_iso(), 'erx_id': code})
    db.update('cases', {'id': case_id}, {'required_items': [k for k in c['required_items'] if k != 'prescription']})
    db.log_event(case_id, 'PATIENT', 'بیمار شناسه نسخه الکترونیک را ثبت کرد')
    return to_patient_case(my_case(patient, case_id))


def submit_case(patient: dict, case_id: str) -> dict:
    """The «تأیید» button. The check runs later, in the background worker."""
    c = my_case(patient, case_id)
    if c['stage'] != 'WAITING_PATIENT':
        return to_patient_case(c)
    if any(k not in c['confirmed_items'] for k in c['confirm_items']):
        raise ApiError(409, 'NOT_CONFIRMED', 'اول خدمت و نسخه را تأیید کنید.')
    if c['required_items']:
        raise ApiError(409, 'NOT_READY', 'هنوز همه مدارک ثبت نشده است.')
    tracking = c['tracking_number'] or f"DN-{c['id'][-6:].upper()}"
    db.update('cases', {'id': case_id}, {'stage': 'PROCESSING', 'tracking_number': tracking, 'submitted_at': db.now_iso(),
                                         'process_at': time.time() + settings.check_delay_seconds})
    db.log_event(case_id, 'PATIENT', 'بیمار پرونده را تأیید کرد و بررسی در صف قرار گرفت')
    return to_patient_case(my_case(patient, case_id))


def invite_info(token: str) -> dict:
    c = db.one('SELECT * FROM cases WHERE invite_token = ?', (token,))
    if not c:
        raise ApiError(404, 'INVITE_INVALID', 'این پیوند معتبر نیست.')
    hospital = db.one('SELECT name FROM hospitals WHERE id = ?', (c['hospital_id'],))
    out = {'caseId': c['id'], 'hospitalName': hospital['name'] if hospital else ''}
    if settings.demo_mode:
        p = db.one('SELECT national_id, mobile FROM patients WHERE id = ?', (c['patient_id'],))
        out['devHint'] = {'nationalId': p['national_id'], 'mobile': p['mobile']}
    return out
