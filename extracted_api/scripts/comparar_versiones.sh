#!/usr/bin/env bash
# Compara dos servidores de la API (produccion y copia de prueba) en lo que mas usa el panel:
# busqueda por cedula, actuaciones y documentos. Solo muestra estados y conteos, nunca
# datos de personas ni la clave.
#
# Uso:  bash comparar_versiones.sh <cedula de 10 digitos> [puerto produccion=8010] [puerto copia=8021] [idJuicio]
# Necesita la variable SATJE_API_KEY cargada.
set -u

CEDULA="${1:-}"
PROD="${2:-8010}"
COPIA="${3:-8021}"
ID="${4:-01333202412766}"

if [ -z "$CEDULA" ] || ! printf '%s' "$CEDULA" | grep -Eq '^[0-9]{10}$'; then
  echo "Escriba su cédula de 10 dígitos, solo números. Ejemplo:"
  echo "  bash $0 0102030405"
  exit 2
fi
if [ -z "${SATJE_API_KEY:-}" ]; then
  echo "Falta cargar la clave (SATJE_API_KEY)."
  exit 2
fi
command -v jq >/dev/null || { echo "Falta jq."; exit 2; }

CURL=(curl -s -m 150 -H "X-API-Key: $SATJE_API_KEY")

cedula() {
  "${CURL[@]}" -X POST -H "Content-Type: application/json" \
    -d "{\"cedula\":\"$CEDULA\",\"roles\":[\"demandado\"],\"incluirTodasLasPaginas\":false}" \
    "http://127.0.0.1:$1/api/v1/causas/buscar" \
    | jq -c '{success, partial, total, errores: [.partialErrors[]?.code]}' 2>/dev/null || echo '"sin respuesta"'
}

actuaciones() {
  "${CURL[@]}" "http://127.0.0.1:$1/api/v1/causas/$ID/actuaciones" \
    | jq -c '{success, total: .totalActuaciones, incidentes: [.incidentes[]?.totalActuaciones], errores: (.partialErrors|length)}' 2>/dev/null || echo '"sin respuesta"'
}

documentos() {
  local cod
  cod=$("${CURL[@]}" "http://127.0.0.1:$PROD/api/v1/causas/$ID/actuaciones" | jq -r '.incidentes[0].actuaciones[0].codigo' 2>/dev/null)
  "${CURL[@]}" "http://127.0.0.1:$1/api/v1/causas/$ID/actuaciones/$cod/documentos" \
    | jq -c '{success, total}' 2>/dev/null || echo '"sin respuesta"'
}

comparar() {
  local nombre="$1" a="$2" b="$3"
  if [ "$a" = "$b" ]; then
    echo "  IGUAL      $nombre"
  else
    echo "  DIFERENTE  $nombre"
  fi
}

echo "Comparando producción (puerto $PROD) con la copia (puerto $COPIA)..."
echo
C1=$(cedula "$PROD");        C2=$(cedula "$COPIA")
A1=$(actuaciones "$PROD");   A2=$(actuaciones "$COPIA")
D1=$(documentos "$PROD");    D2=$(documentos "$COPIA")

echo "Búsqueda por cédula"
echo "  producción: $C1"
echo "  copia:      $C2"
echo "Actuaciones del juicio"
echo "  producción: $A1"
echo "  copia:      $A2"
echo "Documentos de la primera actuación"
echo "  producción: $D1"
echo "  copia:      $D2"
echo
echo "RESUMEN"
comparar "búsqueda por cédula" "$C1" "$C2"
comparar "actuaciones" "$A1" "$A2"
comparar "documentos" "$D1" "$D2"
echo
echo "Si algo sale DIFERENTE, repita una vez: SATJE a veces responde a medias y cambia entre una consulta y otra."
