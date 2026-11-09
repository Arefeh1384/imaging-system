"""The backend app. Run:  uvicorn app.main:app --port 8000   (API docs at http://localhost:8000/docs)"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db, review, staff
from .checker import get_checker
from .config import settings
from .errors import ApiError
from .routes import admin, dev, ingest, insurance, pacs_admin, portal
from .worker import Worker

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
log = logging.getLogger('app')


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    staff.ensure_default_account()
    stuck = review.requeue_stuck()
    if stuck:
        log.info('%s case(s) waiting for the check were put back in the queue', stuck)
    log.info('checker: %s, check delay: %ss, demo mode: %s', get_checker().model_version, settings.check_delay_seconds, settings.demo_mode)
    worker = Worker()
    worker.start()
    yield
    worker.stop()


app = FastAPI(title='سامانه تصویربرداری و بیمه', version='0.1.0', lifespan=lifespan,
              description='Backend for the patient and insurance panels: PACS intake, patient sign-in and confirmation, the check that follows, and the insurer\'s view of approved cases.')
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=['*'], allow_headers=['*'])


@app.exception_handler(ApiError)
async def api_error(_: Request, err: ApiError):
    return JSONResponse({'code': err.code, 'message': err.message}, status_code=err.status)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, err: RequestValidationError):
    detail = json.loads(json.dumps(err.errors(), default=str))  # some error details hold values JSON cannot encode
    return JSONResponse({'code': 'VALIDATION', 'message': 'اطلاعات فرستاده‌شده کامل یا درست نیست.', 'detail': detail}, status_code=422)


@app.get('/api/v1/health', tags=['health'])
def health():
    return {'ok': True, 'checker': settings.checker, 'demoMode': settings.demo_mode}


app.include_router(ingest.router)
app.include_router(portal.router)
app.include_router(insurance.router)
app.include_router(pacs_admin.router)
app.include_router(admin.router)
app.include_router(dev.router)
