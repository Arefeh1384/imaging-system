"""Checks that the AI service answers with the current settings, before any case depends on it.

Run with Docker running:   docker compose exec backend python -m app.checker.ping
"""
from __future__ import annotations

import sys

from ..config import settings
from .base import CheckerUnavailable


def _openrouter() -> str:
    from .openrouter import post

    # Room for models that think before answering; still far below what any credit check would refuse.
    from .openrouter import model_fields

    answer = post({**model_fields(), 'messages': [{'role': 'user', 'content': 'Reply with the single word: OK'}], 'temperature': 0, 'max_tokens': 400}, timeout=60)
    picked = answer.get('model') or settings.openrouter_model
    if picked != settings.openrouter_model:
        print(f'OpenRouter used: {picked}')
    choice = answer['choices'][0]
    text = (choice['message'].get('content') or '').strip()
    if not text:
        raise CheckerUnavailable(f'connected, but {picked} gave no answer (finish reason: {choice.get("finish_reason")}). '
                                 'Run the test again, or choose a specific model in OPENROUTER_MODEL.')
    return text


def _gemini() -> str:
    from .gemini import call_gemini

    answer = call_gemini({'contents': [{'role': 'user', 'parts': [{'text': 'Reply with the single word: OK'}]}], 'generationConfig': {'temperature': 0}}, timeout=30)
    return answer['candidates'][0]['content']['parts'][0]['text'].strip()


def main() -> int:
    which = settings.checker if settings.checker in ('openrouter', 'gemini') else ('openrouter' if settings.openrouter_api_key else 'gemini')
    key = settings.openrouter_api_key if which == 'openrouter' else settings.gemini_api_key
    model = settings.openrouter_model if which == 'openrouter' else settings.gemini_model
    print(f'Service: {which}, model: {model}')
    if not key:
        print(f"The {'OPENROUTER_API_KEY' if which == 'openrouter' else 'GEMINI_API_KEY'} is empty. Put the key in .env and run: docker compose up -d")
        return 1
    try:
        text = _openrouter() if which == 'openrouter' else _gemini()
    except CheckerUnavailable as err:
        print(f'FAILED: {err}')
        return 1
    except (KeyError, IndexError, TypeError) as err:
        print(f'FAILED: unexpected answer shape ({err})')
        return 1
    print(f'The model answered: {text}')
    if settings.checker == which:
        print('It works. Cases will be checked by this model.')
    else:
        print(f'It works, but CHECKER is "{settings.checker}". Set CHECKER={which} in .env to use it for cases.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
