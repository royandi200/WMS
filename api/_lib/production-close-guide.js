const { explicitReferences, referenceKey } = require('./production-order-reference');
const { recentOrderContext } = require('./production-waste-guide');
const { resolveProductReference } = require('./product-references');

const NUMBER_WORDS = Object.freeze({ cero: 0, ninguna: 0, ninguno: 0,
  una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 });
const NUMBER = '(\\d+(?:[.,]\\d+)?|cero|ninguna|ninguno|una|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)';

function guideError(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

function closeUtterance(value) {
  const raw = String(value || '').trim();
  // BBC envía a veces un solo mensaje actual con nombre y hora. No aceptar
  // historiales, líneas adicionales ni prosa del modelo como confirmación.
  const wrapped = raw.match(/^\{name\}="[^"\r\n]{1,120}"\r?\n\[(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}\]:[ \t]*([^\r\n]+)$/u);
  return wrapped ? wrapped[1].trim() : raw;
}

function quantity(value) {
  if (value == null) return null;
  const text = normalize(value);
  const number = Object.hasOwn(NUMBER_WORDS, text) ? NUMBER_WORDS[text] : Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function closeOrderReference(text, params = {}) {
  const standard = explicitReferences(text).map(referenceKey).filter(Boolean);
  // Transcripciones de "OP ID": OPIV, OPIB, OPID, OPI y OP y de.
  const normalized = normalize(text);
  const fuzzy = [
    ...normalized.matchAll(/\bop\s*(?:i\s*[dbv]?|y\s+de)?\s*#?\s*([1-9]\d*)\b/gu),
    ...normalized.matchAll(/\borden(?:\s+de\s+produccion)?\s+(?:id\s*)?([1-9]\d*)\b/gu),
  ].map(match => Number(match[1]));
  const unique = [...new Set([...standard, ...fuzzy])];
  if (unique.length > 1) throw guideError('El mensaje menciona más de una OP. Indica solo un OP ID; no se cerró nada.');
  const spoken = unique[0] || null;
  if (!spoken) return null;
  const interpreted = referenceKey(params.id_orden);
  if (interpreted && interpreted !== spoken) {
    throw guideError('El OP ID interpretado no coincide con el audio. Repite solo el OP ID; no se cerró nada.');
  }
  return spoken;
}

function contextualOrderCandidate(text, hasDraft) {
  const raw = normalize(text);
  const ambiguous = raw.match(/\b(?:oc\s*i\s*d|ocid|id)\s*#?\s*([1-9]\d*)\b/u);
  if (ambiguous && /\b(?:cerrar|cerramos|cierre|produccion)\b/u.test(raw)) return Number(ambiguous[1]);
  if (hasDraft) {
    const reply = raw.match(/^(?:(?:el|numero|id)\s+)?([1-9]\d*)[.!]?$/u);
    if (reply) return Number(reply[1]);
  }
  return null;
}

function fieldMatch(text, before, after) {
  const value = text.match(new RegExp(`${NUMBER}\\s*(?:und|unidad(?:es)?|uds?)?\\s*(?:de\\s+)?${after}`, 'u'))?.[1]
    || text.match(new RegExp(`${before}\\s*(?:de|a|es|era|fue|son|fueron|quedaron|:)?\\s*${NUMBER}`, 'u'))?.[1];
  return quantity(value);
}

function explicitFinishedWasteReason(text) {
  const raw = normalize(text);
  const target = '(?:(?:la\\s+)?merma|(?:el\\s+)?producto\\s+terminado(?:\\s+no\\s+conforme)?|(?:el\\s+)?producto\\s+no\\s+conforme|(?:(?:el|los)\\s+)?no\\s+conformes?|(?:(?:la|las)\\s+)?unidades?\\s+no\\s+conformes?)';
  const match = new RegExp(`^(?:(?:correccion|correcion|corrijo|corrige|cambia|modifica)\\s*[:,.-]?\\s*)?(?:(?:el|la)\\s+)?(?:motivo|causa)\\s+(?:(?:de|del)\\s+)?${target}\\s*(?:(?:es|fue|era|a|por)\\s+)?(.+)$`, 'u').exec(raw);
  return match?.[1]?.trim() || null;
}

function closeFields(text) {
  const raw = normalize(text);
  const conformingText = raw.replace(/\bno\s+conformes?\b/gu, '');
  let conforming = fieldMatch(conformingText,
    '(?:conformes?|buenas?|buenos|resultantes?|producidas?)',
    '(?:conformes?|buenas?|buenos|resultantes?|producidas?)');
  if (conforming == null) {
    conforming = quantity(raw.match(new RegExp(`${NUMBER}\\s+(?:producto(?:s)?(?:\\s+terminad[oa]s?)?|unidades?(?:\\s+terminad[oa]s?)?|terminad[oa]s?)\\s+conformes?\\b`, 'u'))?.[1]);
  }
  let waste = fieldMatch(raw,
    '(?:mermas?|no\\s+conformes?|rechazos?|desperdicios?)',
    '(?:mermas?|no\\s+conformes?|rechazos?|desperdicios?)');
  if (waste == null) {
    waste = quantity(raw.match(new RegExp(`${NUMBER}\\s+(?:producto(?:s)?(?:\\s+terminad[oa]s?)?|unidades?(?:\\s+terminad[oa]s?)?|terminad[oa]s?)\\s+no\\s+conformes?\\b`, 'u'))?.[1]);
  }
  if (waste == null && /\b(?:sin|ninguna|no hubo)\s+(?:merma|mermas|rechazos?)\b/u.test(raw)) waste = 0;
  const locationCode = '([a-z][a-z0-9-]*\\d[a-z0-9-]*|[a-z]\\s+\\d+)';
  const negated = new RegExp(`\\bubicacion\\s+no\\s+(?:es|era|fue)\\s+${locationCode}\\s*(?:,|;|sino)?\\s*(?:es|sino(?:\\s+que\\s+es)?)\\s+${locationCode}\\b`, 'u').exec(raw);
  const changedFrom = new RegExp(`\\bubicacion\\s+(?:(?:de|desde)\\s+)?${locationCode}\\s+(?:a|para|por)\\s+${locationCode}\\b`, 'u').exec(raw);
  const direct = new RegExp(`\\bubicacion(?:\\s+(?:del?\\s+)?(?:(?:producto\\s+)?terminado(?:\\s+conforme)?|conforme|pt))?\\s*(?:(?:correcta|nueva|ahora)\\s+)?(?:(?:es|fue|sera|seria|queda|quedara|debe\\s+ser|va\\s+para|van\\s+para|a|en)\\s+)?[:=\\-]?\\s*${locationCode}\\b`, 'u').exec(raw);
  const contextual = new RegExp(`\\b(?:quedan?\\s+en|dejar\\s+en|ubicar\\s+en|van?\\s+para|en)\\s*(?:la\\s+)?(?:ubicacion\\s+)?${locationCode}\\b`, 'u').exec(raw);
  const location = (negated?.[2] || changedFrom?.[2] || direct?.[1] || contextual?.[1] || null)
    ?.replace(/\s+/gu, '').toUpperCase() || null;
  const rawReason = raw.match(/\b(?:por|motivo|causa|debido a)\s+(.+?)(?=\s+(?:(?:van?|quedan?)\s+(?:para|a|en)\s+(?:la\s+)?(?:ubicacion\s+)?[a-z][a-z0-9-]*\d|ubicacion|quedan en|dejar en)\b|$)/u)?.[1]
    ?.replace(/[,;\s]+$/u, '').trim() || null;
  const locationTail = location ? ` en ${location.toLowerCase()}` : '';
  const reasonText = explicitFinishedWasteReason(raw) || (rawReason && locationTail && rawReason.endsWith(locationTail)
    ? rawReason.slice(0, -locationTail.length).trim() : rawReason);
  const reason = reasonText?.replace(/^(?:fue|es|era)\s+/u, '').trim() || null;
  return { conforming, waste, reason, location };
}

function materialLossCandidate(text) {
  const raw = normalize(text);
  // Solo una pérdida explícita de material: «merma de dos tapas». «Una merma
  // por ruptura» describe producto terminado y no debe abrir una reposición.
  const lossNoun = '(?:merma|perdida|desperdicio)\\s+(?:de\\s+)?';
  const damageVerb = '(?:(?:se\\s+)?(?:danaron|dano|dane|danamos|rompieron|rompi|rompimos|perdieron|perdi|perdimos|destruyeron|destrui|destruimos))\\s+';
  const match = new RegExp(`\\b(?:${lossNoun}|${damageVerb})${NUMBER}\\s+(?:und|unidades?|gramos?|g)?\\s*([a-z][a-z0-9\\s-]*?)(?=\\s+(?:por|debido a|causa|motivo)\\b|[,;.]|$)`, 'u').exec(raw);
  if (!match) return null;
  // El lote y una posible reposición son datos del movimiento, no parte del
  // nombre del insumo: «dos liners del lote X» sigue refiriéndose a liners.
  const product = match[2].split(/\s+(?:(?:del?|desde)\s+lote\b|y\s+(?:(?:fueron|han\s+sido)\s+)?repuest[oa]s?\b|y\s+se\s+repusieron\b)/u)[0].trim();
  if (!product || /^(?:producto(?:s)?\s+terminado(?:s)?|unidades?\s+terminadas?|pt)$/u.test(product)) return null;
  const tail = raw.slice(match.index + match[0].length);
  const cause = tail.match(/^\s*(?:por|debido a|causa|motivo)\s+([^.,;]+)/u)?.[1]
    ?.replace(/\s+y\s+(?:(?:fueron|han\s+sido)\s+)?repuest[oa]s?\b.*$/u, '').trim() || null;
  const materialDetails = match[2] + tail;
  const replacement = materialDetails.match(/\b(?:(?:fueron|han\s+sido)\s+)?repuest[oa]s?\b|\bse\s+repusieron\b/u);
  const replacementLot = replacement
    ? materialDetails.slice(replacement.index + replacement[0].length)
      .match(/\b(?:del?|desde\s+el)\s+lote\s+([a-z0-9][a-z0-9_-]*)\b/u)?.[1]?.toUpperCase() || null
    : null;
  return { product, quantity: quantity(match[1]), cause, replacement: !!replacement,
    replacementLot, index: match.index };
}

function explicitFinishedWaste(text) {
  const raw = normalize(text);
  return /\b(?:no\s+conformes?|rechazos?)\b/u.test(raw)
    || /\b(?:mermas?|perdidas?|desperdicios?)\s+(?:(?:de|del)\s+)?(?:producto(?:s)?\s+terminado(?:s)?|unidades?\s+terminadas?|pt)\b/u.test(raw)
    || /\b(?:producto(?:s)?\s+terminado(?:s)?|unidades?\s+terminadas?)\s+(?:en\s+)?(?:merma|perdida|no\s+conforme)\b/u.test(raw);
}

function finishedWasteReply(text) {
  return /^(?:(?:si|es|fue|eran|era|de|del|la|las|el|los)\s+)*(?:producto(?:s)?\s+terminado(?:s)?|unidades?\s+terminadas?|pt)(?:\s+no\s+conformes?)?[.!]?$/u
    .test(normalize(text).replace(/[,;]+/gu, ' ').replace(/\s+/gu, ' ').trim());
}

function materialReply(text) {
  return normalize(text).replace(/^(?:correccion|corrijo)\s*[:,-]?\s*/u, '')
    .replace(/[,;]+/gu, ' ').trim()
    .replace(/^(?:(?:no|solo|fue|fueron|eran|era|es|de|del|la|las|el|los|material(?:es)?|insumo(?:s)?)\s+)+/u, '')
    .replace(/[.!]+$/u, '').trim();
}

function ambiguousConformingQuantity(text) {
  const match = normalize(text).match(new RegExp(`\\b${NUMBER}\\s+(?!con\\b|de\\b|y\\b)[a-z]+(?:\\s+[a-z]+){0,2}\\s+conformes?\\b`, 'u'));
  return match ? quantity(match[1]) : null;
}

function noReplacements(text) {
  return /\b(?:no\s+(?:repuse|repusimos|reponi|repusemos)|sin\s+(?:reposicion|material(?:es)?\s+adicional(?:es)?)|ningun(?:a|o)?\s+material\s+repuesto)\b/u.test(normalize(text));
}

function promoteQueuedMaterial(draft) {
  draft.materialQueue ||= [];
  while (!draft.materialPending && draft.materialQueue.length) {
    const next = draft.materialQueue.shift();
    if (next.sku && next.cantidad != null && next.lote && next.motivo) {
      draft.materials.push(next);
    } else {
      draft.materialPending = next;
    }
  }
  if (draft.materialPending || draft.materialQueue.length) draft.materialsAnswered = false;
}

function replacementsFinished(text) {
  return /^(?:no hay mas(?: materiales)?|ninguno mas|eso es todo|sin mas materiales|listo con los materiales)[.!]?$/u.test(normalize(text));
}

const MATERIAL_START = /\b(?:repuse|repusimos|repusieron|repuso|repusiste|repongo|reponi|reponimos|tom[eé]|tomamos|saqu[eé]|sacamos|material(?:es)?\s+repuesto(?:s)?)\b/iu;

function cleanMaterialCause(value) {
  let cause = String(value || '').trim().replace(/[.,;\s]+$/u, '');
  cause = cause.replace(/^(?:(?:de\s+la\s+reposici[oó]n|de(?:l)?\s+material)\s+(?:fue|es|era)\s+|(?:fue|es|era|por)\s+)/iu, '').trim();
  if (/^(?:merma|p[eé]rdida|reposici[oó]n|material|insumo)$/iu.test(cause)) return null;
  return /^ruptura+$/iu.test(cause) ? 'ruptura' : cause || null;
}

function materialTextSegments(text, { allowImplicit = false } = {}) {
  if (noReplacements(text)) return [];
  const raw = String(text || '');
  const marker = MATERIAL_START.exec(raw);
  if (!marker && !allowImplicit) return [];
  if (!marker && (!/^\s*(?:\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/iu.test(raw)
    || /\b(?:conformes?|mermas?|no\s+conformes?|ubicaci[oó]n)\b/iu.test(raw))) return [];
  const source = marker ? raw.slice(marker.index + marker[0].length) : raw;
  return source.split(/\s*;\s*|\s*,\s*(?=(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b)|\s+y\s+(?=(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b)/iu);
}

function parseMaterialSegments(text, options = {}) {
  return materialTextSegments(text, options).map(segment => {
    const quantityMatch = segment.match(/^\s*(\d+(?:[.,]\d+)?|una|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b\s*(?:und|unidad(?:es)?|gramos?|g)?\s*(?:de\s+)?/iu);
    const lot = segment.match(/\blote\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9_-]*)/iu)?.[1] || null;
    const cause = cleanMaterialCause(segment.match(/\b(?:por|causa|motivo|debido a)\s+(.+?)(?=\s+ubicaci[oó]n\b|$)/iu)?.[1]);
    const location = segment.match(/\bubicaci[oó]n\s*(?:es|:)?\s*([a-z]+\d+[a-z0-9-]*)\b/iu)?.[1] || null;
    const product = segment.slice(quantityMatch?.[0]?.length || 0)
      .split(/\b(?:del?\s+)?lote\b|\b(?:por|causa|motivo|debido a|ubicaci[oó]n)\b/iu)[0]
      .replace(/^(?:de|del|la|el)\s+/iu, '').replace(/\s+y\s+(?:la|el)\s*$/iu, '')
      // «2 tapas sacadas del lote X», «1 liner tomado de…»: el participio no es parte del producto.
      .replace(/\s+(?:(?:que\s+)?(?:sacad|tomad|retirad|repuest|usad|cambiad|reemplazad)[oa]s?|que\s+(?:saqu[eé]|tom[eé]|us[eé]|retir[eé]|sali[oó]|salieron))(?:\s+(?:de|del))?\s*$/iu, '')
      .trim();
    const productTerm = /^(?:material(?:es)?|insumo(?:s)?)$/iu.test(product) ? null : product;
    return { producto: productTerm || null, cantidad: quantityMatch ? quantity(quantityMatch[1]) : null,
      lote: lot, motivo: cause, ubicacion: location?.toUpperCase() || null };
  }).filter(item => item.producto || item.cantidad != null || item.lote || item.motivo);
}

function changedMaterialCandidate(text) {
  const raw = normalize(text).replace(/[.!?]+$/u, '');
  const match = /^(?:se\s+)?(?:cambie|cambiamos|cambiaron|cambio|reemplace|reemplazamos|sustitui|sustituimos)\s+(?:de\s+)?(.+)$/u.exec(raw);
  if (!match || /^(?:el\s+|la\s+)?(?:lote|ubicacion|cantidad|causa|motivo)\b/u.test(match[1])) return null;
  const segment = match[1].trim();
  const count = new RegExp(`^${NUMBER}\\s*(?:und|unidad(?:es)?|g|gramos?)?\\s*(?:de\\s+)?`, 'u').exec(segment);
  const description = segment.slice(count?.[0].length || 0).trim();
  const [product, cause] = description.split(/\s+(?:por|debido a|causa|motivo)\s+/u);
  if (!product || /^(?:material(?:es)?|insumo(?:s)?)$/u.test(product)) return null;
  return { producto: product, cantidad: count ? quantity(count[1]) : null,
    lote: null, motivo: cleanMaterialCause(cause) };
}

function materialFollowup(text) {
  const raw = String(text || '').trim();
  const lot = raw.match(/\blote(?:\s+(?:es|fue|era|sería|seria))?(?:\s+el)?\s*[:#-]?\s*((?!(?:es|fue|era|el|de|del)\b)[A-Za-z0-9][A-Za-z0-9_-]*)/iu)?.[1] || null;
  const cause = cleanMaterialCause(raw.match(/\b(?:causa|motivo)(?:\s+(?:fue|es))?\s*(?:[:\-]|por)?\s+(.+?)(?=\s+y\s+(?:el\s+)?lote\b|[.;]|$)/iu)?.[1]?.trim()
    || raw.match(/\b(?:por|debido a)\s+(.+?)(?=\s+y\s+(?:el\s+)?lote\b|[.;]|$)/iu)?.[1]?.trim()
    || (/^(?:ruptura+|rotura|derrame|contaminacion|contaminación|defecto|caida|caída|daño|dano|despegue)$/iu.test(raw) ? raw : null));
  const location = raw.match(/\b(?:ubicaci[oó]n\s*(?:es|:)?|(?:va|van|queda|quedan)?\s*(?:para|en|a)\s+(?:la\s+)?(?:ubicaci[oó]n\s+)?)\s*([a-z]+\d+[a-z0-9-]*)\b/iu)?.[1] || null;
  return { lote: lot, motivo: cause, ubicacion: location?.toUpperCase() || null };
}

function directMaterialCause(text) {
  const value = String(text || '').trim().replace(/[.!]+$/u, '');
  const raw = normalize(value);
  if (!raw || raw.length > 100 || !/^[a-z]+(?:[ -][a-z]+){0,7}$/u.test(raw)
    || /^(?:si|no|ok|listo|correcto|perfecto|confirmo|continuar|cancelar|cierre|opcion|lote|ubicacion|material|tapa|liner|etiqueta|tarro)(?:\b|$)/u.test(raw)) return null;
  return cleanMaterialCause(value);
}

const LOT_OPTIONS_PER_PAGE = 8;

function lotOptionNumber(text) {
  const raw = normalize(text).replace(/[.!?]+$/u, '');
  const match = /^(?:(?:la|el)\s+)?(?:(?:opcion|lote|numero)\s*(?:numero\s*)?#?\s*)?(\d{1,2})$/u.exec(raw);
  if (match) return Number(match[1]);
  const spoken = /^(?:(?:la|el)\s+)?(?:opcion|lote|numero)\s+(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/u.exec(raw);
  if (spoken) return NUMBER_WORDS[spoken[1]];
  const ordinals = { primera: 1, primero: 1, segunda: 2, segundo: 2,
    tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5 };
  return ordinals[/^(?:(?:la|el)\s+)?(primera|primero|segunda|segundo|tercera|tercero|cuarta|cuarto|quinta|quinto)(?:\s+(?:opcion|lote))?$/u.exec(raw)?.[1]] || null;
}

function lotChoicePrompt(choice) {
  if (!choice.options.length) return [
    `No hay lotes de *${choice.producto} (${choice.sku})* con ${choice.cantidad} ${choice.unidad || 'und'} libres${choice.ubicacion ? ` en *${choice.ubicacion}*` : ''}.`,
    choice.target === 'existing' && choice.allowRetain
      ? 'Si conservarás el lote anterior, responde «conservar lote anterior». Si no, corrige la cantidad o ubicación, o concilia inventario antes de cerrar.'
      : 'Corrige la cantidad o ubicación, o concilia inventario antes de cerrar. No elijas otro lote que no hayas verificado.',
  ].join('\n');
  const start = choice.page * LOT_OPTIONS_PER_PAGE;
  const page = choice.options.slice(start, start + LOT_OPTIONS_PER_PAGE);
  const lines = [
    `🔎 *Lotes disponibles para ${choice.producto} (${choice.sku})*`,
    `Reposición: ${choice.cantidad} ${choice.unidad || 'und'}. Elige el lote que verificaste físicamente:`,
    ...page.map((option, index) => `${start + index + 1}. Lote *${option.lote}* | ubicación *${option.ubicacion}* | libre ${option.disponible} ${choice.unidad || 'und'} | vence ${option.vence || 'sin fecha registrada'}`),
    '', page.length === 1
      ? `Responde «opción ${start + 1}». No necesitas escribir ni deletrear el lote.`
      : `Responde «opción ${start + 1}», «opción ${start + 2}», etc. No necesitas escribir ni deletrear el lote.`,
  ];
  if (start + LOT_OPTIONS_PER_PAGE < choice.options.length) lines.push('Di «más opciones» para ver los siguientes lotes.');
  if (choice.page > 0) lines.push('Di «opciones anteriores» para volver.');
  lines.push('Si no aparece el lote físico, indica la ubicación correcta o pide conciliar inventario. El borrador no modifica inventario.');
  return lines.join('\n');
}

async function availableReplacementLots(db, material, line, location = null) {
  const [rows] = await db.execute(
    `SELECT s.lote, u.codigo AS ubicacion, s.cantidad - s.reservada AS disponible,
            DATE_FORMAT(COALESCE(l.expiry_date, s.fecha_venc), '%Y-%m-%d') AS vence
       FROM stock s JOIN lots l ON BINARY l.lpn = BINARY s.lote AND l.product_id = s.producto_id
       JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
       JOIN bodegas b ON b.id = s.bodega_id AND b.activa = 1
      WHERE s.producto_id = ? AND l.status = 'DISPONIBLE'
        AND s.cantidad - s.reservada >= ? AND l.qty_current >= ?
        AND (? IS NULL OR UPPER(u.codigo) = UPPER(?))
      ORDER BY COALESCE(l.expiry_date, s.fecha_venc), u.codigo, s.lote, s.id`,
    [material.producto_id, line.cantidad, line.cantidad, location, location]
  );
  return rows.map(row => ({ lote: row.lote, ubicacion: row.ubicacion,
    disponible: Number(row.disponible), vence: row.vence ? String(row.vence).slice(0, 10) : null }));
}

async function startLotChoice(db, draft, order, target, index = null, requestedLocation = undefined) {
  const line = target === 'pending' ? draft.materialPending : draft.materials[index];
  if (!line?.sku || line.cantidad == null) return;
  const materials = await orderMaterials(db, order.id);
  const material = materials.find(item => item.sku === line.sku);
  if (!material) throw guideError(`${line.sku} no pertenece a OP ID ${order.id}`);
  const location = requestedLocation === undefined ? line.ubicacion || null : requestedLocation;
  const options = await availableReplacementLots(db, material, line, location);
  draft.materialChoice = { target, index, sku: line.sku,
    producto: line.producto, cantidad: line.cantidad, unidad: line.unidad,
    ubicacion: location, allowRetain: target === 'existing' && !!line.lote,
    options, page: 0 };
}

async function applyLotChoice(db, draft, order, text) {
  const choice = draft.materialChoice;
  if (!choice) return false;
  const raw = normalize(text);
  if (raw === 'conservar lote anterior' && choice.target === 'existing' && choice.allowRetain) {
    draft.materialChoice = null;
    draft.lotValidationMessage = null;
    draft.reviewShown = false;
    return true;
  }
  if (/^(?:mas opciones|siguientes opciones|siguiente pagina)$/u.test(raw)) {
    if ((choice.page + 1) * LOT_OPTIONS_PER_PAGE < choice.options.length) choice.page += 1;
    return true;
  }
  if (/^(?:opciones anteriores|pagina anterior)$/u.test(raw)) {
    choice.page = Math.max(0, choice.page - 1);
    return true;
  }
  const number = lotOptionNumber(text);
  if (number == null) return false;
  const option = choice.options[number - 1];
  if (!option || Math.floor((number - 1) / LOT_OPTIONS_PER_PAGE) !== choice.page) {
    draft.lotValidationMessage = `La opción ${number} no está en la página mostrada. Elige una de las opciones visibles; no se modificó inventario.`;
    return true;
  }
  const line = choice.target === 'pending' ? draft.materialPending : draft.materials[choice.index];
  if (!line || line.sku !== choice.sku || Number(line.cantidad) !== Number(choice.cantidad)) {
    draft.materialChoice = null;
    draft.lotValidationMessage = 'El material o la cantidad cambió. Pide de nuevo los lotes disponibles; no se modificó inventario.';
    return true;
  }
  const materials = await orderMaterials(db, order.id);
  const material = materials.find(item => item.sku === line.sku);
  const candidate = { ...line, lote: option.lote, ubicacion: option.ubicacion };
  const error = await validateReplacementLot(db, material, candidate);
  if (error) {
    await startLotChoice(db, draft, order, choice.target, choice.index);
    draft.lotValidationMessage = `${error} La opción ya no está disponible. Pide de nuevo los lotes; no se modificó inventario.`;
    return true;
  }
  if (choice.target === 'existing' && draft.materials.some((other, index) =>
    index !== choice.index && other.sku === line.sku && other.lote === candidate.lote
      && other.ubicacion === candidate.ubicacion)) {
    draft.materialChoice = null;
    draft.reviewShown = false;
    draft.lotValidationMessage = 'Ese material, lote y ubicación ya figuran en otra partida. Conservé ambas partidas sin cambios; corrige sus cantidades o elimina la partida duplicada antes de confirmar.';
    return true;
  }
  const duplicateIndex = choice.target === 'pending' ? draft.materials.findIndex(other =>
    other.sku === line.sku && other.lote === candidate.lote
      && other.ubicacion === candidate.ubicacion) : -1;
  if (duplicateIndex >= 0) {
    draft.materialPending = null;
    draft.materialChoice = null;
    draft.materialsAnswered = true;
    draft.reviewShown = false;
    draft.lotValidationMessage = `Ese material, lote y ubicación ya figuran en la partida ${duplicateIndex + 1}. No agregué una segunda reposición. Si querías corregir el total, di «corrección: partida ${duplicateIndex + 1}, cantidad 100 ${line.unidad || 'und'}».`;
    return true;
  }
  line.lote = candidate.lote;
  line.ubicacion = candidate.ubicacion;
  line.validatedLotKey = candidate.validatedLotKey;
  if (choice.target === 'pending' && line.damageReport) finishPendingDamage(draft);
  else if (choice.target === 'pending' && line.sku && line.cantidad != null && line.motivo) {
    draft.materials.push(line);
    draft.materialPending = null;
    draft.materialsAnswered = true;
  }
  draft.materialChoice = null;
  draft.lotValidationMessage = null;
  draft.reviewShown = false;
  promoteQueuedMaterial(draft);
  return true;
}

function isLotChangeRequest(text) {
  const raw = normalize(text);
  return (/\b(?:cambiar|cambia|cambio|escoger|elegir|seleccionar|ver|mostrar)\b.*\blote\b/u.test(raw)
    || /^(?:el\s+)?lote\s+(?:de|del|en)\s+.+?\s+(?:es|era|fue|queda)\s+(?:otro|diferente|distinto|incorrecto|equivocado)\b/u.test(raw)
    || /^(?:las?\s+|los?\s+)?[\w\s-]+\s+(?:son|es)\s+de\s+otro\s+lote\b/u.test(raw))
    && !/\blote\b.*\b(?:a|por)\s+[a-z0-9][a-z0-9_-]*[.!]?$/u.test(raw);
}

function lotChangeProductTerm(text) {
  const raw = normalize(text).replace(/[.!?]+$/u, '').trim();
  const action = /^(?:(?:quiero|necesito|voy a|vamos a)\s+)?(?:cambiar|cambia|cambio|escoger|elegir|seleccionar|ver|mostrar)\s+(?:(?:de|el|la)\s+)*lote(?:\s+(?:de|del|en|para)\s+(.+))?$/u.exec(raw);
  const inverted = /^(?:el\s+)?lote\s+(?:de|del|en)\s+(.+?)\s+(?:es|era|fue|queda)\s+(?:otro|diferente|distinto|incorrecto|equivocado)\b/u.exec(raw);
  const alternative = /^(?:las?\s+|los?\s+)?(.+?)\s+(?:son|es)\s+de\s+otro\s+lote\b/u.exec(raw);
  return (action?.[1] || inverted?.[1] || alternative?.[1] || '')
    .replace(/^(?:de\s+)?(?:las?|los?)\s+/u, '').trim() || null;
}

async function requestLotChange(db, draft, order, text) {
  if (!isLotChangeRequest(text)) return false;
  const raw = normalize(text);
  const term = lotChangeProductTerm(text);
  const partition = /\bpartida\s*#?\s*(\d{1,2})\b/u.exec(raw);
  const lines = draft.materials || [];
  const available = term && !partition ? await orderMaterials(db, order.id) : [];
  const recordedSkus = new Set([...lines, draft.materialPending].filter(Boolean).map(line => line.sku));
  const recordedIds = available.filter(item => recordedSkus.has(item.sku)).map(item => item.producto_id);
  const product = term && !partition ? await resolveProductReference(db, term, {
    productIds: recordedIds, allowContextualPartial: true, allowScopedApproximate: true,
  }) : null;
  if (draft.materialPending?.sku && draft.materialPending.cantidad != null) {
    if (partition || (product && product.siigo_code !== draft.materialPending.sku)) {
      throw guideError(`Termina primero la reposición en curso de ${draft.materialPending.producto}; no cambié el borrador.`);
    }
    await startLotChoice(db, draft, order, 'pending');
    return true;
  }
  if (!lines.length) return false;
  let index = 0;
  if (partition) {
    if (Number(partition[1]) >= 1 && Number(partition[1]) <= lines.length) {
      index = Number(partition[1]) - 1;
    } else {
      throw guideError(`No existe la partida ${partition[1]} en este cierre. Revisa el resumen; no cambié el borrador.`);
    }
  } else if (product) {
    const selected = lines.map((line, lineIndex) => ({ line, lineIndex }))
      .filter(item => item.line.sku === product.siigo_code);
    if (!selected.length) throw guideError(`No hay una reposición registrada de ${product.nombre}; no cambié el borrador.`);
    if (selected.length > 1) throw guideError(`Hay ${selected.length} partidas de ${product.nombre}. Di «cambia lote de partida N» usando el número del resumen; no cambié el borrador.`);
    index = selected[0].lineIndex;
  } else if (lines.length > 1) {
    throw guideError('Hay varias reposiciones. Di «cambio de lote en etiquetas» o «cambia lote de partida N»; no cambié el borrador.');
  }
  // Cambiar lote no implica conservar la ubicación del lote anterior. Una
  // ubicación dicha ahora sí limita la lista; sin ella se muestran todas.
  await startLotChoice(db, draft, order, 'existing', index,
    materialFollowup(text).ubicacion || null);
  draft.reviewShown = false;
  return true;
}

function groundedLotHint(text, value) {
  const lot = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(lot)) return null;
  const compact = value => normalize(value).replace(/[^a-z0-9]/gu, '');
  return compact(text).includes(compact(lot)) ? lot : null;
}

function groundedLocationHint(text, value) {
  const code = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9-]*\d[A-Za-z0-9-]*$/u.test(code)) return null;
  const mentioned = normalize(text).match(/\b[a-z][a-z0-9-]*\d[a-z0-9-]*\b/gu) || [];
  return mentioned.includes(normalize(code)) ? code.toUpperCase() : null;
}

async function orderMaterials(db, orderId) {
  const [rows] = await db.execute(
    `SELECT pm.producto_id, pm.unidad, p.siigo_code AS sku, p.nombre
       FROM produccion_materiales pm JOIN productos p ON p.id = pm.producto_id
      WHERE pm.orden_produccion_id = ? ORDER BY pm.id`, [orderId]
  );
  return rows;
}

async function validateReplacementLot(db, material, line) {
  const key = [line.sku, line.cantidad, line.lote, line.ubicacion || ''].join('|');
  const [lots] = await db.execute(
    `SELECT id, lpn, qty_current, status, bodega_id FROM lots
      WHERE UPPER(lpn) = UPPER(?) AND product_id = ? LIMIT 2`,
    [line.lote, material.producto_id]
  );
  if (!lots.length) return `El lote *${line.lote}* no está registrado para *${line.sku}*.`;
  if (lots.length > 1) return `Hay más de un lote que coincide con *${line.lote}* para *${line.sku}*. Revisa el identificador exacto.`;
  // Conservar el código real para las consultas BINARY y el descuento de inventario.
  line.lote = lots[0].lpn;
  if (lots[0].status !== 'DISPONIBLE') return `El lote *${line.lote}* de *${line.sku}* no está disponible.`;
  const [stocks] = await db.execute(
    `SELECT s.id, s.ubicacion_id, s.cantidad, s.reservada, u.codigo AS ubicacion
       FROM stock s JOIN ubicaciones u ON u.id = s.ubicacion_id
      WHERE s.producto_id = ? AND BINARY s.lote = BINARY ?
        AND s.bodega_id = ? AND u.activa = 1
        AND (s.cantidad - s.reservada) > 0
      ORDER BY u.codigo, s.id`,
    [material.producto_id, line.lote, lots[0].bodega_id]
  );
  const candidates = line.ubicacion
    ? stocks.filter(stock => String(stock.ubicacion_id) === String(line.ubicacion)
      || stock.ubicacion.toUpperCase() === String(line.ubicacion).toUpperCase())
    : stocks;
  if (!candidates.length) return `No hay saldo libre de *${line.sku}*, lote *${line.lote}*${line.ubicacion ? ` en ${line.ubicacion}` : ''}.`;
  if (candidates.length > 1) {
    return `El lote *${line.lote}* está en varias ubicaciones: ${candidates.map(stock => stock.ubicacion).join(', ')}. Indica de cuál tomaste el material.`;
  }
  const free = Number(candidates[0].cantidad) - Number(candidates[0].reservada);
  if (free + 0.000001 < Number(line.cantidad)
    || Number(lots[0].qty_current) + 0.000001 < Number(line.cantidad)) {
    return `Saldo insuficiente de *${line.sku}*, lote *${line.lote}*, ubicación *${candidates[0].ubicacion}*: pediste ${line.cantidad} ${line.unidad || ''} y hay ${Math.min(free, Number(lots[0].qty_current))} libres.`;
  }
  line.validatedLotKey = key;
  return null;
}

async function validateDraftReplacementLots(db, draft, order) {
  draft.lotValidationMessage = null;
  const lines = [...(draft.materials || []), draft.materialPending].filter(Boolean);
  if (!lines.some(line => line.sku && line.cantidad != null && line.lote)) return;
  const materials = await orderMaterials(db, order.id);
  for (const line of lines) {
    if (!line.sku || line.cantidad == null || !line.lote) continue;
    const material = materials.find(item => item.sku === line.sku);
    const error = material
      ? await validateReplacementLot(db, material, line)
      : `El material *${line.sku}* no pertenece a *OP ID ${order.id}*.`;
    if (error) {
      line.loteIntentado = line.lote;
      line.loteAnterior ||= line.previousLot || null;
      line.lote = null;
      line.validatedLotKey = null;
      draft.materialsAnswered = false;
      draft.reviewShown = false;
      draft.lotValidationMessage ||= `${error} No se aceptó la corrección ni se modificó inventario. Indica el lote correcto de *${line.producto || line.sku}*.`;
    } else {
      delete line.loteIntentado;
      delete line.loteAnterior;
      delete line.previousLot;
    }
  }
}

function naturalLotCorrection(text, params) {
  const raw = normalize(text);
  const prefix = /^(?:correccion|correcion|corrijo|corrige|perdon|perdona)\b\s*[,;:-]?\s*/u.exec(raw);
  if (!prefix) return null;
  const remainder = raw.slice(prefix[0].length).trim();
  const spoken = /^(?:(?:las?|los?)\s+)?(\d+(?:[.,]\d+)?|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:und|unidades?)?\s*(?:de\s+)?(.+?)\s+(?:salieron|se\s+sacaron|(?:las?|los?)\s+(?:saque|tome))\s+(?:de|del)\s+(?:(?:lote|partida)\s+)?([a-z0-9][a-z0-9_-]{0,79})[.!]?\s*$/u.exec(remainder);
  if (spoken) return { product: spoken[2].trim(), amount: quantity(spoken[1]),
    lot: spoken[3].toUpperCase() };
  const ai = params?.avance_materiales?.correccion_lote;
  if (!ai || typeof ai !== 'object') return null;
  const lot = groundedLotHint(text, ai.lote);
  if (!lot) return null;
  const amount = quantity(ai.cantidad);
  const spokenAmount = /\b(\d+(?:[.,]\d+)?|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/u.exec(remainder)?.[1];
  if (amount != null && quantity(spokenAmount) !== amount) return null;
  return { product: String(ai.producto || '').trim(), amount, lot };
}

function materialQuantityCorrection(text) {
  const raw = normalize(text);
  const prefix = /^(?:correccion|correcion|corrijo|corrige|cambia|cambio|modifica|ajusta|ajuste|perdon|perdona)\b/u.test(raw);
  const indexed = /\b(?:partida|fila|renglon)\s*#?\s*(\d+)\b/u.exec(raw);
  const quantityField = /\b(?:cantidad|reposicion|repuesto|total)\b/u.test(raw);
  // «Corrección partida 3, 100 gramos» identifica una sola fila y un solo dato.
  // Se analiza solo el texto posterior al número de partida para no tomar «3»
  // como cantidad si el operario aún no dijo cuál es el valor nuevo.
  const remainder = prefix && indexed ? raw.slice(indexed.index + indexed[0].length)
    .trim().replace(/^[,;:.-]\s*/u, '') : '';
  const bareIndexed = /^(?:(?:a|son|fueron|eran|es|era|quedaron|quedo)\s+)?(\d+(?:[.,]\d+)?|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(g|gramos?|und|unidad(?:es)?)?\s*[.!]?$/u.exec(remainder);
  const amount = quantity(raw.match(/\b(?:cantidad|reposicion|repuesto|total)\b(?:\s+(?:fue|era|es|de|a|por|quedo|quedaron|fueron))*\s*(\d+(?:[.,]\d+)?|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/u)?.[1]
    || bareIndexed?.[1]
    || raw.match(/\b(\d+(?:[.,]\d+)?|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:g|gramos?|und|unidad(?:es)?)?\s*[.!]?\s*$/u)?.[1]);
  const natural = /^(?:la\s+)?reposicion\s+de\s+(.+?)\s+(?:fue|era|es|quedo)\s+(?:de\s+)?/u.exec(raw);
  const targeted = /^(?:correccion|correcion|corrijo|corrige|cambia|cambio|modifica|ajusta|ajuste|perdon|perdona)\s*[:,.-]?\s*(?:la\s+)?(?:cantidad|reposicion|total)\s+(?:de\s+)?(.+?)\s+(?:a|por|es|fue|era)\s+/u.exec(raw);
  if (!(quantityField || bareIndexed) || amount == null || !(prefix || natural || targeted)) return null;
  const product = natural?.[1] || targeted?.[1] || null;
  if (!indexed && !product) return null;
  const spokenUnit = bareIndexed?.[2] || raw.match(/\b(?:\d+(?:[.,]\d+)?|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(g|gramos?|und|unidad(?:es)?)\s*[.!]?$/u)?.[1] || null;
  return { index: indexed ? Number(indexed[1]) - 1 : null, product, amount, spokenUnit };
}

async function applyQuantityCorrection(db, draft, order, text) {
  const correction = materialQuantityCorrection(text);
  if (!correction) return false;
  const lines = draft.materials || [];
  let index = correction.index;
  if (index != null && (!Number.isSafeInteger(index) || index < 0 || index >= lines.length)) {
    throw guideError(`No existe la partida ${index + 1} en este cierre. Revisa el resumen; no cambié el borrador.`);
  }
  if (correction.product) {
    const available = await orderMaterials(db, order.id);
    const product = await resolveProductReference(db, correction.product, {
      productIds: available.map(row => row.producto_id),
      allowContextualPartial: true, allowScopedApproximate: true,
    });
    const matches = lines.map((line, position) => ({ line, position }))
      .filter(entry => entry.line.sku === product.siigo_code);
    if (index != null && lines[index].sku !== product.siigo_code) {
      throw guideError(`La partida ${index + 1} no corresponde a ${product.nombre}. No cambié el borrador.`);
    }
    if (index == null && matches.length !== 1) {
      throw guideError(matches.length
        ? `Hay ${matches.length} partidas de ${product.nombre}. Di «corrección: partida N, cantidad ${correction.amount} ${matches[0].line.unidad || 'und'}» usando el número del resumen; no cambié el borrador.`
        : `No hay una reposición registrada de ${product.nombre}. No cambié el borrador.`);
    }
    if (index == null) index = matches[0].position;
  }
  const line = lines[index];
  const amount = correction.amount;
  const grams = ['g', 'gr', 'gramo', 'gramos'].includes(String(line.unidad).toLowerCase());
  const spokenGrams = correction.spokenUnit && /^(?:g|gramos?)$/u.test(correction.spokenUnit);
  if (correction.spokenUnit && Boolean(spokenGrams) !== grams) {
    throw guideError(`La partida ${index + 1} se registra en ${line.unidad || 'und'}, no en ${correction.spokenUnit}. No cambié el borrador.`);
  }
  if (amount <= 0 || Math.abs(amount * 1000 - Math.round(amount * 1000)) > 0.000001
    || (!grams && !Number.isInteger(amount))) {
    throw guideError(`La cantidad de la partida ${index + 1} debe ser positiva y corresponder a ${line.unidad || 'und'}. No cambié el borrador.`);
  }
  line.cantidad = amount;
  line.validatedLotKey = null;
  if (draft.materialPending?.sku === line.sku && !draft.materialPending.lote) {
    draft.materialPending = null;
    draft.materialChoice = null;
  }
  draft.materialsAnswered = !draft.materialPending && !draft.materialQueue?.length;
  draft.reviewShown = false;
  draft.lotValidationMessage = null;
  return true;
}

function applyIndexedMaterialCorrection(draft, text) {
  const raw = normalize(text);
  const explicitCorrection = /^(?:correccion|correcion|corrijo|corrige|cambia|cambio|modifica|ajusta|ajuste|perdon|perdona|quita|elimina)\b/u.test(raw);
  const directedPart = /^(?:(?:la|el)\s+)?(?:partida|fila|renglon)\s*#?\s*\d+\s*[,;:]?\s*(?:va|van|queda|quedan|lo\s+(?:pongo|dejo|ubico))\s+(?:para|en|a)\s+(?:la\s+)?(?:ubicacion\s+)?[a-z][a-z0-9-]*\d[a-z0-9-]*[.!]?$/u.test(raw);
  if (!explicitCorrection && !directedPart) return false;
  const reference = /\b(?:partida|fila|renglon)\s*#?\s*(\d+)\b/u.exec(raw);
  if (!reference) return false;
  const index = Number(reference[1]) - 1;
  const line = draft.materials?.[index];
  if (!line) throw guideError(`No existe la partida ${reference[1]} en este cierre. No cambié el borrador.`);
  if (/^(?:quita|elimina)\b/u.test(raw)) {
    draft.materials.splice(index, 1);
  } else {
    const location = /\bubicacion\s*(?:(?:nueva|correcta)\s*)?(?:a|es|era|fue|en|:)?\s*([a-z]+\s*\d+[a-z0-9-]*)\b/u.exec(raw)?.[1]
      || /\b(?:va|van|queda|quedan|lo\s+(?:pongo|dejo|ubico))\s+(?:para|en|a)\s+(?:la\s+)?(?:ubicacion\s+)?([a-z]+\s*\d+[a-z0-9-]*)\b/u.exec(raw)?.[1];
    const lot = /\blote\s+(?:a|es|era|fue|:)\s*([a-z0-9][a-z0-9_-]*)\b/u.exec(raw)?.[1];
    const reason = /\b(?:causa|motivo)\s*(?:a|es|era|fue|por|:)?\s*(.+)$/u.exec(raw)?.[1];
    if (!location && !lot && !reason) return false;
    if (location) line.ubicacion = location.replace(/\s+/gu, '').toUpperCase();
    if (lot) line.lote = lot;
    if (reason) line.motivo = cleanMaterialCause(reason);
    line.validatedLotKey = null;
  }
  // El número de otra partida puede desplazarse al eliminar una fila.
  draft.materialChoice = null;
  draft.materialsAnswered = draft.materials.length > 0
    && !draft.materialPending && !draft.materialQueue?.length;
  draft.reviewShown = false;
  return true;
}

async function applyMaterialCorrection(db, draft, order, text, params) {
  const raw = normalize(text);
  if (await applyQuantityCorrection(db, draft, order, text)) return true;
  if (applyIndexedMaterialCorrection(draft, text)) return true;
  if (draft.materialPending?.sku
    && /^(?:correccion|correcion|corrijo|corrige|cambia|cambio|modifica)\b.*\bcantidad\b/u.test(raw)) {
    const amount = quantity(new RegExp(`\\b(?:cantidad\\s*(?:es|a|por|de)?\\s*)${NUMBER}\\b`, 'u').exec(raw)?.[1]);
    const unit = String(draft.materialPending.unidad || '').toLowerCase();
    if (amount == null || amount <= 0 || Math.abs(amount * 1000 - Math.round(amount * 1000)) > 0.000001
      || (!['g', 'gr', 'gramo', 'gramos'].includes(unit) && !Number.isInteger(amount))) {
      throw guideError('Indica la cantidad nueva del material en su unidad correspondiente; no cambié el borrador.');
    }
    draft.materialPending.cantidad = amount;
    draft.materialPending.lote = null;
    draft.materialChoice = null;
    draft.materialsAnswered = false;
    draft.reviewShown = false;
    return true;
  }
  const followup = materialFollowup(text);
  const causeCorrection = /^(?:correccion|correcion|corrijo|corrige|perdon|perdona)\b\s*[,;:-]?\s*(?:la\s+)?(?:causa|motivo)\b/u.test(raw);
  const targetedCauseCorrection = /^(?:corrige|cambia|modifica)\s+(?:la\s+)?(?:causa|motivo)\s+de\s+.+\s+(?:a|por)\s+.+$/u.test(raw);
  const lotReply = /^(?:(?:salieron|se\s+sacaron|las?\s+saque|los?\s+saque)\s+(?:de|del)\s+lote|(?:correccion|correcion|perdon|perdona)\b\s*[,;:-]?\s*(?:el\s+)?lote)\b/u.test(raw);
  if ((causeCorrection && !targetedCauseCorrection) || lotReply) {
    const lines = [...(draft.materials || []), draft.materialPending].filter(Boolean);
    if (lines.length !== 1) throw guideError('Hay varios materiales en este cierre. Indica cuál quieres corregir; no cambié el borrador.');
    const line = lines[0];
    if (causeCorrection && followup.motivo) line.motivo = cleanMaterialCause(followup.motivo);
    if (lotReply && followup.lote) {
      line.previousLot = line.lote || line.loteAnterior || null;
      line.lote = followup.lote;
    }
    if (line === draft.materialPending) finishPendingDamage(draft);
    draft.materialsAnswered = !draft.materialPending && draft.materials.length > 0
      && draft.materials.every(item => item.sku && item.cantidad != null && item.lote && item.motivo);
    draft.reviewShown = false;
    return true;
  }
  const natural = naturalLotCorrection(text, params);
  if (natural && draft.materials?.length) {
    if (draft.materials.length > 1 && (!natural.product
      || !normalize(text).includes(normalize(natural.product)))) {
      throw guideError('Hay varias partidas en el cierre. Menciona el material que quieres corregir; no cambié el borrador.');
    }
    const available = await orderMaterials(db, order.id);
    const product = natural.product ? await resolveProductReference(db, natural.product, {
      productIds: available.map(row => row.producto_id),
      allowContextualPartial: true, allowScopedApproximate: true,
    }) : null;
    const matches = draft.materials.filter(line => (!product || line.sku === product.siigo_code)
      && (natural.amount == null || Number(line.cantidad) === natural.amount));
    if (matches.length !== 1) {
      throw guideError('No pude identificar una sola partida para corregir. Indica el material y, si hay varios lotes, el lote anterior; no cambié el borrador.');
    }
    const line = matches[0];
    if (draft.materials.some(other => other !== line && other.sku === line.sku && other.lote === natural.lot)) {
      throw guideError('Ese material y lote ya tienen una partida; indica el total en una sola.');
    }
    if (line.lote !== natural.lot) line.previousLot = line.lote || line.loteAnterior || null;
    line.lote = natural.lot;
    draft.materialsAnswered = true;
    return true;
  }
  const match = String(text || '').trim().match(/^(corrige|cambia|modifica|quita|elimina)\s+(?:(lote|cantidad|causa|motivo|ubicaci[oó]n)\s+de\s+)?(?:la\s+|el\s+)?(.+?)(?:\s+(?:a|por)\s+(.+))?$/iu);
  if (!match || !draft.materials?.length) return false;
  const [, operation, field, term, value] = match;
  if (!['quita', 'elimina'].includes(normalize(operation)) && (!field || !value)) {
    throw guideError('Para corregir un material, indica el dato nuevo. Ejemplo: «corrige lote de tapa a L-123».');
  }
  const available = await orderMaterials(db, order.id);
  const product = await resolveProductReference(db, term, {
    productIds: available.map(row => row.producto_id),
    allowContextualPartial: true, allowScopedApproximate: true,
  });
  const matches = draft.materials.map((line, index) => ({ line, index }))
    .filter(entry => entry.line.sku === product.siigo_code);
  if (!matches.length) throw guideError(`No hay material repuesto registrado para ${product.nombre}.`);
  if (matches.length > 1) throw guideError(`Hay varios lotes de ${product.nombre}. Indica el lote anterior que quieres corregir; no cambié el borrador.`);
  const { line, index } = matches[0];
  if (['quita', 'elimina'].includes(normalize(operation))) {
    draft.materials.splice(index, 1);
    draft.materialsAnswered = draft.materials.length > 0;
    return true;
  }
  const newValue = value.trim();
  if (normalize(field) === 'cantidad') {
    const amount = quantity(newValue.replace(/\s*(?:und|unidades?|gramos?|g)$/iu, ''));
    if (amount == null || amount <= 0 || Math.abs(amount * 1000 - Math.round(amount * 1000)) > 0.000001
      || (!['g', 'gr', 'gramo', 'gramos'].includes(String(line.unidad).toLowerCase()) && !Number.isInteger(amount))) {
      throw guideError('La nueva cantidad debe ser positiva y corresponder a la unidad de este material.');
    }
    line.cantidad = amount;
  } else if (normalize(field) === 'lote') {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(newValue)) throw guideError('Indica un lote válido de máximo 80 caracteres.');
    if (draft.materials.some((other, position) => position !== index && other.sku === line.sku && other.lote === newValue)) {
      throw guideError('Ese material y lote ya tienen una partida; indica el total en una sola.');
    }
    if (line.lote !== newValue) line.previousLot = line.lote || line.loteAnterior || null;
    line.lote = newValue;
  } else if (['causa', 'motivo'].includes(normalize(field))) {
    if (newValue.length > 255 || /^(?:merma|perdida|reposicion|material)$/iu.test(normalize(newValue))) {
      throw guideError('Indica una causa concreta de máximo 255 caracteres.');
    }
    line.motivo = cleanMaterialCause(newValue);
  } else {
    line.ubicacion = newValue;
  }
  draft.materialsAnswered = true;
  return true;
}

async function beginMaterialDamage(db, draft, order, damage) {
  if (draft.materialPending) throw guideError('Termina primero el material pendiente antes de reportar otro daño.');
  const available = await orderMaterials(db, order.id);
  const product = await resolveProductReference(db, damage.product, {
    productIds: available.map(row => row.producto_id),
    allowContextualPartial: true, allowScopedApproximate: true,
  });
  const material = available.find(row => Number(row.producto_id) === Number(product.id));
  if (!material) throw guideError(`${damage.product} no es un material de OP ID ${order.id}`);
  draft.materialPending = {
    sku: material.sku, producto: material.nombre, unidad: material.unidad,
    cantidad: damage.quantity, motivo: damage.cause, lote: null, ubicacion: null,
    damageReport: true, replacementDecision: null,
  };
  draft.materialsAnswered = false;
}

function finishPendingDamage(draft) {
  const pending = draft.materialPending;
  if (!pending?.sku || pending.cantidad == null || !pending.lote || !pending.motivo) return;
  const { damageReport, replacementDecision, ...line } = pending;
  const existing = draft.materials.findIndex(item => item.sku === line.sku && item.lote === line.lote);
  if (existing >= 0) draft.materials[existing] = line;
  else draft.materials.push(line);
  draft.materialPending = null;
  draft.materialsAnswered = true;
}

async function resolveUnclassifiedWaste(db, draft, order, text) {
  const candidate = draft.unclassifiedWaste;
  if (!candidate) return false;
  if (finishedWasteReply(text) || (explicitFinishedWaste(text) && closeFields(text).waste == null)) {
    draft.waste = candidate.quantity;
    draft.reason = closeFields(text).reason || candidate.cause || null;
    draft.wasteClassified = true;
    draft.unclassifiedWaste = null;
    return true;
  }
  const term = materialReply(text);
  if (!term || /\b(?:cerrar|cerramos|cierre|produccion|conformes?)\b/u.test(term)
    || /^(?:si|no|confirmo|confirmo cierre|por\b.*|lote\b.*|ubicacion\b.*)$/u.test(term)) return false;
  const cause = term.match(/\b(?:por|causa|motivo|debido a)\s+([^.,;]+)$/u)?.[1]?.trim() || null;
  const materialDescription = term.replace(/\s+\b(?:por|causa|motivo|debido a)\b.*$/u, '')
    .replace(/\s+(?:danad[oa]s?|rot[oa]s?|perdid[oa]s?|defectuos[oa]s?)$/u, '').trim();
  const amountMatch = new RegExp(`^${NUMBER}\\s+(?:und|unidades?|gramos?|g)?\\s*(?:de\\s+)?(.+)$`, 'u').exec(materialDescription);
  const productTerm = amountMatch?.[2]?.trim() || materialDescription;
  try {
    await beginMaterialDamage(db, draft, order, {
      product: productTerm, quantity: amountMatch ? quantity(amountMatch[1]) : null,
      cause: cause || candidate.cause,
    });
  } catch (error) {
    if (error.code === 'PRODUCT_REFERENCE_NOT_FOUND') return false;
    throw error;
  }
  draft.unclassifiedWaste = null;
  return true;
}

async function applyMaterialReport(db, draft, order, text, params) {
  draft.materials ||= [];
  draft.materialPending ||= null;
  if (await applyMaterialCorrection(db, draft, order, text, params)) return;
  const damage = materialLossCandidate(text);
  if (damage) {
    await beginMaterialDamage(db, draft, order, damage);
    if (damage.replacement) {
      draft.materialPending.replacementDecision = true;
      draft.materialPending.lote = damage.replacementLot;
    }
    finishPendingDamage(draft);
    return;
  }
  if (draft.materialPending?.damageReport) {
    const pending = draft.materialPending;
    const answer = normalize(text);
    const aiAdvance = params.avance_materiales && typeof params.avance_materiales === 'object'
      ? params.avance_materiales : {};
    const aiLot = groundedLotHint(text, aiAdvance.lote_reposicion);
    if (pending.cantidad == null) {
      const amount = quantity(answer) ?? quantity(new RegExp(`^${NUMBER}\\b`, 'u').exec(answer)?.[1]);
      if (amount != null) {
        if (amount <= 0 || (!['g', 'gr', 'gramo', 'gramos'].includes(String(pending.unidad).toLowerCase())
          && !Number.isInteger(amount))) throw guideError('Indica una cantidad positiva en la unidad del material.');
        pending.cantidad = amount;
      }
      return;
    }
    if (pending.replacementDecision == null) {
      if (/^(?:no|no\s+(?:las?|los?)\s+repuse|no\s+repuse(?:\s+material)?)\b/u.test(answer)) {
        draft.materialPending = null;
        draft.materialsAnswered = false;
        return;
      }
      const affirmative = (/^si\b/u.test(answer)
        || /\b(?:repuse|reponi|repusimos|saque|sacamos|fueron\s+sacad[oa]s?)\b/u.test(answer))
        && !/\b(?:no|sin)\b/u.test(answer);
      if (affirmative || (aiAdvance.confirmacion_reposicion === true && aiLot
        && !/\b(?:no|sin)\b/u.test(answer))) {
        pending.replacementDecision = true;
      } else {
        return;
      }
    }
    const followup = materialFollowup(text);
    if (followup.lote || aiLot) pending.lote = followup.lote || aiLot;
    if (followup.ubicacion) pending.ubicacion = followup.ubicacion;
    if (pending.cantidad == null) pending.cantidad = quantity(text);
    if (pending.motivo == null && followup.motivo) pending.motivo = followup.motivo;
    finishPendingDamage(draft);
    return;
  }
  if (noReplacements(text)) {
    draft.materials = [];
    draft.materialPending = null;
    draft.materialQueue = [];
    draft.materialsAnswered = true;
    draft.materialIssue = null;
    return;
  }
  const advance = params.avance_materiales && typeof params.avance_materiales === 'object'
    ? params.avance_materiales : {};
  if (replacementsFinished(text) || advance.finalizar === true) {
    if (draft.materialPending || draft.materialQueue?.length) throw guideError('Termina primero los materiales pendientes: faltan cantidad, lote o causa.');
    if (!draft.materials.length) throw guideError('Confirma expresamente si no repusiste material durante esta OP.');
    draft.materialsAnswered = true;
    draft.materialIssue = null;
    return;
  }
  const readyForMaterials = draft.conforming != null && draft.waste != null
    && (draft.waste === 0 || draft.reason) && (draft.conforming === 0 || draft.location);
  const changedMaterial = changedMaterialCandidate(text);
  const segmentOptions = { allowImplicit: readyForMaterials && !draft.materialPending };
  const spokenSegments = materialTextSegments(text, segmentOptions);
  const spoken = parseMaterialSegments(text, segmentOptions);
  if (!spoken.length && changedMaterial) spoken.push(changedMaterial);
  if (MATERIAL_START.test(String(text || '')) && !spoken.length && !draft.materialPending) {
    draft.materialPending = { sku: null, producto: null, cantidad: null, lote: null,
      motivo: null, unidad: null, ubicacion: null };
    draft.materialsAnswered = false;
    return;
  }
  const hasNewMaterial = spoken.length > 0;
  const interpreted = Array.isArray(advance.items) && advance.items.length
    ? advance.items : Array.isArray(params.materiales_repuestos) && params.materiales_repuestos.length
      ? params.materiales_repuestos : [];
  const incoming = hasNewMaterial && !changedMaterial && interpreted.length === spoken.length
    ? spoken.map((said, index) => ({ ...interpreted[index],
      producto: said.producto || interpreted[index].producto || interpreted[index].sku,
      cantidad: said.cantidad ?? interpreted[index].cantidad,
      lote: said.lote || groundedLotHint(spokenSegments[index] || '', interpreted[index].lote),
      // El LLM puede sugerir una causa, pero debe constar en la frase de este
      // insumo. No trasladar la merma del PT ni «reposición» a todos los SKU.
      motivo: said.motivo || (() => {
        const candidate = cleanMaterialCause(interpreted[index].motivo || interpreted[index].causa);
        return candidate && normalize(spokenSegments[index] || '').includes(normalize(candidate))
          ? candidate : null;
      })(),
      ubicacion: said.ubicacion || groundedLocationHint(spokenSegments[index] || '', interpreted[index].ubicacion),
    })) : spoken;
  const materials = incoming.length ? await orderMaterials(db, order.id) : [];
  const pendingBeforeMessage = draft.materialPending;
  for (const item of incoming) {
    const productTerm = String(item.producto || item.sku || item.id_item || '').trim();
    const number = quantity(item.cantidad);
    const lot = String(item.lote || '').trim() || null;
    const reason = cleanMaterialCause(item.motivo || item.causa);
    const location = String(item.ubicacion || '').trim() || null;
    if (reason && /^(?:merma|perdida|pérdida|reposicion|reposición|material)$/iu.test(reason)) {
      throw guideError('Indica la causa concreta del material repuesto, por ejemplo ruptura, derrame o defecto.');
    }
    const product = productTerm ? await resolveProductReference(db, productTerm, {
      productIds: materials.map(row => row.producto_id),
      allowContextualPartial: true, allowScopedApproximate: true,
    }).catch(error => {
      if (error.code !== 'PRODUCT_REFERENCE_NOT_FOUND') throw error;
      const names = materials.map(row => `${row.nombre} (${row.sku})`).join(', ');
      throw guideError(`No identifiqué el material «${productTerm}». Los materiales de OP ID ${order.id} son: ${names}. Indícalo con su nombre o SKU. No cambié el borrador.`);
    }) : null;
    if (productTerm && !materials.some(row => Number(row.producto_id) === Number(product.id))) {
      throw guideError(`El producto ${productTerm} no es un material de OP ID ${order.id}`);
    }
    const recordedParts = changedMaterial && number == null
      ? draft.materials.map((line, index) => line.sku === product.siigo_code ? index + 1 : null)
        .filter(Boolean) : [];
    if (recordedParts.length) {
      const listed = recordedParts.join(', ');
      throw guideError(`Ya hay una reposición de ${product.nombre} en ${recordedParts.length === 1 ? 'la partida' : 'las partidas'} ${listed}. ¿Quieres corregirla o agregar otra reposición? Para corregir, di «cambia lote de partida ${recordedParts[0]}» o «partida ${recordedParts[0]}, cantidad nueva»; para agregar otra, indica cuántas unidades cambiaste. No cambié el borrador.`);
    }
    const differentPending = draft.materialPending?.sku && product
      && product.siigo_code !== draft.materialPending.sku;
    if (differentPending && pendingBeforeMessage) {
      throw guideError(`Primero completa ${draft.materialPending.producto} (${draft.materialPending.sku}). Puedes repetir su cantidad en palabras o cifras; después te mostraré sus lotes y podrás registrar otro SKU.`);
    }
    // Una segunda partida del mismo mensaje no debe sobrescribir la primera,
    // incluso si corresponde al mismo SKU pero se tomó de otro lote.
    const queued = Boolean(draft.materialPending && !pendingBeforeMessage);
    const pending = queued ? {} : draft.materialPending || {};
    const next = {
      sku: product?.siigo_code || pending.sku || null,
      producto: product?.nombre || pending.producto || productTerm || null,
      cantidad: number ?? pending.cantidad ?? null,
      lote: lot || pending.lote || null,
      motivo: reason || pending.motivo || null,
      unidad: product?.unit_label || materials.find(row => Number(row.producto_id) === Number(product?.id))?.unidad
        || pending.unidad || null,
      ubicacion: location || pending.ubicacion || null,
    };
    if (next.cantidad != null && next.cantidad <= 0) throw guideError('La cantidad de material repuesto debe ser mayor que cero.');
    if (next.cantidad != null && Math.abs(next.cantidad * 1000 - Math.round(next.cantidad * 1000)) > 0.000001) {
      throw guideError('La cantidad de material repuesto admite máximo tres decimales.');
    }
    if (next.cantidad != null && next.unidad && !['g', 'gr', 'gramo', 'gramos'].includes(String(next.unidad).toLowerCase())
      && !Number.isInteger(next.cantidad)) throw guideError(`${next.producto} debe informarse en unidades enteras.`);
    if (next.lote?.length > 80 || next.motivo?.length > 255) throw guideError('El lote o la causa exceden la longitud permitida.');
    if (next.sku && next.cantidad != null && next.lote && next.motivo) {
      const existing = draft.materials.findIndex(line => line.sku === next.sku
        && line.lote === next.lote && line.ubicacion === next.ubicacion);
      if (existing >= 0) draft.materials[existing] = next;
      else draft.materials.push(next);
      if (!queued) draft.materialPending = null;
      draft.materialsAnswered = !draft.materialPending && !draft.materialQueue?.length;
    } else if (queued) {
      draft.materialQueue ||= [];
      draft.materialQueue.push(next);
      draft.materialsAnswered = false;
    } else {
      draft.materialPending = next;
      draft.materialsAnswered = false;
    }
  }
  if (!incoming.length && draft.materialPending) {
    const followup = materialFollowup(text);
    const standaloneQuantity = quantity(text);
    if (standaloneQuantity != null && draft.materialPending.cantidad == null) {
      if (standaloneQuantity <= 0) throw guideError('La cantidad de material repuesto debe ser mayor que cero.');
      if (Math.abs(standaloneQuantity * 1000 - Math.round(standaloneQuantity * 1000)) > 0.000001
        || (draft.materialPending.unidad
          && !['g', 'gr', 'gramo', 'gramos'].includes(String(draft.materialPending.unidad).toLowerCase())
          && !Number.isInteger(standaloneQuantity))) {
        throw guideError('La cantidad no corresponde a la unidad del material; revisa si debes responder en gramos o unidades enteras.');
      }
      draft.materialPending.cantidad = standaloneQuantity;
    }
    if (!draft.materialPending.sku && !followup.lote && !followup.motivo && standaloneQuantity == null) {
      const available = await orderMaterials(db, order.id);
      const product = await resolveProductReference(db, String(text || '').trim(), {
        productIds: available.map(row => row.producto_id),
        allowContextualPartial: true, allowScopedApproximate: true,
      });
      draft.materialPending.sku = product.siigo_code;
      draft.materialPending.producto = product.nombre;
      draft.materialPending.unidad = available.find(row => Number(row.producto_id) === Number(product.id))?.unidad
        || product.unit_label;
    }
    if (followup.lote) draft.materialPending.lote = followup.lote;
    if (followup.ubicacion) draft.materialPending.ubicacion = followup.ubicacion;
    const pendingCause = followup.motivo || (draft.materialPending.sku
      && draft.materialPending.cantidad != null && draft.materialPending.lote
      && !draft.materialPending.motivo ? directMaterialCause(text) : null);
    if (pendingCause) {
      if (/^(?:merma|perdida|pérdida|reposicion|reposición|material)$/iu.test(pendingCause)) {
        throw guideError('Indica la causa concreta del material repuesto, por ejemplo ruptura, derrame o defecto.');
      }
      draft.materialPending.motivo = pendingCause;
    }
    if (draft.materialPending.sku && draft.materialPending.cantidad != null
      && draft.materialPending.lote && draft.materialPending.motivo) {
      draft.materials.push(draft.materialPending);
      draft.materialPending = null;
      draft.materialsAnswered = true;
    }
  }
  promoteQueuedMaterial(draft);
}

function confirmed(text) {
  // El verbo, el cierre y el número deben constar en el mensaje del operario.
  // Solo se toleran variantes acotadas de la transcripción de «OP ID».
  return /^confirmo\s+(?:el\s+)?cierre(?:\s+de\s+produccion)?(?:\s+de(?:\s+la)?)?\s+op\s*(?:i\s*[dbv]?|y\s+de)?\s*#?\s*[1-9]\d*[.!]?$/u
    .test(normalize(closeUtterance(text)));
}

function confirmationAttempt(text) {
  const raw = normalize(closeUtterance(text));
  return confirmed(text)
    || /^(?:si|correcto|todo bien|adelante|confirmo|confirmar)(?:[,. ]+(?:el\s+)?cierre(?:\s+de\s+produccion)?(?:\s+de(?:\s+la)?)?(?:\s+op(?:\s+id)?\s+#?\s*[1-9]\d*)?)?[.!]?$/u.test(raw)
    || /^confirmo\s+(?:la\s+)?op(?:\s+id)?\s+#?\s*[1-9]\d*[.!]?$/u.test(raw)
    || /^(?:cerrar|cierre|cierro)(?:\s+(?:la\s+)?(?:orden|op))?[.!]?$/u.test(raw);
}

function confirmationHelp(orderId, prefix = '') {
  return `${prefix}Para cerrar la OP, escribe exactamente: *confirmo cierre OP ID ${orderId}*. El borrador sigue abierto y no se modificó inventario.`;
}

function rejected(text) {
  return /^(?:no|incorrecto|esta mal|corrige|quiero corregir)[.!]?$/u.test(normalize(text));
}

function jsonObject(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

async function pendingCloseDraft(db, userId) {
  const [rows] = await db.execute(
    `SELECT payload_json FROM produccion_cierre_borradores
      WHERE usuario_id = ? AND estado = 'PENDIENTE'
        AND (expira_en > NOW() OR actualizado_en > DATE_SUB(NOW(), INTERVAL 8 HOUR))
      LIMIT 1`, [userId]
  );
  return rows.length ? jsonObject(rows[0].payload_json) : null;
}

function isCloseFollowup(text, draft) {
  if (!draft) return false;
  const raw = normalize(closeUtterance(text));
  // Si la primera selección ya se guardó pero la respuesta no llegó al chat,
  // repetir «opción N» debe mostrar el resumen, nunca caer en modo charla.
  if ((draft.materialChoice || draft.reviewShown) && lotOptionNumber(raw) != null) return true;
  if (draft.materialChoice && /^(?:mas opciones|siguientes opciones|siguiente pagina|opciones anteriores|pagina anterior)$/u.test(raw)) return true;
  if (isLotChangeRequest(raw)) return true;
  if (materialLossCandidate(raw)) return true;
  if (changedMaterialCandidate(raw)) return true;
  if (confirmationAttempt(raw) || rejected(raw)) return true;
  if (/^op\s*(?:id\s*)?#?\s*[1-9]\d*[.!]?$/u.test(raw)) return true;
  if (/^(?:corrige|cambia|modifica|quita|elimina|correccion|correcion|corrijo|perdon|perdona)\b/u.test(raw)) return true;
  if (!draft.orderId && contextualOrderCandidate(raw, true)) return true;
  if (/\b(?:conformes?|mermas?|no conformes?|motivo|causa|ubicacion|dejar en|quedan en|por|repuse|repusimos|repuesto|lote|materiales?)\b/u.test(raw)) return true;
  if (closeFields(raw).location && /\b(?:va|van|queda|quedan|dejo|pongo)\s+(?:para|en|a)\b/u.test(raw)) return true;
  if (noReplacements(raw) || replacementsFinished(raw)) return true;
  if (draft.materialPending && raw.length < 120 && !/[?¿]/u.test(raw)) return true;
  if (draft.unclassifiedWaste && raw.length < 120 && !/[?¿]/u.test(raw)) return true;
  if (draft.conforming != null && draft.waste != null && (draft.conforming === 0 || draft.location)
    && parseMaterialSegments(raw, { allowImplicit: true }).length) return true;
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(raw) && /\d/u.test(raw)) return true;
  if (quantity(raw) != null) return true;
  if (draft.waste > 0 && !draft.reason && raw.length < 80 && !/[?¿]/u.test(raw)) return true;
  return false;
}

async function loadOrder(db, orderId) {
  const [rows] = await db.execute(
    `SELECT op.id, op.codigo_orden, op.estado, op.cantidad_planeada, op.producto_id,
            p.siigo_code AS sku, p.nombre AS producto
       FROM ordenes_produccion op JOIN productos p ON p.id = op.producto_id
      WHERE op.id = ? LIMIT 1`, [orderId]
  );
  const order = rows[0];
  if (!order) throw guideError(`No existe la OP ID ${orderId}`, 404);
  return order;
}

async function suggestedLocation(db, productId) {
  const [rows] = await db.execute(
    `SELECT u.codigo FROM producto_ubicaciones pu
      JOIN ubicaciones u ON u.id = pu.ubicacion_id AND u.activa = 1
      JOIN bodegas b ON b.id = u.bodega_id AND b.activa = 1
      WHERE pu.producto_id = ? AND pu.activa = 1
      ORDER BY pu.prioridad, u.codigo LIMIT 1`, [productId]
  );
  return rows[0]?.codigo || null;
}

async function saveDraft(db, userId, draft) {
  await db.execute(
    `INSERT INTO produccion_cierre_borradores
       (usuario_id, orden_produccion_id, payload_json, estado, expira_en)
     VALUES (?, ?, ?, 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 8 HOUR))
     ON DUPLICATE KEY UPDATE orden_produccion_id = VALUES(orden_produccion_id),
       payload_json = VALUES(payload_json), estado = 'PENDIENTE',
       expira_en = VALUES(expira_en), actualizado_en = NOW()`,
    [userId, draft.orderId || null, JSON.stringify(draft)]
  );
}

async function finishDraft(db, userId, draft) {
  await db.execute(
    `UPDATE produccion_cierre_borradores
        SET estado = 'CONFIRMADO', actualizado_en = NOW()
      WHERE usuario_id = ? AND estado = 'PENDIENTE' AND JSON_CONTAINS(payload_json, ?)`,
    [userId, JSON.stringify(draft)]
  );
}

function closeCorrectionHelp(draft) {
  const tips = [];
  if (draft.conforming != null || draft.waste != null || draft.location) {
    const finished = [];
    if (draft.conforming != null) finished.push('«conformes a [nueva cantidad]»');
    if (draft.waste != null) finished.push('«no conformes a [nueva cantidad]»');
    if (draft.waste > 0) finished.push('«la causa del producto no conforme es [nuevo motivo]»');
    if (draft.location) finished.push('«el conforme va para [nueva ubicación]»');
    tips.push(`• Producto terminado: para cambiar un dato, di ${finished.join(', ')}. Puedes dar varios cambios juntos.`);
  }

  const materials = draft.materials || [];
  const counts = new Map();
  for (const item of materials) counts.set(item.sku, (counts.get(item.sku) || 0) + 1);
  const unique = materials.find(item => counts.get(item.sku) === 1);
  if (unique) {
    const shortName = normalize(unique.producto).split(' ')[0];
    const ambiguousName = materials.some(item => item.sku !== unique.sku
      && normalize(item.producto).split(' ')[0] === shortName);
    const reference = shortName.length >= 3 && !ambiguousName ? shortName : unique.sku;
    const exampleQuantity = ['g', 'gr', 'gramo', 'gramos'].includes(normalize(unique.unidad))
      ? '100 g' : `2 ${unique.unidad || 'und'}`;
    tips.push(`• Insumo que aparece una sola vez: basta nombrarlo o indicar su SKU. Di «cambio de lote en ${reference}» para elegir otro lote, «corrige cantidad de ${reference} a ${exampleQuantity}», «corrige causa de ${reference} a [nuevo motivo]» o «corrige ubicación de ${reference} a [nueva ubicación]». No necesitas decir «corrección» ni el número de partida.`);
  }
  if (materials.length) {
    const repeatedIndex = materials.findIndex(item => counts.get(item.sku) > 1);
    if (repeatedIndex >= 0) {
      const unit = materials[repeatedIndex].unidad || 'und';
      const exampleQuantity = ['g', 'gr', 'gramo', 'gramos'].includes(normalize(unit)) ? '100 g' : `2 ${unit}`;
      tips.push(`• El mismo insumo figura en varias partidas: indica cuál quieres cambiar, por ejemplo «cambia lote de partida ${repeatedIndex + 1}» o «partida ${repeatedIndex + 1}, cantidad ${exampleQuantity}».`);
    } else {
      tips.push('• Si más adelante un insumo figura en varias partidas, indica el número de partida que aparece en el resumen para distinguirlas.');
    }
  } else if (draft.materialPending?.sku) {
    tips.push(`• Insumo en curso: si la cantidad está mal, di «corrige cantidad a 2 ${draft.materialPending.unidad || 'und'}»; si el lote está mal, di «cambia lote». Termina este insumo antes de añadir otro.`);
  }
  return tips.length ? ['*Si necesitas corregir algo registrado*', ...tips] : [];
}

function guideSummary(order, draft, locationHint) {
  // Igual que en alistamiento, una elección activa muestra solo sus opciones.
  // El resumen completo se presenta después de elegir el lote y antes de cerrar.
  if (draft.materialChoice) {
    const warning = draft.lotValidationMessage
      ? `⚠️ ${draft.lotValidationMessage}\n\n` : '';
    return `🏭 *OP ID ${order.id} — elige lote*\n\n${warning}${lotChoicePrompt(draft.materialChoice)}`;
  }
  const missing = [];
  if (draft.unclassifiedWaste) missing.push('identificar la merma mencionada');
  if (draft.conforming == null) missing.push('cantidad conforme');
  if (draft.waste == null && !draft.unclassifiedWaste) missing.push('cantidad no conforme de producto terminado');
  if (draft.waste > 0 && !draft.reason) missing.push('causa del producto no conforme');
  if (draft.conforming > 0 && !draft.location) missing.push('ubicación del producto terminado');
  if (!draft.materialsAnswered || draft.materialPending || draft.materialQueue?.length) missing.push('reposición de insumos');
  if (draft.materialIssue) missing.push('aclarar un material que no se pudo registrar');
  if ((draft.materials || []).some(item => !item.lote)) missing.push('lote válido del material repuesto');
  if (draft.materialChoice) missing.push('elegir el lote del material repuesto');
  const readyForReview = !missing.length && draft.conforming + draft.waste > 0;
  const lines = ['🏭 *OP ID ' + order.id + ' — cierre en borrador*',
    `Producto: ${order.producto} (${order.sku})`,
    `Plan: ${Number(order.cantidad_planeada)} und`,
    locationHint && draft.conforming !== 0
      ? `Ubicación sugerida para el producto terminado conforme: *${locationHint}* (verifica físicamente).` : null,
    ''].filter(line => line != null);
  if (readyForReview) {
    if (draft.lotValidationMessage) lines.push(`⚠️ ${draft.lotValidationMessage}`, '');
    lines.push('*Resumen para confirmar*',
      `• Producto terminado conforme: ${draft.conforming} und`,
      `• Producto terminado no conforme: ${draft.waste} und${draft.waste ? ` | Causa: ${draft.reason}` : ''}`,
      `• Ubicación del conforme: ${draft.conforming ? draft.location : 'no aplica'}`,
      '', '*Insumos repuestos*');
    lines.push(...(draft.materials || []).length
      ? draft.materials.map((item, index) =>
        `• Partida ${index + 1} — ${item.producto} (${item.sku}): ${item.cantidad} ${item.unidad || ''} | Lote de reposición: ${item.lote} | Causa: ${item.motivo}${item.ubicacion ? ` | Ubicación: ${item.ubicacion}` : ''}`)
      : ['• Ninguno']);
    const difference = Number(order.cantidad_planeada) - draft.conforming - draft.waste;
    lines.push('', `Conciliación de producto terminado: ${draft.conforming} conforme(s) + ${draft.waste} no conforme(s) = ${draft.conforming + draft.waste} und frente a ${Number(order.cantidad_planeada)} planeadas.`);
    if (difference !== 0) lines.push('', `Diferencia frente al plan: ${difference} und. Verifica este dato.`);
    lines.push('', 'Si repusiste otro SKU, lote o ubicación, repórtalo antes de confirmar; te mostraré sus lotes por separado.');
    lines.push('', ...closeCorrectionHelp(draft));
    lines.push(`Revisa el resumen. Si está correcto, responde *confirmo cierre OP ID ${order.id}*.`);
    lines.push('', 'Este borrador no cierra la OP ni modifica inventario.');
    return lines.join('\n');
  }
  const captured = [];
  if (draft.conforming != null) captured.push(`• Conformes: ${draft.conforming} und`);
  if (draft.waste != null) captured.push(`• No conformes de producto terminado: ${draft.waste} und${draft.reason ? ` | Causa: ${draft.reason}` : ''}`);
  if (draft.location) captured.push(`• Ubicación del terminado: ${draft.location}`);
  if (draft.unclassifiedWaste) captured.push(`• Merma sin clasificar: ${draft.unclassifiedWaste.quantity} und${draft.unclassifiedWaste.cause ? ` | Causa indicada: ${draft.unclassifiedWaste.cause}` : ''}`);
  for (const [index, item] of (draft.materials || []).entries()) {
    const lot = item.lote || `pendiente${item.loteIntentado ? ` (se rechazó ${item.loteIntentado})` : ''}`;
    captured.push(`• Partida ${index + 1} — Insumo ${item.lote ? 'repuesto' : 'en corrección'}: ${item.cantidad} ${item.unidad || ''} de ${item.producto} | Lote ${lot} | Causa: ${item.motivo}${item.loteAnterior ? ` | Lote anterior sin ratificar: ${item.loteAnterior}` : ''}`);
  }
  if (draft.materialPending) {
    const item = draft.materialPending;
    captured.push(`• Insumo en curso: ${item.producto || 'sin identificar'}${item.sku ? ` (${item.sku})` : ''} | Cantidad: ${item.cantidad ?? 'pendiente'} | Lote: ${item.lote || `pendiente${item.loteIntentado ? ` (se rechazó ${item.loteIntentado})` : ''}`} | Causa: ${item.motivo || 'pendiente'}`);
  }
  if (draft.materialQueue?.length) {
    captured.push(`• Después: ${draft.materialQueue.map(item => `${item.producto} (${item.sku})`).join(', ')}. Se revisarán sus lotes uno por uno.`);
  }
  lines.push('*Registrado hasta ahora*', ...(captured.length ? captured : ['• Aún no hay datos del cierre.']),
    '', ...(draft.lotValidationMessage ? [`⚠️ ${draft.lotValidationMessage}`, ''] : []),
    `*Falta:* ${missing.length ? missing.join(', ') : 'revisar las cantidades'}.`, '', '*Siguiente paso*');
  if (draft.materialPending?.damageReport && draft.materialPending.replacementDecision == null) {
    if (draft.materialPending.cantidad == null) {
      lines.push(`¿Cuántas ${draft.materialPending.unidad || 'und'} de ${draft.materialPending.producto} se dañaron?`);
    } else {
      lines.push(`¿Repusiste ${draft.materialPending.cantidad} ${draft.materialPending.unidad || 'und'} de ${draft.materialPending.producto}? Responde *sí* o *no*. Si las repusiste, indica de qué lote las sacaste.`);
    }
  } else if (draft.materialPending?.damageReport && draft.materialPending.replacementDecision && !draft.materialPending.lote) {
    lines.push(`¿De qué lote sacaste ${draft.materialPending.cantidad} ${draft.materialPending.unidad || 'und'} de ${draft.materialPending.producto} para reponerlas?`);
  } else if (draft.materialPending?.damageReport && draft.materialPending.replacementDecision && !draft.materialPending.motivo) {
    lines.push(`¿Cuál fue la causa concreta del daño de ${draft.materialPending.producto}?`);
  } else if (draft.unclassifiedWaste) {
    lines.push(`Escuché «${draft.unclassifiedWaste.quantity} merma», pero no sé qué se dañó. ¿Fue *producto terminado* o un *insumo*? Puedes decir «producto terminado» o «corrección: fueron 2 tapas dañadas por ruptura».`);
  } else if (draft.conforming == null) {
    if (draft.conformingClarification != null) {
      lines.push(`Escuché ${draft.conformingClarification} unidades con un nombre de material. ¿Son *${draft.conformingClarification} productos terminados conformes*? Responde «${draft.conformingClarification} conformes» o corrige la cantidad.`);
    } else {
      lines.push('¿Cuántas unidades de producto terminado salieron conformes?');
    }
  }
  else if (draft.waste == null) lines.push('¿Cuántas unidades de producto terminado fueron no conformes? Si ninguna, responde «0 no conformes».');
  else if (draft.conforming === 0 && draft.waste === 0) lines.push('Ambas cantidades son cero. Corrige conformes o merma para poder cerrar.');
  else if (draft.waste > 0 && !draft.reason) lines.push('¿Cuál fue la causa del producto terminado no conforme?');
  else if (draft.conforming > 0 && !draft.location) {
    lines.push('¿En qué ubicación quedará el producto terminado conforme?');
  } else if (draft.materialPending) {
    const item = draft.materialPending;
    if (!item.sku) lines.push('¿Qué producto o alias repusiste? Debe ser un material de esta OP.');
    else if (item.cantidad == null) lines.push(`¿Cuánto ${item.producto} repusiste? Indica la unidad correspondiente.`);
    else if (!item.lote) lines.push(`¿De qué lote sacaste ${item.cantidad} ${item.producto}?`);
    else if (!item.motivo) lines.push(`¿Cuál fue la causa concreta de reponer ${item.producto} del lote ${item.lote}?`);
  } else if ((draft.materials || []).some(item => !item.lote)) {
    const item = draft.materials.find(line => !line.lote);
    lines.push(`Indica el lote correcto de ${item.producto}. Por ejemplo: «corrige lote de ${item.producto} a [lote]». El cierre sigue en borrador.`);
  } else if (draft.materialIssue) {
    lines.push(`No pude registrar una reposición: ${draft.materialIssue} Indica de nuevo ese material con la cantidad correcta. Cuando estén todos registrados, di *no hay más materiales* para revisar el cierre.`);
  } else if (!draft.materialsAnswered) {
    lines.push('¿Repusiste algún material de esta OP? Puedes decir uno o varios productos con cantidad, lote y causa; también por partes. Si no repusiste ninguno, di *no repuse material*.');
  } else {
    lines.push('Ambas cantidades están en cero. Corrige conformes o no conformes antes de cerrar.');
  }
  const corrections = closeCorrectionHelp(draft);
  lines.push('', ...(corrections.length ? [...corrections, ''] : []),
    'Puedes responder el siguiente paso o dar varios datos juntos. Conservaré lo ya registrado.',
    'Aún no se modifica inventario.');
  return lines.join('\n');
}

async function advanceCloseGuide({ db, userId, from, rawText, params = {} }) {
  rawText = closeUtterance(rawText);
  const prior = await pendingCloseDraft(db, userId);
  let spokenOrderId;
  try {
    spokenOrderId = closeOrderReference(rawText, params);
  } catch (error) {
    if (!prior?.orderId || !confirmationAttempt(rawText)) throw error;
    return { message: confirmationHelp(prior.orderId,
      'No pude verificar la referencia de tu mensaje. No se cerró nada.\n'), draft: prior };
  }
  if (spokenOrderId && prior?.orderId && spokenOrderId !== prior.orderId) {
    if (confirmationAttempt(rawText)) {
      return { message: confirmationHelp(prior.orderId,
        `Escribiste OP ID ${spokenOrderId}, pero el borrador activo es OP ID ${prior.orderId}. No se cerró nada.\n`), draft: prior };
    }
    throw guideError(`Tienes un cierre pendiente para OP ID ${prior.orderId}. Termínalo o cancélalo antes de cambiar de OP.`);
  }
  const draft = prior || { orderId: null, conforming: null, waste: null,
    reason: null, location: null, materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false, candidateOrderId: null };
  if (spokenOrderId) {
    draft.orderId = spokenOrderId;
    draft.candidateOrderId = null;
  }
  if (!draft.orderId && confirmationAttempt(rawText) && draft.candidateOrderId) {
    draft.orderId = draft.candidateOrderId;
    draft.candidateOrderId = null;
  }
  if (!draft.orderId && rejected(rawText) && draft.candidateOrderId) {
    draft.candidateOrderId = null;
  }
  if (!draft.orderId && !draft.candidateOrderId && !rejected(rawText)) {
    draft.orderId = await recentOrderContext(db, from);
  }
  if (!draft.orderId) {
    const candidate = contextualOrderCandidate(rawText, !!prior);
    if (candidate) {
      const order = await loadOrder(db, candidate);
      if (order.estado !== 'EN_PROCESO') {
        throw guideError(`La OP ID ${candidate} está ${order.estado}. Indica una OP en proceso; no se cerró nada.`);
      }
      draft.candidateOrderId = candidate;
      await saveDraft(db, userId, draft);
      return { message: `🏭 ¿Te refieres al cierre de *OP ID ${candidate}*? Responde *sí* para continuar o indica otro OP ID. No se modificó inventario.`, draft };
    }
    await saveDraft(db, userId, draft);
    return { message: '🏭 ¿Cuál es el *OP ID* de la producción que vas a cerrar? No se modificó inventario.', draft };
  }
  const order = await loadOrder(db, draft.orderId);
  if (order.estado === 'CERRADA') return { message: `La *OP ID ${order.id}* ya estaba cerrada. No se modificó inventario.`, draft };
  if (order.estado !== 'EN_PROCESO') {
    throw guideError(`La OP ID ${order.id} está ${order.estado}. Confirma primero sus materiales; no se cerró.`);
  }
  if (!draft.locationSuggestionLoaded) {
    draft.suggestedLocation = await suggestedLocation(db, order.producto_id);
    draft.locationSuggestionLoaded = true;
  }
  // Los borradores previos no guardaban el tipo de merma. Se reclasifican sin
  // inventario para que una cifra ambigua nunca termine como PT por defecto.
  if (draft.waste > 0 && draft.wasteClassified !== true) {
    draft.unclassifiedWaste ||= { quantity: draft.waste, cause: draft.reason || null };
    draft.waste = null;
    draft.reason = null;
  }
  const materialMarker = MATERIAL_START.exec(String(rawText || ''));
  const damageMarker = materialLossCandidate(rawText);
  const changedMaterialMarker = changedMaterialCandidate(rawText);
  const closeText = materialMarker ? String(rawText).slice(0, materialMarker.index)
    : damageMarker ? String(rawText).slice(0, damageMarker.index)
      : changedMaterialMarker ? '' : rawText;
  const parsed = closeFields(closeText);
  const partTargeted = /\b(?:partida|fila|renglon)\s*#?\s*\d+\b/u.test(normalize(rawText));
  const naturalDestination = /^(?:va|van|queda|quedan|lo\s+(?:pongo|dejo|ubico))\s+(?:para|en|a)\s+(?:la\s+)?(?:ubicacion\s+)?[a-z][a-z0-9-]*\d[a-z0-9-]*[.!]?$/u.test(normalize(rawText));
  if (naturalDestination && draft.materials?.length && !draft.materialPending && draft.location) {
    return { message: 'Hay producto terminado y materiales repuestos en este cierre. ¿Qué ubicación corriges? Di «el conforme va para la C3» o «partida N va para la A14». No cambié el borrador.', draft };
  }
  const explicitPtReason = explicitFinishedWasteReason(rawText);
  const targetedPtReason = explicitPtReason
    && (!draft.materialPending || /\b(?:producto\s+terminado|no\s+conformes?)\b/u.test(normalize(rawText)))
    ? explicitPtReason : null;
  if (/^(?:correccion|correcion|corrijo|corrige|cambio|cambia|perdon|perdona)\b.*\bubicacion\b/u.test(normalize(rawText))
    && !parsed.location && !draft.materials?.length && !draft.materialPending) {
    return { message: `No pude identificar el código nuevo de ubicación. El borrador conserva ${draft.location || 'la ubicación pendiente'}. Dime, por ejemplo, «la ubicación es C3». No se modificó inventario.`, draft };
  }
  const hadPendingMaterial = Boolean(draft.materialPending);
  const choiceHandled = await applyLotChoice(db, draft, order, rawText);
  const choiceWarning = choiceHandled ? draft.lotValidationMessage : null;
  if (!choiceHandled && draft.materialChoice && !confirmationAttempt(rawText)) draft.materialChoice = null;
  const wantsLotChange = !choiceHandled && isLotChangeRequest(rawText);
  let materialWarning = null;
  if (!choiceHandled && !wantsLotChange && !targetedPtReason
    && ((!confirmationAttempt(rawText) && !rejected(rawText)) || draft.materialPending?.damageReport)) {
    try {
      await applyMaterialReport(db, draft, order, rawText, params);
    } catch (error) {
      // Un material incorrecto en un mensaje mixto no debe borrar cantidades,
      // merma ni ubicación válidas, ni autorizar el cierre incompleto.
      const hasFinishedFields = parsed.conforming != null || parsed.waste != null
        || parsed.location || parsed.reason;
      if (error.status !== 409 || !hasFinishedFields
        || !parseMaterialSegments(rawText).length) throw error;
      materialWarning = error.message;
      draft.materialIssue = materialWarning;
      draft.materialsAnswered = false;
      draft.reviewShown = false;
    }
  }
  if (draft.unclassifiedWaste && !damageMarker && !draft.materialPending) {
    await resolveUnclassifiedWaste(db, draft, order, rawText);
  }
  if (parsed.conforming != null) {
    draft.conforming = parsed.conforming;
    draft.conformingClarification = null;
  } else if (draft.conforming == null) {
    draft.conformingClarification = ambiguousConformingQuantity(closeText) ?? draft.conformingClarification ?? null;
  }
  if (parsed.waste === 0) {
    draft.waste = 0;
    draft.wasteClassified = true;
    draft.unclassifiedWaste = null;
  } else if (parsed.waste > 0 && explicitFinishedWaste(closeText)) {
    draft.waste = parsed.waste;
    draft.wasteClassified = true;
    draft.unclassifiedWaste = null;
  } else if (parsed.waste > 0) {
    draft.unclassifiedWaste = { quantity: parsed.waste, cause: parsed.reason || null };
    draft.waste = null;
    draft.reason = null;
  }
  if (draft.waste === 0) draft.reason = null;
  if (draft.conforming === 0) draft.location = null;
  if (targetedPtReason && draft.waste > 0) draft.reason = targetedPtReason;
  else if (parsed.reason && draft.waste > 0
    && (parsed.waste > 0 || (!draft.reason && !hadPendingMaterial))) draft.reason = parsed.reason;
  if (parsed.location && !hadPendingMaterial && !partTargeted && !wantsLotChange) draft.location = parsed.location;
  const singleQuantity = quantity(rawText);
  if (singleQuantity != null && parsed.conforming == null && parsed.waste == null
    && !choiceHandled && !hadPendingMaterial && !draft.unclassifiedWaste) {
    if (draft.conforming == null) draft.conforming = singleQuantity;
    else if (draft.waste == null) {
      draft.unclassifiedWaste = { quantity: singleQuantity, cause: null };
    }
  }
  if (draft.waste > 0 && !draft.reason && parsed.reason == null && !hadPendingMaterial
    && !damageMarker
    && !spokenOrderId && !parsed.location && parsed.conforming == null && parsed.waste == null
    && !confirmationAttempt(rawText) && !rejected(rawText)) {
    const candidate = String(rawText || '').trim();
    if (candidate && candidate.length <= 100 && !/[?¿]/u.test(candidate)
      && !(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/iu.test(candidate) && /\d/u.test(candidate))) draft.reason = candidate;
  }
  if (draft.conforming > 0 && !draft.location && !spokenOrderId && !hadPendingMaterial) {
    const standalone = normalize(rawText).match(/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/u);
    if (standalone && /\d/u.test(standalone[1])) draft.location = standalone[1].toUpperCase();
  }
  if (draft.conforming != null && (!Number.isInteger(draft.conforming) || draft.conforming < 0
      || draft.conforming > Number(order.cantidad_planeada))) {
    throw guideError(`Los conformes deben ser unidades enteras entre 0 y ${Number(order.cantidad_planeada)}.`);
  }
  if (draft.waste != null && (!Number.isInteger(draft.waste) || draft.waste < 0)) {
    throw guideError('La merma debe ser cero o un número entero de unidades.');
  }
  if (draft.location) {
    const [locations] = await db.execute(
      `SELECT u.codigo FROM ubicaciones u JOIN bodegas b ON b.id = u.bodega_id
        WHERE UPPER(u.codigo) = UPPER(?) AND u.activa = 1 AND b.activa = 1 LIMIT 1`,
      [draft.location]
    );
    if (!locations.length) throw guideError(`La ubicación ${draft.location} no existe o no está activa. Indica otra.`);
    draft.location = locations[0].codigo;
  }
  await validateDraftReplacementLots(db, draft, order);
  if (wantsLotChange) await requestLotChange(db, draft, order, rawText);
  else if (!draft.materialChoice && draft.materialPending?.sku
    && draft.materialPending.cantidad != null && !draft.materialPending.lote
    && (!draft.materialPending.damageReport || draft.materialPending.replacementDecision)) {
    await startLotChoice(db, draft, order, 'pending');
  } else if (!draft.materialChoice && !draft.materialPending
    && (draft.materials || []).some(item => item.sku && item.cantidad != null && !item.lote)) {
    await startLotChoice(db, draft, order, 'existing', draft.materials.findIndex(item => !item.lote));
  }
  if (choiceWarning) draft.lotValidationMessage = choiceWarning;
  const complete = draft.conforming != null && draft.waste != null
    && draft.conforming + draft.waste > 0 && (draft.waste === 0 || !!draft.reason)
    && (draft.conforming === 0 || !!draft.location)
    && draft.materialsAnswered && !draft.materialIssue && !materialWarning
    && !draft.materialPending && !draft.materialQueue?.length
    && !draft.materialChoice && !draft.unclassifiedWaste
    && draft.materials.every(item => !!item.lote);
  if (confirmed(rawText) && complete && draft.reviewShown) {
    return { params: { id_orden: draft.orderId, cantidad_real: draft.conforming,
      merma: draft.waste, motivo_merma: draft.reason, ubicacion: draft.location,
      materiales_repuestos: draft.materials.map(item => ({ sku: item.sku,
        cantidad: item.cantidad, lote: item.lote, motivo: item.motivo,
        ubicacion: item.ubicacion || undefined })) }, draft };
  }
  if (confirmationAttempt(rawText) && complete && draft.reviewShown) {
    return { message: confirmationHelp(order.id), draft };
  }
  if (rejected(rawText)) draft.reviewShown = false;
  else draft.reviewShown = complete;
  await saveDraft(db, userId, draft);
  const summary = guideSummary(order, draft, draft.suggestedLocation);
  return { message: materialWarning
    ? `⚠️ ${materialWarning}\nConservé los datos válidos. Repite solo el material pendiente o corrige su cantidad; todavía no se puede confirmar.\n\n${summary}`
    : summary, draft };
}

module.exports = { advanceCloseGuide, closeFields, closeOrderReference, confirmed,
  finishDraft, guideSummary, isCloseFollowup, parseMaterialSegments, pendingCloseDraft };
