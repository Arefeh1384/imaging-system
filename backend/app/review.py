"""The check that runs after the patient's «تأیید».

It fetches the e-prescription, makes a PNG from the DICOM, asks the checker whether everything matches, and then
sends the case to the insurer with its share, or rejects it. The patient is told by SMS either way.
"""
from __future__ import annotations

import logging
import time

from . import db, dicomio, files, tariff
from .cases import reject_for_conflict
from .checker import CheckerUnavailable, CheckInput, Document, get_checker
from .checker.base import CONFLICT_REASONS
from .config import settings
from .gateways import ServiceUnavailable, fetch_eprescription, send_sms
from .text import erx_missing_sms, fa_digits, sent_sms

log = logging.getLogger('review')
RETRY_SECONDS = settings.check_retry_seconds
# While a case is being checked, it is held for this long. If the check stops halfway (a crash, a restart),
# the case becomes due again after this time and the queue picks it up by itself.
LEASE_SECONDS = 600


def claim(case_id: str) -> bool:
    """Takes a due case for this run, so it is never checked twice at the same time."""
    now = time.time()
    return db.execute("UPDATE cases SET process_at = ? WHERE id = ? AND stage = 'PROCESSING' AND process_at IS NOT NULL AND process_at <= ?",
                      (now + LEASE_SECONDS, case_id, now)) == 1


def requeue_stuck() -> int:
    """At start-up nothing is being checked, so every case waiting for the check is due now: one cut off by the
    restart, one waiting to retry (settings may have just changed), and one left without a time by an older version."""
    now = time.time()
    return db.execute("UPDATE cases SET process_at = ? WHERE stage = 'PROCESSING' AND (process_at IS NULL OR process_at > ?)", (now, now))


RETRY_MARK = 'بررسی انجام نشد'
CHECKING: set[str] = set()  # cases this process is checking right now


def check_status(c: dict) -> dict:
    """For the demo tools: is the case being checked now, or when is the next try, and why did the last one fail."""
    now = time.time()
    out: dict = {}
    if c.get('process_at'):
        out['checkingNow'] = c['id'] in CHECKING
        out['nextAttemptAt'] = None if out['checkingNow'] else max(c['process_at'], now)
    last = db.one('SELECT title, at FROM events WHERE case_id = ? AND title LIKE ? ORDER BY at DESC, rowid DESC LIMIT 1', (c['id'], RETRY_MARK + '%'))
    if last:
        out['lastProblem'] = last['title']
    return out


def due_cases() -> list[str]:
    rows = db.all_rows("SELECT id FROM cases WHERE stage = 'PROCESSING' AND process_at IS NOT NULL AND process_at <= ?", (time.time(),))
    return [r['id'] for r in rows]


def retry_later(case_id: str, why: str) -> None:
    db.update('cases', {'id': case_id}, {'process_at': time.time() + RETRY_SECONDS})
    wait = f'{fa_digits(RETRY_SECONDS // 60)} دقیقه' if RETRY_SECONDS >= 60 else f'{fa_digits(RETRY_SECONDS)} ثانیه'
    db.log_event(case_id, 'SYSTEM', f'{RETRY_MARK} و {wait} بعد دوباره انجام می‌شود ({why[:160]})')
    log.warning('case %s: %s', case_id, why)


def png_of(image: dict) -> tuple[bytes, int, int]:
    """The viewable PNG of one DICOM image, made once and kept next to it."""
    if image['png_path'] and files.abs_path(image['png_path']).exists():
        return files.abs_path(image['png_path']).read_bytes(), image['width'], image['height']
    png, width, height = dicomio.to_png(files.abs_path(image['path']))
    out = files.case_dir(image['case_id']) / f"{image['id']}.png"
    out.write_bytes(png)
    db.update('images', {'id': image['id']}, {'png_path': files.rel(out), 'width': width, 'height': height})
    return png, width, height


def _first_png(case_id: str) -> bytes:
    image = db.one('SELECT * FROM images WHERE case_id = ? ORDER BY label LIMIT 1', (case_id,))
    return png_of(image)[0]


def _file(doc: dict) -> tuple[bytes | None, str | None]:
    if not doc.get('path') or not files.abs_path(doc['path']).exists():
        return None, None
    return files.abs_path(doc['path']).read_bytes(), doc['mime_type']


def run(case_id: str) -> str:
    """Checks one claimed case. Returns what happened, for logs and the demo tools."""
    CHECKING.add(case_id)
    try:
        return _run(case_id)
    finally:
        CHECKING.discard(case_id)


def _run(case_id: str) -> str:
    c = db.one('SELECT * FROM cases WHERE id = ?', (case_id,))
    if not c or c['stage'] != 'PROCESSING':
        return 'skipped'
    patient = db.one('SELECT * FROM patients WHERE id = ?', (c['patient_id'],))
    docs = {d['key']: d for d in db.all_rows('SELECT * FROM documents WHERE case_id = ?', (case_id,))}

    prescription = None
    rx = docs.get('prescription')
    if rx and rx['erx_id']:
        try:
            erx = fetch_eprescription(rx['erx_id'])
        except ServiceUnavailable as err:
            retry_later(case_id, f'سامانه نسخه الکترونیک: {err}')
            return 'retry'
        if erx is None:
            # A wrong code is a typing mistake, not a conflict: the patient enters it again.
            db.execute('DELETE FROM documents WHERE case_id = ? AND key = ?', (case_id, 'prescription'))
            db.update('cases', {'id': case_id}, {'stage': 'WAITING_PATIENT', 'required_items': ['prescription', *c['required_items']], 'process_at': None})
            db.log_event(case_id, 'SYSTEM', f"نسخه الکترونیک با شناسه {rx['erx_id']} پیدا نشد و از بیمار خواسته شد دوباره ثبت کند")
            send_sms(patient['mobile'], erx_missing_sms(f"{settings.portal_url}/c/{c['invite_token']}"), 'REMINDER', case_id)
            return 'erx-not-found'
        db.update('documents', {'case_id': case_id, 'key': 'prescription'}, {'data': erx})
        db.log_event(case_id, 'SYSTEM', 'نسخه الکترونیک از سامانه نسخه دریافت شد')
        prescription = Document(kind='erx', data=erx)
    elif rx:
        content, mime = _file(rx)
        prescription = Document(kind='pacs' if rx['source'] == 'PACS' else 'photo', data=rx['data'], content=content, mime=mime)

    report = None
    rep = docs.get('report')
    if rep:
        content, mime = _file(rep)
        report = Document(kind='text' if rep['data'] else 'file', data=rep['data'], content=content, mime=mime)

    try:
        png = _first_png(case_id)
    except Exception as err:  # noqa: BLE001
        retry_later(case_id, f'تصویر DICOM: {err}')
        return 'retry'

    item = CheckInput(
        patient={'name': patient['name'], 'nationalId': patient['national_id'], 'birthDate': patient['birth_date']},
        study=c['study'], image_png=png, prescription=prescription, report=report,
    )
    try:
        result = get_checker().check(item)
    except CheckerUnavailable as err:
        retry_later(case_id, str(err))
        return 'retry'

    now = db.now_iso()
    opinion = result.opinion(now)
    db.update('cases', {'id': case_id}, {'ai_opinion': opinion, 'reviewed_at': now})
    db.log_event(case_id, 'AI', f"{result.model_version}: {opinion['summary']}")
    kind = result.conflict_kind
    if kind:
        reject_for_conflict(c, kind, CONFLICT_REASONS[kind], 'AI')
        return 'conflict'
    modality = (c['study'].get('dicom') or {}).get('modality') or c['study'].get('modality', '')
    db.update('cases', {'id': case_id}, {'stage': 'AT_INSURER', 'insurance_share': tariff.share_for(modality), 'process_at': None})
    db.log_event(case_id, 'SYSTEM', 'پرونده برای بیمه ارسال شد')
    send_sms(patient['mobile'], sent_sms(c['tracking_number']), 'SENT', case_id)
    return 'sent'
