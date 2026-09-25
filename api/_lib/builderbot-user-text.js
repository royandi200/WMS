const DOCUMENT_MARKER = /^_event_document__[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const AUDIO_URL = /\.(?:oga|ogg|opus|mp3|m4a|wav|aac)(?:[?#]|$)/iu;

function currentUserText(rawBody = {}, info = {}, { allowParams = true } = {}) {
  const keys = allowParams ? ['body', 'text', 'query', 'texto', 'content', 'message']
    : ['body', 'text', 'query'];
  let documentMarker = '';
  for (const source of [info, ...(allowParams ? [info?.params] : []), rawBody]) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value !== 'string' || !value.trim()) continue;
      if (DOCUMENT_MARKER.test(value.trim())) documentMarker ||= value;
      else return value;
    }
  }
  // In the voice flow BuilderBot may leave a PDF trigger in body/text/query.
  // voice_text is only trusted when the current attachment is actually audio;
  // otherwise it can be a stale transcription from a previous message.
  if (AUDIO_URL.test(String(rawBody.document_url || ''))
    && typeof rawBody.voice_text === 'string' && rawBody.voice_text.trim()) {
    return rawBody.voice_text;
  }
  // A real PDF upload still needs its transport marker for native-document
  // recovery when the model did not classify it.
  return AUDIO_URL.test(String(rawBody.document_url || '')) ? '' : documentMarker;
}

module.exports = { currentUserText };
