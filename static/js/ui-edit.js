// Schritt 2: Raum prüfen und anpassen (Maße, Türen, Fenster, Ausstattung).
import { h, clear, toast, parseNum, fmt1, fmt2, clamp, uid } from './dom.js';
import { icon } from './icons.js';
import { S, on, updateRoom, selectItem, changeWallLength, selectedItem } from './state.js';
import {
  wallInfo, wallLabels, roomWarnings, polyBBox, polyArea, makeRect, makeLShape, newFixture, FIXTURES, DOOR_H,
} from './room.js';

const FIX_ORDER = ['badewanne', 'dusche', 'wc', 'waschtisch', 'waschmaschine', 'heizkoerper', 'schrank'];

function numInput({ value, min, max, step = 1, unit = 'cm', onCommit, label }) {
  const el = h('input', { class: 'num', type: 'text', inputmode: 'decimal', 'aria-label': label, value: fmt1(value).replace(/\./g, '') });
  el.dataset.val = String(value);
  const commit = () => {
    const v = parseNum(el.value);
    if (v == null) { el.value = fmt1(parseFloat(el.dataset.val)).replace(/\./g, ''); return; }
    const c = clamp(v, min, max);
    if (c !== v) toast(`Erlaubt sind ${fmt1(min)} bis ${fmt1(max)} ${unit}.`, 'info');
    if (Math.abs(c - parseFloat(el.dataset.val)) > 0.05) onCommit(c);
    el.value = fmt1(c).replace(/\./g, '');
  };
  el.addEventListener('change', commit);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = (parseNum(el.value) ?? parseFloat(el.dataset.val)) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
      el.value = fmt1(clamp(v, min, max)).replace(/\./g, '');
      commit();
    }
  });
  el.addEventListener('focus', () => el.select());
  return el;
}

export function initEdit(root) {
  const holder = h('div');
  root.append(holder);

  function sec(title, kid, sub) {
    return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, title), sub ? h('small', null, sub) : null), kid);
  }

  function render() {
    clear(holder);
    if (!S.room) return;
    const room = S.room;
    const W = wallInfo(room);
    const labels = wallLabels(room);
    const area = polyArea(room.polygon) / 10000;

    holder.append(h('h2', null, 'Stimmt der Raum?'),
      h('p', { class: 'intro' }, 'Ziehe Ecken im Plan, oder tippe die Maße rechts ein. Türen, Fenster und Möbel kannst du verschieben.'));

    // Hinweise der KI und Warnungen
    const notes = h('div', { class: 'warns', id: 'warns' });
    holder.append(notes);
    renderWarnings(notes);

    // Form
    const bb = polyBBox(room.polygon);
    const isRect = room.polygon.length === 4;
    holder.append(sec('Form', h('div', { class: 'shapes' },
      h('button', { class: 'chip' + (isRect ? ' on' : ''), type: 'button', onclick: () => {
        if (isRect) return;
        updateRoom((r) => { const q = makeRect(bb.w, bb.h, r.height); q.openings = r.openings.filter((o) => o.wall < 4); q.fixtures = r.fixtures; return q; });
        toast('Auf Rechteck gesetzt.', 'info');
      } }, 'Rechteck'),
      h('button', { class: 'chip' + (!isRect ? ' on' : ''), type: 'button', onclick: () => {
        updateRoom((r) => { const q = makeLShape(r); q.openings = r.openings.filter((o) => o.wall < 6); return q; });
        toast('L-Form angelegt. Zieh die Ecken, bis sie passt.', 'info');
      } }, 'L-Form'))));

    // Maße
    const rows = h('div', { class: 'list' });
    W.forEach((w) => {
      const inp = numInput({ value: w.len, min: 30, max: 3000, label: `Länge ${labels[w.i]}`, onCommit: (v) => changeWallLength(w.i, v) });
      inp.dataset.wall = w.i;
      rows.append(h('div', { class: 'row' }, h('div', { class: 'nm' }, labels[w.i]), inp, h('span', { class: 'lbl', style: { color: 'var(--muted)' } }, 'cm')));
    });
    const hInp = numInput({ value: room.height, min: 200, max: 500, label: 'Raumhöhe', onCommit: (v) => updateRoom((r) => { r.height = v; }) });
    hInp.dataset.height = '1';
    rows.append(h('div', { class: 'row' }, h('div', { class: 'nm' }, 'Raumhöhe'), hInp, h('span', { class: 'lbl', style: { color: 'var(--muted)' } }, 'cm')));
    holder.append(sec('Maße der Wände', rows, `${fmt2(area)} m² Boden`));

    // Türen & Fenster
    const oList = h('div', { class: 'list' });
    const doors = room.openings.filter((o) => o.type === 'door'), wins = room.openings.filter((o) => o.type === 'window');
    const nameOf = (o) => (o.type === 'door' ? `Tür ${doors.indexOf(o) + 1}` : `Fenster ${wins.indexOf(o) + 1}`);
    room.openings.forEach((o) => {
      const sel = S.item?.type === 'opening' && S.item.id === o.id;
      oList.append(h('div', { class: 'row' + (sel ? ' sel' : ''), tabindex: '0', role: 'button', 'aria-pressed': sel,
        onclick: () => selectItem(sel ? null : { type: 'opening', id: o.id }),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectItem(sel ? null : { type: 'opening', id: o.id }); } } },
      icon(o.type === 'door' ? 'door' : 'window', 22), h('div', { class: 'nm' }, nameOf(o), h('small', null, `${labels[o.wall]} · ${fmt1(o.width)} cm breit`))));
    });
    if (!room.openings.length) oList.append(h('p', { class: 'hint' }, 'Noch keine Tür und kein Fenster. Ohne Tür kannst du den Raum nicht betreten (Ansicht „Hineinschauen“).'));
    const addRow = h('div', { class: 'addgrid', style: { gridTemplateColumns: '1fr 1fr', marginTop: '10px' } },
      h('button', { class: 'addbtn', type: 'button', onclick: () => addOpening('door') }, icon('door'), 'Tür hinzufügen'),
      h('button', { class: 'addbtn', type: 'button', onclick: () => addOpening('window') }, icon('window'), 'Fenster hinzufügen'));
    const oc = selectedItem() && S.item.type === 'opening' ? openingEditor(selectedItem(), labels) : null;
    holder.append(sec('Türen und Fenster', h('div', null, oList, oc, addRow)));

    // Ausstattung
    const fList = h('div', { class: 'list' });
    room.fixtures.forEach((f) => {
      const sel = S.item?.type === 'fixture' && S.item.id === f.id;
      fList.append(h('div', { class: 'row' + (sel ? ' sel' : ''), tabindex: '0', role: 'button', 'aria-pressed': sel,
        onclick: () => selectItem(sel ? null : { type: 'fixture', id: f.id }),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectItem(sel ? null : { type: 'fixture', id: f.id }); } } },
      icon(`fx_${f.type}`, 22), h('div', { class: 'nm' }, FIXTURES[f.type]?.label || f.type, h('small', null, `${fmt1(f.w)} × ${fmt1(f.d)} cm`))));
    });
    const fe = selectedItem() && S.item.type === 'fixture' ? fixtureEditor(selectedItem()) : null;
    const add = h('div', { class: 'addgrid' });
    FIX_ORDER.forEach((t) => add.append(h('button', { class: 'addbtn', type: 'button', onclick: () => addFixture(t) }, icon(`fx_${t}`), FIXTURES[t].label)));
    holder.append(sec('Ausstattung', h('div', null, fList, fe, h('div', { style: { height: '10px' } }), add), 'Zählt nicht als Fliesenfläche am Boden'));
  }

  function renderWarnings(box) {
    clear(box);
    const m = S.meta;
    if (m?.summary) {
      const conf = Math.round((m.confidence ?? 0) * 100);
      box.append(h('div', { class: 'notice info' }, icon('wand'), h('div', null, h('b', null, m.kind === 'foto' ? 'Skizze aus deinem Foto: ' : 'So habe ich den Plan gelesen: '), m.summary,
        conf ? h('span', { style: { opacity: .75 } }, ` (Sicherheit ${conf} %)`) : null)));
    }
    (m?.warnings || []).forEach((w) => box.append(h('div', { class: 'notice warn' }, icon('alert'), w)));
    roomWarnings(S.room).forEach((w) => box.append(h('div', { class: 'notice ' + (w.level === 'error' ? 'err' : 'warn') }, icon('alert'), w.text)));
    box.hidden = !box.children.length;
  }

  function addOpening(type) {
    const room = S.room;
    const W = wallInfo(room).sort((a, b) => b.len - a.len);
    const width = type === 'door' ? 80 : 90;
    let placed = null;
    for (const w of W) {
      if (w.len < width + 20) continue;
      const taken = room.openings.filter((o) => o.wall === w.i).map((o) => [o.offset, o.offset + o.width]).sort((a, b) => a[0] - b[0]);
      let x = 10;
      for (const [a, b] of taken) { if (x + width + 10 <= a) break; x = Math.max(x, b + 10); }
      if (x + width + 10 <= w.len) { placed = { wall: w.i, offset: x }; break; }
    }
    if (!placed) { toast('Dafür ist keine Wand mehr frei. Verkleinere oder verschiebe eine Öffnung.', 'error'); return; }
    const o = { id: uid('o'), type, wall: placed.wall, offset: placed.offset, width, height: type === 'door' ? DOOR_H : 120, sill: type === 'door' ? 0 : 100, swing: type === 'door' ? 'aussen' : 'innen', hinge: 'rechts' };
    updateRoom((r) => { r.openings.push(o); });
    selectItem({ type: 'opening', id: o.id });
    toast(type === 'door' ? 'Tür hinzugefügt. Zieh sie im Plan an die richtige Stelle.' : 'Fenster hinzugefügt. Zieh es im Plan an die richtige Stelle.', 'ok');
  }

  function addFixture(type) {
    const f = newFixture(type, S.room);
    updateRoom((r) => { r.fixtures.push(f); });
    selectItem({ type: 'fixture', id: f.id });
  }

  function patchItem(kind, id, fn) {
    updateRoom((r) => { const list = kind === 'opening' ? r.openings : r.fixtures; const it = list.find((q) => q.id === id); if (it) fn(it, r); });
  }

  function openingEditor(o, labels) {
    const isDoor = o.type === 'door';
    const wlen = wallInfo(S.room)[o.wall].len;
    const body = h('div', { class: 'editor-card' },
      h('div', { class: 'r2' },
        h('div', { class: 'field' }, h('label', null, 'Breite (cm)'), numInput({ value: o.width, min: 40, max: Math.max(60, wlen - 10), label: 'Breite', onCommit: (v) => patchItem('opening', o.id, (q) => { q.width = v; }) })),
        isDoor
          ? h('div', { class: 'field' }, h('label', null, 'Höhe (cm)'), numInput({ value: o.height || DOOR_H, min: 180, max: S.room.height, label: 'Höhe', onCommit: (v) => patchItem('opening', o.id, (q) => { q.height = v; }) }))
          : h('div', { class: 'field' }, h('label', null, 'Höhe (cm)'), numInput({ value: o.height, min: 30, max: 220, label: 'Höhe', onCommit: (v) => patchItem('opening', o.id, (q) => { q.height = v; }) }))),
      !isDoor ? h('div', { class: 'r2' },
        h('div', { class: 'field' }, h('label', null, 'Brüstung (cm)'), numInput({ value: o.sill, min: 0, max: 200, label: 'Brüstungshöhe', onCommit: (v) => patchItem('opening', o.id, (q) => { q.sill = v; }) })),
        h('div', { class: 'help', style: { margin: 0, alignSelf: 'end' } }, 'Abstand vom Boden bis zur Fensterkante')) : null,
      isDoor ? h('div', { class: 'r2' },
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Aufschlag'), seg([['innen', 'nach innen'], ['aussen', 'nach außen']], o.swing, (v) => patchItem('opening', o.id, (q) => { q.swing = v; }))),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Angeln'), seg([['links', 'links'], ['rechts', 'rechts']], o.hinge, (v) => patchItem('opening', o.id, (q) => { q.hinge = v; })))) : null,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
        h('span', { class: 'help', style: { margin: 0 } }, `Sitzt in: ${labels[o.wall]}`),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { updateRoom((r) => { r.openings = r.openings.filter((q) => q.id !== o.id); }); selectItem(null); } }, icon('trash'), 'Entfernen')));
    return body;
  }

  function seg(opts, val, onPick) {
    return h('div', { class: 'seg' }, ...opts.map(([v, l]) => h('button', { type: 'button', class: v === val ? 'on' : '', onclick: () => onPick(v) }, l)));
  }

  function fixtureEditor(f) {
    return h('div', { class: 'editor-card' },
      h('div', { class: 'r2' },
        h('div', { class: 'field' }, h('label', null, 'Breite (cm)'), numInput({ value: f.w, min: 10, max: 300, label: 'Breite', onCommit: (v) => patchItem('fixture', f.id, (q) => { q.w = v; }) })),
        h('div', { class: 'field' }, h('label', null, 'Tiefe (cm)'), numInput({ value: f.d, min: 5, max: 300, label: 'Tiefe', onCommit: (v) => patchItem('fixture', f.id, (q) => { q.d = v; }) }))),
      f.type === 'dusche' ? h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Glaswand'), seg([['left', 'links'], ['right', 'rechts'], ['both', 'beidseitig'], ['none', 'keine']], f.opt?.glass || 'right', (v) => patchItem('fixture', f.id, (q) => { q.opt = { ...(q.opt || {}), glass: v }; }))) : null,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
        h('button', { class: 'btn small', type: 'button', onclick: () => patchItem('fixture', f.id, (q) => { q.rot = ((q.rot || 0) + 90) % 360; }) }, icon('rotate'), 'Drehen'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { updateRoom((r) => { r.fixtures = r.fixtures.filter((q) => q.id !== f.id); }); selectItem(null); } }, icon('trash'), 'Entfernen')),
      h('p', { class: 'help', style: { margin: 0 } }, 'Im Plan ziehen zum Verschieben. Der kleine Pfeil zeigt die Vorderseite.'));
  }

  // Werte beim Ziehen im Plan aktuell halten, ohne alles neu zu bauen
  function syncLive() {
    if (!S.room) return;
    const W = wallInfo(S.room);
    holder.querySelectorAll('input[data-wall]').forEach((el) => {
      if (document.activeElement === el) return;
      const w = W[+el.dataset.wall];
      if (!w) return;
      el.value = fmt1(w.len).replace(/\./g, ''); el.dataset.val = String(w.len);
    });
    renderWarnings($('#warns', holder));
  }
  const $ = (sel, r) => r.querySelector(sel);

  on('room', (e) => { if (e?.live) syncLive(); else render(); });
  on('item', render);
  on('meta', () => { const b = $('#warns', holder); if (b) renderWarnings(b); });
  return { render };
}
