"""Checks the OpenRouter checker against a local stand-in that speaks OpenRouter's chat completions API.

It proves the request is well formed (DICOM picture and prescription as images, schema, key) and that answers are
read correctly, including the fallback for models without structured output. It doesn't call OpenRouter.
Run:  python tests/test_openrouter_contract.py
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.update(CHECKER='openrouter', OPENROUTER_API_KEY='sk-or-test', OPENROUTER_MODEL='google/gemini-test',
                  OPENROUTER_BASE_URL='http://127.0.0.1:8766/api/v1')

from app import dicomio  # noqa: E402
from app.checker import CheckerUnavailable, CheckInput, Document, get_checker  # noqa: E402
from app.checker import ping  # noqa: E402

DATASETS = ROOT.parent / 'datasets'
seen: dict = {}
mode: dict = {}


def answer_for(body: dict) -> dict:
    text = json.dumps(body, ensure_ascii=False)
    conflict = 'سونوگرافی' in text
    return {
        'summary': 'نسخه برای سونوگرافی است.' if conflict else 'همه‌چیز هم‌خوان است.',
        'findings': [
            {'check': 'PRESCRIPTION_STUDY', 'passed': not conflict, 'detail': 'نوع تصویربرداری بررسی شد.'},
            {'check': 'PRESCRIPTION_NAME', 'passed': True, 'detail': 'نام یکی است.'},
            {'check': 'REPORT_IMAGES', 'passed': True, 'detail': 'گزارش درباره ماموگرافی است.'},
            {'check': 'IMAGE_PATIENT', 'passed': True, 'detail': 'تصویر ماموگرافی است.'},
        ],
    }


class FakeOpenRouter(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code: int, payload: dict) -> None:
        out = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(out)

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        seen.setdefault('bodies', []).append(body)
        seen.update(path=self.path, auth=self.headers.get('Authorization'), body=body)
        if mode.get('status'):
            return self.reply(mode['status'], {'error': {'code': mode['status'], 'message': mode.get('message', 'refused')}})
        if mode.get('nostructured') and 'response_format' in body:
            return self.reply(404, {'error': {'code': 404, 'message': 'No endpoints found that support the requested parameters'}})
        if mode.get('empty'):
            return self.reply(200, {'model': 'some/thinking-model:free', 'choices': [{'finish_reason': 'length', 'message': {'role': 'assistant', 'content': None, 'reasoning': 'Let me think...'}}]})
        if body['messages'][-1]['content'] == 'Reply with the single word: OK':
            content = 'OK'
        elif 'response_format' in body:
            content = json.dumps(answer_for(body), ensure_ascii=False)
        else:  # without a schema, models often wrap JSON in a code block
            content = 'Here is the result:\n```json\n' + json.dumps(answer_for(body), ensure_ascii=False) + '\n```'
        self.reply(200, {'model': body.get('model') or body['models'][0], 'choices': [{'message': {'role': 'assistant', 'content': content}}]})


def main() -> int:
    server = HTTPServer(('127.0.0.1', 8766), FakeOpenRouter)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    cases = {c['id']: c for c in json.loads((DATASETS / 'cases.json').read_text(encoding='utf-8'))['cases']}
    fails = 0

    def ok(name, cond, extra=''):
        nonlocal fails
        fails += 0 if cond else 1
        print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f'  {str(extra)[:300]}'))

    def item(cid: str, rx_service: str | None = None, pdf: bool = False) -> CheckInput:
        c = cases[cid]
        png, _, _ = dicomio.to_png(DATASETS / c['image'])
        rx_data = dict(c['prescription'] or {}, **({'service': rx_service} if rx_service else {}))
        rx = Document('pacs', data=rx_data, content=b'%PDF-1.4 sample' if pdf else (DATASETS / c['prescriptionImage']).read_bytes(),
                      mime='application/pdf' if pdf else 'image/png')
        return CheckInput(
            patient={'name': c['patient']['name'], 'nationalId': c['patient']['nationalId'], 'birthDate': c['patient']['birthDate']},
            study={**c['study'], 'dicom': dicomio.read_info(DATASETS / c['image']).as_dict()}, image_png=png,
            prescription=rx, report=Document('text', data=c['report']))

    checker = get_checker()
    ok('CHECKER=openrouter picks the OpenRouter checker', type(checker).__name__ == 'OpenRouterChecker', type(checker))
    result = checker.check(item('MG-001'))
    body = seen['body']
    ok('posts to /api/v1/chat/completions', seen['path'] == '/api/v1/chat/completions', seen['path'])
    ok('sends the key as a Bearer token', seen['auth'] == 'Bearer sk-or-test')
    ok('uses the configured model', body['model'] == 'google/gemini-test')
    ok('sets an answer limit, so credit is not reserved for the model maximum', body.get('max_tokens') == 3000, body.get('max_tokens'))
    images = [p['image_url']['url'][:22] for p in body['messages'][1]['content'] if p.get('type') == 'image_url']
    ok('sends the DICOM picture and the prescription as PNG images', images == ['data:image/png;base64,'] * 2, images)
    ok('instructions go in the system message', body['messages'][0]['role'] == 'system' and 'PRESCRIPTION_STUDY' in body['messages'][0]['content'])
    rf = body.get('response_format', {})
    ok('asks for a strict JSON schema', rf.get('type') == 'json_schema' and rf['json_schema']['strict'] is True)
    ok('routes only to providers that keep to the schema', body.get('provider') == {'require_parameters': True})
    ok('matching case passes', result.conflict_kind is None and result.opinion('t')['result'] == 'OK', result)
    ok('the model name is recorded', result.model_version == 'OpenRouter (google/gemini-test)', result.model_version)

    result = checker.check(item('MG-006', rx_service='سونوگرافی شکم و لگن'))
    ok('wrong service comes back as PRESCRIPTION_STUDY', result.conflict_kind == 'PRESCRIPTION_STUDY', result.findings)
    op = result.opinion('t')
    ok("the summary is the model's Persian sentence, word for word", op['summary'] == 'نسخه برای سونوگرافی است.')
    ok("each check carries the model's own explanation", op['findings'][0]['detail'] == 'نوع تصویربرداری بررسی شد.' and op['findings'][0]['result'] == 'CONFLICT')
    ok("the model's full answer is kept", '"summary"' in op.get('rawAnswer', '') and op.get('byAi') is True)

    checker.check(item('MG-001', pdf=True))
    files = [p for p in seen['body']['messages'][1]['content'] if p.get('type') == 'file']
    ok('a PDF prescription is sent as a file', len(files) == 1 and files[0]['file']['file_data'].startswith('data:application/pdf;base64,'), files)

    seen['bodies'] = []
    mode['nostructured'] = True
    result = checker.check(item('MG-001'))
    ok('model without structured output: asked again for JSON in words',
       len(seen['bodies']) == 2 and 'response_format' not in seen['bodies'][1] and 'JSON only' in seen['bodies'][1]['messages'][0]['content'])
    ok('JSON inside a ```json block is read', result.conflict_kind is None and len(result.findings) == 4, result.findings)
    mode.clear()

    for status, words in ((401, 'OPENROUTER_API_KEY'), (402, ':free'), (429, 'Rate limit')):
        mode['status'] = status
        try:
            checker.check(item('MG-001'))
            ok(f'{status} reported', False)
        except CheckerUnavailable as err:
            ok(f'{status} is reported as unavailable with a plain reason, so the case is retried', words in str(err), err)
    mode.clear()

    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = ping.main()
    ok('connection test asks for a short answer', seen['body'].get('max_tokens') == 400, seen['body'].get('max_tokens'))
    ok('connection test reports it works', code == 0 and 'It works' in out.getvalue(), out.getvalue())
    from app.config import settings as live
    object.__setattr__(live, 'openrouter_model', 'nvidia/a:free, google/b:free')
    checker.check(item('MG-001'))
    ok('several models are sent as a fallback list', seen['body'].get('models') == ['nvidia/a:free', 'google/b:free'] and 'model' not in seen['body'], seen['body'].get('models'))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        ping.main()
    ok('connection test uses the list too', seen['body'].get('models') == ['nvidia/a:free', 'google/b:free'])
    object.__setattr__(live, 'openrouter_model', 'google/gemini-test')
    mode['empty'] = True
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = ping.main()
    ok('connection test does not call an empty answer a success', code == 1 and 'gave no answer' in out.getvalue(), out.getvalue())
    try:
        checker.check(item('MG-001'))
        ok('empty answer during a check is reported', False)
    except CheckerUnavailable as err:
        ok('an empty answer during a check is retried with a plain reason', 'empty answer' in str(err) or 'cut off' in str(err), err)
    mode.clear()
    mode['status'] = 401
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = ping.main()
    ok('connection test explains a refused key', code == 1 and 'OPENROUTER_API_KEY' in out.getvalue(), out.getvalue())
    mode.clear()
    server.shutdown()
    # Unreadable or wrong documents fail, even when the model marks them passed.
    from app.checker.base import CheckerUnavailable as _CU
    from app.checker.openrouter import parse_response as _parse
    def wrap(findings):
        return {'model': 'm', 'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'summary': 's', 'findings': findings}, ensure_ascii=False)}}]}
    base = [{'check': k, 'passed': True, 'problem': 'NONE', 'detail': 'ok'} for k in ('PRESCRIPTION_STUDY', 'PRESCRIPTION_NAME', 'REPORT_IMAGES', 'IMAGE_PATIENT')]
    f = [dict(x) for x in base]; f[1].update(passed=True, problem='UNREADABLE', detail='نسخه ناخوانا است.')
    r = _parse(wrap(f))
    ok('"passed" with an unreadable prescription counts as failed', r.conflict_kind == 'PRESCRIPTION_NAME' and r.conflict_reason == 'نسخه‌ای که فرستاده شد خوانا نیست.', (r.conflict_kind, r.conflict_reason))
    f = [dict(x) for x in base]; f[0].update(passed=False, problem='MISMATCH'); f[1].update(passed=False, problem='NOT_THE_DOCUMENT')
    r = _parse(wrap(f))
    ok('a file that is not a prescription is the reason given, before the mismatch it causes', r.conflict_kind == 'PRESCRIPTION_NAME' and 'نسخه پزشکی نیست' in r.conflict_reason, (r.conflict_kind, r.conflict_reason))
    ok('the opinion names the problem for the insurer', r.opinion('t')['findings'][1]['problem'] == 'NOT_THE_DOCUMENT')
    f = [dict(x) for x in base]; f[2].update(passed=False, problem='NONE')
    r = _parse(wrap(f))
    ok('a failed check without a problem is a mismatch', r.conflict_kind == 'REPORT_IMAGES' and r.findings[2]['problem'] == 'MISMATCH' and r.conflict_reason == 'گزارش رادیولوژیست به این تصویربرداری مربوط نیست.', r.findings[2])
    f = [{k: v for k, v in x.items() if k != 'problem'} for x in base]
    ok('an answer without "problem" still works', _parse(wrap(f)).conflict_kind is None)
    try:
        _parse(wrap(base[:3])); ok('a skipped check is retried, not passed', False)
    except _CU as err:
        ok('a skipped check is retried, not passed', 'IMAGE_PATIENT' in str(err), err)
    rf = body['response_format']['json_schema']['schema']['properties']['findings']['items']
    ok('the schema asks for the problem', 'problem' in rf['required'] and rf['properties']['problem']['enum'] == ['NONE', 'MISMATCH', 'UNREADABLE', 'NOT_THE_DOCUMENT'], rf)
    ok('the instructions say never to pass what could not be verified', 'Never pass a check you could not verify' in body['messages'][0]['content'])
    print('all passed' if not fails else f'FAILED {fails}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
