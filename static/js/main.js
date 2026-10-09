// Startpunkt: lädt Daten, baut Kopfzeile, Ansicht und Seitenleiste, verbindet alle Teile.
import { h, $, clear, toast } from './dom.js';
import { icon } from './icons.js';
import {
  S, on, setStatus, setCatalog, setStep, setViewMode, selectSurface, undo, redo, loadRoom, loadSaved, clearSaved,
} from './state.js';
import { roomWarnings, makeTemplates, wallLabels } from './room.js';
import { applyStyle, styleOf } from './design.js';
import { Scene3D } from './scene3d.js';
import { Editor2D } from './editor2d.js';
import * as api from './api.js';
import { initCapture } from './ui-capture.js';
import { initEdit } from './ui-edit.js';
import { initDesign } from './ui-design.js';
import { initResult } from './ui-result.js';
import { initChat } from './chat.js';
import { rememberProject } from './projects.js';

const STEPS = [
  { n: 1, t: 'Plan und Maße' },
  { n: 2, t: 'Raum prüfen' },
  { n: 3, t: 'Fliesen wählen' },
  { n: 4, t: 'Ergebnis' },
];

let scene, editor, designUI, captureUI, chatUI;
let light = 'tag';
let needsFrame = true;

const els = {
  welcome: $('#welcome'), workspace: $('#workspace'), host3d: $('#host3d'), host2d: $('#host2d'),
  viewbar: $('#viewbar'), stepper: $('#stepper'), top: $('#topActions'), foot: $('#panelFoot'),
  pEdit: $('#p-edit'), pDesign: $('#p-design'), pResult: $('#p-result'), scroll: $('#panelScroll'),
  status: $('#vpStatus'), pick: $('#vpPick'),
};

// ------------------------------------------------------------------ Kopfzeile
function renderStepper() {
  clear(els.stepper);
  STEPS.forEach((st) => {
    const locked = st.n > 1 && !S.room;
    const cls = [S.step === st.n ? 'on' : '', S.step > st.n ? 'done' : ''].join(' ').trim();
    els.stepper.append(h('button', {
      type: 'button', class: cls, disabled: locked, 'aria-current': S.step === st.n ? 'step' : false,
      title: locked ? 'Zuerst einen Raum laden oder eine Vorlage wählen' : st.t, onclick: () => go(st.n),
    }, h('span', { class: 'n' }, S.step > st.n ? icon('check', 13) : String(st.n)), h('span', { class: 't' }, st.t)));
  });
}

let hist = { canUndo: false, canRedo: false };
function renderTop() {
  clear(els.top);
  if (S.step >= 2) {
    els.top.append(
      h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Rückgängig', title: 'Rückgängig (Strg+Z)', disabled: !hist.canUndo, onclick: () => undo() }, icon('undo')),
      h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Wiederholen', title: 'Wiederholen (Strg+Umschalt+Z)', disabled: !hist.canRedo, onclick: () => redo() }, icon('redo')));
  }
  els.top.append(h('button', { class: 'btn ghost', type: 'button', onclick: showHelp }, icon('help'), h('span', { class: 't' }, 'Hilfe')));
}

function showHelp() {
  const host = $('#modalHost');
  const close = () => { clear(host); document.removeEventListener('keydown', esc); prev?.focus(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const prev = document.activeElement;
  document.addEventListener('keydown', esc);
  const ok = h('button', { class: 'btn primary', type: 'button', onclick: close }, 'Verstanden');
  host.append(h('div', { class: 'modal-back', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-h' },
      h('h2', { id: 'help-h' }, 'So geht es'),
      h('ol', null,
        h('li', null, h('b', null, 'Plan und Maße: '), 'Lade einen Grundriss oder ein Foto hoch, zeichne eine Skizze oder wähle eine Vorlage. Trage Länge und Breite ein, damit alles maßstäblich wird.'),
        h('li', null, h('b', null, 'Raum prüfen: '), 'Ziehe Ecken im Plan, tippe auf eine Zahl, um die Wandlänge einzugeben. Türen, Fenster und Möbel verschiebst du per Ziehen.'),
        h('li', null, h('b', null, 'Fliesen wählen: '), 'Tippe im 3D-Bild auf Boden oder Wand, wähle Fliese, Muster und Fuge. Oder sag dem Assistenten, was du möchtest.'),
        h('li', null, h('b', null, 'Ergebnis: '), 'Du bekommst Mengen mit Verschnitt, Kosten (Beispielpreise) und kannst Bild, Liste und Projekt speichern.')),
      h('p', null, h('b', null, 'Tasten: '), h('span', { class: 'kbd' }, 'Strg'), '+', h('span', { class: 'kbd' }, 'Z'), ' rückgängig · ', h('span', { class: 'kbd' }, 'R'), ' Möbel drehen · ', h('span', { class: 'kbd' }, 'Entf'), ' löschen · Pfeiltasten schieben'),
      h('p', { class: 'help' }, 'Dein Projekt wird automatisch im Browser gespeichert.'),
      h('div', { class: 'modal-foot' }, ok))));
  ok.focus();
}

// ------------------------------------------------------------------ Navigation
function go(step) {
  if (step > 1 && !S.room) return;
  if (step >= 3) {
    const err = roomWarnings(S.room).find((w) => w.level === 'error');
    if (err) { toast(err.text, 'error', 5200); step = 2; }
  }
  setStep(step);
}

function layout() {
  const st = S.step;
  document.body.dataset.step = st;
  els.welcome.hidden = st !== 1;
  els.workspace.hidden = st === 1;
  els.pEdit.hidden = st !== 2;
  els.pDesign.hidden = st !== 3;
  els.pResult.hidden = st !== 4;
  const show2d = st === 2 && S.viewMode === '2d';
  els.host2d.hidden = !show2d;
  els.host3d.hidden = show2d;
  const active3d = st >= 2 && !show2d;
  scene.setActive(active3d);
  if (active3d && needsFrame) { scene.goView('overview', { instant: true }); needsFrame = false; }
  if (show2d) requestAnimationFrame(() => editor.fit());
  els.scroll.scrollTop = 0;
  renderStepper(); renderTop(); renderViewbar(); renderFoot(); renderPick();
  if (st === 3) designUI.render();
}

function renderFoot() {
  clear(els.foot);
  const st = S.step;
  if (st === 2) {
    els.foot.append(
      h('button', { class: 'btn', type: 'button', onclick: () => go(1) }, icon('back'), 'Zurück'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => go(3) }, 'Weiter zu den Fliesen', icon('arrow')));
  } else if (st === 3) {
    els.foot.append(
      h('button', { class: 'btn', type: 'button', onclick: () => go(2) }, icon('back'), 'Raum ändern'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => go(4) }, 'Zum Ergebnis', icon('arrow')));
  } else if (st === 4) {
    els.foot.append(
      h('button', { class: 'btn', type: 'button', onclick: () => go(3) }, icon('back'), 'Fliesen ändern'),
      h('button', { class: 'btn', type: 'button', onclick: newProject }, icon('plus'), 'Neues Projekt'));
  }
}

function newProject() {
  if (!confirm('Neues Projekt starten? Dein aktuelles Projekt wird aus diesem Browser gelöscht. Speichere es vorher über „Projekt sichern“, wenn du es behalten willst.')) return;
  clearSaved();
  location.href = '/';
}

// ------------------------------------------------------------------ Ansichtsleiste
function renderViewbar() {
  const bar = els.viewbar;
  clear(bar);
  const st = S.step;
  if (st === 1) return;
  const btn = (label, ic, on_, fn, extra = {}) => h('button', { type: 'button', class: on_ ? 'on' : '', 'aria-pressed': on_, onclick: fn, ...extra }, icon(ic), h('span', { class: 't' }, label));

  if (st === 2) {
    bar.append(h('div', { class: 'vgroup', role: 'group', 'aria-label': 'Ansicht' },
      btn('Grundriss', 'plan', S.viewMode === '2d', () => { setViewMode('2d'); layout(); }),
      btn('3D-Vorschau', 'cube', S.viewMode === '3d', () => { setViewMode('3d'); layout(); })));
  }
  if (S.viewMode === '3d') {
    const cur = scene.currentView || 'overview';
    const sel = h('select', { 'aria-label': 'Eine Wand ansehen', style: { border: 0, background: 'transparent', fontWeight: 600, fontSize: '13px', padding: '0 4px', minHeight: '34px' },
      onchange: (e) => { if (e.target.value) { scene.goView(e.target.value); renderViewbar(); } } },
    h('option', { value: '' }, 'Wand …'),
    ...wallLabels(S.room).map((l, i) => h('option', { value: `wall:${i}`, selected: cur === `wall:${i}` }, l)));
    bar.append(
      h('div', { class: 'vgroup', role: 'group', 'aria-label': 'Kamera' },
        btn('Übersicht', 'cube', cur === 'overview', () => { scene.goView('overview'); renderViewbar(); }),
        btn('Von oben', 'plan', cur === 'top', () => { scene.goView('top'); renderViewbar(); }),
        btn('Hineinschauen', 'door', cur === 'enter', () => { scene.goView('enter'); renderViewbar(); }),
        sel),
      h('div', { class: 'vgroup', role: 'group', 'aria-label': 'Licht' },
        btn('Tag', 'sun', light === 'tag', () => setLight('tag')),
        btn('Abend', 'moon', light === 'abend', () => setLight('abend'))));
  }
}

function setLight(m) { light = m; scene.setLight(m); renderViewbar(); }

function renderPick() {
  const show = S.step === 3 && S.viewMode === '3d' && S.room;
  els.pick.hidden = !show;
  if (!show) return;
  const name = S.surface === 'floor' ? 'Boden' : wallLabels(S.room)[+S.surface.split(':')[1]];
  clear(els.pick);
  els.pick.append(h('span', null, 'Bearbeitest: ', h('b', null, name)), h('span', { style: { color: 'var(--muted)' } }, 'Im Bild tippen wechselt die Fläche'));
}

// ------------------------------------------------------------------ Start
async function boot() {
  let status = { llm: false, sdk: true }, catalog = null;
  try {
    [status, catalog] = await Promise.all([api.getStatus(), api.getCatalog()]);
  } catch (e) {
    toast(e.message || 'Der Server antwortet nicht.', 'error', 8000);
    if (!catalog) return;
  }
  setStatus(status);
  setCatalog(catalog);

  scene = new Scene3D(els.host3d, {
    onPick: (id) => {
      if (S.step !== 3) return;
      designUI.setSingle(id);
      scene.pulse(id);
    },
    onBusy: (b) => { els.status.hidden = !b; },
  });
  scene.setCatalog(catalog);
  editor = new Editor2D(els.host2d);
  window.__app = { scene, S }; // zum Testen

  initEdit(els.pEdit);
  designUI = initDesign(els.pDesign, { scene });
  initResult(els.pResult, { scene });
  chatUI = initChat($('#chatHost'), { scene });
  captureUI = initCapture(els.welcome, { onLoaded: () => {} });

  // Ereignisse
  on('room', (e) => {
    if (!S.room) return;
    if (e?.live) return;
    scene.design = S.design;
    if (e?.fresh) { needsFrame = true; scene.currentView = 'overview'; }
    scene.setRoom(S.room);
    if (e?.fresh && scene.active) { scene.goView('overview', { instant: true }); needsFrame = false; }
    renderViewbar();
  });
  on('design', (e) => {
    if (!S.design) return;
    if (scene.active) scene.setDesign(S.design, e?.surfaces || 'all');
    else { scene.design = S.design; scene.dirty = true; }
  });
  on('step', layout);
  on('viewMode', layout);
  on('surface', renderPick);
  on('history', (e) => { hist = e; renderTop(); });
  on('meta', () => {});

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  });

  layout();

  const sharedProject = location.pathname.match(/^\/p\/([A-Za-z0-9_-]{16,32})$/);
  if (sharedProject) {
    try {
      const project = await api.getProject(sharedProject[1]);
      rememberProject(project);
      loadRoom(project.room, {
        design: project.design,
        projectId: project.id,
        projectName: project.name,
        step: 4,
      });
    } catch (e) {
      toast(e.message || 'Der Projektlink ist ungültig oder abgelaufen.', 'error', 6000);
    }
    return;
  }

  // Zum schnellen Ausprobieren und für Tests: ?demo=bad-wanne&step=3&style=hotel
  const q = new URLSearchParams(location.search);
  if (q.get('demo')) {
    const tpl = makeTemplates().find((x) => x.id === q.get('demo'));
    if (tpl) {
      loadRoom(tpl.room, { step: Number(q.get('step')) || 3 });
      if (q.get('style')) {
        const st = styleOf(catalog, q.get('style'));
        if (st) { const d = S.design; applyStyle(d, st, S.room); scene.setDesign(d, 'all'); designUI.render(); }
      }
    }
  }
}

boot();
