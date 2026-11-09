"""Stand-ins for the outside systems, in one small app:

  /pacs   the hospital PACS: one «ارسال» button per sample study, which zips it and sends it to the backend
  /sms    the SMS gateway: receives the backend's messages and shows them like a phone inbox
  /erx    the national e-prescription service: answers the backend's lookups by prescription code

Run:  uvicorn app.main:app --port 8001
"""
from __future__ import annotations

import html
import io
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
DATASETS = Path(os.environ.get('DATASETS_DIR', HERE.parents[1] / 'datasets')).resolve()
STATE = Path(os.environ.get('SANDBOX_DATA', HERE.parents[1] / 'sandbox-data')).resolve()
BACKEND = os.environ.get('BACKEND_URL', 'http://localhost:8000').rstrip('/')
PACS_KEY = os.environ.get('PACS_API_KEY', 'dev-pacs-key')

STATE.mkdir(parents=True, exist_ok=True)
SMS_FILE = STATE / 'sms.jsonl'
_sms_lock = threading.Lock()

app = FastAPI(title='سامانه‌های بیرونی نمونه', version='0.1.0')
app.mount('/static', StaticFiles(directory=HERE / 'static'), name='static')

STAGES = {
    'WAITING_PATIENT': ('در انتظار بیمار', 'warn'),
    'PROCESSING': ('در حال بررسی', 'info'),
    'AT_INSURER': ('ارسال‌شده به بیمه', 'ok'),
    'REJECTED_CONFLICT': ('رد: مغایرت', 'bad'),
}
ZIP_STATUS = {'REJECTED_INCOMPLETE': 'ZIP ناقص رد شد', 'REJECTED_TOO_LARGE': 'ZIP خیلی بزرگ بود', 'DUPLICATE': 'تکراری، رد شد'}
FA = str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')


def fa(value: object) -> str:
    return str(value).translate(FA)


def esc(value: object) -> str:
    return html.escape(str(value if value is not None else ''))


def jalali(iso: str) -> str:
    gy, gm, gd = (int(x) for x in iso[:10].split('-'))
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + 1 if gm > 2 else gy
    days = 355666 + (365 * gy) + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) + gd + g_d_m[gm - 1]
    jy = -1595 + (33 * (days // 12053))
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    jm = 1 + days // 31 if days < 186 else 7 + (days - 186) // 30
    jd = 1 + (days % 31 if days < 186 else (days - 186) % 30)
    return fa(f'{jy}/{jm:02d}/{jd:02d}')


def clock(iso: str) -> str:
    try:
        t = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone()
    except ValueError:
        return ''
    return fa(t.strftime('%H:%M:%S'))


def load_cases() -> list[dict]:
    return json.loads((DATASETS / 'cases.json').read_text(encoding='utf-8'))['cases']


def load_erx() -> list[dict]:
    path = DATASETS / 'e-prescriptions.json'
    return json.loads(path.read_text(encoding='utf-8'))['prescriptions'] if path.exists() else []


def backend(path: str, method: str = 'GET', body: bytes | None = None, headers: dict | None = None, timeout: float = 30) -> tuple[int, dict]:
    req = urllib.request.Request(f'{BACKEND}{path}', data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read() or b'{}')
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read() or b'{}')
        except ValueError:
            return err.code, {'message': f'HTTP {err.code}'}
    except Exception as err:  # noqa: BLE001
        return 0, {'message': f'سرور اصلی در دسترس نیست ({err}).'}


# ---------------------------------------------------------------- layout

def page(title: str, active: str, body: str, refresh: int | None = None) -> HTMLResponse:
    nav = ''.join(
        f'<a href="{href}" class="{"on" if key == active else ""}">{label}</a>'
        for key, href, label in (('pacs', '/pacs', 'PACS نمونه'), ('sms', '/sms', 'پیامک‌ها'), ('erx', '/erx', 'نسخه الکترونیک'))
    )
    meta = f'<meta http-equiv="refresh" content="{refresh}">' if refresh else ''
    return HTMLResponse(f'''<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">{meta}
<title>{esc(title)}</title><link rel="stylesheet" href="/static/style.css"></head>
<body><header class="top"><div class="brand"><strong>سامانه‌های بیرونی نمونه</strong><span>برای آزمون، به‌جای PACS بیمارستان، پیامک و نسخه الکترونیک</span></div>
<nav>{nav}</nav></header><main>{body}</main></body></html>''')


def notice(request: Request) -> str:
    msg, tone = request.query_params.get('msg'), request.query_params.get('tone', 'ok')
    return f'<div class="notice {esc(tone)}" role="status">{esc(msg)}</div>' if msg else ''


def back(path: str, msg: str, tone: str = 'ok') -> RedirectResponse:
    return RedirectResponse(f'{path}?{urllib.parse.urlencode({"msg": msg, "tone": tone})}', status_code=303)


# ---------------------------------------------------------------- PACS

def build_zip(case: dict) -> tuple[str, bytes]:
    """The package as a relay would send it: details, the DICOM image, and whatever documents the hospital has."""
    meta = {
        'schema': 'imaging-relay/1',
        'sentAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'hospital': case['hospital'],
        'patient': case['patient'],
        'study': case['study'],
    }
    if case.get('prescription'):
        meta['prescription'] = case['prescription']
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('metadata.json', json.dumps(meta, ensure_ascii=False, indent=2))
        if case.get('image'):
            zf.write(DATASETS / case['image'], 'images/1.dcm')
        if case.get('report'):
            zf.writestr('report.json', json.dumps(case['report'], ensure_ascii=False, indent=2))
        if case.get('prescriptionImage'):
            zf.write(DATASETS / case['prescriptionImage'], 'prescription' + Path(case['prescriptionImage']).suffix)
    return f"{case['hospital']['id']}_{case['study']['accessionNumber']}.zip", buf.getvalue()


def multipart(field: str, filename: str, data: bytes, mime: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
            f'Content-Type: {mime}\r\n\r\n').encode()
    return head + data + f'\r\n--{boundary}--\r\n'.encode(), f'multipart/form-data; boundary={boundary}'


def chip(text: str, tone: str = '') -> str:
    return f'<span class="chip {tone}">{esc(text)}</span>'


@app.get('/', include_in_schema=False)
def home():
    return RedirectResponse('/pacs')


@app.get('/pacs', response_class=HTMLResponse)
def pacs_page(request: Request):
    status, data = backend('/api/v1/dev/cases', timeout=5)
    offline = status != 200
    by_acc: dict[str, list[dict]] = {}
    for c in data.get('cases', []) if not offline else []:
        by_acc.setdefault(c.get('accessionNumber'), []).append(c)
    zips = data.get('zips', []) if not offline else []
    rows = []
    for case in load_cases():
        acc = case['study']['accessionNumber']
        mode = case['prescriptionMode']
        rx = {'pacs': chip('نسخه در ZIP'), 'erx': chip(f"نسخه الکترونیک: {case['eRxId']}", 'info'), 'paper': chip('نسخه کاغذی، بیمار عکس می‌فرستد', 'info')}[mode]
        report = '' if case.get('report') else chip('گزارش در ZIP نیست', 'warn')
        uploads = ''.join(f'<a class="file" href="/files/patient-uploads/{esc(n)}" download>{esc(n)}</a>' for n in case.get('patientUploads', []))
        live = by_acc.get(acc, [])
        sent_zip = next((z for z in zips if z['file_name'].endswith(f'{acc}.zip') and z['status'] != 'READY'), None)
        state = ''
        if live:
            c = live[0]
            label, tone = STAGES.get(c['stage'], (c['stage'], ''))
            state = chip(label, tone)
            if c['stage'] == 'REJECTED_CONFLICT' and c.get('conflict'):
                state += f'<div class="small bad-ink">{esc(c["conflict"]["reason"])}</div>'
            if c['stage'] == 'PROCESSING':
                if c.get('checkingNow'):
                    state += '<div class="small">همین حالا در حال بررسی است…</div>'
                elif c.get('nextAttemptAt'):
                    when = datetime.fromtimestamp(c['nextAttemptAt'], timezone.utc).isoformat()
                    state += f'<div class="small">بررسی بعدی: ساعت {clock(when)}</div>'
                if c.get('lastProblem'):
                    state += f'<div class="small warn-ink">{esc(c["lastProblem"])}</div>'
            state += (f'<div class="actions"><a class="btn ghost" href="{esc(c["portalLink"])}" target="_blank" rel="noopener">باز کردن پنل بیمار</a>'
                      + f'<a class="btn ghost" href="/pacs/events/{esc(c["id"])}">رویدادها</a></div>')
        elif sent_zip:
            state = chip(ZIP_STATUS.get(sent_zip['status'], sent_zip['status']), 'bad') + f'<div class="small">{esc(sent_zip.get("reject_reason") or "")}</div>'
        p = case['patient']
        rows.append(f'''<article class="case">
  <div class="case-head"><span class="case-id">{esc(case["id"])}</span><h2>{esc(p["name"])}</h2><span class="muted">{esc(case["hospital"]["name"])}، {jalali(case["study"]["date"])}</span></div>
  <div class="case-body">
    <div><div class="study">{esc(case["study"]["title"])}</div><div class="chips">{rx}{report}</div>
      <p class="note">{esc(case["note"])}</p>
      <div class="small muted">ورود بیمار: کد ملی <bdi dir="ltr">{fa(p["nationalId"])}</bdi>، موبایل <bdi dir="ltr">{fa(p["mobile"])}</bdi></div>
      {f'<div class="uploads"><span class="small muted">برای بارگذاری در پنل بیمار:</span>{uploads}</div>' if uploads else ''}
    </div>
    <div class="side"><div class="small muted">نتیجه مورد انتظار</div><div class="expected">{esc(case["expected"])}</div>
      <div class="small muted">وضعیت در سامانه</div><div class="state">{state or '<span class="muted">هنوز فرستاده نشده</span>'}</div></div>
  </div>
  <div class="case-foot"><form method="post" action="/pacs/send/{esc(case["id"])}"><button class="btn">ارسال به سامانه</button></form>
    <a class="link" href="/pacs/zip/{esc(case["id"])}">دانلود ZIP</a></div>
</article>''')
    checking = any(c['stage'] == 'PROCESSING' for c in data.get('cases', [])) if not offline else False
    name = data.get('checkerName', '')
    who = (f'هوش مصنوعی، <bdi dir="ltr">{esc(name)}</bdi>' if data.get('checkerIsAi') else 'آزمایشی، بدون هوش مصنوعی (CHECKER=fake)')
    head = (f'<div class="notice bad">سرور اصلی در دسترس نیست: {esc(data.get("message"))}</div>' if offline else
            f'<p class="lead">هر دکمه «ارسال به سامانه» یک ZIP مثل ZIP واقعی PACS می‌سازد و به سرور اصلی می‌فرستد. بیمار پیامک می‌گیرد (صفحه «پیامک‌ها»). '
            f'بعد از «تأیید» بیمار، پرونده در صف بررسی می‌رود و {fa(data.get("checkDelaySeconds", 0))} ثانیه بعد خودکار بررسی می‌شود: یا برای بیمه ارسال می‌شود یا رد می‌شود.</p>'
            f'<p class="checker">بررسی‌کننده: <b>{who}</b></p>'
            + ('<p class="small muted">پرونده‌ای در حال بررسی است. این صفحه هر ۱۰ ثانیه تازه می‌شود.</p>' if checking else ''))
    tools = '<form method="post" action="/pacs/reset" class="reset" onsubmit="return confirm(\'همه پرونده‌ها و پیامک‌ها پاک شوند؟\')"><button class="btn danger">شروع دوباره</button></form>'
    return page('PACS نمونه', 'pacs', f'<div class="page-head"><h1>PACS نمونه</h1>{tools}</div>{notice(request)}{head}<div class="cases">{"".join(rows)}</div>',
                refresh=10 if checking else None)


@app.post('/pacs/send/{case_id}')
def pacs_send(case_id: str):
    case = next((c for c in load_cases() if c['id'] == case_id), None)
    if not case:
        return back('/pacs', 'این مورد پیدا نشد.', 'bad')
    name, data = build_zip(case)
    body, ctype = multipart('file', name, data, 'application/zip')
    status, result = backend('/api/v1/ingest', 'POST', body, {'Content-Type': ctype, 'X-Api-Key': PACS_KEY})
    if status == 201:
        return back('/pacs', f'{case_id} فرستاده شد. پیامک دعوت برای بیمار رفت.')
    reason = result.get('rejectReason') or result.get('message') or f'HTTP {status}'
    return back('/pacs', f'{case_id}: {reason}', 'bad')


@app.get('/pacs/zip/{case_id}')
def pacs_zip(case_id: str):
    case = next((c for c in load_cases() if c['id'] == case_id), None)
    if not case:
        return Response(status_code=404)
    name, data = build_zip(case)
    return Response(data, media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="{name}"'})


@app.get('/pacs/events/{backend_case_id}', response_class=HTMLResponse)
def pacs_events(backend_case_id: str):
    status, data = backend(f'/api/v1/dev/cases/{urllib.parse.quote(backend_case_id)}/events', timeout=5)
    if status != 200:
        return page('رویدادها', 'pacs', f'<div class="notice bad">{esc(data.get("message"))}</div>')
    ev = ''.join(f'<li><span class="time">{clock(e["at"])}</span><span class="chip">{esc(e["actor"])}</span>{esc(e["title"])}</li>' for e in data['events'])
    sms = ''.join(f'<li><span class="time">{clock(s["sent_at"])}</span><span class="chip">{esc(s["kind"])}</span>{esc(s["text"])}</li>' for s in data['sms'])
    return page('رویدادها', 'pacs', f'<div class="page-head"><h1>رویدادهای پرونده</h1><a class="link" href="/pacs">برگشت</a></div>'
                f'<section class="panel"><h2>رویدادها</h2><ol class="log">{ev}</ol></section><section class="panel"><h2>پیامک‌ها</h2><ol class="log">{sms or "<li>هیچ</li>"}</ol></section>')


@app.post('/pacs/reset')
def pacs_reset():
    status, result = backend('/api/v1/dev/reset', 'POST', b'')
    with _sms_lock:
        SMS_FILE.unlink(missing_ok=True)
    if status != 200:
        return back('/pacs', result.get('message', f'HTTP {status}'), 'bad')
    return back('/pacs', 'همه پرونده‌ها و پیامک‌ها پاک شدند.')


@app.get('/files/patient-uploads/{name}')
def patient_upload(name: str):
    path = (DATASETS / 'patient-uploads' / name).resolve()
    if path.parent != (DATASETS / 'patient-uploads').resolve() or not path.exists():
        return Response(status_code=404)
    return FileResponse(path, filename=name)


# ---------------------------------------------------------------- SMS gateway

@app.post('/sms/api/send')
async def sms_send(request: Request):
    body = await request.json()
    item = {'id': uuid.uuid4().hex[:10], 'to': str(body.get('to', '')), 'text': str(body.get('text', '')), 'kind': str(body.get('kind', '')),
            'at': datetime.now(timezone.utc).isoformat(timespec='seconds')}
    if not item['to'] or not item['text']:
        return JSONResponse({'code': 'BAD_REQUEST', 'message': 'to and text are required'}, status_code=400)
    with _sms_lock, SMS_FILE.open('a', encoding='utf-8') as f:
        f.write(json.dumps(item, ensure_ascii=False) + '\n')
    return {'id': item['id'], 'status': 'SENT'}


def read_sms() -> list[dict]:
    if not SMS_FILE.exists():
        return []
    with _sms_lock:
        lines = SMS_FILE.read_text(encoding='utf-8').splitlines()
    return [json.loads(line) for line in lines if line.strip()][::-1]


LINK = re.compile(r'(https?://[^\s]+)')


@app.get('/sms', response_class=HTMLResponse)
def sms_page(request: Request):
    who = request.query_params.get('to', '')
    items = [m for m in read_sms() if not who or m['to'] == who]
    numbers = sorted({m['to'] for m in read_sms()})
    filters = ''.join(f'<a class="chip {"on" if n == who else ""}" href="/sms?to={esc(n)}"><bdi dir="ltr">{fa(n)}</bdi></a>' for n in numbers)
    cards = []
    for m in items:
        text = LINK.sub(lambda x: f'<a href="{esc(x.group(1))}" target="_blank" rel="noopener">{esc(x.group(1))}</a>', esc(m['text']))
        code = re.search(r'کد ورود شما (\d+)', m['text'])
        cards.append(f'<li class="sms {esc(m["kind"].lower())}"><div class="sms-head"><bdi dir="ltr">{fa(m["to"])}</bdi><span>{clock(m["at"])}</span></div>'
                     f'<p>{text}</p>{f"<div class=code>{code.group(1)}</div>" if code else ""}</li>')
    body = (f'<div class="page-head"><h1>پیامک‌ها</h1><span class="muted small">هر ۵ ثانیه تازه می‌شود</span></div>'
            f'<p class="lead">پیامک‌هایی که سرور اصلی برای بیماران فرستاده است. پیامک واقعی فرستاده نمی‌شود.</p>'
            f'<div class="chips filters"><a class="chip {"on" if not who else ""}" href="/sms">همه</a>{filters}</div>'
            f'<ol class="inbox">{"".join(cards) or "<li class=empty>هنوز پیامکی نیامده است.</li>"}</ol>')
    return page('پیامک‌ها', 'sms', body, refresh=5)


# ---------------------------------------------------------------- e-prescription service

@app.get('/erx/api/prescriptions/{erx_id}')
def erx_lookup(erx_id: str):
    item = next((p for p in load_erx() if p['id'] == erx_id), None)
    if not item:
        return JSONResponse({'code': 'NOT_FOUND', 'message': 'no prescription with this code'}, status_code=404)
    return {k: v for k, v in item.items() if k != 'caseId'}


@app.get('/erx', response_class=HTMLResponse)
def erx_page():
    rows = ''.join(
        f'<tr><td><bdi dir="ltr" class="code-inline">{esc(p["id"])}</bdi></td><td>{esc(p["patient"]["name"])}</td><td><bdi dir="ltr">{fa(p["patient"]["nationalId"])}</bdi></td>'
        f'<td>{esc("، ".join(s["title"] for s in p["services"]))}</td><td>{esc(p["doctor"]["name"])}</td><td>{esc(p.get("caseId", ""))}</td></tr>'
        for p in load_erx()
    )
    body = ('<div class="page-head"><h1>نسخه الکترونیک</h1></div>'
            '<p class="lead">نسخه‌هایی که این سامانه نمونه می‌شناسد. بیمار شناسه را در پنل می‌نویسد و سرور اصلی هنگام بررسی، نسخه را با همین شناسه می‌گیرد.</p>'
            f'<div class="table-wrap"><table><thead><tr><th>شناسه</th><th>نام بیمار</th><th>کد ملی</th><th>خدمت</th><th>پزشک</th><th>مورد</th></tr></thead><tbody>{rows}</tbody></table></div>')
    return page('نسخه الکترونیک', 'erx', body)


@app.get('/health')
def health():
    return {'ok': True, 'cases': len(load_cases()), 'datasets': str(DATASETS)}
