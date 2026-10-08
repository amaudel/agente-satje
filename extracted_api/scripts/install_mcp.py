#!/usr/bin/env python3
"""Activa la capa MCP en un `app/main.py` existente, sin tocar lo que ya tiene.

Solo agrega dos lineas AL FINAL del archivo (importar el router y registrarlo). Antes
guarda un respaldo `main.py.bak-mcp`. Es idempotente: si ya esta instalado no cambia nada.
Pensado para el servidor, cuyo main.py es distinto del que hay en el repositorio.

Uso:
    python install_mcp.py /ruta/al/proyecto/app/main.py --check     # solo informa
    python install_mcp.py /ruta/al/proyecto/app/main.py             # instala

Para revertir: copiar `main.py.bak-mcp` sobre `main.py` y reiniciar el servicio.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ESTADO_INSTALADO = "ya_instalado"
ESTADO_PENDIENTE = "pendiente"
ESTADO_NUEVO = "instalado"

BLOQUE = """

# --- Capa MCP (Streamable HTTP) sobre esta misma API: ver app/mcp_server.py
from .mcp_server import router as mcp_router  # noqa: E402

app.include_router(mcp_router)
"""


def instalar(main_py: Path, solo_comprobar: bool = False) -> str:
    texto = main_py.read_text(encoding="utf-8")
    if "mcp_server" in texto:
        return ESTADO_INSTALADO
    if solo_comprobar:
        return ESTADO_PENDIENTE
    nuevo = texto.rstrip("\n") + "\n" + BLOQUE
    compile(texto, str(main_py), "exec")  # no se modifica un archivo que ya esta roto
    compile(nuevo, str(main_py), "exec")
    shutil.copy2(main_py, main_py.with_name(main_py.name + ".bak-mcp"))
    main_py.write_text(nuevo, encoding="utf-8")
    return ESTADO_NUEVO


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        print(__doc__)
        return 2
    estado = instalar(Path(args[0]), solo_comprobar="--check" in argv)
    mensajes = {
        ESTADO_INSTALADO: "La capa MCP ya está instalada en main.py.",
        ESTADO_PENDIENTE: "La capa MCP NO está instalada (main.py sin cambios).",
        ESTADO_NUEVO: "Instalada. Respaldo en main.py.bak-mcp. Reinicie el servicio para activarla.",
    }
    print(mensajes[estado])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
