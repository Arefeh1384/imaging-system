"""Builds the sample dataset in ../../datasets: 15 fake mammography cases.

Each case has one DICOM image, the details a relay would send, a radiologist report and a prescription.
Some prescriptions come in the ZIP, some are e-prescriptions the patient types the code of, and some are
paper prescriptions the patient photographs. A few cases are wrong on purpose so the check finds a conflict.

Everything here is invented. The pictures are drawn, not taken from patients.
Run:  python sandbox/tools/generate_sample.py   (needs numpy and Pillow with raqm for Persian text)
To use real Kaggle mammograms instead of the drawn ones, see sandbox/tools/import_kaggle.py.
"""
from __future__ import annotations

import json
import math
import random
import struct
import sys
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'datasets'
# DejaVu Sans covers Persian letters, Persian digits and Latin punctuation in one file, so paper documents print cleanly.
FONT_FA = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_LATIN = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

HOSPITALS = {
    'h1': 'بیمارستان امام حسین',
    'h2': 'بیمارستان بقیه‌الله',
    'h3': 'مرکز تصویربرداری پارس',
}
RADIOLOGIST = 'دکتر نادر کیانی، رادیولوژیست'
DOCTORS = ['دکتر مریم احمدی، متخصص زنان', 'دکتر علی رضایی، جراح عمومی', 'دکتر سیما توکلی، متخصص زنان']


def national_id(seed: str) -> str:
    """A 10-digit number with a valid check digit. Not a real person's."""
    base = ''.join(str((ord(ch) * 7 + i * 3) % 10) for i, ch in enumerate((seed * 9)[:9]))
    if len(set(base)) == 1:
        base = '1' + base[1:]
    total = sum(int(d) * (10 - i) for i, d in enumerate(base))
    r = total % 11
    return base + str(r if r < 2 else 11 - r)


# mode: how the prescription reaches us. pacs = in the ZIP, erx = patient types the e-prescription code, paper = patient uploads a photo.
# fault: what is wrong on purpose. None means everything matches.
CASES = [
    dict(id='MG-001', name='سارا رحیمی', mobile='09120004521', hospital='h1', day='2026-10-28', side='R', view='CC', service='ماموگرافی پستان راست', mode='pacs', report=True, fault=None,
         note='نسخه در ZIP. همان روز یک ماموگرافی دیگر هم دارد (MG-002).'),
    dict(id='MG-002', name='سارا رحیمی', mobile='09120004521', hospital='h1', day='2026-10-28', side='L', view='CC', service='ماموگرافی پستان چپ', mode='pacs', report=True, fault=None,
         note='خدمت دوم همان روز. جدا تأیید می‌شود.'),
    dict(id='MG-003', name='مریم کاظمی', mobile='09121110003', hospital='h2', day='2026-10-30', side='L', view='MLO', service='ماموگرافی', mode='erx', report=True, fault=None,
         note='نسخه در ZIP نیست. بیمار شناسه نسخه الکترونیک را می‌نویسد.'),
    dict(id='MG-004', name='لیلا صادقی', mobile='09120006666', hospital='h1', day='2026-11-01', side='R', view='MLO', service='ماموگرافی', mode='paper', report=True, fault=None,
         note='نسخه کاغذی. بیمار عکس نسخه را بارگذاری می‌کند.'),
    dict(id='MG-005', name='نرگس امیری', mobile='09121110005', hospital='h3', day='2026-11-02', side='L', view='CC', service='ماموگرافی', mode='pacs', report=False, fault=None,
         note='گزارش رادیولوژیست در ZIP نیست. بیمار عکس گزارش را بارگذاری می‌کند.'),
    dict(id='MG-006', name='زهرا جعفری', mobile='09121110006', hospital='h2', day='2026-11-02', side='R', view='CC', service='ماموگرافی', mode='pacs', report=True, fault='PRESCRIPTION_STUDY',
         rx_service='سونوگرافی شکم و لگن', note='مغایرت عمدی: نسخه برای سونوگرافی است، تصویر ماموگرافی.'),
    dict(id='MG-007', name='فاطمه مرادی', mobile='09121110007', hospital='h1', day='2026-11-03', side='L', view='MLO', service='ماموگرافی', mode='pacs', report=True, fault='PRESCRIPTION_NAME',
         rx_name='فاطمه مرادیان', note='مغایرت عمدی: نام روی نسخه با نام بیمار یکی نیست.'),
    dict(id='MG-008', name='الهام نوری', mobile='09121110008', hospital='h3', day='2026-11-03', side='R', view='MLO', service='ماموگرافی', mode='erx', report=True, fault='PRESCRIPTION_NAME',
         rx_name='الهام نوروزی', note='مغایرت عمدی: نسخه الکترونیک به نام کس دیگری است.'),
    dict(id='MG-009', name='شیرین حسینی', mobile='09121110009', hospital='h2', day='2026-11-04', side='L', view='CC', service='ماموگرافی', mode='erx', report=True, fault='PRESCRIPTION_STUDY',
         rx_service='سی‌تی‌اسکن ریه', note='مغایرت عمدی: نسخه الکترونیک برای سی‌تی‌اسکن است.'),
    dict(id='MG-010', name='مینا کریمی', mobile='09121110010', hospital='h1', day='2026-11-04', side='R', view='CC', service='ماموگرافی', mode='pacs', report=True, fault='REPORT_IMAGES',
         note='مغایرت عمدی: گزارش درباره سونوگرافی کبد است، نه این ماموگرافی.'),
    dict(id='MG-011', name='پریسا رستمی', mobile='09121110011', hospital='h3', day='2026-11-05', side='L', view='MLO', service='ماموگرافی', mode='paper', report=False, fault=None,
         note='نسخه کاغذی و گزارش هر دو بارگذاری می‌شوند.'),
    dict(id='MG-012', name='نسرین قاسمی', mobile='09121110012', hospital='h2', day='2026-11-05', side='R', view='MLO', service='ماموگرافی', mode='pacs', report=True, fault=None,
         note='برای آزمون «نه، نگرفته‌ام»: بیمار بگوید این خدمت را نگرفته است.'),
    dict(id='MG-013', name='سمیه باقری', mobile='09121110013', hospital='h1', day='2026-11-06', side='L', view='CC', service='ماموگرافی', mode='pacs', report=True, fault='NO_IMAGES',
         note='ZIP ناقص: تصویر DICOM ندارد و رد می‌شود.'),
    dict(id='MG-014', name='هانیه شریفی', mobile='09121110014', hospital='h3', day='2026-11-06', side='R', view='CC', service='ماموگرافی', mode='erx', report=True, fault=None,
         note='نسخه الکترونیک درست. برای آزمون، اول یک شناسه اشتباه بنویسید.'),
    dict(id='MG-015', name='رویا ملکی', mobile='09121110015', hospital='h2', day='2026-11-07', side='L', view='MLO', service='ماموگرافی', mode='pacs', report=True, fault=None,
         note='برای آزمون ZIP تکراری: دو بار بفرستید.'),
]

EXPECTED = {
    None: 'ارسال به بیمه',
    'PRESCRIPTION_STUDY': 'رد: نسخه با تصویر نمی‌خواند',
    'PRESCRIPTION_NAME': 'رد: نام روی نسخه',
    'REPORT_IMAGES': 'رد: گزارش با تصویر نمی‌خواند',
    'NO_IMAGES': 'ZIP رد می‌شود',
}

LATIN_NAMES = {
    'سارا رحیمی': 'RAHIMI^SARA', 'مریم کاظمی': 'KAZEMI^MARYAM', 'لیلا صادقی': 'SADEGHI^LEILA', 'نرگس امیری': 'AMIRI^NARGES',
    'زهرا جعفری': 'JAFARI^ZAHRA', 'فاطمه مرادی': 'MORADI^FATEMEH', 'الهام نوری': 'NOORI^ELHAM', 'شیرین حسینی': 'HOSSEINI^SHIRIN',
    'مینا کریمی': 'KARIMI^MINA', 'پریسا رستمی': 'ROSTAMI^PARISA', 'نسرین قاسمی': 'GHASEMI^NASRIN', 'سمیه باقری': 'BAGHERI^SOMAYEH',
    'هانیه شریفی': 'SHARIFI^HANIEH', 'رویا ملکی': 'MALEKI^ROYA',
}

FA_DIGITS = str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')


def fa(text: str) -> str:
    return text.translate(FA_DIGITS)


def jalali(iso: str) -> str:
    """Gregorian to Jalali (Persian calendar), as 1405/08/07."""
    gy, gm, gd = (int(x) for x in iso.split('-'))
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + 1 if gm > 2 else gy
    days = 355666 + (365 * gy) + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) + gd + g_d_m[gm - 1]
    jy = -1595 + (33 * (days // 12053))
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    jm = 1 + days // 31 if days < 186 else 7 + (days - 186) // 30
    jd = 1 + (days % 31 if days < 186 else (days - 186) % 30)
    return f'{jy}/{jm:02d}/{jd:02d}'


# ---------------------------------------------------------------- DICOM writing (explicit VR little endian)

def _el(group: int, elem: int, vr: str, value: bytes) -> bytes:
    if len(value) % 2:
        value += b'\0' if vr in ('UI', 'OB') else b' '
    head = struct.pack('<HH', group, elem) + vr.encode()
    if vr in ('OB', 'OW', 'OF', 'SQ', 'UT', 'UN'):
        return head + b'\0\0' + struct.pack('<I', len(value)) + value
    return head + struct.pack('<H', len(value)) + value


def _us(v: int) -> bytes:
    return struct.pack('<H', v)


def write_dicom(path: Path, pixels: np.ndarray, tags: dict) -> None:
    sop_class = '1.2.840.10008.5.1.4.1.1.1.2'  # Digital Mammography X-Ray Image Storage, For Presentation
    meta_body = b''.join([
        _el(0x0002, 0x0001, 'OB', b'\0\1'),
        _el(0x0002, 0x0002, 'UI', sop_class.encode()),
        _el(0x0002, 0x0003, 'UI', tags['sop_uid'].encode()),
        _el(0x0002, 0x0010, 'UI', b'1.2.840.10008.1.2.1'),
        _el(0x0002, 0x0012, 'UI', b'1.2.826.0.1.3680043.10.1405.1'),
    ])
    meta = _el(0x0002, 0x0000, 'UL', struct.pack('<I', len(meta_body))) + meta_body
    rows, cols = pixels.shape
    s = lambda v: v.encode('utf-8')
    body = [
        _el(0x0008, 0x0005, 'CS', b'ISO_IR 192'),
        _el(0x0008, 0x0008, 'CS', b'ORIGINAL\\PRIMARY'),
        _el(0x0008, 0x0016, 'UI', sop_class.encode()),
        _el(0x0008, 0x0018, 'UI', tags['sop_uid'].encode()),
        _el(0x0008, 0x0020, 'DA', s(tags['date'])),
        _el(0x0008, 0x0050, 'SH', s(tags['accession'])),
        _el(0x0008, 0x0060, 'CS', b'MG'),
        _el(0x0008, 0x0080, 'LO', s(tags['institution'])),
        _el(0x0008, 0x1030, 'LO', s(tags['study_desc'])),
        _el(0x0008, 0x103E, 'LO', s(tags['series_desc'])),
        _el(0x0010, 0x0010, 'PN', s(tags['patient_name'])),
        _el(0x0010, 0x0020, 'LO', s(tags['patient_id'])),
        _el(0x0010, 0x0030, 'DA', s(tags['birth_date'])),
        _el(0x0010, 0x0040, 'CS', b'F'),
        _el(0x0018, 0x0015, 'CS', b'BREAST'),
        _el(0x0018, 0x5101, 'CS', s(tags['view'])),
        _el(0x0020, 0x000D, 'UI', tags['study_uid'].encode()),
        _el(0x0020, 0x000E, 'UI', tags['series_uid'].encode()),
        _el(0x0020, 0x0013, 'IS', b'1'),
        _el(0x0020, 0x0062, 'CS', s(tags['side'])),
        _el(0x0028, 0x0002, 'US', _us(1)),
        _el(0x0028, 0x0004, 'CS', b'MONOCHROME2'),
        _el(0x0028, 0x0010, 'US', _us(rows)),
        _el(0x0028, 0x0011, 'US', _us(cols)),
        _el(0x0028, 0x0100, 'US', _us(16)),
        _el(0x0028, 0x0101, 'US', _us(12)),
        _el(0x0028, 0x0102, 'US', _us(11)),
        _el(0x0028, 0x0103, 'US', _us(0)),
        _el(0x0028, 0x1050, 'DS', b'2048'),
        _el(0x0028, 0x1051, 'DS', b'4096'),
        _el(0x7FE0, 0x0010, 'OW', pixels.astype('<u2').tobytes()),
    ]
    path.write_bytes(b'\0' * 128 + b'DICM' + meta + b''.join(body))


def smooth_noise(rng: np.random.Generator, shape, scale: float) -> np.ndarray:
    """Soft random texture, made by blurring noise in the frequency domain."""
    noise = rng.standard_normal(shape)
    fy = np.fft.fftfreq(shape[0])[:, None]
    fx = np.fft.fftfreq(shape[1])[None, :]
    spectrum = np.fft.fft2(noise) * np.exp(-((fx ** 2 + fy ** 2) * scale))
    out = np.real(np.fft.ifft2(spectrum))
    return (out - out.mean()) / (out.std() + 1e-9)


def draw_mammogram(case: dict, rng: np.random.Generator) -> np.ndarray:
    """A drawn breast seen in one view. Chest wall on the side the radiologist expects, marker burned in."""
    h, w = 800, 640
    y, x = np.mgrid[0:h, 0:w].astype(float)
    chest_on_left = case['side'] == 'R'  # R breast: chest wall on the left of the image, as usually displayed
    dx = x if chest_on_left else (w - 1 - x)
    cy = h * (0.5 if case['view'] == 'CC' else 0.56)
    ry = h * (0.42 if case['view'] == 'CC' else 0.47)
    rx = w * (0.70 + rng.uniform(-0.05, 0.05))
    r = np.sqrt((dx / rx) ** 2 + ((y - cy) / ry) ** 2)
    inside = r < 1.0
    tissue = np.clip(1.0 - r, 0, 1) ** 0.35
    dense = np.clip(smooth_noise(rng, (h, w), 900) * 0.5 + smooth_noise(rng, (h, w), 120) * 0.25 + 0.4, 0, 1)
    dense *= np.clip(1.15 - r * 1.1, 0, 1)
    img = np.where(inside, 900 + tissue * 1300 + dense * 1500, 30 + rng.normal(0, 6, (h, w)))
    if case['view'] == 'MLO':  # pectoral muscle as a bright triangle in the upper corner
        pect = (dx < w * 0.32 - y * 0.45) & (y < h * 0.62)
        img = np.where(pect & inside, img * 0.6 + 2300, img)
    skin = (r > 0.985) & (r < 1.0)
    img = np.where(skin, img + 500, img)
    for _ in range(rng.integers(3, 8)):  # a few small bright dots
        py, px = rng.integers(int(cy - ry * 0.6), int(cy + ry * 0.6)), int(rng.uniform(0.15, 0.6) * rx)
        px = px if chest_on_left else w - 1 - px
        img[max(py - 2, 0):py + 2, max(px - 2, 0):px + 2] += 900
    img = np.clip(img, 0, 4095)
    # Marker letters, as a technologist puts on the plate.
    mark = Image.new('L', (w, h), 0)
    font = ImageFont.truetype(FONT_LATIN, 34)
    text = f"{case['side']}{case['view']}"
    ImageDraw.Draw(mark).text((w - 40 if chest_on_left else 40, 40), text, font=font, fill=255, anchor='ra' if chest_on_left else 'la')
    m = np.asarray(mark, dtype=float) / 255
    img = np.maximum(img, m * 3900)
    return img.astype(np.uint16)


# ---------------------------------------------------------------- paper documents

def font(size: int):
    return ImageFont.truetype(FONT_FA, size)


def draw_rtl(d: ImageDraw.ImageDraw, xy, text: str, size: int, fill='#1d2b33'):
    d.text(xy, text, font=font(size), fill=fill, anchor='ra', direction='rtl')


def prescription_png(case: dict, rx: dict) -> Image.Image:
    """A scanned paper prescription. Persian digits only, as the font covers Persian."""
    W, H = 900, 1200
    im = Image.new('RGB', (W, H), '#fbfaf4')
    d = ImageDraw.Draw(im)
    d.rectangle([30, 30, W - 30, H - 30], outline='#9aa7ad', width=3)
    draw_rtl(d, (W - 60, 60), 'بسمه تعالی', 30)
    draw_rtl(d, (W - 60, 110), rx['doctor'], 36)
    draw_rtl(d, (W - 60, 165), f"شماره نظام پزشکی: {fa(rx['doctor_code'])}", 26, '#45545c')
    d.line([60, 220, W - 60, 220], fill='#1d2b33', width=3)
    rows = [
        ('نام بیمار', rx['patient_name']),
        ('کد ملی', fa(rx['national_id'])),
        ('تاریخ', fa(jalali(rx['date']))),
        ('بیمه', 'بیمه سلامت'),
    ]
    yy = 250
    for label, value in rows:
        draw_rtl(d, (W - 60, yy), f'{label}:', 30, '#45545c')
        draw_rtl(d, (W - 260, yy), value, 32)
        yy += 60
    d.line([60, yy + 10, W - 60, yy + 10], fill='#c8cfd2', width=2)
    draw_rtl(d, (W - 60, yy + 40), 'درخواست:', 34)
    draw_rtl(d, (W - 110, yy + 110), rx['service'], 46)
    draw_rtl(d, (W - 110, yy + 185), f"علت: {rx['reason']}", 30, '#45545c')
    # A stamp and a signature scrawl.
    d.ellipse([90, H - 330, 330, H - 150], outline='#2d5fa8', width=5)
    d.text((210, H - 255), 'مهر پزشک', font=font(28), fill='#2d5fa8', anchor='mm', direction='rtl')
    pts = [(420 + i * 9, H - 220 + int(18 * math.sin(i / 2.3))) for i in range(40)]
    d.line(pts, fill='#22324a', width=4)
    draw_rtl(d, (W - 60, H - 90), 'نمونه آزمایشی، نسخه واقعی نیست', 22, '#8a979d')
    return im


def report_lines(case: dict) -> tuple[str, str]:
    side = 'راست' if case['side'] == 'R' else 'چپ'
    if case['fault'] == 'REPORT_IMAGES':
        return ('سونوگرافی کبد و کیسه صفرا',
                'کبد با اندازه طبیعی و اکوی همگن. کیسه صفرا بدون سنگ. مجاری صفراوی گشاد نیستند. طحال و کلیه‌ها طبیعی‌اند.')
    view = 'کرانیوکودال' if case['view'] == 'CC' else 'مدیولترال مایل'
    return (case['service'],
            f'ماموگرافی پستان {side} در نمای {view} انجام شد. بافت پستان از نوع فیبروگلاندولار پراکنده است. '
            'توده یا عدم تقارن مشکوک دیده نمی‌شود. چند کلسیفیکاسیون نقطه‌ای خوش‌خیم دیده می‌شود. BI-RADS 2، پیگیری روتین.')


def report_png(case: dict, title: str, text: str) -> Image.Image:
    W, H = 900, 1100
    im = Image.new('RGB', (W, H), '#ffffff')
    d = ImageDraw.Draw(im)
    draw_rtl(d, (W - 60, 60), HOSPITALS[case['hospital']], 34)
    draw_rtl(d, (W - 60, 115), 'گزارش رادیولوژی', 30, '#45545c')
    d.line([60, 165, W - 60, 165], fill='#1d2b33', width=3)
    draw_rtl(d, (W - 60, 195), f"بیمار: {case['name']}", 30)
    draw_rtl(d, (W - 60, 245), f"تاریخ: {fa(jalali(case['day']))}", 28, '#45545c')
    draw_rtl(d, (W - 60, 305), title, 34)
    words, line, yy = text.split(' '), '', 370
    for word in words:
        trial = f'{line} {word}'.strip()
        if d.textlength(trial, font=font(28), direction='rtl') > W - 140:
            draw_rtl(d, (W - 60, yy), fa(line), 28)
            yy += 50
            line = word
        else:
            line = trial
    if line:
        draw_rtl(d, (W - 60, yy), fa(line), 28)
    draw_rtl(d, (W - 60, H - 150), RADIOLOGIST, 28)
    draw_rtl(d, (W - 60, H - 90), 'نمونه آزمایشی', 22, '#8a979d')
    return im


def as_photo(paper: Image.Image, rng: random.Random) -> Image.Image:
    """The paper as a phone photo: tilted on a desk, a little uneven light."""
    bg = Image.new('RGB', (paper.width + 260, paper.height + 260), (118, 96, 74))
    noise = Image.effect_noise(bg.size, 18).convert('RGB')
    bg = Image.blend(bg, noise, 0.12)
    angle = rng.uniform(-6, 6)
    tilted = paper.rotate(angle, expand=True, resample=Image.BICUBIC)
    tilted_mask = Image.new('L', paper.size, 255).rotate(angle, expand=True)
    bg.paste(tilted, ((bg.width - tilted.width) // 2, (bg.height - tilted.height) // 2), tilted_mask)
    shade = Image.linear_gradient('L').resize(bg.size).point(lambda v: 200 + v // 5)
    bg = Image.composite(bg, Image.new('RGB', bg.size, (0, 0, 0)), shade)
    return bg.filter(ImageFilter.GaussianBlur(0.6)).resize((bg.width * 2 // 3, bg.height * 2 // 3))


def main() -> None:
    rng = np.random.default_rng(1405)
    prng = random.Random(1405)
    for sub in ('dicom', 'prescriptions', 'patient-uploads'):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
        for old in (OUT / sub).glob('*'):
            old.unlink()

    cases_out, erx_out = [], []
    for n, c in enumerate(CASES, start=1):
        nid = national_id(c['name'])
        birth = f'19{70 + n % 20}-0{1 + n % 9}-1{n % 9}'
        uid_root = f'1.2.826.0.1.3680043.10.1405.{n}'
        study = {
            'accessionNumber': f'ACC{1405000 + n}',
            'studyInstanceUid': f'{uid_root}.1',
            'title': f"ماموگرافی پستان {'راست' if c['side'] == 'R' else 'چپ'}، نمای {c['view']}",
            'service': c['service'],
            'modality': 'MG',
            'bodyPart': 'BREAST',
            'laterality': c['side'],
            'view': c['view'],
            'date': c['day'],
        }
        patient = {'name': c['name'], 'nationalId': nid, 'mobile': c['mobile'], 'birthDate': birth, 'sex': 'F'}
        doctor = DOCTORS[n % len(DOCTORS)]
        rx = {
            'doctor': doctor.split('،')[0],
            'specialty': doctor.split('،')[1].strip(),
            'doctor_code': str(81000 + n * 37),
            'patient_name': c.get('rx_name', c['name']),
            'national_id': national_id(c['rx_name']) if 'rx_name' in c else nid,
            'service': c.get('rx_service', c['service']),
            'reason': 'غربالگری سرطان پستان' if 'rx_service' not in c else 'درد شکم' if 'سونو' in c['rx_service'] else 'سرفه مزمن',
            'date': c['day'],
        }

        # DICOM image (left out on purpose for the broken ZIP).
        image_file = None
        if c['fault'] != 'NO_IMAGES':
            pixels = draw_mammogram(c, rng)
            image_file = f"dicom/{c['id']}.dcm"
            write_dicom(OUT / image_file, pixels, {
                'sop_uid': f'{uid_root}.1.1.1', 'study_uid': study['studyInstanceUid'], 'series_uid': f'{uid_root}.1.1',
                'date': c['day'].replace('-', ''), 'accession': study['accessionNumber'], 'institution': HOSPITALS[c['hospital']],
                'study_desc': study['title'], 'series_desc': f"{c['side']} {c['view']}", 'patient_name': LATIN_NAMES[c['name']] + '=' + c['name'],
                'patient_id': nid, 'birth_date': birth.replace('-', ''), 'view': c['view'], 'side': c['side'],
            })

        title, text = report_lines(c)
        report = {'doctor': RADIOLOGIST, 'study': title, 'text': text, 'signedAt': f"{c['day']}T13:20:00+03:30"}

        prescription_file = None
        if c['mode'] == 'pacs':
            prescription_file = f"prescriptions/{c['id']}.png"
            prescription_png(c, rx).save(OUT / prescription_file, optimize=True)
        elif c['mode'] == 'paper':
            as_photo(prescription_png(c, rx), prng).convert('RGB').save(OUT / f"patient-uploads/{c['id']}-prescription.jpg", quality=86)
        erx_id = None
        if c['mode'] == 'erx':
            erx_id = f'1405{n:02d}{(n * 7919) % 100000:05d}'
            erx_out.append({
                'id': erx_id,
                'issuedAt': f"{c['day']}T09:10:00+03:30",
                'doctor': {'name': rx['doctor'], 'specialty': rx['specialty'], 'code': rx['doctor_code']},
                'patient': {'name': rx['patient_name'], 'nationalId': rx['national_id']},
                'services': [{'title': rx['service'], 'reason': rx['reason'], 'count': 1}],
                'insurer': 'بیمه سلامت',
                'caseId': c['id'],
            })
        if not c['report']:
            report_png(c, title, text).save(OUT / f"patient-uploads/{c['id']}-report.png", optimize=True)

        cases_out.append({
            'id': c['id'],
            'hospital': {'id': c['hospital'], 'name': HOSPITALS[c['hospital']]},
            'patient': patient,
            'study': study,
            'image': image_file,
            'report': report if c['report'] else None,
            'prescriptionMode': c['mode'],
            'prescriptionImage': prescription_file,
            'prescription': {k: rx[k] for k in ('doctor', 'specialty', 'patient_name', 'national_id', 'service', 'reason', 'date')} if c['mode'] == 'pacs' else None,
            'eRxId': erx_id,
            'patientUploads': sorted(p.name for p in (OUT / 'patient-uploads').glob(f"{c['id']}-*")),
            'fault': c['fault'],
            'expected': EXPECTED[c['fault']],
            'note': c['note'],
        })

    (OUT / 'cases.json').write_text(json.dumps({'generatedAt': str(date.today()), 'cases': cases_out}, ensure_ascii=False, indent=2), encoding='utf-8')
    (OUT / 'e-prescriptions.json').write_text(json.dumps({'prescriptions': erx_out}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(cases_out)} cases, {len(erx_out)} e-prescriptions written to {OUT}')


if __name__ == '__main__':
    sys.exit(main())
