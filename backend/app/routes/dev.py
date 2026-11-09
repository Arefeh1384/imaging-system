"""Demo tools for testing, only when DEMO_MODE is on. The sandbox pages use them."""
from __future__ import annotations

import shutil
import time

from fastapi import APIRouter

from .. import db, review
from ..checker import get_checker
from ..checker.fake import FakeChecker
from ..config import settings
from ..errors import ApiError, not_found

router = APIRouter(prefix='/api/v1/dev', tags=['demo tools'])


def _guard() -> None:
    if not settings.demo_mode:
        raise not_found('این بخش فقط در حالت آزمایشی فعال است.')


@router.get('/cases')
def list_cases():
    """Every case with its stage, newest first, for the sandbox's overview."""
    _guard()
    rows = db.all_rows(
        'SELECT c.id, c.stage, c.study_title, c.study_date, c.received_at, c.process_at, c.tracking_number, c.conflict, c.ai_opinion, '
        'c.insurance_share, c.invite_token, c.study, p.name AS patient_name, p.national_id, p.mobile, h.name AS hospital_name '
        'FROM cases c JOIN patients p ON p.id = c.patient_id LEFT JOIN hospitals h ON h.id = c.hospital_id ORDER BY c.received_at DESC'
    )
    for r in rows:
        r['accessionNumber'] = (r.pop('study') or {}).get('accessionNumber')
        if r['stage'] == 'PROCESSING':
            r.update(review.check_status(r))
        r['portalLink'] = f"{settings.portal_url}/c/{r['invite_token']}"
    zips = db.all_rows('SELECT id, file_name, received_at, status, reject_reason, case_id FROM zips ORDER BY received_at DESC')
    checker = get_checker()
    return {'cases': rows, 'zips': zips, 'checker': settings.checker, 'checkerName': checker.model_version,
            'checkerIsAi': not isinstance(checker, FakeChecker), 'checkDelaySeconds': settings.check_delay_seconds}


@router.get('/cases/{case_id}/events')
def case_events(case_id: str):
    _guard()
    return {
        'events': db.all_rows('SELECT at, actor, title FROM events WHERE case_id = ? ORDER BY at, rowid', (case_id,)),
        'sms': db.all_rows('SELECT kind, text, sent_at, delivery FROM sms WHERE case_id = ? ORDER BY sent_at', (case_id,)),
    }


@router.post('/cases/{case_id}/check-now')
def check_now(case_id: str):
    """For automated tests only: makes the case due now and checks it. The PACS page has no button for this."""
    _guard()
    c = db.one('SELECT stage FROM cases WHERE id = ?', (case_id,))
    if not c:
        raise not_found()
    if c['stage'] != 'PROCESSING':
        raise ApiError(409, 'NOT_PROCESSING', 'این پرونده منتظر بررسی نیست.')
    db.execute("UPDATE cases SET process_at = ? WHERE id = ? AND stage = 'PROCESSING'", (time.time(), case_id))
    if not review.claim(case_id):
        raise ApiError(409, 'BUSY', 'بررسی این پرونده همین حالا در حال انجام است.')
    try:
        return {'result': review.run(case_id)}
    except Exception as err:  # noqa: BLE001 - never leave the case held
        review.retry_later(case_id, str(err))
        raise


@router.post('/reset')
def reset():
    """Deletes every case, patient, ZIP and file, to start the demo again."""
    _guard()
    db.wipe()
    shutil.rmtree(settings.files_dir, ignore_errors=True)
    settings.files_dir.mkdir(parents=True, exist_ok=True)
    return {'ok': True}
