// Gestaltung: Standardwerte, Stile, Chat-Aktionen, Randfliesen-Optimierung, Mengenberechnung.
import { deepClone, clamp } from './dom.js';
import { wallInfo, wallLabels, polyBBox, polyArea, DOOR_H } from './room.js';

export const floorId = 'floor';
export const wallId = (i) => `wall:${i}`;
export const isWall = (id) => typeof id === 'string' && id.startsWith('wall:');
export const wallIndex = (id) => parseInt(id.split(':')[1], 10);

export const tileOf = (cat, id) => cat.tiles.find((t) => t.id === id) || null;
export const groutOf = (cat, id) => cat.grouts.find((g) => g.id === id) || cat.grouts[1];
export const paintOf = (cat, id) => cat.paints.find((p) => p.id === id) || cat.paints[1];
export const trimOf = (cat, id) => cat.trims.find((t) => t.id === id) || cat.trims[0];
export const patternOf = (cat, id) => cat.patterns.find((p) => p.id === id) || cat.patterns[0];
export const styleOf = (cat, id) => cat.styles.find((s) => s.id === id) || null;

export function surfaceDefaults(over = {}) {
  return { tile: null, pattern: 'grid', rotated: false, groutMm: 3, grout: 'hellgrau', offset: { x: 0, y: 0 }, ...over };
}

export function defaultDesign(room, cat) {
  const wall = surfaceDefaults({ tile: 'uni-weiss-glanz-30x60', pattern: 'half', groutMm: 2, grout: 'hellgrau', height: room.height });
  return {
    floor: surfaceDefaults({ tile: 'beton-warm-60x60', pattern: 'grid', groutMm: 3, grout: 'hellgrau' }),
    walls: room.polygon.map(() => deepClone(wall)),
    wallDefault: deepClone(wall),
    paint: 'warmweiss',
    trim: 'none',
    light: 'tag',
  };
}

/** Passt die Wandliste an die Zahl der Wände an. */
export function reconcileDesign(design, room) {
  const n = room.polygon.length;
  while (design.walls.length < n) design.walls.push(deepClone(design.wallDefault || design.walls[design.walls.length - 1]));
  if (design.walls.length > n) design.walls.length = n;
  design.walls.forEach((w) => { if (w.height == null) w.height = room.height; });
  return design;
}

export function getSurface(design, id) {
  return id === floorId ? design.floor : design.walls[wallIndex(id)];
}

export function allSurfaceIds(room) {
  return [floorId, ...room.polygon.map((_, i) => wallId(i))];
}

export function applyStyle(design, style, room) {
  const f = style.floor, w = style.walls;
  Object.assign(design.floor, surfaceDefaults({ tile: f.tile, pattern: f.pattern, rotated: false, groutMm: f.groutMm, grout: f.grout }));
  const wall = surfaceDefaults({ tile: w.tile, pattern: w.pattern, rotated: false, groutMm: w.groutMm, grout: w.grout, height: Math.min(w.height, room.height) });
  design.walls = room.polygon.map(() => deepClone(wall));
  design.wallDefault = deepClone(wall);
  design.paint = style.paint;
  design.trim = style.trim;
  return design;
}

/** Wendet Aktionen aus Chat oder Stil an. Gibt die betroffenen Flächen zurück. */
export function applyOps(design, ops, room, cat) {
  const touched = new Set();
  const patch = (target, op) => {
    const s = target;
    if (op.tile_id) s.tile = op.tile_id;
    if (op.pattern) s.pattern = op.pattern;
    if (typeof op.rotated === 'boolean') s.rotated = op.rotated;
    if (op.grout_mm != null) s.groutMm = clamp(op.grout_mm, 1, 10);
    if (op.grout) s.grout = op.grout;
    if (op.tile_height_cm != null && 'height' in s) s.height = clamp(op.tile_height_cm, 0, room.height);
    if (op.tile_id || op.pattern || op.rotated != null) s.offset = { x: 0, y: 0 };
  };
  for (const op of ops) {
    if (op.style_id) {
      const st = styleOf(cat, op.style_id);
      if (st) { applyStyle(design, st, room); allSurfaceIds(room).forEach((id) => touched.add(id)); }
      continue;
    }
    if (op.target === 'floor') { patch(design.floor, op); touched.add(floorId); }
    if (op.target === 'all_walls') {
      design.walls.forEach((w, i) => { patch(w, op); touched.add(wallId(i)); });
      patch(design.wallDefault, op);
    }
    if (op.target === 'wall' && design.walls[op.wall_index]) { patch(design.walls[op.wall_index], op); touched.add(wallId(op.wall_index)); }
    if (op.paint) { design.paint = op.paint; design.walls.forEach((_, i) => touched.add(wallId(i))); }
    if (op.trim) { design.trim = op.trim; design.walls.forEach((_, i) => touched.add(wallId(i))); }
  }
  return [...touched];
}

// ----------------------------------------------------------------- Maße einer Fläche
export function surfaceDims(room, id) {
  if (id === floorId) { const bb = polyBBox(room.polygon); return { w: bb.w, h: bb.h }; }
  const W = wallInfo(room)[wallIndex(id)];
  return { w: W.len, h: room.height };
}

/** Fliesenmaß (Breite × Höhe) nach Drehung. */
export function placedTileSize(tile, rotated) {
  const [a, b] = tile.size;
  return rotated ? { tw: b, th: a } : { tw: a, th: b };
}

// ----------------------------------------------------------------- Randfliesen
/** Länge der angeschnittenen Randstücke bei Raster ab `offset`. Ein volles Stück zählt als `pitch`. */
export function edgePieces(length, pitch, offset) {
  const m = (v) => ((v % pitch) + pitch) % pitch;
  const l = m(offset), r = m(length - offset);
  return { start: l < 0.3 ? pitch : l, end: r < 0.3 ? pitch : r };
}

const SHIFTS = { grid: [0], half: [0, 0.5], third: [0, 1 / 3, 2 / 3] };

function minPiece(length, pitch, offset, shifts = [0]) {
  let mn = Infinity;
  for (const f of shifts) {
    const e = edgePieces(length, pitch, offset + f * pitch);
    mn = Math.min(mn, e.start, e.end);
  }
  return mn;
}

export function bestOffset(length, pitch, shifts = [0]) {
  let best = 0, bestVal = -1;
  for (let o = 0; o < pitch; o += 0.5) {
    const v = minPiece(length, pitch, o, shifts);
    if (v > bestVal + 0.01) { best = o; bestVal = v; }
  }
  return { offset: best, min: bestVal };
}

/** Findet schmale Randstücke und schlägt eine bessere Startposition vor. */
export function layoutHints(room, design, cat) {
  const hints = [];
  const labels = wallLabels(room);
  const check = (id, name, s, dims, zoneH) => {
    const tile = tileOf(cat, s.tile);
    if (!tile || !SHIFTS[s.pattern]) return;
    const { tw, th } = placedTileSize(tile, s.rotated);
    const g = s.groutMm / 10;
    const pw = tw + g, ph = th + g;
    const shifts = SHIFTS[s.pattern];
    const narrowLimit = (p) => Math.max(5, p * 0.12);
    const axes = [];
    axes.push({ key: 'x', len: dims.w, pitch: pw, shifts });
    axes.push({ key: 'y', len: zoneH, pitch: ph, shifts: [0] });
    const fix = {};
    const issues = [];
    for (const a of axes) {
      if (a.len <= 0) continue;
      const cur = minPiece(a.len, a.pitch, s.offset?.[a.key] || 0, a.shifts);
      if (cur < narrowLimit(a.pitch)) {
        const best = bestOffset(a.len, a.pitch, a.shifts);
        issues.push({ axis: a.key, cur, best: best.min });
        if (best.min > cur + 1) fix[a.key] = best.offset;
      }
    }
    if (issues.length) {
      const worst = Math.min(...issues.map((i) => i.cur));
      hints.push({ id, text: `${name}: Am Rand bleibt ein sehr schmaler Streifen (${worst.toFixed(1).replace('.', ',')} cm).`, fix: Object.keys(fix).length ? fix : null });
    }
  };
  check(floorId, 'Boden', design.floor, surfaceDims(room, floorId), surfaceDims(room, floorId).h);
  design.walls.forEach((w, i) => {
    if (!w.tile || w.height <= 0) return;
    check(wallId(i), labels[i], w, surfaceDims(room, wallId(i)), Math.min(w.height, room.height));
  });
  return hints;
}

export function optimizeSurface(design, id, room, cat) {
  const s = getSurface(design, id);
  const tile = tileOf(cat, s.tile);
  if (!tile) return false;
  const { tw, th } = placedTileSize(tile, s.rotated);
  const g = s.groutMm / 10;
  const dims = surfaceDims(room, id);
  const shifts = SHIFTS[s.pattern] || [0];
  if (!SHIFTS[s.pattern]) return false;
  const zoneH = id === floorId ? dims.h : Math.min(s.height, room.height);
  s.offset = { x: bestOffset(dims.w, tw + g, shifts).offset, y: bestOffset(zoneH, th + g, [0]).offset };
  return true;
}

// ----------------------------------------------------------------- Mengen
const WASTE_EXTRA = 0.0;

function overlap1(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }

export function surfaceAreas(room, design) {
  const W = wallInfo(room);
  const labels = wallLabels(room);
  const out = [];
  out.push({ id: floorId, name: 'Boden', gross: polyArea(room.polygon) / 10000, deductions: 0, spec: design.floor });
  design.walls.forEach((w, i) => {
    const th = clamp(w.height ?? room.height, 0, room.height);
    const gross = (W[i].len * th) / 10000;
    let ded = 0;
    room.openings.filter((o) => o.wall === i).forEach((o) => {
      const oh = o.type === 'door' ? Math.min(o.height || DOOR_H, room.height) : o.height;
      const sill = o.type === 'door' ? 0 : o.sill;
      ded += (o.width * overlap1(sill, sill + oh, 0, th)) / 10000;
    });
    out.push({ id: wallId(i), name: labels[i], gross, deductions: ded, spec: w, tiledHeight: th, len: W[i].len });
  });
  return out.map((s) => ({ ...s, net: Math.max(0, s.gross - s.deductions) }));
}

/** Materialliste: Fliesen je Typ, Fugenmasse, Kleber, Leisten. */
export function buildBom(room, design, cat) {
  const surfaces = surfaceAreas(room, design);
  const byTile = new Map();
  let groutKg = 0, adhesiveKg = 0, totalArea = 0;
  const lines = [];
  for (const s of surfaces) {
    const tile = tileOf(cat, s.spec.tile);
    if (!tile || s.net <= 0 || (s.id !== floorId && (s.spec.height ?? room.height) <= 0)) continue;
    const pat = patternOf(cat, s.spec.pattern);
    const waste = pat.waste + WASTE_EXTRA;
    const areaWithWaste = s.net * (1 + waste);
    const [a, b] = tile.size;
    const pieces = Math.ceil((areaWithWaste * 10000) / (a * b));
    const entry = byTile.get(tile.id) || { tile, net: 0, pieces: 0, surfaces: [] };
    entry.net += s.net; entry.pieces += pieces; entry.surfaces.push({ name: s.name, net: s.net, waste, pattern: pat.name });
    byTile.set(tile.id, entry);
    // Fugenmasse (kg/m²) = (L+B)/(L·B) · Fugenbreite · Fliesendicke · 1,6   (alle Maße in mm)
    const Lmm = a * 10, Bmm = b * 10;
    groutKg += s.net * (((Lmm + Bmm) / (Lmm * Bmm)) * s.spec.groutMm * tile.thickness * 1.6);
    adhesiveKg += s.net * (Math.max(a, b) <= 30 ? 3.5 : Math.max(a, b) <= 60 ? 4.5 : 6.5);
    totalArea += s.net;
  }
  for (const e of byTile.values()) {
    const boxes = Math.ceil(e.pieces / e.tile.pcsPerBox);
    const m2 = boxes * e.tile.boxM2;
    lines.push({ ...e, boxes, boxM2: e.tile.boxM2, m2Bought: m2, cost: m2 * e.tile.priceM2 });
  }
  // Abschlussleisten: Wände mit Fliesen, die nicht bis zur Decke reichen
  let trimM = 0;
  const trim = trimOf(cat, design.trim);
  if (trim.color) {
    const W = wallInfo(room);
    design.walls.forEach((w, i) => {
      if (!w.tile) return;
      const h = clamp(w.height ?? room.height, 0, room.height);
      if (h > 4 && h < room.height - 2) {
        let len = W[i].len;
        room.openings.filter((o) => o.wall === i && o.type === 'door' && (o.height || DOOR_H) <= h + 1).forEach((o) => { len -= o.width; });
        trimM += Math.max(0, len) / 100;
      }
    });
  }
  const sacks = (kg, size) => Math.ceil((kg * 1.1) / size);
  return {
    surfaces, lines, totalArea,
    tilesCost: lines.reduce((a, l) => a + l.cost, 0),
    grout: { kg: groutKg * 1.1, sacks: sacks(groutKg, 5) },
    adhesive: { kg: adhesiveKg * 1.1, sacks: sacks(adhesiveKg, 25) },
    trim: { meters: trimM, pieces: Math.ceil(trimM / 2.5) },
  };
}
