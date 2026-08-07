# Productor determinista WMS a Buzz

## Alcance

Este componente nivel 0 genera un evento `agent.status` compatible con Buzz 1.0. No usa LLM, base de datos, SIIGO, BuilderBot, red ni secretos. Su costo de modelo es siempre `model_cost_usd: 0`.

El productor solo lee:

- `config/buzz-status.json`, un manifest con codigos allowlistados;
- el commit y la fecha de `HEAD` mediante Git;
- el snapshot contractual `contracts/buzz-event-1.0.schema.json` durante las pruebas.

El snapshot tiene SHA-256 `3e41e11097174b79126761019d92e9b706361830b9a2b90846aedb8bbd9d677f`, idéntico al contrato leído en solo lectura desde `NoBS/infra/buzz-lamano/contracts/event.schema.json` el 2026-08-06.

## Contenido y confianza

El evento incluye únicamente:

- commit WMS resuelto desde Git, con confianza `verificado-repo`;
- resultado de la corrida local segura, con fecha, fuente, cantidad y confianza `verificado-repo`;
- bloqueadores de BOM, unidades, ubicaciones y usuarios como estado `reportado`;
- estado SIIGO tomado de documentación versionada como `reportado`, indicando expresamente que no se consultó SIIGO y que no se infieren obligaciones contractuales;
- siguiente acción humana;
- referencias opacas `wms-evidence://...`.

No incluye teléfonos, correos, nombres, credenciales, variables de entorno, inventario detallado, SKU, lotes, facturas ni payloads de terceros. Los campos libres, códigos desconocidos, pruebas fallidas y commits no verificables producen error y no generan evento.

## Dry-run

La operación predeterminada solo escribe JSON canónico en la salida estándar:

```powershell
npm run buzz:event:dry-run
```

Para crear deliberadamente un archivo nuevo y sin sobrescribir evidencia existente:

```powershell
npm run buzz:event:dry-run -- --output .tmp/wms-buzz-event.json
```

No existe una opción de publicación en WMS. El `event_id` se deriva por SHA-256 del contenido semántico sin ID; el mismo commit y manifest producen siempre el mismo evento e ID.

## Publicación futura mediante el broker autorizado

La Mano debe conservar la separación de responsabilidades. WMS genera el archivo, pero la publicación se realiza desde el repositorio y runtime autorizados de NoBS:

```powershell
# 1. En WMS: generar evidencia local, sin red.
npm run buzz:event:dry-run -- --output .tmp/wms-buzz-event.json

# 2. Un operador autorizado entrega ese archivo al proceso de La Mano.
# 3. Desde NoBS, el broker valida y encola el evento.
py infra/buzz-lamano/lamano_outbox.py enqueue --file <ruta-al-evento-wms.json>

# 4. Consultar el estado sin acceder a credenciales.
py infra/buzz-lamano/lamano_outbox.py status
```

El broker `NoBSLaManoPublisher` es el único responsable del transporte, identidad, clave SSH, validación server-side, canal e idempotencia final. No se deben copiar claves, `.env`, rutas de credenciales ni código de transporte al WMS. En esta fase no se ejecuta `enqueue`, no se escribe en NoBS y no se publica en Buzz.

## Actualización segura

1. Reejecutar pruebas locales que no contacten servicios vivos.
2. Actualizar `config/buzz-status.json` solo con resultados observados y códigos existentes.
3. Mantener SIIGO como `reportado` salvo que una ejecución controlada lo verifique de nuevo.
4. Comparar el hash del contrato Buzz fuente con el snapshot WMS. Si cambia, detener la generación, revisar compatibilidad y actualizar contrato, validador y pruebas en un cambio explícito.
5. Ejecutar `npm test` y el dry-run dos veces; ambos resultados deben ser idénticos.
