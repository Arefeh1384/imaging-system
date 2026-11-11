"""Staff accounts (insurance panel, PACS admin panel): username and password, then a session token.
Passwords are stored hashed. Each account has one role and can only sign in to its own panel."""
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


def _ensure(username: str, password: str, name: str, role: str) -> None:
    if not username or db.one('SELECT id FROM staff WHERE username = ?', (username,)):
        return
    # OR IGNORE: with several worker processes, two may start at the same moment.
    db.execute('INSERT OR IGNORE INTO staff (id, username, password_hash, name, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
               (db.new_id('staff'), username, hash_password(password), name, role, db.now_iso()))


def ensure_default_account() -> None:
    """Makes the first insurance and PACS admin accounts from .env, once. Later changes to .env don't touch them."""
    _ensure(settings.insurance_username, settings.insurance_password, settings.insurance_name, 'INSURANCE_ADMIN')
    _ensure(settings.pacs_admin_username, settings.pacs_admin_password, settings.pacs_admin_name, 'PACS_ADMIN')
    _ensure(settings.admin_username, settings.admin_password, settings.admin_name, 'ADMIN')


def login(username: str, password: str, role: str = 'INSURANCE_ADMIN') -> dict:
    account = db.one('SELECT * FROM staff WHERE username = ?', (username.strip(),))
    # An account of another panel gets the same answer as a wrong password, so the form reveals nothing.
    if not account or account['role'] != role or not check_password(password, account['password_hash']):
        raise ApiError(400, 'INVALID_LOGIN', 'نام کاربری یا رمز عبور درست نیست.')
    if not account['active']:
        raise ApiError(403, 'INACTIVE', 'این حساب غیرفعال است.')
    token = secrets.token_urlsafe(32)
    now = time.time()
    db.insert('staff_sessions', {'token_hash': hash_token(token), 'staff_id': account['id'], 'created_at': now, 'expires_at': now + SESSION_SECONDS})
    return {'role': account['role'], 'token': token, 'accountId': account['id'], 'name': account['name']}


def _signed_in(authorization: str | None, role: str) -> dict:
    if not authorization or not authorization.lower().startswith('bearer '):
        raise unauthorized()
    session = db.one('SELECT * FROM staff_sessions WHERE token_hash = ?', (hash_token(authorization[7:].strip()),))
    if not session or session['expires_at'] < time.time():
        raise unauthorized()
    account = db.one('SELECT * FROM staff WHERE id = ?', (session['staff_id'],))
    if not account or not account['active'] or account['role'] != role:
        raise unauthorized()
    return account


def current_insurer(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: the signed-in insurance account, from 'Authorization: Bearer <token>'."""
    return _signed_in(authorization, 'INSURANCE_ADMIN')


def current_admin(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: the signed-in main admin."""
    return _signed_in(authorization, 'ADMIN')


def insurer_or_admin(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency for what both the insurance panel and the main admin read, such as a case's pictures."""
    try:
        return _signed_in(authorization, 'INSURANCE_ADMIN')
    except ApiError:
        return _signed_in(authorization, 'ADMIN')


def current_pacs_admin(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: the signed-in PACS admin account."""
    return _signed_in(authorization, 'PACS_ADMIN')
