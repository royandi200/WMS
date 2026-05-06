/**
 * Convierte un Despacho WMS (con items y productos incluidos)
 * al formato DOCUMENT esperado por el web service de SysCafé.
 *
 * Documentación de referencia:
 *   31.-DOCUMENTOS-REQUERIDOS-PARA-WEB-SERVICE-APPI-FACTURACION-PEDIDOS
 */

const TIPO_DOCUMENTO = process.env.SYSCAFE_TIPO_DOC || 'FV2';
const IVA_DEFAULT    = parseFloat(process.env.SYSCAFE_IVA_PCT || '19');

/**
 * @param {object} despacho  — instancia Sequelize con items y tercero incluidos
 * @returns {object}         — DOCUMENT listo para devolver a SysCafé
 */
function mapDespachoToDocument(despacho) {
  const fecha = despacho.despachado_en
    ? new Date(despacho.despachado_en).toISOString().split('T')[0]
    : new Date(despacho.creado_en).toISOString().split('T')[0];

  const tercero = despacho.tercero || {};

  const items = (despacho.items || []).map((item) => {
    const vrunit  = parseFloat(item.precio_unitario)  || 0;
    const cant    = parseFloat(item.cantidad_des)      || 0;
    const desc    = parseFloat(item.descuento)         || 0;
    const base    = vrunit * cant * (1 - desc / 100);
    const piva    = item.producto?.pct_iva != null ? parseFloat(item.producto.pct_iva) : IVA_DEFAULT;
    const vriva   = parseFloat((base * piva / 100).toFixed(2));
    const vrtotal = parseFloat((base + vriva).toFixed(2));

    return {
      referencia: item.producto?.siigo_code || item.producto?.codigo || String(item.producto_id),
      descripcion: item.producto?.nombre || '',
      cant,
      vrunit,
      descuento: desc,
      vrtotal: parseFloat(base.toFixed(2)),
      piva,
      vriva
    };
  });

  return {
    tipo:    TIPO_DOCUMENTO,
    noext:   despacho.numero,
    fecha,
    nit:     tercero.nit || despacho.cliente_nombre || '',
    nombre:  tercero.nombre || despacho.cliente_nombre || '',
    bodega:  String(despacho.bodega_id || '001'),
    moneda:  despacho.moneda || 'COP',
    observaciones: despacho.observaciones || '',
    cliente: {
      nit:       tercero.nit       || '',
      nombre:    tercero.nombre    || despacho.cliente_nombre || '',
      direccion: tercero.direccion || '',
      ciudad:    tercero.ciudad    || '',
      telefono:  tercero.telefono  || '',
      email:     tercero.email     || ''
    },
    items
  };
}

module.exports = { mapDespachoToDocument };
