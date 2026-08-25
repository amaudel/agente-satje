import json
import sqlite3
import time
from pathlib import Path
from statistics import mean
from typing import Any

from .config import settings


def _db_path() -> Path:
    path = Path(settings.metrics_db_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent.parent / path
    return path


def init_metrics() -> None:
    with sqlite3.connect(_db_path()) as conn:
        conn.execute(
            """
            create table if not exists operation_metrics (
                id integer primary key autoincrement,
                created_at integer not null,
                request_id text,
                endpoint text,
                stage text not null,
                mode text,
                backend text,
                status text not null,
                duration_ms real,
                error_code text,
                retry_count integer default 0,
                counts_json text not null default '{}',
                meta_json text not null default '{}'
            )
            """
        )


def record_metric(
    *,
    request_id: str | None,
    stage: str,
    status: str,
    duration_ms: float | None = None,
    endpoint: str | None = None,
    mode: str | None = None,
    backend: str | None = None,
    error_code: str | None = None,
    retry_count: int = 0,
    counts: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    init_metrics()
    safe_meta = {
        key: value
        for key, value in (meta or {}).items()
        if "token" not in key.lower() and "key" not in key.lower() and "secret" not in key.lower()
    }
    with sqlite3.connect(_db_path()) as conn:
        conn.execute(
            """
            insert into operation_metrics (
                created_at, request_id, endpoint, stage, mode, backend, status,
                duration_ms, error_code, retry_count, counts_json, meta_json
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(time.time()),
                request_id,
                endpoint,
                stage,
                mode,
                backend,
                status,
                duration_ms,
                error_code,
                retry_count,
                json.dumps(counts or {}, ensure_ascii=False),
                json.dumps(safe_meta, ensure_ascii=False, default=str),
            ),
        )


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((percentile / 100) * (len(ordered) - 1)))))
    return round(ordered[index], 2)


def summarize_metrics(since_seconds: int = 86400) -> dict[str, Any]:
    init_metrics()
    since = int(time.time()) - since_seconds
    with sqlite3.connect(_db_path()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            select * from operation_metrics
            where created_at >= ?
            order by created_at asc
            """,
            (since,),
        ).fetchall()

    by_stage: dict[str, dict[str, Any]] = {}
    for row in rows:
        stage = row["stage"]
        bucket = by_stage.setdefault(
            stage,
            {"total": 0, "success": 0, "failure": 0, "timeouts": 0, "durations": []},
        )
        bucket["total"] += 1
        if row["status"] == "ok":
            bucket["success"] += 1
        else:
            bucket["failure"] += 1
        if row["error_code"] == "SATJE_TIMEOUT":
            bucket["timeouts"] += 1
        if row["duration_ms"] is not None:
            bucket["durations"].append(float(row["duration_ms"]))

    stages: dict[str, Any] = {}
    for stage, bucket in by_stage.items():
        durations = bucket.pop("durations")
        stages[stage] = {
            **bucket,
            "avgMs": round(mean(durations), 2) if durations else None,
            "p95Ms": _percentile(durations, 95),
        }

    return {
        "windowSeconds": since_seconds,
        "totalEvents": len(rows),
        "stages": stages,
    }
