"""What the insurance panel sees. Only cases that passed the check (AT_INSURER) are open to it."""
from __future__ import annotations

import base64

from . import db, files, review, tariff
from .errors import ApiError

CONFLICT_KINDS = ('PRESCRIPTION_STUDY', 'PRESCRIPTION_NAME', 'REPORT_IMAGES', 'PATIENT_DENIED', 'IMAGE_PATIENT')
SMS_KINDS = ('INVITE', 'REMINDER', 'CONFLICT', 'SENT')


def _not_here() -> ApiError:
    return ApiError(404, 'NOT_FOUND', 'این پرونده در پنل بیمه نیست.')


def _totals(zips: list[dict]) -> dict:
    accepted = sum(1 for z in zips if z['status'] == 'READY')
    rule = tariff.FEE_RULE
    return {
        'received': len(zips), 'accepted': accepted, 'notBillable': len(zips) - accepted,
        'feeRial': accepted * rule['feeRial'], 'hospitalRial': accepted * rule['hospitalRial'],
        'insuranceRial': accepted * rule['insuranceRial'], 'managementRial': accepted * rule['managementRial'],
        'settledHospitalRial': 0,
    }


def _counts(cases: list[dict]) -> dict:
    stages = [c['stage'] for c in cases]
    return {'atInsurer': stages.count('AT_INSURER'), 'waitingPatient': stages.count('WAITING_PATIENT'),
            'processing': stages.count('PROCESSING'), 'conflict': stages.count('REJECTED_CONFLICT')}


def _conflicts(cases: list[dict]) -> dict:
    out = {k: 0 for k in CONFLICT_KINDS}
    for c in cases:
        kind = (c.get('conflict') or {}).get('kind')
        if c['stage'] == 'REJECTED_CONFLICT' and kind in out:
            out[kind] += 1
    return out


def _share(cases: list[dict]) -> int:
    return sum((c.get('insurance_share') or {}).get('insurerShareRial', 0) for c in cases if c['stage'] == 'AT_INSURER')


def dashboard() -> dict:
    cases = db.all_rows('SELECT id, hospital_id, stage, conflict, insurance_share FROM cases')
    zips = db.all_rows('SELECT status, hospital_id FROM zips')
    hospitals = []
    for h in db.all_rows('SELECT id, name FROM hospitals ORDER BY name'):
        hc = [c for c in cases if c['hospital_id'] == h['id']]
        hz = [z for z in zips if z['hospital_id'] == h['id']]
        hospitals.append({'id': h['id'], 'name': h['name'], 'totals': _totals(hz), 'cases': _counts(hc), 'conflicts': _conflicts(hc), 'insurerShareRial': _share(hc)})
    return {'totals': _totals(zips), 'cases': _counts(cases), 'conflicts': _conflicts(cases), 'insurerShareRial': _share(cases), 'hospitals': hospitals}


def list_cases(hospital_id: str | None, page: int, page_size: int) -> dict:
    where, params = "c.stage = 'AT_INSURER'", []
    if hospital_id:
        where += ' AND c.hospital_id = ?'
        params.append(hospital_id)
    total = db.one(f'SELECT COUNT(*) AS n FROM cases c WHERE {where}', params)['n']
    page_size = max(1, min(page_size, 100))
    last = max(1, -(-total // page_size))
    page = max(1, min(page, last))
    rows = db.all_rows(
        f'SELECT c.id, c.zip_id, c.hospital_id, c.study_title, c.received_at, c.submitted_at, c.stage, c.insurance_share, '
        f'h.name AS hospital_name, p.name AS patient_name FROM cases c JOIN patients p ON p.id = c.patient_id '
        f'LEFT JOIN hospitals h ON h.id = c.hospital_id WHERE {where} '
        f'ORDER BY COALESCE(c.reviewed_at, c.submitted_at, c.received_at) DESC LIMIT ? OFFSET ?',
        [*params, page_size, (page - 1) * page_size],
    )
    items = [{
        'caseId': r['id'], 'zipId': r['zip_id'], 'hospitalId': r['hospital_id'], 'hospitalName': r['hospital_name'] or '',
        'patientName': r['patient_name'], 'studyTitle': r['study_title'], 'receivedAt': r['received_at'],
        'submittedAt': r['submitted_at'], 'stage': r['stage'], 'insurerShareRial': (r['insurance_share'] or {}).get('insurerShareRial'),
    } for r in rows]
    return {'items': items, 'total': total, 'page': page, 'pageSize': page_size}


def _document(d: dict) -> dict:
    out = {'key': d['key'], 'source': d['source'], 'fileName': d['file_name'] or '', 'mimeType': d['mime_type'] or '',
           'sizeBytes': d['size_bytes'] or 0, 'addedAt': d['added_at']}
    preview = files.data_url(d['preview_path'])
    if preview:
        out['previewDataUrl'] = preview
    if d['erx_id']:
        out['eRxId'] = d['erx_id']
    if d['key'] == 'report' and d['data']:
        out['reportText'] = d['data'].get('text', '')
        out['reportDoctor'] = d['data'].get('doctor', '')
    return out


def _open_case(case_id: str) -> dict:
    c = db.one('SELECT * FROM cases WHERE id = ?', (case_id,))
    if not c or c['stage'] != 'AT_INSURER':
        raise _not_here()
    return c


def case_record(case_id: str) -> dict:
    c = _open_case(case_id)
    p = db.one('SELECT * FROM patients WHERE id = ?', (c['patient_id'],))
    h = db.one('SELECT name FROM hospitals WHERE id = ?', (c['hospital_id'],))
    study = c['study'] or {}
    patient = {'id': p['id'], 'name': p['name'], 'mobile': p['mobile'], 'nationalId': p['national_id'], 'birthDate': p['birth_date'] or ''}
    if p['insurer']:
        patient['insurance'] = {'insurer': p['insurer'], 'policyNumber': p['policy_number'], 'relation': p['relation']}
    out = {
        'id': c['id'], 'zipId': c['zip_id'], 'hospitalId': c['hospital_id'], 'hospitalName': h['name'] if h else '',
        'receivedAt': c['received_at'], 'patient': patient,
        'study': {'title': c['study_title'], 'modality': (study.get('dicom') or {}).get('modality') or study.get('modality', ''), 'imageCount': study.get('imageCount', 0)},
        'stage': c['stage'],
        'documents': {d['key']: _document(d) for d in db.all_rows('SELECT * FROM documents WHERE case_id = ?', (case_id,))},
        'requestedItems': c['requested_items'], 'requiredItems': c['required_items'],
        'confirmItems': c['confirm_items'], 'confirmedItems': c['confirmed_items'],
        'inviteToken': '',
        'sms': [{'id': s['id'], 'kind': s['kind'], 'sentAt': s['sent_at'], 'delivery': 'SENT' if s['delivery'] == 'SENT' else 'FAILED', 'text': s['text']}
                for s in db.all_rows('SELECT * FROM sms WHERE case_id = ? ORDER BY sent_at', (case_id,)) if s['kind'] in SMS_KINDS],
        'events': [{'id': e['id'], 'at': e['at'], 'actor': e['actor'], 'title': e['title']}
                   for e in db.all_rows('SELECT * FROM events WHERE case_id = ? ORDER BY at, rowid', (case_id,))],
    }
    for key, column in (('trackingNumber', 'tracking_number'), ('submittedAt', 'submitted_at'), ('reviewedAt', 'reviewed_at'),
                        ('aiOpinion', 'ai_opinion'), ('insuranceShare', 'insurance_share')):
        if c[column]:
            out[key] = c[column]
    return out


def study_images(case_id: str) -> list[dict]:
    """The DICOM pictures as PNG, inside the answer, so the page can show them without another signed request."""
    _open_case(case_id)
    out = []
    for image in db.all_rows('SELECT * FROM images WHERE case_id = ? ORDER BY label', (case_id,)):
        png, width, height = review.png_of(image)
        out.append({'id': image['id'], 'label': image['label'], 'url': 'data:image/png;base64,' + base64.b64encode(png).decode(),
                    'width': width, 'height': height})
    return out
