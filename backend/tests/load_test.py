"""Load test: how the backend holds up when many hospitals send ZIPs and many people use the panels at once.

Run it inside the backend container, so nothing extra needs installing:
    docker compose exec backend python tests/load_test.py
    docker compose exec backend python tests/load_test.py --zips 500 --senders 20 --users 50 --seconds 120

What it does:
  1. Intake: sends --zips new ZIPs, --senders at a time, like several hospital relays sending together.
  2. Collisions: the same new patient in two ZIPs at the same moment, and the same study sent twice at the same
     moment. The first should give two cases for one patient; the second exactly one accepted ZIP.
  3. Reading: --users people at once for --seconds: patients opening their cases, the insurer, the main admin and
     the PACS admin opening their pages, and DICOM pictures being opened.
Then it prints, per request, how many were sent, how many failed, and how long they took (median, 95th and 99th
percentile, slowest), and the requests per second.

It never presses «تأیید» on a case, so no AI check runs and no OpenRouter credit is used. It does create test
patients (named «آزمایش بار …») and send their invite SMS to whatever SMS_GATEWAY_URL the backend has, so run it
against the sandbox, never a real SMS service, and on a test database: afterwards, the sandbox's PACS page has a
button that resets everything.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import random
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = os.environ.get('LOAD_API', 'http://localhost:8000/api/v1')
PACS_KEY = os.environ.get('PACS_API_KEY', 'dev-pacs-key')
DATASETS = Path(os.environ.get('DATASETS_DIR', Path(__file__).resolve().parents[2] / 'datasets'))
ACCOUNTS = {
    'insurance': (os.environ.get('INSURANCE_USERNAME', 'dana-admin'), os.environ.get('INSURANCE_PASSWORD', 'dana1234')),
    'admin': (os.environ.get('ADMIN_USERNAME', 'admin'), os.environ.get('ADMIN_PASSWORD', 'admin1234')),
    'pacs-admin': (os.environ.get('PACS_ADMIN_USERNAME', 'pacs-admin'), os.environ.get('PACS_ADMIN_PASSWORD', 'pacs1234')),
}

# ---------------------------------------------------------------- measuring

results: dict[str, list[tuple[float, bool]]] = defaultdict(list)
problems: dict[str, list[str]] = defaultdict(list)
lock = threading.Lock()


def call(name: str, method: str, path: str, body=None, token: str | None = None, raw: bytes | None = None, ctype: str | None = None,
         expect=(200,), timeout: float = 60):
    """One request, timed and recorded under `name`. Returns (status, parsed body)."""
    headers = {}
    data = None
    if raw is not None:
        data, headers['Content-Type'] = raw, ctype
    elif body is not None:
        data, headers['Content-Type'] = json.dumps(body).encode(), 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if path == '/ingest':
        headers['X-Api-Key'] = PACS_KEY
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, text = r.status, r.read()
    except urllib.error.HTTPError as err:
        status, text = err.code, err.read()
    except Exception as err:  # noqa: BLE001  connection refused, timeout, reset
        status, text = 0, str(err).encode()
    took = time.perf_counter() - started
    good = status in expect
    with lock:
        results[name].append((took, good))
        if not good and len(problems[name]) < 3:
            problems[name].append(f'{status}: {text[:160].decode("utf-8", "replace")}')
    try:
        parsed = json.loads(text) if text[:1] in (b'{', b'[') else text
    except ValueError:
        parsed = text
    return status, parsed


def report(title: str, names: list[str] | None = None, seconds: float | None = None) -> None:
    print(f'\n{title}')
    print(f'{"request":34} {"sent":>6} {"failed":>6} {"median":>8} {"p95":>8} {"p99":>8} {"slowest":>8}  (milliseconds)')
    total = 0
    for name in names or sorted(results):
        rows = results.get(name)
        if not rows:
            continue
        times = sorted(t * 1000 for t, _ in rows)
        bad = sum(1 for _, ok in rows if not ok)
        total += len(rows)
        pick = lambda q: times[min(len(times) - 1, int(q * len(times)))]  # noqa: E731
        print(f'{name:34} {len(rows):>6} {bad:>6} {statistics.median(times):>8.0f} {pick(0.95):>8.0f} {pick(0.99):>8.0f} {times[-1]:>8.0f}')
        for p in problems.get(name, []):
            print(f'{"":36}e.g. {p}')
    if seconds:
        print(f'{"":34} {total / seconds:>6.1f} requests per second over {seconds:.0f} s')


# ---------------------------------------------------------------- test data

def national_id(n: int) -> str:
    """A valid Iranian national ID (correct check digit), different for each n."""
    body = f'{(n * 7919 + 13) % 10**9:09d}'
    s = sum(int(d) * (10 - i) for i, d in enumerate(body)) % 11
    return body + str(s if s < 2 else 11 - s)


def load_template() -> dict:
    cases = json.loads((DATASETS / 'cases.json').read_text(encoding='utf-8'))['cases']
    return next(c for c in cases if c['id'] == 'MG-001')


def build_zip(template: dict, run: str, i: int, patient: dict | None = None, study_uid: str | None = None) -> bytes:
    meta = {
        'schema': 'imaging-relay/1',
        'sentAt': time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime()),
        'hospital': template['hospital'],
        'patient': patient or {'name': f'آزمایش بار {run} {i}', 'nationalId': national_id(int(run, 16) % 10**6 * 10_000 + i),
                               'mobile': f'0919{random.randint(1000000, 9999999)}', 'birthDate': '1980-01-01', 'sex': 'F'},
        'study': {**template['study'], 'studyInstanceUid': study_uid or f'2.25.{int(run, 16)}.{i}', 'accessionNumber': f'LOAD{run}{i}'},
    }
    if template.get('prescription'):
        meta['prescription'] = template['prescription']
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('metadata.json', json.dumps(meta, ensure_ascii=False))
        zf.write(DATASETS / template['image'], 'images/1.dcm')
        if template.get('report'):
            zf.writestr('report.json', json.dumps(template['report'], ensure_ascii=False))
        if template.get('prescriptionImage'):
            zf.write(DATASETS / template['prescriptionImage'], 'prescription' + Path(template['prescriptionImage']).suffix)
    return buf.getvalue()


def send_zip(name: str, data: bytes, expect=(201,)):
    boundary = uuid.uuid4().hex
    raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="load.zip"\r\nContent-Type: application/zip\r\n\r\n'.encode()
           + data + f'\r\n--{boundary}--\r\n'.encode())
    return call(name, 'POST', '/ingest', raw=raw, ctype=f'multipart/form-data; boundary={boundary}', expect=expect, timeout=120)


# ---------------------------------------------------------------- phases

def intake(template: dict, run: str, count: int, senders: int) -> list[dict]:
    zips = [build_zip(template, run, i) for i in range(count)]
    started = time.perf_counter()
    with ThreadPoolExecutor(senders) as pool:
        answers = list(pool.map(lambda z: send_zip('PACS: send ZIP', z), zips))
    took = time.perf_counter() - started
    accepted = [a for s, a in answers if s == 201 and isinstance(a, dict) and a.get('status') == 'READY']
    report(f'1. Intake: {count} ZIPs, {senders} at a time ({len(zips[0]) // 1024} KB each)', ['PACS: send ZIP'], took)
    print(f'   accepted {len(accepted)} of {count}; {count / took:.1f} ZIPs per second')
    return accepted


def collisions(template: dict, run: str) -> None:
    print('\n2. Collisions (5 tries each)')
    same_patient_ok = same_study_ok = 0
    for t in range(5):
        patient = {'name': f'آزمایش بار {run} همزمان {t}', 'nationalId': national_id(900_000 + int(run, 16) % 10_000 * 10 + t),
                   'mobile': f'0918{random.randint(1000000, 9999999)}', 'birthDate': '1980-01-01', 'sex': 'F'}
        a = build_zip(template, run, 10_000 + 2 * t, patient=patient)
        b = build_zip(template, run, 10_001 + 2 * t, patient=patient)
        with ThreadPoolExecutor(2) as pool:
            got = list(pool.map(lambda z: send_zip('collision: same new patient', z), [a, b]))
        if all(s == 201 and isinstance(x, dict) and x.get('status') == 'READY' for s, x in got):
            same_patient_ok += 1
        uid = f'2.25.{int(run, 16)}.dup{t}'
        c = build_zip(template, run, 20_000 + 2 * t, study_uid=uid)
        d = build_zip(template, run, 20_001 + 2 * t, study_uid=uid)
        with ThreadPoolExecutor(2) as pool:
            got = list(pool.map(lambda z: send_zip('collision: same study twice', z, expect=(201, 409)), [c, d]))
        ready = sum(1 for s, x in got if isinstance(x, dict) and x.get('status') == 'READY')
        if ready == 1:
            same_study_ok += 1
    print(f'   same new patient in two ZIPs at once: both accepted in {same_patient_ok} of 5')
    print(f'   same study sent twice at once: exactly one accepted in {same_study_ok} of 5')


def reading(accepted: list[dict], users: int, seconds: float, demo: bool) -> None:
    tokens = {}
    for role, (user, password) in ACCOUNTS.items():
        s, body = call('sign in: staff', 'POST', f'/{role}/login', {'username': user, 'password': password})
        if s == 200:
            tokens[role] = body['token']
        else:
            print(f'   could not sign in to {role} ({s}); its pages are left out')

    # Patients: sign a few in (needs demo mode, which shows the code).
    patients = []
    if demo:
        s, dev = call('dev: list cases', 'GET', '/dev/cases')
        mine = {c['id']: c for c in (dev.get('cases', []) if isinstance(dev, dict) else [])}
        for a in accepted[:20]:
            c = mine.get(a['caseId'])
            if not c:
                continue
            p = {'nationalId': c['national_id'], 'mobile': c['mobile']}
            s, ch = call('patient: ask for code', 'POST', '/portal/login/code', {'nationalId': p['nationalId'], 'mobile': p['mobile']})
            if s != 200 or not ch.get('sampleCode'):
                continue
            s, ses = call('patient: sign in', 'POST', '/portal/login/verify', {'challengeId': ch['challengeId'], 'code': ch['sampleCode']})
            if s == 200:
                patients.append((ses['token'], a['caseId']))
    else:
        print('   demo mode is off, so patients are left out (their sign-in code goes by SMS only)')

    case_ids = [a['caseId'] for a in accepted]
    insurer_cases: list[str] = []
    if 'insurance' in tokens:
        s, body = call('insurance: case list', 'GET', '/insurance/cases?pageSize=50', token=tokens['insurance'])
        if s == 200:
            insurer_cases = [c.get('caseId') or c.get('id') for c in body.get('items', [])]
    zip_ids = []
    if 'admin' in tokens:
        s, body = call('admin: ZIP list', 'GET', '/admin/zips?pageSize=50', token=tokens['admin'])
        if s == 200:
            zip_ids = [z['id'] for z in body.get('items', [])]

    actions = []
    if patients:
        actions += [
            (3, lambda: (lambda t: call('patient: my cases', 'GET', '/portal/cases', token=t[0]))(random.choice(patients))),
            (3, lambda: (lambda t: call('patient: one case', 'GET', f'/portal/cases/{t[1]}', token=t[0]))(random.choice(patients))),
        ]
    if 'insurance' in tokens:
        tk = tokens['insurance']
        actions += [(2, lambda: call('insurance: dashboard', 'GET', '/insurance/dashboard', token=tk)),
                    (2, lambda: call('insurance: case list', 'GET', f'/insurance/cases?page={random.randint(1, 3)}', token=tk))]
        if insurer_cases:
            actions.append((2, lambda: call('insurance: one case', 'GET', f'/insurance/cases/{random.choice(insurer_cases)}', token=tk)))
    if 'admin' in tokens:
        ta = tokens['admin']
        actions += [(2, lambda: call('admin: overview', 'GET', '/admin/overview', token=ta)),
                    (2, lambda: call('admin: ZIP list', 'GET', f'/admin/zips?page={random.randint(1, 5)}', token=ta)),
                    (1, lambda: call('admin: search', 'GET', '/admin/zips?search=' + urllib.request.quote('آزمایش'), token=ta))]
        if zip_ids:
            actions.append((2, lambda: call('admin: one ZIP', 'GET', f'/admin/zips/{random.choice(zip_ids)}', token=ta)))
        if case_ids:
            actions.append((1, lambda: call('DICOM pictures (PNG)', 'GET', f'/imaging/cases/{random.choice(case_ids)}/images', token=ta)))
    if 'pacs-admin' in tokens:
        tp = tokens['pacs-admin']
        actions.append((1, lambda: call('PACS admin: volume', 'GET', f"/pacs-admin/volume?period={random.choice(['today', '7d', '30d', 'all'])}", token=tp)))
    if not actions:
        print('   nothing to read: no account could sign in')
        return

    weights = [w for w, _ in actions]
    fns = [f for _, f in actions]
    reading_names = {'patient: my cases', 'patient: one case', 'insurance: dashboard', 'insurance: case list', 'insurance: one case',
                     'admin: overview', 'admin: ZIP list', 'admin: search', 'admin: one ZIP', 'DICOM pictures (PNG)', 'PACS admin: volume'}
    for n in reading_names:
        results.pop(n, None)
        problems.pop(n, None)
    stop = time.perf_counter() + seconds

    def person():
        while time.perf_counter() < stop:
            random.choices(fns, weights)[0]()
            time.sleep(random.uniform(0.2, 1.0))  # a person reads the page before the next click

    started = time.perf_counter()
    threads = [threading.Thread(target=person) for _ in range(users)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    report(f'3. Reading: {users} people at once for {seconds:.0f} s (each waits 0.2 to 1 s between clicks)',
           sorted(n for n in reading_names if n in results), time.perf_counter() - started)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--zips', type=int, default=100, help='new ZIPs to send (default 100)')
    ap.add_argument('--senders', type=int, default=10, help='ZIPs sent at the same time (default 10)')
    ap.add_argument('--users', type=int, default=20, help='people using the panels at the same time (default 20)')
    ap.add_argument('--seconds', type=float, default=60, help='how long the reading part runs (default 60)')
    args = ap.parse_args()

    s, health = call('health', 'GET', '/health')
    if s != 200:
        sys.exit(f'The backend at {API} does not answer ({s}). Is it running?')
    print(f'Backend at {API}: checker {health.get("checker")}, demo mode {"on" if health.get("demoMode") else "off"}')
    run = uuid.uuid4().hex[:6]
    template = load_template()
    accepted = intake(template, run, args.zips, args.senders)
    collisions(template, run)
    reading(accepted, args.users, args.seconds, bool(health.get('demoMode')))
    failed = sum(1 for rows in results.values() for _, ok in rows if not ok)
    print(f'\n{failed} failed requests in total.' if failed else '\nNo failed requests.')


if __name__ == '__main__':
    main()
