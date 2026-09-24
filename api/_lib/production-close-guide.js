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

function quantity(value) {
  if (value == null) return null;
  const text = normalize(value);
  const number = Object.hasOwn(NUMBER_WORDS, text) ? NUMBER_WORDS[text] : Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function closeOrderReference(text, params = {}) {
  const standard = explicitReferences(text).map(referenceKey).filter(Boolean);
  // Transcripciones de "OP ID": OPIV, OPID, OPI y OP y de.
  const normalized = normalize(text);
  const fuzzy = [
    ...normalized.matchAll(/\bop\s*(?:i\s*[dv]?|iv|y\s+de)?\s*#?\s*([1-9]\d*)\b/gu),
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
    || text.match(new RegExp(`${before}\\s*(?:de|son|fueron|quedaron|:)?\\s*${NUMBER}`, 'u'))?.[1];
  return quantity(value);
}

function closeFields(text) {
  const raw = normalize(text);
  const conformingText = raw.replace(/\bno\s+conformes?\b/gu, '');
  let conforming = fieldMatch(conformingText,
    '(?:conformes?|buenas?|buenos|resultantes?|producidas?)',
    '(?:conformes?|buenas?|buenos|resultantes?|producidas?)');
  if (conforming == null) {
    conforming = quantity(raw.match(new RegExp(`${NUMBER}\\s+(?:producto(?:s)?\\s+terminado(?:s)?|unidades?\\s+terminadas?)\\s+conformes?\\b`, 'u'))?.[1]);
  }
  let waste = fieldMatch(raw,
    '(?:mermas?|no\\s+conformes?|rechazos?|desperdicios?)',
    '(?:mermas?|no\\s+conformes?|rechazos?|desperdicios?)');
  if (waste == null) {
    waste = quantity(raw.match(new RegExp(`${NUMBER}\\s+(?:producto(?:s)?\\s+terminado(?:s)?|unidades?\\s+terminadas?)\\s+no\\s+conformes?\\b`, 'u'))?.[1]);
  }
  if (waste == null && /\b(?:sin|ninguna|no hubo)\s+(?:merma|mermas|rechazos?)\b/u.test(raw)) waste = 0;
  const locationCandidate = [...raw.matchAll(/\b(?:ubicacion\s*[:\-]?|quedan?\s+en|dejar\s+en|ubicar\s+en|en)\s*([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b/gu)]
    .map(match => match[1]).find(candidate => /\d/u.test(candidate));
  const location = locationCandidate && /\d/u.test(locationCandidate)
    ? locationCandidate.toUpperCase() : null;
  const rawReason = raw.match(/\b(?:por|motivo|causa|debido a)\s+(.+?)(?=\s+(?:ubicacion|quedan en|dejar en)\b|$)/u)?.[1]
    ?.replace(/[,;\s]+$/u, '').trim() || null;
  const locationTail = location ? ` en ${location.toLowerCase()}` : '';
  const reason = rawReason && locationTail && rawReason.endsWith(locationTail)
    ? rawReason.slice(0, -locationTail.length).trim() : rawReason;
  return { conforming, waste, reason, location };
}

function materialLossCandidate(text) {
  const raw = normalize(text);
  // Solo una pérdida explícita de material: «merma de dos tapas». «Una merma
  // por ruptura» describe producto terminado y no debe abrir una reposición.
  const match = new RegExp(`\\b(?:merma|perdida|desperdicio)\\s+(?:de\\s+)?${NUMBER}\\s+(?:und|unidades?|gramos?|g)?\\s*([a-z][a-z0-9\\s-]*?)(?=\\s+(?:por|debido a|causa|motivo)\\b|[,;.]|$)`, 'u').exec(raw);
  if (!match) return null;
  const product = match[2].trim();
  if (!product || /^(?:producto(?:s)?\s+terminado(?:s)?|unidades?\s+terminadas?|pt)$/u.test(product)) return null;
  const cause = raw.slice(match.index + match[0].length)
    .match(/^\s*(?:por|debido a|causa|motivo)\s+([^.,;]+)/u)?.[1]?.trim() || null;
  return { product, quantity: quantity(match[1]), cause, index: match.index };
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
  return normalize(text).replace(/[,;]+/gu, ' ').trim()
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

function replacementsFinished(text) {
  return /^(?:no hay mas|ninguno mas|eso es todo|sin mas materiales|listo con los materiales)[.!]?$/u.test(normalize(text));
}

const MATERIAL_START = /\b(?:repuse|repusimos|repusieron|repuso|repusiste|repongo|reponi|reponimos|tom[eé]|tomamos|saqu[eé]|sacamos|material(?:es)?\s+repuesto(?:s)?)\b/iu;

function parseMaterialSegments(text, { allowImplicit = false } = {}) {
  if (noReplacements(text)) return [];
  const raw = String(text || '');
  const marker = MATERIAL_START.exec(raw);
  if (!marker && !allowImplicit) return [];
  if (!marker && (!/^\s*(?:\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/iu.test(raw)
    || /\b(?:conformes?|mermas?|no\s+conformes?|ubicaci[oó]n)\b/iu.test(raw))) return [];
  const source = marker ? raw.slice(marker.index + marker[0].length) : raw;
  const segments = source.split(/\s*;\s*|\s*,\s*(?=(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b)|\s+y\s+(?=(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b)/iu);
  return segments.map(segment => {
    const quantityMatch = segment.match(/^\s*(\d+(?:[.,]\d+)?|una|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b\s*(?:und|unidades?|gramos?|g)?\s*(?:de\s+)?/iu);
    const lot = segment.match(/\blote\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9_-]*)/iu)?.[1] || null;
    const cause = segment.match(/\b(?:por|causa|motivo|debido a)\s+(.+)$/iu)?.[1]?.trim() || null;
    const product = segment.slice(quantityMatch?.[0]?.length || 0)
      .split(/\b(?:del?\s+)?lote\b|\b(?:por|causa|motivo|debido a)\b/iu)[0]
      .replace(/^(?:de|del|la|el)\s+/iu, '').trim();
    const productTerm = /^(?:material(?:es)?|insumo(?:s)?)$/iu.test(product) ? null : product;
    return { producto: productTerm || null, cantidad: quantityMatch ? quantity(quantityMatch[1]) : null,
      lote: lot, motivo: cause };
  }).filter(item => item.producto || item.cantidad != null || item.lote || item.motivo);
}

function materialFollowup(text) {
  const raw = String(text || '').trim();
  const lot = raw.match(/\blote\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9_-]*)/iu)?.[1] || null;
  const cause = raw.match(/\b(?:por|causa|motivo|debido a)\s+(.+)$/iu)?.[1]?.trim()
    || (/^(?:ruptura|rotura|derrame|contaminacion|contaminación|defecto|caida|caída|daño|dano|despegue)$/iu.test(raw) ? raw : null);
  return { lote: lot, motivo: cause };
}

async function orderMaterials(db, orderId) {
  const [rows] = await db.execute(
    `SELECT pm.producto_id, pm.unidad, p.siigo_code AS sku, p.nombre
       FROM produccion_materiales pm JOIN productos p ON p.id = pm.producto_id
      WHERE pm.orden_produccion_id = ? ORDER BY pm.id`, [orderId]
  );
  return rows;
}

async function applyMaterialCorrection(db, draft, order, text) {
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
    line.lote = newValue;
  } else if (['causa', 'motivo'].includes(normalize(field))) {
    if (newValue.length > 255 || /^(?:merma|perdida|reposicion|material)$/iu.test(normalize(newValue))) {
      throw guideError('Indica una causa concreta de máximo 255 caracteres.');
    }
    line.motivo = newValue;
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
  const amountMatch = new RegExp(`^${NUMBER}\\s+(?:und|unidades?|gramos?|g)?\\s*(?:de\\s+)?(.+)$`, 'u').exec(term);
  const productTerm = amountMatch?.[2]?.trim() || term;
  try {
    await beginMaterialDamage(db, draft, order, {
      product: productTerm, quantity: amountMatch ? quantity(amountMatch[1]) : null,
      cause: candidate.cause,
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
  if (await applyMaterialCorrection(db, draft, order, text)) return;
  const damage = materialLossCandidate(text);
  if (damage) {
    await beginMaterialDamage(db, draft, order, damage);
    return;
  }
  if (draft.materialPending?.damageReport) {
    const pending = draft.materialPending;
    const answer = normalize(text);
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
      if (/^si[.!]?$/u.test(answer) || /\b(?:si\s+repuse|repuse|las?\s+repuse|los?\s+repuse)\b/u.test(answer)) {
        pending.replacementDecision = true;
      } else {
        return;
      }
    }
    const followup = materialFollowup(text);
    if (followup.lote) pending.lote = followup.lote;
    if (pending.cantidad == null) pending.cantidad = quantity(text);
    if (pending.motivo == null && followup.motivo) pending.motivo = followup.motivo;
    if (pending.sku && pending.cantidad != null && pending.lote && pending.motivo) {
      const { damageReport, replacementDecision, ...line } = pending;
      const existing = draft.materials.findIndex(item => item.sku === line.sku && item.lote === line.lote);
      if (existing >= 0) draft.materials[existing] = line;
      else draft.materials.push(line);
      draft.materialPending = null;
      draft.materialsAnswered = true;
    }
    return;
  }
  if (noReplacements(text)) {
    draft.materials = [];
    draft.materialPending = null;
    draft.materialsAnswered = true;
    return;
  }
  const advance = params.avance_materiales && typeof params.avance_materiales === 'object'
    ? params.avance_materiales : {};
  if (replacementsFinished(text) || advance.finalizar === true) {
    if (draft.materialPending) throw guideError('Termina primero el material pendiente: faltan producto, cantidad, lote o causa.');
    if (!draft.materials.length) throw guideError('Confirma expresamente si no repusiste material durante esta OP.');
    draft.materialsAnswered = true;
    return;
  }
  const readyForMaterials = draft.conforming != null && draft.waste != null
    && (draft.waste === 0 || draft.reason) && (draft.conforming === 0 || draft.location);
  const spoken = parseMaterialSegments(text, { allowImplicit: readyForMaterials && !draft.materialPending });
  if (MATERIAL_START.test(String(text || '')) && !spoken.length && !draft.materialPending) {
    draft.materialPending = { sku: null, producto: null, cantidad: null, lote: null,
      motivo: null, unidad: null, ubicacion: null };
    draft.materialsAnswered = false;
    return;
  }
  const hasNewMaterial = spoken.length > 0;
  const incoming = hasNewMaterial && Array.isArray(advance.items) && advance.items.length
    ? advance.items : hasNewMaterial && Array.isArray(params.materiales_repuestos) && params.materiales_repuestos.length
      ? params.materiales_repuestos : spoken;
  const materials = incoming.length ? await orderMaterials(db, order.id) : [];
  for (const item of incoming) {
    const productTerm = String(item.producto || item.sku || item.id_item || '').trim();
    const number = quantity(item.cantidad);
    const lot = String(item.lote || '').trim() || null;
    const reason = String(item.motivo || item.causa || '').trim() || null;
    const location = String(item.ubicacion || '').trim() || null;
    if (reason && /^(?:merma|perdida|pérdida|reposicion|reposición|material)$/iu.test(reason)) {
      throw guideError('Indica la causa concreta del material repuesto, por ejemplo ruptura, derrame o defecto.');
    }
    if (draft.materialPending && productTerm) {
      throw guideError(`Termina primero ${draft.materialPending.sku || draft.materialPending.producto}: indica su lote y causa antes de añadir otro material.`);
    }
    const product = productTerm ? await resolveProductReference(db, productTerm, {
      productIds: materials.map(row => row.producto_id),
      allowContextualPartial: true, allowScopedApproximate: true,
    }) : null;
    if (productTerm && !materials.some(row => Number(row.producto_id) === Number(product.id))) {
      throw guideError(`El producto ${productTerm} no es un material de OP ID ${order.id}`);
    }
    const pending = draft.materialPending || {};
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
      const existing = draft.materials.findIndex(line => line.sku === next.sku && line.lote === next.lote);
      if (existing >= 0) draft.materials[existing] = next;
      else draft.materials.push(next);
      draft.materialPending = null;
      draft.materialsAnswered = true;
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
    if (followup.motivo) {
      if (/^(?:merma|perdida|pérdida|reposicion|reposición|material)$/iu.test(followup.motivo)) {
        throw guideError('Indica la causa concreta del material repuesto, por ejemplo ruptura, derrame o defecto.');
      }
      draft.materialPending.motivo = followup.motivo;
    }
    if (draft.materialPending.sku && draft.materialPending.cantidad != null
      && draft.materialPending.lote && draft.materialPending.motivo) {
      draft.materials.push(draft.materialPending);
      draft.materialPending = null;
      draft.materialsAnswered = true;
    }
  }
}

function confirmed(text) {
  return /^(?:si|confirmo|confirmar|correcto|todo bien|adelante)(?:[,. ]+(?:el\s+)?cierre(?:\s+de\s+produccion)?)?[.!]?$/u
    .test(normalize(text));
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
      WHERE usuario_id = ? AND estado = 'PENDIENTE' AND expira_en > NOW() LIMIT 1`, [userId]
  );
  return rows.length ? jsonObject(rows[0].payload_json) : null;
}

function isCloseFollowup(text, draft) {
  if (!draft) return false;
  const raw = normalize(text);
  if (confirmed(raw) || rejected(raw)) return true;
  if (/^(?:corrige|cambia|modifica|quita|elimina)\s+/u.test(raw)) return true;
  if (!draft.orderId && contextualOrderCandidate(raw, true)) return true;
  if (/\b(?:conformes?|mermas?|no conformes?|motivo|causa|ubicacion|dejar en|quedan en|por|repuse|repusimos|repuesto|lote|materiales?)\b/u.test(raw)) return true;
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
     VALUES (?, ?, ?, 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 45 MINUTE))
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

function guideSummary(order, draft, locationHint) {
  const lines = ['🏭 *Cierre de producción en preparación*', '',
    `Orden: *OP ID ${order.id}* | ${order.codigo_orden}`,
    `Producto: ${order.producto} (${order.sku})`,
    `Cantidad planeada: ${Number(order.cantidad_planeada)} und`,
    '', '*Datos del cierre*',
    `• Unidades conformes: ${draft.conforming == null ? 'pendiente' : `${draft.conforming} und`}`,
    `• Merma de producto terminado: ${draft.waste == null ? draft.unclassifiedWaste ? 'pendiente de aclarar el tipo de merma' : 'pendiente (indica 0 si no hubo)' : `${draft.waste} und`}`,
    `• Motivo de la merma: ${draft.waste == null ? 'se requiere si hubo merma' : draft.waste === 0 ? 'no aplica' : draft.reason || 'pendiente'}`,
    `• Ubicación del producto conforme: ${draft.conforming == null ? 'se requiere si hubo conformes' : draft.conforming === 0 ? 'no aplica' : draft.location || 'pendiente'}`,
    '', '*Materiales repuestos durante la OP*',
    ...(draft.materials || []).map((item, index) =>
      `• ${index + 1}. ${item.producto} (${item.sku}): ${item.cantidad} ${item.unidad || ''} | Lote ${item.lote} | Causa: ${item.motivo}${item.ubicacion ? ` | Ubicación: ${item.ubicacion}` : ''}`),
    ...((draft.materials || []).length ? [] : ['• Ninguno registrado'])];
  if (draft.unclassifiedWaste) {
    lines.push('', `*Merma por clasificar:* ${draft.unclassifiedWaste.quantity} und${draft.unclassifiedWaste.cause ? ` | Causa mencionada: ${draft.unclassifiedWaste.cause}` : ''}. Todavía no se asignó a producto terminado ni a insumos.`);
  }
  if (draft.materialPending) {
    const item = draft.materialPending;
    lines.push(`• En curso: ${item.producto || 'producto pendiente'}${item.sku ? ` (${item.sku})` : ''} | Cantidad: ${item.cantidad ?? 'pendiente'} | Lote: ${item.lote || 'pendiente'} | Causa: ${item.motivo || 'pendiente'}`);
  }
  const missing = [];
  if (draft.unclassifiedWaste) missing.push('tipo de merma');
  if (draft.conforming == null) missing.push('unidades conformes');
  if (draft.waste == null && !draft.unclassifiedWaste) missing.push('merma de producto terminado');
  if (draft.waste > 0 && !draft.reason) missing.push('motivo de la merma');
  if (draft.conforming > 0 && !draft.location) missing.push('ubicación del producto conforme');
  if (!draft.materialsAnswered || draft.materialPending) missing.push('materiales repuestos (o confirma que no hubo)');
  if (missing.length) lines.push('', `*Falta informar:* ${missing.join(', ')}.`);
  lines.push('');
  if (draft.materialPending?.damageReport && draft.materialPending.replacementDecision == null) {
    if (draft.materialPending.cantidad == null) {
      lines.push(`¿Cuántas ${draft.materialPending.unidad || 'und'} de ${draft.materialPending.producto} se dañaron? Antes se mencionó una merma sin identificar; confirma la cantidad real de este insumo.`);
    } else {
      lines.push(`¿Repusiste ${draft.materialPending.cantidad} ${draft.materialPending.unidad || 'und'} de ${draft.materialPending.producto}? Responde *sí* o *no*. Si las repusiste, indica de qué lote las sacaste.`);
    }
  } else if (draft.materialPending?.damageReport && draft.materialPending.replacementDecision && !draft.materialPending.lote) {
    lines.push(`¿De qué lote sacaste ${draft.materialPending.cantidad} ${draft.materialPending.unidad || 'und'} de ${draft.materialPending.producto} para reponerlas?`);
  } else if (draft.materialPending?.damageReport && draft.materialPending.replacementDecision && !draft.materialPending.motivo) {
    lines.push(`¿Cuál fue la causa concreta del daño de ${draft.materialPending.producto}?`);
  } else if (draft.unclassifiedWaste) {
    lines.push(`Cuando dijiste *${draft.unclassifiedWaste.quantity} merma*, ¿se trató de *producto terminado* o de un *insumo*? Si fue un insumo, dime su nombre y cantidad real (por ejemplo, «2 tapas»).`);
  } else if (draft.conforming == null) {
    if (draft.conformingClarification != null) {
      lines.push(`Escuché ${draft.conformingClarification} unidades con un nombre de material. ¿Son *${draft.conformingClarification} productos terminados conformes*? Responde «${draft.conformingClarification} conformes» o corrige la cantidad.`);
    } else {
      lines.push('¿Cuántas unidades conformes salieron? Puedes dar todos los datos juntos o por partes.');
      lines.push('Ejemplo: «1 producto terminado conforme, 1 producto terminado no conforme por ruptura, ubicación C2». Ajusta los datos a lo ocurrido.');
    }
  }
  else if (draft.waste == null) lines.push('¿Cuántas unidades de producto terminado fueron no conformes? Di «0 merma de producto terminado» si no hubo.');
  else if (draft.conforming === 0 && draft.waste === 0) lines.push('Ambas cantidades son cero. Corrige conformes o merma para poder cerrar.');
  else if (draft.waste > 0 && !draft.reason) lines.push('¿Cuál fue la causa de la merma de producto terminado?');
  else if (draft.conforming > 0 && !draft.location) {
    lines.push(`¿En qué ubicación quedará el producto terminado?${locationHint ? ` Sugerida: *${locationHint}*; verifica físicamente.` : ''}`);
  } else if (draft.materialPending) {
    const item = draft.materialPending;
    if (!item.sku) lines.push('¿Qué producto o alias repusiste? Debe ser un material de esta OP.');
    else if (item.cantidad == null) lines.push(`¿Cuánto ${item.producto} repusiste? Indica la unidad correspondiente.`);
    else if (!item.lote) lines.push(`¿De qué lote sacaste ${item.cantidad} ${item.producto}?`);
    else if (!item.motivo) lines.push(`¿Cuál fue la causa concreta de reponer ${item.producto} del lote ${item.lote}?`);
  } else if (!draft.materialsAnswered) {
    lines.push('¿Repusiste algún material de esta OP? Puedes decir uno o varios productos con cantidad, lote y causa; también por partes. Si no repusiste ninguno, di *no repuse material*.');
  } else {
    const difference = Number(order.cantidad_planeada) - draft.conforming - draft.waste;
    if (difference !== 0) lines.push(`Diferencia frente al plan: ${difference} und. Verifica este dato.`);
    lines.push('Revisa el resumen completo. Puedes agregar o corregir materiales; si está correcto, responde *confirmo cierre*.');
  }
  lines.push('', 'Este borrador no cierra la OP ni modifica inventario.');
  return lines.join('\n');
}

async function advanceCloseGuide({ db, userId, from, rawText, params = {} }) {
  const prior = await pendingCloseDraft(db, userId);
  const spokenOrderId = closeOrderReference(rawText, params);
  if (spokenOrderId && prior?.orderId && spokenOrderId !== prior.orderId) {
    throw guideError(`Tienes un cierre pendiente para OP ID ${prior.orderId}. Termínalo o cancélalo antes de cambiar de OP.`);
  }
  const draft = prior || { orderId: null, conforming: null, waste: null,
    reason: null, location: null, materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false, candidateOrderId: null };
  if (spokenOrderId) {
    draft.orderId = spokenOrderId;
    draft.candidateOrderId = null;
  }
  if (!draft.orderId && confirmed(rawText) && draft.candidateOrderId) {
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
  // Los borradores previos no guardaban el tipo de merma. Se reclasifican sin
  // inventario para que una cifra ambigua nunca termine como PT por defecto.
  if (draft.waste > 0 && draft.wasteClassified !== true) {
    draft.unclassifiedWaste ||= { quantity: draft.waste, cause: draft.reason || null };
    draft.waste = null;
    draft.reason = null;
  }
  const materialMarker = MATERIAL_START.exec(String(rawText || ''));
  const damageMarker = materialLossCandidate(rawText);
  const closeText = materialMarker ? String(rawText).slice(0, materialMarker.index)
    : damageMarker ? String(rawText).slice(0, damageMarker.index) : rawText;
  const parsed = closeFields(closeText);
  const hadPendingMaterial = Boolean(draft.materialPending);
  if ((!confirmed(rawText) && !rejected(rawText)) || draft.materialPending?.damageReport) {
    await applyMaterialReport(db, draft, order, rawText, params);
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
  if (parsed.reason && draft.waste > 0) draft.reason = parsed.reason;
  if (parsed.location && !hadPendingMaterial) draft.location = parsed.location;
  const singleQuantity = quantity(rawText);
  if (singleQuantity != null && parsed.conforming == null && parsed.waste == null
    && !hadPendingMaterial && !draft.unclassifiedWaste) {
    if (draft.conforming == null) draft.conforming = singleQuantity;
    else if (draft.waste == null) {
      draft.unclassifiedWaste = { quantity: singleQuantity, cause: null };
    }
  }
  if (draft.waste > 0 && !draft.reason && parsed.reason == null && !hadPendingMaterial
    && !damageMarker
    && !spokenOrderId && !parsed.location && parsed.conforming == null && parsed.waste == null
    && !confirmed(rawText) && !rejected(rawText)) {
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
  const complete = draft.conforming != null && draft.waste != null
    && draft.conforming + draft.waste > 0 && (draft.waste === 0 || !!draft.reason)
    && (draft.conforming === 0 || !!draft.location)
    && draft.materialsAnswered && !draft.materialPending && !draft.unclassifiedWaste;
  if (confirmed(rawText) && complete && draft.reviewShown) {
    return { params: { id_orden: draft.orderId, cantidad_real: draft.conforming,
      merma: draft.waste, motivo_merma: draft.reason, ubicacion: draft.location,
      materiales_repuestos: draft.materials.map(item => ({ sku: item.sku,
        cantidad: item.cantidad, lote: item.lote, motivo: item.motivo,
        ubicacion: item.ubicacion || undefined })) }, draft };
  }
  if (rejected(rawText)) draft.reviewShown = false;
  else draft.reviewShown = complete;
  await saveDraft(db, userId, draft);
  const locationHint = draft.conforming > 0 && draft.waste != null
    && (draft.waste === 0 || draft.reason) && !draft.location
    ? await suggestedLocation(db, order.producto_id) : null;
  return { message: guideSummary(order, draft, locationHint), draft };
}

module.exports = { advanceCloseGuide, closeFields, closeOrderReference, confirmed,
  finishDraft, guideSummary, isCloseFollowup, pendingCloseDraft };
