"""Settings, read once from environment variables. docker-compose.yml and .env set them."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')


def _list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(',') if item.strip()]


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get('DATA_DIR', './data')).resolve())
    # Demo mode returns the one-time code in the response and turns on /api/v1/dev. Never on a real server.
    demo_mode: bool = field(default_factory=lambda: _bool('DEMO_MODE', True))
    pacs_api_key: str = field(default_factory=lambda: os.environ.get('PACS_API_KEY', 'dev-pacs-key'))
    sms_gateway_url: str = field(default_factory=lambda: os.environ.get('SMS_GATEWAY_URL', 'http://localhost:8001/sms/api/send'))
    erx_service_url: str = field(default_factory=lambda: os.environ.get('ERX_SERVICE_URL', 'http://localhost:8001/erx/api/prescriptions'))
    portal_url: str = field(default_factory=lambda: os.environ.get('PORTAL_URL', 'http://localhost:8080').rstrip('/'))
    # How long after the patient's «تأیید» the check runs. The real service waits 30 to 60 minutes.
    check_delay_seconds: int = field(default_factory=lambda: int(os.environ.get('CHECK_DELAY_SECONDS', '60')))
    # How long to wait before trying again when the AI service refused or failed.
    check_retry_seconds: int = field(default_factory=lambda: int(os.environ.get('CHECK_RETRY_SECONDS', '300')))
    checker: str = field(default_factory=lambda: os.environ.get('CHECKER', 'fake').strip().lower())
    # OpenRouter: one key for many models. Gemini through OpenRouter is the default AI checker.
    openrouter_api_key: str = field(default_factory=lambda: os.environ.get('OPENROUTER_API_KEY', '').strip())
    openrouter_model: str = field(default_factory=lambda: os.environ.get('OPENROUTER_MODEL', 'google/gemini-2.5-flash').strip())
    # The longest answer the model may write. Without a limit, OpenRouter reserves the model's maximum against your credit.
    openrouter_max_tokens: int = field(default_factory=lambda: int(os.environ.get('OPENROUTER_MAX_TOKENS', '3000')))
    openrouter_base_url: str = field(default_factory=lambda: os.environ.get('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1').rstrip('/'))
    # Direct Gemini API, kept as an alternative (CHECKER=gemini).
    gemini_api_key: str = field(default_factory=lambda: os.environ.get('GEMINI_API_KEY', '').strip())
    gemini_model: str = field(default_factory=lambda: os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash').strip())
    gemini_base_url: str = field(default_factory=lambda: os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').rstrip('/'))
    # The insurance panel's first account, made at start-up if it doesn't exist yet. Change the password in .env.
    insurance_username: str = field(default_factory=lambda: os.environ.get('INSURANCE_USERNAME', 'dana-admin').strip())
    insurance_password: str = field(default_factory=lambda: os.environ.get('INSURANCE_PASSWORD', 'dana1234'))
    insurance_name: str = field(default_factory=lambda: os.environ.get('INSURANCE_NAME', 'کارشناس بیمه دانا').strip())
    # The PACS admin panel's first account: sees how much each medical center sent, nothing about patients.
    pacs_admin_username: str = field(default_factory=lambda: os.environ.get('PACS_ADMIN_USERNAME', 'pacs-admin').strip())
    pacs_admin_password: str = field(default_factory=lambda: os.environ.get('PACS_ADMIN_PASSWORD', 'pacs1234'))
    pacs_admin_name: str = field(default_factory=lambda: os.environ.get('PACS_ADMIN_NAME', 'مدیر PACS').strip())
    # The main admin's first account: every company, hospital, ZIP, case, fee and account.
    admin_username: str = field(default_factory=lambda: os.environ.get('ADMIN_USERNAME', 'admin').strip())
    admin_password: str = field(default_factory=lambda: os.environ.get('ADMIN_PASSWORD', 'admin1234'))
    admin_name: str = field(default_factory=lambda: os.environ.get('ADMIN_NAME', 'مدیر کل').strip())
    max_zip_mb: int = field(default_factory=lambda: int(os.environ.get('MAX_ZIP_MB', '300')))
    cors_origins: list[str] = field(default_factory=lambda: _list('CORS_ORIGINS', 'http://localhost:5173,http://localhost:8080'))
    worker_interval_seconds: float = field(default_factory=lambda: float(os.environ.get('WORKER_INTERVAL_SECONDS', '5')))

    @property
    def db_path(self) -> Path:
        return self.data_dir / 'imaging.db'

    @property
    def files_dir(self) -> Path:
        return self.data_dir / 'files'


settings = Settings()
