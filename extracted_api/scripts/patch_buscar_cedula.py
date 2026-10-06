"""Parche puntual para app/services.py: busqueda por cedula tolerante a fallos por rol.

Reemplaza SOLO el cuerpo de SatjeService.buscar_causas_por_cedula, sin tocar el
resto del archivo (el services.py del VPS tiene funciones que el del repo no).

Uso, desde la carpeta del proyecto en el VPS:
    python3 scripts/patch_buscar_cedula.py            # aplica (con respaldo)
    python3 scripts/patch_buscar_cedula.py --check    # solo informa si hace falta

Es idempotente: si ya esta aplicado, no cambia nada.
"""
import py_compile
import shutil
import sys
import time
from pathlib import Path

TARGET = Path("app/services.py")
INICIO = '        cache_key = (\n            f"v2:buscar:'
FIN = "    async def actuaciones_por_juicio"

NUEVO = '''        cache_key = (
            f"v3:buscar:{self.client.mode}:{self.client.__class__.__name__}:{cedula}:"
            f"{','.join(sorted(requested_roles))}:{incluir_todas_las_paginas}:"
            f"{settings.satje_page_size}:{settings.satje_max_pages}"
        )
        cached = get_cached(cache_key)
        if cached is not None:
            cached["requestId"] = request_id
            cached["cache"] = {"hit": True, "ttlSeconds": settings.cache_ttl_seconds}
            return cached

        by_id: dict[str, tuple[Juicio, set[str]]] = {}
        partial_errors: list[dict[str, Any]] = []
        last_error: ApiError | None = None
        with operation_timer(
            requestId=request_id,
            endpoint="/api/v1/causas/buscar",
            stage="buscarCausasFlow",
            mode=self.client.mode,
            cedula=mask_cedula(cedula),
        ) as state:
            for role in requested_roles:
                page = 1
                try:
                    while True:
                        raw = await self.client.buscar_causas_por_cedula(
                            cedula,
                            role=role,
                            page=page,
                            size=settings.satje_page_size,
                        )
                        rows = _extract_rows(raw)
                        for row in rows:
                            juicio = _normalize_juicio(row)
                            if not juicio.id_juicio:
                                continue
                            existing = by_id.setdefault(juicio.id_juicio, (juicio, set()))
                            existing[1].add(role)
                        if not incluir_todas_las_paginas or len(rows) < settings.satje_page_size:
                            break
                        page += 1
                        if page > settings.satje_max_pages:
                            break
                except ApiError as exc:
                    # Un rol caido no debe tumbar la busqueda entera: se devuelve
                    # lo que si se obtuvo y se marca el resultado como parcial.
                    last_error = exc
                    partial_errors.append(
                        {
                            "role": role,
                            "code": exc.code.value,
                            "message": exc.message or exc.code.value,
                            "upstreamStatusCode": exc.status_code,
                            "upstreamCode": None,
                            "retryable": exc.retryable,
                        }
                    )
            state["causas"] = len(by_id)

        # Si fallaron TODOS los roles no hay nada que devolver: se propaga el
        # error en vez de responder 200 con una lista vacia enganosa.
        if last_error is not None and len(partial_errors) == len(requested_roles):
            raise last_error

        data = [juicio_to_frontend(juicio, roles_found) for juicio, roles_found in by_id.values()]
        result = {
            "success": True,
            "source": "SATJE",
            "mode": self.client.mode,
            "retrievedAt": now_iso(),
            "cedula": cedula,
            "total": len(data),
            "data": data,
            "partial": bool(partial_errors),
            "partialErrors": partial_errors,
            "requestId": request_id,
            "cache": {"hit": False, "ttlSeconds": settings.cache_ttl_seconds},
        }
        # Un resultado parcial no se cachea: el siguiente intento debe poder
        # recuperar el rol que fallo.
        if not partial_errors:
            set_cached(cache_key, {**result, "requestId": None})
        return result
'''


def main() -> int:
    solo_revisar = "--check" in sys.argv
    if not TARGET.exists():
        print(f"ERROR: no encuentro {TARGET}. Ejecuta esto desde la carpeta del proyecto.")
        return 2

    texto = TARGET.read_text(encoding="utf-8")

    if '"v3:buscar:' in texto and '"partialErrors": partial_errors' in texto.split("def buscar_causas_por_cedula", 1)[-1].split(FIN, 1)[0]:
        print("Ya aplicado: buscar_causas_por_cedula ya maneja errores parciales por rol.")
        return 0

    if texto.count(INICIO) != 1 or texto.count(FIN) != 1:
        print("ERROR: no reconozco la forma de la funcion (marcadores no encontrados o repetidos).")
        print("No se modifico nada. Revisa el archivo a mano.")
        return 3

    inicio = texto.index(INICIO)
    fin = texto.index(FIN, inicio)
    if solo_revisar:
        print("Hace falta aplicar el parche (la funcion actual no devuelve partial/partialErrors).")
        return 1

    respaldo = TARGET.with_name(f"services.py.bak-{time.strftime('%Y%m%dT%H%M%S')}")
    shutil.copy2(TARGET, respaldo)
    nuevo_texto = texto[:inicio] + NUEVO.rstrip("\n") + "\n\n" + texto[fin:]
    TARGET.write_text(nuevo_texto, encoding="utf-8")

    try:
        py_compile.compile(str(TARGET), doraise=True)
    except py_compile.PyCompileError as exc:
        shutil.copy2(respaldo, TARGET)
        print(f"ERROR de sintaxis tras el parche; se restauro el respaldo. Detalle: {exc}")
        return 4

    print(f"Parche aplicado. Respaldo en {respaldo}")
    print("Reinicia el servicio: systemctl restart ecuador-judicial-api")
    return 0


if __name__ == "__main__":
    sys.exit(main())
