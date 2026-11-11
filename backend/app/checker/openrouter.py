"""The AI checker through OpenRouter: a vision model (Gemini by default) looks at the DICOM picture, the
prescription and the report, and says whether they match.

Turned on with CHECKER=openrouter and OPENROUTER_API_KEY. OPENROUTER_MODEL picks the model, for example
google/gemini-2.5-flash. The call is plain HTTPS to OpenRouter's chat completions API, so no SDK is needed.
Python honours HTTPS_PROXY (AI_PROXY in .env), so a VPN proxy works too.
This is a consistency check for insurance, not a medical reading.
"""
from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.request

from ..config import settings
from .base import CHECKS, PROBLEMS, CheckerUnavailable, CheckInput, CheckResult, findings_from
from .gemini import PROMPT

# The same answer the Gemini checker asks for, written as standard JSON Schema.
SCHEMA = {
    'type': 'object',
    'properties': {
        'summary': {'type': 'string'},
        'findings': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'check': {'type': 'string', 'enum': list(CHECKS)},
                    'passed': {'type': 'boolean'},
                    'problem': {'type': 'string', 'enum': PROBLEMS},
                    'detail': {'type': 'string'},
                },
                'required': ['check', 'passed', 'problem', 'detail'],
                'additionalProperties': False,
            },
        },
    },
    'required': ['summary', 'findings'],
    'additionalProperties': False,
}
JSON_ONLY = ('Answer with JSON only, no other text, in this shape: '
             '{"summary": "...", "findings": [{"check": "PRESCRIPTION_STUDY", "passed": true, "problem": "NONE", "detail": "..."}, ...]} '
             'with one finding for each of PRESCRIPTION_STUDY, PRESCRIPTION_NAME, REPORT_IMAGES, IMAGE_PATIENT.')


def model_list() -> list[str]:
    """OPENROUTER_MODEL may name several models separated by commas: the first is tried first, and OpenRouter
    moves to the next when one is busy (rate-limited), down or refuses."""
    return [m.strip() for m in settings.openrouter_model.split(',') if m.strip()]


def model_fields() -> dict:
    models = model_list()[:3]  # OpenRouter accepts at most 3 models in one request
    return {'models': models} if len(models) > 1 else {'model': models[0] if models else ''}


def _data_url(content: bytes, mime: str) -> str:
    return f'data:{mime};base64,' + base64.b64encode(content).decode()


def _attach(content: bytes, mime: str, name: str) -> dict:
    if mime == 'application/pdf':
        return {'type': 'file', 'file': {'filename': f'{name}.pdf', 'file_data': _data_url(content, mime)}}
    return {'type': 'image_url', 'image_url': {'url': _data_url(content, mime)}}


def build_messages(item: CheckInput) -> list[dict]:
    record = {
        'patient': item.patient,
        'study': {k: v for k, v in item.study.items() if k != 'dicom'},
        'dicomDetails': item.study.get('dicom'),
    }
    parts: list[dict] = [
        {'type': 'text', 'text': 'Patient and study details:\n' + json.dumps(record, ensure_ascii=False, indent=1)},
        {'type': 'text', 'text': 'Picture made from the DICOM study:'},
        _attach(item.image_png, 'image/png', 'study'),
    ]
    rx = item.prescription
    if rx is None:
        parts.append({'type': 'text', 'text': 'Prescription: none was provided.'})
    else:
        if rx.data:
            label = 'Electronic prescription, as returned by the e-prescription service' if rx.kind == 'erx' else 'Prescription details the hospital sent'
            parts.append({'type': 'text', 'text': f'{label}:\n' + json.dumps(rx.data, ensure_ascii=False, indent=1)})
        if rx.content and rx.mime:
            parts += [{'type': 'text', 'text': 'Prescription document:'}, _attach(rx.content, rx.mime, 'prescription')]
    rep = item.report
    if rep is None:
        parts.append({'type': 'text', 'text': 'Radiologist report: none was provided.'})
    else:
        if rep.data:
            parts.append({'type': 'text', 'text': 'Radiologist report:\n' + json.dumps(rep.data, ensure_ascii=False, indent=1)})
        if rep.content and rep.mime:
            parts += [{'type': 'text', 'text': 'Radiologist report document:'}, _attach(rep.content, rep.mime, 'report')]
    return [{'role': 'system', 'content': PROMPT}, {'role': 'user', 'content': parts}]


def build_request(item: CheckInput, structured: bool = True) -> dict:
    messages = build_messages(item)
    body: dict = {**model_fields(), 'messages': messages, 'temperature': 0, 'max_tokens': settings.openrouter_max_tokens}
    if structured:
        body['response_format'] = {'type': 'json_schema', 'json_schema': {'name': 'claim_check', 'strict': True, 'schema': SCHEMA}}
        # Only send the request to providers of this model that can keep to the schema.
        body['provider'] = {'require_parameters': True}
    else:
        messages[0] = {'role': 'system', 'content': PROMPT + '\n' + JSON_ONLY}
    return body


def explain(code: int, detail: str) -> str:
    """OpenRouter's error, plus what it usually means here."""
    low = detail.lower()
    if code == 401:
        hint = 'The key was refused: check OPENROUTER_API_KEY, or make a new key at openrouter.ai/keys.'
    elif code == 402:
        hint = ('Not enough credit on this OpenRouter account for this model: add credit at openrouter.ai/settings/credits, '
                'or set OPENROUTER_MODEL to a free model such as google/gemma-4-31b-it:free.')
    elif code == 403 and ('region' in low or 'country' in low or 'location' in low):
        hint = 'The provider refused your country: route the call through your VPN with AI_PROXY.'
    elif code == 403:
        hint = 'OpenRouter or the model provider refused the request.'
    elif code == 404:
        hint = f'The model {settings.openrouter_model} was not found, or no provider of it serves this request: check OPENROUTER_MODEL.'
    elif code == 429:
        hint = ('Rate limit reached: it is tried again later. Free models are often busy; list several in OPENROUTER_MODEL, '
                'separated by commas, so the next one is used when one is busy.')
    elif code in (502, 503):
        hint = 'The model provider is down or busy: it is tried again later.'
    else:
        hint = ''
    return f'{hint} ({detail[:300]})' if hint else detail[:300]


def post(body: dict, timeout: float = 120) -> dict:
    req = urllib.request.Request(
        f'{settings.openrouter_base_url}/chat/completions', data=json.dumps(body).encode(), method='POST',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {settings.openrouter_api_key}',
            # Optional: names this app on OpenRouter's dashboard.
            'HTTP-Referer': settings.portal_url,
            'X-Title': 'Imaging insurance check',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            answer = json.loads(res.read())
    except urllib.error.HTTPError as err:
        detail = err.read()[:600].decode('utf-8', 'replace')
        raise OpenRouterError(err.code, detail) from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise CheckerUnavailable(f'OpenRouter could not be reached: {err}. From inside Docker this may need AI_PROXY (your VPN).') from err
    if 'error' in answer and not answer.get('choices'):  # OpenRouter sometimes reports errors inside a 200 answer
        e = answer['error']
        raise OpenRouterError(int(e.get('code') or 500) if str(e.get('code', '')).isdigit() else 500, json.dumps(e, ensure_ascii=False))
    return answer


class OpenRouterError(CheckerUnavailable):
    def __init__(self, code: int, detail: str):
        super().__init__(f'OpenRouter answered {code}: {explain(code, detail)}')
        self.code, self.detail = code, detail


def _json_from(text: str) -> dict:
    """The JSON in the model's reply, also when it is wrapped in a ```json block or has words around it."""
    text = text.strip()
    fenced = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.S)
    if fenced:
        text = fenced.group(1)
    elif not text.startswith('{'):
        start, end = text.find('{'), text.rfind('}')
        text = text[start:end + 1] if start >= 0 and end > start else text
    return json.loads(text)


def parse_response(body: dict) -> CheckResult:
    try:
        choice = body['choices'][0]
        if choice.get('finish_reason') == 'length':
            raise CheckerUnavailable(f'The answer was cut off at {settings.openrouter_max_tokens} tokens: raise OPENROUTER_MAX_TOKENS.')
        content = choice['message'].get('content')
        if isinstance(content, list):  # some providers return parts
            content = ''.join(p.get('text', '') for p in content if isinstance(p, dict))
        if not (content or '').strip():
            raise CheckerUnavailable(f"{body.get('model') or settings.openrouter_model} gave an empty answer (finish reason: {choice.get('finish_reason')}). "
                                     'It is tried again later; a specific model in OPENROUTER_MODEL avoids this.')
        data = _json_from(content)
    except (KeyError, IndexError, TypeError, ValueError) as err:
        raise CheckerUnavailable(f'The model answered in an unexpected shape: {str(body)[:300]}') from err
    findings = findings_from(data)
    model = body.get('model') or settings.openrouter_model
    return CheckResult(findings=findings,
                       summary=str(data.get('summary', '')), model_version=f'OpenRouter ({model})', by_ai=True, raw_answer=content.strip())


class OpenRouterChecker:
    def __init__(self) -> None:
        if not settings.openrouter_api_key:
            raise RuntimeError('CHECKER=openrouter needs OPENROUTER_API_KEY')

    @property
    def model_version(self) -> str:
        return f'OpenRouter ({settings.openrouter_model})'

    def check(self, item: CheckInput) -> CheckResult:
        try:
            return parse_response(post(build_request(item, structured=True)))
        except OpenRouterError as err:
            # No provider of this model supports a fixed answer shape: ask for JSON in words instead.
            if err.code in (400, 404) and ('response_format' in err.detail or 'structured' in err.detail.lower() or 'No endpoints found' in err.detail):
                return parse_response(post(build_request(item, structured=False)))
            raise
