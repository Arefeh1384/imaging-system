"""Receiving a ZIP from the PACS relay and turning it into a case.

The ZIP the relay sends:
  metadata.json        required: hospital, patient, study (see datasets/cases.json for the fields)
  images/*.dcm         required: at least one DICOM image
  report.json          optional: the radiologist report as text {doctor, study, text, signedAt}
  report.pdf|png|jpg   optional: the report as a file instead
  prescription.png|jpg|pdf  optional: the scanned prescription
Whatever optional document is missing, the patient is asked for.
"""
from __future__ import annotations

import io
import json
import secrets
import shutil
import sqlite3
import threading
import zipfile
from pathlib import PurePosixPath

from . import db, dicomio, files, tariff
from .config import settings
from .gateways import send_sms
from .text import invite_sms, is_national_id, latin_digits

DOC_EXT = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.webp': 'image/webp'}


class Rejected(Exception):
    def __init__(self, status: str, code: str, reason: str):
        super().__init__(reason)
        self.status, self.code, self.reason = status, code, reason


def _find(names: list[str], stem: str) -> str | None:
    for name in names:
        p = PurePosixPath(name)
        if p.stem.lower() == stem and p.suffix.lower() in DOC_EXT and len(p.parts) <= 2:
            return name
    return None


def _metadata(zf: zipfile.ZipFile, names: list[str]) -> dict:
    meta_name = next((n for n in names if PurePosixPath(n).name == 'metadata.json'), None)
    if not meta_name:
        raise Rejected('REJECTED_INCOMPLETE', 'NO_METADATA', 'فایل metadata.json در ZIP نیست.')
    try:
        meta = json.loads(zf.read(meta_name).decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        raise Rejected('REJECTED_INCOMPLETE', 'BAD_METADATA', 'فایل metadata.json خوانا نیست.')
    patient, study, hospital = meta.get('patient') or {}, meta.get('study') or {}, meta.get('hospital') or {}
    patient['nationalId'] = latin_digits(str(patient.get('nationalId', ''))).strip()
    patient['mobile'] = latin_digits(str(patient.get('mobile', ''))).strip()
    missing = [label for label, ok in [
        ('نام بیمار', patient.get('name')), ('کد ملی', is_national_id(patient['nationalId'])), ('موبایل', len(patient['mobile']) == 11),
        ('شناسه مطالعه', study.get('studyInstanceUid')), ('عنوان تصویربرداری', study.get('title')), ('تاریخ', study.get('date')),
        ('مرکز درمانی', hospital.get('id') and hospital.get('name')),
    ] if not ok]
    if missing:
        raise Rejected('REJECTED_INCOMPLETE', 'BAD_METADATA', 'این اطلاعات در metadata.json نیست یا درست نیست: ' + '، '.join(missing))
    return meta


_claim_lock = threading.Lock()


def receive(file_name: str, data: bytes) -> dict:
    """Stores the ZIP and creates the case. Returns what the relay should know."""
    zip_id = db.new_id('zip')
    record = {'id': zip_id, 'file_name': file_name, 'size_bytes': len(data), 'received_at': db.now_iso(), 'status': 'READY', 'path': None}
    claimed = False
    try:
        if len(data) > settings.max_zip_mb * 1024 * 1024:
            raise Rejected('REJECTED_TOO_LARGE', 'TOO_LARGE', f'حجم ZIP بیشتر از {settings.max_zip_mb} مگابایت است.')
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
            names = [n for n in zf.namelist() if not n.endswith('/') and '__MACOSX' not in n]
        except zipfile.BadZipFile:
            raise Rejected('REJECTED_INCOMPLETE', 'BAD_ZIP', 'فایل ZIP خراب است.')
        meta = _metadata(zf, names)
        record['hospital_id'] = meta['hospital']['id']
        record['study_uid'] = meta['study']['studyInstanceUid']
        images = sorted(n for n in names if n.lower().endswith('.dcm'))
        if not images:
            raise Rejected('REJECTED_INCOMPLETE', 'NO_IMAGES', 'تصویر پزشکی (DICOM) در ZIP نیست.')
        record['study_title'] = meta['study'].get('service') or meta['study']['title']
        _ensure_hospital(meta['hospital'])
        # The fee and its split are fixed when the ZIP arrives, from the hospital's rule at that moment.
        rule = db.one('SELECT fee_rial, hospital_rial, insurance_rial, management_rial FROM hospitals WHERE id = ?', (record['hospital_id'],))
        # Claim the study before doing the work, so the same study sent twice at the same moment makes one case,
        # not two. The database allows one accepted ZIP per study; the lock covers databases that can't (see db.init).
        with _claim_lock:
            if db.one("SELECT id FROM zips WHERE study_uid = ? AND status = 'READY'", (record['study_uid'],)):
                raise Rejected('DUPLICATE', 'DUPLICATE', 'این تصویربرداری قبلاً رسیده است.')
            try:
                db.insert('zips', {**record, **rule})
            except sqlite3.IntegrityError:
                raise Rejected('DUPLICATE', 'DUPLICATE', 'این تصویربرداری قبلاً رسیده است.')
            claimed = True
        case_id = _create_case(zip_id, zf, names, images, meta)
        _keep_file(record, data)
        db.update('zips', {'id': zip_id}, {'case_id': case_id, 'path': record['path']})
        return {'zipId': zip_id, 'status': 'READY', 'caseId': case_id}
    except Rejected as rej:
        refused = {'status': rej.status, 'reject_code': rej.code, 'reject_reason': rej.reason, 'fee_rial': 0, 'hospital_rial': 0, 'insurance_rial': 0, 'management_rial': 0}
        record.update(refused)
        if rej.status != 'REJECTED_TOO_LARGE':
            _keep_file(record, data)  # refused packages are kept too, so the admin can download and look at them
        if claimed:
            db.update('zips', {'id': zip_id}, {**refused, 'path': record['path']})
        else:
            db.insert('zips', record)
        return {'zipId': zip_id, 'status': rej.status, 'rejectCode': rej.code, 'rejectReason': rej.reason}
    except Exception:
        if claimed:  # free the study again, so the relay can resend it
            db.execute('DELETE FROM zips WHERE id = ?', (zip_id,))
        raise


def _keep_file(record: dict, data: bytes) -> None:
    zpath = files.zip_path(record['id'])
    zpath.write_bytes(data)
    record['path'] = files.rel(zpath)


def _ensure_hospital(hospital: dict) -> None:
    """The hospital, and the company it belongs to when the relay says. New hospitals get the default fee rule."""
    company = hospital.get('company') or {}
    company_id = company.get('id') or db.DEFAULT_COMPANY[0]
    # INSERT OR IGNORE: two ZIPs from a new hospital can arrive at the same moment.
    db.execute('INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)', (company_id, company.get('name') or db.DEFAULT_COMPANY[1]))
    existing = db.one('SELECT company_id FROM hospitals WHERE id = ?', (hospital['id'],))
    if existing and company.get('id') and existing['company_id'] in (None, db.DEFAULT_COMPANY[0]):
        db.update('hospitals', {'id': hospital['id']}, {'company_id': company_id})  # the relay now says which company it is
    if not existing:
        r = tariff.FEE_RULE
        db.execute('INSERT OR IGNORE INTO hospitals (id, name, company_id, fee_rial, hospital_rial, insurance_rial, management_rial) VALUES (?, ?, ?, ?, ?, ?, ?)',
                   (hospital['id'], hospital['name'], company_id, r['feeRial'], r['hospitalRial'], r['insuranceRial'], r['managementRial']))


def _create_case(zip_id: str, zf: zipfile.ZipFile, names: list[str], images: list[str], meta: dict) -> str:
    case_id = db.new_id('case')
    folder = files.case_dir(case_id)
    (folder / 'images').mkdir(exist_ok=True)

    # Images first: a ZIP whose DICOM cannot be read is not a case.
    image_rows, first_info = [], None
    for n, name in enumerate(images, start=1):
        path = folder / 'images' / f'{n}.dcm'
        path.write_bytes(zf.read(name))
        try:
            info = dicomio.read_info(path)
        except Exception:  # noqa: BLE001
            shutil.rmtree(folder, ignore_errors=True)
            raise Rejected('REJECTED_INCOMPLETE', 'BAD_DICOM', 'تصویر DICOM داخل ZIP خوانا نیست.')
        first_info = first_info or info
        label = ' '.join(x for x in (info.laterality, info.view) if x) or f'تصویر {n}'
        image_rows.append({'id': db.new_id('img'), 'case_id': case_id, 'label': label, 'path': files.rel(path), 'width': info.cols, 'height': info.rows})

    hospital, patient, study = meta['hospital'], meta['patient'], meta['study']
    # One statement, so two ZIPs for the same new patient arriving together share one patient instead of failing.
    db.execute('INSERT INTO patients (id, national_id, name, mobile, birth_date, created_at) VALUES (?, ?, ?, ?, ?, ?) '
               'ON CONFLICT(national_id) DO UPDATE SET name = excluded.name, mobile = excluded.mobile',
               (db.new_id('p'), patient['nationalId'], patient['name'], patient['mobile'], patient.get('birthDate'), db.now_iso()))
    patient_id = db.one('SELECT id FROM patients WHERE national_id = ?', (patient['nationalId'],))['id']

    now = db.now_iso()
    docs = []
    report_json = next((n for n in names if PurePosixPath(n).name == 'report.json'), None)
    report_file = _find(names, 'report')
    if report_json:
        report = json.loads(zf.read(report_json).decode('utf-8'))
        docs.append({'key': 'report', 'source': 'PACS', 'file_name': 'report.json', 'mime_type': 'application/json', 'data': report})
    elif report_file:
        docs.append(_doc_file(case_id, 'report', zf, report_file))
    rx_name = _find(names, 'prescription')
    if rx_name:
        doc = _doc_file(case_id, 'prescription', zf, rx_name)
        doc['data'] = meta.get('prescription')
        docs.append(doc)
    for doc in docs:
        db.insert('documents', {'case_id': case_id, 'added_at': now, **doc})

    present = {d['key'] for d in docs}
    requested = [k for k in ('prescription', 'report') if k not in present]
    confirm = ['service'] + (['prescription'] if 'prescription' in present else [])
    token = secrets.token_urlsafe(6)
    title = study.get('service') or study['title']
    db.insert('cases', {
        'id': case_id, 'zip_id': zip_id, 'patient_id': patient_id, 'hospital_id': hospital['id'], 'received_at': now,
        'study_date': study['date'], 'study_title': title,
        'study': {**study, 'imageCount': len(images), 'dicom': first_info.as_dict() if first_info else None},
        'stage': 'WAITING_PATIENT', 'requested_items': requested, 'required_items': list(requested),
        'confirm_items': confirm, 'confirmed_items': [], 'invite_token': token,
    })
    for row in image_rows:
        db.insert('images', row)
    db.log_event(case_id, 'SYSTEM', 'ZIP از PACS رسید و پرونده ساخته شد')
    if requested:
        db.log_event(case_id, 'SYSTEM', 'از بیمار خواسته شد مدارک ناقص را بفرستد')
    send_sms(patient['mobile'], invite_sms(f'{settings.portal_url}/c/{token}'), 'INVITE', case_id)
    return case_id


def _doc_file(case_id: str, key: str, zf: zipfile.ZipFile, name: str) -> dict:
    data = zf.read(name)
    suffix = PurePosixPath(name).suffix.lower()
    path = files.case_dir(case_id) / f'{key}{suffix}'
    path.write_bytes(data)
    doc = {'key': key, 'source': 'PACS', 'file_name': PurePosixPath(name).name, 'mime_type': DOC_EXT[suffix], 'size_bytes': len(data), 'path': files.rel(path)}
    preview = files.make_preview(data)
    if preview:
        ppath = files.case_dir(case_id) / f'{key}-preview.jpg'
        ppath.write_bytes(preview)
        doc['preview_path'] = files.rel(ppath)
    return doc
