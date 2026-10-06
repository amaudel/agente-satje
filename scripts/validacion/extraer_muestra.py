"""Arma la muestra de validacion a partir de la bitacora de una oficial.

Lee la hoja BASE GESTION (sin fila de encabezados; columnas por posicion, igual
orden que la bitacora consolidada) y escribe un JSONL con SOLO lo necesario para
comparar: numero de juicio y lo que la oficial anoto. NO incluye nombres,
cedulas ni numeros de cuenta.

Uso:
    python extraer_muestra.py <bitacora.xlsx> <salida.jsonl> [n=100] [semilla=7]

La salida contiene datos de la cartera: guardala FUERA de git (la carpeta
datos-privados/ ya esta ignorada).
"""
import json
import random
import re
import sys
import warnings
from collections import defaultdict
from datetime import datetime

import openpyxl

warnings.filterwarnings("ignore")

PATRON_JUICIO = re.compile(r"\d{5}-\d{4}-\d{4,5}")
COL = {
    "juicio": 1,
    "unidadDeprecada": 6,
    "fechaCalifDeprecatorio": 8,
    "medida": 10,
    "fechaInscripcion": 11,
    "fechaGestion": 12,
    "fechaEtapa": 13,
    "etapaGeneral": 14,
    "etapa": 15,
    "controlAbandono": 17,
}


def texto(valor):
    if valor is None:
        return ""
    if isinstance(valor, datetime):
        return valor.strftime("%Y-%m-%d")
    return str(valor).strip()


def clave_etapa(valor):
    t = texto(valor).lower()
    t = re.sub(r"[^a-z0-9. ]", "", t.replace("ó", "o").replace("é", "e").replace("í", "i"))
    return re.sub(r"\s+", " ", t.replace(".", ". ")).strip() or "(sin etapa)"


def main():
    ruta, salida = sys.argv[1], sys.argv[2]
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    semilla = int(sys.argv[4]) if len(sys.argv) > 4 else 7

    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    filas = list(wb["BASE GESTION"].iter_rows(values_only=True))

    candidatos = []
    vistos = set()
    for i, f in enumerate(filas, start=1):
        if not f or not f[0] or not PATRON_JUICIO.fullmatch(str(f[0]).strip()):
            continue
        juicio = str(f[0]).strip()
        if juicio in vistos:
            continue
        vistos.add(juicio)
        reg = {"ref": i}
        for nombre, pos in COL.items():
            reg[nombre] = texto(f[pos - 1]) if pos - 1 < len(f) else ""
        reg["juicio"] = juicio
        candidatos.append(reg)

    rnd = random.Random(semilla)
    por_etapa = defaultdict(list)
    for c in candidatos:
        por_etapa[clave_etapa(c["etapaGeneral"])].append(c)

    elegidos = {}
    total = len(candidatos)
    # 1) cada etapa, proporcional pero con un minimo para no probar solo lo comun
    for etapa, lista in por_etapa.items():
        cupo = min(len(lista), max(4, round(n * len(lista) / total)))
        for c in rnd.sample(lista, cupo):
            elegidos[c["juicio"]] = c

    # 2) garantizar casos con medida inscrita y con unidad deprecada
    def completar(filtro, minimo):
        actuales = sum(1 for c in elegidos.values() if filtro(c))
        resto = [c for c in candidatos if filtro(c) and c["juicio"] not in elegidos]
        rnd.shuffle(resto)
        for c in resto[: max(0, minimo - actuales)]:
            elegidos[c["juicio"]] = c

    completar(lambda c: bool(c["fechaInscripcion"]), 20)
    completar(lambda c: bool(c["unidadDeprecada"]) and c["unidadDeprecada"].lower() != "no aplica", 20)

    lista = list(elegidos.values())
    # 3) recortar al tamano pedido quitando casos de la etapa MAS abundante, de a
    # uno, y prefiriendo los que no tienen fecha de inscripcion: asi las etapas
    # poco frecuentes (ejecucion, sentencia...) no se pierden por azar.
    while len(lista) > n:
        conteo = defaultdict(int)
        for c in lista:
            conteo[clave_etapa(c["etapaGeneral"])] += 1
        mayor = max(conteo, key=conteo.get)
        del_estrato = [c for c in lista if clave_etapa(c["etapaGeneral"]) == mayor]
        sin_inscripcion = [c for c in del_estrato if not c["fechaInscripcion"]]
        lista.remove(rnd.choice(sin_inscripcion or del_estrato))
    rnd.shuffle(lista)

    with open(salida, "w", encoding="utf-8") as fh:
        for c in lista:
            fh.write(json.dumps(c, ensure_ascii=False) + "\n")

    print(f"candidatos con juicio valido: {total} | muestra escrita: {len(lista)} -> {salida}")
    print("por etapa general:")
    for etapa, k in sorted(
        ((e, sum(1 for c in lista if clave_etapa(c['etapaGeneral']) == e)) for e in por_etapa),
        key=lambda x: -x[1],
    ):
        print(f"  {k:>3}  {etapa}")
    print("con fecha de inscripcion de medida:", sum(1 for c in lista if c["fechaInscripcion"]))
    print("con unidad deprecada (deudor):", sum(1 for c in lista if c["unidadDeprecada"] and c["unidadDeprecada"].lower() != "no aplica"))


if __name__ == "__main__":
    main()
