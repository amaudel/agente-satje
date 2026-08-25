from typing import Any

from pydantic import BaseModel, Field


class Juicio(BaseModel):
    id_juicio: str = Field(..., examples=["01283-2024-00123"])
    numero_proceso: str
    judicatura: str | None = None
    materia: str | None = None
    accion: str | None = None
    actor: str | None = None
    demandado: str | None = None
    fecha_ingreso: str | None = None
    estado: str | None = None
    fuente: str = "funcion_judicial_ec"
    raw: dict[str, Any] | None = None


class JuicioDetalle(BaseModel):
    juicio: Juicio
    actuaciones: list[dict[str, Any]] = Field(default_factory=list)


class JuiciosResumen(BaseModel):
    identificacion: str
    total: int
    activos: int
    finalizados: int
    riesgo: str
    mensajes: list[str] = Field(default_factory=list)
