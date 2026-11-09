"""Small text helpers and the Persian wording shared by several modules."""
from __future__ import annotations

import re

_DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
_FA = str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')


def latin_digits(value: str) -> str:
    """Persian and Arabic digits to 0-9, so typed codes compare correctly."""
    return (value or '').translate(_DIGITS)


def fa_digits(value: object) -> str:
    return str(value).translate(_FA)


def mask_mobile(mobile: str) -> str:
    return f'{mobile[:4]}***{mobile[-4:]}' if len(mobile) >= 8 else mobile


def is_national_id(value: str) -> bool:
    if not re.fullmatch(r'\d{10}', value) or len(set(value)) == 1:
        return False
    total = sum(int(d) * (10 - i) for i, d in enumerate(value[:9]))
    r = total % 11
    return int(value[9]) == (r if r < 2 else 11 - r)


def normalize_name(name: str) -> str:
    """For comparing names: same letters whatever the keyboard, no extra spaces or half-spaces."""
    name = (name or '').replace('ي', 'ی').replace('ك', 'ک').replace('‌', ' ')
    return re.sub(r'\s+', ' ', name).strip()


CONFLICT_REASONS = {
    'PRESCRIPTION_STUDY': 'خدمت نوشته‌شده در نسخه با تصویربرداری انجام‌شده یکسان نیست.',
    'PRESCRIPTION_NAME': 'نام روی نسخه با نام بیمار یکسان نیست.',
    'REPORT_IMAGES': 'گزارش رادیولوژیست به این تصویربرداری مربوط نیست.',
}


def denied_reason(key: str) -> str:
    return 'بیمار گفت این خدمت را دریافت نکرده است.' if key == 'service' else 'بیمار گفت نسخه مال او نیست.'


def invite_sms(link: str) -> str:
    return f'سامانه تصویربرداری و بیمه: کار پرونده شما را جلو بردیم. لطفاً وارد پنل کاربری خود شوید و کارتان را ادامه دهید: {link}'


def otp_sms(code: str) -> str:
    return f'سامانه تصویربرداری و بیمه: کد ورود شما {code} است. این کد را به کسی ندهید.'


def sent_sms(tracking: str) -> str:
    return f'سامانه تصویربرداری و بیمه: پرونده شما کامل است و برای بیمه ارسال شد. شماره پیگیری: {tracking}'


def conflict_sms(hospital: str) -> str:
    return f'اطلاعات پرونده تصویربرداری شما با هم مغایرت دارد و برای بیمه ارسال نشد. لطفاً با {hospital} تماس بگیرید تا اطلاعات را دوباره بفرستند.'


def erx_missing_sms(link: str) -> str:
    return f'سامانه تصویربرداری و بیمه: نسخه الکترونیک با شناسه‌ای که نوشتید پیدا نشد. لطفاً وارد پنل شوید و شناسه یا عکس نسخه را دوباره ثبت کنید: {link}'
