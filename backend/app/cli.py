"""Operational commands:  python -m app.cli {worker|scheduler|purge|reset-password|openapi}"""

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
    Worker([Queue(QUEUE_NAME, connection=conn)], connection=conn).work()


def scheduler(interval: int = 30) -> None:
    """Reap interrupted jobs every cycle and run retention purges hourly."""
    from .jobs import purge_expired, reap_interrupted

    last_purge = 0.0
    while True:
        try:
            n = reap_interrupted()
            if n:
                log.info("reaped %d interrupted job(s)", n)
            if time.time() - last_purge >= 3600:
                log.info("purge: %s", purge_expired())
                last_purge = time.time()
        except Exception:
            log.exception("maintenance cycle failed")
        time.sleep(interval)


def reset_password(email: str) -> int:
    """Set a new password for an account and revoke all of its sessions and API tokens."""
    import getpass

    from sqlalchemy import select, update

    from .audit import audit
    from .db import session_scope
    from .models import ApiToken, AuthSession, User, utcnow
    from .security import hash_password, password_problem

    with session_scope() as db:
        user = db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None:
            print("No such account.", file=sys.stderr)
            return 1
        new = getpass.getpass("New password: ")
        if new != getpass.getpass("Repeat: "):
            print("Passwords do not match.", file=sys.stderr)
            return 1
        problem = password_problem(new, user.email)
        if problem:
            print(problem, file=sys.stderr)
            return 1
        user.password_hash = hash_password(new)
        now = utcnow()
        db.execute(update(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)).values(revoked_at=now))
        db.execute(update(ApiToken).where(ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None)).values(revoked_at=now))
        audit(db, user.id, "account.password_reset_by_operator")
    print("Password updated; sessions and API tokens revoked.")
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("worker", help="run a background job worker")
    sub.add_parser("scheduler", help="run periodic retention purges")
    sub.add_parser("purge", help="run the retention purge once")
    sub.add_parser("openapi", help="print the OpenAPI document")
    rp = sub.add_parser("reset-password", help="set a new password for an account (operator action)")
    rp.add_argument("email")
    a = p.parse_args()
    get_settings()
    if a.cmd == "worker":
        worker()
    elif a.cmd == "scheduler":
        scheduler()
    elif a.cmd == "purge":
        from .jobs import purge_expired

        print(json.dumps(purge_expired()))
    elif a.cmd == "reset-password":
        return reset_password(a.email)
    elif a.cmd == "openapi":
        from .main import app

        json.dump(app.openapi(), sys.stdout, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
