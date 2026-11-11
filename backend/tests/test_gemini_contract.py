"""Checks the Gemini checker against a local stand-in that speaks the Gemini REST API.

It proves the request is well formed (picture, prescription, report, JSON schema, API key header) and that the
answer is read correctly, without calling Google. Run:  python tests/test_gemini_contract.py
"""
from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.update(CHECKER='gemini', GEMINI_API_KEY='test-key', GEMINI_MODEL='gemini-test', GEMINI_BASE_URL='http://127.0.0.1:8765/v1beta')

from app import dicomio  # noqa: E402
from app.checker import CheckerUnavailable, CheckInput, Document, get_checker  # noqa: E402

DATASETS = ROOT.parent / 'datasets'
seen: dict = {}
mode: dict = {}


class FakeGemini(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        seen.update(path=self.path, key=self.headers.get('x-goog-api-key'), body=body)
        refusal = None
        if mode.get('header401') and self.headers.get('x-goog-api-key'):
            refusal = (401, b'{"error": {"status": "UNAUTHENTICATED", "message": "ACCESS_TOKEN_TYPE_UNSUPPORTED"}}')
        if mode.get('location'):
            refusal = (400, b'{"error": {"status": "FAILED_PRECONDITION", "message": "User location is not supported for the API use."}}')
        if refusal:
            self.send_response(refusal[0])
            self.end_headers()
            self.wfile.write(refusal[1])
            return
        if 'TRIGGER_QUOTA_ERROR' in json.dumps(body):
            self.send_response(429)
            self.end_headers()
            self.wfile.write(b'{"error": {"message": "quota"}}')
            return
        text = json.dumps(body, ensure_ascii=False)
        conflict = 'سونوگرافی' in text
        answer = {
            'summary': 'نسخه برای سونوگرافی است.' if conflict else 'همه‌چیز هم‌خوان است.',
            'findings': [
                {'check': 'PRESCRIPTION_STUDY', 'passed': not conflict, 'detail': 'نوع تصویربرداری بررسی شد.'},
                {'check': 'PRESCRIPTION_NAME', 'passed': True, 'detail': 'نام یکی است.'},
                {'check': 'REPORT_IMAGES', 'passed': True, 'detail': 'گزارش درباره ماموگرافی است.'},
                {'check': 'IMAGE_PATIENT', 'passed': True, 'detail': 'تصویر ماموگرافی است.'},
            ],
        }
        out = json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(answer, ensure_ascii=False)}]}}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(out)


def main() -> int:
    server = HTTPServer(('127.0.0.1', 8765), FakeGemini)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    cases = {c['id']: c for c in json.loads((DATASETS / 'cases.json').read_text(encoding='utf-8'))['cases']}
    fails = 0

    def ok(name, cond, extra=''):
        nonlocal fails
        fails += 0 if cond else 1
        print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f'  {extra}'))

    def item(cid: str, rx_service: str | None = None) -> CheckInput:
        c = cases[cid]
        png, _, _ = dicomio.to_png(DATASETS / c['image'])
        rx_data = dict(c['prescription'] or {}, **({'service': rx_service} if rx_service else {}))
        return CheckInput(
            patient={'name': c['patient']['name'], 'nationalId': c['patient']['nationalId'], 'birthDate': c['patient']['birthDate']},
            study={**c['study'], 'dicom': dicomio.read_info(DATASETS / c['image']).as_dict()}, image_png=png,
            prescription=Document('pacs', data=rx_data, content=(DATASETS / c['prescriptionImage']).read_bytes(), mime='image/png'),
            report=Document('text', data=c['report']))

    checker = get_checker()
    ok('CHECKER=gemini picks the Gemini checker', type(checker).__name__ == 'GeminiChecker', type(checker))
    result = checker.check(item('MG-001'))
    ok('calls generateContent on the configured model', seen['path'] == '/v1beta/models/gemini-test:generateContent', seen.get('path'))
    ok('sends the API key in the header, not the URL', seen['key'] == 'test-key' and 'key=' not in seen['path'])
    parts = seen['body']['contents'][0]['parts']
    pics = [p['inlineData']['mimeType'] for p in parts if 'inlineData' in p]
    ok('sends the DICOM picture and the prescription picture', pics == ['image/png', 'image/png'], pics)
    ok('asks for JSON with a schema', seen['body']['generationConfig']['responseMimeType'] == 'application/json' and 'responseSchema' in seen['body']['generationConfig'])
    ok('matching case passes', result.conflict_kind is None and result.opinion('t')['result'] == 'OK', result)
    ok('a check missing from the answer is filled in as passed', len(result.findings) == 4)
    result = checker.check(item('MG-006', rx_service='سونوگرافی شکم و لگن'))
    ok('wrong service comes back as PRESCRIPTION_STUDY', result.conflict_kind == 'PRESCRIPTION_STUDY', result)
    ok('the summary is the model\'s Persian sentence', result.opinion('t')['summary'] == 'نسخه برای سونوگرافی است.')
    try:
        checker.check(item('MG-001', rx_service='TRIGGER_QUOTA_ERROR'))
        ok('quota error is reported as unavailable', False)
    except CheckerUnavailable as err:
        ok('quota error is reported as unavailable, so the case is retried', '429' in str(err), err)
    mode['header401'] = True
    result = checker.check(item('MG-001'))
    ok('a key refused in the header is retried as ?key= and works', 'key=test-key' in seen['path'] and result.conflict_kind is None, seen['path'])
    mode.clear()
    mode['location'] = True
    try:
        checker.check(item('MG-001'))
        ok('country refusal reported', False)
    except CheckerUnavailable as err:
        ok('a country refusal says to use the VPN proxy', 'AI_PROXY' in str(err), err)
    mode.clear()
    import contextlib, io
    from app.checker import ping
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = ping.main()
    ok('connection test reports it works', code == 0 and 'It works' in out.getvalue(), out.getvalue())
    mode['location'] = True
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = ping.main()
    ok('connection test explains a failure', code == 1 and 'AI_PROXY' in out.getvalue(), out.getvalue())
    mode.clear()
    server.shutdown()
    print('all passed' if not fails else f'FAILED {fails}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
