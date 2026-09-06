const { createHash } = require('node:crypto');
const { nativePdfEvidence } = require('./document-pdf-evidence');

async function inspectStoredDocumentPdf(db, documentId) {
  const id = Number(documentId);
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('ID documental invalido'), { status: 400 });
  const [files] = await db.execute(
    `SELECT a.contenido, a.sha256, d.tipo_documento
       FROM documento_bodega_borrador_archivos a
       JOIN documentos_bodega_borrador d ON d.id = a.documento_id
      WHERE d.id = ? ORDER BY a.id LIMIT 1`, [id]
  );
  if (!files.length) throw Object.assign(new Error('PDF original no encontrado'), { status: 404 });
  const content = files[0].contenido;
  const hash = createHash('sha256').update(content).digest('hex');
  if (hash !== files[0].sha256) throw Object.assign(new Error('Integridad del PDF original invalida'), { status: 409 });
  const evidence = await nativePdfEvidence(db, { content }, { items: [] });
  return {
    document_id: id, document_type: files[0].tipo_documento,
    sha256: hash, pages: evidence.pages || 0, diagnostics: evidence.diagnostics,
    items: evidence.used ? evidence.body.items : [],
    inventory_changed: false, draft_changed: false,
  };
}

module.exports = { inspectStoredDocumentPdf };
