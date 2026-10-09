// Kleine Helfer für DOM und Formatierung. Kein Framework nötig.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}

function appendKids(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendKids(el, kids);
  return el;
}

export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  appendKids(el, kids);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (v, d = 1) => { const f = 10 ** d; return Math.round(v * f) / f; };
export const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 8);
export const deepClone = (o) => JSON.parse(JSON.stringify(o));

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const fmt0 = (v) => nf0.format(v);
export const fmt1 = (v) => nf1.format(v);
export const fmt2 = (v) => nf2.format(v);
export const fmtEur = (v) => eur.format(v);
export const fmtCm = (v) => `${nf1.format(v)} cm`;
export const fmtM2 = (v) => `${nf2.format(v)} m²`;

/** Zahl aus deutscher Eingabe lesen ("2,70" -> 2.7). */
export function parseNum(str) {
  if (typeof str === 'number') return str;
  const t = String(str ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

export function debounce(fn, ms = 120) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
}

export function rafThrottle(fn) {
  let queued = false, lastArgs;
  return (...a) => {
    lastArgs = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...lastArgs); });
  };
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function toast(msg, kind = 'info', ms = 3600) {
  let host = $('#toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg);
  host.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 260); }, ms);
}

export function download(filename, blobOrUrl) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  document.body.append(a);
  a.click();
  a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden.'));
    r.readAsDataURL(file);
  });
}

/** Bild verkleinern (lange Seite max. maxSide) und als JPEG-DataURL liefern. */
export function downscaleImage(dataUrl, maxSide = 1600, quality = 0.9) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      res({ dataUrl: c.toDataURL('image/jpeg', quality), width: c.width, height: c.height });
    };
    img.onerror = () => rej(new Error('Das Bild konnte nicht geöffnet werden.'));
    img.src = dataUrl;
  });
}
