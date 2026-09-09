function formatWhatsAppMessage(value) {
  const source = String(value || '').replace(/\r\n?/g, '\n').trim();
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

module.exports = { formatWhatsAppMessage };
