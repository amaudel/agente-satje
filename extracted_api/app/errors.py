from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    SATJE_TIMEOUT = "SATJE_TIMEOUT"
    SATJE_DNS_ERROR = "SATJE_DNS_ERROR"
    SATJE_CONNECTION_ERROR = "SATJE_CONNECTION_ERROR"
    SATJE_TLS_ERROR = "SATJE_TLS_ERROR"
    SATJE_BLOCKED = "SATJE_BLOCKED"
    SATJE_CAPTCHA_REQUIRED = "SATJE_CAPTCHA_REQUIRED"
    SATJE_INVALID_RESPONSE = "SATJE_INVALID_RESPONSE"
    CAUSE_NOT_FOUND = "CAUSE_NOT_FOUND"
    INCIDENT_NOT_FOUND = "INCIDENT_NOT_FOUND"
    ACTUATIONS_NOT_FOUND = "ACTUATIONS_NOT_FOUND"
    DOCUMENT_NOT_FOUND = "DOCUMENT_NOT_FOUND"
    PDF_GENERATION_ERROR = "PDF_GENERATION_ERROR"
    PDF_TEXT_EXTRACTION_ERROR = "PDF_TEXT_EXTRACTION_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


RETRYABLE_CODES = {
    ErrorCode.SATJE_TIMEOUT,
    ErrorCode.SATJE_DNS_ERROR,
    ErrorCode.SATJE_CONNECTION_ERROR,
    ErrorCode.SATJE_TLS_ERROR,
}


DEFAULT_MESSAGES = {
    ErrorCode.VALIDATION_ERROR: "La solicitud no cumple el contrato esperado.",
    ErrorCode.SATJE_TIMEOUT: "SATJE no respondio dentro del tiempo permitido.",
    ErrorCode.SATJE_DNS_ERROR: "No se pudo resolver el dominio de SATJE.",
    ErrorCode.SATJE_CONNECTION_ERROR: "No se pudo conectar con SATJE.",
    ErrorCode.SATJE_TLS_ERROR: "La negociacion TLS con SATJE fallo.",
    ErrorCode.SATJE_BLOCKED: "SATJE rechazo o bloqueo la solicitud.",
    ErrorCode.SATJE_CAPTCHA_REQUIRED: "SATJE requiere validacion CAPTCHA.",
    ErrorCode.SATJE_INVALID_RESPONSE: "SATJE devolvio una respuesta no compatible.",
    ErrorCode.CAUSE_NOT_FOUND: "No se encontraron causas para la consulta.",
    ErrorCode.INCIDENT_NOT_FOUND: "No se encontraron incidentes para el proceso.",
    ErrorCode.ACTUATIONS_NOT_FOUND: "No se encontraron actuaciones para el proceso.",
    ErrorCode.DOCUMENT_NOT_FOUND: "No se encontro el documento solicitado.",
    ErrorCode.PDF_GENERATION_ERROR: "No se pudo generar el PDF.",
    ErrorCode.PDF_TEXT_EXTRACTION_ERROR: "No se pudo extraer texto del PDF.",
    ErrorCode.INTERNAL_ERROR: "Ocurrio un error interno.",
}


@dataclass
class ApiError(Exception):
    code: ErrorCode
    stage: str
    message: str | None = None
    status_code: int = 502
    details: Any = None

    @property
    def retryable(self) -> bool:
        return self.code in RETRYABLE_CODES

    def payload(self, request_id: str) -> dict[str, Any]:
        return {
            "success": False,
            "error": {
                "code": self.code.value,
                "message": self.message or DEFAULT_MESSAGES[self.code],
                "stage": self.stage,
                "retryable": self.retryable,
            },
            "requestId": request_id,
        }
