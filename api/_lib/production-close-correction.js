// Las sugerencias del clasificador son un respaldo del parser, nunca una fuente
// autónoma de cantidades o ubicaciones para un cierre de producción.
const WORD_NUMBERS = Object.freeze({ cero: 0, ninguna: 0, ninguno: 0,
  una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 });

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

function groundedCloseCorrection(text, params) {
  if (process.env.PRODUCTION_CLOSE_LLM_CORRECTION_ENABLED === 'false') return {};
  const hints = params?.correccion_pt;
  if (!Array.isArray(hints) || !hints.length || hints.length > 4) return {};
  const utterance = normalize(text);
  const result = {};
  const conflicts = new Set();
  for (const hint of hints) {
    if (!hint || typeof hint !== 'object' || Array.isArray(hint)) continue;
    const field = hint.campo;
    if (!['conformes', 'ubicacion'].includes(field)) continue;
    const evidence = normalize(hint.evidencia);
    if (evidence.length < 8 || !utterance.includes(evidence)) continue;
    const evidenceAt = utterance.indexOf(evidence);
    if (/\b(?:no|ni|nunca|tampoco)\s*$/u.test(utterance.slice(Math.max(0, evidenceAt - 16), evidenceAt))) continue;
    // Debe referirse al PT conforme, no a merma o una partida de insumos.
    if (/\bno\s+conformes?\b|\b(?:insumos?|materiales?|repuest[oa]s?|partidas?)\b/u.test(evidence)
      || !/\b(?:conformes?|buen[oa]s?|apt[oa]s?|aprobadas?|terminad[oa]s?|producto\s+final|salieron\s+bien|pt)\b/u.test(evidence)) continue;
    let value = null;
    if (field === 'conformes') {
      const proposed = Number(hint.valor);
      if (!Number.isSafeInteger(proposed) || proposed < 0) continue;
      const found = [...evidence.matchAll(/\b(?:\d+|cero|ninguna|ninguno|una|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/gu)]
        .map(match => Object.hasOwn(WORD_NUMBERS, match[0]) ? WORD_NUMBERS[match[0]] : Number(match[0]));
      if (found.length !== 1 || found[0] !== proposed) continue;
      const allNumbers = [...utterance.matchAll(/\b(?:\d+|cero|ninguna|ninguno|una|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/gu)];
      if (allNumbers.length !== 1) continue;
      value = proposed;
    } else {
      const proposed = String(hint.valor || '').trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9-]*\d[A-Z0-9-]*$/u.test(proposed)) continue;
      const found = [...evidence.matchAll(/\b[a-z][a-z0-9-]*\d[a-z0-9-]*\b/gu)]
        .map(match => match[0].toUpperCase());
      if (found.length !== 1 || found[0] !== proposed) continue;
      const allLocations = [...utterance.matchAll(/\b[a-z][a-z0-9-]*\d[a-z0-9-]*\b/gu)];
      if (allLocations.length !== 1) continue;
      value = proposed;
    }
    if (Object.hasOwn(result, field) && result[field] !== value) conflicts.add(field);
    else result[field] = value;
  }
  for (const field of conflicts) delete result[field];
  return result;
}

module.exports = { groundedCloseCorrection };
