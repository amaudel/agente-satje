import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "scripts"))

from install_mcp import ESTADO_INSTALADO, ESTADO_PENDIENTE, instalar  # noqa: E402

MAIN_MINIMO = "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get('/health')\ndef health():\n    return {'status': 'ok'}\n"


def test_comprobar_no_modifica_nada(tmp_path):
    main = tmp_path / "main.py"
    main.write_text(MAIN_MINIMO, encoding="utf-8")
    assert instalar(main, solo_comprobar=True) == ESTADO_PENDIENTE
    assert main.read_text(encoding="utf-8") == MAIN_MINIMO
    assert not list(tmp_path.glob("*.bak*"))


def test_instala_una_vez_con_respaldo_y_el_codigo_sigue_compilando(tmp_path):
    main = tmp_path / "main.py"
    main.write_text(MAIN_MINIMO, encoding="utf-8")
    assert instalar(main) == "instalado"
    texto = main.read_text(encoding="utf-8")
    assert texto.startswith(MAIN_MINIMO)  # no toca lo anterior: solo agrega al final
    assert "from .mcp_server import router as mcp_router" in texto and "app.include_router(mcp_router)" in texto
    compile(texto, "main.py", "exec")
    respaldo = tmp_path / "main.py.bak-mcp"
    assert respaldo.read_text(encoding="utf-8") == MAIN_MINIMO


def test_es_idempotente(tmp_path):
    main = tmp_path / "main.py"
    main.write_text(MAIN_MINIMO, encoding="utf-8")
    instalar(main)
    primera = main.read_text(encoding="utf-8")
    assert instalar(main) == ESTADO_INSTALADO
    assert main.read_text(encoding="utf-8") == primera
    assert primera.count("include_router(mcp_router)") == 1


def test_no_toca_un_main_que_no_compila(tmp_path):
    main = tmp_path / "main.py"
    roto = "def (:\n"
    main.write_text(roto, encoding="utf-8")
    try:
        instalar(main)
    except SyntaxError:
        pass
    else:
        raise AssertionError("debia negarse a modificar un archivo que ya no compila")
    assert main.read_text(encoding="utf-8") == roto
