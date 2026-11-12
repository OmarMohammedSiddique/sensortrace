from __future__ import annotations

import asyncio
import weakref
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_Session: sessionmaker[Session] | None = None

POOL_SIZE = 10
POOL_OVERFLOW = 10
#: Requests allowed to hold a database session at once. It must stay below both the connection
#: pool (so a request never waits for a connection) and the 40-thread worker pool. Without the
#: bound, a burst of requests filled every worker thread with requests waiting for a connection
#: while the requests holding the connections waited for a worker thread: the whole API stalled
#: for the pool timeout and then failed.
DB_CONCURRENCY = POOL_SIZE + POOL_OVERFLOW - 4

_gates: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = weakref.WeakKeyDictionary()


def db_gate() -> asyncio.Semaphore:
    """The semaphore that bounds concurrent database use for the running event loop."""
    loop = asyncio.get_running_loop()
    gate = _gates.get(loop)
    if gate is None:
        gate = _gates[loop] = asyncio.Semaphore(DB_CONCURRENCY)
    return gate


def get_engine():
    global _engine, _Session
    if _engine is None:
        _engine = create_engine(
            get_settings().database_url,
            pool_pre_ping=True,
            pool_size=POOL_SIZE,
            max_overflow=POOL_OVERFLOW,
        )
        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine, _Session = None, None


async def _db_slot() -> AsyncIterator[None]:
    # Waiting happens on the event loop, so queued requests cost neither a thread nor a connection.
    async with db_gate():
        yield


def get_db(_slot: Annotated[None, Depends(_db_slot)]) -> Iterator[Session]:
    get_engine()
    assert _Session is not None
    with _Session() as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    assert _Session is not None
    with _Session() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
