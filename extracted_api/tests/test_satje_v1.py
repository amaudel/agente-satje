import httpx
import pytest
from functools import partial
from io import BytesIO
from reportlab.pdfgen import canvas
from fastapi.testclient import TestClient

from app.config import settings
from app.errors import ApiError, ErrorCode
from app.main import app
from app.observability import log_event
from app.pdf_text import extract_pdf_text
from app.satje_client import (
    SATJE_INCIDENTES_PATH,
    SatjeApifyConnectorClient,
    SatjeAwsLambdaConnectorClient,
    SatjeCloudflareWorkerConnectorClient,
    build_actuaciones_payload,
    buscar_causas_payload,
    classify_httpx_error,
    extract_incidentes,
    get_satje_client,
)
from app.services import SatjeService, document_id_from_code


client = TestClient(app)
HEADERS = {"X-API-Key": next(iter(settings.allowed_api_keys))}

# Campos que cambian en cada llamada y que NO forman parte del contrato del
# endpoint. El test de regresion compara dos respuestas del mismo endpoint
# para detectar cambios de ESTRUCTURA, asi que hay que ignorarlos.
_CAMPOS_VOLATILES = {
    "requestId",
    "retrievedAt",
    "generatedAt",
    "cachedAt",
    "createdAt",
    "updatedAt",
    "timestamp",
    "ttlSeconds",
    "duracionMs",
    "durationMs",
    "elapsedMs",
    "processingTimeMs",
    "latencyMs",
    "hit",
}


def normalizar_volatiles(valor):
    """Sustituye los campos volatiles por un marcador, recursivamente."""
    if isinstance(valor, dict):
        return {
            clave: "<ignored>" if clave in _CAMPOS_VOLATILES else normalizar_volatiles(sub)
            for clave, sub in valor.items()
        }
    if isinstance(valor, list):
        return [normalizar_volatiles(sub) for sub in valor]
    return valor


def test_buscar_causas_payload_supports_actor_and_demandado():
    actor = buscar_causas_payload("0104270855", role="actor", page=1, size=10)
    demandado = buscar_causas_payload("0104270855", role="demandado", page=2, size=10)

    assert actor["actor"]["cedulaActor"] == "0104270855"
    assert actor["demandado"]["cedulaDemandado"] == ""
    assert demandado["actor"]["cedulaActor"] == ""
    assert demandado["demandado"]["cedulaDemandado"] == "0104270855"
    assert demandado["first"] == 2
    assert demandado["pageSize"] == 10


def test_incidentes_path_matches_satje_clex_contract():
    assert "getIncidenteJudicatura/{id_juicio}" in SATJE_INCIDENTES_PATH
    assert "EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE" in SATJE_INCIDENTES_PATH


def test_extract_incidentes_builds_actuaciones_payload_from_response():
    incidentes = extract_incidentes(
        [
            {
                "idMovimientoJuicioIncidente": 19384296,
                "idJuicio": "01371201700497 ",
                "idJudicatura": "01371",
                "idIncidenteJudicatura": 20181767,
                "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
                "incidente": 1,
            }
        ],
        "01371201700497",
    )

    assert incidentes == [
        {
            "idMovimientoJuicioIncidente": 19384296,
            "idJuicio": "01371201700497",
            "idJudicatura": "01371",
            "idIncidenteJudicatura": 20181767,
            "aplicativo": "web",
            "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
            "incidente": 1,
        }
    ]


def test_extract_incidentes_accepts_real_nested_lst_incidente_judicatura():
    incidentes = extract_incidentes(
        [
            {
                "idJudicatura": "01371",
                "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
                "lstIncidenteJudicatura": [
                    {
                        "idIncidenteJudicatura": 20181767,
                        "idMovimientoJuicioIncidente": 19384296,
                        "idJudicaturaDestino": "01371",
                        "incidente": 1,
                    }
                ],
            }
        ],
        "01371201700497",
    )

    assert incidentes == [
        {
            "idMovimientoJuicioIncidente": 19384296,
            "idJuicio": "01371201700497",
            "idJudicatura": "01371",
            "idIncidenteJudicatura": 20181767,
            "aplicativo": "web",
            "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
            "incidente": 1,
        }
    ]


def test_live_mode_can_select_apify_connector(monkeypatch):
    monkeypatch.setattr("app.config.settings.satje_mode", "live")
    monkeypatch.setattr("app.config.settings.satje_live_backend", "apify_actor")

    assert isinstance(get_satje_client(), SatjeApifyConnectorClient)


def test_live_mode_can_select_aws_lambda_connector(monkeypatch):
    monkeypatch.setattr("app.config.settings.satje_mode", "live")
    monkeypatch.setattr("app.config.settings.satje_live_backend", "aws_lambda")

    assert isinstance(get_satje_client(), SatjeAwsLambdaConnectorClient)


def test_live_mode_can_select_cloudflare_worker_connector(monkeypatch):
    monkeypatch.setattr("app.config.settings.satje_mode", "live")
    monkeypatch.setattr("app.config.settings.satje_live_backend", "cloudflare_worker")

    assert isinstance(get_satje_client(), SatjeCloudflareWorkerConnectorClient)


def test_fixture_v1_busqueda_cedula_returns_real_three_causes():
    response = client.post(
        "/api/v1/causas/buscar",
        headers=HEADERS,
        json={"cedula": "0104270855", "roles": ["actor", "demandado"], "incluirTodasLasPaginas": True},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["mode"] == "fixture"
    assert payload["total"] == 3
    assert [item["idJuicio"] for item in payload["data"]] == [
        "01204202002243",
        "01371201700497",
        "01371201700494",
    ]
    assert payload["data"][0]["rolesEncontrados"] == ["actor"]
    assert payload["requestId"].startswith("req_")


def test_fixture_satje_agent_searches_cases_by_cedula():
    response = client.post(
        "/api/v1/agent/satje",
        headers=HEADERS,
        json={"query": "consulta la cedula 0104270855"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["agent"] == "satje_consultor"
    assert payload["intent"] == "buscar_causas"
    assert payload["input"]["tipoBusqueda"] == "cedula"
    assert payload["input"]["identificador"] == "0104270855"
    assert payload["answer"].startswith("Encontre 3 procesos SATJE")
    assert [item["idJuicio"] for item in payload["cases"]] == [
        "01204202002243",
        "01371201700497",
        "01371201700494",
    ]
    assert payload["nextActions"][0]["type"] == "select_case"


def test_fixture_satje_agent_summarizes_case_by_process_number():
    response = client.post(
        "/api/v1/agent/satje",
        headers=HEADERS,
        json={"query": "01371201700497", "tipoBusqueda": "proceso", "maxActuaciones": 3},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["agent"] == "satje_consultor"
    assert payload["intent"] == "consultar_causa"
    assert payload["input"]["tipoBusqueda"] == "proceso"
    assert payload["case"]["idJuicio"] == "01371201700497"
    assert payload["case"]["totalActuaciones"] == 159
    assert len(payload["case"]["ultimasActuaciones"]) == 3
    assert payload["nextActions"][0]["type"] == "fetch_resolutions"


def test_fixture_v1_actuaciones_returns_incidente_and_159_actuaciones():
    response = client.get("/api/v1/causas/01371201700497/actuaciones", headers=HEADERS)

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["totalIncidentes"] == 1
    assert payload["totalActuaciones"] == 159
    assert payload["incidentes"][0]["idIncidenteJudicatura"] == 20181767
    assert payload["incidentes"][0]["actuaciones"][0]["actividad"].startswith("RAZON:")
    assert "<p>" not in payload["incidentes"][0]["actuaciones"][0]["actividad"]


def test_regression_current_actuaciones_response_contract_is_unchanged():
    first = client.get("/api/v1/causas/01371201700497/actuaciones", headers=HEADERS)
    second = client.get("/api/v1/causas/01371201700497/actuaciones", headers=HEADERS)

    assert first.status_code == 200
    assert second.status_code == 200
    before = first.json()
    after = second.json()

    assert before["requestId"].startswith("req_")
    assert after["requestId"].startswith("req_")
    assert "cache" in before and "hit" in before["cache"]

    # Se comparan las respuestas ignorando los metadatos volatiles
    # (requestId, retrievedAt, ttlSeconds...): lo que este test protege es el
    # CONTRATO del endpoint, no los tiempos ni los ids de cada llamada.
    assert normalizar_volatiles(after) == normalizar_volatiles(before)
    assert "incidentes" in after
    assert "pagination" not in after
    assert after["totalActuaciones"] == 159


def test_fixture_v1_actuaciones_paginadas_returns_page_metadata():
    response = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas?page=1&pageSize=10&orden=desc",
        headers=HEADERS,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["idJuicio"] == "01371201700497"
    assert payload["pagination"] == {
        "page": 1,
        "pageSize": 10,
        "totalItems": 159,
        "totalPages": 16,
        "hasNext": True,
        "hasPrevious": False,
    }
    assert len(payload["data"]) == 10
    assert payload["data"][0]["idIncidenteJudicatura"] == 20181767
    assert set(payload["data"][0]) == {
        "idIncidenteJudicatura",
        "incidente",
        "idJudicatura",
        "nombreJudicatura",
        "codigoActuacion",
        "fecha",
        "tipo",
        "actividad",
        "tieneDocumento",
    }


def test_fixture_v1_actuaciones_paginadas_defaults_page_and_page_size():
    response = client.get("/api/v1/causas/01371201700497/actuaciones/paginadas", headers=HEADERS)

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 1
    assert payload["pagination"]["pageSize"] == 20
    assert len(payload["data"]) == 20


def test_fixture_v1_actuaciones_paginadas_filters_and_limits():
    response = client.get(
        (
            "/api/v1/causas/01371201700497/actuaciones/paginadas"
            "?page=1&pageSize=50&orden=asc&fechaDesde=2020-01-01"
            "&fechaHasta=2020-12-31&tieneDocumento=true"
        ),
        headers=HEADERS,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["pageSize"] == 50
    assert all(item["fecha"][:4] == "2020" for item in payload["data"])
    assert all(item["tieneDocumento"] is True for item in payload["data"])


def test_fixture_v1_actuaciones_paginadas_orders_ascending_and_descending():
    asc = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas?page=1&pageSize=5&orden=asc",
        headers=HEADERS,
    ).json()
    desc = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas?page=1&pageSize=5&orden=desc",
        headers=HEADERS,
    ).json()

    asc_keys = [(item["fecha"], str(item["codigoActuacion"])) for item in asc["data"]]
    desc_keys = [(item["fecha"], str(item["codigoActuacion"])) for item in desc["data"]]
    assert asc_keys == sorted(asc_keys)
    assert desc_keys == sorted(desc_keys, reverse=True)


def test_fixture_v1_actuaciones_paginadas_returns_empty_page():
    response = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas?page=999&pageSize=20",
        headers=HEADERS,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 999
    assert payload["pagination"]["hasNext"] is False
    assert payload["pagination"]["hasPrevious"] is True
    assert payload["data"] == []


def test_v1_actuaciones_paginadas_rejects_invalid_date():
    response = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas?fechaDesde=2026-99-99",
        headers=HEADERS,
    )

    assert response.status_code == 422
    assert response.json()["requestId"].startswith("req_")


def test_v1_actuaciones_paginadas_rejects_page_size_over_50():
    response = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas?pageSize=51",
        headers=HEADERS,
    )

    assert response.status_code == 422


def test_v1_actuaciones_paginadas_rejects_invalid_page():
    response = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas?page=0",
        headers=HEADERS,
    )

    assert response.status_code == 422


def test_v1_actuaciones_paginadas_uses_same_commercial_permission_as_actuaciones(monkeypatch):
    monkeypatch.setattr("app.config.settings.ops_api_keys", "ops-only-key")

    current = client.get("/api/v1/causas/01371201700497/actuaciones", headers={"X-API-Key": "ops-only-key"})
    paginated = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas",
        headers={"X-API-Key": "ops-only-key"},
    )
    resolutions = client.get("/api/v1/causas/01371201700497/resoluciones", headers={"X-API-Key": "ops-only-key"})

    assert current.status_code == 401
    assert paginated.status_code == 401
    assert resolutions.status_code == 401
    assert paginated.json()["requestId"].startswith("req_")


def test_fixture_v1_pdf_uses_expel_filename():
    response = client.post("/api/v1/causas/01371201700497/pdf", headers=HEADERS)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert 'filename="expel_01371201700497_' in response.headers["content-disposition"]
    assert response.headers["x-request-id"].startswith("req_")


def test_validation_error_uses_uniform_contract():
    response = client.post("/api/v1/causas/buscar", headers=HEADERS, json={})

    assert response.status_code == 422
    payload = response.json()
    assert payload["success"] is False
    assert payload["error"]["code"] == "VALIDATION_ERROR"
    assert payload["requestId"].startswith("req_")


def test_ops_metrics_rejects_commercial_api_key():
    response = client.get("/api/v1/ops/metrics", headers=HEADERS)

    assert response.status_code == 403


def test_ops_metrics_accepts_ops_api_key(monkeypatch):
    monkeypatch.setattr("app.config.settings.ops_api_keys", "ops-test-key")

    response = client.get("/api/v1/ops/metrics", headers={"X-API-Key": "ops-test-key"})

    assert response.status_code == 200
    assert response.json()["windowSeconds"] == 86400


def test_build_actuaciones_payload_does_not_use_fixed_example_ids():
    payload = build_actuaciones_payload(
        {
            "idMovimientoJuicioIncidente": 1,
            "idJuicio": "X",
            "idJudicatura": "J",
            "idIncidenteJudicatura": 2,
            "nombreJudicatura": "Unidad",
            "incidente": 3,
        },
        "fallback",
    )

    assert payload["idMovimientoJuicioIncidente"] == 1
    assert payload["idIncidenteJudicatura"] == 2
    assert payload["incidente"] == 3
    assert payload["idJuicio"] == "X"


def test_classify_timeout_error():
    error = classify_httpx_error(httpx.ReadTimeout("slow"), "actuacionesJudiciales")

    assert error.code == ErrorCode.SATJE_TIMEOUT
    assert error.retryable is True
    assert error.status_code == 504


def make_pdf_bytes(text: str) -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer)
    pdf.drawString(72, 720, text)
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def test_extract_pdf_text_reads_generated_pdf():
    import anyio

    result = anyio.run(extract_pdf_text, make_pdf_bytes("Texto del escrito HBA"))

    assert result["pages"] == 1
    assert result["extractionMethod"] == "embedded_text"
    assert "Texto del escrito HBA" in result["text"]


def test_extract_pdf_text_caps_embedded_pages(monkeypatch):
    import anyio

    from app.config import settings

    # PDF con 3 paginas: el tope configurado debe limitar la extraccion
    # (C1: un PDF puede declarar miles de paginas; nunca se itera mas alla del tope).
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer)
    for i in range(1, 4):
        pdf.drawString(72, 720, f"Pagina {i}")
        pdf.showPage()
    pdf.save()
    pdf_bytes = buffer.getvalue()

    monkeypatch.setattr(settings, "pdf_text_max_pages", 2)
    result = anyio.run(extract_pdf_text, pdf_bytes)

    assert result["pages"] == 2
    assert result["extractionMethod"] == "embedded_text"


def test_extract_pdf_text_enforces_global_timeout(monkeypatch):
    import anyio

    from app import pdf_text as pdf_text_module
    from app.config import settings

    async def slow_extract(_pdf_bytes):
        import asyncio

        await asyncio.sleep(5)
        return [], "embedded_text"

    monkeypatch.setattr(pdf_text_module, "_extract_text", slow_extract)
    monkeypatch.setattr(settings, "pdf_text_extraction_timeout_seconds", 0.05)

    with pytest.raises(ApiError) as exc_info:
        anyio.run(pdf_text_module.extract_pdf_text, b"%PDF-1.4\n%%EOF")

    assert exc_info.value.status_code == 504
    assert exc_info.value.code == ErrorCode.PDF_TEXT_EXTRACTION_ERROR


def test_apify_connector_decodes_document_hba_base64(monkeypatch):
    import anyio
    import base64

    pdf_bytes = make_pdf_bytes("Documento desde Apify")

    async def fake_call(self, operation, payload):
        assert operation == "documentHba"
        assert payload["code"] == "abc"
        return {
            "contentType": "application/pdf",
            "contentLength": len(pdf_bytes),
            "base64": base64.b64encode(pdf_bytes).decode("ascii"),
        }

    monkeypatch.setattr(SatjeApifyConnectorClient, "_call_connector", fake_call)
    result = anyio.run(SatjeApifyConnectorClient().obtener_documento_hba, "abc")

    assert result["contentType"] == "application/pdf"
    assert result["bytes"].startswith(b"%PDF")


def test_lambda_connector_decodes_document_hba_base64(monkeypatch):
    import anyio
    import base64

    pdf_bytes = make_pdf_bytes("Documento desde Lambda")

    async def fake_call(self, operation, payload):
        assert operation == "documentHba"
        assert payload["code"] == "abc"
        return {
            "contentType": "application/pdf",
            "contentLength": len(pdf_bytes),
            "base64": base64.b64encode(pdf_bytes).decode("ascii"),
        }

    monkeypatch.setattr(SatjeAwsLambdaConnectorClient, "_call_connector", fake_call)
    result = anyio.run(SatjeAwsLambdaConnectorClient().obtener_documento_hba, "abc")

    assert result["contentType"] == "application/pdf"
    assert result["bytes"].startswith(b"%PDF")


def test_cloudflare_worker_connector_decodes_document_hba_base64(monkeypatch):
    import anyio
    import base64

    pdf_bytes = make_pdf_bytes("Documento desde Cloudflare")

    async def fake_call(self, operation, payload):
        assert operation == "documentHba"
        assert payload["code"] == "abc"
        return {
            "contentType": "application/pdf",
            "contentLength": len(pdf_bytes),
            "base64": base64.b64encode(pdf_bytes).decode("ascii"),
        }

    monkeypatch.setattr(SatjeCloudflareWorkerConnectorClient, "_call_connector", fake_call)
    result = anyio.run(SatjeCloudflareWorkerConnectorClient().obtener_documento_hba, "abc")

    assert result["contentType"] == "application/pdf"
    assert result["bytes"].startswith(b"%PDF")


class DocumentClient:
    mode = "live"

    async def buscar_causas_por_cedula(self, cedula, *, role, page, size):
        return []

    async def obtener_incidentes_por_juicio(self, id_juicio):
        return []

    async def obtener_actuaciones(self, payload):
        return []

    async def obtener_documento_hba(self, code):
        return {
            "contentType": "application/pdf",
            "contentLength": 0,
            "headers": {},
            "bytes": make_pdf_bytes("FE DE PRESENTACION HBA"),
        }


def test_service_extracts_hba_document_text():
    import anyio

    result = anyio.run(SatjeService(DocumentClient()).extraer_texto_documento_hba, "code-1")

    assert result["success"] is True
    assert result["source"] == "SATJE"
    assert result["documentoId"] == document_id_from_code("code-1")
    assert result["pages"] == 1
    assert result["extractionMethod"] == "embedded_text"
    assert "FE DE PRESENTACION HBA" in result["text"]
    assert result["requestId"].startswith("req_")


class DocumentListClient(DocumentClient):
    mode = "fixture"

    async def obtener_incidentes_por_juicio(self, id_juicio):
        return [
            {
                "idMovimientoJuicioIncidente": 10,
                "idJuicio": id_juicio,
                "idJudicatura": "01371",
                "idIncidenteJudicatura": 11,
                "nombreJudicatura": "Unidad",
                "incidente": 1,
            }
        ]

    async def obtener_actuaciones(self, payload):
        return [
            {
                "codigo": 123,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2026-07-14T15:30:00Z",
                "tipo": "ESCRITO",
                "actividad": "Adjunta documento HBA",
                "ieDocumentoAdjunto": "S",
                "uuid": "hba-code-1",
                "alias": "HBA01",
                "nombreArchivo": "ESCRITO.pdf",
            }
        ]

    async def obtener_documento_hba(self, code):
        assert code == "hba-code-1"
        return {
            "contentType": "application/pdf",
            "contentLength": 0,
            "headers": {},
            "bytes": make_pdf_bytes("Texto desde documentoId"),
        }


def test_service_lists_hba_documents_for_actuacion():
    import anyio

    result = anyio.run(SatjeService(DocumentListClient()).documentos_hba_por_actuacion, "ABC", "123")

    assert result["success"] is True
    assert result["idJuicio"] == "ABC"
    assert result["codigoActuacion"] == "123"
    assert result["total"] == 1
    assert result["data"][0]["documentoId"] == document_id_from_code("hba-code-1")
    assert result["data"][0]["nombreArchivo"] == "ESCRITO.pdf"


def test_service_extracts_hba_text_from_document_id():
    import anyio

    documento_id = document_id_from_code("hba-code-1")
    result = anyio.run(SatjeService(DocumentListClient()).extraer_texto_documento_hba, documento_id)

    assert result["success"] is True
    assert result["documentoId"] == documento_id
    assert "Texto desde documentoId" in result["text"]


class DocumentWithAnexosClient(DocumentClient):
    mode = "fixture"

    async def obtener_incidentes_por_juicio(self, id_juicio):
        return [
            {
                "idMovimientoJuicioIncidente": 27491614,
                "idJuicio": id_juicio,
                "idJudicatura": "01333",
                "idIncidenteJudicatura": 11,
                "nombreJudicatura": "Unidad Naranjal",
                "incidente": 1,
            }
        ]

    async def obtener_actuaciones(self, payload):
        assert payload["idMovimientoJuicioIncidente"] == 27491614
        return [
            {
                "codigo": 68880635,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2025-09-16T09:49:00Z",
                "tipo": "OFICIO",
                "descripcion": "Recibido oficio del Registrador de la Propiedad",
                "uuid": "constancia-code",
                "alias": "HBA01",
                "nombreArchivo": "FE PRESENTACION_68880635.pdf",
                "ieTablaReferencia": "EscritosPrimera",
                # En SATJE real este campo NO es el codigo de la actuacion:
                # coincide con idMovimientoJuicioIncidente del incidente
                # (confirmado con datos reales de produccion). El payload de
                # anexos debe usar actuacion.codigo, no este campo.
                "idTablaReferencia": "27491614",
            }
        ]

    async def obtener_anexos_actuacion(self, payload):
        assert payload["TablaReferencia"] == "EscritosPrimera"
        assert payload["IdTablaReferencia"] == 68880635
        assert payload["idmovimientojuicioincidente"] == 27491614
        assert payload["tipoActuacion"] == "OFICIO"
        return [
            {
                "UUID": "20250916-173527716361-593792259-1617253577",
                "nombreArchivo": "OFICIO",
                "descripcion": "OFICIO",
                "paginas": 6,
            },
            {
                "UUID": "20250916-173528111111-593792259-1617253577",
                "nombreArchivo": "CERTIFICADO REGISTRO DE LA PROPIEDAD EN 01 FJ",
                "descripcion": "CERTIFICADO REGISTRO DE LA PROPIEDAD EN 01 FJ",
                "paginas": 2,
            },
        ]


def test_service_lists_all_anexos_when_actuacion_has_multiple_documents():
    import anyio

    result = anyio.run(SatjeService(DocumentWithAnexosClient()).documentos_hba_por_actuacion, "01333202503613", "68880635")

    assert result["total"] == 2
    document_ids = {item["documentoId"] for item in result["data"]}
    assert document_id_from_code("20250916-173527716361-593792259-1617253577") in document_ids
    assert document_id_from_code("20250916-173528111111-593792259-1617253577") in document_ids
    certificado = next(item for item in result["data"] if "CERTIFICADO" in item["nombreArchivo"])
    assert certificado["paginas"] == 2


def test_service_falls_back_to_uuid_document_when_no_anexos_available():
    import anyio

    # DocumentListClient no sobreescribe obtener_anexos_actuacion (usa el
    # default de la clase base, que devuelve lista vacia) -- debe seguir
    # funcionando como antes de agregar el soporte de anexos.
    result = anyio.run(SatjeService(DocumentListClient()).documentos_hba_por_actuacion, "ABC", "123")

    assert result["total"] == 1
    assert result["data"][0]["documentoId"] == document_id_from_code("hba-code-1")


class MultiIncidentClient:
    mode = "fixture"

    async def buscar_causas_por_cedula(self, cedula, *, role, page, size):
        return []

    async def obtener_incidentes_por_juicio(self, id_juicio):
        return [
            {
                "idMovimientoJuicioIncidente": 10,
                "idJuicio": id_juicio,
                "idJudicatura": "A",
                "idIncidenteJudicatura": 11,
                "nombreJudicatura": "Unidad A",
                "incidente": 1,
            },
            {
                "idMovimientoJuicioIncidente": 20,
                "idJuicio": id_juicio,
                "idJudicatura": "B",
                "idIncidenteJudicatura": 21,
                "nombreJudicatura": "Unidad B",
                "incidente": 2,
            },
        ]

    async def obtener_actuaciones(self, payload):
        if payload["incidente"] == 2:
            return []
        return [
            {
                "codigo": 1,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2026-01-01",
                "tipo": "AUTO",
                "actividad": "<p>Texto limpio</p>",
            },
            {
                "codigo": 1,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2026-01-02",
                "tipo": "RAZON",
                "actividad": "",
                "uuid": "",
                "nombreArchivo": "",
            },
        ]


def test_service_supports_multiple_incidents_empty_actuations_and_duplicate_codes():
    import anyio

    result = anyio.run(SatjeService(MultiIncidentClient()).actuaciones_por_juicio, "ABC")

    assert result["totalIncidentes"] == 2
    assert result["totalActuaciones"] == 2
    assert result["incidentes"][0]["actuaciones"][0]["actividad"] == "Texto limpio"
    assert result["incidentes"][0]["actuaciones"][1]["codigo"] == 1
    assert result["incidentes"][0]["actuaciones"][1]["actividad"] is None
    assert result["incidentes"][1]["totalActuaciones"] == 0


def test_service_calculates_abandono_risk_for_main_and_deprecada_clocks():
    import anyio

    result = anyio.run(
        partial(
            SatjeService(MultiIncidentClient()).riesgo_abandono_por_juicio,
            "ABC",
            fecha_corte="2026-01-10",
        )
    )

    assert result["success"] is True
    assert result["relojProcesoPrincipal"]["ultimaActuacion"]["fecha"] == "2026-01-02"
    assert result["relojProcesoPrincipal"]["inicioComputo"] == "2026-01-03"
    assert result["relojProcesoPrincipal"]["fechaReferencialAbandono"] == "2026-07-03"
    assert result["relojUnidadDeprecada"] is None
    assert result["alertaGeneral"]["estadoAlerta"] == "vigilancia"


class DeprecadaClient(MultiIncidentClient):
    async def obtener_actuaciones(self, payload):
        if payload["incidente"] == 2:
            return [
                {
                    "codigo": 2,
                    "idJuicio": payload["idJuicio"],
                    "idJudicatura": payload["idJudicatura"],
                    "fecha": "2026-07-02T14:00:00Z",
                    "tipo": "RAZON",
                    "actividad": "Unidad deprecada informa citacion pendiente",
                }
            ]
        return [
            {
                "codigo": 1,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2026-07-06T15:45:00Z",
                "tipo": "AUTO",
                "actividad": "Auto del proceso principal",
            }
        ]


def test_service_keeps_deprecada_clock_separate_from_main_clock():
    import anyio

    result = anyio.run(
        partial(
            SatjeService(DeprecadaClient()).riesgo_abandono_por_juicio,
            "ABC",
            fecha_corte="2026-07-14",
        )
    )

    assert result["relojProcesoPrincipal"]["ultimaActuacion"]["fecha"] == "2026-07-06"
    assert result["relojUnidadDeprecada"]["ultimaActuacion"]["fecha"] == "2026-07-02"
    assert result["relojProcesoPrincipal"]["fechaReferencialAbandono"] == "2027-01-07"
    assert result["relojUnidadDeprecada"]["fechaReferencialAbandono"] == "2027-01-03"
    assert result["alertaGeneral"]["ambitoMasCercano"] == "unidad_deprecada"


class PartialErrorClient(MultiIncidentClient):
    async def obtener_actuaciones(self, payload):
        if payload["incidente"] == 2:
            raise ApiError(ErrorCode.SATJE_TIMEOUT, "actuacionesJudiciales", status_code=504)
        return await super().obtener_actuaciones(payload)


def test_service_reports_partial_error_in_one_incident():
    import anyio

    result = anyio.run(SatjeService(PartialErrorClient()).actuaciones_por_juicio, "ABC")

    assert result["success"] is False
    assert result["totalIncidentes"] == 2
    assert result["partialErrors"][0]["code"] == "SATJE_TIMEOUT"


class EmptyActuacionesClient(MultiIncidentClient):
    async def obtener_incidentes_por_juicio(self, id_juicio):
        return [
            {
                "idMovimientoJuicioIncidente": 10,
                "idJuicio": id_juicio,
                "idJudicatura": "A",
                "idIncidenteJudicatura": 11,
                "nombreJudicatura": "Unidad A",
                "incidente": 1,
            }
        ]

    async def obtener_actuaciones(self, payload):
        return []


def test_service_handles_process_without_actuaciones():
    import anyio

    result = anyio.run(SatjeService(EmptyActuacionesClient()).actuaciones_paginadas_por_juicio, "ABC-EMPTY")

    assert result["success"] is True
    assert result["pagination"]["totalItems"] == 0
    assert result["pagination"]["totalPages"] == 0
    assert result["data"] == []


def test_v1_actuaciones_unknown_process_returns_404():
    response = client.get("/api/v1/causas/00000000000000/actuaciones/paginadas", headers=HEADERS)

    assert response.status_code == 404
    payload = response.json()
    assert payload["error"]["code"] == "INCIDENT_NOT_FOUND"
    assert payload["requestId"].startswith("req_")


class ResolutionClient(MultiIncidentClient):
    async def obtener_actuaciones(self, payload):
        if payload["incidente"] == 2:
            return []
        return [
            {
                "codigo": 7,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2026-07-08T10:00:00Z",
                "tipo": "SENTENCIA",
                "actividad": "Sentencia cargada al expediente",
                "uuid": "doc-code",
                "nombreArchivo": "sentencia.pdf",
            },
            {
                "codigo": 8,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2026-07-09T10:00:00Z",
                "tipo": "RAZON",
                "actividad": "Razon sin decision",
            },
        ]


def test_service_returns_traceable_resolution_candidates():
    import anyio

    result = anyio.run(partial(SatjeService(ResolutionClient()).resoluciones_por_juicio, "ABC-RES-1", limit=5))

    assert result["success"] is True
    assert result["total"] == 1
    assert result["data"][0]["codigoActuacion"] == 7
    assert result["data"][0]["tieneDocumento"] is True
    assert result["data"][0]["cantidadDocumentos"] == 1
    assert "sentencia" in result["data"][0]["criterioCoincidencia"]
    assert "documento_adjunto" in result["data"][0]["criterioCoincidencia"]
    assert result["data"][0]["nivelConfianza"] == "alto"
    assert "no afirma contenido" in result["data"][0]["advertencia"]


def test_v1_resoluciones_endpoint_enforces_limit():
    response = client.get("/api/v1/causas/01371201700497/resoluciones?limit=3", headers=HEADERS)

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["total"] <= 3
    assert payload["requestId"].startswith("req_")


def test_new_responses_do_not_expose_raw_payloads_or_secrets():
    paginated = client.get(
        "/api/v1/causas/01371201700497/actuaciones/paginadas?page=1&pageSize=3",
        headers=HEADERS,
    ).json()
    resolutions = client.get("/api/v1/causas/01371201700497/resoluciones?limit=3", headers=HEADERS).json()

    serialized = f"{paginated}{resolutions}".lower()
    assert "x-api-key" not in serialized
    assert "api_key" not in serialized
    assert "authorization" not in serialized
    assert "raw" not in serialized
    assert "pagetexts" not in serialized
    assert "pdf" not in serialized
    for item in paginated["data"]:
        assert len(item.get("actividad") or "") <= 1200
    for item in resolutions["data"]:
        assert "text" not in item
        assert len(item.get("actividad") or "") <= 500


def test_v1_resoluciones_rejects_limit_over_50():
    response = client.get("/api/v1/causas/01371201700497/resoluciones?limit=51", headers=HEADERS)

    assert response.status_code == 422


class ResolutionWithoutDocumentClient(ResolutionClient):
    async def obtener_actuaciones(self, payload):
        if payload["incidente"] == 2:
            return []
        return [
            {
                "codigo": 9,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2026-07-10T10:00:00Z",
                "tipo": "RESOLUCION",
                "actividad": "Resolucion sin documento adjunto",
            },
            {
                "codigo": 10,
                "idJuicio": payload["idJuicio"],
                "idJudicatura": payload["idJudicatura"],
                "fecha": "2026-07-11T10:00:00Z",
                "tipo": "AUTO RESOLUTORIO",
                "actividad": "Auto resolutorio con documento",
                "ieDocumentoAdjunto": "S",
            },
        ]


def test_service_resoluciones_can_exclude_items_without_document():
    import anyio

    result = anyio.run(
        partial(
            SatjeService(ResolutionWithoutDocumentClient()).resoluciones_por_juicio,
            "ABC-RES-2",
            incluir_sin_documento=False,
        )
    )

    assert result["total"] == 1
    assert result["data"][0]["codigoActuacion"] == 10
    assert result["data"][0]["tieneDocumento"] is True


def test_v1_actuaciones_paginadas_requires_api_key():
    response = client.get("/api/v1/causas/01371201700497/actuaciones/paginadas")

    assert response.status_code == 401
    assert response.json()["requestId"].startswith("req_")


class UpstreamInvalidClient(MultiIncidentClient):
    mode = "live"

    async def obtener_incidentes_por_juicio(self, id_juicio):
        raise ApiError(ErrorCode.SATJE_INVALID_RESPONSE, "getIncidenteJudicatura", status_code=502)


class UpstreamTimeoutClient(MultiIncidentClient):
    mode = "live"

    async def obtener_incidentes_por_juicio(self, id_juicio):
        raise ApiError(ErrorCode.SATJE_TIMEOUT, "getIncidenteJudicatura", status_code=504)


def test_v1_actuaciones_paginadas_maps_upstream_502(monkeypatch):
    monkeypatch.setattr("app.services.get_satje_client", lambda: UpstreamInvalidClient())

    response = client.get("/api/v1/causas/ABC-502/actuaciones/paginadas", headers=HEADERS)

    assert response.status_code == 502
    payload = response.json()
    assert payload["error"]["code"] == "SATJE_INVALID_RESPONSE"
    assert payload["requestId"].startswith("req_")


def test_v1_actuaciones_paginadas_maps_upstream_504(monkeypatch):
    monkeypatch.setattr("app.services.get_satje_client", lambda: UpstreamTimeoutClient())

    response = client.get("/api/v1/causas/ABC-504/actuaciones/paginadas", headers=HEADERS)

    assert response.status_code == 504
    payload = response.json()
    assert payload["error"]["code"] == "SATJE_TIMEOUT"
    assert payload["requestId"].startswith("req_")


def test_logs_mask_identifiers_and_omit_large_payloads(caplog):
    caplog.set_level("INFO", logger="satje_api")

    log_event(
        cedula="0104270855",
        ruc="1790012345001",
        actividad="Cedula 0104270855 y RUC 1790012345001 dentro de texto HBA " + ("x" * 800),
        actuaciones=[{"actividad": "texto completo que no debe quedar en logs"}],
        pageTexts=[{"text": "texto HBA completo"}],
    )

    message = caplog.records[-1].message
    assert "0104270855" not in message
    assert "1790012345001" not in message
    assert "0104**55" in message
    assert "1790**01" in message
    assert "texto completo que no debe quedar en logs" not in message
    assert "texto HBA completo" not in message
    assert "<omitted:1>" in message
