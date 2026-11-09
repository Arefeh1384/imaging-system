"""What a checker receives and returns. The fake checker and the Gemini checker share this shape."""
from __future__ import annotations

from dataclasses import dataclass, field

# The checks every checker runs, and what each one is called on screen.
CHECKS = {
    'PRESCRIPTION_STUDY': ('آیا خدمت نسخه با تصویربرداری می‌خواند؟', 'prescription'),
    'PRESCRIPTION_NAME': ('آیا نسخه به نام همین بیمار است؟', 'prescription'),
    'REPORT_IMAGES': ('آیا گزارش درباره همین تصویربرداری است؟', 'report'),
    'IMAGE_PATIENT': ('آیا تصویر مال همین بیمار است؟', 'images'),
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
    by_ai: bool = False  # False for the fake checker, which compares written details only
    raw_answer: str = ''  # the model's reply exactly as it came, kept for the insurer to read

    @property
    def conflict_kind(self) -> str | None:
        return next((f['check'] for f in self.findings if not f['passed']), None)

    def opinion(self, created_at: str) -> dict:
        """The AiOpinion shape the insurance panel and the main admin read."""
        conflict = self.conflict_kind
        if self.by_ai:
            # The model's own summary, word for word.
            summary = self.summary.strip() or 'هوش مصنوعی برای این بررسی خلاصه‌ای ننوشت.'
        else:
            summary = 'بررسی آزمایشی بدون هوش مصنوعی: ' + (CONFLICT_REASONS[conflict] if conflict else 'جزئیات نوشته‌شده نسخه، گزارش و فایل DICOM با هم و با مشخصات بیمار یکی است.')
        out = {
            'result': 'CONFLICT' if conflict else 'OK',
            'summary': summary,
            # The title names what was checked; the detail is the checker's own explanation.
            'findings': [
                {'title': CHECKS[f['check']][0], 'detail': f['detail'], 'result': 'PASS' if f['passed'] else 'CONFLICT', 'target': CHECKS[f['check']][1]}
                for f in self.findings
            ],
            'modelVersion': self.model_version,
            'byAi': self.by_ai,
            'createdAt': created_at,
        }
        if self.raw_answer:
            out['rawAnswer'] = self.raw_answer[:8000]
        return out


class CheckerUnavailable(Exception):
    """The checker could not answer now (network, quota). The case is tried again later."""
