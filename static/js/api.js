// Aufrufe an den eigenen Server. Fehler werden als lesbarer Text mit Code geworfen.
async function call(url, opts) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    const e = new Error('Der Server ist nicht erreichbar. Läuft „python app.py“ noch?');
    e.code = 'offline';
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) {
    const e = new Error(data?.message || `Fehler ${res.status}`);
    e.code = data?.error || 'error';
    e.status = res.status;
    throw e;
  }
  return data;
}

const post = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const getStatus = () => call('/api/status');
export const getCatalog = () => call('/api/catalog');
export const analyze = (payload) => post('/api/analyze', payload);
export const createRenders = (payload) => post('/api/renders', payload);
export const getRender = (id) => call(`/api/renders/${encodeURIComponent(id)}`);
export const chat = (payload) => post('/api/chat', payload);
