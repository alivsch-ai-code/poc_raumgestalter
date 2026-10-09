// Fliesen-Engine: Verlegemuster, Materialtexturen, Fugen und Schattenverläufe.
// Alles wird maßstabsgetreu in Zentimetern gerechnet und dann auf eine Canvas-Textur gezeichnet.

// ----------------------------------------------------------------- Zufall und Rauschen
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, s, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f, s + i * 101);
    norm += amp; f *= 2; amp *= 0.5;
  }
  return v / norm;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ----------------------------------------------------------------- Farben
export const hex2rgb = (h) => { const s = h.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const rgbCss = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, f) => [c[0] * (1 + f), c[1] * (1 + f), c[2] * (1 + f)];

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

export const FINISH_ROUGH = { glanz: 0.1, seidenmatt: 0.38, matt: 0.68 };
const GROUT_ROUGH = 0.92;
const PAINT_ROUGH = 0.88;

// ----------------------------------------------------------------- Material-Varianten
function lookColor(tile, cx, cy, wcm, hcm, seed, rnd, extra) {
  const base = extra.base, acc = extra.acc;
  const sx = (seed % 97) * 13.7, sy = (seed % 89) * 9.3;
  switch (tile.look) {
    case 'marmor': {
      const warp = fbm(cx * 0.016 + sx, cy * 0.016 + sy, seed + 7, 3);
      const n1 = fbm(cx * 0.024 + warp * 2.6 + sx, cy * 0.024 + warp * 2.6 + sy, seed + 3, 5);
      const ridge = 1 - Math.abs(n1 * 2 - 1);
      const vein = smooth(0.976, 0.9975, ridge);
      const n2 = fbm(cx * 0.06 + warp * 3 + sx, cy * 0.06 + warp * 3 + sy, seed + 11, 4);
      const vein2 = smooth(0.984, 0.9985, 1 - Math.abs(n2 * 2 - 1)) * 0.45;
      const cloud = fbm(cx * 0.012 + sx, cy * 0.012 + sy, seed + 19, 4);
      const cloud2 = fbm(cx * 0.035 + sx, cy * 0.035 + sy, seed + 23, 3);
      const halo = smooth(0.9, 0.975, ridge) * 0.13;
      const t = clamp01(Math.max(vein, vein2) * 0.9 + halo + (cloud - 0.5) * 0.3 + (cloud2 - 0.5) * 0.08);
      return mixc(base, acc, t);
    }
    case 'travertin': {
      const band = fbm(cx * 0.012 + sx, cy * 0.55 + sy, seed, 3);
      const t = smooth(0.38, 0.62, band);
      const pit = smooth(0.8, 0.9, fbm(cx * 0.7 + sx, cy * 1.7 + sy, seed + 9, 2));
      const cloud = fbm(cx * 0.02 + sx, cy * 0.02 + sy, seed + 2, 3);
      let c = mixc(base, acc, t * 0.5 + (cloud - 0.5) * 0.2);
      c = mixc(c, shade(acc, -0.22), pit * 0.5);
      return c;
    }
    case 'beton': {
      const a = fbm(cx * 0.03 + sx, cy * 0.03 + sy, seed, 5);
      const b = fbm(cx * 0.22 + sx, cy * 0.22 + sy, seed + 5, 2);
      const t = clamp01(0.5 + (a - 0.5) * 1.7 + (b - 0.5) * 0.3);
      const pore = smooth(0.82, 0.9, fbm(cx * 0.9 + sx, cy * 0.9 + sy, seed + 8, 1));
      return shade(mixc(base, acc, t), -pore * 0.05);
    }
    case 'holz': {
      const along = wcm >= hcm ? cx : cy, across = wcm >= hcm ? cy : cx;
      const warp = fbm(along * 0.006 + sx, across * 0.05 + sy, seed, 3);
      let ring = across * 0.5 + warp * 8;
      let knot = 0;
      if (extra.knot) {
        const dx = along - extra.knot.a, dy = (across - extra.knot.b) * 1.7;
        const q = Math.exp(-(dx * dx + dy * dy) / (extra.knot.r * extra.knot.r));
        ring += q * 7; knot = Math.exp(-(dx * dx + dy * dy) / (extra.knot.r * extra.knot.r * 0.12));
      }
      const g = 0.5 + 0.5 * Math.sin(ring);
      const fine = fbm(along * 0.05 + sx, across * 1.1 + sy, seed + 3, 3);
      const t = clamp01(g * 0.4 + (fine - 0.5) * 0.55 + knot * 0.5);
      return shade(mixc(base, acc, t), extra.tint);
    }
    case 'schiefer': {
      const warp = fbm(cx * 0.01 + sx, cy * 0.01 + sy, seed, 2);
      const strata = fbm(cx * 0.02 + sx, cy * 0.34 + warp * 2 + sy, seed + 1, 4);
      const t = smooth(0.3, 0.7, strata);
      const pit = smooth(0.8, 0.9, fbm(cx * 0.5 + sx, cy * 0.5 + sy, seed + 4, 2));
      return shade(mixc(base, acc, t * 0.85), -pit * 0.3 + (rnd() - 0.5) * 0.01);
    }
    case 'zellige': {
      const n = fbm(cx * 0.2 + sx, cy * 0.2 + sy, seed, 4);
      const n2 = fbm(cx * 0.06 + sx, cy * 0.06 + sy, seed + 6, 3);
      return shade(base, extra.tint + (n - 0.5) * 0.2 + (n2 - 0.5) * 0.12);
    }
    case 'terrazzo': {
      const n = fbm(cx * 0.05 + sx, cy * 0.05 + sy, seed, 3);
      return shade(base, (n - 0.5) * 0.06 + extra.tint);
    }
    default: { // uni
      const n = fbm(cx * 0.06 + sx, cy * 0.06 + sy, seed, 3);
      return shade(base, (n - 0.5) * 0.045 + extra.tint);
    }
  }
}

/** Rendert eine Fliese mit w×h Pixeln. */
function renderVariant(tile, wpx, hpx, P, seed) {
  const rnd = mulberry32(seed * 7919 + 13);
  const base = hex2rgb(tile.color);
  const acc = tile.color2 && !tile.color2.includes('|') ? hex2rgb(tile.color2) : shade(base, -0.2);
  const long = Math.max(wpx, hpx);
  const k = Math.max(1, Math.ceil(long / 380));
  const lw = Math.max(2, Math.ceil(wpx / k)), lh = Math.max(2, Math.ceil(hpx / k));
  const low = mk(lw, lh);
  const lg = low.getContext('2d');
  const img = lg.createImageData(lw, lh);
  const d = img.data;
  const wcm = wpx / P, hcm = hpx / P;
  const spread = tile.look === 'zellige' ? 0.1 : tile.look === 'holz' ? 0.1 : tile.look === 'uni' ? 0.025 : 0.03;
  const extra = { base, acc, tint: (rnd() - 0.5) * spread * 2 };
  if (tile.look === 'holz' && rnd() < 0.4) {
    const along = Math.max(wcm, hcm), across = Math.min(wcm, hcm);
    extra.knot = { a: along * (0.15 + rnd() * 0.7), b: across * (0.2 + rnd() * 0.6), r: 1.6 + rnd() * 1.8 };
  }
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const c = lookColor(tile, ((x + 0.5) * k) / P, ((y + 0.5) * k) / P, wcm, hcm, seed, rnd, extra);
      const o = (y * lw + x) * 4;
      d[o] = c[0] < 0 ? 0 : c[0] > 255 ? 255 : c[0];
      d[o + 1] = c[1] < 0 ? 0 : c[1] > 255 ? 255 : c[1];
      d[o + 2] = c[2] < 0 ? 0 : c[2] > 255 ? 255 : c[2];
      d[o + 3] = 255;
    }
  }
  lg.putImageData(img, 0, 0);
  const out = mk(wpx, hpx);
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(low, 0, 0, wpx, hpx);

  if (tile.look === 'terrazzo') {
    const cols = (tile.color2 || '#999999').split('|').map(hex2rgb);
    const n = Math.round(((wcm * hcm) / 100) * 2.6);
    for (let i = 0; i < n; i++) {
      const r = (0.18 + 1.5 * Math.pow(rnd(), 2.6)) * P;
      const cx = rnd() * wpx, cy = rnd() * hpx;
      const c = cols[Math.floor(rnd() * cols.length)];
      const pts = 5 + Math.floor(rnd() * 3);
      g.beginPath();
      const rot = rnd() * 6.28;
      for (let p = 0; p < pts; p++) {
        const a = rot + (p / pts) * 6.2832 + (rnd() - 0.5) * 0.5;
        const rr = r * (0.55 + rnd() * 0.45);
        const px = cx + Math.cos(a) * rr * (1 + rnd() * 0.25), py = cy + Math.sin(a) * rr;
        p ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fillStyle = rgbCss(shade(c, (rnd() - 0.5) * 0.14), 0.96);
      g.fill();
    }
  }
  if (tile.look === 'zellige') {
    const e = Math.max(2, P * 0.55);
    const grad = (x0, y0, x1, y1, a) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, `rgba(20,20,20,${a})`); gr.addColorStop(1, 'rgba(20,20,20,0)'); return gr; };
    g.fillStyle = grad(0, hpx, 0, hpx - e * 1.6, 0.22); g.fillRect(0, hpx - e * 1.6, wpx, e * 1.6);
    g.fillStyle = grad(wpx, 0, wpx - e * 1.6, 0, 0.2); g.fillRect(wpx - e * 1.6, 0, e * 1.6, hpx);
    g.fillStyle = grad(0, 0, e * 1.2, 0, 0.1); g.fillRect(0, 0, e * 1.2, hpx);
    g.fillStyle = grad(0, 0, 0, e * 1.2, 0.08); g.fillRect(0, 0, wpx, e * 1.2);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(e * 0.2, e * 0.2, wpx - e * 0.4, Math.max(1, e * 0.18));
  }
  return out;
}

const variantCache = new Map();
const VARIANTS = 6;
function getVariants(tile, wpx, hpx, P) {
  const key = `${tile.id}|${wpx}x${hpx}|${P.toFixed(2)}`;
  if (variantCache.has(key)) { const v = variantCache.get(key); variantCache.delete(key); variantCache.set(key, v); return v; }
  const list = [];
  for (let i = 0; i < VARIANTS; i++) list.push(renderVariant(tile, wpx, hpx, P, 1000 + i * 37 + tile.id.length * 11));
  variantCache.set(key, list);
  while (variantCache.size > 6) variantCache.delete(variantCache.keys().next().value);
  return list;
}

// ----------------------------------------------------------------- Verlegemuster
const mod = (a, n) => ((a % n) + n) % n;

/**
 * Liefert Fliesenrechtecke in Ebenenkoordinaten (cm). `bounds` ist der Bereich, der bedeckt werden soll.
 * Rechtecke: {x,y,w,h,rot90,key} – w/h sind die Zellmaße inklusive Fuge.
 */
function layoutCells(pattern, tw, th, g, bounds, off, anchor) {
  const rects = [];
  const pw = tw + g, ph = th + g;
  const { x0, y0, x1, y1 } = bounds;
  if (pattern === 'grid' || pattern === 'half' || pattern === 'third' || pattern === 'diagonal') {
    const k = pattern === 'half' ? 2 : pattern === 'third' ? 3 : 1;
    const j0 = Math.floor((y0 - off.y) / ph) - 1, j1 = Math.ceil((y1 - off.y) / ph) + 1;
    for (let j = j0; j <= j1; j++) {
      const rowN = anchor === 'bottom' ? -j - 1 : j;
      const sh = k > 1 ? (mod(rowN, k) * pw) / k : 0;
      const i0 = Math.floor((x0 - off.x - sh) / pw) - 1, i1 = Math.ceil((x1 - off.x - sh) / pw) + 1;
      for (let i = i0; i <= i1; i++) rects.push({ x: i * pw + sh + off.x, y: j * ph + off.y, w: pw, h: ph, rot90: false, key: hashKey(i, j) });
    }
    return rects;
  }
  const L = Math.max(tw, th), S = Math.min(tw, th);
  const b = L + g, a = S + g;
  if (pattern === 'herring90' || pattern === 'herring45') {
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    let imin = Infinity, imax = -Infinity, jmin = Infinity, jmax = -Infinity;
    for (const [x, y] of corners) {
      const i = (x - off.x + (y - off.y)) / (2 * a), j = (x - off.x - (y - off.y)) / (2 * b);
      imin = Math.min(imin, i); imax = Math.max(imax, i); jmin = Math.min(jmin, j); jmax = Math.max(jmax, j);
    }
    const mi = Math.ceil(b / a) + 2, mj = 3;
    for (let i = Math.floor(imin) - mi; i <= Math.ceil(imax) + mi; i++) {
      for (let j = Math.floor(jmin) - mj; j <= Math.ceil(jmax) + mj; j++) {
        const x = off.x + i * a + j * b, y = off.y + i * a - j * b;
        rects.push({ x, y, w: b, h: a, rot90: false, key: hashKey(i, j * 2) });
        rects.push({ x: x + b, y: y + a - b, w: a, h: b, rot90: true, key: hashKey(i, j * 2 + 1) });
      }
    }
    return rects;
  }
  if (pattern === 'basket') {
    const n = Math.max(1, Math.round(L / S));
    const bs = L + g * 0, bsz = bs + g;
    const j0 = Math.floor((y0 - off.y) / bsz) - 1, j1 = Math.ceil((y1 - off.y) / bsz) + 1;
    const i0 = Math.floor((x0 - off.x) / bsz) - 1, i1 = Math.ceil((x1 - off.x) / bsz) + 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const horiz = mod(i + j, 2) === 0;
        const bx = off.x + i * bsz, by = off.y + j * bsz;
        for (let t = 0; t < n; t++) {
          if (horiz) rects.push({ x: bx, y: by + (t * bsz) / n, w: bsz, h: bsz / n, rot90: false, key: hashKey(i * 7 + t, j) });
          else rects.push({ x: bx + (t * bsz) / n, y: by, w: bsz / n, h: bsz, rot90: true, key: hashKey(i, j * 7 + t) });
        }
      }
    }
    return rects;
  }
  return layoutCells('grid', tw, th, g, bounds, off, anchor);
}

function hashKey(i, j) { return (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0; }

const LAYER = {
  diagonal: { rot: Math.PI / 4, center: true },
  herring45: { rot: Math.PI / 4, center: true },
};

/** Berechnet Platzierung und Transformation eines Musters für eine Zone (zoneW × zoneH cm). */
export function patternLayout({ pattern, tw, th, g, zoneW, zoneH, offset, anchor }) {
  const lay = LAYER[pattern] || { rot: 0, center: false };
  const theta = lay.rot;
  // Ursprung der Ebene in Zonenkoordinaten
  const origin = lay.center ? { x: zoneW / 2, y: zoneH / 2 } : { x: 0, y: anchor === 'bottom' ? zoneH : 0 };
  const c = Math.cos(theta), s = Math.sin(theta);
  const toLayer = (x, y) => { const dx = x - origin.x, dy = y - origin.y; return { x: dx * c + dy * s, y: -dx * s + dy * c }; };
  const pts = [[0, 0], [zoneW, 0], [zoneW, zoneH], [0, zoneH]].map(([x, y]) => toLayer(x, y));
  const bounds = { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
  const off = lay.center ? { x: offset?.x || 0, y: offset?.y || 0 } : { x: offset?.x || 0, y: anchor === 'bottom' ? -(offset?.y || 0) : offset?.y || 0 };
  const rects = layoutCells(pattern, tw, th, g, bounds, off, anchor);
  return { rects, theta, origin, bounds };
}

// ----------------------------------------------------------------- Zeichnen
function drawRects(ctx, layout, P, g, mode, tile, variants, palette) {
  const { rects, theta, origin, bounds } = layout;
  ctx.save();
  ctx.translate(origin.x * P, origin.y * P);
  ctx.rotate(theta);
  const noFlip = !tile || tile.look === 'zellige' || tile.look === 'holz';
  const bx0 = bounds.x0 - 1, bx1 = bounds.x1 + 1, by0 = bounds.y0 - 1, by1 = bounds.y1 + 1;
  for (const r of rects) {
    if (r.x + r.w < bx0 || r.x > bx1 || r.y + r.h < by0 || r.y > by1) continue;
    const cx = (r.x + r.w / 2) * P, cy = (r.y + r.h / 2) * P;
    const w = (r.w - g) * P, h = (r.h - g) * P;
    if (w < 0.5 || h < 0.5) continue;
    ctx.save();
    ctx.translate(cx, cy);
    if (r.rot90) ctx.rotate(Math.PI / 2);
    const dw = r.rot90 ? h : w, dh = r.rot90 ? w : h;
    if (mode === 'data') {
      ctx.fillStyle = palette;
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    } else if (mode === 'flat') {
      ctx.fillStyle = palette[r.key % palette.length];
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    } else {
      if (!noFlip) { ctx.scale(r.key & 1 ? -1 : 1, r.key & 2 ? -1 : 1); }
      ctx.drawImage(variants[(r.key >>> 3) % variants.length], -dw / 2, -dh / 2, dw, dh);
    }
    ctx.restore();
  }
  ctx.restore();
}

function innerShadow(ctx, W, H, clipPath, holePath, blur, alpha) {
  ctx.save();
  ctx.beginPath(); clipPath(ctx); ctx.clip();
  ctx.shadowColor = `rgba(34,24,14,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  const ext = blur * 5;
  ctx.beginPath();
  ctx.rect(-ext, -ext, W + 2 * ext, H + 2 * ext);
  holePath(ctx);
  ctx.fillStyle = '#000';
  ctx.fill('evenodd');
  ctx.restore();
}

let plasterTile = null;
function plasterPattern(ctx) {
  if (!plasterTile) {
    plasterTile = mk(192, 192);
    const g = plasterTile.getContext('2d');
    const img = g.createImageData(192, 192);
    const r = mulberry32(99);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = r() * 15;
    }
    g.putImageData(img, 0, 0);
  }
  return ctx.createPattern(plasterTile, 'repeat');
}

/**
 * Rendert eine Fläche. Rückgabe: { map, data, P, W, H } – map = Farbe, data = R: Höhe (Fugen), G: Rauheit.
 * p: kind ('floor'|'wall'), widthCm, heightCm, polygon (nur Boden, in cm ab Boxursprung), tile, pattern, rotated,
 *    groutMm, groutColor, offset{x,y}, tileHeightCm (Wand), paintColor, trimColor, maxPx
 */
export function renderSurface(p) {
  const P = Math.max(1.0, Math.min(p.pxMax || 8, (p.maxPx || 2560) / Math.max(p.widthCm, p.heightCm)));
  const W = Math.max(8, Math.round(p.widthCm * P)), H = Math.max(8, Math.round(p.heightCm * P));
  const map = mk(W, H), data = mk(W, H);
  const c = map.getContext('2d'), d = data.getContext('2d');
  const g = (p.groutMm || 3) / 10;
  const tile = p.tile || null;
  const groutRGB = hex2rgb(p.groutColor || '#cfcfcb');
  const isWall = p.kind === 'wall';
  const tiledH = isWall ? Math.max(0, Math.min(p.tileHeightCm ?? p.heightCm, p.heightCm)) : p.heightCm;
  const zoneHpx = Math.round(tiledH * P);
  const zoneTop = H - zoneHpx;

  // Farbe: Fuge / Putz
  c.fillStyle = tile ? rgbCss(groutRGB) : p.paintColor || '#eee';
  c.fillRect(0, 0, W, H);
  const rough = (v) => Math.round(Math.min(1, v) * 255);
  d.fillStyle = `rgb(36,${rough(GROUT_ROUGH)},0)`;
  d.fillRect(0, 0, W, H);

  if (isWall && zoneTop > 0 || (isWall && !tile)) {
    c.fillStyle = p.paintColor || '#eee';
    c.fillRect(0, 0, W, tile ? zoneTop : H);
    c.fillStyle = plasterPattern(c);
    c.globalAlpha = 0.55;
    c.fillRect(0, 0, W, tile ? zoneTop : H);
    c.globalAlpha = 1;
    d.fillStyle = `rgb(128,${rough(PAINT_ROUGH)},0)`;
    d.fillRect(0, 0, W, tile ? zoneTop : H);
  }

  let stats = null;
  if (tile && zoneHpx > 0) {
    const { tw, th } = p.rotated ? { tw: tile.size[1], th: tile.size[0] } : { tw: tile.size[0], th: tile.size[1] };
    const pat = p.pattern || 'grid';
    const L = Math.max(tw, th), S = Math.min(tw, th);
    const vw = (pat === 'herring90' || pat === 'herring45' || pat === 'basket') ? L : tw;
    const vh = (pat === 'herring90' || pat === 'herring45' || pat === 'basket') ? S : th;
    const variants = getVariants(tile, Math.max(2, Math.round(vw * P)), Math.max(2, Math.round(vh * P)), P);
    const layout = patternLayout({ pattern: pat, tw, th, g, zoneW: p.widthCm, zoneH: tiledH, offset: p.offset, anchor: isWall ? 'bottom' : 'top' });
    stats = { count: layout.rects.length };
    const tileRough = FINISH_ROUGH[tile.finish] ?? 0.6;

    for (const ctx of [c, d]) {
      ctx.save();
      ctx.beginPath();
      if (isWall) { ctx.rect(0, zoneTop, W, zoneHpx); }
      else if (p.polygon) { p.polygon.forEach((q, i) => (i ? ctx.lineTo(q.x * P, q.y * P) : ctx.moveTo(q.x * P, q.y * P))); ctx.closePath(); }
      else ctx.rect(0, 0, W, H);
      ctx.clip();
      if (isWall) ctx.translate(0, zoneTop);
      if (ctx === c) drawRects(ctx, layout, P, g, 'color', tile, variants, null);
      else drawRects(ctx, layout, P, g, 'data', tile, null, `rgb(214,${rough(tileRough)},0)`);
      ctx.restore();
    }
  }

  // Schatten in den Ecken (Ambient Occlusion, eingebacken)
  if (p.noAO) { /* Vorschau ohne Schatten */ } else if (isWall) {
    innerShadow(c, W, H, (x) => x.rect(0, 0, W, H), (x) => x.rect(0, -H, W, H * 2), 7 * P, 0.34);
    innerShadow(c, W, H, (x) => x.rect(0, 0, W, H), (x) => x.rect(0, -H * 2, W, H * 3 - 0), 2.4 * P, 0.2);
  } else if (p.polygon) {
    const tr = (x) => { p.polygon.forEach((q, i) => (i ? x.lineTo(q.x * P, q.y * P) : x.moveTo(q.x * P, q.y * P))); x.closePath(); };
    innerShadow(c, W, H, tr, tr, 11 * P, 0.42);
    innerShadow(c, W, H, tr, tr, 3 * P, 0.22);
  }

  // Abschlussleiste an der Oberkante der Fliesen
  if (isWall && tile && zoneTop > 2 && p.trimColor) {
    const th = Math.max(2, 1.3 * P);
    const grad = c.createLinearGradient(0, zoneTop - th, 0, zoneTop + th * 0.4);
    const col = hex2rgb(p.trimColor);
    grad.addColorStop(0, rgbCss(shade(col, 0.1))); grad.addColorStop(0.5, rgbCss(col)); grad.addColorStop(1, rgbCss(shade(col, -0.25)));
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 1.2 * P; c.shadowOffsetY = 0.5 * P;
    c.fillStyle = grad;
    c.fillRect(0, zoneTop - th, W, th * 1.4);
    c.restore();
    d.fillStyle = `rgb(255,${rough(0.3)},0)`;
    d.fillRect(0, zoneTop - th, W, th * 1.4);
  }
  // Sockelleiste bei gestrichenen Wänden
  if (isWall && (!tile || zoneHpx < 6 * P)) {
    const bh = 8 * P;
    const grad = c.createLinearGradient(0, H - bh, 0, H);
    grad.addColorStop(0, '#fbfaf6'); grad.addColorStop(1, '#e9e6de');
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 0.8 * P; c.shadowOffsetY = -0.3 * P;
    c.fillStyle = grad; c.fillRect(0, H - bh, W, bh);
    c.restore();
    d.fillStyle = `rgb(190,${rough(0.45)},0)`;
    d.fillRect(0, H - bh, W, bh);
  }
  return { map, data, P, W, H, stats };
}

// ----------------------------------------------------------------- Vorschauen
const swatchCache = new Map();
/** Ausschnitt (40×40 cm) in Originalgröße, mit Fugenkreuz in der Mitte. */
export function renderSwatch(tile, px = 112, groutHex = '#cfcfcb', groutMm = 3) {
  const key = `${tile.id}|${px}|${groutHex}|${groutMm}`;
  if (swatchCache.has(key)) return swatchCache.get(key);
  const win = 40;
  const pw = tile.size[0] + groutMm / 10, ph = tile.size[1] + groutMm / 10;
  const ox = mod(win / 2, pw), oy = mod(win / 2, ph);
  const r = renderSurface({
    kind: 'floor', widthCm: win, heightCm: win, polygon: [{ x: 0, y: 0 }, { x: win, y: 0 }, { x: win, y: win }, { x: 0, y: win }],
    tile, pattern: 'grid', rotated: false, groutMm, groutColor: groutHex, offset: { x: ox, y: oy }, pxMax: px / win, maxPx: px, noAO: true,
  });
  swatchCache.set(key, r.map);
  return r.map;
}

export function renderPatternIcon(patternId, px = 64, palette = ['#c9d3d2', '#b7c5c4', '#d6dedd'], groutColor = '#f4f6f5') {
  const c = mk(px, px);
  const ctx = c.getContext('2d');
  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, px, px);
  const scale = px / 24; // 24 cm Ausschnitt
  const tw = 12, th = 6, g = 0.7;
  const layout = patternLayout({ pattern: patternId, tw, th, g, zoneW: 24, zoneH: 24, offset: { x: 0, y: 0 }, anchor: 'top' });
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, px, px); ctx.clip();
  drawRects(ctx, layout, scale, g, 'flat', null, null, palette);
  ctx.restore();
  return c;
}
