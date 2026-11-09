"""Patient sign-in: national ID and mobile, then a one-time code by SMS, then a session token."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time

from fastapi import Header

from . import db
from .config import settings
from .errors import ApiError, unauthorized
from .gateways import send_sms
from .text import fa_digits, latin_digits, mask_mobile, otp_sms

CODE_LENGTH = 5
CODE_SECONDS = 120
RESEND_SECONDS = 60
MAX_ATTEMPTS = 5
SESSION_SECONDS = 12 * 3600

# A secret for hashing codes and tokens, so the database never holds them in readable form.
# Set SECRET_KEY so sessions survive a restart. Without it, a random key is made on each start.
_PEPPER = (os.environ.get('SECRET_KEY') or secrets.token_hex(32)).encode()


def _hash(value: str) -> str:
    return hmac.new(_PEPPER, value.encode(), hashlib.sha256).hexdigest()


def request_code(national_id: str, mobile: str) -> dict:
    national_id, mobile = latin_digits(national_id).strip(), latin_digits(mobile).strip()
    patient = db.one('SELECT * FROM patients WHERE national_id = ? AND mobile = ?', (national_id, mobile))
    if not patient:
        raise ApiError(400, 'INVALID_LOGIN', 'کد ملی یا شماره موبایل درست نیست. دوباره بررسی کنید.')
    last = db.one('SELECT sent_at FROM otp WHERE patient_id = ? ORDER BY sent_at DESC LIMIT 1', (patient['id'],))
    now = time.time()
    if last and now - last['sent_at'] < RESEND_SECONDS:
        wait = int(RESEND_SECONDS - (now - last['sent_at'])) + 1
        raise ApiError(429, 'TOO_SOON', f'برای کد تازه {fa_digits(wait)} ثانیه صبر کنید.')
    code = ''.join(secrets.choice('0123456789') for _ in range(CODE_LENGTH))
    challenge_id = db.new_id('otp')
    db.insert('otp', {'id': challenge_id, 'patient_id': patient['id'], 'code_hash': _hash(challenge_id + code), 'sent_at': now, 'expires_at': now + CODE_SECONDS})
    send_sms(mobile, otp_sms(code), 'OTP')
    out = {'challengeId': challenge_id, 'maskedMobile': mask_mobile(mobile), 'codeLength': CODE_LENGTH,
           'expiresInSeconds': CODE_SECONDS, 'resendInSeconds': RESEND_SECONDS}
    if settings.demo_mode:
        out['sampleCode'] = code  # demo only: there is no real SMS to read it from
    return out


def verify_code(challenge_id: str, code: str) -> dict:
    row = db.one('SELECT * FROM otp WHERE id = ?', (challenge_id,))
    if not row or row['used'] or row['expires_at'] < time.time():
        raise ApiError(400, 'CODE_EXPIRED', 'زمان این کد تمام شده است. کد تازه بگیرید.')
    if row['attempts'] >= MAX_ATTEMPTS:
        raise ApiError(400, 'TOO_MANY_ATTEMPTS', 'کد چند بار اشتباه وارد شد. کد تازه بگیرید.')
    if not hmac.compare_digest(row['code_hash'], _hash(challenge_id + latin_digits(code).strip())):
        attempts = row['attempts'] + 1
        db.update('otp', {'id': challenge_id}, {'attempts': attempts})
        if attempts >= MAX_ATTEMPTS:
            raise ApiError(400, 'TOO_MANY_ATTEMPTS', 'کد چند بار اشتباه وارد شد. کد تازه بگیرید.')
        raise ApiError(400, 'WRONG_CODE', f'این کد درست نیست. {fa_digits(MAX_ATTEMPTS - attempts)} بار دیگر می‌توانید امتحان کنید.')
    db.update('otp', {'id': challenge_id}, {'used': 1})
    token = secrets.token_urlsafe(32)
    now = time.time()
    db.insert('sessions', {'token_hash': _hash(token), 'patient_id': row['patient_id'], 'created_at': now, 'expires_at': now + SESSION_SECONDS})
    for c in db.all_rows("SELECT id FROM cases WHERE patient_id = ? AND stage = 'WAITING_PATIENT'", (row['patient_id'],)):
        if not db.one("SELECT id FROM events WHERE case_id = ? AND title = 'بیمار وارد سامانه شد'", (c['id'],)):
            db.log_event(c['id'], 'PATIENT', 'بیمار وارد سامانه شد')
    return {'role': 'PATIENT', 'token': token, 'patientId': row['patient_id']}


def current_patient(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: the signed-in patient, from 'Authorization: Bearer <token>'."""
    if not authorization or not authorization.lower().startswith('bearer '):
        raise unauthorized()
    session = db.one('SELECT * FROM sessions WHERE token_hash = ?', (_hash(authorization[7:].strip()),))
    if not session or session['expires_at'] < time.time():
        raise unauthorized()
    patient = db.one('SELECT * FROM patients WHERE id = ?', (session['patient_id'],))
    if not patient:
        raise unauthorized()
    return patient
