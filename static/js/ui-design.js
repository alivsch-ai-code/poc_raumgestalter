// Schritt 3: Fliesen, Muster, Fugen, Farben.
import { h, clear, toast, fmt0, fmt1, fmtEur, rafThrottle, clamp } from './dom.js';
import { icon } from './icons.js';
import { S, on, updateDesign, selectSurface, commit } from './state.js';
import { wallLabels } from './room.js';
import {
  floorId, wallId, isWall, wallIndex, tileOf, groutOf, paintOf, patternOf, getSurface, applyOps, layoutHints, optimizeSurface, placedTileSize,
} from './design.js';
import { renderSwatch, renderPatternIcon } from './tilegen.js';

const LOOKS = [
  ['alle', 'Alle'], ['uni', 'Uni'], ['marmor', 'Marmor'], ['beton', 'Beton'], ['holz', 'Holz'],
  ['terrazzo', 'Terrazzo'], ['zellige', 'Zellige'], ['travertin', 'Travertin'], ['schiefer', 'Schiefer'],
];
const HEIGHT_PRESETS = [['Raumhoch', null], ['2,10 m', 210], ['1,50 m', 150], ['1,20 m', 120], ['0,90 m', 90], ['Keine', 0]];

const PATTERN_NOTES = {
  grid: 'Klassisch, Fuge auf Fuge. Wirkt ruhig und modern.',
  half: 'Jede Reihe halb versetzt wie ein Ziegelverband. Verzeiht kleine Ungenauigkeiten.',
  third: 'Jede Reihe um ein Drittel versetzt. Wichtig bei langen Formaten, weil Kanten sonst durchbiegen.',
  diagonal: 'Auf Eck verlegt. Lässt kleine Räume größer wirken, braucht aber mehr Zuschnitt.',
  herring90: 'Fischgrät mit rechten Winkeln. Sehr edel, vor allem mit Holzoptik.',
  herring45: 'Fischgrät mit Spitzen, die zu den Rändern zeigen. Aufwendig und teuer im Zuschnitt.',
  basket: 'Zwei Fliesen bilden ein Quadrat, abwechselnd quer und längs. Wie ein Flechtmuster.',
};

export function initDesign(root, { scene }) {
  const holder = h('div');
  root.append(holder);
  let allWalls = false;
  let look = 'alle';
  let suppress = false;
  const swatchCache = new Map();

  // Muster- und Fliesenbilder gestaffelt zeichnen, damit nichts ruckelt
  const paintQueue = [];
  let painting = false;
  function enqueuePaint(fn) {
    paintQueue.push(fn);
    if (painting) return;
    painting = true;
    const step = () => {
      const t0 = performance.now();
      while (paintQueue.length && performance.now() - t0 < 14) { try { paintQueue.shift()(); } catch (e) { console.warn(e); } }
      if (paintQueue.length) setTimeout(step, 0); else painting = false;
    };
    setTimeout(step, 0);
  }
  function swatchCanvas(tile) {
    const c = document.createElement('canvas');
    c.width = c.height = 112;
    const cached = swatchCache.get(tile.id);
    if (cached) c.getContext('2d').drawImage(cached, 0, 0);
    else enqueuePaint(() => {
      const src = renderSwatch(tile, 112, '#cfcfcb', 3);
      swatchCache.set(tile.id, src);
      c.getContext('2d').drawImage(src, 0, 0, 112, 112);
    });
    return c;
  }

  // ---------------------------------------------------------- Bereich / Auswahl
  const scopeIds = () => {
    if (S.surface === floorId) return [floorId];
    if (allWalls) return S.room.polygon.map((_, i) => wallId(i));
    return [S.surface];
  };
  const curSpec = () => (S.surface === floorId ? S.design.floor : getSurface(S.design, allWalls ? wallId(0) : S.surface));
  const isFloor = () => S.surface === floorId;

  function opFor(patch) {
    if (isFloor()) return { target: 'floor', ...patch };
    if (allWalls) return { target: 'all_walls', ...patch };
    return { target: 'wall', wall_index: wallIndex(S.surface), ...patch };
  }
  function change(patch, { live = false } = {}) {
    const ids = (patch.paint || patch.trim) ? S.room.polygon.map((_, i) => wallId(i)) : scopeIds();
    if (live) {
      suppress = true;
      updateDesign((d) => { applyOps(d, [opFor(patch)], S.room, S.catalog); }, { surfaces: ids, commitNow: false });
      suppress = false;
    } else updateDesign((d) => { applyOps(d, [opFor(patch)], S.room, S.catalog); }, { surfaces: ids });
  }

  // ---------------------------------------------------------- Aufbau
  function render() {
    if (!S.room || !S.design || !S.catalog) return;
    const sc = holder.parentElement?.parentElement; // .panel-scroll
    const top = sc ? sc.scrollTop : 0;
    clear(holder);
    const cat = S.catalog;
    const labels = wallLabels(S.room);
    const spec = curSpec();
    const floor = isFloor();
    const tile = tileOf(cat, spec.tile);
    const title = floor ? 'Boden' : allWalls ? 'Alle Wände' : labels[wallIndex(S.surface)];

    holder.append(h('h2', null, 'Fliesen wählen'),
      h('p', { class: 'intro' }, 'Wähle eine Fläche und probiere aus. Du kannst auch direkt im 3D-Bild auf Boden oder Wand tippen.'));

    // Stile
    const styles = h('div', { class: 'styles', style: { display: 'flex', overflowX: 'auto', gap: '10px', paddingBottom: '6px', margin: '0 -2px', scrollSnapType: 'x proximity' } });
    cat.styles.forEach((st) => {
      const ft = tileOf(cat, st.floor.tile), wt = tileOf(cat, st.walls.tile);
      const c1 = swatchCanvas(ft), c2 = swatchCanvas(wt);
      styles.append(h('button', { class: 'style', type: 'button', style: { flex: '0 0 148px', scrollSnapAlign: 'start' }, onclick: () => {
        updateDesign((d) => { applyOps(d, [{ target: 'everything', style_id: st.id }], S.room, cat); });
        scene.pulse('walls'); scene.pulse(floorId);
        toast(`Stil „${st.name}“ angewendet.`, 'ok');
      } }, h('div', { class: 'st-top' }, c1, c2), h('div', { class: 'st-b' }, h('b', null, st.name), h('small', null, st.blurb))));
    });
    holder.append(sectionEl('Schnellstart: ganzer Look', styles, 'Ein Klick, dann feinjustieren'));

    // Fläche
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Fläche wählen' });
    const chip = (label, on_, fn) => h('button', { class: 'chip' + (on_ ? ' on' : ''), type: 'button', 'aria-pressed': on_, onclick: fn }, label);
    chips.append(chip('Boden', floor, () => pick(floorId)));
    chips.append(chip('Alle Wände', !floor && allWalls, () => { allWalls = true; if (floor) S.surface = wallId(0); selectSurface(S.surface); scene.pulse('walls'); }));
    S.room.polygon.forEach((_, i) => chips.append(chip(labels[i], !floor && !allWalls && S.surface === wallId(i), () => pick(wallId(i)))));
    holder.append(sectionEl('Welche Fläche?', chips, 'Einzelne Wand für Akzente'));

    // Fliese
    const filter = h('div', { class: 'filters', role: 'group', 'aria-label': 'Nach Look filtern' });
    LOOKS.forEach(([k, n]) => filter.append(h('button', { class: 'chip' + (look === k ? ' on' : ''), type: 'button', onclick: () => { look = k; render(); } }, n)));
    const need = floor ? 'boden' : 'wand';
    const list = cat.tiles.filter((t) => (t.use === need || t.use === 'beide') && (look === 'alle' || t.look === look));
    const grid = h('div', { class: 'tiles' });
    list.forEach((t) => {
      const on_ = t.id === spec.tile;
      grid.append(h('button', { class: 'tile' + (on_ ? ' on' : ''), type: 'button', 'aria-pressed': on_, 'aria-label': `${t.name}, ${t.size[0]} mal ${t.size[1]} Zentimeter`, onclick: () => { change({ tile_id: t.id }); scene.pulse(scopeIds()[0] === floorId ? floorId : 'walls'); } },
        swatchCanvas(t), h('span', { class: 'chk' }, icon('check')),
        h('span', { class: 'tm' }, h('b', null, t.name), h('small', null, `${fmt0(t.size[0])}×${fmt0(t.size[1])} cm`))));
    });
    if (!list.length) grid.append(h('p', { class: 'hint' }, 'In dieser Kategorie gibt es keine passende Fliese.'));
    const info = tile && h('div', { class: 'tinfo' },
      h('span', null, 'Serie'), h('b', null, tile.series),
      h('span', null, 'Format'), h('b', null, `${fmt0(tile.size[0])} × ${fmt0(tile.size[1])} cm, ${fmt0(tile.thickness)} mm`),
      h('span', null, 'Oberfläche'), h('b', null, { glanz: 'glänzend', matt: 'matt', seidenmatt: 'seidenmatt' }[tile.finish] || tile.finish),
      h('span', null, 'Preis (Beispiel)'), h('b', null, `${fmtEur(tile.priceM2)} / m²`),
      tile.rectified ? h('span', null, 'Kante') : null, tile.rectified ? h('b', null, 'rektifiziert (enge Fuge möglich)') : null);
    const rotate = tile && tile.size[0] !== tile.size[1] && h('label', { class: 'row', style: { marginTop: '10px', cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked: !!spec.rotated, style: { width: '18px', height: '18px', accentColor: 'var(--accent)' }, onchange: (e) => change({ rotated: e.target.checked }) }),
      h('span', { class: 'nm' }, 'Fliesen drehen', h('small', null, floor ? 'Lange Seite quer statt längs' : 'Hochkant statt quer')));
    holder.append(sectionEl(`Fliese für ${title}`, h('div', null, filter, grid, info, rotate), `${list.length} zur Auswahl`));

    // Muster
    const pats = h('div', { class: 'pats' });
    cat.patterns.forEach((p) => {
      const c = document.createElement('canvas'); c.width = c.height = 62;
      enqueuePaint(() => { c.getContext('2d').drawImage(renderPatternIcon(p.id, 62), 0, 0); });
      pats.append(h('button', { class: 'pat' + (spec.pattern === p.id ? ' on' : ''), type: 'button', 'aria-pressed': spec.pattern === p.id, title: p.hint, onclick: () => change({ pattern: p.id }) },
        c, h('span', null, p.name)));
    });
    const pat = patternOf(cat, spec.pattern);
    holder.append(sectionEl('Verlegemuster', h('div', null, pats, h('p', { class: 'hint' }, PATTERN_NOTES[pat.id] || pat.hint, ` Verschnitt ca. ${Math.round(pat.waste * 100)} %.`))));

    // Fuge
    const g = groutOf(cat, spec.grout);
    const out = h('output', null, `${fmt1(spec.groutMm)} mm`);
    const sl = h('input', { class: 'slider', type: 'range', min: 1, max: 10, step: 1, value: spec.groutMm, 'aria-label': 'Fugenbreite in Millimetern',
      oninput: (e) => { out.textContent = `${e.target.value} mm`; change({ grout_mm: +e.target.value }, { live: true }); },
      onchange: () => { commit(); } });
    const sw = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Fugenfarbe' });
    const swName = h('div', { class: 'sw-name' }, g.name);
    cat.grouts.forEach((c) => sw.append(h('button', { class: 'sw' + (c.id === spec.grout ? ' on' : ''), type: 'button', style: { background: c.color }, title: c.name, 'aria-label': c.name, 'aria-pressed': c.id === spec.grout, onclick: () => change({ grout: c.id }) })));
    holder.append(sectionEl('Fuge', h('div', null,
      h('div', { class: 'range' }, sl, out),
      h('p', { class: 'hint', style: { marginTop: '2px' } }, 'Schmal (2 mm) wirkt ruhig und edel, breit (5 mm+) betont das Raster und ist robuster.'),
      h('div', { style: { height: '12px' } }), sw, swName)));

    // Höhe (nur Wände)
    if (!floor) {
      const H = S.room.height;
      const hv = spec.height ?? H;
      const o2 = h('output', null, hv <= 0 ? 'keine' : hv >= H ? 'raumhoch' : `${fmt0(hv)} cm`);
      const hs = h('input', { class: 'slider', type: 'range', min: 0, max: H, step: 5, value: hv, 'aria-label': 'Höhe der Fliesen in Zentimetern',
        oninput: rafThrottle((e) => { const v = +e.target.value; o2.textContent = v <= 0 ? 'keine' : v >= H ? 'raumhoch' : `${fmt0(v)} cm`; change({ tile_height_cm: v }, { live: true }); }),
        onchange: () => commit() });
      const pre = h('div', { class: 'chips', style: { marginTop: '10px' } });
      HEIGHT_PRESETS.forEach(([n, v]) => {
        const val = v == null ? H : Math.min(v, H);
        pre.append(h('button', { class: 'chip' + (Math.abs(hv - val) < 1 ? ' on' : ''), type: 'button', onclick: () => change({ tile_height_cm: val }) }, n));
      });
      holder.append(sectionEl('Wie hoch gefliest?', h('div', null, h('div', { class: 'range' }, hs, o2), pre), 'Darüber wird gestrichen'));

      // Wandfarbe und Leiste
      const ps = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Wandfarbe' });
      const pc = paintOf(cat, S.design.paint);
      cat.paints.forEach((c) => ps.append(h('button', { class: 'sw' + (c.id === S.design.paint ? ' on' : ''), type: 'button', style: { background: c.color }, title: c.name, 'aria-label': c.name, 'aria-pressed': c.id === S.design.paint, onclick: () => change({ target: 'everything', paint: c.id }) })));
      const tr = h('div', { class: 'chips', style: { marginTop: '14px' } });
      cat.trims.forEach((t) => tr.append(h('button', { class: 'chip' + (S.design.trim === t.id ? ' on' : ''), type: 'button', onclick: () => change({ trim: t.id }) }, t.color ? h('span', { class: 'dot', style: { background: t.color } }) : null, t.name)));
      holder.append(sectionEl('Wandfarbe über den Fliesen', h('div', null, ps, h('div', { class: 'sw-name' }, pc.name),
        h('div', { class: 'lbl', style: { marginTop: '14px' } }, 'Abschlussleiste'), tr), 'Gilt für alle Wände'));
    }

    // Tipps
    const hints = layoutHints(S.room, S.design, cat);
    if (hints.length) {
      const box = h('div', { class: 'hintbox' });
      hints.slice(0, 4).forEach((x) => box.append(h('div', { class: 'hintrow' }, icon('alert', 18), h('span', null, x.text),
        x.fix ? h('button', { class: 'btn small', type: 'button', onclick: () => {
          updateDesign((d) => { const s = getSurface(d, x.id); s.offset = { ...s.offset, ...x.fix }; }, { surfaces: [x.id] });
          toast('Startpunkt verschoben. Die Randstücke sind jetzt breiter.', 'ok');
        } }, 'Beheben') : null)));
      holder.append(sectionEl('Tipps zur Verlegung', box));
    }
    holder.append(h('div', { class: 'sec' }, h('button', { class: 'btn', type: 'button', style: { width: '100%' }, onclick: () => {
      updateDesign((d) => { scopeIds().forEach((id) => optimizeSurface(d, id, S.room, cat)); }, { surfaces: scopeIds() });
      toast('Verlegung optimiert: möglichst breite Randstücke.', 'ok');
    } }, icon('wand'), `Verlegung für ${title} optimieren`),
    h('p', { class: 'hint' }, 'Verschiebt den Startpunkt, damit an den Rändern keine schmalen Streifen entstehen.')));

    if (sc) sc.scrollTop = top;
  }

  function sectionEl(title, body, sub) {
    return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, title), sub ? h('small', null, sub) : null), body);
  }

  function pick(id) {
    allWalls = false;
    selectSurface(id);
    scene.pulse(id);
  }

  on('surface', () => {
    render();
  });
  on('design', () => { if (!suppress) render(); });
  on('room', (e) => { if (!e?.live) render(); });
  on('catalog', () => render());
  return {
    render,
    setSingle(id) { allWalls = false; selectSurface(id); },
  };
}
