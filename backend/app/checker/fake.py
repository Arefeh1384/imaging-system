"""A checker without AI, for building and testing. It compares the written details only.

It reads the e-prescription, the prescription details the hospital sent with the ZIP, the report text and the
DICOM details. It cannot read photos: a photographed prescription or report passes, with a note saying so.
Set CHECKER=gemini to have Gemini look at the pictures themselves.
"""
from __future__ import annotations

from ..text import normalize_name
from .base import CheckInput, CheckResult

KINDS = [
    ('ماموگرافی', 'MG'), ('ماموگرافي', 'MG'), ('سونوگرافی', 'US'), ('سونو', 'US'), ('سی‌تی', 'CT'), ('سی تی', 'CT'),
    ('ام‌آر', 'MR'), ('ام آر', 'MR'), ('mri', 'MR'), ('رادیوگرافی', 'DX'), ('گرافی', 'DX'), ('mammo', 'MG'),
]
SIDE_WORDS = {'راست': 'R', 'چپ': 'L'}
NOT_READ = 'در حالت آزمایشی، عکس خوانده نمی‌شود. با Gemini، خود عکس بررسی می‌شود.'


def _plain(text: str) -> str:
    return (text or '').lower().replace('\u200c', ' ').replace('ي', 'ی')


def kind_of(text: str) -> str | None:
    low = _plain(text)
    return next((code for word, code in KINDS if _plain(word) in low), None)


def side_of(text: str) -> str | None:
    return next((code for word, code in SIDE_WORDS.items() if word in (text or '')), None)


def _prescription_fields(doc) -> tuple[str, str, str] | None:
    """(service, patient name, national ID) from the e-prescription or from the hospital's prescription details."""
    if not doc or not doc.data:
        return None
    if doc.kind == 'erx':
        services = '، '.join(s.get('title', '') for s in doc.data.get('services', []))
        p = doc.data.get('patient', {})
        return services, p.get('name', ''), p.get('nationalId', '')
    d = doc.data
    return d.get('service', ''), d.get('patient_name', ''), d.get('national_id', '')


class FakeChecker:
    model_version = 'بررسی آزمایشی بدون هوش مصنوعی'

    def check(self, item: CheckInput) -> CheckResult:
        dicom = item.study.get('dicom') or {}
        modality = (dicom.get('modality') or item.study.get('modality') or '').upper()
        laterality = (dicom.get('laterality') or item.study.get('laterality') or '').upper()
        findings = []

        fields = _prescription_fields(item.prescription)
        if fields is None:
            findings.append({'check': 'PRESCRIPTION_STUDY', 'passed': True, 'detail': NOT_READ})
            findings.append({'check': 'PRESCRIPTION_NAME', 'passed': True, 'detail': NOT_READ})
        else:
            service, name, national_id = fields
            asked = kind_of(service)
            side = side_of(service)
            ok = asked == modality and (side is None or not laterality or side == laterality)
            detail = f'در نسخه «{service}» نوشته شده و تصویر از نوع {modality or "نامعلوم"}' + (f'، سمت {laterality}' if laterality else '') + ' است.'
            findings.append({'check': 'PRESCRIPTION_STUDY', 'passed': ok, 'detail': detail})
            same_name = normalize_name(name) == normalize_name(item.patient['name'])
            same_id = not national_id or national_id == item.patient['nationalId']
            findings.append({'check': 'PRESCRIPTION_NAME', 'passed': same_name and same_id,
                             'detail': f'نام روی نسخه «{name}» و نام بیمار «{item.patient["name"]}» است.' + ('' if same_id else ' کد ملی هم یکی نیست.')})

        rep = item.report
        if rep and rep.data and rep.data.get('study'):
            rk = kind_of(rep.data['study']) or kind_of(rep.data.get('text', ''))
            findings.append({'check': 'REPORT_IMAGES', 'passed': rk == modality, 'detail': f'گزارش درباره «{rep.data["study"]}» است.'})
        else:
            findings.append({'check': 'REPORT_IMAGES', 'passed': True, 'detail': NOT_READ})

        dicom_id = (dicom.get('patient_id') or '').strip()
        same_patient = not dicom_id or dicom_id == item.patient['nationalId']
        findings.append({'check': 'IMAGE_PATIENT', 'passed': same_patient,
                         'detail': 'شناسه بیمار در فایل DICOM با کد ملی بیمار یکی است.' if same_patient else f'شناسه بیمار در فایل DICOM «{dicom_id}» است.'})
        return CheckResult(findings=findings, model_version=self.model_version)
