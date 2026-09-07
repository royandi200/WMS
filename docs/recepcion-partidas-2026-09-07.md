# Recepcion WhatsApp: contrato plano de partidas

## Motivo y alcance

CRIT-02/N1-09 fallo en OC21 a las 09:29 del 07/09/2026: BBC extrajo los
datos completos, pero produjo una tercera variante de cierre JSON invalido.
La recuperacion de dos sufijos no resolvio la causa. Se preserva ese resultado
en `mejoras-criticas-post-n1-2026-09-07.md`; no se recrea la OC para ocultarlo.

## Cambio

- Solo `CONFIRMAR_RECEPCION_OC` admite `params.partidas`, lista de objetos planos.
- Cada partida declara SKU, total recibido de ese SKU, cantidad de la division,
  condicion, lote, vencimiento, ubicacion y motivo cuando corresponde.
- `reception-partidas.js` agrupa de forma determinista y entrega el contrato
  `items/distribuciones` al servicio existente. Totales incoherentes, campos
  desconocidos, valores ausentes o mezcla de formatos se rechazan.
- No hay conversion automatica de unidades: las cantidades corresponden a la
  unidad de la OC preparada. Se conservan las validaciones de dominio existentes.
- La vista previa exige `confirmacion_final: false`. El cierre envia solo ID y
  confirmacion explicita; utiliza el borrador persistido del mismo actor.
- Se conserva compatibilidad con los mensajes JSON validos del contrato anterior.
- Se elimina del prompt el ejemplo contradictorio que reconstruia items al confirmar.
- El prompt cambia solo en recepcion, en Entrada y Voz. No modifica la extraccion
  de PDF, el flujo Documentos de Bodega, permisos, roles ni reglas de inventario.

## Verificacion local

- 351 pruebas aprobadas, cero fallidas/omitidas; incluye siete pruebas nuevas.
- Build frontend aprobado. Sin instalacion ni actualizacion de dependencias.
- Pruebas de contrato, totales 3/1/1, multiples productos/lotes, cantidades
  fraccionarias, autorizacion real del webhook con servicio simulado, limites,
  rechazos y compatibilidad. Ejemplos JSON del prompt parseados en prueba.
- La suite inicial detecto aserciones textuales del prompt anterior; se adaptaron
  al contrato nuevo sin eliminar los controles de confirmacion ni datos fisicos.

## Verificacion conectada

Pendiente al preparar este commit: publicar backend antes de sincronizar prompt;
releer BBC y comparar huellas del resto de la configuracion. Repetir desde Datana
la misma OC21/REC100, sin modificar los datos de la prueba: cinco unidades,
tres disponibles, una en cuarentena y una rechazada. Cotejar vista previa sin
stock, confirmacion unica, dashboard, SQL e idempotencia. Registrar hora Bogota.

## Limites

El formato plano reduce anidacion, pero no garantiza que la IA siempre emita JSON
valido. No se amplio la reparacion de JSON ni se permite inferir campos faltantes.
Las pruebas locales no equivalen a una validacion WhatsApp. No se afirma cierre
de N1-09 hasta verificar su recorrido conectado completo.
