"""A background thread that runs the check on cases whose waiting time is over."""
from __future__ import annotations

import logging
import threading

from . import review
from .config import settings

log = logging.getLogger('worker')


class Worker:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name='review-worker', daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                for case_id in review.due_cases():
                    if review.claim(case_id):
                        try:
                            log.info('case %s: %s', case_id, review.run(case_id))
                        except Exception as err:  # noqa: BLE001 - an unexpected error must not leave the case stuck
                            log.exception('case %s failed', case_id)
                            review.retry_later(case_id, str(err))
            except Exception:  # noqa: BLE001 - keep the worker alive whatever happens
                log.exception('worker round failed')
            self._stop.wait(settings.worker_interval_seconds)
