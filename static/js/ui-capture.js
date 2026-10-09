// Schritt 1: Plan, Foto oder Skizze + Maße → Raum. Dazu Vorlagen und letztes Projekt.
import { h, s, $, clear, toast, parseNum, readFileAsDataURL, downscaleImage, fmt2 } from './dom.js';
import { icon } from './icons.js';
import { S, on, loadRoom, loadSaved, importProject } from './state.js';
import { makeTemplates, makeRect, wallInfo, polyBBox, DOOR_H } from './room.js';
import { recentProjects, rememberProject, forgetProject } from './projects.js';
import * as api from './api.js';

const SCAN_MSGS = [
  'Ich schaue mir den Plan an …',
  'Wände und Ecken werden erkannt …',
  'Türen und Fenster werden gesucht …',
  'Bad-Ausstattung wird zugeordnet …',
  'Gleich fertig. Ich rechne deine Maße ein …',
];

export function initCapture(root, { onLoaded }) {
  const st = {
    tab: 'upload', // upload | sketch
    kind: 'plan', // plan | foto
    unit: 'm',
    image: null, // { dataUrl, width, height, name }
    busy: false,
  };

  // ---------------------------------------------------------- Eingabefelder
  const inpL = h('input', { id: 'dimL', inputmode: 'decimal', placeholder: '2,70', 'aria-describedby': 'dimHelp' });
  const inpW = h('input', { id: 'dimW', inputmode: 'decimal', placeholder: '2,10', 'aria-describedby': 'dimHelp' });
  const inpH = h('input', { id: 'dimH', inputmode: 'decimal', placeholder: '2,50' });
  const unitLbl = [h('span', null, 'm'), h('span', null, 'm'), h('span', null, 'm')];
  const field = (label, inp, u) => h('div', { class: 'field' }, h('label', { for: inp.id }, label), h('div', { class: 'inp' }, inp, u));
  const dimsBox = h('div', { class: 'dims' }, field('Länge', inpL, unitLbl[0]), field('Breite', inpW, unitLbl[1]), field('Raumhöhe', inpH, unitLbl[2]));
  const unitSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Einheit' });
  const setUnit = (u) => {
    st.unit = u;
    unitLbl.forEach((l) => { l.textContent = u; });
    inpL.placeholder = u === 'm' ? '2,70' : '270';
    inpW.placeholder = u === 'm' ? '2,10' : '210';
    inpH.placeholder = u === 'm' ? '2,50' : '250';
    [...unitSeg.children].forEach((b) => b.classList.toggle('on', b.dataset.u === u));
  };
  ['m', 'cm'].forEach((u) => unitSeg.append(h('button', { type: 'button', dataset: { u }, onclick: () => setUnit(u) }, u)));

  const readDims = () => {
    const f = st.unit === 'm' ? 100 : 1;
    const conv = (v) => { const n = parseNum(v); return n == null ? null : n * f; };
    return { length: conv(inpL.value), width: conv(inpW.value), height: conv(inpH.value) };
  };

  // ---------------------------------------------------------- Bild hochladen
  const dropHost = h('div');
  const fileInput = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Plan oder Foto auswählen', onchange: () => takeFile(fileInput.files[0]) });
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: () => takeFile(camInput.files[0]) });

  async function takeFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Bitte wähle ein Bild (JPG, PNG, WebP).', 'error'); return; }
    try {
      const raw = await readFileAsDataURL(file);
      const img = await downscaleImage(raw, 1600, 0.88);
      st.image = { ...img, name: file.name };
      renderDrop();
      updateCta();
    } catch (e) { toast(e.message, 'error'); }
  }

  function renderDrop() {
    clear(dropHost);
    if (st.image) {
      dropHost.append(h('div', { class: 'drop has' },
        h('img', { src: st.image.dataUrl, alt: 'Dein hochgeladener Plan oder dein Foto' }),
        h('button', { class: 'btn small change', type: 'button', onclick: () => { st.image = null; fileInput.value = ''; renderDrop(); updateCta(); } }, icon('x'), 'Anderes Bild')));
      return;
    }
    const d = h('div', { class: 'drop', id: 'drop' },
      h('div', null,
        icon('upload', 48), h('strong', null, 'Plan oder Foto hierher ziehen'),
        h('small', null, 'oder klicken zum Auswählen. JPG, PNG oder WebP.')),
      fileInput);
    d.firstChild.firstChild.setAttribute('class', 'ico');
    ['dragenter', 'dragover'].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); d.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); d.classList.remove('over'); }));
    d.addEventListener('drop', (e) => takeFile(e.dataTransfer?.files?.[0]));
    dropHost.append(d);
  }

  // ---------------------------------------------------------- Skizze
  const pad = makePad(() => { st.image = null; updateCta(); });

  // ---------------------------------------------------------- Aktionsleiste
  const analyzeBtn = h('button', { class: 'btn primary big', type: 'button', onclick: () => runAnalyze() }, icon('wand'), 'Raum erkennen lassen');
  const rectBtn = h('button', { class: 'btn big', type: 'button', onclick: () => fromDims() }, 'Nur mit Maßen starten');
  const note = h('p', { class: 'note' });
  const statusBox = h('div', { class: 'demo-note' });

  function updateCta() {
    const has = st.tab === 'sketch' ? pad.hasInk() : !!st.image;
    analyzeBtn.disabled = !has;
    note.textContent = has
      ? (S.status.llm ? 'Die KI liest den Plan. Du kannst alles danach korrigieren.' : 'Die KI ist noch nicht verbunden (siehe Hinweis oben).')
      : 'Lade zuerst ein Bild hoch oder zeichne eine Skizze. Oder wähle rechts eine Vorlage.';
  }

  function renderStatus() {
    clear(statusBox);
    if (S.status.llm) return;
    const why = !S.status.sdk
      ? 'Das Python-Paket „anthropic“ ist nicht installiert.'
      : 'Es ist noch kein API-Key in der Datei .env eingetragen.';
    statusBox.append(h('div', { class: 'notice info' }, icon('info'),
      h('div', null, h('b', null, 'Demo-Modus. '), `${why} Vorlagen, 3D, Fliesen und Mengen funktionieren trotzdem. Für das Erkennen von Plänen und den freien Chat trägst du den Key ein (siehe README).`)));
  }

  function currentImage() {
    if (st.tab === 'sketch') {
      const out = pad.export();
      return out && { ...out, name: 'skizze' };
    }
    return st.image;
  }

  async function runAnalyze() {
    if (st.busy) return;
    const img = currentImage();
    if (!img) { toast('Bitte zuerst ein Bild laden oder eine Skizze zeichnen.', 'error'); return; }
    const d = readDims();
    const dims = {};
    if (d.length && d.width) { dims.length = d.length; dims.width = d.width; }
    else if (d.length || d.width) { toast('Bitte beide Maße (Länge und Breite) angeben oder beide leer lassen.', 'error'); return; }
    if (d.height) dims.height = d.height;
    for (const k of ['length', 'width']) if (dims[k] != null && (dims[k] < 50 || dims[k] > 3000)) { toast('Die Maße sehen ungewöhnlich aus. Bitte in Meter oder Zentimeter prüfen.', 'error'); return; }
    dims.imgW = img.width; dims.imgH = img.height;

    st.busy = true;
    const overlay = scanOverlay(img.dataUrl);
    try {
      const res = await api.analyze({ image: img.dataUrl, kind: st.kind, dims, notes: '' });
      const under = res.room.underlay;
      delete res.room.underlay;
      overlay.close();
      loadRoom(res.room, {
        underlay: under ? { src: img.dataUrl, ...under } : null,
        meta: res.meta, step: 2,
      });
      onLoaded?.();
      toast('Raum erkannt. Bitte prüfe kurz die Maße.', 'ok');
    } catch (e) {
      overlay.close();
      if (e.code === 'no_key') {
        toast(e.message, 'error', 6000);
        S.status = { ...S.status, llm: false };
        renderStatus(); updateCta();
      } else toast(e.message || 'Das hat nicht geklappt.', 'error', 6000);
    } finally { st.busy = false; }
  }

  function fromDims() {
    const d = readDims();
    if (!d.length || !d.width) { toast('Trage Länge und Breite ein, dann lege ich den Raum an.', 'error'); (d.length ? inpW : inpL).focus(); return; }
    if (d.length < 50 || d.width < 50 || d.length > 3000 || d.width > 3000) { toast('Die Maße sehen ungewöhnlich aus. Bitte in Meter oder Zentimeter prüfen.', 'error'); return; }
    const H = d.height && d.height >= 180 && d.height <= 500 ? d.height : 250;
    const room = makeRect(d.length, d.width, H);
    const t = makeTemplates().find((x) => x.id === 'leer').room;
    room.openings = t.openings.map((o) => ({ ...o, offset: Math.min(o.offset, Math.max(0, (o.wall % 2 ? d.width : d.length) - o.width - 10)) }));
    loadRoom(room, { step: 2 });
    onLoaded?.();
  }

  // ---------------------------------------------------------- Vorlagen
  function thumb(room) {
    const bb = polyBBox(room.polygon);
    const pad = 14;
    const k = 100 / Math.max(bb.w, bb.h);
    const W = bb.w * k + pad * 2, H = bb.h * k + pad * 2;
    const P = room.polygon.map((p) => ({ x: p.x * k + pad, y: p.y * k + pad }));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-hidden': 'true' });
    svg.append(s('path', { d: `M${P.map((p) => `${p.x} ${p.y}`).join('L')}Z`, fill: '#f3efe6', stroke: '#33454c', 'stroke-width': 3.2, 'stroke-linejoin': 'round' }));
    const Wl = wallInfo({ polygon: P });
    for (const o of room.openings) {
      const w = Wl[o.wall];
      if (!w) continue;
      const a = o.offset * k, b = (o.offset + o.width) * k;
      svg.append(s('line', { x1: w.a.x + w.ux * a, y1: w.a.y + w.uy * a, x2: w.a.x + w.ux * b, y2: w.a.y + w.uy * b, stroke: o.type === 'door' ? '#d9825b' : '#5aa8c2', 'stroke-width': 4.5, 'stroke-linecap': 'butt' }));
    }
    for (const f of room.fixtures) {
      svg.append(s('rect', { x: -f.w * k / 2, y: -f.d * k / 2, width: f.w * k, height: f.d * k, rx: 1.5, fill: '#fff', stroke: '#8fa1a6', 'stroke-width': 1, transform: `translate(${f.x * k + pad} ${f.y * k + pad}) rotate(${f.rot || 0})` }));
    }
    return svg;
  }

  const tplGrid = h('div', { class: 'tpls' });
  makeTemplates().forEach((t) => {
    tplGrid.append(h('button', { class: 'tpl', type: 'button', onclick: () => { loadRoom(makeTemplates().find((x) => x.id === t.id).room, { step: 2 }); onLoaded?.(); } },
      thumb(t.room), h('div', null, h('b', null, t.name), h('small', null, t.desc))));
  });

  const sampleBtn = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    try {
      const r = await fetch('/static/samples/beispielplan.png');
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      setTab('upload');
      await takeFile(new File([blob], 'beispielplan.png', { type: 'image/png' }));
      if (!inpL.value) { setUnit('m'); inpL.value = '2,70'; inpW.value = '2,10'; inpH.value = '2,50'; }
      toast('Beispielplan geladen. Jetzt „Raum erkennen lassen“.', 'ok');
    } catch { toast('Der Beispielplan konnte nicht geladen werden.', 'error'); }
  } }, 'Beispielplan ausprobieren');

  // ---------------------------------------------------------- Tabs
  const tabBtns = {
    upload: h('button', { type: 'button', role: 'tab', onclick: () => setTab('upload') }, icon('upload'), 'Plan oder Foto'),
    sketch: h('button', { type: 'button', role: 'tab', onclick: () => setTab('sketch') }, icon('pencil'), 'Skizze zeichnen'),
  };
  const kindSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Art des Bildes' },
    h('button', { type: 'button', dataset: { k: 'plan' }, onclick: () => setKind('plan') }, 'Plan / Skizze'),
    h('button', { type: 'button', dataset: { k: 'foto' }, onclick: () => setKind('foto') }, 'Foto vom Raum'));
  const camBtn = h('button', { class: 'btn small', type: 'button', hidden: true, onclick: () => camInput.click() }, icon('camera'), 'Foto aufnehmen');
  const kindHint = h('p', { class: 'help kind-hint' });
  const kindRow = h('div', { class: 'kind' }, h('span', { class: 'lbl' }, 'Das Bild zeigt:'), kindSeg, camBtn);
  function setKind(k) {
    st.kind = k;
    [...kindSeg.children].forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    camBtn.hidden = k !== 'foto';
    kindHint.textContent = k === 'foto'
      ? 'Die KI rekonstruiert aus einem Raumfoto eine ungefähre Draufsicht. Maße und verdeckte Bereiche prüfst du danach im 2D-Editor.'
      : 'Lade einen Grundriss oder eine Skizze hoch. Die erkannten Wände und Maße kannst du danach prüfen.';
  }
  const sketchHost = h('div', null, pad.el);
  function setTab(t) {
    st.tab = t;
    Object.entries(tabBtns).forEach(([k, b]) => { b.classList.toggle('on', k === t); b.setAttribute('aria-selected', k === t); });
    dropHost.hidden = t !== 'upload';
    sketchHost.hidden = t !== 'sketch';
    kindRow.hidden = t === 'sketch';
    if (t === 'sketch') pad.resize();
    updateCta();
  }

  // ---------------------------------------------------------- Zusammenbau
  const saved = loadSaved();
  const resume = saved && h('div', { class: 'notice info', style: { marginBottom: '16px' } }, icon('home'),
    h('div', { style: { flex: 1 } }, h('b', null, 'Willkommen zurück. '), 'Dein letztes Projekt ist noch gespeichert.'),
    h('button', { class: 'btn small primary', type: 'button', onclick: () => {
      loadRoom(saved.room, { design: saved.design, projectId: saved.projectId, projectName: saved.projectName, step: Math.max(2, saved.step || 2) });
      onLoaded?.();
    } }, 'Weitermachen'));

  const recentHost = h('section', { class: 'recent-projects', hidden: true, 'aria-label': 'Zuletzt geöffnete Projekte' });
  async function openRecentProject(project) {
    try {
      const savedProject = await api.getProject(project.id);
      rememberProject(savedProject);
      loadRoom(savedProject.room, { design: savedProject.design, projectId: savedProject.id, projectName: savedProject.name, step: 4 });
      onLoaded?.();
      toast('Projekt geöffnet.', 'ok');
    } catch (e) {
      if (e.code === 'project_not_found') { forgetProject(project.id); renderRecentProjects(); }
      toast(e.message || 'Das Projekt konnte nicht geöffnet werden.', 'error');
    }
  }
  function renderRecentProjects() {
    clear(recentHost);
    const projects = recentProjects();
    recentHost.hidden = !projects.length;
    if (!projects.length) return;
    recentHost.append(h('h2', null, 'Zuletzt geöffnet'));
    projects.forEach((project) => {
      const updated = new Date(project.updatedAt);
      const date = Number.isNaN(updated.getTime()) ? '' : updated.toLocaleDateString('de-DE');
      recentHost.append(h('div', { class: 'recent-row' },
        h('button', { class: 'recent-open', type: 'button', onclick: () => openRecentProject(project) },
          h('b', null, project.name), h('small', null, date ? `Zuletzt geändert ${date}` : 'Gespeicherter Projektlink')),
        h('button', { class: 'btn ghost icon', type: 'button', title: 'Aus dieser Liste entfernen', 'aria-label': `${project.name} aus der Liste entfernen`, onclick: () => { forgetProject(project.id); renderRecentProjects(); } }, icon('x'))));
    });
  }

  const fileOpen = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
    const f = fileOpen.files[0];
    if (!f) return;
    try { importProject(await f.text()); onLoaded?.(); toast('Projekt geladen.', 'ok'); } catch (e) { toast(e.message || 'Die Datei konnte nicht gelesen werden.', 'error'); }
    fileOpen.value = '';
  } });

  root.append(h('div', { class: 'wl' },
    h('div', { class: 'hero' },
      h('div', null,
        h('h1', { id: 'h-welcome' }, 'Dein Bad in 3D. Mit ', h('em', null, 'echten Fliesen.')),
        h('p', { class: 'lead' }, 'Lade einen Plan oder ein Foto hoch, sage mir die Maße, und ich baue den Raum. Dann probierst du Fliesen, Muster und Fugen aus und siehst sofort, wie es aussieht und wie viel du brauchst.'),
        h('div', { class: 'hero-steps' },
          h('span', null, h('i', null, '1'), 'Plan + Maße'), h('span', null, h('i', null, '2'), 'Raum prüfen'),
          h('span', null, h('i', null, '3'), 'Fliesen wählen'), h('span', null, h('i', null, '4'), 'Einkaufsliste'))),
      h('div', { class: 'hero-art' }, h('img', { src: '/static/samples/hero.jpg', alt: 'Beispiel: ein Bad mit Marmorfliesen im Raumgestalter', onerror: (e) => e.target.closest('.hero-art').remove() }))),
    resume, recentHost,
    h('div', { class: 'cap' },
      h('section', { class: 'card cap-main', 'aria-labelledby': 'h-cap' },
        h('h2', { id: 'h-cap' }, 'Dein Raum'),
        h('p', { class: 'sub' }, 'Zeig mir den Raum und gib die Maße an, damit alles stimmt.'),
        h('div', { class: 'tabs', role: 'tablist' }, tabBtns.upload, tabBtns.sketch),
        dropHost, sketchHost, camInput, kindRow, kindHint,
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '20px', gap: '8px' } },
          h('span', { class: 'lbl', style: { fontSize: '15px', fontFamily: 'var(--f-head)' } }, 'Maße'), unitSeg),
        dimsBox,
        h('p', { class: 'help', id: 'dimHelp' }, 'Länge und Breite des Raums innen. Ohne Maße schätze ich oder lese Zahlen aus dem Plan. Die Raumhöhe ist meist 2,40–2,60 m.'),
        statusBox,
        h('div', { class: 'cta-row' }, analyzeBtn, rectBtn, note)),
      h('section', { class: 'card cap-side', 'aria-labelledby': 'h-tpl' },
        h('h2', { id: 'h-tpl' }, 'Oder direkt loslegen'),
        h('p', { class: 'help' }, 'Eine Vorlage laden und sofort Fliesen ausprobieren.'),
        tplGrid,
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' } },
          sampleBtn,
          h('button', { class: 'btn small', type: 'button', onclick: () => fileOpen.click() }, icon('folder'), 'Projekt öffnen'), fileOpen))),
    h('div', { class: 'trust' },
      h('div', null, h('h3', null, 'Die KI erkennt, der Code rechnet'), h('p', null, 'Claude liest Wände, Türen und Fenster aus deinem Bild. Alle Maße, Fliesenschnitte und Mengen berechnet das Programm exakt.')),
      h('div', null, h('h3', null, 'Fliesen in echter Größe'), h('p', null, 'Format, Fuge und Verlegemuster sind maßstäblich. Du siehst Randstücke und Verschnitt, bevor du kaufst.')),
      h('div', null, h('h3', null, 'Du entscheidest über die Bildfreigabe'), h('p', null, 'Dein Projekt bleibt im Browser. Raumfotos gehen zur Erkennung an Claude; deine 3D-Planung geht nur nach Klick zur Bildgenerierung an Replicate.')))));

  setUnit('m'); setKind('plan'); renderDrop(); setTab('upload'); renderStatus(); updateCta(); renderRecentProjects();
  on('status', () => { renderStatus(); updateCta(); });
  return { reset() { st.image = null; renderDrop(); updateCta(); } };
}

// ---------------------------------------------------------------- Scan-Overlay
function scanOverlay(src) {
  const msg = h('p', { class: 'scan-msg', 'aria-live': 'polite' }, SCAN_MSGS[0]);
  const el = h('div', { class: 'scan', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Raum wird erkannt' },
    h('div', { class: 'scan-card' },
      h('div', { class: 'scan-img' }, h('img', { src, alt: '' }), h('div', { class: 'scan-line' })),
      h('h3', null, 'Dein Raum wird erkannt'), msg));
  document.body.append(el);
  let i = 0;
  const t = setInterval(() => { i = Math.min(i + 1, SCAN_MSGS.length - 1); msg.textContent = SCAN_MSGS[i]; }, 2600);
  return { close() { clearInterval(t); el.remove(); } };
}

// ---------------------------------------------------------------- Skizzenblock
function makePad(onChange) {
  const cv = h('canvas', { 'aria-label': 'Zeichenfläche. Mit Maus oder Finger zeichnen.' });
  const hint = h('div', { class: 'pad-hint' }, h('div', null, h('b', { style: { color: '#6a7c80' } }, 'Zeichne hier den Grundriss'), h('br'), 'Wände als Linien. Türen und Fenster darfst du beschriften. Maße dazuschreiben hilft.'));
  const wrap = h('div', { class: 'pad-wrap' }, cv, hint);
  let strokes = [], cur = null, dpr = 1;
  const g = cv.getContext('2d');

  function redraw() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#eef0ec'; g.lineWidth = 1;
    const w = cv.width / dpr, hh = cv.height / dpr;
    g.beginPath();
    for (let x = 0; x < w; x += 24) { g.moveTo(x, 0); g.lineTo(x, hh); }
    for (let y = 0; y < hh; y += 24) { g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
    g.strokeStyle = '#1f2d31'; g.lineWidth = 3.2; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const st of [...strokes, ...(cur ? [cur] : [])]) {
      g.beginPath();
      st.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      if (st.length === 1) g.lineTo(st[0].x + 0.1, st[0].y);
      g.stroke();
    }
    hint.hidden = strokes.length > 0 || !!cur;
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    if (r.width < 10) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    redraw();
  }
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); cur = [pos(e)]; redraw(); });
  cv.addEventListener('pointermove', (e) => { if (!cur) return; cur.push(pos(e)); redraw(); });
  const end = () => { if (!cur) return; strokes.push(cur); cur = null; redraw(); onChange(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  new ResizeObserver(resize).observe(cv);

  const el = h('div', null, wrap,
    h('div', { class: 'pad-tools' },
      h('button', { class: 'btn small', type: 'button', onclick: () => { strokes.pop(); redraw(); onChange(); } }, icon('undo'), 'Letzter Strich'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { strokes = []; redraw(); onChange(); } }, icon('erase'), 'Alles löschen')));
  return {
    el, resize, hasInk: () => strokes.length > 0,
    export() {
      if (!strokes.length) return null;
      return { dataUrl: cv.toDataURL('image/jpeg', 0.9), width: cv.width, height: cv.height };
    },
  };
}
