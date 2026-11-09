"""Errors in the shape the frontend reads: {"code": "...", "message": "..."}. Messages are Persian, for the patient."""
from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found(message: str = 'این پرونده پیدا نشد.') -> ApiError:
    return ApiError(404, 'NOT_FOUND', message)


def unauthorized() -> ApiError:
    return ApiError(401, 'UNAUTHORIZED', 'لطفاً دوباره وارد شوید.')


def not_open() -> ApiError:
    return ApiError(409, 'NOT_OPEN', 'این پرونده الان قابل تغییر نیست.')
