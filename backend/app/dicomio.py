"""Reads DICOM files and turns them into PNG pictures.

In Docker, pydicom (with pylibjpeg) reads any DICOM, including the compressed files from Kaggle.
Without pydicom, a small built-in reader handles uncompressed files, such as the drawn sample images.
"""
from __future__ import annotations

import io
import re
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

try:  # pragma: no cover - depends on the environment
    import pydicom

    try:
        from pydicom.pixels import apply_voi_lut
    except ImportError:
        from pydicom.pixel_data_handlers.util import apply_voi_lut
except ImportError:  # pragma: no cover
    pydicom = None
    apply_voi_lut = None


@dataclass
class DicomInfo:
    patient_name: str = ''
    patient_id: str = ''
    birth_date: str = ''
    sex: str = ''
    modality: str = ''
    body_part: str = ''
    laterality: str = ''
    view: str = ''
    study_desc: str = ''
    study_date: str = ''
    institution: str = ''
    study_uid: str = ''
    accession: str = ''
    rows: int = 0
    cols: int = 0

    def as_dict(self) -> dict:
        return dict(self.__dict__)


_PERSIAN = re.compile('[؀-ۿ]')


def _person_name(raw: str) -> str:
    """'RAHIMI^SARA=سارا رحیمی' -> the Persian part if there is one, else 'SARA RAHIMI'."""
    groups = [g for g in raw.split('=') if g.strip()]
    for g in groups:
        if _PERSIAN.search(g):
            return g.replace('^', ' ').strip()
    if not groups:
        return ''
    parts = [p for p in groups[0].split('^') if p]
    return ' '.join(reversed(parts[:2])) if len(parts) >= 2 else groups[0].strip()


# ---------------------------------------------------------------- built-in reader (uncompressed only)

_LONG_VR = {b'OB', b'OW', b'OF', b'SQ', b'UT', b'UN', b'OD', b'OL', b'UC', b'UR', b'OV'}
_TAGS = {
    (0x0010, 0x0010): 'PatientName', (0x0010, 0x0020): 'PatientID', (0x0010, 0x0030): 'PatientBirthDate', (0x0010, 0x0040): 'PatientSex',
    (0x0008, 0x0060): 'Modality', (0x0018, 0x0015): 'BodyPartExamined', (0x0020, 0x0062): 'ImageLaterality', (0x0020, 0x0060): 'Laterality',
    (0x0018, 0x5101): 'ViewPosition', (0x0008, 0x1030): 'StudyDescription', (0x0008, 0x0020): 'StudyDate', (0x0008, 0x0080): 'InstitutionName',
    (0x0020, 0x000D): 'StudyInstanceUID', (0x0008, 0x0050): 'AccessionNumber', (0x0028, 0x0004): 'PhotometricInterpretation',
    (0x0028, 0x1050): 'WindowCenter', (0x0028, 0x1051): 'WindowWidth', (0x0028, 0x1052): 'RescaleIntercept', (0x0028, 0x1053): 'RescaleSlope',
}
_US_TAGS = {(0x0028, 0x0010): 'Rows', (0x0028, 0x0011): 'Columns', (0x0028, 0x0100): 'BitsAllocated', (0x0028, 0x0103): 'PixelRepresentation', (0x0028, 0x0002): 'SamplesPerPixel'}


def _read_builtin(data: bytes) -> tuple[dict, np.ndarray | None]:
    if data[128:132] != b'DICM':
        raise ValueError('not a DICOM file')
    pos, explicit, syntax = 132, True, ''
    out: dict = {}
    pixels_raw = None
    while pos + 8 <= len(data):
        group, elem = struct.unpack_from('<HH', data, pos)
        if group != 0x0002 and syntax == '1.2.840.10008.1.2':
            explicit = False
        if explicit or group == 0x0002:
            vr = data[pos + 4:pos + 6]
            if vr in _LONG_VR:
                length = struct.unpack_from('<I', data, pos + 8)[0]
                start = pos + 12
            else:
                length = struct.unpack_from('<H', data, pos + 6)[0]
                start = pos + 8
        else:
            vr = b''
            length = struct.unpack_from('<I', data, pos + 4)[0]
            start = pos + 8
        if length == 0xFFFFFFFF:
            if (group, elem) == (0x7FE0, 0x0010):
                raise ValueError('compressed pixel data needs pydicom')
            # Skip a sequence of undefined length by finding its delimiter.
            end = data.find(b'\xfe\xff\xdd\xe0', start)
            pos = end + 8 if end >= 0 else len(data)
            continue
        value = data[start:start + length]
        if (group, elem) == (0x0002, 0x0010):
            syntax = value.rstrip(b'\0 ').decode()
            if syntax not in ('1.2.840.10008.1.2.1', '1.2.840.10008.1.2'):
                raise ValueError(f'transfer syntax {syntax} needs pydicom')
        elif (group, elem) in _TAGS:
            out[_TAGS[(group, elem)]] = value.rstrip(b'\0 ').decode('utf-8', 'replace')
        elif (group, elem) in _US_TAGS:
            out[_US_TAGS[(group, elem)]] = struct.unpack_from('<H', value)[0]
        elif (group, elem) == (0x7FE0, 0x0010):
            pixels_raw = value
        pos = start + length
    pixels = None
    if pixels_raw is not None and out.get('Rows'):
        signed = out.get('PixelRepresentation', 0) == 1
        dtype = {8: np.int8 if signed else np.uint8, 16: '<i2' if signed else '<u2'}[out.get('BitsAllocated', 16)]
        count = out['Rows'] * out['Columns'] * out.get('SamplesPerPixel', 1)
        pixels = np.frombuffer(pixels_raw, dtype=dtype, count=count).reshape(out['Rows'], out['Columns'], -1).squeeze()
    return out, pixels


def _info_from(tags: dict) -> DicomInfo:
    return DicomInfo(
        patient_name=_person_name(str(tags.get('PatientName', ''))),
        patient_id=str(tags.get('PatientID', '')).strip(),
        birth_date=str(tags.get('PatientBirthDate', '')).strip(),
        sex=str(tags.get('PatientSex', '')).strip(),
        modality=str(tags.get('Modality', '')).strip().upper(),
        body_part=str(tags.get('BodyPartExamined', '')).strip().upper(),
        laterality=(str(tags.get('ImageLaterality', '') or tags.get('Laterality', '')).strip().upper()),
        view=str(tags.get('ViewPosition', '')).strip().upper(),
        study_desc=str(tags.get('StudyDescription', '')).strip(),
        study_date=str(tags.get('StudyDate', '')).strip(),
        institution=str(tags.get('InstitutionName', '')).strip(),
        study_uid=str(tags.get('StudyInstanceUID', '')).strip(),
        accession=str(tags.get('AccessionNumber', '')).strip(),
        rows=int(tags.get('Rows') or 0),
        cols=int(tags.get('Columns') or 0),
    )


def _first_number(value) -> float | None:
    if value in (None, ''):
        return None
    if isinstance(value, (list, tuple)) or (hasattr(value, '__iter__') and not isinstance(value, (str, bytes))):
        value = list(value)[0]
    try:
        return float(str(value).split('\\')[0])
    except ValueError:
        return None


def read_info(path: Path) -> DicomInfo:
    """Only the details, without decoding the picture."""
    if pydicom is not None:
        ds = pydicom.dcmread(path, stop_before_pixels=True)
        tags = {k: getattr(ds, k, '') for k in set(_TAGS.values()) | set(_US_TAGS.values())}
        tags['PatientName'] = str(getattr(ds, 'PatientName', ''))
        return _info_from(tags)
    tags, _ = _read_builtin(path.read_bytes())
    return _info_from(tags)


def to_png(path: Path, max_side: int = 1024) -> tuple[bytes, int, int]:
    """One picture from a single-frame DICOM, windowed for viewing, as PNG bytes."""
    if pydicom is not None:
        ds = pydicom.dcmread(path)
        arr = ds.pixel_array
        if arr.ndim == 3 and arr.shape[-1] not in (3, 4):  # several frames: take the middle one
            arr = arr[arr.shape[0] // 2]
        if arr.ndim == 2:
            try:
                arr = apply_voi_lut(arr, ds)
            except Exception:
                pass
        photometric = str(getattr(ds, 'PhotometricInterpretation', 'MONOCHROME2'))
        center = _first_number(getattr(ds, 'WindowCenter', None)) if 'VOILUTSequence' not in ds else None
        width = _first_number(getattr(ds, 'WindowWidth', None)) if 'VOILUTSequence' not in ds else None
        slope = _first_number(getattr(ds, 'RescaleSlope', None)) or 1.0
        intercept = _first_number(getattr(ds, 'RescaleIntercept', None)) or 0.0
    else:
        tags, arr = _read_builtin(path.read_bytes())
        if arr is None:
            raise ValueError('no picture in this DICOM file')
        photometric = tags.get('PhotometricInterpretation', 'MONOCHROME2')
        center, width = _first_number(tags.get('WindowCenter')), _first_number(tags.get('WindowWidth'))
        slope = _first_number(tags.get('RescaleSlope')) or 1.0
        intercept = _first_number(tags.get('RescaleIntercept')) or 0.0

    if arr.ndim == 3:  # colour already
        img = Image.fromarray(np.asarray(arr, dtype=np.uint8)).convert('RGB')
    else:
        data = arr.astype(np.float32) * slope + intercept
        if center is not None and width:
            low, high = center - width / 2, center + width / 2
        else:
            body = data[data > np.percentile(data, 5)] if data.size else data
            low, high = (np.percentile(body, 0.5), np.percentile(body, 99.5)) if body.size else (float(data.min()), float(data.max()))
        scaled = np.clip((data - low) / max(high - low, 1e-6), 0, 1)
        if photometric == 'MONOCHROME1':
            scaled = 1 - scaled
        img = Image.fromarray((scaled * 255).astype(np.uint8), 'L')
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return buf.getvalue(), img.width, img.height
