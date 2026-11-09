"""Where the PACS relay sends ZIPs."""
from __future__ import annotations

from fastapi import APIRouter, File, Header, UploadFile
from fastapi.responses import JSONResponse

from .. import ingest
from ..config import settings
from ..errors import ApiError

router = APIRouter(prefix='/api/v1', tags=['pacs'])

STATUS_CODES = {'READY': 201, 'DUPLICATE': 409, 'REJECTED_TOO_LARGE': 413, 'REJECTED_INCOMPLETE': 422}


@router.post('/ingest')
def receive_zip(file: UploadFile = File(...), x_api_key: str | None = Header(default=None)):
    """Takes one ZIP. 201 with the case ID when accepted; 409, 413 or 422 with the reason when not."""
    if x_api_key != settings.pacs_api_key:
        raise ApiError(401, 'BAD_API_KEY', 'کلید دسترسی PACS درست نیست.')
    result = ingest.receive(file.filename or 'package.zip', file.file.read())
    return JSONResponse(result, status_code=STATUS_CODES.get(result['status'], 200))
