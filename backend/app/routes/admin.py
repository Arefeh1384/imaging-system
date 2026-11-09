"""The main admin panel's endpoints. Paths and shapes match frontend/src/api/http.ts and types.ts."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel

from .. import admin, staff
from ..staff import current_admin

router = APIRouter(prefix='/api/v1/admin', tags=['main admin'])


class LoginInput(BaseModel):
    username: str
    password: str


class SplitInput(BaseModel):
    hospitalRial: int
    insuranceRial: int
    managementRial: int


class FeeRuleInput(SplitInput):
    feeRial: int


@router.post('/login')
def login(body: LoginInput):
    session = staff.login(body.username, body.password, role='ADMIN')
    return {'role': 'admin', 'token': session['token'], 'name': session['name']}


@router.get('/overview')
def overview(account: dict = Depends(current_admin)):
    return admin.overview()


@router.get('/companies/{company_id}')
def company(company_id: str, account: dict = Depends(current_admin)):
    return admin.company(company_id)


@router.get('/hospitals/{hospital_id}')
def hospital(hospital_id: str, account: dict = Depends(current_admin)):
    return admin.hospital_detail(hospital_id)


@router.put('/hospitals/{hospital_id}/fee-rule')
def fee_rule(hospital_id: str, body: FeeRuleInput, account: dict = Depends(current_admin)):
    return admin.update_fee_rule(hospital_id, body.model_dump())


@router.get('/zips')
def zips(search: str = Query(default=''), hospitalId: str | None = Query(default=None), group: str = Query(default='all'),  # noqa: N803
         page: int = Query(default=1), pageSize: int = Query(default=10), account: dict = Depends(current_admin)):  # noqa: N803
    return admin.list_zips(search, hospitalId, group, int(page), int(pageSize))


@router.get('/zips/{zip_id}')
def zip_detail(zip_id: str, account: dict = Depends(current_admin)):
    return admin.zip_detail(zip_id)


@router.get('/zips/{zip_id}/file')
def zip_file(zip_id: str, account: dict = Depends(current_admin)):
    data, name = admin.zip_file(zip_id)
    return Response(data, media_type='application/zip', headers={'Content-Disposition': f"attachment; filename*=UTF-8''{quote(name)}"})


@router.put('/zips/{zip_id}/split')
def split(zip_id: str, body: SplitInput, account: dict = Depends(current_admin)):
    return admin.update_split(zip_id, body.model_dump())


@router.post('/zips/{zip_id}/settle')
def settle(zip_id: str, account: dict = Depends(current_admin)):
    return admin.settle(zip_id)


@router.post('/cases/{case_id}/resend-invite')
def resend_invite(case_id: str, account: dict = Depends(current_admin)):
    return admin.resend_invite(case_id)


@router.get('/accounts/staff')
def staff_accounts(role: str = Query(default='INSURANCE_ADMIN'), page: int = Query(default=1), pageSize: int = Query(default=10),  # noqa: N803
                   account: dict = Depends(current_admin)):
    return admin.list_staff(role, int(page), int(pageSize))


@router.get('/accounts/patients')
def patients(search: str = Query(default=''), page: int = Query(default=1), pageSize: int = Query(default=10),  # noqa: N803
             account: dict = Depends(current_admin)):
    return admin.list_patients(search, int(page), int(pageSize))


@router.get('/accounts/access-log')
def access_log(page: int = Query(default=1), pageSize: int = Query(default=10), account: dict = Depends(current_admin)):  # noqa: N803
    return admin.list_access_log(int(page), int(pageSize))


@router.post('/accounts/patients/{patient_id}/view-as')
def view_as_patient(patient_id: str, account: dict = Depends(current_admin)):
    return admin.view_as_patient(account, patient_id)


@router.post('/accounts/staff/{account_id}/view-as')
def view_as_staff(account_id: str, account: dict = Depends(current_admin)):
    return admin.view_as_staff(account, account_id)
