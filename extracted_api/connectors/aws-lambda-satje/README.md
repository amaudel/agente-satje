# SATJE AWS Lambda Connector

Conector liviano para llamar SATJE desde AWS Lambda Function URL y evitar depender de Apify como ruta principal.

## Despliegue automatico

Requisitos:

- AWS CLI instalado.
- Credenciales AWS configuradas con permisos para IAM y Lambda.

Ejecutar desde la raiz del proyecto:

```bash
AWS_REGION=us-east-1 ./connectors/aws-lambda-satje/deploy.sh
```

El script hace lo necesario:

- Empaqueta `index.mjs`.
- Crea o reutiliza el rol IAM minimo para logs de Lambda.
- Crea o actualiza la funcion `satje-aws-lambda-connector`.
- Crea la Function URL con `Auth type: NONE`.
- Protege la URL con `Authorization: Bearer ...` y `connectorToken`.
- Ejecuta un smoke test real contra SATJE.
- Guarda las variables para la API principal en `.satje-lambda-output.env`.

Los secretos quedan en `.satje-lambda.env` y ambos archivos estan ignorados por git.

Para volver a probar la Function URL despues del despliegue:

```bash
./connectors/aws-lambda-satje/smoke-test.sh
```

## Despliegue manual

1. Crear la funcion Lambda con runtime Node.js 20.x o 22.x.
2. Subir `index.mjs`.
3. Configurar Function URL con `Auth type: NONE`.
4. Definir variables de entorno en Lambda:

```env
CONNECTOR_TOKEN=secreto-interno-conector
LAMBDA_API_TOKEN=secreto-url-lambda
```

5. Configurar la API principal:

```env
SATJE_MODE=live
SATJE_LIVE_BACKEND=aws_lambda
SATJE_LAMBDA_FUNCTION_URL=https://xxxx.lambda-url.us-east-1.on.aws/
SATJE_LAMBDA_API_TOKEN=secreto-url-lambda
SATJE_CONNECTOR_INTERNAL_TOKEN=secreto-interno-conector
SATJE_CONNECTOR_TIMEOUT_SECONDS=30
SATJE_CONNECTOR_MAX_CONCURRENCY=2
SATJE_CONNECTOR_RETRY_ATTEMPTS=2
SATJE_CONNECTOR_BACKOFF_SECONDS=1
```

El contrato de entrada y salida es compatible con el cliente principal de la API. Apify puede quedar configurado aparte como respaldo operacional.
