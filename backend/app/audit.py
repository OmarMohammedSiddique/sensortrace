from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .models import AuditLog


def audit(db: Session, user_id: uuid.UUID | None, action: str, *, entity_type: str = "", entity_id: Any = "",
          investigation_id: uuid.UUID | None = None, ip: str | None = None, **details: Any) -> None:  # fmt: skip
    """Append an audit record. Never store secrets, passwords or image content in ``details``."""
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else "",
            investigation_id=investigation_id,
            ip=ip,
            details=details,
        )
    )
