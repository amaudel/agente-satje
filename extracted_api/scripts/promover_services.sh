#!/usr/bin/env bash
# Pone un services.py nuevo en el servicio de produccion, con copia de seguridad y marcha
# atras AUTOMATICA si algo falla. Antes de usarlo, el archivo debe haberse probado en una
# copia aparte (probar_respaldo_en_copia.sh + comparar_versiones.sh).
#
# Uso:
#   bash promover_services.sh <services.py nuevo> [--simular]
# Necesita la variable SATJE_API_KEY cargada (se usa para las pruebas posteriores).
#
# Con --simular solo muestra lo que haria, sin cambiar nada.
set -u

ORIGEN=/home/ubuntu/.openclaw/workspace/projects/ecuador-judicial-api
SERVICIO=ecuador-judicial-api
PUERTO=8010
PROCESO=01333-2024-12766
ID=01333202412766

NUEVO="${1:-}"
SIMULAR=0
[ "${2:-}" = "--simular" ] && SIMULAR=1

ejecutar() {
  if [ "$SIMULAR" = 1 ]; then echo "  (simulación) $*"; else "$@"; fi
}

if [ -z "$NUEVO" ] || [ ! -f "$NUEVO" ]; then
  echo "Falta el services.py nuevo (o no existe)."
  echo "Uso: bash $0 <services.py nuevo> [--simular]"
  exit 2
fi
if [ "$SIMULAR" = 0 ] && [ -z "${SATJE_API_KEY:-}" ]; then
  echo "Falta cargar la clave (SATJE_API_KEY)."
  exit 2
fi
if [ "$SIMULAR" = 0 ] && [ ! -f "$ORIGEN/app/services.py" ]; then
  echo "No encuentro $ORIGEN/app/services.py"
  exit 2
fi

SELLO=$(date +%Y%m%dT%H%M%S)
RESPALDO="$ORIGEN/app/services.py.bak-antes-restaurar-$SELLO"

revertir() {
  echo "REVIRTIENDO a la versión anterior..."
  cp -p "$RESPALDO" "$ORIGEN/app/services.py"
  systemctl restart "$SERVICIO"
  sleep 4
  echo "Servicio: $(systemctl is-active "$SERVICIO")  (versión anterior restaurada desde $RESPALDO)"
}

codigo_http() {
  curl -s -m 100 -o /dev/null -w "%{http_code}" -H "X-API-Key: $SATJE_API_KEY" "http://127.0.0.1:$PUERTO$1"
}

echo "1. Copia de seguridad de services.py actual"
ejecutar cp -p "$ORIGEN/app/services.py" "$RESPALDO"
echo "2. Poner el services.py nuevo"
ejecutar cp "$NUEVO" "$ORIGEN/app/services.py"
ejecutar chown --reference="$ORIGEN/app/main.py" "$ORIGEN/app/services.py"

echo "3. Comprobar que la aplicación importa"
if [ "$SIMULAR" = 1 ]; then
  echo "  (simulación) importar app.main con el .venv del proyecto"
else
  if ! (cd "$ORIGEN" && .venv/bin/python -B -c "import app.main" 2>/tmp/promover-import.txt); then
    echo "NO importa. Primeras líneas del error:"; tail -6 /tmp/promover-import.txt
    cp -p "$RESPALDO" "$ORIGEN/app/services.py"
    echo "Se restauró el services.py anterior (el servicio no se tocó)."
    exit 1
  fi
fi

echo "4. Reiniciar el servicio"
ejecutar systemctl restart "$SERVICIO"
if [ "$SIMULAR" = 0 ]; then
  sleep 5
  [ "$(systemctl is-active "$SERVICIO")" = "active" ] || { echo "El servicio no quedó activo."; revertir; exit 1; }
fi

echo "5. Pruebas de humo"
if [ "$SIMULAR" = 1 ]; then
  echo "  (simulación) GET /health, /actuaciones y /resolver; si alguna no da 200, se revierte sola"
else
  for _ in 1 2 3 4 5 6; do curl -s -o /dev/null "http://127.0.0.1:$PUERTO/health" && break; sleep 2; done
  R1=$(codigo_http "/api/v1/causas/$ID/actuaciones")
  R2=$(codigo_http "/api/v1/causas/resolver/$PROCESO")
  echo "  actuaciones (lo que usa el panel): HTTP $R1"
  echo "  resolver (lo que faltaba):         HTTP $R2"
  if [ "$R1" != "200" ] || [ "$R2" != "200" ]; then
    echo "Una prueba falló."
    revertir
    exit 1
  fi
fi

echo
echo "LISTO. services.py actualizado."
echo "Copia de seguridad: $RESPALDO"
echo "Para volver atrás a mano:"
echo "  cp -p $RESPALDO $ORIGEN/app/services.py && systemctl restart $SERVICIO"
