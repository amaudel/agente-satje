import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("SATJE_MODE", "fixture")
os.environ.setdefault("SATJE_LIVE_BACKEND", "direct")
os.environ.setdefault("CACHE_DB_PATH", ".pytest_cache/judicial_cache.sqlite3")
