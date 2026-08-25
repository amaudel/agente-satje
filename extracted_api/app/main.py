import time
from typing import Any

from pydantic import BaseModel, Field
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .cache import get_cached, set_cached
from .config import settings
from .errors import ApiError, ErrorCode
from .metrics import record_metric, summarize_metrics
from .observability import current_request_id, new_request_id
from .pdf_report import build_juicio_pdf, build_resumen_pdf
from .satje_agent import SatjeAgent
from .schemas import Juicio, JuicioDetalle, JuiciosResumen
from .services import SatjeService
from .satje_client import get_satje_client
from .source import SourceUnavailable, buscar_juicios, obtener_detalle, obtener_detalle_por_payload

app = FastAPI(
    title="Ecuador Judicial API",
    version="1.1.0",
    description="API comercial para consultas puntuales de procesos judiciales de Ecuador.",
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

if settings.allowed_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key"],
        max_age=600,
    )


class BuscarCausasRequest(BaseModel):
    cedula: str = Field(..., min_length=1)
    roles: list[str] = Field(default_factory=lambda: ["actor", "demandado"])
    incluirTodasLasPaginas: bool = True


class DocumentHbaTextRequest(BaseModel):
    documentoId: str | None = Field(default=None, min_length=1)
    code: str | None = Field(default=None, min_length=1)


class SatjeAgentRequest(BaseModel):
    query: str = Field(..., min_length=1)
    tipoBusqueda: str | None = Field(default="auto")
    incluirActuaciones: bool = True
    maxActuaciones: int = Field(default=5, ge=1, le=20)


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    request_id = current_request_id() or new_request_id()
    return JSONResponse(status_code=exc.status_code, content=exc.payload(request_id))


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    request_id = current_request_id() or new_request_id()
    code = "HTTP_ERROR"
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        code = "UNAUTHORIZED"
    elif exc.status_code == status.HTTP_403_FORBIDDEN:
        code = "FORBIDDEN"
    elif exc.status_code == status.HTTP_404_NOT_FOUND:
        code = "NOT_FOUND"
    elif exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        code = "RATE_LIMITED"
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": code,
                "message": str(exc.detail),
                "stage": "http",
                "retryable": exc.status_code in {429, 502, 503, 504},
            },
            "requestId": request_id,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = new_request_id()
    error = ApiError(
        ErrorCode.VALIDATION_ERROR,
        "request_validation",
        message="La solicitud no cumple el contrato esperado.",
        status_code=422,
        details=exc.errors(),
    )
    payload = error.payload(request_id)
    payload["error"]["details"] = exc.errors()
    return JSONResponse(status_code=422, content=payload)


def _is_proceso_activo(juicio: Juicio) -> bool:
    return (juicio.estado or "").strip().lower() not in {"finalizado", "archivado"}


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not x_api_key or x_api_key not in settings.allowed_api_keys:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key invalida",
        )


def require_ops_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not x_api_key or x_api_key not in settings.allowed_ops_api_keys:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere API key operativa",
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/satje")
async def health_satje(_: None = Depends(require_ops_api_key)) -> dict[str, Any]:
    client = get_satje_client()
    result = await client.healthcheck()
    return {
        "status": "ok" if result.get("available") else "degraded",
        "internal": "ok",
        "satje": result,
        "satje_mode": settings.effective_satje_mode,
    }


@app.post("/api/v1/agent/satje")
async def api_v1_satje_agent(
    payload: SatjeAgentRequest,
    _: None = Depends(require_api_key),
) -> dict[str, Any]:
    return await SatjeAgent().run(
        payload.query,
        tipo_busqueda=payload.tipoBusqueda,
        incluir_actuaciones=payload.incluirActuaciones,
        max_actuaciones=payload.maxActuaciones,
        request_id=new_request_id(),
    )


async def get_juicios_cached(identificacion: str) -> list[Juicio]:
    cache_key = f"juicios:{identificacion}"
    cached = get_cached(cache_key)
    if cached is not None:
        return [Juicio.model_validate(item) for item in cached]

    try:
        juicios = await buscar_juicios(identificacion)
    except SourceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    payload = [juicio.model_dump() for juicio in juicios]
    set_cached(cache_key, payload)
    return juicios


@app.get("/api/juicios/{identificacion}", response_model=list[Juicio])
async def api_juicios(
    identificacion: str,
    _: None = Depends(require_api_key),
) -> list[Juicio]:
    return await get_juicios_cached(identificacion)


@app.post("/api/v1/causas/buscar")
async def api_v1_buscar_causas(
    payload: BuscarCausasRequest,
    _: None = Depends(require_api_key),
) -> dict[str, Any]:
    request_id = new_request_id()
    roles = [role for role in payload.roles if role in {"actor", "demandado"}]
    return await SatjeService().buscar_causas_por_cedula(
        payload.cedula,
        roles=roles or ["actor", "demandado"],
        incluir_todas_las_paginas=payload.incluirTodasLasPaginas,
        request_id=request_id,
    )


@app.get("/api/v1/causas/{id_juicio}/actuaciones")
async def api_v1_causa_actuaciones(
    id_juicio: str,
    _: None = Depends(require_api_key),
) -> dict[str, Any]:
    return await SatjeService().actuaciones_por_juicio(id_juicio, request_id=new_request_id())


@app.get("/api/v1/causas/{id_juicio}/actuaciones/paginadas")
async def api_v1_causa_actuaciones_paginadas(
    id_juicio: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50, alias="pageSize"),
    orden: str = Query(default="desc", pattern="^(asc|desc)$"),
    fecha_desde: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", alias="fechaDesde"),
    fecha_hasta: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", alias="fechaHasta"),
    tipo: str | None = Query(default=None, min_length=1),
    tiene_documento: bool | None = Query(default=None, alias="tieneDocumento"),
    _: None = Depends(require_api_key),
) -> dict[str, Any]:
    return await SatjeService().actuaciones_paginadas_por_juicio(
        id_juicio,
        page=page,
        page_size=page_size,
        orden=orden,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        tipo=tipo,
        tiene_documento=tiene_documento,
        request_id=new_request_id(),
    )


@app.get("/api/v1/causas/{id_juicio}/resoluciones")
async def api_v1_causa_resoluciones(
    id_juicio: str,
    limit: int = Query(default=20, ge=1, le=50),
    fecha_desde: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", alias="fechaDesde"),
    fecha_hasta: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", alias="fechaHasta"),
    incluir_sin_documento: bool = Query(default=True, alias="incluirSinDocumento"),
    _: None = Depends(require_api_key),
) -> dict[str, Any]:
    return await SatjeService().resoluciones_por_juicio(
        id_juicio,
        limit=limit,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        incluir_sin_documento=incluir_sin_documento,
        request_id=new_request_id(),
    )


@app.get("/api/v1/causas/{id_juicio}/actuaciones/{codigo_actuacion}/documentos")
async def api_v1_causa_actuacion_documentos(
    id_juicio: str,
    codigo_actuacion: str,
    _: None = Depends(require_api_key),
) -> dict[str, Any]:
    return await SatjeService().documentos_hba_por_actuacion(
        id_juicio,
        codigo_actuacion,
        request_id=new_request_id(),
    )


@app.get("/api/v1/causas/{id_juicio}/abandono/riesgo")
async def api_v1_causa_abandono_riesgo(
    id_juicio: str,
    fecha_corte: str | None = Query(default=None, alias="fechaCorte"),
    alerta_dias: int = Query(default=30, ge=1, le=180, alias="alertaDias"),
    _: None = Depends(require_api_key),
) -> dict[str, Any]:
    return await SatjeService().riesgo_abandono_por_juicio(
        id_juicio,
        fecha_corte=fecha_corte,
        alerta_dias=alerta_dias,
        request_id=new_request_id(),
    )


@app.post("/api/v1/causas/{id_juicio}/pdf")
async def api_v1_causa_pdf(
    id_juicio: str,
    _: None = Depends(require_api_key),
) -> Response:
    request_id = new_request_id()
    detalle, result = await SatjeService().detalle_para_pdf(id_juicio, request_id=request_id)
    filename = f"expel_{result['idJuicio']}_{result['retrievedAt'][:10]}.pdf"
    started = time.perf_counter()
    pdf_bytes = build_juicio_pdf(detalle)
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    record_metric(
        request_id=result["requestId"],
        endpoint="/api/v1/causas/{idJuicio}/pdf",
        stage="pdfGeneration",
        mode=result.get("mode"),
        status="ok",
        duration_ms=duration_ms,
        counts={
            "incidentes": result.get("totalIncidentes", 0),
            "actuaciones": result.get("totalActuaciones", 0),
            "bytes": len(pdf_bytes),
        },
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Request-Id": result["requestId"],
            "X-PDF-Duration-Ms": str(duration_ms),
        },
    )


@app.post("/api/v1/documentos/hba/extract-text")
async def api_v1_document_hba_extract_text(
    payload: DocumentHbaTextRequest,
    _: None = Depends(require_api_key),
) -> dict[str, Any]:
    document_reference = payload.documentoId or payload.code
    if not document_reference:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "documentHba",
            message="Debe enviar documentoId. El campo code queda solo para compatibilidad interna.",
            status_code=422,
        )
    return await SatjeService().extraer_texto_documento_hba(document_reference, request_id=new_request_id())


@app.get("/api/v1/ops/metrics")
async def api_v1_ops_metrics(
    since_seconds: int = 86400,
    _: None = Depends(require_ops_api_key),
) -> dict[str, Any]:
    return summarize_metrics(since_seconds=since_seconds)


@app.get("/api/juicio/{id_juicio}", response_model=JuicioDetalle)
async def api_juicio(
    id_juicio: str,
    _: None = Depends(require_api_key),
) -> JuicioDetalle:
    return await get_juicio_detalle_cached(id_juicio)


@app.post("/api/juicio", response_model=JuicioDetalle)
async def api_juicio_payload(
    payload: dict[str, Any] = Body(...),
    _: None = Depends(require_api_key),
) -> JuicioDetalle:
    try:
        return await obtener_detalle_por_payload(payload)
    except SourceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/juicio/actuaciones")
async def api_juicio_actuaciones_payload(
    payload: dict[str, Any] = Body(...),
    _: None = Depends(require_api_key),
) -> list[dict[str, Any]]:
    try:
        detalle = await obtener_detalle_por_payload(payload)
    except SourceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return detalle.actuaciones


async def get_juicio_detalle_cached(id_juicio: str) -> JuicioDetalle:
    cache_key = f"juicio:{id_juicio}"
    cached = get_cached(cache_key)
    if cached is not None:
        return JuicioDetalle.model_validate(cached)

    detalle = await obtener_detalle(id_juicio)
    set_cached(cache_key, detalle.model_dump())
    return detalle


async def build_juicios_resumen(identificacion: str) -> JuiciosResumen:
    juicios = await get_juicios_cached(identificacion)
    activos = sum(1 for juicio in juicios if _is_proceso_activo(juicio))
    finalizados = len(juicios) - activos

    mensajes: list[str] = []
    if activos:
        mensajes.append(f"Registra {activos} proceso(s) potencialmente activo(s).")
    if finalizados:
        mensajes.append(f"Registra {finalizados} proceso(s) finalizado(s) o archivado(s).")
    if not juicios:
        mensajes.append("No se encontraron procesos para la identificacion consultada.")

    riesgo = "alto" if activos >= 3 else "medio" if activos else "bajo"
    return JuiciosResumen(
        identificacion=identificacion,
        total=len(juicios),
        activos=activos,
        finalizados=finalizados,
        riesgo=riesgo,
        mensajes=mensajes,
    )


@app.get("/api/juicios-resumen/{identificacion}", response_model=JuiciosResumen)
async def api_juicios_resumen(
    identificacion: str,
    _: None = Depends(require_api_key),
) -> JuiciosResumen:
    return await build_juicios_resumen(identificacion)


@app.get("/api/juicio/{id_juicio}/pdf")
async def api_juicio_pdf(
    id_juicio: str,
    _: None = Depends(require_api_key),
) -> Response:
    detalle = await get_juicio_detalle_cached(id_juicio)
    filename = f"extracto-judicial-{id_juicio}.pdf"
    return Response(
        content=build_juicio_pdf(detalle),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/juicio/pdf")
async def api_juicio_pdf_payload(
    payload: dict[str, Any] = Body(...),
    _: None = Depends(require_api_key),
) -> Response:
    try:
        detalle = await obtener_detalle_por_payload(payload)
    except SourceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    id_juicio = str(payload.get("idJuicio") or payload.get("numeroProceso") or "satje")
    filename = f"extracto-judicial-{id_juicio}.pdf"
    return Response(
        content=build_juicio_pdf(detalle),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/juicios-resumen/{identificacion}/pdf")
async def api_juicios_resumen_pdf(
    identificacion: str,
    _: None = Depends(require_api_key),
) -> Response:
    juicios = await get_juicios_cached(identificacion)
    resumen = await build_juicios_resumen(identificacion)
    filename = f"resumen-judicial-{identificacion}.pdf"
    return Response(
        content=build_resumen_pdf(resumen, juicios),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
