from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_Session: sessionmaker[Session] | None = None


def get_engine():
    global _engine, _Session
    if _engine is None:
        _engine = create_engine(
            get_settings().database_url,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=10,
        )
        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine, _Session = None, None


def get_db() -> Iterator[Session]:
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
