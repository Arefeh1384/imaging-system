"""SQLite storage. One file in DATA_DIR, so the whole database is a single file in a Docker volume.

Each call opens its own short connection, which keeps this safe for the request threads and the background worker.
Lists and objects are stored as JSON text.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS hospitals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  national_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  birth_date TEXT,
  insurer TEXT,
  policy_number TEXT,
  relation TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS zips (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL,
  reject_code TEXT,
  reject_reason TEXT,
  hospital_id TEXT,
  study_uid TEXT,
  case_id TEXT,
  path TEXT
);
CREATE INDEX IF NOT EXISTS zips_study ON zips(study_uid, status);
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  zip_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  study_date TEXT NOT NULL,
  study_title TEXT NOT NULL,
  study TEXT NOT NULL,
  stage TEXT NOT NULL,
  requested_items TEXT NOT NULL,
  required_items TEXT NOT NULL,
  confirm_items TEXT NOT NULL,
  confirmed_items TEXT NOT NULL,
  tracking_number TEXT,
  submitted_at TEXT,
  process_at REAL,
  reviewed_at TEXT,
  ai_opinion TEXT,
  insurance_share TEXT,
  conflict TEXT,
  invite_token TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS cases_patient ON cases(patient_id);
CREATE INDEX IF NOT EXISTS cases_due ON cases(stage, process_at);
CREATE TABLE IF NOT EXISTS documents (
  case_id TEXT NOT NULL,
  key TEXT NOT NULL,
  source TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  added_at TEXT NOT NULL,
  path TEXT,
  preview_path TEXT,
  erx_id TEXT,
  data TEXT,
  PRIMARY KEY (case_id, key)
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  png_path TEXT,
  width INTEGER,
  height INTEGER
);
CREATE TABLE IF NOT EXISTS sms (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  mobile TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  delivery TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otp (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  sent_at REAL NOT NULL,
  expires_at REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  created_at REAL NOT NULL,
  expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  created_at REAL NOT NULL,
  expires_at REAL NOT NULL
);
"""

JSON_COLUMNS = {
    'study', 'requested_items', 'required_items', 'confirm_items', 'confirmed_items',
    'ai_opinion', 'insurance_share', 'conflict', 'data',
}

_init_lock = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def new_id(prefix: str) -> str:
    return f'{prefix}-{uuid.uuid4().hex[:12]}'


def init() -> None:
    with _init_lock:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.files_dir.mkdir(parents=True, exist_ok=True)
        with connect() as con:
            con.executescript(SCHEMA)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    con = sqlite3.connect(settings.db_path, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA foreign_keys=ON')
    try:
        yield con
        con.commit()
    finally:
        con.close()


def _decode(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out = dict(row)
    for key in JSON_COLUMNS & out.keys():
        if out[key] is not None:
            out[key] = json.loads(out[key])
    return out


def _encode(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def all_rows(sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
    with connect() as con:
        return [_decode(r) for r in con.execute(sql, params).fetchall()]


def one(sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
    with connect() as con:
        return _decode(con.execute(sql, params).fetchone())


def execute(sql: str, params: tuple | list = ()) -> int:
    with connect() as con:
        return con.execute(sql, [_encode(p) for p in params]).rowcount


def insert(table: str, values: dict[str, Any]) -> None:
    cols = ', '.join(values)
    marks = ', '.join('?' for _ in values)
    execute(f'INSERT INTO {table} ({cols}) VALUES ({marks})', list(values.values()))


def update(table: str, key: dict[str, Any], values: dict[str, Any]) -> None:
    sets = ', '.join(f'{c} = ?' for c in values)
    where = ' AND '.join(f'{c} = ?' for c in key)
    execute(f'UPDATE {table} SET {sets} WHERE {where}', [*values.values(), *key.values()])


def log_event(case_id: str, actor: str, title: str) -> None:
    insert('events', {'id': new_id('ev'), 'case_id': case_id, 'at': now_iso(), 'actor': actor, 'title': title})


def wipe() -> None:
    """Deletes every row. Only reachable from the demo tools."""
    with connect() as con:
        # Staff accounts and their sessions stay, so the insurance panel keeps working after a demo reset.
        for table in ('hospitals', 'patients', 'zips', 'cases', 'documents', 'images', 'sms', 'events', 'otp', 'sessions'):
            con.execute(f'DELETE FROM {table}')
