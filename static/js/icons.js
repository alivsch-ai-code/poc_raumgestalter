// Schlichte Strich-Symbole (24×24). icon('name') liefert ein SVG-Element.
const P = {
  upload: '<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19zM14 7l3 3"/>',
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
  redo: '<path d="m15 7 4.5 4.5L15 16M19 11.5h-9a5 5 0 0 0 0 10h2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
  save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  door: '<path d="M6 20V4h12v16M4 20h16M14.5 12h.01"/>',
  window: '<path d="M5 4h14v16H5zM12 4v16M5 12h14"/>',
  chat: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z"/>',
  send: '<path d="M4 12 20 4l-5 16-3-6.5zM12 13.5 20 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  plan: '<path d="M4 4h16v16H4zM4 11h8M12 4v16M16 11h4M12 15h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 19h16"/>',
  print: '<path d="M7 9V4h10v5M7 17H4.5A1.5 1.5 0 0 1 3 15.5v-5A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17M7 14h10v6H7z"/>',
  wand: '<path d="m5 19 10-10M14 6l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM6 6l.6-1.2L7.8 4.2 6.6 3.6 6 2.4 5.4 3.6 4.2 4.2l1.2.6zM18.5 15l.5-1 .5 1 1 .5-1 .5-.5 1-.5-1-1-.5z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 4 2.5 20h19zM12 10v4.5M12 17.2h.01"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  erase: '<path d="m4.5 15.5 9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H7zM12 19h8"/>',
  home: '<path d="M4 11 12 4l8 7v9H5zM10 20v-6h4v6"/>',
  fx_wc: '<path d="M7 4h10v5H7zM6 9h12v3a6 6 0 0 1-12 0zM9 19l-1 2M15 19l1 2"/>',
  fx_badewanne: '<path d="M3 11h18v2.5a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 13.5zM6 11V6.5A2 2 0 0 1 8 4.5h.5M7 18l-1 2M17 18l1 2"/>',
  fx_dusche: '<path d="M6 20V8a4 4 0 0 1 4-4h5M15 4v3M12 11l-1 2M15 11v2.5M18 11l1 2M12 16l-.5 1.5M15 17v1.5M18 16l.5 1.5"/>',
  fx_waschtisch: '<path d="M4 11h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM12 11V6a2 2 0 0 1 2-2h2"/>',
  fx_waschmaschine: '<path d="M5 3.5h14v17H5zM5 8h14M8 5.8h.01M11 5.8h.01"/><circle cx="12" cy="14" r="3.6"/>',
  fx_heizkoerper: '<path d="M5 5h14v14H5zM9 5v14M12 5v14M15 5v14"/>',
  fx_schrank: '<path d="M6 3.5h12v17H6zM12 3.5v17M10 12h.01M14 12h.01"/>',
};

export function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  svg.innerHTML = P[name] || '';
  return svg;
}
