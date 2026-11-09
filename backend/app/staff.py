"""Insurance panel accounts: username and password, then a session token. Passwords are stored hashed."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from fastapi import Header

from . import db
from .auth import _hash as hash_token
from .config import settings
from .errors import ApiError, unauthorized

SESSION_SECONDS = 12 * 3600
ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), ITERATIONS).hex()
    return f'pbkdf2_sha256${ITERATIONS}${salt}${digest}'


def check_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split('$')
    except ValueError:
        return False
    test = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(iterations)).hex()
    return hmac.compare_digest(test, digest)


def ensure_default_account() -> None:
    """Makes the first insurance account from INSURANCE_USERNAME and INSURANCE_PASSWORD, once."""
    if not settings.insurance_username or db.one('SELECT id FROM staff WHERE username = ?', (settings.insurance_username,)):
        return
    db.insert('staff', {'id': db.new_id('staff'), 'username': settings.insurance_username, 'password_hash': hash_password(settings.insurance_password),
                        'name': settings.insurance_name, 'role': 'INSURANCE_ADMIN', 'active': 1, 'created_at': db.now_iso()})


def login(username: str, password: str) -> dict:
    account = db.one('SELECT * FROM staff WHERE username = ?', (username.strip(),))
    if not account or not check_password(password, account['password_hash']):
        raise ApiError(400, 'INVALID_LOGIN', 'نام کاربری یا رمز عبور درست نیست.')
    if not account['active']:
        raise ApiError(403, 'INACTIVE', 'این حساب غیرفعال است.')
    token = secrets.token_urlsafe(32)
    now = time.time()
    db.insert('staff_sessions', {'token_hash': hash_token(token), 'staff_id': account['id'], 'created_at': now, 'expires_at': now + SESSION_SECONDS})
    return {'role': account['role'], 'token': token, 'accountId': account['id'], 'name': account['name']}


def current_insurer(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: the signed-in insurance account, from 'Authorization: Bearer <token>'."""
    if not authorization or not authorization.lower().startswith('bearer '):
        raise unauthorized()
    session = db.one('SELECT * FROM staff_sessions WHERE token_hash = ?', (hash_token(authorization[7:].strip()),))
    if not session or session['expires_at'] < time.time():
        raise unauthorized()
    account = db.one('SELECT * FROM staff WHERE id = ?', (session['staff_id'],))
    if not account or not account['active'] or account['role'] != 'INSURANCE_ADMIN':
        raise unauthorized()
    return account
