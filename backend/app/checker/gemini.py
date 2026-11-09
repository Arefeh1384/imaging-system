"""The real checker: Gemini looks at the image, the prescription and the report, and says whether they match.

Turned on with CHECKER=gemini and GEMINI_API_KEY. The call is plain HTTPS to the Gemini REST API, so no SDK is needed.
GEMINI_BASE_URL can point at a gateway that offers the same API. Python honours HTTPS_PROXY, so a proxy works too.
This is a consistency check for insurance, not a medical reading.
"""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request

from ..config import settings
from .base import CHECKS, CheckerUnavailable, CheckInput, CheckResult

PROMPT = """You check imaging insurance claims for consistency. You do not diagnose.
You receive: the patient's record, the study details sent by the hospital's PACS, one picture made from the DICOM study,
the prescription (a picture, a PDF, or an electronic prescription as JSON) and the radiologist's report (text or a picture).

Run these four checks and report each one:
1. PRESCRIPTION_STUDY: does the service requested in the prescription match the imaging that was done, as shown by the
   picture and the study details (type of imaging and body part; the side too, if the prescription names one)?
2. PRESCRIPTION_NAME: is the prescription for this patient (name, and national ID if it shows one)? Accept spelling
   variants of the same Persian name, such as different forms of ی and ک or a missing half-space.
3. REPORT_IMAGES: does the radiologist's report describe this imaging (same type and body part)?
4. IMAGE_PATIENT: does the picture look like the imaging the study details describe, and do the DICOM details belong to this patient?

If a document is missing or unreadable, pass that check and say so in the detail. Only fail a check on clear evidence.
Write every "detail" and the "summary" in Persian, in one short plain sentence each, for an insurance clerk.
"""

SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'summary': {'type': 'STRING'},
        'findings': {
            'type': 'ARRAY',
            'items': {
                'type': 'OBJECT',
                'properties': {
                    'check': {'type': 'STRING', 'enum': list(CHECKS)},
                    'passed': {'type': 'BOOLEAN'},
                    'detail': {'type': 'STRING'},
                },
                'required': ['check', 'passed', 'detail'],
            },
        },
    },
    'required': ['summary', 'findings'],
}


def _inline(content: bytes, mime: str) -> dict:
    return {'inlineData': {'mimeType': mime, 'data': base64.b64encode(content).decode()}}


def build_request(item: CheckInput) -> dict:
    record = {
        'patient': item.patient,
        'study': {k: v for k, v in item.study.items() if k != 'dicom'},
        'dicomDetails': item.study.get('dicom'),
    }
    parts: list[dict] = [{'text': PROMPT}, {'text': 'Patient and study details:\n' + json.dumps(record, ensure_ascii=False, indent=1)},
                         {'text': 'Picture made from the DICOM study:'}, _inline(item.image_png, 'image/png')]
    rx = item.prescription
    if rx is None:
        parts.append({'text': 'Prescription: none was provided.'})
    else:
        if rx.data:
            label = 'Electronic prescription, as returned by the e-prescription service' if rx.kind == 'erx' else 'Prescription details the hospital sent'
            parts.append({'text': f'{label}:\n' + json.dumps(rx.data, ensure_ascii=False, indent=1)})
        if rx.content and rx.mime:
            parts += [{'text': 'Prescription document:'}, _inline(rx.content, rx.mime)]
    rep = item.report
    if rep is None:
        parts.append({'text': 'Radiologist report: none was provided.'})
    else:
        if rep.data:
            parts.append({'text': 'Radiologist report:\n' + json.dumps(rep.data, ensure_ascii=False, indent=1)})
        if rep.content and rep.mime:
            parts += [{'text': 'Radiologist report document:'}, _inline(rep.content, rep.mime)]
    return {
        'contents': [{'role': 'user', 'parts': parts}],
        'generationConfig': {'temperature': 0, 'responseMimeType': 'application/json', 'responseSchema': SCHEMA},
    }


def parse_response(body: dict) -> CheckResult:
    try:
        text = body['candidates'][0]['content']['parts'][0]['text']
        data = json.loads(text)
    except (KeyError, IndexError, ValueError) as err:
        raise CheckerUnavailable(f'Gemini answered in an unexpected shape: {str(body)[:300]}') from err
    by_check = {f['check']: f for f in data.get('findings', []) if f.get('check') in CHECKS}
    findings = [by_check.get(k, {'check': k, 'passed': True, 'detail': 'این مورد در پاسخ هوش مصنوعی نبود.'}) for k in CHECKS]
    return CheckResult(findings=[{'check': f['check'], 'passed': bool(f['passed']), 'detail': str(f.get('detail', ''))} for f in findings],
                       summary=str(data.get('summary', '')), model_version=f'Gemini ({settings.gemini_model})')


def call_gemini(body: dict, timeout: float = 90) -> dict:
    """Posts to generateContent and returns the JSON answer.

    The key goes in the x-goog-api-key header. Some newer keys (the AQ. kind) have been refused that way on some
    accounts, so a 401 or 403 is tried once more with the key as a ?key= parameter, which Google also accepts.
    """
    url = f'{settings.gemini_base_url}/models/{settings.gemini_model}:generateContent'
    data = json.dumps(body).encode()
    attempts = [
        (url, {'Content-Type': 'application/json', 'x-goog-api-key': settings.gemini_api_key}),
        (f'{url}?key={urllib.parse.quote(settings.gemini_api_key)}', {'Content-Type': 'application/json'}),
    ]
    for n, (target, headers) in enumerate(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(target, data=data, method='POST', headers=headers), timeout=timeout) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as err:
            detail = err.read()[:500].decode('utf-8', 'replace')
            if err.code in (401, 403) and n == 0:
                continue
            raise CheckerUnavailable(f'Gemini answered {err.code}: {explain(err.code, detail)}') from err
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            raise CheckerUnavailable(f'Gemini could not be reached: {err}. From inside Docker this usually needs AI_PROXY (your VPN).') from err
    raise CheckerUnavailable('Gemini refused the key.')


def explain(code: int, detail: str) -> str:
    """Google's error, plus what it usually means here."""
    hint = ''
    if 'location is not supported' in detail.lower() or 'FAILED_PRECONDITION' in detail:
        hint = 'Google sees a country it does not serve: route Gemini through your VPN with AI_PROXY.'
    elif code in (401, 403):
        hint = 'The key was refused: check GEMINI_API_KEY, or make a new key in Google AI Studio.'
    elif code == 404:
        hint = f'The model {settings.gemini_model} was not found: set GEMINI_MODEL to a model listed in Google AI Studio.'
    elif code == 429:
        hint = 'Quota or rate limit reached: wait, or check the plan of this key.'
    return f'{hint} ({detail[:300]})' if hint else detail[:300]


class GeminiChecker:
    def __init__(self) -> None:
        if not settings.gemini_api_key:
            raise RuntimeError('CHECKER=gemini needs GEMINI_API_KEY')

    @property
    def model_version(self) -> str:
        return f'Gemini ({settings.gemini_model})'

    def check(self, item: CheckInput) -> CheckResult:
        return parse_response(call_gemini(build_request(item)))
