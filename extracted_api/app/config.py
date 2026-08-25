from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEMO_API_KEY = "demo-key-change-me"


class Settings(BaseSettings):
    api_keys: str = DEMO_API_KEY
    ops_api_keys: str = ""
    satje_mode: str = "fixture"
    source_base_url: str = "https://api.funcionjudicial.gob.ec"
    source_detail_payload_json: str | None = None
    cors_allowed_origins: str = ""
    docs_enabled: bool = True
    satje_max_pages: int = 10
    satje_page_size: int = 10
    cache_ttl_seconds: int = 300
    cache_db_path: str = "judicial_cache.sqlite3"
    request_timeout_seconds: int = 20
    satje_live_backend: str = "direct"
    satje_connector_actor_id: str = ""
    satje_connector_api_token: str = ""
    satje_connector_internal_token: str = ""
    satje_lambda_function_url: str = ""
    satje_lambda_api_token: str = ""
    satje_cloudflare_worker_url: str = ""
    satje_cloudflare_api_token: str = ""
    satje_connector_timeout_seconds: int = 120
    satje_connector_max_concurrency: int = 2
    satje_connector_retry_attempts: int = 2
    satje_connector_backoff_seconds: float = 1.0
    satje_circuit_failure_threshold: int = 5
    satje_circuit_reset_seconds: int = 300
    metrics_db_path: str = "satje_ops.sqlite3"
    pdf_text_max_bytes: int = 26_214_400
    pdf_text_ocr_enabled: bool = True
    pdf_text_ocr_max_pages: int = 30
    pdf_text_ocr_dpi: int = 200
    pdf_text_ocr_lang: str = "spa+eng"
    pdf_text_extraction_timeout_seconds: int = 120

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_api_keys(self) -> set[str]:
        return {key.strip() for key in self.api_keys.split(",") if key.strip()}

    @property
    def allowed_ops_api_keys(self) -> set[str]:
        return {key.strip() for key in self.ops_api_keys.split(",") if key.strip()}

    @property
    def effective_satje_mode(self) -> str:
        return self.satje_mode.strip().lower()

    @property
    def effective_satje_live_backend(self) -> str:
        return self.satje_live_backend.strip().lower()

    @property
    def allowed_cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def _prevent_demo_key_in_live_mode(self) -> "Settings":
        if self.effective_satje_mode in {"live", "official"}:
            keys = self.allowed_api_keys
            if not keys or DEMO_API_KEY in keys:
                raise ValueError(
                    "SATJE_MODE=live/official requiere API_KEYS configurado con una clave real; "
                    f"no puede quedar vacio ni usar el valor de ejemplo '{DEMO_API_KEY}'."
                )
        return self


settings = Settings()
