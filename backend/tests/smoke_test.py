"""End-to-end check of the patient path against running services, with the fake checker.

It sends all 15 sample cases from the sandbox PACS, signs in as each patient, answers the way each case expects,
waits for the check and compares the outcome. It starts by wiping the demo data.

Run with Docker running:   docker compose exec backend python tests/smoke_test.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

API = os.environ.get('SMOKE_API', 'http://localhost:8000/api/v1')
SANDBOX = os.environ.get('SMOKE_SANDBOX', os.environ.get('SANDBOX_URL', 'http://localhost:8001'))
DATASETS = Path(os.environ.get('DATASETS_DIR', Path(__file__).resolve().parents[2] / 'datasets'))

EXPECT = {
    'MG-001': ('AT_INSURER', None), 'MG-002': ('AT_INSURER', None), 'MG-003': ('AT_INSURER', None), 'MG-004': ('AT_INSURER', None),
    'MG-005': ('AT_INSURER', None), 'MG-006': ('REJECTED_CONFLICT', 'PRESCRIPTION_STUDY'), 'MG-007': ('REJECTED_CONFLICT', 'PRESCRIPTION_NAME'),
    'MG-008': ('REJECTED_CONFLICT', 'PRESCRIPTION_NAME'), 'MG-009': ('REJECTED_CONFLICT', 'PRESCRIPTION_STUDY'),
    'MG-010': ('REJECTED_CONFLICT', 'REPORT_IMAGES'), 'MG-011': ('AT_INSURER', None), 'MG-012': ('REJECTED_CONFLICT', 'PATIENT_DENIED'),
    'MG-014': ('AT_INSURER', None), 'MG-015': ('AT_INSURER', None),
}

fails = 0


def ok(name: str, cond: bool, extra: object = '') -> None:
    global fails
    if not cond:
        fails += 1
    print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f'  {str(extra)[:300]}'))


def call(method: str, path: str, body=None, token: str | None = None, raw: bytes | None = None, ctype: str | None = None, base: str = API):
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if ctype:
        headers['Content-Type'] = ctype
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            text = res.read()
            return res.status, json.loads(text) if text and text[:1] in b'{[' else text
    except urllib.error.HTTPError as err:
        text = err.read()
        try:
            return err.code, json.loads(text)
        except ValueError:
            return err.code, text


def upload(path: str, token: str, file: Path, mime: str):
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file.name}"\r\nContent-Type: {mime}\r\n\r\n').encode() + file.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    return call('PUT', path, token=token, raw=body, ctype=f'multipart/form-data; boundary={boundary}')


def main() -> int:
    cases = {c['id']: c for c in json.loads((DATASETS / 'cases.json').read_text(encoding='utf-8'))['cases']}
    erx_by_case = {p['caseId']: p['id'] for p in json.loads((DATASETS / 'e-prescriptions.json').read_text(encoding='utf-8'))['prescriptions']}
    s, _ = call('POST', '/dev/reset', raw=b'')
    ok('demo data wiped', s == 200)

    # ---- every case goes out from the PACS
    for cid in cases:
        call('POST', f'/pacs/send/{cid}', raw=b'', base=SANDBOX)
    s, overview = call('GET', '/dev/cases')
    by_acc = {c['accessionNumber']: c for c in overview['cases']}
    ok('14 cases created (the ZIP without images is refused)', len(overview['cases']) == 14, len(overview['cases']))
    broken = next((z for z in overview['zips'] if z['status'] != 'READY'), None)
    ok('ZIP without DICOM rejected as incomplete', broken and broken['status'] == 'REJECTED_INCOMPLETE', broken)
    call('POST', '/pacs/send/MG-015', raw=b'', base=SANDBOX)
    s, overview = call('GET', '/dev/cases')
    ok('same study sent twice is refused as a duplicate', any(z['status'] == 'DUPLICATE' for z in overview['zips']))
    body = b'--zz\r\nContent-Disposition: form-data; name="file"; filename="a.zip"\r\nContent-Type: application/zip\r\n\r\nPK\r\n--zz--\r\n'
    s, res = call('POST', '/ingest', raw=body, ctype='multipart/form-data; boundary=zz')
    ok('ingest refuses a request without the PACS key', s == 401 and res.get('code') == 'BAD_API_KEY', (s, res))

    s, inbox = call('GET', '/sms', base=SANDBOX)
    ok('invite SMS reached the gateway with the panel link', isinstance(inbox, bytes) and '/c/'.encode() in inbox)

    # ---- sign-in errors
    sara = cases['MG-001']['patient']
    s, err = call('POST', '/portal/login/code', {'nationalId': sara['nationalId'], 'mobile': '09120000000'})
    ok('wrong mobile: INVALID_LOGIN', err.get('code') == 'INVALID_LOGIN', err)
    s, err = call('GET', '/portal/cases')
    ok('no session: UNAUTHORIZED', s == 401 and err.get('code') == 'UNAUTHORIZED', err)
    s, invite = call('GET', f"/portal/invites/{by_acc[cases['MG-001']['study']['accessionNumber']]['invite_token']}")
    ok('invite link opens the case', s == 200 and invite['caseId'].startswith('case-'), invite)

    tokens: dict[str, str] = {}

    def login(patient: dict) -> str:
        if patient['nationalId'] in tokens:
            return tokens[patient['nationalId']]
        s, ch = call('POST', '/portal/login/code', {'nationalId': patient['nationalId'], 'mobile': patient['mobile']})
        assert s == 200, ch
        s, again = call('POST', '/portal/login/code', {'nationalId': patient['nationalId'], 'mobile': patient['mobile']})
        ok(f"{patient['name']}: second code too soon is refused", again.get('code') == 'TOO_SOON', again)
        s, wrong = call('POST', '/portal/login/verify', {'challengeId': ch['challengeId'], 'code': '00000' if ch['sampleCode'] != '00000' else '11111'})
        ok(f"{patient['name']}: wrong code counted", wrong.get('code') == 'WRONG_CODE', wrong)
        persian = ch['sampleCode'].translate(str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹'))
        s, session = call('POST', '/portal/login/verify', {'challengeId': ch['challengeId'], 'code': persian})
        ok(f"{patient['name']}: signs in with the code typed in Persian digits", s == 200 and session.get('token'), session)
        tokens[patient['nationalId']] = session['token']
        s, me = call('GET', '/portal/me', token=session['token'])
        if me.get('needsFirstInfo'):
            s, bad = call('PUT', '/portal/me/insurance', {'insurer': 'بیمه دانا', 'policyNumber': ' ', 'relation': 'خود شخص'}, token=session['token'])
            ok(f"{patient['name']}: empty policy number refused", bad.get('code') == 'INVALID_POLICY', bad)
            s, me = call('PUT', '/portal/me/insurance', {'insurer': 'بیمه دانا', 'policyNumber': 'DN-۱۲۳', 'relation': 'خود شخص'}, token=session['token'])
            ok(f"{patient['name']}: insurance saved on first visit", s == 200 and not me['needsFirstInfo'] and me['insurance']['policyNumber'] == 'DN-123', me)
        return session['token']

    # ---- each patient answers
    for cid, case in cases.items():
        if cid == 'MG-013':
            continue
        token = login(case['patient'])
        backend_id = by_acc[case['study']['accessionNumber']]['id']
        s, pc = call('GET', f'/portal/cases/{backend_id}', token=token)
        ok(f'{cid}: case opens for its patient, waiting', s == 200 and pc['stage'] == 'WAITING_PATIENT', pc)
        ok(f'{cid}: no AI result or amount in the patient view', 'aiOpinion' not in pc and 'insuranceShare' not in pc)
        mode = case['prescriptionMode']
        ok(f'{cid}: asks to confirm the service' + (' and the prescription' if mode == 'pacs' else ''),
           pc['confirmItems'] == (['service', 'prescription'] if mode == 'pacs' else ['service']), pc['confirmItems'])
        if mode == 'pacs':
            rx = next(d for d in pc['documents'] if d['key'] == 'prescription')
            ok(f'{cid}: prescription picture sent to the phone', rx.get('previewDataUrl', '').startswith('data:image/jpeg;base64,'))
        s, early = call('POST', f'/portal/cases/{backend_id}/submit', token=token)
        ok(f'{cid}: confirm before answering is refused', early.get('code') == 'NOT_CONFIRMED', early)
        if cid == 'MG-012':
            s, pc = call('POST', f'/portal/cases/{backend_id}/confirm/service', {'yes': False}, token=token)
            continue
        call('POST', f'/portal/cases/{backend_id}/confirm/service', {'yes': True}, token=token)
        if mode == 'pacs':
            s, pc = call('POST', f'/portal/cases/{backend_id}/confirm/prescription', {'yes': True}, token=token)
        if mode == 'erx':
            s, bad = call('POST', f'/portal/cases/{backend_id}/e-prescription', {'eRxId': '12'}, token=token)
            ok(f'{cid}: too-short e-prescription code refused', bad.get('code') == 'INVALID_ERX', bad)
            code = '99999999' if cid == 'MG-014' else erx_by_case[cid]
            s, pc = call('POST', f'/portal/cases/{backend_id}/e-prescription', {'eRxId': code}, token=token)
            ok(f'{cid}: e-prescription code saved', s == 200 and any(d.get('eRxId') == code for d in pc['documents']), pc)
        if mode == 'paper':
            s, pc = upload(f'/portal/cases/{backend_id}/documents/prescription', token, DATASETS / 'patient-uploads' / f'{cid}-prescription.jpg', 'image/jpeg')
            ok(f'{cid}: prescription photo uploaded', s == 200 and 'prescription' not in pc['requiredItems'], pc)
        if not case.get('report'):
            s, pc = upload(f'/portal/cases/{backend_id}/documents/report', token, DATASETS / 'patient-uploads' / f'{cid}-report.png', 'image/png')
            ok(f'{cid}: report photo uploaded', s == 200 and not pc['requiredItems'], pc)
        s, pc = call('POST', f'/portal/cases/{backend_id}/submit', token=token)
        ok(f'{cid}: «تأیید» moves it to PROCESSING', s == 200 and pc['stage'] == 'PROCESSING' and pc.get('trackingNumber'), pc)

    # ---- the check runs in the background
    deadline = time.time() + 90
    while time.time() < deadline:
        s, overview = call('GET', '/dev/cases')
        if not any(c['stage'] == 'PROCESSING' for c in overview['cases']):
            break
        time.sleep(1)
    by_acc = {c['accessionNumber']: c for c in overview['cases']}

    # MG-014 used a wrong code: it comes back to the patient, who enters the right one.
    c14 = by_acc[cases['MG-014']['study']['accessionNumber']]
    ok('MG-014: unknown e-prescription code sends the case back to the patient', c14['stage'] == 'WAITING_PATIENT', c14['stage'])
    token = tokens[cases['MG-014']['patient']['nationalId']]
    s, pc = call('GET', f"/portal/cases/{c14['id']}", token=token)
    ok('MG-014: asked for the prescription again, service confirmation kept', 'prescription' in pc['requiredItems'] and 'service' in pc['confirmedItems'], pc)
    call('POST', f"/portal/cases/{c14['id']}/e-prescription", {'eRxId': erx_by_case['MG-014']}, token=token)
    s, pc = call('POST', f"/portal/cases/{c14['id']}/submit", token=token)
    s, res = call('POST', f"/dev/cases/{c14['id']}/check-now", raw=b'')
    ok('MG-014: run-now tool checks it straight away', res.get('result') == 'sent', res)

    s, overview = call('GET', '/dev/cases')
    by_acc = {c['accessionNumber']: c for c in overview['cases']}
    for cid, (stage, kind) in EXPECT.items():
        c = by_acc[cases[cid]['study']['accessionNumber']]
        got_kind = (c.get('conflict') or {}).get('kind')
        ok(f'{cid}: {stage}' + (f' ({kind})' if kind else ''), c['stage'] == stage and got_kind == kind, (c['stage'], got_kind))
        if stage == 'AT_INSURER':
            ok(f'{cid}: mammography share 6,000,000 rials', (c.get('insurance_share') or {}).get('insurerShareRial') == 6_000_000, c.get('insurance_share'))

    sara_token = tokens[sara['nationalId']]
    s, mine = call('GET', '/portal/cases', token=sara_token)
    ok('Sara sees her two same-day services as two cases', len(mine) == 2 and all(m['stage'] == 'AT_INSURER' for m in mine), [m['stage'] for m in mine])
    other = by_acc[cases['MG-006']['study']['accessionNumber']]['id']
    s, err = call('GET', f'/portal/cases/{other}', token=sara_token)
    ok("a patient cannot open someone else's case", s == 404, s)
    s, pc = call('GET', f"/portal/cases/{by_acc[cases['MG-006']['study']['accessionNumber']]['id']}", token=tokens[cases['MG-006']['patient']['nationalId']])
    ok('conflict reason shown to the patient', 'conflictReason' in pc and 'نسخه' in pc['conflictReason'], pc)

    s, inbox = call('GET', '/sms', base=SANDBOX)
    text = inbox.decode() if isinstance(inbox, bytes) else ''
    ok('SMS inbox has a "sent to insurer" message', 'برای بیمه ارسال شد' in text)
    ok('SMS inbox has a conflict message', 'مغایرت دارد' in text)
    ok('SMS inbox has a login code', 'کد ورود شما' in text)
    s, events = call('GET', f"/dev/cases/{by_acc[cases['MG-003']['study']['accessionNumber']]['id']}/events")
    ok('events show the e-prescription was fetched', any('نسخه الکترونیک از سامانه نسخه دریافت شد' in e['title'] for e in events['events']))
    ok('SMS history keeps no login codes', not any('کد ورود شما' in m['text'] for m in events['sms']))

    # ---- the insurance panel sees only the approved cases
    s, err = call('POST', '/insurance/login', {'username': 'dana-admin', 'password': 'wrong'})
    ok('insurer: wrong password refused', err.get('code') == 'INVALID_LOGIN', err)
    s, err = call('GET', '/insurance/cases', token=sara_token)
    ok("insurer: a patient's session can't open the insurance panel", s == 401, s)
    s, ins = call('POST', '/insurance/login', {'username': 'dana-admin', 'password': 'dana1234'})
    ok('insurer: signs in', s == 200 and ins.get('role') == 'INSURANCE_ADMIN' and ins.get('token'), ins)
    it = ins['token']
    s, page = call('GET', '/insurance/cases?page=1&pageSize=5', token=it)
    approved = [cid for cid, (stage, _) in EXPECT.items() if stage == 'AT_INSURER']
    ok(f'insurer: list holds the {len(approved)} approved cases', page['total'] == len(approved) and len(page['items']) == 5 and page['page'] == 1, page.get('total'))
    s, page2 = call('GET', '/insurance/cases?page=2&pageSize=5', token=it)
    ok('insurer: second page has the rest', len(page2['items']) == len(approved) - 5, len(page2['items']))
    s, far = call('GET', '/insurance/cases?page=9&pageSize=5', token=it)
    ok('insurer: a page past the end returns the last page', far['page'] == 2, far.get('page'))
    names = {r['patientName'] for r in page['items'] + page2['items']}
    ok('insurer: no rejected or waiting case in the list', not names & {cases[c]['patient']['name'] for c in ('MG-006', 'MG-007', 'MG-009', 'MG-010', 'MG-012')}, names)
    ok('insurer: every row shows the share', all(r['insurerShareRial'] == 6_000_000 for r in page['items']), page['items'][0])
    h1 = cases['MG-001']['hospital']['id']
    s, only = call('GET', f'/insurance/cases?hospitalId={h1}&pageSize=50', token=it)
    ok('insurer: filter by center', only['total'] > 0 and all(r['hospitalId'] == h1 for r in only['items']), only.get('total'))
    sara_case = by_acc[cases['MG-001']['study']['accessionNumber']]['id']
    s, rec = call('GET', f'/insurance/cases/{sara_case}', token=it)
    ok('insurer: case opens with patient, insurance and share', s == 200 and rec['patient']['insurance']['policyNumber'] == 'DN-123' and rec['insuranceShare']['insurerShareRial'] == 6_000_000, rec.get('patient'))
    ok('insurer: prescription picture and report text', rec['documents']['prescription'].get('previewDataUrl', '').startswith('data:image/jpeg') and 'ماموگرافی' in rec['documents']['report'].get('reportText', ''), list(rec['documents']))
    ok('insurer: AI opinion and tracking number', rec['aiOpinion']['result'] == 'OK' and rec.get('trackingNumber'), rec.get('aiOpinion'))
    erx_case = by_acc[cases['MG-003']['study']['accessionNumber']]['id']
    s, rec3 = call('GET', f'/insurance/cases/{erx_case}', token=it)
    ok('insurer: e-prescription code shown', rec3['documents']['prescription'].get('eRxId') == erx_by_case['MG-003'], rec3['documents'].get('prescription'))
    paper_case = by_acc[cases['MG-004']['study']['accessionNumber']]['id']
    s, rec4 = call('GET', f'/insurance/cases/{paper_case}', token=it)
    ok("insurer: patient's prescription photo shown", rec4['documents']['prescription']['source'] == 'PATIENT' and rec4['documents']['prescription'].get('previewDataUrl'), rec4['documents'].get('prescription', {}).get('source'))
    s, imgs = call('GET', f'/imaging/cases/{sara_case}/images', token=it)
    ok('insurer: DICOM picture as PNG', s == 200 and len(imgs) == 1 and imgs[0]['url'].startswith('data:image/png;base64,') and imgs[0]['width'] > 0, s)
    rejected = by_acc[cases['MG-006']['study']['accessionNumber']]['id']
    s, err = call('GET', f'/insurance/cases/{rejected}', token=it)
    ok('insurer: a rejected case stays closed', s == 404 and err.get('message') == 'این پرونده در پنل بیمه نیست.', (s, err))
    s, err = call('GET', f'/imaging/cases/{rejected}/images', token=it)
    ok("insurer: a rejected case's pictures stay closed", s == 404, s)
    s, dash = call('GET', '/insurance/dashboard', token=it)
    ok('insurer: dashboard counts', dash['cases']['atInsurer'] == len(approved) and dash['cases']['conflict'] == 6 and dash['totals']['accepted'] == 14 and dash['totals']['notBillable'] == 2, dash.get('cases'))
    ok('insurer: dashboard share and conflict causes', dash['insurerShareRial'] == len(approved) * 6_000_000 and dash['conflicts']['PRESCRIPTION_NAME'] == 2 and dash['conflicts']['PATIENT_DENIED'] == 1, dash.get('conflicts'))
    ok('insurer: one row per center', len(dash['hospitals']) == 3 and sum(h['cases']['atInsurer'] for h in dash['hospitals']) == len(approved), len(dash['hospitals']))

    # ---- the PACS admin sees only how much each center sent
    s, err = call('POST', '/pacs-admin/login', {'username': 'dana-admin', 'password': 'dana1234'})
    ok("PACS admin: an insurance account can't sign in here", err.get('code') == 'INVALID_LOGIN', err)
    s, pa = call('POST', '/pacs-admin/login', {'username': 'pacs-admin', 'password': 'pacs1234'})
    ok('PACS admin: signs in', s == 200 and pa.get('token'), pa)
    pt = pa['token']
    s, err = call('GET', '/insurance/cases', token=pt)
    ok("PACS admin: can't open the insurance panel", s == 401, s)
    s, err = call('GET', '/pacs-admin/volume', token=it)
    ok("PACS admin: the insurance account can't open the volume", s == 401, s)
    s, vol = call('GET', '/pacs-admin/volume?period=today', token=pt)
    ok('PACS admin: 16 ZIPs today, 14 accepted, 2 refused', vol['total'] == {**vol['total'], 'sent': 16, 'accepted': 14, 'rejected': 2}, vol.get('total'))
    by_name = {c['name']: c for c in vol['centers']}
    ok('PACS admin: per center 6, 6 and 4', [by_name[n]['sent'] for n in ('بیمارستان امام حسین', 'بیمارستان بقیه‌الله', 'مرکز تصویربرداری پارس')] == [6, 6, 4], {n: c['sent'] for n, c in by_name.items()})
    ok('PACS admin: most sends first', [c['sent'] for c in vol['centers']] == sorted((c['sent'] for c in vol['centers']), reverse=True))
    ok('PACS admin: refused ZIPs counted per center', by_name['بیمارستان امام حسین']['rejected'] == 1 and by_name['بیمارستان بقیه‌الله']['rejected'] == 1)
    ok('PACS admin: size and last send shown', vol['total']['sizeBytes'] > 0 and all(c.get('lastSentAt') for c in vol['centers']))
    ok('PACS admin: one daily bar for today', len(vol['daily']) == 1 and vol['daily'][0]['sent'] == 16, vol.get('daily'))
    s, vol30 = call('GET', '/pacs-admin/volume?period=30d', token=pt)
    ok('PACS admin: 30 days gives 30 daily bars', len(vol30['daily']) == 30 and vol30['total']['sent'] == 16, len(vol30.get('daily', [])))
    text = json.dumps(vol30, ensure_ascii=False)
    ok('PACS admin: no patient names or national IDs in the answer', not any(c['patient']['name'] in text or c['patient']['nationalId'] in text for c in cases.values()))

    print('all passed' if not fails else f'FAILED {fails}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
