"""Picks the checker from CHECKER: 'fake' (default), 'openrouter' or 'gemini'."""
from __future__ import annotations

import logging

from ..config import settings
from .base import CheckerUnavailable, CheckInput, CheckResult, Document  # noqa: F401
from .fake import FakeChecker

log = logging.getLogger('checker')


def get_checker():
    if settings.checker == 'openrouter':
        if settings.openrouter_api_key:
            from .openrouter import OpenRouterChecker

            return OpenRouterChecker()
        log.warning('CHECKER=openrouter but OPENROUTER_API_KEY is empty: using the fake checker.')
    if settings.checker == 'gemini':
        if settings.gemini_api_key:
            from .gemini import GeminiChecker

            return GeminiChecker()
        log.warning('CHECKER=gemini but GEMINI_API_KEY is empty: using the fake checker.')
    return FakeChecker()
