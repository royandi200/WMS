/**
 * builderbot.service.js — DEPRECADO
 *
 * Este archivo ya NO es el stack activo.
 * Todo el procesamiento de webhooks BuilderBot vive en:
 *   api/v1/webhook/builderbot.js  (Vercel Serverless, mysql2)
 *
 * Este archivo se conserva solo como referencia histórica.
 * NO importar, NO ejecutar, NO modificar.
 *
 * Razón: Express + Sequelize no es compatible con Vercel Serverless.
 * La consolidación al stack serverless eliminó la duplicación
 * y los conflictos de nombres de modelos (AprobacionSolicitud vs
 * ApprovalQueue, etc.).
 */

throw new Error(
  'builderbot.service.js está DEPRECADO. ' +
  'Usa api/v1/webhook/builderbot.js (stack Vercel activo).'
);
