import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.source import (
    SATJE_ACTUACIONES_PATH,
    SATJE_BUSCAR_CAUSAS_PATH,
    _detail_candidates,
    _extract_actuaciones,
    _extract_juicio_data,
    _extract_rows,
    _official_candidates,
    _normalize_juicio,
    _search_payload,
)


client = TestClient(app)
EXAMPLES_DIR = Path(__file__).resolve().parents[1] / "examples"
AUTH_HEADERS = {"X-API-Key": next(iter(settings.allowed_api_keys))}


def test_health_reports_mock_mode():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_satje_health_requires_ops_key():
    response = client.get("/health/satje")

    assert response.status_code == 403


def test_api_requires_key():
    response = client.get("/api/juicios/0102030405")

    assert response.status_code == 401


def test_mock_juicios_resumen_with_key():
    response = client.get(
        "/api/juicios-resumen/0102030405",
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["identificacion"] == "0102030405"
    assert payload["total"] == 2
    assert payload["activos"] == 1
    assert payload["finalizados"] == 1
    assert payload["riesgo"] == "medio"


def test_mock_juicio_pdf_with_key():
    response = client.get(
        "/api/juicio/01283-2024-00123/pdf",
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


def test_mock_resumen_pdf_with_key():
    response = client.get(
        "/api/juicios-resumen/0102030405/pdf",
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


def test_official_detail_candidates_use_actuaciones_post_first():
    method, path, payload = next(iter(_detail_candidates("01283-2024-00123")))

    assert method == "POST"
    assert path == SATJE_ACTUACIONES_PATH
    assert payload["idJuicio"] == "01283-2024-00123"
    assert payload["aplicativo"] == "web"


def test_official_search_candidates_use_buscar_causas_post_first():
    method, path, payload, params = next(iter(_official_candidates("0104270855")))

    assert method == "POST"
    assert path == SATJE_BUSCAR_CAUSAS_PATH
    assert params == {"page": 1, "size": 10}
    assert payload == _search_payload("0104270855")
    assert payload["actor"]["cedulaActor"] == "0104270855"
    assert payload["demandado"]["cedulaDemandado"] == ""
    assert payload["recaptcha"] == "verdad"


def test_normalize_juicio_accepts_buscar_causas_like_response_rows():
    juicio = _normalize_juicio(
        {
            "idJuicio": "01371201700497 ",
            "numeroCausa": "01371201700497",
            "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
            "accionInfraccion": "Pago de haberes laborales",
            "actores": [{"nombre": "STEPHANIE CATALINA GONZALEZ SUMBA"}],
            "demandados": [{"nombre": "TITANMAX S.A."}, {"nombre": "RAFAEL GONZALEZ"}],
            "fechaIngreso": "2017-04-01T00:00:00.000+00:00",
        }
    )

    assert juicio.id_juicio == "01371201700497"
    assert juicio.numero_proceso == "01371201700497"
    assert juicio.judicatura == "UNIDAD JUDICIAL DE TRABAJO CUENCA"
    assert juicio.accion == "Pago de haberes laborales"
    assert juicio.actor == "STEPHANIE CATALINA GONZALEZ SUMBA"
    assert juicio.demandado == "TITANMAX S.A.; RAFAEL GONZALEZ"


def test_normalize_juicios_accepts_real_buscar_causas_array_response():
    response = [
        {
            "id": 1,
            "idJuicio": "01204202002243",
            "estadoActual": "A",
            "idMateria": 33,
            "nombreDelito": "ALIMENTOS",
            "fechaIngreso": "2020-07-23T17:54:22.537+00:00",
            "iedocumentoAdjunto": "N",
        },
        {
            "id": 2,
            "idJuicio": "01371201700497",
            "estadoActual": "A",
            "idMateria": 35,
            "nombreDelito": "ACCION POR DESPIDO INEFICAZ",
            "fechaIngreso": "2017-11-08T21:51:52.267+00:00",
            "iedocumentoAdjunto": "N",
        },
        {
            "id": 3,
            "idJuicio": "01371201700494",
            "estadoActual": "A",
            "idMateria": 35,
            "nombreDelito": "ACCION POR DESPIDO INEFICAZ",
            "fechaIngreso": "2017-11-06T20:18:22.923+00:00",
            "iedocumentoAdjunto": "N",
        },
    ]

    juicios = [_normalize_juicio(row) for row in _extract_rows(response)]

    assert [juicio.id_juicio for juicio in juicios] == [
        "01204202002243",
        "01371201700497",
        "01371201700494",
    ]
    assert [juicio.numero_proceso for juicio in juicios] == [
        "01204202002243",
        "01371201700497",
        "01371201700494",
    ]
    assert [juicio.estado for juicio in juicios] == ["A", "A", "A"]
    assert [juicio.accion for juicio in juicios] == [
        "ALIMENTOS",
        "ACCION POR DESPIDO INEFICAZ",
        "ACCION POR DESPIDO INEFICAZ",
    ]
    assert juicios[0].fecha_ingreso == "2020-07-23T17:54:22.537+00:00"
    assert juicios[1].raw["iedocumentoAdjunto"] == "N"


def test_mock_juicio_payload_pdf_with_key():
    response = client.post(
        "/api/juicio/pdf",
        headers=AUTH_HEADERS,
        json={
            "idMovimientoJuicioIncidente": 19384296,
            "idJuicio": "01371201700497",
            "idJudicatura": "01371",
            "idIncidenteJudicatura": 20181767,
            "aplicativo": "web",
            "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
            "incidente": 1,
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


def test_mock_juicio_actuaciones_payload_with_key():
    response = client.post(
        "/api/juicio/actuaciones",
        headers=AUTH_HEADERS,
        json={
            "idMovimientoJuicioIncidente": 19384296,
            "idJuicio": "01371201700497",
            "idJudicatura": "01371",
            "idIncidenteJudicatura": 20181767,
            "aplicativo": "web",
            "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
            "incidente": 1,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert payload[0]["descripcion"] == "Actuacion de ejemplo generada desde payload SATJE."


def test_extract_actuaciones_normalizes_satje_like_response():
    response = {
        "datosProceso": {
            "idJuicio": "01283-2024-00123",
            "numeroProceso": "01283-2024-00123",
        },
        "actuaciones": [
            {
                "fechaActuacion": "2024-05-11",
                "actividad": "AUTO GENERAL",
                "extracto": "Se agrega escrito presentado por la parte actora.",
                "idMovimientoJuicioIncidente": "999",
            }
        ],
    }

    juicio = _extract_juicio_data(response, "01283-2024-00123")
    actuaciones = _extract_actuaciones(response)

    assert juicio["numeroProceso"] == "01283-2024-00123"
    assert actuaciones == [
        {
            "fecha": "2024-05-11",
            "tipo": "AUTO GENERAL",
            "descripcion": "Se agrega escrito presentado por la parte actora.",
            "codigo": None,
            "id_judicatura": None,
            "id_juicio": None,
            "id_movimiento": "999",
            "visible": None,
            "origen": None,
            "tabla_referencia": None,
            "documento_adjunto": None,
            "escape_out": None,
            "nombre_archivo": None,
            "uuid": None,
            "alias": None,
            "tipo_ingreso": None,
            "id_tabla_referencia": None,
            "raw": response["actuaciones"][0],
        }
    ]


def test_extract_actuaciones_normalizes_real_satje_array_response():
    response = [
        {
            "codigo": 159075756,
            "idJudicatura": "01371",
            "idJuicio": "01371201700497 ",
            "fecha": "2020-06-11T21:16:10.000+00:00",
            "tipo": "ENVIO DEL PROCESO AL ARCHIVO GENERAL (RAZON) ",
            "actividad": "<p>RAZON: SE ENVIA EL PROCESO AL ARCHIVO.-CERTIFICO.-CUENCA, 11 DE JUNIO DEL 2020.</p>\n",
            "visible": "A",
            "origen": "ProvPrimera",
            "idMovimientoJuicioIncidente": 19384296,
            "ieTablaReferencia": "ProvPrimera",
            "ieDocumentoAdjunto": "S",
            "escapeOut": "false",
            "uuid": "01d4db08-5fdf-4c94-a1d9-158cdec7a77a",
            "alias": "HBA01",
            "nombreArchivo": "01371201700497_125504102_16_16_14_P20.pdf",
        },
        {
            "codigo": 131051598,
            "idJudicatura": "01371",
            "idJuicio": "01371201700497 ",
            "fecha": "2018-06-27T15:12:00.000+00:00",
            "tipo": "RAZON (RAZON) ",
            "actividad": "RAZON: Siento como tal que el dia de hoy se envia el proceso al archivo general.",
            "visible": "S",
            "origen": "ProvPrimera",
            "idMovimientoJuicioIncidente": 19384296,
            "ieTablaReferencia": "ProvPrimera",
            "ieDocumentoAdjunto": "S",
            "escapeOut": "false",
            "uuid": "b6f50481-59f1-4d87-b2b4-d52650a051bc",
            "alias": "HBA01",
            "nombreArchivo": "01371201700497_10_12_131051598_76967848_P01.pdf",
        },
    ]

    juicio = _normalize_juicio(_extract_juicio_data(response, "01371201700497"))
    actuaciones = _extract_actuaciones(response)

    assert juicio.id_juicio == "01371201700497"
    assert juicio.numero_proceso == "01371201700497"
    assert len(actuaciones) == 2
    assert actuaciones[0]["tipo"] == "ENVIO DEL PROCESO AL ARCHIVO GENERAL (RAZON)"
    assert actuaciones[0]["descripcion"] == (
        "RAZON: SE ENVIA EL PROCESO AL ARCHIVO.-CERTIFICO.-CUENCA, 11 DE JUNIO DEL 2020."
    )
    assert actuaciones[0]["codigo"] == 159075756
    assert actuaciones[0]["id_juicio"] == "01371201700497"
    assert actuaciones[0]["id_movimiento"] == 19384296
    assert actuaciones[0]["nombre_archivo"] == "01371201700497_125504102_16_16_14_P20.pdf"
    assert actuaciones[0]["tabla_referencia"] == "ProvPrimera"
    assert actuaciones[0]["escape_out"] == "false"
    assert actuaciones[0]["alias"] == "HBA01"


def test_extract_actuaciones_accepts_full_real_example_file():
    response = json.loads((EXAMPLES_DIR / "actuaciones-response.example.json").read_text())

    juicio = _normalize_juicio(_extract_juicio_data(response, "01371201700497"))
    actuaciones = _extract_actuaciones(response)

    assert len(response) == 159
    assert juicio.id_juicio == "01371201700497"
    assert juicio.numero_proceso == "01371201700497"
    assert len(actuaciones) == 159
    assert actuaciones[0]["codigo"] == 159075756
    assert actuaciones[0]["fecha"] == "2020-06-11T21:16:10.000+00:00"
    assert actuaciones[0]["visible"] == "A"
    assert actuaciones[0]["tabla_referencia"] == "ProvPrimera"
    assert actuaciones[0]["documento_adjunto"] == "S"
    assert actuaciones[0]["escape_out"] == "false"
    assert actuaciones[0]["alias"] == "HBA01"
    assert actuaciones[0]["tipo_ingreso"] == "O"
    assert actuaciones[0]["id_tabla_referencia"] == "19384296"
    assert actuaciones[0]["descripcion"] == (
        "RAZON: SE ENVIA EL PROCESO AL ARCHIVO.-CERTIFICO.-CUENCA, 11 DE JUNIO DEL 2020."
    )
    assert actuaciones[-1]["codigo"] == 121554299
    assert actuaciones[-1]["fecha"] == "2017-11-13T14:04:00.000+00:00"
