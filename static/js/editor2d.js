// 2D-Grundriss-Editor (SVG). Alles in Zentimetern, die ViewBox ist der sichtbare Ausschnitt.
import { h, s, clamp, rafThrottle, parseNum, fmt1, fmt2, round } from './dom.js';
import { S, on, updateRoom, selectItem, insertVertex, removeVertex, changeWallLength, commit } from './state.js';
import {
  wallInfo, polyBBox, polyArea, offsetPolygon, openingGeom, doorSwing, snapFixture, FIXTURES, WALL_THICK, rad, dist,
} from './room.js';

const INK = '#27373d';
const ACCENT = '#0e7f86';
const WALL_FILL = '#33454c';

const SHORT = { badewanne: 'Wanne', dusche: 'Dusche', wc: 'WC', waschtisch: 'Waschtisch', waschmaschine: 'WM', heizkoerper: 'Heizkörper', schrank: 'Schrank' };

export class Editor2D {
  constructor(host) {
    this.host = host;
    this.view = { x0: 0, y0: 0, scale: 1 };
    this.userZoomed = false;
    this.drag = null;
    this.pointers = new Map();
    this.showUnderlay = true;
    this.svg = s('svg', { class: 'ed-svg', role: 'img', 'aria-label': 'Grundriss des Raums. Ecken, Türen, Fenster und Möbel lassen sich ziehen.', tabindex: '0' });
    this.layer = s('g');
    this.svg.append(this.layer);
    this.hint = h('div', { class: 'ed-hint' }, 'Ecke ziehen ändert den Raum. Die Mitte einer Wand ziehen setzt eine neue Ecke. Auf eine Zahl tippen, um die Länge einzugeben.');
    this.tools = h('div', { class: 'ed-tools' },
      h('button', { class: 'ed-btn', type: 'button', 'aria-label': 'Vergrößern', onclick: () => this.zoomBy(1.25) }, '+'),
      h('button', { class: 'ed-btn', type: 'button', 'aria-label': 'Verkleinern', onclick: () => this.zoomBy(0.8) }, '−'),
      h('button', { class: 'ed-btn ed-fit', type: 'button', 'aria-label': 'Ganzen Raum zeigen', title: 'Ganzen Raum zeigen', onclick: () => this.fit() }, 'Einpassen'),
    );
    this.underBtn = h('button', { class: 'ed-btn ed-under', type: 'button', hidden: true, onclick: () => { this.showUnderlay = !this.showUnderlay; this.updateUnderBtn(); this.render(); } });
    this.tools.append(this.underBtn);
    host.append(this.svg, this.tools, this.hint);
    this.render = rafThrottle(() => this.draw());
    this.bind();
    new ResizeObserver(() => { if (!this.userZoomed) this.fit(false); else this.render(); }).observe(host);
    on('room', (e) => { if (e?.fresh) { this.userZoomed = false; this.fit(false); } this.render(); });
    on('item', () => this.render());
    on('underlay', () => this.updateUnderBtn());
    on('design', () => { if (this.visible) this.render(); });
  }

  get visible() { return this.host.offsetParent !== null; }

  updateUnderBtn() {
    this.underBtn.hidden = !S.underlay;
    this.underBtn.textContent = this.showUnderlay ? 'Originalplan ausblenden' : 'Originalplan einblenden';
  }

  // ------------------------------------------------------------- Ansicht
  size() { return { w: this.host.clientWidth || 600, h: this.host.clientHeight || 400 }; }

  fit(redraw = true) {
    if (!S.room) return;
    const { w, h: hh } = this.size();
    if (w < 10) return;
    const bb = polyBBox(S.room.polygon);
    const pad = 118;
    const sc = clamp(Math.min((w - pad * 2) / Math.max(bb.w, 10), (hh - pad * 2) / Math.max(bb.h, 10)), 0.3, 3.2);
    this.view.scale = sc;
    this.view.x0 = bb.cx - w / 2 / sc;
    this.view.y0 = bb.cy - hh / 2 / sc;
    if (redraw) { this.userZoomed = false; this.render(); } else this.render();
  }

  zoomBy(f, cx, cy) {
    const { w, h: hh } = this.size();
    const px = cx ?? w / 2, py = cy ?? hh / 2;
    const wx = this.view.x0 + px / this.view.scale, wy = this.view.y0 + py / this.view.scale;
    this.view.scale = clamp(this.view.scale * f, 0.25, 14);
    this.view.x0 = wx - px / this.view.scale;
    this.view.y0 = wy - py / this.view.scale;
    this.userZoomed = true;
    this.render();
  }

  toWorld(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: this.view.x0 + (e.clientX - r.left) / this.view.scale, y: this.view.y0 + (e.clientY - r.top) / this.view.scale };
  }

  // ------------------------------------------------------------- Zeichnen
  draw() {
    if (!S.room || !this.visible) return;
    const room = S.room;
    const { w, h: hh } = this.size();
    const v = this.view;
    const px = 1 / v.scale;
    this.svg.setAttribute('viewBox', `${v.x0} ${v.y0} ${w / v.scale} ${hh / v.scale}`);
    const L = s('g');
    const poly = room.polygon;
    const W = wallInfo(room);
    const T = WALL_THICK;
    const outer = offsetPolygon(poly, T);
    const path = (pts) => 'M' + pts.map((p) => `${round(p.x, 2)} ${round(p.y, 2)}`).join('L') + 'Z';
    const sel = S.item;

    // Raster
    const step = v.scale > 2.2 ? 10 : v.scale > 0.7 ? 50 : 100;
    const gx0 = Math.floor(v.x0 / step) * step, gx1 = v.x0 + w / v.scale;
    const gy0 = Math.floor(v.y0 / step) * step, gy1 = v.y0 + hh / v.scale;
    let gd = '', gm = '';
    for (let x = gx0; x <= gx1; x += step) (Math.round(x) % 100 === 0 ? (gm += `M${x} ${gy0}V${gy1}`) : (gd += `M${x} ${gy0}V${gy1}`));
    for (let y = gy0; y <= gy1; y += step) (Math.round(y) % 100 === 0 ? (gm += `M${gx0} ${y}H${gx1}`) : (gd += `M${gx0} ${y}H${gx1}`));
    L.append(s('path', { d: gd, class: 'ed-grid' }), s('path', { d: gm, class: 'ed-grid ed-grid-major' }));

    // Boden
    L.append(s('path', { d: path(poly), class: 'ed-floor' }));
    if (S.underlay && this.showUnderlay) {
      const u = S.underlay;
      L.append(s('image', { href: u.src, x: u.x, y: u.y, width: u.w, height: u.h, opacity: 0.38, preserveAspectRatio: 'none', 'pointer-events': 'none' }));
    }

    // Wände
    L.append(s('path', { d: path(outer) + path(poly), 'fill-rule': 'evenodd', class: 'ed-wall' }));

    // Öffnungen: Lücken
    const gapPath = (o) => {
      const g = openingGeom(room, o);
      const { W: ww, P0, P1 } = g;
      const e = 0.6;
      const a = { x: P0.x + ww.nx * e, y: P0.y + ww.ny * e }, b = { x: P1.x + ww.nx * e, y: P1.y + ww.ny * e };
      const c = { x: P1.x - ww.nx * (T + e), y: P1.y - ww.ny * (T + e) }, d = { x: P0.x - ww.nx * (T + e), y: P0.y - ww.ny * (T + e) };
      return path([a, b, c, d]);
    };
    const gapLayer = s('g'), symLayer = s('g');
    for (const o of room.openings) {
      const g = openingGeom(room, o);
      if (!g) continue;
      const isSel = sel?.type === 'opening' && sel.id === o.id;
      gapLayer.append(s('path', { d: gapPath(o), class: 'ed-gap' + (isSel ? ' sel' : ''), dataset: { kind: 'opening', id: o.id } }));
      const { W: ww, P0, P1 } = g;
      if (o.type === 'window') {
        for (const k of [0.15, 0.5, 0.85]) {
          const dx = -ww.nx * T * k, dy = -ww.ny * T * k;
          symLayer.append(s('line', { x1: P0.x + dx, y1: P0.y + dy, x2: P1.x + dx, y2: P1.y + dy, class: 'ed-win' + (k === 0.5 ? ' mid' : '') + (isSel ? ' sel' : ''), 'pointer-events': 'none' }));
        }
      } else {
        const sw = doorSwing(room, o);
        symLayer.append(
          s('line', { x1: sw.H.x, y1: sw.H.y, x2: sw.leafEnd.x, y2: sw.leafEnd.y, class: 'ed-leaf' + (isSel ? ' sel' : ''), 'pointer-events': 'none' }),
          s('path', { d: 'M' + sw.arc.map((p) => `${round(p.x, 2)} ${round(p.y, 2)}`).join('L'), class: 'ed-arc' + (sw.inward ? '' : ' out') + (isSel ? ' sel' : ''), 'pointer-events': 'none' }),
        );
      }
    }
    L.append(gapLayer, symLayer);

    // Wand-Treffer (für Doppelklick)
    for (const w2 of W) {
      L.append(s('line', { x1: w2.a.x, y1: w2.a.y, x2: w2.b.x, y2: w2.b.y, class: 'ed-wallhit', 'stroke-width': 14 * px, dataset: { kind: 'wall', i: w2.i } }));
    }

    // Ausstattung
    for (const f of room.fixtures) L.append(this.fixtureNode(f, sel?.type === 'fixture' && sel.id === f.id, px));

    // Maße
    const dimLayer = s('g', { class: 'ed-dims' });
    for (const w2 of W) {
      const off = T + 20;
      const ox = -w2.nx * off, oy = -w2.ny * off;
      const a = { x: w2.a.x + ox, y: w2.a.y + oy }, b = { x: w2.b.x + ox, y: w2.b.y + oy };
      dimLayer.append(
        s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'ed-dimline' }),
        s('line', { x1: w2.a.x - w2.nx * (T + 4), y1: w2.a.y - w2.ny * (T + 4), x2: a.x - w2.nx * 6, y2: a.y - w2.ny * 6, class: 'ed-dimline' }),
        s('line', { x1: w2.b.x - w2.nx * (T + 4), y1: w2.b.y - w2.ny * (T + 4), x2: b.x - w2.nx * 6, y2: b.y - w2.ny * 6, class: 'ed-dimline' }),
      );
      const text = fmt1(w2.len);
      const fs = 12.5 * px;
      const tw = (text.length * 7.2 + 18) * px, th = 22 * px;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const grp = s('g', { class: 'ed-dim', dataset: { kind: 'dim', i: w2.i }, tabindex: '0', role: 'button', 'aria-label': `Wand ${w2.i + 1}: ${text} Zentimeter. Zum Ändern anklicken.` });
      grp.append(s('rect', { x: mx - tw / 2, y: my - th / 2, width: tw, height: th, rx: th / 2 }), s('text', { x: mx, y: my, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text));
      dimLayer.append(grp);
    }
    L.append(dimLayer);

    // Flächenangabe
    const bb = polyBBox(poly);
    const area = polyArea(poly) / 10000;
    L.append(
      s('text', { x: bb.cx, y: bb.cy - 4 * px, class: 'ed-area', 'font-size': 20 * px, 'text-anchor': 'middle', 'pointer-events': 'none' }, `${fmt2(area)} m²`),
      s('text', { x: bb.cx, y: bb.cy + 18 * px, class: 'ed-area-sub', 'font-size': 12 * px, 'text-anchor': 'middle', 'pointer-events': 'none' }, `Höhe ${fmt2(room.height / 100)} m`),
    );

    // Griffe
    const hl = s('g', { class: 'ed-handles' });
    if (sel?.type === 'opening') {
      const o = room.openings.find((q) => q.id === sel.id);
      const g = o && openingGeom(room, o);
      if (g) {
        for (const [end, P] of [['a', g.P0], ['b', g.P1]]) {
          hl.append(s('rect', { x: P.x - 5 * px, y: P.y - 5 * px, width: 10 * px, height: 10 * px, rx: 2 * px, class: 'ed-hsq', dataset: { kind: 'ohandle', id: o.id, end } }));
        }
      }
    }
    if (sel?.type === 'fixture') {
      const f = room.fixtures.find((q) => q.id === sel.id);
      if (f) {
        const r = rad(f.rot), fx = -Math.sin(r), fy = Math.cos(r);
        const dd = f.d / 2 + 26 * px;
        const hx = f.x + fx * dd, hy = f.y + fy * dd;
        hl.append(
          s('line', { x1: f.x + fx * f.d / 2, y1: f.y + fy * f.d / 2, x2: hx, y2: hy, class: 'ed-rotline' }),
          s('circle', { cx: hx, cy: hy, r: 8 * px, class: 'ed-hrot', dataset: { kind: 'frot', id: f.id } }),
          s('path', { d: `M${hx - 3.4 * px} ${hy - 1 * px}a3.6 3.6 0 1 1 1.2 4`, class: 'ed-rotglyph', transform: '', 'pointer-events': 'none', style: { strokeWidth: 1.4 * px } }),
        );
      }
    }
    W.forEach((w2) => {
      if (w2.len < 36) return;
      const mx = (w2.a.x + w2.b.x) / 2, my = (w2.a.y + w2.b.y) / 2;
      hl.append(s('g', { class: 'ed-mid', dataset: { kind: 'mid', i: w2.i }, transform: `translate(${mx} ${my})` },
        s('circle', { r: 7.5 * px }),
        s('path', { d: `M${-3.2 * px} 0H${3.2 * px}M0 ${-3.2 * px}V${3.2 * px}`, style: { strokeWidth: 1.5 * px } })));
    });
    poly.forEach((p, i) => hl.append(s('circle', { cx: p.x, cy: p.y, r: 7 * px, class: 'ed-hv', dataset: { kind: 'vertex', i }, style: { strokeWidth: 2 * px } })));
    L.append(hl);

    this.layer.replaceWith(L);
    this.layer = L;
  }

  fixtureNode(f, selected, px) {
    const w = f.w, d = f.d;
    const g = s('g', { class: 'ed-fx' + (selected ? ' sel' : ''), transform: `translate(${f.x} ${f.y}) rotate(${f.rot || 0})`, dataset: { kind: 'fixture', id: f.id } });
    const sw = 1.5 * px;
    const body = (el) => { el.setAttribute('class', 'fx-body'); el.style.strokeWidth = sw; return el; };
    const thin = (el) => { el.setAttribute('class', 'fx-thin'); el.style.strokeWidth = sw * 0.8; return el; };
    const rect = (x, y, ww, hh, rx = 0) => s('rect', { x, y, width: ww, height: hh, rx });
    switch (f.type) {
      case 'badewanne':
        g.append(body(rect(-w / 2, -d / 2, w, d, 8)), thin(rect(-w / 2 + 6, -d / 2 + 6, w - 12, d - 12, 16)), thin(s('circle', { cx: w / 2 - 20, cy: 0, r: 2.8 })), thin(s('circle', { cx: -w / 2 + 14, cy: -d / 2 + 4, r: 2.4 })));
        break;
      case 'dusche': {
        g.append(body(rect(-w / 2, -d / 2, w, d, 3)), thin(s('circle', { cx: w * 0.18, cy: d * 0.12, r: 4 })));
        for (let k = 1; k < 4; k++) g.append(thin(s('line', { x1: -w / 2 + (w * k) / 4, y1: -d / 2, x2: -w / 2 + (w * k) / 4, y2: d / 2 })), thin(s('line', { x1: -w / 2, y1: -d / 2 + (d * k) / 4, x2: w / 2, y2: -d / 2 + (d * k) / 4 })));
        const side = f.opt?.glass || 'right';
        const glass = (sx) => { const l = s('line', { x1: sx * w / 2, y1: -d / 2, x2: sx * w / 2, y2: d / 2, class: 'fx-glass' }); l.style.strokeWidth = 3.4 * px; return l; };
        if (side === 'left' || side === 'both') g.append(glass(-1));
        if (side === 'right' || side === 'both') g.append(glass(1));
        break;
      }
      case 'wc': {
        const tank = Math.min(18, d * 0.26);
        g.append(body(rect(-w / 2, -d / 2, w, tank, 3)));
        const hw = w / 2 - 1.5, top = -d / 2 + tank, bot = d / 2 - 1;
        g.append(body(s('path', { d: `M${-hw} ${top}V${bot - 22}C${-hw} ${bot},${hw} ${bot},${hw} ${bot - 22}V${top}Z` })), thin(s('ellipse', { cx: 0, cy: top + (bot - top) * 0.52, rx: hw * 0.62, ry: (bot - top) * 0.38 })));
        break;
      }
      case 'waschtisch':
        g.append(body(rect(-w / 2, -d / 2, w, d, 4)), thin(s('ellipse', { cx: 0, cy: d * 0.04, rx: w * 0.33, ry: d * 0.3 })), thin(s('circle', { cx: 0, cy: -d / 2 + 6, r: 2.2 })));
        break;
      case 'waschmaschine':
        g.append(body(rect(-w / 2, -d / 2, w, d, 3)), thin(s('circle', { cx: 0, cy: d * 0.06, r: Math.min(w, d) * 0.3 })), thin(s('circle', { cx: 0, cy: d * 0.06, r: Math.min(w, d) * 0.2 })), thin(s('line', { x1: -w / 2, y1: d / 2 - 8, x2: w / 2, y2: d / 2 - 8 })));
        break;
      case 'heizkoerper': {
        g.append(body(rect(-w / 2, -d / 2, w, d, 1)));
        for (let k = 1; k < 6; k++) g.append(thin(s('line', { x1: -w / 2 + (w * k) / 6, y1: -d / 2, x2: -w / 2 + (w * k) / 6, y2: d / 2 })));
        break;
      }
      default:
        g.append(body(rect(-w / 2, -d / 2, w, d, 2)), thin(s('line', { x1: -w / 2, y1: -d / 2, x2: w / 2, y2: d / 2 })), thin(s('line', { x1: w / 2, y1: -d / 2, x2: -w / 2, y2: d / 2 })));
    }
    // Vorderseite markieren
    const tri = s('path', { d: `M${-4 * px * 1.2} ${d / 2 - 1}L0 ${d / 2 + 6 * px * 1.2}L${4 * px * 1.2} ${d / 2 - 1}`, class: 'fx-front' });
    tri.style.strokeWidth = 1.3 * px;
    g.append(tri);
    if (f.w * this.view.scale > 54 && f.type !== 'heizkoerper') {
      const t = s('text', { x: 0, y: 0, class: 'fx-label', 'font-size': 10.5 * px, 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(${-(f.rot || 0)})`, 'pointer-events': 'none' }, SHORT[f.type] || '');
      t.setAttribute('dy', String(d * 0.34 * (f.type === 'wc' ? 0.0 : 0)));
      if (f.type !== 'dusche' && f.type !== 'badewanne') t.setAttribute('y', String(f.type === 'waschtisch' ? d * 0.38 : f.type === 'waschmaschine' ? -d * 0.36 : 0));
      if (f.type === 'badewanne' || f.type === 'dusche') t.setAttribute('y', String(f.type === 'dusche' ? d * 0.36 : 0));
      g.append(t);
    }
    return g;
  }

  // ------------------------------------------------------------- Eingaben
  bind() {
    const svg = this.svg;
    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.move(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.up(e));
    svg.addEventListener('dblclick', (e) => this.dbl(e));
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      this.zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    svg.addEventListener('keydown', (e) => this.key(e));
    svg.addEventListener('click', (e) => {
      const el = e.target.closest?.('[data-kind="dim"]');
      if (el && !this.moved) this.editDim(parseInt(el.dataset.i, 10), el);
    });
    svg.addEventListener('keydown', (e) => {
      const el = e.target.closest?.('[data-kind="dim"]');
      if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.editDim(parseInt(el.dataset.i, 10), el); }
    });
  }

  down(e) {
    this.moved = false;
    this.svg.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { this.drag = { type: 'pinch', ...this.pinchState() }; return; }
    const el = e.target.closest?.('[data-kind]');
    const kind = el?.dataset.kind;
    const p = this.toWorld(e);
    this.start = { cx: e.clientX, cy: e.clientY };
    if (kind === 'vertex') this.drag = { type: 'vertex', i: parseInt(el.dataset.i, 10) };
    else if (kind === 'mid') {
      const i = parseInt(el.dataset.i, 10);
      const W = wallInfo(S.room)[i];
      insertVertex(i, { x: (W.a.x + W.b.x) / 2, y: (W.a.y + W.b.y) / 2 });
      this.drag = { type: 'vertex', i: i + 1, fresh: true };
    } else if (kind === 'opening') {
      selectItem({ type: 'opening', id: el.dataset.id });
      this.drag = { type: 'opening', id: el.dataset.id };
    } else if (kind === 'ohandle') this.drag = { type: 'ohandle', id: el.dataset.id, end: el.dataset.end };
    else if (kind === 'fixture') {
      selectItem({ type: 'fixture', id: el.dataset.id });
      const f = S.room.fixtures.find((q) => q.id === el.dataset.id);
      this.drag = { type: 'fixture', id: el.dataset.id, dx: p.x - f.x, dy: p.y - f.y };
    } else if (kind === 'frot') this.drag = { type: 'frot', id: el.dataset.id };
    else if (kind === 'dim') this.drag = null;
    else {
      if (S.item) selectItem(null);
      this.drag = { type: 'pan', x: e.clientX, y: e.clientY, x0: this.view.x0, y0: this.view.y0 };
      this.svg.classList.add('panning');
    }
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  move(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag;
    if (!d) return;
    if (this.start && Math.hypot(e.clientX - this.start.cx, e.clientY - this.start.cy) > 3) this.moved = true;
    if (d.type === 'pinch' && this.pointers.size >= 2) {
      const st = this.pinchState();
      const r = this.svg.getBoundingClientRect();
      this.zoomBy(st.d / d.d, st.cx - r.left, st.cy - r.top);
      this.view.x0 -= (st.cx - d.cx) / this.view.scale;
      this.view.y0 -= (st.cy - d.cy) / this.view.scale;
      d.d = st.d; d.cx = st.cx; d.cy = st.cy;
      return;
    }
    if (!this.moved) return;
    const p = this.toWorld(e);
    const snap = (v, g = 5) => (e.altKey ? v : Math.round(v / g) * g);
    if (d.type === 'pan') {
      this.view.x0 = d.x0 - (e.clientX - d.x) / this.view.scale;
      this.view.y0 = d.y0 - (e.clientY - d.y) / this.view.scale;
      this.userZoomed = true;
      this.render();
    } else if (d.type === 'vertex') {
      updateRoom((r) => {
        const P = r.polygon, n = P.length;
        let x = snap(p.x), y = snap(p.y);
        if (!e.altKey) {
          for (const q of [P[(d.i - 1 + n) % n], P[(d.i + 1) % n]]) {
            if (Math.abs(q.x - p.x) < 7 / this.view.scale * 1.2) x = q.x;
            if (Math.abs(q.y - p.y) < 7 / this.view.scale * 1.2) y = q.y;
          }
        }
        P[d.i] = { x, y };
      }, { live: true });
      d.changed = true;
    } else if (d.type === 'opening') {
      updateRoom((r) => {
        const W = wallInfo(r);
        const o = r.openings.find((q) => q.id === d.id);
        let best = null;
        for (const w of W) {
          const t = (p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy;
          const tc = clamp(t, 0, w.len);
          const dd = Math.hypot(p.x - (w.a.x + w.ux * tc), p.y - (w.a.y + w.uy * tc));
          if (!best || dd < best.dd) best = { w, t, dd };
        }
        if (best && best.dd < 60 / Math.max(this.view.scale, 0.5)) {
          o.wall = best.w.i;
          let off = best.t - o.width / 2;
          off = clamp(off, 0, Math.max(0, best.w.len - o.width));
          if (!e.altKey) { off = Math.round(off); if (off < 8) off = 0; if (best.w.len - o.width - off < 8) off = best.w.len - o.width; }
          o.offset = off;
        }
      }, { live: true });
      d.changed = true;
    } else if (d.type === 'ohandle') {
      updateRoom((r) => {
        const W = wallInfo(r);
        const o = r.openings.find((q) => q.id === d.id);
        const w = W[o.wall];
        const t = clamp((p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy, 0, w.len);
        if (d.end === 'a') {
          const end = o.offset + o.width;
          const ns = clamp(Math.round(t), 0, end - 30);
          o.width = end - ns; o.offset = ns;
        } else o.width = clamp(Math.round(t - o.offset), 30, w.len - o.offset);
      }, { live: true });
      d.changed = true;
    } else if (d.type === 'fixture') {
      updateRoom((r) => {
        const f = r.fixtures.find((q) => q.id === d.id);
        f.x = p.x - d.dx; f.y = p.y - d.dy;
        if (!e.altKey) Object.assign(f, snapFixture(r, f, 14));
        else { f.x = round(f.x, 0); f.y = round(f.y, 0); }
      }, { live: true });
      d.changed = true;
    } else if (d.type === 'frot') {
      updateRoom((r) => {
        const f = r.fixtures.find((q) => q.id === d.id);
        let a = (Math.atan2(-(p.x - f.x), p.y - f.y) * 180) / Math.PI;
        a = ((a % 360) + 360) % 360;
        if (!e.altKey) { const q = Math.round(a / 15) * 15; a = Math.abs(a - Math.round(a / 90) * 90) < 7 ? Math.round(a / 90) * 90 : q; }
        f.rot = ((a % 360) + 360) % 360;
      }, { live: true });
      d.changed = true;
    }
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    this.svg.classList.remove('panning');
    const d = this.drag;
    if (this.pointers.size < 2 && d?.type === 'pinch') this.drag = null;
    if (!d || d.type === 'pinch') return;
    if (d.changed || d.fresh) {
      updateRoom((r) => r);
      this.drag = null;
      return;
    }
    this.drag = null;
    if (d.type === 'vertex' || d.type === 'opening' || d.type === 'fixture') commit();
  }

  dbl(e) {
    const el = e.target.closest?.('[data-kind]');
    const kind = el?.dataset.kind;
    if (kind === 'vertex') { removeVertex(parseInt(el.dataset.i, 10)); return; }
    if (kind === 'wall') {
      const i = parseInt(el.dataset.i, 10);
      const p = this.toWorld(e);
      const w = wallInfo(S.room)[i];
      const t = clamp((p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy, 10, w.len - 10);
      insertVertex(i, { x: w.a.x + w.ux * t, y: w.a.y + w.uy * t });
      updateRoom((r) => r);
    }
  }

  key(e) {
    const it = S.item;
    if (!it) return;
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      updateRoom((r) => {
        if (it.type === 'opening') r.openings = r.openings.filter((o) => o.id !== it.id);
        else r.fixtures = r.fixtures.filter((f) => f.id !== it.id);
      });
      selectItem(null);
    } else if ((e.key === 'r' || e.key === 'R') && it.type === 'fixture') {
      updateRoom((r) => { const f = r.fixtures.find((q) => q.id === it.id); f.rot = (f.rot + 90) % 360; });
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0, dy = e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0;
      updateRoom((r) => {
        if (it.type === 'fixture') { const f = r.fixtures.find((q) => q.id === it.id); f.x += dx; f.y += dy; }
        else { const o = r.openings.find((q) => q.id === it.id); o.offset += dx || dy; }
      });
    }
  }

  editDim(i, node) {
    if (this.editing) return;
    this.editing = true;
    const W = wallInfo(S.room)[i];
    const r = node.getBoundingClientRect();
    const hr = this.host.getBoundingClientRect();
    const input = h('input', { class: 'ed-dim-input', type: 'text', inputmode: 'decimal', value: String(round(W.len, 1)).replace('.', ','), 'aria-label': `Länge der Wand ${i + 1} in Zentimetern` });
    input.style.left = `${r.left - hr.left + r.width / 2}px`;
    input.style.top = `${r.top - hr.top + r.height / 2}px`;
    this.host.append(input);
    input.focus();
    input.select();
    const done = (ok) => {
      if (!this.editing) return;
      this.editing = false;
      const raw = parseNum(input.value);
      input.remove();
      if (ok && raw != null && raw > 0) {
        const cm = raw <= 15 ? raw * 100 : raw; // „2,7“ heißt 2,70 m
        if (cm >= 30 && cm <= 3000) changeWallLength(i, cm);
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
    input.addEventListener('blur', () => done(true));
  }
}
