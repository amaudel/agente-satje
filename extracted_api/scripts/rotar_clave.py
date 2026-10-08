#!/usr/bin/env python3
"""Rota la clave de la API (API_KEYS del .env) en dos tiempos, sin mostrar nunca la clave.

Paso 1 (agregar): genera una clave aleatoria de 256 bits, la AGREGA a API_KEYS (las anteriores
siguen valiendo, asi ningun consumidor se corta), la guarda en `nueva-clave-api.txt` junto al
.env con permisos 600 y solo imprime una huella corta (SHA-256, 8 caracteres). Hace un respaldo
del .env. Despues se reinicia el servicio y se actualizan los consumidores (panel en Vercel,
Worker de Cloudflare, scripts...) copiando la clave desde ese archivo.

Paso 2 (retirar): cuando todos los consumidores usan la clave nueva, deja SOLO la nueva en
API_KEYS. Exige --confirmo. No toca OPS_API_KEYS ni ninguna otra variable.

Uso:
    python rotar_clave.py /ruta/.env --agregar
    python rotar_clave.py /ruta/.env --retirar-anteriores --confirmo
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import shutil
import sys
import time
from pathlib import Path

NOMBRE_ARCHIVO_CLAVE = "nueva-clave-api.txt"
_LINEA = re.compile(r"^(API_KEYS=)(['\"]?)(.*?)(\2)\s*$")


def _leer_api_keys(lineas: list[str]) -> tuple[int, str, str, list[str]]:
    for i, linea in enumerate(lineas):
        m = _LINEA.match(linea.rstrip("\n"))
        if m:
            claves = [c.strip() for c in m.group(3).split(",") if c.strip()]
            return i, m.group(1), m.group(2), claves
    raise SystemExit("El archivo no tiene una línea API_KEYS=... No se modificó nada.")


def _escribir(ruta: Path, lineas: list[str]) -> None:
    ruta.write_text("".join(lineas), encoding="utf-8")
    try:
        os.chmod(ruta, 0o600)
    except OSError:
        pass


def _respaldar(ruta: Path) -> None:
    respaldo = ruta.with_name(f"{ruta.name}.bak-rotacion-{time.strftime('%Y%m%dT%H%M%S')}")
    shutil.copy2(ruta, respaldo)
    try:
        os.chmod(respaldo, 0o600)
    except OSError:
        pass


def agregar_clave_nueva(ruta: Path) -> str:
    lineas = ruta.read_text(encoding="utf-8").splitlines(keepends=True)
    i, prefijo, comilla, claves = _leer_api_keys(lineas)  # falla antes de tocar nada
    nueva = secrets.token_hex(32)
    _respaldar(ruta)
    lineas[i] = f"{prefijo}{comilla}{','.join(claves + [nueva])}{comilla}\n"
    _escribir(ruta, lineas)

    archivo = ruta.with_name(NOMBRE_ARCHIVO_CLAVE)
    archivo.write_text(nueva + "\n", encoding="utf-8")
    try:
        os.chmod(archivo, 0o600)
    except OSError:
        pass
    return hashlib.sha256(nueva.encode()).hexdigest()[:8]


def retirar_claves_anteriores(ruta: Path, confirmo: bool) -> None:
    archivo = ruta.with_name(NOMBRE_ARCHIVO_CLAVE)
    if not confirmo:
        raise SystemExit("Falta --confirmo: este paso deja de aceptar las claves anteriores.")
    if not archivo.exists():
        raise SystemExit(f"No encuentro {archivo}. Ejecute primero --agregar.")
    nueva = archivo.read_text(encoding="utf-8").strip()
    lineas = ruta.read_text(encoding="utf-8").splitlines(keepends=True)
    i, prefijo, comilla, claves = _leer_api_keys(lineas)
    if nueva not in claves:
        raise SystemExit("La clave nueva no está en API_KEYS. No se modificó nada.")
    _respaldar(ruta)
    lineas[i] = f"{prefijo}{comilla}{nueva}{comilla}\n"
    _escribir(ruta, lineas)


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if len(args) != 1 or not ({"--agregar", "--retirar-anteriores"} & set(argv)):
        print(__doc__)
        return 2
    ruta = Path(args[0])
    if "--agregar" in argv:
        huella = agregar_clave_nueva(ruta)
        print(f"Clave nueva agregada. Huella: {huella}")
        print(f"Guardada en {ruta.with_name(NOMBRE_ARCHIVO_CLAVE)} (permisos 600). Reinicie el servicio y actualice los consumidores.")
    else:
        retirar_claves_anteriores(ruta, confirmo="--confirmo" in argv)
        print("Quedó solo la clave nueva en API_KEYS. Reinicie el servicio.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
