// POST /api/v1/siigo/sync-document-types
// Fase 2 — Cache de tipos de comprobante SIIGO en tabla `siigo_documentos`.
//
// Necesario para Fases 3-4: al crear facturas de venta (FV) o compra (FC)
// se necesita el ID numérico del documento en SIIGO.
// También guarda en siigo_config los IDs por defecto de FV, FC y AJ.
// Solo Admin/Supervisor.

const { cors, requireRole } = require('../../_lib/auth');
const { query }             = require('../../_lib/db');
const { siigoGet }          = require('../../_lib/siigo.service');

async function setConfigValue(clave, valor) {
  await query(
    `INSERT INTO siigo_config (clave, valor)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), actualizado_en = NOW()`,
    [clave, String(valor)]
  );
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await requireRole(req, ['Admin', 'Supervisor']);
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const docTypes = await siigoGet('/v1/document-types', { entidad: 'document-type' });
    const types    = docTypes?.results ?? (Array.isArray(docTypes) ? docTypes : []);

    let synced = 0;
    let docFV = null, docFC = null, docAJ = null;

    for (const d of types) {
      const code = String(d.code || d.keyword || '');
      const tipo = code.startsWith('FV') ? 'FV'
                 : code.startsWith('FC') ? 'FC'
                 : code.startsWith('AJ') ? 'AJ'
                 : code.startsWith('NC') ? 'NC'
                 : code.substring(0, 5);

      await query(
        `INSERT INTO siigo_documentos
           (siigo_id, codigo, nombre, tipo, activo, numero_automatico,
            proximo_consecutivo, electronico)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           codigo             = VALUES(codigo),
           nombre             = VALUES(nombre),
           tipo               = VALUES(tipo),
           activo             = VALUES(activo),
           numero_automatico  = VALUES(numero_automatico),
           proximo_consecutivo= VALUES(proximo_consecutivo),
           electronico        = VALUES(electronico),
           actualizado_en     = NOW()`,
        [
          d.id,
          code,
          String(d.name || d.description || ''),
          tipo,
          d.active !== false ? 1 : 0,
          d.automatic_number ? 1 : 0,
          d.next_consecutive ?? null,
          d.electronic ? 1 : 0,
        ]
      );
      synced++;

      // Guardar IDs por defecto en siigo_config para uso en fases 3-4
      if (!docFV && tipo === 'FV') docFV = d.id;
      if (!docFC && tipo === 'FC') docFC = d.id;
      if (!docAJ && tipo === 'AJ') docAJ = d.id;
    }

    if (docFV) await setConfigValue('doc_id_factura_vta', docFV);
    if (docFC) await setConfigValue('doc_id_factura_cmp', docFC);
    if (docAJ) await setConfigValue('doc_id_ajuste',      docAJ);

    return res.status(200).json({
      ok: true,
      data: {
        total_synced:        synced,
        doc_id_factura_vta:  docFV,
        doc_id_factura_cmp:  docFC,
        doc_id_ajuste:       docAJ,
        tipos:               types.map(d => ({ id: d.id, code: d.code, name: d.name })),
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[sync-document-types]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al sincronizar tipos de documento' });
  }
};
