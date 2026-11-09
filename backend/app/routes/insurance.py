"""The insurance panel's endpoints. Paths and shapes match frontend/src/api/http.ts and types.ts."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .. import insurance, staff
from ..staff import current_insurer

router = APIRouter(prefix='/api/v1', tags=['insurance'])


class LoginInput(BaseModel):
    username: str
    password: str


@router.post('/insurance/login')
def login(body: LoginInput):
    return staff.login(body.username, body.password)


@router.get('/insurance/dashboard')
def dashboard(account: dict = Depends(current_insurer)):
    return insurance.dashboard()


@router.get('/insurance/cases')
def list_cases(hospitalId: str | None = Query(default=None), page: int = Query(default=1), pageSize: int = Query(default=10),  # noqa: N803
               account: dict = Depends(current_insurer)):
    return insurance.list_cases(hospitalId, int(page), int(pageSize))


@router.get('/insurance/cases/{case_id}')
def get_case(case_id: str, account: dict = Depends(current_insurer)):
    return insurance.case_record(case_id)


@router.get('/imaging/cases/{case_id}/images')
def study_images(case_id: str, account: dict = Depends(current_insurer)):
    return insurance.study_images(case_id)
