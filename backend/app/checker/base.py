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
# Why a check failed. MISMATCH: the details were read and disagree. UNREADABLE and NOT_THE_DOCUMENT are about the
# document itself, and the patient is told that instead of a mismatch.
PROBLEMS = ['NONE', 'MISMATCH', 'UNREADABLE', 'NOT_THE_DOCUMENT']
DOCUMENT_REASONS = {
    ('prescription', 'UNREADABLE'): 'نسخه‌ای که فرستاده شد خوانا نیست.',
    ('prescription', 'NOT_THE_DOCUMENT'): 'فایلی که به جای نسخه فرستاده شد، نسخه پزشکی نیست.',
    ('report', 'UNREADABLE'): 'گزارش رادیولوژیستی که فرستاده شد خوانا نیست.',
    ('report', 'NOT_THE_DOCUMENT'): 'فایلی که به جای گزارش رادیولوژیست فرستاده شد، گزارش رادیولوژی نیست.',
    ('images', 'UNREADABLE'): 'تصویر پزشکی خوانا نیست.',
    ('images', 'NOT_THE_DOCUMENT'): 'تصویر پزشکی با تصویربرداری ثبت‌شده نمی‌خواند.',
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
    findings: list[dict] = field(default_factory=list)  # {check, passed, detail, problem}
    summary: str = ''
    model_version: str = ''
    by_ai: bool = False  # False for the fake checker, which compares written details only
    raw_answer: str = ''  # the model's reply exactly as it came, kept for the insurer to read

    def _first_failed(self) -> dict | None:
        failed = [f for f in self.findings if not f['passed']]
        # A document that can't be read, or isn't a prescription or a report at all, comes first: it is why the other
        # checks on it failed too.
        return next((f for f in failed if f.get('problem') in ('UNREADABLE', 'NOT_THE_DOCUMENT')), failed[0] if failed else None)

    @property
    def conflict_kind(self) -> str | None:
        f = self._first_failed()
        return f['check'] if f else None

    @property
    def conflict_reason(self) -> str | None:
        """What the patient is told."""
        f = self._first_failed()
        if not f:
            return None
        return DOCUMENT_REASONS.get((CHECKS[f['check']][1], f.get('problem')), CONFLICT_REASONS[f['check']])

    def opinion(self, created_at: str) -> dict:
        """The AiOpinion shape the insurance panel and the main admin read."""
        conflict = self.conflict_kind
        if self.by_ai:
            # The model's own summary, word for word.
            summary = self.summary.strip() or 'هوش مصنوعی برای این بررسی خلاصه‌ای ننوشت.'
        else:
            summary = 'بررسی آزمایشی بدون هوش مصنوعی: ' + (self.conflict_reason if conflict else 'جزئیات نوشته‌شده نسخه، گزارش و فایل DICOM با هم و با مشخصات بیمار یکی است.')
        out = {
            'result': 'CONFLICT' if conflict else 'OK',
            'summary': summary,
            # The title names what was checked; the detail is the checker's own explanation.
            'findings': [
                {'title': CHECKS[f['check']][0], 'detail': f['detail'], 'result': 'PASS' if f['passed'] else 'CONFLICT', 'target': CHECKS[f['check']][1],
                 'problem': f.get('problem') or ('NONE' if f['passed'] else 'MISMATCH')}
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


def findings_from(data: dict) -> list[dict]:
    """The four checks from a model's answer. A check passes only when the model passed it and named no problem,
    so "passed, but the prescription is unreadable" counts as failed. A check the model left out means the answer is
    incomplete: the case is tried again rather than passed."""
    by_check = {f['check']: f for f in data.get('findings', []) if isinstance(f, dict) and f.get('check') in CHECKS}
    missing = [k for k in CHECKS if k not in by_check]
    if missing:
        raise CheckerUnavailable(f"The model's answer left out {', '.join(missing)}; the case is checked again later.")
    out = []
    for k in CHECKS:
        f = by_check[k]
        problem = str(f.get('problem') or '').upper()
        if problem not in PROBLEMS:
            problem = 'NONE' if f.get('passed') else 'MISMATCH'
        passed = bool(f.get('passed')) and problem == 'NONE'
        if not passed and problem == 'NONE':
            problem = 'MISMATCH'
        out.append({'check': k, 'passed': passed, 'detail': str(f.get('detail', '')), 'problem': problem})
    return out
