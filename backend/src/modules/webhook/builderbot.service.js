/**
 * Dispatcher principal del webhook BuilderBot → WMS
 * Recibe la @ction, la rutea al servicio correcto y
 * devuelve el texto de respuesta que BuilderBot enviará al usuario.
 */
const receptionSvc   = require('../reception/reception.service');
const productionSvc  = require('../production/production.service');
const dispatchSvc    = require('../dispatch/dispatch.service');
const wasteSvc       = require('../waste/waste.service');
const returnsSvc     = require('../returns/returns.service');
const approvalsSvc   = require('../approvals/approvals.service');
const inventorySvc   = require('../inventory/inventory.service');
const AppError       = require('../../utils/AppError');
const { findProductBySku, findLotByLpn, findOrderByCode, buildBotUser } = require('./builderbot.helpers');
const axios          = require('axios');

// ─────────────────────────────────────────────
// Enviar mensaje de vuelta a BuilderBot
// ─────────────────────────────────────────────
exports.sendMessage = async (phone, text) => {
  if (!process.env.BUILDERBOT_SEND_URL) return;
  await axios.post(process.env.BUILDERBOT_SEND_URL, { phone, message: text }, {
    headers: { 'x-api-key': process.env.BUILDERBOT_API_KEY || '' },
    timeout: 8000
  });
};

// ─────────────────────────────────────────────
// DISPATCHER
// ─────────────────────────────────────────────
exports.dispatch = async ({ from, action, params, priority }) => {
  const user = await buildBotUser(from);

  switch (action) {

    // ══════════════════════════════════════════
    // 1. INGRESO_RECEPCION
    // ══════════════════════════════════════════
    case 'INGRESO_RECEPCION': {
      const product = await findProductBySku(params.id_item);
      const data = {
        product_id:  product.id,
        qty_total:   params.cantidad,
        qty_damaged: params.cantidad_mala || 0,
        supplier:    params.proveedor || null
      };
      const result = await receptionSvc.receive(data, user);
      const msg = `✅ *Recepción registrada*\nProducto: ${params.id_item}\nBuenos: ${result.lots.find(l=>l.status==='DISPONIBLE')?.qty || 0}\nNovedad: ${result.lots.find(l=>l.status==='CUARENTENA')?.qty || 0}\nLote: ${result.lots[0]?.lpn}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg, lots: result.lots };
    }

    // ══════════════════════════════════════════
    // 2. SOLICITAR_INICIO_PRODUCCION
    // ══════════════════════════════════════════
    case 'SOLICITAR_INICIO_PRODUCCION': {
      const product = await findProductBySku(params.id_producto_final);
      const result  = await productionSvc.start({ product_id: product.id, qty_planned: params.cantidad_planificada }, user);
      const picking = result.bom_required.map(b => `  • ${b.sku}: ${b.needed} ${b.unit}`).join('\n');
      const msg = `🏭 *Orden creada: ${result.order.order_code}*\nProducto: ${params.id_producto_final}\nCantidad: ${params.cantidad_planificada}\n\n📋 *Lista de recolección (FIFO):*\n${picking}\n\nCuando tengas los materiales responde:\n✅ _Confirmo materiales para ${result.order.order_code}_`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg, order_code: result.order.order_code };
    }

    // ══════════════════════════════════════════
    // 3. AVANCE_FASES
    // ══════════════════════════════════════════
    case 'AVANCE_FASES': {
      const result = await productionSvc.advancePhase({ order_id: await resolveOrderId(params.id_orden), phase: params.fase_destino }, user);
      const faseNombre = { F1:'Llenado', F2:'Sellado', F3:'Tapado', F4:'Etiquetado', F5:'Embalaje' };
      const msg = `📦 *Avance registrado*\nOrden: ${params.id_orden}\nFase: ${params.fase_destino} — ${faseNombre[params.fase_destino] || ''}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    // ══════════════════════════════════════════
    // 4. REPORTE_MERMA
    // ══════════════════════════════════════════
    case 'REPORTE_MERMA': {
      const product = await findProductBySku(params.id_item);
      const type    = params.id_orden ? 'MERMA_EN_MAQUINA' : 'MERMA_EN_ESTANTERIA';
      const result  = await wasteSvc.report({
        type, product_id: product.id, qty: params.cantidad,
        lot_id:              params.id_lote  ? await resolveLotId(params.id_lote)  : undefined,
        production_order_id: params.id_orden ? await resolveOrderId(params.id_orden) : undefined,
        reason: params.motivo
      }, user);
      const msg = `⚠️ *Merma registrada: ${result.waste_code}*\nProducto: ${params.id_item}\nCantidad: ${params.cantidad}\nMotivo: ${params.motivo}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg, waste_code: result.waste_code };
    }

    // ══════════════════════════════════════════
    // 5. SOLICITAR_CIERRE_PRODUCCION
    // ══════════════════════════════════════════
    case 'SOLICITAR_CIERRE_PRODUCCION': {
      const orderId = await resolveOrderId(params.id_orden);
      const { ApprovalQueue } = require('../../models');
      const req = await ApprovalQueue.create({
        request_code: `REQ-${Date.now()}`,
        action: 'SOLICITAR_CIERRE_PRODUCCION',
        payload: { order_id: orderId, qty_real: params.cantidad_real },
        requested_by: user.id, status: 'PENDIENTE', priority
      });
      const msg = `⏳ *Solicitud enviada: ${req.request_code}*\nOrden: ${params.id_orden}\nCantidad real: ${params.cantidad_real}\nEsperando aprobación del Validador.`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg, request_code: req.request_code };
    }

    // ══════════════════════════════════════════
    // 6. SOLICITAR_DESPACHO
    // ══════════════════════════════════════════
    case 'SOLICITAR_DESPACHO': {
      const lot = await findLotByLpn(params.id_lote);
      const { ApprovalQueue } = require('../../models');
      const req = await ApprovalQueue.create({
        request_code: `REQ-${Date.now()}`,
        action: 'SOLICITAR_DESPACHO',
        payload: { lot_id: lot.id, qty: params.cantidad, customer: params.cliente_destino },
        requested_by: user.id, status: 'PENDIENTE', priority
      });
      const msg = `⏳ *Solicitud de despacho: ${req.request_code}*\nLote: ${params.id_lote}\nCantidad: ${params.cantidad}\nCliente: ${params.cliente_destino}\nEsperando aprobación.`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg, request_code: req.request_code };
    }

    // ══════════════════════════════════════════
    // 7. GESTION_DEVOLUCION
    // ══════════════════════════════════════════
    case 'GESTION_DEVOLUCION': {
      const product   = await findProductBySku(params.id_item);
      const condition = params.estado === 'RECUPERABLE' ? 'RECUPERABLE' : 'DANADO';
      const result    = await returnsSvc.processReturn({ product_id: product.id, qty: params.cantidad, customer_origin: params.cliente_origen, condition }, user);
      const msg = `🔄 *Devolución registrada*\nProducto: ${params.id_item}\nCantidad: ${params.cantidad}\nEstado: ${condition}\nLote: ${result.lpn}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg, lpn: result.lpn };
    }

    // ══════════════════════════════════════════
    // 8. CONSULTAR_STOCK_MATERIA_PRIMA
    // ══════════════════════════════════════════
    case 'CONSULTAR_STOCK_MATERIA_PRIMA':
    case 'CONSULTAR_STOCK_PRODUCTO_TERMINADO': {
      if (params.id_item) {
        const product = await findProductBySku(params.id_item);
        const data    = await inventorySvc.productStock(product.id);
        const disp    = data.summary?.disponible_neto ?? data.lots?.reduce((a,l)=>a+parseFloat(l.qty_current),0) ?? 0;
        const msg = `📊 *Stock: ${params.id_item}*\nDisponible: ${disp} ${product.unit || 'und'}\nLotes activos: ${data.lots?.length || 0}`;
        await exports.sendMessage(from, msg).catch(()=>{});
        return { message: msg };
      }
      const summary = await inventorySvc.globalSummary();
      const lines   = summary.slice(0,10).map(p=>`  • ${p.siigo_code}: ${p.stock?.disponible_neto ?? 0}`).join('\n');
      const msg = `📦 *Resumen de stock (top 10):*\n${lines}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    // ══════════════════════════════════════════
    // 9. CONSULTAR_ESTADO_PRODUCCION
    // ══════════════════════════════════════════
    case 'CONSULTAR_ESTADO_PRODUCCION': {
      const orderId = await resolveOrderId(params.id_orden);
      const order   = await productionSvc.getOne(orderId);
      const faseNombre = { F0:'Pendiente materiales', F1:'Llenado', F2:'Sellado', F3:'Tapado', F4:'Etiquetado', F5:'Embalaje/Cierre' };
      const msg = `🔍 *Orden: ${params.id_orden}*\nProducto: ${order.product?.name}\nEstado: ${order.status}\nFase: ${order.phase} — ${faseNombre[order.phase] || ''}\nPlanificado: ${order.qty_planned}\nReal: ${order.qty_real || 'en proceso'}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    // ══════════════════════════════════════════
    // 10. CONSULTAR_TRAZABILIDAD_LOTE
    // ══════════════════════════════════════════
    case 'CONSULTAR_TRAZABILIDAD_LOTE': {
      const lot = await inventorySvc.lotDetail(params.id_lote);
      const msg = `🔎 *Trazabilidad: ${params.id_lote}*\nProducto: ${lot.product?.name}\nOrigen: ${lot.origin}\nEstado: ${lot.status}\nCantidad inicial: ${lot.qty_initial}\nCantidad actual: ${lot.qty_current}\nProveedor: ${lot.supplier || 'N/A'}\nVence: ${lot.expiry_date || 'N/A'}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    // ══════════════════════════════════════════
    // 11. CONSULTAR_CAPACIDAD_FABRICACION
    // ══════════════════════════════════════════
    case 'CONSULTAR_CAPACIDAD_FABRICACION': {
      const product  = await findProductBySku(params.id_producto_final);
      const { BOM, Lot } = require('../../models');
      const { Op }  = require('sequelize');
      const bom     = await BOM.findAll({ where: { product_id: product.id } });
      const checks  = [];
      let canProduce = true;
      for (const item of bom) {
        const needed    = parseFloat(item.qty_per_unit) * params.cantidad_deseada;
        const available = await Lot.sum('qty_current', { where: { product_id: item.input_product_id, status: 'DISPONIBLE' } }) || 0;
        const ok = available >= needed;
        if (!ok) canProduce = false;
        checks.push(`  ${ok ? '✅' : '❌'} ${item.input_product_id}: necesita ${needed}, tiene ${available}`);
      }
      const msg = `${canProduce ? '✅' : '❌'} *Capacidad para ${params.cantidad_deseada} uds de ${params.id_producto_final}:*\n${checks.join('\n')}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg, can_produce: canProduce };
    }

    // ══════════════════════════════════════════
    // 12. APROBAR_SOLICITUD
    // ══════════════════════════════════════════
    case 'APROBAR_SOLICITUD': {
      const result = await approvalsSvc.approve(params.id_solicitud, user);
      const msg = `✅ *${params.id_solicitud} Aprobada*\nAcción: ${result.action?.replace(/_/g,' ')}\nAprobado por: ${user.name}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    // ══════════════════════════════════════════
    // 13. RECHAZAR_SOLICITUD
    // ══════════════════════════════════════════
    case 'RECHAZAR_SOLICITUD': {
      const result = await approvalsSvc.reject({ request_code: params.id_solicitud, reason: params.motivo }, user);
      const msg = `❌ *${params.id_solicitud} Rechazada*\n${params.motivo ? 'Motivo: ' + params.motivo : ''}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    // ══════════════════════════════════════════
    // 14. CONFIRMAR_MATERIALES_PRODUCCION
    // ══════════════════════════════════════════
    case 'CONFIRMAR_MATERIALES_PRODUCCION': {
      const orderId = await resolveOrderId(params.id_orden);
      const result  = await productionSvc.confirmMaterials({ order_id: orderId, exception_lot_id: params.lote_usado ? await resolveLotId(params.lote_usado) : undefined }, user);
      const msg = `✅ *Materiales confirmados*\nOrden: ${params.id_orden}\nFase: ${result.phase}\nLotes consumidos: ${result.consumed?.length || 0}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    // ══════════════════════════════════════════
    // 15. EXCEPCION_PICKING
    // ══════════════════════════════════════════
    case 'EXCEPCION_PICKING': {
      const orderId = params.id_orden ? await resolveOrderId(params.id_orden) : null;
      const lotId   = await resolveLotId(params.lote_usado);
      const result  = await productionSvc.confirmMaterials({ order_id: orderId, exception_lot_id: lotId }, user);
      const msg = `🔄 *Excepción de picking registrada*\nOrden: ${params.id_orden || 'N/A'}\nLote sugerido: ${params.lote_sugerido}\nLote usado: ${params.lote_usado}`;
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    // ══════════════════════════════════════════
    // 16. MODO_CHARLA (sin datos suficientes)
    // ══════════════════════════════════════════
    case 'MODO_CHARLA': {
      const msg = params.texto || 'No entendí tu mensaje. ¿Puedes ser más específico?';
      await exports.sendMessage(from, msg).catch(()=>{});
      return { message: msg };
    }

    default:
      throw new AppError(`Acción desconocida: ${action}`, 400);
  }
};

// ─────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────
async function resolveOrderId(orderCode) {
  const { ProductionOrder } = require('../../models');
  const o = await ProductionOrder.findOne({ where: { order_code: orderCode } });
  if (!o) throw new AppError(`Orden ${orderCode} no encontrada`, 404);
  return o.id;
}

async function resolveLotId(lpn) {
  const { Lot } = require('../../models');
  const l = await Lot.findOne({ where: { lpn } });
  if (!l) throw new AppError(`Lote ${lpn} no encontrado`, 404);
  return l.id;
}
