import hashlib
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "scripts"))

from rotar_clave import agregar_clave_nueva, retirar_claves_anteriores  # noqa: E402

ENV = 'ENTORNO=produccion\nAPI_KEYS="vieja-uno,vieja-dos"\nOPS_API_KEYS=operativa\nOTRA=algo con = signo\n'


def _env(tmp_path, texto=ENV):
    ruta = tmp_path / ".env"
    ruta.write_text(texto, encoding="utf-8")
    return ruta


def test_agrega_una_clave_nueva_conservando_las_anteriores_y_el_resto_del_archivo(tmp_path):
    ruta = _env(tmp_path)
    huella = agregar_clave_nueva(ruta)
    texto = ruta.read_text(encoding="utf-8")
    nueva = (tmp_path / "nueva-clave-api.txt").read_text(encoding="utf-8").strip()
    assert len(nueva) == 64 and nueva not in ("vieja-uno", "vieja-dos")
    assert f'API_KEYS="vieja-uno,vieja-dos,{nueva}"' in texto  # conserva las comillas y el orden
    for linea in ("ENTORNO=produccion", "OPS_API_KEYS=operativa", "OTRA=algo con = signo"):
        assert linea in texto
    assert huella == hashlib.sha256(nueva.encode()).hexdigest()[:8]


def test_hace_respaldo_y_nunca_imprime_la_clave(tmp_path, capsys):
    ruta = _env(tmp_path)
    huella = agregar_clave_nueva(ruta)
    nueva = (tmp_path / "nueva-clave-api.txt").read_text(encoding="utf-8").strip()
    salida = capsys.readouterr()
    assert nueva not in salida.out + salida.err
    assert huella  # solo se informa una huella corta, no la clave
    respaldos = list(tmp_path.glob(".env.bak-rotacion-*"))
    assert len(respaldos) == 1 and respaldos[0].read_text(encoding="utf-8") == ENV


def test_sin_comillas_tambien_funciona(tmp_path):
    ruta = _env(tmp_path, "API_KEYS=unica\n")
    agregar_clave_nueva(ruta)
    nueva = (tmp_path / "nueva-clave-api.txt").read_text(encoding="utf-8").strip()
    assert ruta.read_text(encoding="utf-8").strip() == f"API_KEYS=unica,{nueva}"


def test_retirar_deja_solo_la_clave_nueva_y_exige_confirmacion(tmp_path):
    ruta = _env(tmp_path)
    agregar_clave_nueva(ruta)
    nueva = (tmp_path / "nueva-clave-api.txt").read_text(encoding="utf-8").strip()
    with pytest.raises(SystemExit):
        retirar_claves_anteriores(ruta, confirmo=False)
    assert "vieja-uno" in ruta.read_text(encoding="utf-8")  # sin confirmar no cambia nada
    retirar_claves_anteriores(ruta, confirmo=True)
    texto = ruta.read_text(encoding="utf-8")
    assert f'API_KEYS="{nueva}"' in texto and "vieja-uno" not in texto and "vieja-dos" not in texto
    assert "OPS_API_KEYS=operativa" in texto  # la clave operativa no se toca


def test_no_modifica_un_archivo_sin_api_keys(tmp_path):
    ruta = _env(tmp_path, "OTRA=1\n")
    with pytest.raises(SystemExit):
        agregar_clave_nueva(ruta)
    assert ruta.read_text(encoding="utf-8") == "OTRA=1\n"
    assert not (tmp_path / "nueva-clave-api.txt").exists()
