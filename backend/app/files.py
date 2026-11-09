"""Where files live under DATA_DIR/files, and small picture helpers."""
from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image, ImageOps

from .config import settings


def case_dir(case_id: str) -> Path:
    path = settings.files_dir / 'cases' / case_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def zip_path(zip_id: str) -> Path:
    path = settings.files_dir / 'zips'
    path.mkdir(parents=True, exist_ok=True)
    return path / f'{zip_id}.zip'


def rel(path: Path) -> str:
    return str(path.relative_to(settings.files_dir))


def abs_path(relative: str) -> Path:
    return settings.files_dir / relative


def make_preview(data: bytes, max_side: int = 1400) -> bytes | None:
    """A JPEG small enough to send to the phone inside the case. None when the file is not a picture."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert('RGB')
    except Exception:  # noqa: BLE001 - PDF, HEIC or a broken file
        return None
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=82)
    return buf.getvalue()


def data_url(relative: str | None, mime: str = 'image/jpeg') -> str | None:
    if not relative:
        return None
    path = abs_path(relative)
    if not path.exists():
        return None
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()
