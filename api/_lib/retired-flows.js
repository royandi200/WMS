// Flujos retirados de la operacion vigente (depuracion 2026-09-17).
//
// Etapa 1: la funcionalidad queda apagada y responde con una guia hacia el
// flujo vigente. El codigo permanece para poder revertir la decision sin
// rehacer el desarrollo. Etapa 2 (posterior a la bateria de pruebas):
// eliminar handlers, pantallas, tablas y pruebas asociadas.
//
// Registro de la decision: docs/depuracion-flujos-retirados-2026-09.md

const { envFlag } = require('./feature-flags');

// Escotilla de reversion. Sin la variable, el circuito queda apagado.
function approvalsWorkflowEnabled() {
  return envFlag('ENABLE_APPROVALS_WORKFLOW', false);
}

// Acciones del agente de WhatsApp retiradas y su redireccion vigente.
const RETIRED_ACTIONS = Object.freeze({
  SOLICITAR_INICIO_PRODUCCION: 'La solicitud de aprobacion ya no se usa. La produccion se libera directamente: envia *liberar orden de produccion* con el OP ID.',
  SOLICITAR_CIERRE_PRODUCCION: 'La solicitud de aprobacion ya no se usa. La produccion se cierra directamente: envia *cerrar orden de produccion* con el OP ID, las unidades conformes y la merma.',
  CONSULTAR_SOLICITUDES_PENDIENTES: 'El circuito de aprobaciones fue retirado. Consulta *recepciones pendientes*, *despachos pendientes* o *estado de produccion*.',
  APROBAR_SOLICITUD: 'El circuito de aprobaciones fue retirado. Ejecuta la accion directamente con su frase de confirmacion.',
  RECHAZAR_SOLICITUD: 'El circuito de aprobaciones fue retirado. Ejecuta la accion directamente con su frase de confirmacion.',
  SOLICITAR_DESPACHO: 'La solicitud directa de despacho fue retirada. El despacho de cliente nace de una factura de venta de Siigo y la salida a 3Q se confirma en Despachos.',
  INGRESO_RECEPCION: 'El ingreso manual fue retirado. Prepara la recepcion contra una OC operativa o una orden de maquila 3Q y confirmala con su frase exacta.',
});

const APPROVAL_ACTIONS = Object.freeze([
  'SOLICITAR_INICIO_PRODUCCION',
  'SOLICITAR_CIERRE_PRODUCCION',
  'CONSULTAR_SOLICITUDES_PENDIENTES',
  'APROBAR_SOLICITUD',
  'RECHAZAR_SOLICITUD',
]);

/**
 * Devuelve el mensaje de redireccion si la accion esta retirada, o null.
 * Las acciones del circuito de aprobaciones vuelven a habilitarse con
 * ENABLE_APPROVALS_WORKFLOW=true.
 */
function retiredActionMessage(action) {
  const key = String(action || '').trim().toUpperCase();
  const message = RETIRED_ACTIONS[key];
  if (!message) return null;
  if (APPROVAL_ACTIONS.includes(key) && approvalsWorkflowEnabled()) return null;
  return message;
}

const APPROVALS_ENDPOINT_MESSAGE =
  'El circuito de aprobaciones fue retirado de la operacion vigente. La produccion se libera y se cierra directamente.';

module.exports = {
  approvalsWorkflowEnabled,
  retiredActionMessage,
  RETIRED_ACTIONS,
  APPROVAL_ACTIONS,
  APPROVALS_ENDPOINT_MESSAGE,
};
