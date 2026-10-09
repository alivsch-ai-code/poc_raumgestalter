// Zentraler Zustand mit Ereignissen, Undo/Redo und automatischer Sicherung.
import { deepClone } from './dom.js';
import { normalizeRoom, insertVertexInPlace, wallInfo, polyBBox, setWallLength } from './room.js';
import { defaultDesign, reconcileDesign, allSurfaceIds } from './design.js';

const listeners = {};
export const on = (evt, fn) => { (listeners[evt] ||= new Set()).add(fn); return () => listeners[evt].delete(fn); };
export const emit = (evt, payload) => { listeners[evt]?.forEach((fn) => fn(payload)); };

export const S = {
  catalog: null,
  status: { llm: false },
  room: null,
  design: null,
  underlay: null, // { src, x, y, w, h } in cm
  meta: null, // Ergebnis der KI-Erkennung
  step: 1,
  viewMode: '3d', // '2d' | '3d'
  surface: 'floor', // gewählte Fläche
  item: null, // { type: 'opening'|'fixture', id }
  fileName: null,
  projectId: null,
  projectName: null,
};

const STORAGE = 'raumgestalter.poc.v1';
let history = [], hIdx = -1;

const snapshot = () => JSON.stringify({ room: S.room, design: S.design });

export function commit() {
  if (!S.room) return;
  const snap = snapshot();
  if (history[hIdx] === snap) return;
  history = history.slice(0, hIdx + 1);
  history.push(snap);
  if (history.length > 80) history.shift();
  hIdx = history.length - 1;
  persist();
  emit('history', { canUndo: hIdx > 0, canRedo: false });
}

export function undo() {
  if (hIdx <= 0) return false;
  hIdx--;
  restore(history[hIdx]);
  return true;
}
export function redo() {
  if (hIdx >= history.length - 1) return false;
  hIdx++;
  restore(history[hIdx]);
  return true;
}
function restore(snap) {
  const d = JSON.parse(snap);
  S.room = d.room; S.design = d.design;
  if (S.item && !findItem(S.item)) S.item = null;
  emit('room', { live: false, restored: true });
  emit('design', { surfaces: 'all' });
  emit('history', { canUndo: hIdx > 0, canRedo: hIdx < history.length - 1 });
  persist();
}

function findItem(it) {
  if (!it || !S.room) return null;
  const list = it.type === 'opening' ? S.room.openings : S.room.fixtures;
  return list.find((x) => x.id === it.id) || null;
}
export const selectedItem = () => findItem(S.item);

let persistTimer;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify({ room: S.room, design: S.design, step: S.step, projectId: S.projectId, projectName: S.projectName })); } catch { /* voll oder gesperrt */ }
  }, 300);
}

export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d?.room?.polygon?.length) return null;
    return d;
  } catch { return null; }
}
export function clearSaved() { try { localStorage.removeItem(STORAGE); } catch { /* egal */ } }

// ----------------------------------------------------------------- Setzen
export function setStatus(st) { S.status = st; emit('status', st); }
export function setCatalog(cat) { S.catalog = cat; emit('catalog', cat); }
export function setProjectIdentity(id, name) {
  S.projectId = id;
  S.projectName = name;
  persist();
}

export function setStep(step) {
  if (step === S.step) return;
  S.step = step;
  if (step >= 3) S.viewMode = '3d';
  if (step === 2) S.viewMode = '2d';
  emit('step', step);
  persist();
}
export function setViewMode(m) { S.viewMode = m; emit('viewMode', m); }

export function selectSurface(id) { S.surface = id; emit('surface', id); }
export function selectItem(it) { S.item = it; emit('item', it); }

/** Neuen Raum laden (Vorlage, KI-Ergebnis, gespeichertes Projekt). */
export function loadRoom(room, { underlay = null, meta = null, design = null, projectId = null, projectName = null, step = 2 } = {}) {
  const { room: r, shift } = normalizeRoom(room);
  S.room = r;
  S.underlay = underlay ? { ...underlay, x: underlay.x + shift.dx, y: underlay.y + shift.dy } : null;
  S.meta = meta;
  S.design = design ? reconcileDesign(deepClone(design), r) : defaultDesign(r, S.catalog);
  S.projectId = projectId;
  S.projectName = projectName;
  S.surface = 'floor';
  S.item = null;
  history = []; hIdx = -1;
  commit();
  emit('room', { live: false, fresh: true });
  emit('design', { surfaces: 'all' });
  emit('surface', S.surface);
  emit('item', null);
  emit('meta', meta);
  emit('underlay', S.underlay);
  if (step) { S.step = 0; setStep(step); }
}

/**
 * Raum ändern. `live: true` für Ziehen mit der Maus (keine Bereinigung, kein Verlauf).
 * `fn` bekommt eine Kopie des Raums und darf sie verändern oder einen neuen Raum liefern.
 */
export function updateRoom(fn, { live = false, silent = false } = {}) {
  let next = deepClone(S.room);
  const res = fn(next);
  if (res) next = res;
  if (live) {
    S.room = next;
    if (!silent) emit('room', { live: true });
    return;
  }
  const { room: r, shift } = normalizeRoom(next);
  if (S.underlay) { S.underlay.x += shift.dx; S.underlay.y += shift.dy; }
  const oldN = S.room.polygon.length;
  S.room = r;
  if (r.polygon.length !== oldN) reconcileDesign(S.design, r);
  reconcileDesign(S.design, r);
  S.design.walls.forEach((w) => { if (w.height > r.height) w.height = r.height; });
  if (S.item && !findItem(S.item)) S.item = null;
  commit();
  if (!silent) emit('room', { live: false });
  emit('design', { surfaces: 'all' });
}

export function insertVertex(wallIdx, p) {
  updateRoom((r) => {
    insertVertexInPlace(r, wallIdx, p);
    S.design.walls.splice(wallIdx + 1, 0, deepClone(S.design.walls[wallIdx]));
  }, { live: true });
}

export function removeVertex(k) {
  if (S.room.polygon.length <= 3) return false;
  updateRoom((r) => {
    // Normalisierung entfernt die Ecke nicht, deshalb direkt hier
    const n = r.polygon.length;
    const prev = (k - 1 + n) % n;
    const W = wallInfo(r);
    const merged = prev > k ? prev - 1 : prev;
    for (const o of r.openings) {
      if (o.wall === k) { o.wall = merged; o.offset += W[prev].len; }
      else if (o.wall > k) o.wall -= 1;
    }
    r.polygon.splice(k, 1);
    S.design.walls.splice(k, 1);
  });
  return true;
}

export function changeWallLength(i, len) {
  updateRoom((r) => setWallLength(r, i, len));
}

export function updateDesign(fn, { surfaces = 'all', commitNow = true } = {}) {
  const res = fn(S.design);
  if (res) S.design = res;
  if (commitNow) commit();
  emit('design', { surfaces });
}

export function surfaceIds() { return S.room ? allSurfaceIds(S.room) : []; }

export function boundsOfRoom() { return polyBBox(S.room.polygon); }

export function exportProject() {
  return JSON.stringify({ app: 'raumgestalter-poc', version: 1, room: S.room, design: S.design }, null, 1);
}

export function importProject(text) {
  const d = JSON.parse(text);
  if (d?.app !== 'raumgestalter-poc' || !d.room?.polygon) throw new Error('Das ist keine Raumgestalter-Datei.');
  loadRoom(d.room, { design: d.design, step: 3 });
}
