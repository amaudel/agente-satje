import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .config import settings

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _db_path() -> Path:
    path = Path(settings.cache_db_path)
    if path.is_absolute():
        return path
    return PROJECT_ROOT / path


def init_cache() -> None:
    db_path = _db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            create table if not exists cache (
                cache_key text primary key,
                payload text not null,
                created_at integer not null
            )
            """
        )


def get_cached(cache_key: str) -> Any | None:
    init_cache()
    with sqlite3.connect(_db_path()) as conn:
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


def set_cached(cache_key: str, payload: Any) -> None:
    init_cache()
    with sqlite3.connect(_db_path()) as conn:
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
