"""Calls to outside systems: the SMS gateway and the national e-prescription service.

In Docker both point at the sandbox, which stands in for them. To use real services, change
SMS_GATEWAY_URL and ERX_SERVICE_URL and adapt the request and response shapes here.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from . import db
from .config import settings

log = logging.getLogger('gateways')


def _post_json(url: str, body: dict, timeout: float = 4) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read() or b'{}')


def send_sms(mobile: str, text: str, kind: str, case_id: str | None = None) -> None:
    """Keeps a copy in the database (the admin's SMS history) and hands the text to the gateway.

    A gateway that is down does not stop the patient's flow: the message is marked FAILED and logged.
    One-time codes are not stored, so they never appear in any history.
    """
    delivery = 'SENT'
    try:
        _post_json(settings.sms_gateway_url, {'to': mobile, 'text': text, 'kind': kind})
    except Exception as err:  # noqa: BLE001 - any failure of the gateway
        delivery = 'FAILED'
        log.warning('SMS to %s failed: %s', mobile, err)
    stored = 'کد ورود فرستاده شد.' if kind == 'OTP' else text
    db.insert('sms', {'id': db.new_id('sms'), 'case_id': case_id, 'mobile': mobile, 'kind': kind, 'text': stored, 'sent_at': db.now_iso(), 'delivery': delivery})


class ServiceUnavailable(Exception):
    pass


def fetch_eprescription(erx_id: str) -> dict | None:
    """The prescription as the e-prescription service returns it, or None when no prescription has this code."""
    url = f'{settings.erx_service_url}/{urllib.request.quote(erx_id)}'
    try:
        with urllib.request.urlopen(url, timeout=6) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise ServiceUnavailable(f'e-prescription service answered {err.code}') from err
    except Exception as err:  # noqa: BLE001
        raise ServiceUnavailable(str(err)) from err
