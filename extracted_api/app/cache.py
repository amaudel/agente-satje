import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .config import settings

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# A2: conexiones SQLite sincronicas sin busy_timeout/WAL pueden lanzar
# "database is locked" bajo concurrencia real y convertirse en HTTP 500.
# SQLITE_TIMEOUT_MS = 5000 hace que sqlite espere en vez de fallar; la
# inicializacion del esquema se hace una sola vez por proceso (guardo).
SQLITE_TIMEOUT_MS = 5000
_SCHEMA_READY = False


def _db_path() -> Path:
    path = Path(settings.cache_db_path)
    if path.is_absolute():
        return path
    return PROJECT_ROOT / path


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=SQLITE_TIMEOUT_MS / 1000)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA busy_timeout={SQLITE_TIMEOUT_MS}")
    return conn


def init_cache() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    db_path = _db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            create table if not exists cache (
                cache_key text primary key,
                payload text not null,
                created_at integer not null
            )
            """
        )
    _SCHEMA_READY = True


def get_cached(cache_key: str) -> Any | None:
    # A2: si el cache falla (DB bloqueada/corrupta), tratarlo como cache-miss
    # y devolver None en vez de romper el request con un 500.
    try:
        init_cache()
        with _connect() as conn:
            row = conn.execute(
                "select payload, created_at from cache where cache_key = ?",
                (cache_key,),
            ).fetchone()
        if not row:
            return None

        payload, created_at = row
        if int(time.time()) - int(created_at) > settings.cache_ttl_seconds:
            return None
        return json.loads(payload)
    except (sqlite3.Error, ValueError, OSError):
        return None


def set_cached(cache_key: str, payload: Any) -> None:
    # A2: escribir en cache nunca debe romper el request principal.
    try:
        init_cache()
        with _connect() as conn:
            conn.execute(
                """
                insert into cache (cache_key, payload, created_at)
                values (?, ?, ?)
                on conflict(cache_key) do update set
                    payload = excluded.payload,
                    created_at = excluded.created_at
                """,
                (cache_key, json.dumps(payload, ensure_ascii=False), int(time.time())),
            )
    except (sqlite3.Error, ValueError, OSError):
        return
