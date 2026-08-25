import json
import logging
import re
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from .metrics import record_metric


logger = logging.getLogger("satje_api")
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
SENSITIVE_FIELD_HINTS = ("cedula", "ruc", "identificacion", "api_key", "apikey", "token", "authorization")
MAX_LOG_STRING_LENGTH = 500


def new_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:16]}"


def set_request_id(request_id: str | None) -> None:
    _request_id.set(request_id)


def current_request_id() -> str | None:
    return _request_id.get()


def mask_cedula(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value)
    if len(text) <= 4:
        return "*" * len(text)
    return f"{text[:4]}**{text[-2:]}"


def _mask_identifier_text(value: str) -> str:
    def mask_match(match: re.Match[str]) -> str:
        text = match.group(0)
        if len(text) <= 4:
            return "*" * len(text)
        return f"{text[:4]}**{text[-2:]}"

    return re.sub(r"\b\d{10}(?:001)?\b", mask_match, value)


def _sanitize_for_log(value: Any, *, key: str | None = None) -> Any:
    normalized_key = (key or "").lower()
    if any(hint in normalized_key for hint in SENSITIVE_FIELD_HINTS):
        return mask_cedula(str(value)) if value is not None else None
    if isinstance(value, str):
        masked = _mask_identifier_text(value)
        if len(masked) > MAX_LOG_STRING_LENGTH:
            return f"{masked[:MAX_LOG_STRING_LENGTH].rstrip()}..."
        return masked
    if isinstance(value, dict):
        if normalized_key in {"actuaciones", "raw", "pagetexts"}:
            return f"<omitted:{len(value)}>"
        return {item_key: _sanitize_for_log(item_value, key=item_key) for item_key, item_value in value.items()}
    if isinstance(value, list):
        if normalized_key in {"actuaciones", "pagetexts"}:
            return f"<omitted:{len(value)}>"
        return [_sanitize_for_log(item) for item in value[:20]]
    return value


def log_event(**fields: Any) -> None:
    clean = {key: _sanitize_for_log(value, key=key) for key, value in fields.items() if value is not None}
    logger.info(json.dumps(clean, ensure_ascii=False, default=str))


@contextmanager
def operation_timer(**fields: Any) -> Iterator[dict[str, Any]]:
    started = time.perf_counter()
    state: dict[str, Any] = {}
    try:
        yield state
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        log_event(**fields, durationMs=duration_ms, status="ok", **state)
        record_metric(
            request_id=fields.get("requestId"),
            endpoint=fields.get("endpoint"),
            stage=fields.get("stage") or fields.get("endpoint") or "operation",
            mode=fields.get("mode"),
            status="ok",
            duration_ms=duration_ms,
            counts={key: value for key, value in state.items() if isinstance(value, int)},
        )
    except Exception as exc:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        log_event(
            **fields,
            durationMs=duration_ms,
            status="error",
            error=exc.__class__.__name__,
            **state,
        )
        record_metric(
            request_id=fields.get("requestId"),
            endpoint=fields.get("endpoint"),
            stage=fields.get("stage") or fields.get("endpoint") or "operation",
            mode=fields.get("mode"),
            status="error",
            duration_ms=duration_ms,
            error_code=getattr(getattr(exc, "code", None), "value", None),
            counts={key: value for key, value in state.items() if isinstance(value, int)},
        )
        raise
