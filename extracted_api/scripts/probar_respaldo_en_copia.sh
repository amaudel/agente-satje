#!/usr/bin/env bash
# Prueba un services.py (y opcionalmente un satje_client.py) de RESPALDO en una copia
# aparte del proyecto, en otro puerto (8011). NO toca la produccion: no modifica
# archivos del proyecto ni reinicia el servicio.
#
# Uso (el puerto 8011 puede estar ocupado por otro programa: PUERTO=8021 bash ...):
#   bash probar_respaldo_en_copia.sh <services.py de respaldo> [<satje_client.py de respaldo>]
#
# Despues se verifica la copia con:
#   .venv/bin/python /root/mcp_verificar.py --base http://127.0.0.1:8011 --proceso 01333-2024-12766
# Y se apaga con:
#   kill $(cat /root/stg-satje/pid)
set -u

ORIGEN=/home/ubuntu/.openclaw/workspace/projects/ecuador-judicial-api
COPIA=/root/stg-satje
PUERTO="${PUERTO:-8011}"   # se puede cambiar: PUERTO=8021 bash probar_respaldo_en_copia.sh ...
SERVICES="${1:-}"
CLIENTE="${2:-}"

if [ -z "$SERVICES" ] || [ ! -f "$SERVICES" ]; then
  echo "Falta el archivo services.py de respaldo (o no existe)."
  echo "Uso: bash $0 <services.py de respaldo> [<satje_client.py de respaldo>]"
  exit 2
fi
if [ -e "$COPIA" ]; then
  echo "Ya existe $COPIA. Si es una prueba anterior: kill \$(cat $COPIA/pid) y bórrela a mano antes de repetir."
  exit 1
fi

if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$PUERTO$"; then
  echo "El puerto $PUERTO YA está ocupado por otro programa. Use otro: PUERTO=8021 bash $0 ..."
  ss -ltnp 2>/dev/null | grep ":$PUERTO " | head -2
  exit 1
fi

mkdir -p "$COPIA"
# copia del proyecto sin el entorno virtual, sin bases de datos y sin cachés
tar -C "$(dirname "$ORIGEN")" -cf - --exclude=.venv --exclude='*.sqlite3*' --exclude=__pycache__ --exclude='*.bak*' "$(basename "$ORIGEN")" \
  | tar -C "$COPIA" --strip-components=1 -xf -

cp "$SERVICES" "$COPIA/app/services.py"
if [ -n "$CLIENTE" ]; then
  [ -f "$CLIENTE" ] && cp "$CLIENTE" "$COPIA/app/satje_client.py" || echo "AVISO: no se encontró $CLIENTE"
fi

cd "$COPIA" || exit 1
if ! "$ORIGEN/.venv/bin/python" -B -c "import app.main" 2> "$COPIA/import-error.txt"; then
  echo "La copia NO importa. Primeras líneas del error:"
  tail -8 "$COPIA/import-error.txt"
  exit 1
fi
echo "La copia importa bien."

nohup "$ORIGEN/.venv/bin/python" -B -m uvicorn app.main:app --host 127.0.0.1 --port "$PUERTO" > "$COPIA/stg.log" 2>&1 &
echo $! > "$COPIA/pid"

for _ in $(seq 1 20); do
  if ! kill -0 "$(cat "$COPIA/pid")" 2>/dev/null; then
    echo "El proceso de la copia se detuvo. Últimas líneas del registro:"
    tail -10 "$COPIA/stg.log"
    exit 1
  fi
  if curl -s "http://127.0.0.1:$PUERTO/health" | grep -q '"status"'; then
    echo "Copia de prueba activa en el puerto $PUERTO (PID $(cat "$COPIA/pid"))."
    exit 0
  fi
  sleep 1
done
echo "La copia no respondió en 20 s. Últimas líneas del registro:"
tail -10 "$COPIA/stg.log"
exit 1
