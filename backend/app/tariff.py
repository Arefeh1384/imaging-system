"""The insurer's fixed price list: one amount per type of imaging. Illustrative amounts, in rials."""
from __future__ import annotations

from . import db

VERSION = 'تعرفه نمونه بیمه دانا، ۱۴۰۵'
TOMAN = 10

TARIFF = {
    'MG': ('ماموگرافی', 600_000 * TOMAN),
    'MR': ('ام‌آر‌آی', 1_500_000 * TOMAN),
    'CT': ('سی‌تی‌اسکن', 1_200_000 * TOMAN),
    'US': ('سونوگرافی', 400_000 * TOMAN),
    'DX': ('رادیوگرافی', 250_000 * TOMAN),
    'CR': ('رادیوگرافی', 250_000 * TOMAN),
}
OTHER = ('سایر تصویربرداری‌ها', 500_000 * TOMAN)


# The fee for each accepted ZIP and how it is split, in rials. Illustrative, the same as the frontend's sample data.
FEE_RULE = {'feeRial': 100_000, 'hospitalRial': 30_000, 'insuranceRial': 30_000, 'managementRial': 40_000}


def share_for(modality: str) -> dict:
    title, rial = TARIFF.get((modality or '').upper(), OTHER)
    return {'tariffTitle': title, 'insurerShareRial': rial, 'tariffVersion': VERSION, 'createdAt': db.now_iso()}
