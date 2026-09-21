# Respaldo y regresión: idempotencia de BuilderBot

Fecha: 2026-09-21

## Punto de retorno

- Rama remota: `backup/pre-builderbot-idempotency-20260921`
- Commit estable: `dee358b`
- Cambio protegido: deduplicación de ingresos repetidos de BuilderBot.

La rama de respaldo se creó antes de publicar el ajuste. No se debe hacer `push --force` ni reescribir `main` para regresar.

## Estado de integración respaldado

Antes del ajuste, la respuesta HTTP del flujo `Salida` de BuilderBot tenía estas claves:

`info`, `from`, `document_url`, `document_text`, `kw`, `body`, `text`, `query`.

El ajuste agrega únicamente:

`voice_text: {aiVoice}`.

La tabla `webhook_ingress_dedupe` es aditiva y no modifica inventario. En una regresión debe permanecer en la base para conservar la evidencia; el código anterior simplemente no la consulta.

## Regresión segura

1. Crear un commit de reversión sobre `main`; no mover `main` por fuerza.
2. Restaurar los archivos de aplicación desde `backup/pre-builderbot-idempotency-20260921`.
3. En BuilderBot, retirar únicamente la propiedad `voice_text` del cuerpo HTTP de la respuesta `Salida`. No cambiar prompts, reglas ni credenciales.
4. No eliminar `webhook_ingress_dedupe`.
5. Publicar y validar una consulta de solo lectura por texto.
6. Validar una nota de voz sin crear, confirmar, despachar ni recibir inventario.

## Criterio de recuperación

- El dashboard responde normalmente.
- WhatsApp procesa una consulta de stock de solo lectura.
- Los flujos de texto conservan su comportamiento anterior.
- No se crean movimientos de inventario durante la regresión.
