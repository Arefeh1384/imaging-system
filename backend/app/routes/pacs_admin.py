"""The PACS admin panel's endpoints. Paths and shapes match frontend/src/api/http.ts and types.ts."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .. import pacs_admin, staff
from ..staff import current_pacs_admin

router = APIRouter(prefix='/api/v1/pacs-admin', tags=['pacs admin'])


class LoginInput(BaseModel):
    username: str
    password: str


@router.post('/login')
def login(body: LoginInput):
    session = staff.login(body.username, body.password, role='PACS_ADMIN')
    return {'token': session['token'], 'name': session['name']}


@router.get('/volume')
def volume(period: str = Query(default='30d'), account: dict = Depends(current_pacs_admin)):
    """How many ZIPs each medical center sent in the period: today, 7d, 30d or all."""
    return pacs_admin.volume(period)
