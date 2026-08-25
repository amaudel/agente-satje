# Capturar endpoint real de Función Judicial

Desde este VPS el dominio oficial queda en timeout, así que el endpoint real debe capturarse desde una red donde sí abra:

1. Abre Chrome en tu computadora.
2. Entra a `https://procesosjudiciales.funcionjudicial.gob.ec/expel-juicios`.
3. Presiona `F12` o clic derecho -> `Inspect`.
4. Abre la pestaña `Network`.
5. Activa `Fetch/XHR`.
6. Busca una cédula/RUC o nombre de prueba.
7. En la lista de requests, abre el request que devuelve resultados.
8. Copia estos datos:
   - `Request URL`
   - `Request Method`
   - `Query String Parameters` o `Request Payload`
   - `Response` JSON
   - Si hay headers especiales, copia los de `Accept`, `Content-Type`, `Authorization`, `X-*` y cookies no sensibles.
9. Envíame captura o texto de esos datos.

Con eso se actualiza `app/source.py` para consultar la API oficial en vez del modo demo.

## Capturar actuaciones para generar PDF

Confirmado: el boton `EXTRACTO PDF` del SATJE no descarga un PDF consolidado desde
una URL directa. La pagina envia un `POST` para obtener las actuaciones en JSON y
con esos datos arma/muestra el contenido. Por eso nuestra API debe generar el PDF
propio desde ese JSON.

Para capturar el request correcto:

1. En DevTools -> `Network`, activa `Preserve log`.
2. Limpia la lista de requests.
3. Haz clic en `EXTRACTO PDF`.
4. Revisa la pestana `Fetch/XHR`.
5. Abre el `POST` que devuelve JSON de actuaciones.
6. Copia:
   - `Request URL`
   - `Request Method`
   - `Query String Parameters` o `Request Payload`
   - `Response` JSON
   - `Response Headers`, sobre todo `content-type`
   - Headers especiales: `Accept`, `Content-Type`, `Authorization`, `X-*`

No pegues cookies ni tokens privados si aparecen. Con el payload y el JSON de
respuesta basta para conectar `app/source.py` al formato oficial y mantener
nuestro endpoint `/pdf` como generador comercial.

## Payload real capturado

El request real para buscar causas por cedula es:

```text
POST https://api.funcionjudicial.gob.ec/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/buscarCausas?page=1&size=10
```

Payload capturado para la cedula `0104270855`:

```json
{
  "numeroCausa": "",
  "actor": {
    "cedulaActor": "0104270855",
    "nombreActor": ""
  },
  "demandado": {
    "cedulaDemandado": "",
    "nombreDemandado": ""
  },
  "provincia": "",
  "numeroFiscalia": "",
  "recaptcha": "verdad",
  "first": 1,
  "pageSize": 10
}
```

El archivo editable queda en `examples/buscar-causas-request.payload.json`.

El response real capturado queda en
`examples/buscar-causas-response.example.json`. SATJE devuelve un arreglo JSON
directo con campos como `id`, `idJuicio`, `estadoActual`, `idMateria`,
`nombreDelito`, `fechaIngreso` e `iedocumentoAdjunto`.

## Payload real capturado de actuaciones

El request real que dispara `EXTRACTO PDF` es:

```text
POST https://api.funcionjudicial.gob.ec/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/actuacionesJudiciales
```

Payload capturado:

```json
{
  "idMovimientoJuicioIncidente": 19384296,
  "idJuicio": "01371201700497",
  "idJudicatura": "01371",
  "idIncidenteJudicatura": 20181767,
  "aplicativo": "web",
  "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
  "incidente": 1
}
```

El archivo editable queda en `examples/actuaciones-request.payload.json`. El
adaptador oficial usa la ruta real anterior. Para no perder campos importantes,
los endpoints `POST /api/juicio`, `POST /api/juicio/actuaciones` y
`POST /api/juicio/pdf` aceptan este payload completo.

Prueba local para ver solo actuaciones JSON:

```bash
curl -X POST -H 'X-API-Key: demo-key-change-me' \
  -H 'Content-Type: application/json' \
  --data @examples/actuaciones-request.payload.json \
  http://127.0.0.1:8010/api/juicio/actuaciones
```

Prueba local para generar PDF desde esas actuaciones:

```bash
curl -X POST -H 'X-API-Key: demo-key-change-me' \
  -H 'Content-Type: application/json' \
  --data @examples/actuaciones-request.payload.json \
  -o extracto.pdf \
  http://127.0.0.1:8010/api/juicio/pdf
```

## Ejemplo de response JSON

Confirmado con captura de navegador: `actuacionesJudiciales` devuelve un arreglo
JSON directo de actuaciones. La captura completa guardada trae 159 items. Cada
item trae campos como `codigo`, `idJudicatura`, `idJuicio`, `fecha`, `tipo`,
`actividad`, `visible`, `origen`, `idMovimientoJuicioIncidente`,
`ieTablaReferencia`, `ieDocumentoAdjunto`, `escapeOut`, `uuid`, `alias`,
`nombreArchivo`, `tipoIngreso` e `idTablaReferencia`.

El parser tambien acepta respuestas con listas bajo `actuaciones`, `data`,
`items`, `movimientos`, `actividades` o `providencias`. Intenta tomar la
cabecera del proceso desde `juicio`, `proceso`, `causa`, `cabecera` o
`datosProceso`; si la respuesta es un arreglo directo, usa la primera actuacion
como base minima para `idJuicio`/`numeroProceso`.

Ejemplo completo guardado en `examples/actuaciones-response.example.json`. Forma
del primer item:

```json
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
  "tipoIngreso": "O",
  "idTablaReferencia": "19384296"
}
```

Con esto ya no falta la muestra de response para el flujo de actuaciones.

Rutas públicas vistas como candidatas durante la investigación:

- `https://procesosjudiciales.funcionjudicial.gob.ec/expel-juicios`
- `https://procesosjudiciales.funcionjudicial.gob.ec/movimientos`
- `https://api.funcionjudicial.gob.ec/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/actuacionesJudiciales`
- `https://procesosjudiciales.funcionjudicial.gob.ec/busqueda-filtros`
- `https://procesosjudiciales.funcionjudicial.gob.ec/busqueda-por-juez`
