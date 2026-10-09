// Raum-Modell: Geometrie, Bereinigung, Wandnamen, Vorlagen.
// Einheit überall Zentimeter. 2D-Koordinaten: x nach rechts, y nach unten.
// Der Umriss läuft im Uhrzeigersinn; der Innenraum liegt rechts der Laufrichtung.
import { deepClone, uid, clamp } from './dom.js';

export const FIXTURES = {
  badewanne: { label: 'Badewanne', w: 170, d: 75, h: 58 },
  dusche: { label: 'Dusche', w: 90, d: 90, h: 200 },
  wc: { label: 'WC', w: 38, d: 68, h: 80 },
  waschtisch: { label: 'Waschtisch', w: 60, d: 48, h: 85 },
  waschmaschine: { label: 'Waschmaschine', w: 60, d: 60, h: 85 },
  heizkoerper: { label: 'Handtuchheizkörper', w: 50, d: 8, h: 120 },
  schrank: { label: 'Hochschrank', w: 50, d: 35, h: 180 },
};

export const DOOR_H = 205;
export const WALL_THICK = 11;

// ---------------------------------------------------------------- Vektoren
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const rad = (deg) => (deg * Math.PI) / 180;

export function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
export const polyArea = (poly) => Math.abs(signedArea(poly));

export function polyBBox(poly) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of poly) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 };
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

export function isSimplePolygon(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** Versetzt ein Polygon um d nach außen (d>0) bzw. innen (d<0) mit Gehrung. */
export function offsetPolygon(poly, d) {
  const n = poly.length;
  const out = [];
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const L = dist(a, b) || 1;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const nx = -uy, ny = ux; // nach innen
    return { p: { x: a.x - nx * d, y: a.y - ny * d }, u: { x: ux, y: uy } };
  });
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
    const cross = l1.u.x * l2.u.y - l1.u.y * l2.u.x;
    if (Math.abs(cross) < 1e-6) { out.push({ ...l2.p }); continue; }
    const t = ((l2.p.x - l1.p.x) * l2.u.y - (l2.p.y - l1.p.y) * l2.u.x) / cross;
    out.push({ x: l1.p.x + l1.u.x * t, y: l1.p.y + l1.u.y * t });
  }
  return out;
}

// ---------------------------------------------------------------- Wände
export function wallInfo(room) {
  const P = room.polygon, n = P.length;
  return P.map((a, i) => {
    const b = P[(i + 1) % n];
    const len = dist(a, b) || 0.0001;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    return { i, a, b, len, ux, uy, nx: -uy, ny: ux };
  });
}

export function wallLabels(room) {
  const W = wallInfo(room);
  const base = W.map((w) => {
    const ax = Math.abs(w.nx), ay = Math.abs(w.ny);
    if (ay >= ax * 1.8) return w.ny > 0 ? 'oben' : 'unten';
    if (ax >= ay * 1.8) return w.nx > 0 ? 'links' : 'rechts';
    return 'schräg';
  });
  const groups = {};
  base.forEach((b, i) => (groups[b] ||= []).push(i));
  const out = new Array(W.length);
  for (const [name, idx] of Object.entries(groups)) {
    if (idx.length === 1) { out[idx[0]] = `Wand ${name}`; continue; }
    const horizontal = name === 'oben' || name === 'unten';
    const key = (i) => (horizontal ? (W[i].a.x + W[i].b.x) / 2 : (W[i].a.y + W[i].b.y) / 2);
    const sorted = [...idx].sort((p, q) => key(p) - key(q));
    sorted.forEach((i, k) => {
      let suffix;
      if (sorted.length === 2) suffix = horizontal ? (k === 0 ? 'links' : 'rechts') : (k === 0 ? 'oben' : 'unten');
      else suffix = String(k + 1);
      out[i] = `Wand ${name} ${suffix}`;
    });
  }
  return out;
}

export function roomHeightDefault(room) { return room.height || 250; }

// ---------------------------------------------------------------- Öffnungen
export function openingGeom(room, o) {
  const W = wallInfo(room)[o.wall];
  if (!W) return null;
  const s0 = o.offset, s1 = o.offset + o.width;
  const P0 = { x: W.a.x + W.ux * s0, y: W.a.y + W.uy * s0 };
  const P1 = { x: W.a.x + W.ux * s1, y: W.a.y + W.uy * s1 };
  return { W, P0, P1, C: { x: (P0.x + P1.x) / 2, y: (P0.y + P1.y) / 2 } };
}

/** Geometrie eines Türflügels (für Grundriss und Kollisionsprüfung). */
export function doorSwing(room, o, steps = 14) {
  const g = openingGeom(room, o);
  if (!g) return null;
  const { W, P0, P1 } = g;
  const hingeRight = o.hinge === 'rechts'; // Seite aus Sicht von innen: rechts = Ende der Wand (u-Richtung)
  const H = hingeRight ? P1 : P0;
  const F = hingeRight ? P0 : P1;
  const dir = o.swing === 'aussen' ? -1 : 1;
  const c = { x: (F.x - H.x) / o.width, y: (F.y - H.y) / o.width };
  const open = { x: W.nx * dir, y: W.ny * dir };
  const arc = [];
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * (Math.PI / 2);
    arc.push({ x: H.x + o.width * (c.x * Math.cos(t) + open.x * Math.sin(t)), y: H.y + o.width * (c.y * Math.cos(t) + open.y * Math.sin(t)) });
  }
  return { H, F, open, arc, leafEnd: arc[arc.length - 1], inward: dir > 0 };
}

// ---------------------------------------------------------------- Ausstattung
export function fixtureCorners(f) {
  const r = rad(f.rot || 0), c = Math.cos(r), s = Math.sin(r);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * f.w) / 2, y = (sy * f.d) / 2;
    return { x: f.x + x * c - y * s, y: f.y + x * s + y * c };
  });
}

export function pointInFixture(p, f, pad = 0) {
  const r = rad(-(f.rot || 0)), c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - f.x, dy = p.y - f.y;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= f.w / 2 + pad && Math.abs(ly) <= f.d / 2 + pad;
}

function obbOverlap(a, b, shrink = 1) {
  const A = fixtureCorners({ ...a, w: a.w - shrink * 2, d: a.d - shrink * 2 });
  const B = fixtureCorners({ ...b, w: b.w - shrink * 2, d: b.d - shrink * 2 });
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4];
      const ax = -(q.y - p.y), ay = q.x - p.x;
      const proj = (pts) => { let mn = Infinity, mx = -Infinity; for (const t of pts) { const v = t.x * ax + t.y * ay; mn = Math.min(mn, v); mx = Math.max(mx, v); } return [mn, mx]; };
      const [a0, a1] = proj(A), [b0, b1] = proj(B);
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

/** Rastet eine Ausstattung an der nächsten Wand (und Ecke) ein. */
export function snapFixture(room, f, threshold = 16) {
  const W = wallInfo(room);
  const ex = (rot) => ({ x: Math.cos(rad(rot)), y: Math.sin(rad(rot)) });
  const support = (w, rot) => {
    const e1 = ex(rot), e2 = { x: -e1.y, y: e1.x };
    return (f.w / 2) * Math.abs(w.nx * e1.x + w.ny * e1.y) + (f.d / 2) * Math.abs(w.nx * e2.x + w.ny * e2.y);
  };
  let best = null;
  for (const w of W) {
    const t = (f.x - w.a.x) * w.ux + (f.y - w.a.y) * w.uy;
    if (t < -f.w || t > w.len + f.w) continue;
    const dn = (f.x - w.a.x) * w.nx + (f.y - w.a.y) * w.ny;
    const gap = dn - support(w, f.rot || 0);
    if (gap < threshold && gap > -40 && (!best || gap < best.gap)) best = { w, gap, t };
  }
  if (!best) return f;
  const w = best.w;
  const rot = ((Math.round((Math.atan2(-w.nx, w.ny) * 180) / Math.PI) % 360) + 360) % 360;
  const t = clamp(best.t, f.w / 2 + 1, Math.max(f.w / 2 + 1, w.len - f.w / 2 - 1));
  const out = { ...f, rot };
  out.x = w.a.x + w.ux * t + w.nx * (f.d / 2);
  out.y = w.a.y + w.uy * t + w.ny * (f.d / 2);
  // Ecke: an eine rechtwinklige Nachbarwand schieben
  for (const w2 of W) {
    if (w2 === w || Math.abs(w2.ux * w.ux + w2.uy * w.uy) > 0.2) continue;
    const t2 = (out.x - w2.a.x) * w2.ux + (out.y - w2.a.y) * w2.uy;
    if (t2 < -f.w || t2 > w2.len + f.w) continue;
    const dn2 = (out.x - w2.a.x) * w2.nx + (out.y - w2.a.y) * w2.ny;
    const g2 = dn2 - support(w2, rot);
    if (g2 < 14 && g2 > -2) { out.x -= w2.nx * g2; out.y -= w2.ny * g2; }
  }
  out.x = Math.round(out.x * 10) / 10;
  out.y = Math.round(out.y * 10) / 10;
  return out;
}

export function newFixture(type, room) {
  const spec = FIXTURES[type];
  const bb = polyBBox(room.polygon);
  let f = { id: uid('f'), type, x: bb.cx, y: bb.cy, w: spec.w, d: spec.d, rot: 0 };
  if (type === 'dusche') f.opt = { glass: 'right' };
  // an die erste freie Wand legen
  const W = wallInfo(room).sort((a, b) => b.len - a.len);
  for (const w of W) {
    const cand = snapFixture(room, { ...f, x: (w.a.x + w.b.x) / 2 + w.nx * 20, y: (w.a.y + w.b.y) / 2 + w.ny * 20 }, 40);
    const clash = room.fixtures.some((o) => obbOverlap(cand, o, 2));
    if (!clash && pointInPoly({ x: cand.x, y: cand.y }, room.polygon)) { f = cand; break; }
  }
  return f;
}

// ---------------------------------------------------------------- Hinweise
export function roomWarnings(room) {
  const out = [];
  if (!isSimplePolygon(room.polygon)) out.push({ level: 'error', text: 'Die Wände überkreuzen sich. Verschiebe eine Ecke, bis der Umriss wieder geschlossen und überschneidungsfrei ist.' });
  const area = polyArea(room.polygon) / 10000;
  if (area < 1) out.push({ level: 'warn', text: 'Der Raum ist kleiner als 1 m². Stimmen die Maße (in Zentimetern)?' });
  if (area > 80) out.push({ level: 'warn', text: 'Der Raum ist größer als 80 m². Stimmen die Maße (in Zentimetern)?' });
  const names = (f) => FIXTURES[f.type]?.label || f.type;
  room.fixtures.forEach((f) => {
    if (!pointInPoly({ x: f.x, y: f.y }, room.polygon)) out.push({ level: 'warn', text: `${names(f)} liegt außerhalb des Raums.` });
  });
  for (let i = 0; i < room.fixtures.length; i++) {
    for (let j = i + 1; j < room.fixtures.length; j++) {
      if (obbOverlap(room.fixtures[i], room.fixtures[j], 2)) out.push({ level: 'warn', text: `${names(room.fixtures[i])} und ${names(room.fixtures[j])} überschneiden sich.` });
    }
  }
  room.openings.filter((o) => o.type === 'door' && o.swing !== 'aussen').forEach((o) => {
    const sw = doorSwing(room, o);
    if (!sw) return;
    const hit = room.fixtures.find((f) => sw.arc.some((p) => pointInFixture(p, f, -2)));
    if (hit) out.push({ level: 'warn', text: `Die Tür schlägt gegen ${names(hit)}. Stelle „nach außen“ ein oder verschiebe die Tür.` });
  });
  return out;
}

// ---------------------------------------------------------------- Bereinigen
function removeVertexInPlace(room, k) {
  const n = room.polygon.length;
  const prev = (k - 1 + n) % n;
  const lenPrev = dist(room.polygon[prev], room.polygon[k]);
  const merged = prev > k ? prev - 1 : prev;
  for (const o of room.openings) {
    if (o.wall === k) { o.wall = merged; o.offset += lenPrev; }
    else if (o.wall > k) o.wall -= 1;
  }
  room.polygon.splice(k, 1);
}

export function insertVertexInPlace(room, wallIdx, p) {
  const P = room.polygon;
  const d1 = dist(P[wallIdx], p);
  P.splice(wallIdx + 1, 0, { x: p.x, y: p.y });
  for (const o of room.openings) {
    if (o.wall > wallIdx) o.wall += 1;
    else if (o.wall === wallIdx) {
      if (o.offset + o.width / 2 >= d1) { o.wall = wallIdx + 1; o.offset = Math.max(0, o.offset - d1); }
    }
  }
}

function reverseInPlace(room) {
  const n = room.polygon.length;
  room.polygon.reverse();
  // Wandlängen der neuen Reihenfolge
  const lens = [];
  for (let i = 0; i < n; i++) lens.push(dist(room.polygon[i], room.polygon[(i + 1) % n]));
  for (const o of room.openings) {
    const j = o.wall; // alter Index
    const k = (n - 2 - j + n) % n;
    o.wall = k;
    o.offset = lens[k] - o.offset - o.width;
    o.hinge = o.hinge === 'links' ? 'rechts' : 'links';
  }
}

function snapAxes(poly, tolDeg = 7) {
  const n = poly.length;
  const px = [...Array(n).keys()], py = [...Array(n).keys()];
  const find = (p, i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  const uni = (p, a, b) => { p[find(p, a)] = find(p, b); };
  const tol = Math.tan(rad(tolDeg));
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (dy < dx * tol) uni(py, i, (i + 1) % n);
    else if (dx < dy * tol) uni(px, i, (i + 1) % n);
  }
  const avg = (parent, key) => {
    const sums = {};
    poly.forEach((p, i) => { const r = find(parent, i); (sums[r] ||= { s: 0, c: 0 }); sums[r].s += p[key]; sums[r].c++; });
    poly.forEach((p, i) => { const r = find(parent, i); p[key] = sums[r].s / sums[r].c; });
  };
  avg(px, 'x');
  avg(py, 'y');
}

/**
 * Bereinigt einen Raum: rastet Wände rechtwinklig ein, entfernt doppelte und
 * überflüssige Ecken, dreht den Umriss im Uhrzeigersinn, schiebt ihn in den
 * Ursprung und hält Öffnungen und Ausstattung in gültigen Grenzen.
 * Gibt {room, shift, removed} zurück; `removed` sind entfernte Eck-Indizes.
 */
export function normalizeRoom(input, { snap = true } = {}) {
  const room = deepClone(input);
  room.polygon = room.polygon.map((p) => ({ x: +p.x, y: +p.y }));
  room.openings = (room.openings || []).map((o) => ({ ...o }));
  room.fixtures = (room.fixtures || []).map((f) => ({ ...f }));
  room.height = clamp(+room.height || 250, 200, 400);
  const removed = [];

  const dropDuplicates = () => {
    for (let k = room.polygon.length - 1; k >= 0 && room.polygon.length > 3; k--) {
      const n = room.polygon.length;
      if (dist(room.polygon[k], room.polygon[(k + 1) % n]) < 2) { removeVertexInPlace(room, k); removed.push(k); }
    }
  };
  dropDuplicates();
  if (snap) { snapAxes(room.polygon); dropDuplicates(); }
  // überflüssige (kollineare) Ecken
  for (let k = room.polygon.length - 1; k >= 0 && room.polygon.length > 3; k--) {
    const n = room.polygon.length;
    const a = room.polygon[(k - 1 + n) % n], b = room.polygon[k], c = room.polygon[(k + 1) % n];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const d = dist(a, b) * dist(b, c) || 1;
    if (Math.abs(cr) / d < 0.02 && dot(sub(b, a), sub(c, b)) > 0) { removeVertexInPlace(room, k); removed.push(k); }
  }
  if (signedArea(room.polygon) < 0) reverseInPlace(room);

  const bb = polyBBox(room.polygon);
  const shift = { dx: -bb.minx, dy: -bb.miny };
  room.polygon.forEach((p) => { p.x = Math.round((p.x + shift.dx) * 10) / 10; p.y = Math.round((p.y + shift.dy) * 10) / 10; });
  room.fixtures.forEach((f) => { f.x += shift.dx; f.y += shift.dy; });

  // Öffnungen
  const W = wallInfo(room);
  const byWall = {};
  room.openings.forEach((o, k) => {
    o.id ||= uid('o');
    o.wall = ((Math.round(o.wall) % W.length) + W.length) % W.length;
    const L = W[o.wall].len;
    const minW = o.type === 'door' ? 55 : 30;
    o.width = clamp(+o.width || (o.type === 'door' ? 90 : 100), minW, Math.max(minW, L - 4));
    o.height = clamp(+o.height || (o.type === 'door' ? DOOR_H : 120), 40, room.height - 5);
    o.sill = o.type === 'door' ? 0 : clamp(+o.sill || 100, 0, Math.max(0, room.height - o.height - 5));
    o.offset = clamp(+o.offset || 0, 0, Math.max(0, L - o.width));
    o.swing = o.swing === 'aussen' ? 'aussen' : 'innen';
    o.hinge = o.hinge === 'rechts' ? 'rechts' : 'links';
    (byWall[o.wall] ||= []).push(o);
  });
  const drop = new Set();
  for (const [wi, list] of Object.entries(byWall)) {
    list.sort((a, b) => a.offset - b.offset);
    const L = W[wi].len;
    for (let k = 1; k < list.length; k++) {
      const prev = list[k - 1], cur = list[k];
      if (cur.offset < prev.offset + prev.width + 4) {
        cur.offset = prev.offset + prev.width + 4;
        if (cur.offset + cur.width > L) drop.add(cur.id);
      }
    }
  }
  room.openings = room.openings.filter((o) => !drop.has(o.id));

  // Ausstattung
  room.fixtures.forEach((f) => {
    f.id ||= uid('f');
    const spec = FIXTURES[f.type] || FIXTURES.schrank;
    f.w = clamp(+f.w || spec.w, 10, 400);
    f.d = clamp(+f.d || spec.d, 4, 300);
    f.rot = (((+f.rot || 0) % 360) + 360) % 360;
    f.x = +f.x; f.y = +f.y;
    if (f.type === 'dusche') f.opt = { glass: f.opt?.glass || 'right' };
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) { f.x = bb.w / 2; f.y = bb.h / 2; }
  });
  // Ausstattung, die knapp an einer Wand liegt, sauber anlegen
  room.fixtures = room.fixtures.map((f) => (pointInPoly({ x: f.x, y: f.y }, room.polygon) ? snapFixture(room, f, 12) : f));
  return { room, shift, removed };
}

// ---------------------------------------------------------------- Wandlänge ändern
/** Setzt die Länge einer Wand. Bei rechten Winkeln wandert die ganze Nachbarwand mit. */
export function setWallLength(room, i, newLen) {
  const r = deepClone(room);
  const W = wallInfo(r);
  const w = W[i];
  const n = r.polygon.length;
  const delta = newLen - w.len;
  const j = (i + 1) % n, k = (i + 2) % n;
  const next = W[j];
  const shift = { x: w.ux * delta, y: w.uy * delta };
  r.polygon[j].x += shift.x; r.polygon[j].y += shift.y;
  if (Math.abs(next.ux * w.ux + next.uy * w.uy) < 0.15) { r.polygon[k].x += shift.x; r.polygon[k].y += shift.y; }
  return r;
}

// ---------------------------------------------------------------- Räume bauen
export function makeRect(L, B, H = 250) {
  return {
    polygon: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: B }, { x: 0, y: B }],
    height: H, openings: [], fixtures: [],
  };
}

export function makeLShape(room) {
  const bb = polyBBox(room.polygon);
  const nx = Math.round(bb.w * 0.4), ny = Math.round(bb.h * 0.4);
  const r = {
    polygon: [{ x: 0, y: 0 }, { x: bb.w - nx, y: 0 }, { x: bb.w - nx, y: ny }, { x: bb.w, y: ny }, { x: bb.w, y: bb.h }, { x: 0, y: bb.h }],
    height: room.height, openings: [], fixtures: [],
  };
  // vorhandene Möbel behalten, die noch im Raum liegen
  r.fixtures = deepClone(room.fixtures).filter((f) => pointInPoly(f, r.polygon));
  return r;
}

const op = (type, wall, offset, width, extra = {}) => ({ id: uid('o'), type, wall, offset, width, height: type === 'door' ? DOOR_H : 120, sill: type === 'door' ? 0 : 100, swing: 'innen', hinge: 'links', ...extra });
const fx = (type, x, y, rot, extra = {}) => ({ id: uid('f'), type, x, y, w: FIXTURES[type].w, d: FIXTURES[type].d, rot, ...extra });

export function makeTemplates() {
  const out = [];
  out.push({
    id: 'gaeste-wc', name: 'Gäste-WC', desc: '1,10 × 2,00 m',
    room: {
      polygon: [{ x: 0, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 200 }, { x: 0, y: 200 }], height: 250,
      openings: [op('door', 2, 12, 80, { swing: 'aussen', hinge: 'rechts' }), op('window', 3, 70, 50, { sill: 110, height: 70 })],
      fixtures: [fx('wc', 55, 34, 0), fx('waschtisch', 95, 125, 90, { w: 45, d: 30 })],
    },
  });
  out.push({
    id: 'bad-wanne', name: 'Bad mit Wanne', desc: '2,70 × 2,10 m',
    room: {
      polygon: [{ x: 0, y: 0 }, { x: 270, y: 0 }, { x: 270, y: 210 }, { x: 0, y: 210 }], height: 250,
      openings: [op('window', 0, 100, 90), op('door', 2, 25, 90, { swing: 'aussen', hinge: 'rechts' })],
      fixtures: [fx('badewanne', 85, 37.5, 0), fx('wc', 236, 115, 90), fx('waschtisch', 24, 118, 270), fx('waschmaschine', 30, 180, 180), fx('heizkoerper', 266, 40, 90)],
    },
  });
  out.push({
    id: 'walk-in', name: 'Bad mit Walk-in-Dusche', desc: '3,00 × 2,40 m',
    room: {
      polygon: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 240 }, { x: 0, y: 240 }], height: 250,
      openings: [op('door', 2, 100, 90, { swing: 'aussen', hinge: 'rechts' }), op('window', 1, 120, 80)],
      fixtures: [fx('dusche', 250, 50, 0, { w: 100, d: 100, opt: { glass: 'left' } }), fx('waschtisch', 70, 24, 0), fx('wc', 34, 140, 270), fx('heizkoerper', 170, 4, 0), fx('waschmaschine', 270, 210, 180)],
    },
  });
  out.push({
    id: 'l-bad', name: 'L-förmiges Bad', desc: '3,00 × 2,40 m mit Nische',
    room: {
      polygon: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 240 }, { x: 0, y: 240 }], height: 250,
      openings: [op('window', 0, 40, 100), op('door', 2, 15, 85, { swing: 'aussen', hinge: 'rechts' })],
      fixtures: [fx('badewanne', 37.5, 100, 270), fx('waschtisch', 170, 216, 180), fx('wc', 266, 160, 90), fx('heizkoerper', 176, 50, 90)],
    },
  });
  out.push({
    id: 'leer', name: 'Leerer Raum', desc: 'Rechteck mit deinen Maßen',
    room: { polygon: [{ x: 0, y: 0 }, { x: 250, y: 0 }, { x: 250, y: 200 }, { x: 0, y: 200 }], height: 250, openings: [op('window', 0, 80, 90), op('door', 2, 30, 90)], fixtures: [] },
  });
  return out;
}

/** Textzusammenfassung für den Chat-Assistenten. */
export function describeRoomForChat(room) {
  const labels = wallLabels(room);
  const W = wallInfo(room);
  return W.map((w) => {
    const on = [];
    room.openings.filter((o) => o.wall === w.i).forEach((o) => on.push(o.type === 'door' ? 'Tür' : 'Fenster'));
    room.fixtures.forEach((f) => {
      const t = (f.x - w.a.x) * w.ux + (f.y - w.a.y) * w.uy;
      const dn = (f.x - w.a.x) * w.nx + (f.y - w.a.y) * w.ny;
      if (t > -10 && t < w.len + 10 && dn < f.d / 2 + Math.max(f.w, f.d) / 2 && dn > 0 && Math.abs(dn - f.d / 2) < 14) on.push(FIXTURES[f.type]?.label || f.type);
    });
    return { index: w.i, name: labels[w.i], laenge_cm: Math.round(w.len), davor_oder_darin: on };
  });
}
