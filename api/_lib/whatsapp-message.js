const COPY_REPLACEMENTS = [
  ['recepcion', 'recepción'],
  ['produccion', 'producción'],
  ['ubicacion', 'ubicación'],
  ['confirmacion', 'confirmación'],
  ['operacion', 'operación'],
  ['accion', 'acción'],
  ['conciliacion', 'conciliación'],
  ['reposicion', 'reposición'],
  ['configuracion', 'configuración'],
  ['sincronizacion', 'sincronización'],
  ['notificacion', 'notificación'],
  ['informacion', 'información'],
  ['autorizacion', 'autorización'],
  ['aprobacion', 'aprobación'],
  ['ejecucion', 'ejecución'],
  ['gestion', 'gestión'],
  ['excepcion', 'excepción'],
  ['razon', 'razón'],
  ['observacion', 'observación'],
  ['instruccion', 'instrucción'],
  ['clasificacion', 'clasificación'],
  ['vinculacion', 'vinculación'],
  ['remision', 'remisión'],
  ['devolucion', 'devolución'],
  ['validacion', 'validación'],
  ['cancelacion', 'cancelación'],
  ['seleccion', 'selección'],
  ['seccion', 'sección'],
  ['descripcion', 'descripción'],
  ['correccion', 'corrección'],
  ['extraccion', 'extracción'],
  ['distribucion', 'distribución'],
  ['condicion', 'condición'],
  ['auditoria', 'auditoría'],
  ['numero', 'número'],
  ['codigo', 'código'],
  ['fisica', 'física'],
  ['fisico', 'físico'],
  ['historico', 'histórico'],
  ['pagina', 'página'],
  ['maximo', 'máximo'],
  ['minimo', 'mínimo'],
  ['tambien', 'también'],
  ['unico', 'único'],
  ['unica', 'única'],
  ['invalido', 'inválido'],
  ['invalida', 'inválida'],
  ['valido', 'válido'],
  ['valida', 'válida'],
  ['automatica', 'automática'],
  ['automaticamente', 'automáticamente'],
  ['logistico', 'logístico'],
  ['articulo', 'artículo'],
  ['articulos', 'artículos'],
  ['ordenes', 'órdenes'],
  ['items', 'ítems'],
  ['periodo', 'período'],
  ['almacen', 'almacén'],
  ['almacenes', 'almacenes'],
  ['atencion', 'atención'],
  ['raiz', 'raíz'],
  ['perdida', 'pérdida'],
  ['perdidas', 'pérdidas'],
  ['contaminacion', 'contaminación'],
  ['disposicion', 'disposición'],
  ['demostracion', 'demostración'],
  ['identificacion', 'identificación'],
  ['administracion', 'administración'],
  ['catalogo', 'catálogo'],
  ['logistica', 'logística'],
  ['telefono', 'teléfono'],
  ['direccion', 'dirección'],
  ['version', 'versión'],
  ['decision', 'decisión'],
  ['dias', 'días'],
  ['segun', 'según'],
  ['aqui', 'aquí'],
  ['asi', 'así'],
  ['habia', 'había'],
  ['tenia', 'tenía'],
  ['podria', 'podría'],
  ['deberia', 'debería'],
  ['sera', 'será'],
  ['seran', 'serán'],
  ['tendra', 'tendrá'],
  ['tendran', 'tendrán'],
  ['creara', 'creará'],
  ['crearan', 'crearán'],
  ['validara', 'validará'],
  ['validaran', 'validarán'],
  ['vinculara', 'vinculará'],
  ['conservara', 'conservará'],
  ['conservaran', 'conservarán'],
  ['permitira', 'permitirá'],
  ['permitiran', 'permitirán'],
  ['mas', 'más'],
  ['ultimo', 'último'],
  ['ultima', 'última'],
  ['ultimos', 'últimos'],
  ['ultimas', 'últimas'],
  ['ningun', 'ningún'],
  ['algun', 'algún'],
  ['aun', 'aún'],
  ['despues', 'después'],
  ['debera', 'deberá'],
  ['deberas', 'deberás'],
  ['podra', 'podrá'],
  ['quedara', 'quedará'],
  ['continuara', 'continuará'],
  ['enviara', 'enviará'],
  ['registrara', 'registrará'],
  ['descontara', 'descontará'],
  ['leyo', 'leyó'],
];

function preserveCase(source, replacement) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function correctSpanishOrthography(value) {
  const protectedTokens = [];
  let result = String(value || '').replace(
    /`[^`\n]+`|https?:\/\/\S+|[\p{L}\p{N}]+(?:[_-][\p{L}\p{N}]+)+/gu,
    (token) => {
      protectedTokens.push(token);
      return `\uE000${protectedTokens.length - 1}\uE001`;
    }
  );
  for (const [source, replacement] of COPY_REPLACEMENTS) {
    result = result.replace(
      new RegExp(`(?<![\\p{L}\\p{N}_])${source}(?![\\p{L}\\p{N}_])`, 'giu'),
      (match) => preserveCase(match, replacement)
    );
  }
  result = result
    .replace(/¿\s*que\b/giu, (match) => match.replace(/que$/iu, (word) => preserveCase(word, 'qué')))
    .replace(/¿\s*como\b/giu, (match) => match.replace(/como$/iu, (word) => preserveCase(word, 'cómo')))
    .replace(/¿\s*cual\b/giu, (match) => match.replace(/cual$/iu, (word) => preserveCase(word, 'cuál')))
    .replace(/¿\s*donde\b/giu, (match) => match.replace(/donde$/iu, (word) => preserveCase(word, 'dónde')))
    .replace(/¿\s*cuando\b/giu, (match) => match.replace(/cuando$/iu, (word) => preserveCase(word, 'cuándo')))
    .replace(/¿\s*quien\b/giu, (match) => match.replace(/quien$/iu, (word) => preserveCase(word, 'quién')))
    .replace(/¿\s*por que\b/giu, (match) => match.replace(/que$/iu, (word) => preserveCase(word, 'qué')))
    .replace(/\b(no|ya|todav[ií]a) esta\b/giu, (match) => match.replace(/esta$/iu, 'está'))
    .replace(/\besta (?:en|lista|listo|activa|activo|abierta|abierto|cerrada|cerrado|disponible|pendiente|confirmada|confirmado|preparada|preparado|cancelada|cancelado|aprobada|aprobado|desactivada|desactivado|habilitada|habilitado|completa|completo|incompleta|incompleto)\b/giu,
      (match) => match.replace(/^esta/iu, (word) => preserveCase(word, 'está')))
    .replace(/\bse (modifico|confirmo|desconto|registro|envio|cancelo|creo|retiro|vinculo|leyo)\b/giu,
      (match) => match
        .replace(/modifico$/iu, 'modificó')
        .replace(/confirmo$/iu, 'confirmó')
        .replace(/desconto$/iu, 'descontó')
        .replace(/registro$/iu, 'registró')
        .replace(/envio$/iu, 'envió')
        .replace(/cancelo$/iu, 'canceló')
        .replace(/creo$/iu, 'creó')
        .replace(/retiro$/iu, 'retiró')
        .replace(/vinculo$/iu, 'vinculó')
        .replace(/leyo$/iu, 'leyó'));
  return result.replace(/\uE000(\d+)\uE001/g, (_, index) => protectedTokens[Number(index)]);
}

function formatWhatsAppMessage(value) {
  const source = correctSpanishOrthography(value).replace(/\r\n?/g, '\n').trim();
  if (!source || !source.includes('\n')) return source;

  const output = [];
  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\s+$/g, '');
    if (!line.trim()) {
      if (output.length && output[output.length - 1] !== '') output.push('');
      continue;
    }
    const isContinuation = /^\s{2,}\S/.test(line);
    if (!isContinuation && output.length && output[output.length - 1] !== '') output.push('');
    output.push(line);
  }
  while (output[output.length - 1] === '') output.pop();
  return output.join('\n');
}

module.exports = { correctSpanishOrthography, formatWhatsAppMessage };
