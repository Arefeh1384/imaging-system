"""What a checker receives and returns. The fake checker and the Gemini checker share this shape."""
from __future__ import annotations

from dataclasses import dataclass, field

# The checks every checker runs, and what each one is called on screen.
CHECKS = {
    'PRESCRIPTION_STUDY': ('نسخه با تصویربرداری هم‌خوانی دارد', 'prescription'),
    'PRESCRIPTION_NAME': ('نام روی نسخه درست است', 'prescription'),
    'REPORT_IMAGES': ('گزارش با تصویر هم‌خوانی دارد', 'report'),
    'IMAGE_PATIENT': ('تصویر مال همین بیمار است', 'images'),
}
CONFLICT_REASONS = {
    'PRESCRIPTION_STUDY': 'خدمت نوشته‌شده در نسخه با تصویربرداری انجام‌شده یکسان نیست.',
    'PRESCRIPTION_NAME': 'نام روی نسخه با نام بیمار یکسان نیست.',
    'REPORT_IMAGES': 'گزارش رادیولوژیست به این تصویربرداری مربوط نیست.',
    'IMAGE_PATIENT': 'تصویر پزشکی به نام بیمار دیگری است.',
}


@dataclass
class Document:
    """A prescription or a report. Either structured data, a file (picture or PDF), or both."""
    kind: str  # 'pacs' | 'erx' | 'photo' | 'text' | 'file'
    data: dict | None = None
    content: bytes | None = None
    mime: str | None = None


@dataclass
class CheckInput:
    patient: dict  # name, nationalId, birthDate
    study: dict  # service, title, modality, bodyPart, laterality, view, date, and 'dicom' (what the DICOM file says)
    image_png: bytes
    prescription: Document | None
    report: Document | None


@dataclass
class CheckResult:
    findings: list[dict] = field(default_factory=list)  # {check, passed, detail}
    summary: str = ''
    model_version: str = ''

    @property
    def conflict_kind(self) -> str | None:
        return next((f['check'] for f in self.findings if not f['passed']), None)

    def opinion(self, created_at: str) -> dict:
        """The AiOpinion shape the insurance panel and the main admin read."""
        conflict = self.conflict_kind
        summary = self.summary or (CONFLICT_REASONS[conflict] if conflict else 'نسخه، گزارش و تصویر با هم و با مشخصات بیمار هم‌خوانی دارند.')
        return {
            'result': 'CONFLICT' if conflict else 'OK',
            'summary': summary,
            'findings': [
                {'title': CHECKS[f['check']][0] if f['passed'] else CONFLICT_REASONS[f['check']], 'detail': f['detail'],
                 'result': 'PASS' if f['passed'] else 'CONFLICT', 'target': CHECKS[f['check']][1]}
                for f in self.findings
            ],
            'modelVersion': self.model_version,
            'createdAt': created_at,
        }


class CheckerUnavailable(Exception):
    """The checker could not answer now (network, quota). The case is tried again later."""
