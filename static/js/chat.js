// Schwebender Chat-Assistent: Wünsche in normaler Sprache → Änderungen am Design.
import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { S, on, updateDesign } from './state.js';
import { applyOps } from './design.js';
import { describeRoomForChat, wallLabels } from './room.js';
import * as api from './api.js';

const VIEWS = { eintreten: 'enter', ueberblick: 'overview', draufsicht: 'top' };
const SUGGEST = [
  'Mach den Boden dunkler',
  'Wände in Salbeigrün, Boden Beton',
  'Fischgrät auf dem Boden',
  'Fugen schmaler und weiß',
  'Zeig mir wie es beim Hereinkommen wirkt',
  'Was passt zu einem kleinen Bad?',
];

export function initChat(root, { scene, onTouched }) {
  const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', placeholder: 'Was möchtest du ändern?', 'aria-label': 'Nachricht an den Assistenten', maxlength: 600, autocomplete: 'off' });
  const modeNote = h('div', { class: 'chat-mode' });
  const sugg = h('div', { class: 'sugg' });
  const history = [];
  let open = false, busy = false;

  const panel = h('section', { class: 'chat', 'aria-label': 'Gestaltungs-Assistent', hidden: true },
    h('div', { class: 'chat-h' }, h('div', { class: 'av' }, icon('wand')), h('div', null, h('b', null, 'Gestaltungs-Assistent'), h('small', null, 'Sag, was du dir vorstellst')),
      h('button', { class: 'mini', type: 'button', 'aria-label': 'Chat schließen', onclick: () => toggle(false) }, icon('x'))),
    log, modeNote, sugg,
    h('form', { class: 'chat-f', onsubmit: (e) => { e.preventDefault(); send(input.value); } }, input,
      h('button', { class: 'btn primary icon', type: 'submit', 'aria-label': 'Senden' }, icon('send'))));
  const fab = h('button', { class: 'chat-fab', type: 'button', hidden: true, 'aria-expanded': 'false', onclick: () => toggle(true) }, icon('chat'), 'Frag den Assistenten');
  root.append(panel, fab);

  function say(text, who) { const m = h('div', { class: `msg ${who === 'u' ? 'u' : 'a'}` }, text); log.append(m); log.scrollTop = log.scrollHeight; return m; }

  function renderSugg() {
    clear(sugg);
    SUGGEST.slice(0, 4).forEach((t) => sugg.append(h('button', { type: 'button', onclick: () => send(t) }, t)));
  }

  function toggle(v) {
    open = v;
    panel.hidden = !v;
    fab.hidden = v || !visible;
    fab.setAttribute('aria-expanded', String(v));
    if (v) {
      if (!log.children.length) {
        say('Hallo! Beschreib mir einfach, wie dein Bad aussehen soll, zum Beispiel „helles Bad im skandinavischen Stil“ oder „Boden wie Beton, Wände weiß mit Fischgrät“. Ich ändere es direkt im 3D-Bild.', 'a');
        renderSugg();
      }
      modeNote.textContent = S.status.llm ? '' : 'Einfacher Modus ohne KI: Ich verstehe Stichworte wie Farbe, Muster, Fuge. Mit API-Key auch freie Sätze.';
      setTimeout(() => input.focus(), 50);
    }
  }

  let visible = false;
  function setVisible(v) { visible = v; if (!v) { panel.hidden = true; fab.hidden = true; } else toggle(open); }

  function context() {
    const d = S.design;
    const spec = (s) => ({ fliese: s.tile, muster: s.pattern, gedreht: s.rotated, fuge_mm: s.groutMm, fugenfarbe: s.grout, hoehe_cm: s.height });
    return {
      height: S.room.height,
      walls: describeRoomForChat(S.room),
      design: { boden: spec(d.floor), waende: d.walls.map(spec), wandfarbe: d.paint, leiste: d.trim },
      selected: S.surface === 'floor' ? 'Boden' : wallLabels(S.room)[+S.surface.split(':')[1]],
    };
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    input.value = '';
    sugg.hidden = true;
    say(text, 'u');
    history.push({ role: 'user', text });
    busy = true;
    const typing = h('div', { class: 'msg a typing' }, h('i'), h('i'), h('i'));
    log.append(typing); log.scrollTop = log.scrollHeight;
    try {
      const res = await api.chat({ message: text, history: history.slice(-8, -1), context: context() });
      typing.remove();
      let touched = [];
      if (res.ops?.length) {
        updateDesign((d) => { touched = applyOps(d, res.ops, S.room, S.catalog); }, { surfaces: 'all' });
        if (touched.length) { const walls = touched.filter((t) => t !== 'floor'); if (touched.includes('floor')) scene.pulse('floor'); if (walls.length > 1) scene.pulse('walls'); else if (walls.length) scene.pulse(walls[0]); }
        onTouched?.(touched);
      }
      if (res.view && VIEWS[res.view]) scene.goView(VIEWS[res.view]);
      const m = say(res.reply || 'Erledigt.', 'a');
      if (res.ops?.length) m.append(h('div', { style: { fontSize: '12px', opacity: .65, marginTop: '4px' } }, 'Mit Strg+Z kannst du es rückgängig machen.'));
      history.push({ role: 'assistant', text: res.reply || '' });
      modeNote.textContent = res.mode === 'fallback' ? 'Einfacher Modus ohne KI.' : '';
    } catch (e) {
      typing.remove();
      say(e.message || 'Das hat nicht geklappt. Versuch es noch einmal.', 'a');
      history.pop();
    } finally { busy = false; }
  }

  on('step', (st) => setVisible(st === 3 || st === 4));
  on('room', (e) => { if (e?.fresh) { clear(log); history.length = 0; sugg.hidden = false; renderSugg(); } });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  return { toggle, setVisible };
}
