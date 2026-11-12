from __future__ import annotations

from typing import Any


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.details = (
            status,
            code,
            message,
            details,
        )


def not_found(what: str = "Resource") -> ApiError:
    return ApiError(404, "not_found", f"{what} not found.")


def bad_request(code: str, message: str, details: Any = None) -> ApiError:
    return ApiError(400, code, message, details)


def conflict(code: str, message: str) -> ApiError:
    return ApiError(409, code, message)
