// Schritt 4: Mengen, Kosten und Export.
import { h, clear, toast, download, fmt0, fmt1, fmt2, fmtEur, fmtM2 } from './dom.js';
import { icon } from './icons.js';
import { S, on, exportProject, setProjectIdentity } from './state.js';
import { buildBom, patternOf, tileOf, groutOf, paintOf, trimOf } from './design.js';
import { polyArea, polyBBox } from './room.js';
import { renderSwatch } from './tilegen.js';
import * as api from './api.js';
import { rememberProject } from './projects.js';

export function initResult(root, { scene }) {
  const holder = h('div');
  const renderState = { busy: false, items: [] };
  let projectNameDraft = '';
  root.append(holder);

  function swatch(tile, px = 38) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    setTimeout(() => { try { c.getContext('2d').drawImage(renderSwatch(tile, 112, '#cfcfcb', 3), 0, 0, px, px); } catch { /* egal */ } }, 0);
    return c;
  }

  function render() {
    if (!S.room || !S.design || !S.catalog) return;
    clear(holder);
    const cat = S.catalog;
    const bom = buildBom(S.room, S.design, cat);
    const floorArea = polyArea(S.room.polygon) / 10000;
    const wallArea = bom.surfaces.filter((x) => x.id !== 'floor').reduce((a, x) => a + x.net, 0);
    const extra = bom.grout.sacks * 12 + bom.adhesive.sacks * 14; // grobe Beispielpreise
    const total = bom.tilesCost;

    holder.append(h('h2', null, 'Deine Planung'),
      h('p', { class: 'intro' }, 'Alle Mengen sind inklusive Verschnitt gerechnet. Preise sind Beispielwerte, kein Angebot.'));

    holder.append(h('div', { class: 'sum' },
      h('div', { class: 'kpi big' }, h('small', null, 'Fliesen (Beispielpreise)'), h('b', null, fmtEur(total))),
      h('div', { class: 'kpi' }, h('small', null, 'Boden'), h('b', null, fmtM2(floorArea))),
      h('div', { class: 'kpi' }, h('small', null, 'Wände gefliest (netto)'), h('b', null, fmtM2(wallArea)))));

    // Fliesen
    const rows = bom.lines.map((l) => h('tr', null,
      h('td', null, h('div', { class: 'bom-tile' }, swatch(l.tile), h('div', null, h('b', null, l.tile.name), h('small', null, `${fmt0(l.tile.size[0])}×${fmt0(l.tile.size[1])} cm · ${l.surfaces.map((x) => x.name).join(', ')}`)))),
      h('td', { class: 'r' }, fmt2(l.net)),
      h('td', { class: 'r' }, `${l.boxes} Pk.`, h('br'), h('small', { style: { color: 'var(--muted)' } }, `${fmt2(l.m2Bought)} m²`)),
      h('td', { class: 'r' }, fmtEur(l.cost))));
    if (!rows.length) rows.push(h('tr', null, h('td', { colspan: 4, style: { color: 'var(--muted)' } }, 'Noch keine Fliesen gewählt.')));
    holder.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Fliesen'), h('small', null, 'm² netto → Pakete')),
      h('table', { class: 'bom' },
        h('thead', null, h('tr', null, h('th', null, 'Fliese'), h('th', { class: 'r' }, 'm²'), h('th', { class: 'r' }, 'Kaufen'), h('th', { class: 'r' }, 'Preis'))),
        h('tbody', null, ...rows),
        h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, 'Summe Fliesen'), h('td', { class: 'r' }, fmtEur(total)))))));

    // Verlegung je Fläche
    const srows = bom.surfaces.filter((x) => x.spec.tile && x.net > 0).map((x) => {
      const t = tileOf(cat, x.spec.tile); const p = patternOf(cat, x.spec.pattern);
      return h('tr', null,
        h('td', null, x.name, h('br'), h('small', { style: { color: 'var(--muted)' } }, `${p.name} · Fuge ${fmt1(x.spec.groutMm)} mm ${groutOf(cat, x.spec.grout).name.toLowerCase()}`)),
        h('td', { class: 'r' }, fmt2(x.net)),
        h('td', { class: 'r' }, `${Math.round(p.waste * 100)} %`));
    });
    holder.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Flächen im Detail'), h('small', null, 'Türen und Fenster abgezogen')),
      h('table', { class: 'bom' }, h('thead', null, h('tr', null, h('th', null, 'Fläche'), h('th', { class: 'r' }, 'm²'), h('th', { class: 'r' }, 'Verschnitt'))), h('tbody', null, ...srows))));

    // Zubehör
    const trim = trimOf(cat, S.design.trim);
    const acc = [
      ['Fugenmasse', `${fmt1(bom.grout.kg)} kg`, `${bom.grout.sacks} Sack à 5 kg`],
      ['Fliesenkleber', `${fmt0(bom.adhesive.kg)} kg`, `${bom.adhesive.sacks} Sack à 25 kg`],
    ];
    if (bom.trim.meters > 0) acc.push([`Abschlussleiste (${trim.name})`, `${fmt1(bom.trim.meters)} m`, `${bom.trim.pieces} Stück à 2,5 m`]);
    acc.push(['Wandfarbe', paintOf(cat, S.design.paint).name, 'für die Fläche über den Fliesen']);
    holder.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Zubehör')),
      h('table', { class: 'bom' }, h('tbody', null, ...acc.map(([a, b, c]) => h('tr', null, h('td', null, a), h('td', { class: 'r' }, b), h('td', { class: 'r', style: { color: 'var(--muted)' } }, c)))))));

    const renderPanel = h('div', { class: 'sec' });
    renderAiPanel(renderPanel);
    holder.append(renderPanel);

    const projectPanel = h('div', { class: 'sec' });
    renderProjectPanel(projectPanel);
    holder.append(projectPanel);

    // Export
    holder.append(h('div', { class: 'sec no-print' }, h('div', { class: 'sec-h' }, h('h3', null, 'Mitnehmen')),
      h('div', { class: 'exports' },
        h('button', { class: 'btn', type: 'button', onclick: () => exportPng(bom) }, icon('download'), 'Bild (PNG)'),
        h('button', { class: 'btn', type: 'button', onclick: () => exportCsv(bom) }, icon('download'), 'Einkaufsliste'),
        h('button', { class: 'btn', type: 'button', onclick: () => { window.print(); } }, icon('print'), 'Drucken / PDF'),
        h('button', { class: 'btn', type: 'button', onclick: () => { download('raumgestalter-projekt.json', new Blob([exportProject()], { type: 'application/json' })); toast('Projekt gespeichert. Mit „Projekt öffnen“ lädst du es wieder.', 'ok'); } }, icon('save'), 'Projekt sichern')),
      h('p', { class: 'disclaimer' }, 'Hinweis: Menge = Fläche netto + Verschnitt je Muster, aufgerundet auf ganze Pakete. Fugen- und Klebermengen sind Richtwerte nach Herstellerformeln. Vor dem Kauf vom Fachbetrieb prüfen lassen. Preise und Fliesen im Katalog sind Beispieldaten.')));
  }

  function renderProjectPanel(host) {
    clear(host);
    const bounds = polyBBox(S.room.polygon);
    const nameInput = h('input', {
      class: 'project-name', type: 'text', maxlength: 80,
      value: projectNameDraft || S.projectName || `Raum ${fmt0(bounds.w)} × ${fmt0(bounds.h)} cm`,
      oninput: (event) => { projectNameDraft = event.target.value; },
    });
    const saveButton = h('button', { class: 'btn primary', type: 'button', onclick: () => saveProjectLink(nameInput, saveButton) },
      icon('save'), S.projectId ? 'Änderungen über Link speichern' : 'Link erstellen und kopieren');
    host.append(h('div', { class: 'sec-h' }, h('h3', null, 'Projekt wiederverwenden')),
      h('p', { class: 'help' }, 'Der Link öffnet diesen Entwurf auf anderen Geräten. Jeder mit dem Link kann ihn ansehen und Änderungen speichern.'),
      h('label', { class: 'project-label' }, 'Projektname', nameInput),
      saveButton);
    if (S.projectId) {
      const url = new URL(`/p/${S.projectId}`, location.origin).href;
      host.append(h('div', { class: 'project-share' },
        h('a', { href: url, target: '_blank', rel: 'noopener' }, url),
        h('button', { class: 'btn small', type: 'button', onclick: () => copyProjectLink(url) }, icon('save'), 'Link kopieren')));
    }
  }

  async function saveProjectLink(nameInput, button) {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Projekt wird gespeichert …';
    try {
      const saved = await api.saveProject({
        id: S.projectId,
        name: nameInput.value.trim(),
        project: { room: S.room, design: S.design },
      });
      setProjectIdentity(saved.id, saved.name);
      projectNameDraft = saved.name;
      rememberProject(saved);
      const url = new URL(`/p/${saved.id}`, location.origin).href;
      const copied = await copyProjectLink(url);
      toast(copied ? 'Projekt gespeichert. Der Link ist kopiert.' : 'Projekt gespeichert. Der Link steht im Ergebnisbereich.', copied ? 'ok' : 'info');
      render();
    } catch (e) {
      toast(e.message || 'Das Projekt konnte nicht gespeichert werden.', 'error', 6000);
    } finally {
      button.disabled = false;
      if (button.isConnected) button.textContent = S.projectId ? 'Änderungen über Link speichern' : 'Link erstellen und kopieren';
    }
  }

  async function copyProjectLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      toast(`Projektlink: ${url}`, 'info', 10000);
      return false;
    }
  }

  function renderAiPanel(host) {
    clear(host);
    const action = h('button', { class: 'btn primary', type: 'button', disabled: renderState.busy, onclick: startRenders },
      icon('wand'), renderState.busy ? 'Ansichten werden erstellt …' : '3 realistische Ansichten erstellen');
    host.append(h('div', { class: 'sec-h' }, h('h3', null, 'Realistische Raumansichten')),
      h('p', { class: 'help' }, S.status.replicate
        ? 'Erstellt aus deiner aktuellen 3D-Planung. KI-Bilder sind eine Visualisierung, keine maßstabsgetreue Ausführungsplanung.'
        : 'Für diese optionale Funktion REPLICATE_API_TOKEN in .env eintragen. Die Generierung verursacht Modellkosten.'),
      h('div', { class: 'ai-gallery' }, ...renderState.items.map((item) => {
        const content = item.image
          ? h('img', { src: item.image, alt: `KI-generierte Raumansicht: ${item.view}`, loading: 'lazy' })
          : h('div', { class: `ai-placeholder${item.status === 'failed' ? ' failed' : ''}` }, item.status === 'failed' ? 'Erstellung fehlgeschlagen' : 'Bild wird erstellt …');
        return h('article', { class: 'ai-image' }, content,
          h('div', { class: 'ai-image-foot' }, h('b', null, item.view), item.image
            ? h('a', { class: 'btn small', href: item.image, target: '_blank', rel: 'noopener', download: `raumgestalter-${item.view.toLowerCase()}.jpg` }, icon('download'), 'Bild öffnen')
            : h('small', null, item.status === 'failed' ? item.error || 'Bitte erneut versuchen.' : 'Wird gerendert')));
      })), action);
  }

  async function startRenders() {
    if (renderState.busy) return;
    renderState.busy = true;
    renderState.items = [];
    render();
    try {
      const reference = await makeReference();
      const result = await api.createRenders({
        reference,
        design: { floor: S.design.floor, walls: S.design.walls },
      });
      renderState.items = result.renders.map((item) => ({ ...item, status: item.status || 'starting' }));
      render();
      await Promise.all(renderState.items.map(pollRender));
    } catch (e) {
      toast(e.message || 'Die Ansichten konnten nicht gestartet werden.', 'error', 6000);
    } finally {
      renderState.busy = false;
      render();
    }
  }

  async function makeReference() {
    const source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = scene.capture(1200);
    });
    const scale = Math.min(1, 960 / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.78);
  }

  async function pollRender(item) {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (['succeeded', 'successful', 'failed', 'canceled'].includes(item.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const result = await api.getRender(item.id);
        item.status = result.status;
        item.image = result.images?.[0] || null;
        item.error = result.error;
        if (item.status === 'succeeded' || item.status === 'successful') item.status = item.image ? 'succeeded' : 'failed';
        if (['failed', 'canceled'].includes(item.status) && !item.error) item.error = 'Replicate hat kein Bild geliefert.';
        render();
      } catch (e) {
        item.status = 'failed';
        item.error = e.message || 'Status konnte nicht geladen werden.';
        render();
        break;
      }
    }
    if (!['succeeded', 'successful', 'failed', 'canceled'].includes(item.status)) {
      item.status = 'failed';
      item.error = 'Zeitüberschreitung. Bitte prüfe den Modellstatus und starte neu.';
      render();
    }
  }

  async function exportPng(bom) {
    toast('Bild wird erzeugt …', 'info', 1800);
    await new Promise((r) => setTimeout(r, 60));
    try {
      const url = scene.capture(2200);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const strip = 190;
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height + strip;
      const g = c.getContext('2d');
      g.fillStyle = '#e9eeec'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0);
      g.fillStyle = '#ffffff'; g.fillRect(0, img.height, c.width, strip);
      g.fillStyle = '#1f2d31'; g.font = '700 44px "Bricolage Grotesque", system-ui, sans-serif';
      g.fillText('Raumgestalter', 56, img.height + 76);
      g.font = '500 30px "Instrument Sans", system-ui, sans-serif'; g.fillStyle = '#4a5c61';
      const f = tileOf(S.catalog, S.design.floor.tile), w = tileOf(S.catalog, S.design.walls[0]?.tile);
      g.fillText(`Boden: ${f?.name || '–'} ${f ? `${fmt0(f.size[0])}×${fmt0(f.size[1])}` : ''}   ·   Wände: ${w?.name || '–'} ${w ? `${fmt0(w.size[0])}×${fmt0(w.size[1])}` : ''}`, 56, img.height + 124);
      g.fillText(`${fmtM2(polyArea(S.room.polygon) / 10000)} Boden   ·   Fliesen ca. ${fmtEur(bom.tilesCost)} (Beispielpreise)`, 56, img.height + 166);
      c.toBlob((b) => { download('raumgestalter-ansicht.png', b); toast('Bild gespeichert.', 'ok'); }, 'image/png');
    } catch (e) { console.error(e); toast('Das Bild konnte nicht erzeugt werden.', 'error'); }
  }

  function exportCsv(bom) {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const n = (v, d = 2) => v.toFixed(d).replace('.', ',');
    const rows = [['Position', 'Artikel', 'Format cm', 'Fläche netto m²', 'Pakete', 'Fläche gekauft m²', 'Preis EUR (Beispiel)']];
    bom.lines.forEach((l) => rows.push(['Fliese', l.tile.name, `${l.tile.size[0]}x${l.tile.size[1]}`, n(l.net), l.boxes, n(l.m2Bought), n(l.cost)]));
    rows.push(['Zubehör', 'Fugenmasse', '', '', `${bom.grout.sacks} Sack à 5 kg`, '', '']);
    rows.push(['Zubehör', 'Fliesenkleber', '', '', `${bom.adhesive.sacks} Sack à 25 kg`, '', '']);
    if (bom.trim.meters > 0) rows.push(['Zubehör', 'Abschlussleiste', '', '', `${bom.trim.pieces} Stück à 2,5 m`, '', '']);
    const csv = '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
    download('raumgestalter-einkaufsliste.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    toast('Einkaufsliste gespeichert (öffnet in Excel).', 'ok');
  }

  on('design', () => { if (S.step === 4) render(); });
  on('room', (e) => {
    if (e?.fresh) projectNameDraft = '';
    if (S.step === 4 && !e?.live) render();
  });
  on('step', (st) => { if (st === 4) render(); });
  return { render };
}
