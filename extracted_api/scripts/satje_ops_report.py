#!/usr/bin/env python3
import json
from pathlib import Path
from statistics import mean
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LOG_PATH = ROOT / "artifacts" / "satje-stability.jsonl"


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, round((pct / 100) * (len(ordered) - 1)))
    return round(ordered[index], 2)


def main() -> None:
    rows: list[dict[str, Any]] = []
    if LOG_PATH.exists():
        rows = [json.loads(line) for line in LOG_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]

    checks: dict[str, dict[str, Any]] = {}
    for row in rows:
        for name, check in row.get("checks", {}).items():
            bucket = checks.setdefault(name, {"total": 0, "success": 0, "failure": 0, "timeouts": 0, "durations": []})
            bucket["total"] += 1
            bucket["success" if check.get("ok") else "failure"] += 1
            if check.get("error") in {"TimeoutException", "ReadTimeout", "ConnectTimeout"}:
                bucket["timeouts"] += 1
            if isinstance(check.get("durationMs"), (int, float)):
                bucket["durations"].append(float(check["durationMs"]))

    summary: dict[str, Any] = {
        "samples": len(rows),
        "firstRunAt": rows[0]["ranAt"] if rows else None,
        "lastRunAt": rows[-1]["ranAt"] if rows else None,
        "checks": {},
    }
    for name, bucket in checks.items():
        durations = bucket.pop("durations")
        summary["checks"][name] = {
            **bucket,
            "avgMs": round(mean(durations), 2) if durations else None,
            "p95Ms": percentile(durations, 95),
        }

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
