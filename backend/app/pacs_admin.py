"""What the PACS admin sees: how many ZIPs each medical center sent. Counts only, never patients or medical content."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from . import db

# Iran has kept standard time all year since 2022.
TEHRAN = timezone(timedelta(hours=3, minutes=30))
PERIODS = {'today': 1, '7d': 7, '30d': 30, 'all': None}
MAX_DAILY_BARS = 90
UNKNOWN_CENTER = 'مرکز نامشخص (ZIP بدون اطلاعات خوانا)'


def _local_day(iso: str) -> date:
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(TEHRAN).date()


def volume(period: str) -> dict:
    if period not in PERIODS:
        period = '30d'
    today = datetime.now(TEHRAN).date()
    days = PERIODS[period]
    start = today - timedelta(days=days - 1) if days else None

    zips = [z | {'day': _local_day(z['received_at'])} for z in db.all_rows('SELECT hospital_id, received_at, status, size_bytes FROM zips')]
    if start:
        zips = [z for z in zips if z['day'] >= start]

    names = {h['id']: h['name'] for h in db.all_rows('SELECT id, name FROM hospitals')}
    centers: dict[str, dict] = {hid: {'id': hid, 'name': name, 'sent': 0, 'accepted': 0, 'rejected': 0, 'sizeBytes': 0, 'lastSentAt': None}
                                for hid, name in names.items()}
    for z in zips:
        key = z['hospital_id'] if z['hospital_id'] in names else '_unknown'
        c = centers.setdefault(key, {'id': key, 'name': UNKNOWN_CENTER, 'sent': 0, 'accepted': 0, 'rejected': 0, 'sizeBytes': 0, 'lastSentAt': None})
        c['sent'] += 1
        c['accepted' if z['status'] == 'READY' else 'rejected'] += 1
        c['sizeBytes'] += z['size_bytes'] or 0
        if not c['lastSentAt'] or z['received_at'] > c['lastSentAt']:
            c['lastSentAt'] = z['received_at']
    rows = sorted(centers.values(), key=lambda c: (-c['sent'], c['name']))
    for c in rows:
        if not c['lastSentAt']:
            del c['lastSentAt']

    first = start or (min((z['day'] for z in zips), default=today))
    first = max(first, today - timedelta(days=MAX_DAILY_BARS - 1))
    per_day: dict[date, int] = {}
    for z in zips:
        per_day[z['day']] = per_day.get(z['day'], 0) + 1
    daily = [{'date': (first + timedelta(days=i)).isoformat(), 'sent': per_day.get(first + timedelta(days=i), 0)}
             for i in range((today - first).days + 1)]

    return {
        'period': period,
        'from': start.isoformat() if start else (min((z['day'] for z in zips)).isoformat() if zips else None),
        'to': today.isoformat(),
        'total': {'sent': len(zips), 'accepted': sum(1 for z in zips if z['status'] == 'READY'),
                  'rejected': sum(1 for z in zips if z['status'] != 'READY'), 'sizeBytes': sum(z['size_bytes'] or 0 for z in zips)},
        'centers': rows,
        'daily': daily,
    }
