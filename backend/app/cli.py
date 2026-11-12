"""Operational commands:  python -m app.cli {worker|scheduler|purge|create-admin|openapi}"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time

from .config import get_settings

log = logging.getLogger("sensortrace.cli")


def worker() -> None:
    from rq import Queue, Worker

    from .deps import get_redis
    from .jobs import QUEUE_NAME
    from .storage import get_storage

    get_storage()  # fail fast if storage is misconfigured
    conn = get_redis()
    Worker([Queue(QUEUE_NAME, connection=conn)], connection=conn).work(with_scheduler=True)


def scheduler(interval: int = 3600) -> None:
    """Run retention and expiry purges periodically."""
    from .jobs import purge_expired

    while True:
        try:
            log.info("purge: %s", purge_expired())
        except Exception:
            log.exception("purge failed")
        time.sleep(interval)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("worker", help="run a background job worker")
    sub.add_parser("scheduler", help="run periodic retention purges")
    sub.add_parser("purge", help="run the retention purge once")
    sub.add_parser("openapi", help="print the OpenAPI document")
    a = p.parse_args()
    get_settings()
    if a.cmd == "worker":
        worker()
    elif a.cmd == "scheduler":
        scheduler()
    elif a.cmd == "purge":
        from .jobs import purge_expired

        print(json.dumps(purge_expired()))
    elif a.cmd == "openapi":
        from .main import app

        json.dump(app.openapi(), sys.stdout, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
