"""The patient panel's endpoints. Paths and shapes match frontend/src/api/http.ts and types.ts."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel

from .. import auth, cases
from ..auth import current_patient

router = APIRouter(prefix='/api/v1/portal', tags=['patient'])


class CodeRequest(BaseModel):
    nationalId: str
    mobile: str


class VerifyRequest(BaseModel):
    challengeId: str
    code: str


class InsuranceInput(BaseModel):
    insurer: str
    policyNumber: str
    relation: str


class ConfirmInput(BaseModel):
    yes: bool


class ERxInput(BaseModel):
    eRxId: str


@router.get('/invites/{token}')
def get_invite(token: str):
    return cases.invite_info(token)


@router.post('/login/code')
def request_code(body: CodeRequest):
    return auth.request_code(body.nationalId, body.mobile)


@router.post('/login/verify')
def verify_code(body: VerifyRequest):
    return auth.verify_code(body.challengeId, body.code)


@router.get('/me')
def get_me(patient: dict = Depends(current_patient)):
    return cases.profile_of(patient)


@router.put('/me/insurance')
def save_insurance(body: InsuranceInput, patient: dict = Depends(current_patient)):
    return cases.save_insurance(patient, body.insurer, body.policyNumber, body.relation)


@router.get('/cases')
def list_cases(patient: dict = Depends(current_patient)):
    return cases.list_cases(patient)


@router.get('/cases/{case_id}')
def get_case(case_id: str, patient: dict = Depends(current_patient)):
    return cases.to_patient_case(cases.my_case(patient, case_id))


@router.put('/cases/{case_id}/documents/{key}')
def upload_document(case_id: str, key: str, file: UploadFile = File(...), patient: dict = Depends(current_patient)):
    data = file.file.read()
    return cases.upload_document(patient, case_id, key, file.filename or 'upload', file.content_type or '', data)


@router.post('/cases/{case_id}/confirm/{key}')
def confirm_item(case_id: str, key: str, body: ConfirmInput, patient: dict = Depends(current_patient)):
    return cases.confirm_item(patient, case_id, key, body.yes)


@router.post('/cases/{case_id}/e-prescription')
def submit_erx(case_id: str, body: ERxInput, patient: dict = Depends(current_patient)):
    return cases.submit_erx(patient, case_id, body.eRxId)


@router.post('/cases/{case_id}/submit')
def submit_case(case_id: str, patient: dict = Depends(current_patient)):
    return cases.submit_case(patient, case_id)
