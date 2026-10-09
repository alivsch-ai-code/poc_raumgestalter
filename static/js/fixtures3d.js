// Prozedurale 3D-Modelle der Ausstattung. Lokales Koordinatensystem:
// Ursprung = Mitte der Standfläche am Boden, Rückseite bei -z (zur Wand), Vorderseite bei +z.
import * as THREE from 'three';

const mat = (o) => new THREE.MeshStandardMaterial(o);
const M = {
  ceramic: mat({ color: 0xf9f9f7, roughness: 0.14, metalness: 0 }),
  acrylic: mat({ color: 0xfbfbf9, roughness: 0.22, metalness: 0 }),
  chrome: mat({ color: 0xe6e9ec, roughness: 0.1, metalness: 1 }),
  steel: mat({ color: 0xb9bec2, roughness: 0.3, metalness: 1 }),
  oak: mat({ color: 0xc8a574, roughness: 0.55, metalness: 0 }),
  white: mat({ color: 0xf4f3ef, roughness: 0.32, metalness: 0 }),
  greige: mat({ color: 0xe2dbce, roughness: 0.5, metalness: 0 }),
  dark: mat({ color: 0x23272a, roughness: 0.5, metalness: 0.2 }),
  water: mat({ color: 0xa9cad6, roughness: 0.04, metalness: 0 }),
  mirror: mat({ color: 0xe9f0f3, roughness: 0.05, metalness: 0.55, envMapIntensity: 1.6 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xdceef3, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
  glassDark: new THREE.MeshPhysicalMaterial({ color: 0x1a2328, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.88 }),
  tray: mat({ color: 0xe9e8e4, roughness: 0.6, metalness: 0 }),
};

function rrShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2 - 0.01, h / 2 - 0.01);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Extrusion nach oben (+y). Shape-y landet auf -z. */
function extrudeUp(shape, height, bevel = 0.8) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.1, height - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 18 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, material, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
const cyl = (r, h, material, x, y, z, seg = 24) => mesh(new THREE.CylinderGeometry(r, r, h, seg), material, x, y, z);

function tap(x, y, z, len = 12, h = 14) {
  const g = new THREE.Group();
  g.add(cyl(2.6, 2.4, M.chrome, 0, 1.2, 0));
  g.add(cyl(1.1, h, M.chrome, 0, h / 2 + 2, 0));
  const arm = cyl(0.9, len, M.chrome, 0, h + 2, len / 2 - 0.5);
  arm.rotation.x = Math.PI / 2;
  g.add(arm);
  g.add(box(1.4, 5, 1.4, M.chrome, 0, h + 4.2, 0));
  g.position.set(x, y, z);
  return g;
}

function buildTub(f) {
  const g = new THREE.Group();
  const { w, d } = f, h = 58;
  const outer = rrShape(w, d, 13);
  outer.holes.push(rrShape(w - 15, d - 15, 26));
  g.add(mesh(extrudeUp(outer, h, 0.9), M.acrylic));
  g.add(mesh(extrudeUp(rrShape(w - 14, d - 14, 25), 16, 0.6), M.acrylic));
  // Wasserfläche nur als dunkler Hinweis auf den Abfluss
  const drain = cyl(2.6, 0.4, M.chrome, w / 2 - 22, 16.4, 0, 28);
  g.add(drain);
  g.add(tap(-w / 2 + 30, h - 0.5, -d / 2 + 3.6, 13, 13));
  // Überlauf
  g.add(cyl(1.7, 0.5, M.chrome, w / 2 - 22, 38, -d / 2 + 7.6, 18).rotateX(Math.PI / 2));
  return g;
}

function buildShower(f) {
  const g = new THREE.Group();
  const { w, d } = f;
  g.add(box(w, 3.6, d, M.tray, 0, 1.8, 0));
  g.add(box(w - 2, 0.3, d - 2, M.tray, 0, 3.7, 0));
  g.add(cyl(5.2, 0.3, M.chrome, w * 0.18, 3.95, d * 0.12, 32));
  g.add(cyl(1.2, 0.35, M.dark, w * 0.18, 4.1, d * 0.12, 12));
  // Duschkopf und Armatur an der Rückwand
  const arm = cyl(0.8, 38, M.chrome, 0, 200, -d / 2 + 19);
  arm.rotation.x = Math.PI / 2;
  g.add(arm);
  const head = cyl(12, 1.2, M.chrome, 0, 198.5, -d / 2 + 38, 40);
  g.add(head);
  g.add(box(18, 10, 6, M.chrome, 0, 105, -d / 2 + 3));
  g.add(cyl(2.6, 3, M.chrome, -4.2, 105, -d / 2 + 8).rotateX(Math.PI / 2));
  g.add(cyl(2.6, 3, M.chrome, 4.2, 105, -d / 2 + 8).rotateX(Math.PI / 2));
  // Glaswand
  const side = f.opt?.glass || 'right';
  const addGlass = (sx) => {
    const gl = box(0.9, 198, d * 0.96, M.glass, sx * (w / 2 - 0.6), 3.6 + 99, 0);
    gl.castShadow = false;
    g.add(gl);
    g.add(box(1.4, 1.6, d * 0.96, M.chrome, sx * (w / 2 - 0.6), 201, 0));
    g.add(box(1.4, 1.6, d * 0.96, M.chrome, sx * (w / 2 - 0.6), 4.2, 0));
    const stab = cyl(0.7, d * 0.5, M.chrome, sx * (w / 2 - 0.6), 190, -d * 0.24);
    stab.rotation.x = Math.PI / 2;
    g.add(stab);
  };
  if (side === 'left') addGlass(-1);
  else if (side === 'right') addGlass(1);
  else if (side === 'both') { addGlass(-1); addGlass(1); }
  return g;
}

function buildWc(f) {
  const g = new THREE.Group();
  const { w, d } = f;
  const front = d / 2;
  // Pan: schmal vorn (-shape y => +z), breit hinten
  const s = new THREE.Shape();
  const hw = w / 2 - 0.5, hl = d / 2 - 1;
  s.moveTo(-hw, hl * 0.28);
  s.bezierCurveTo(-hw, -hl * 0.45, -hw * 0.62, -hl, 0, -hl);
  s.bezierCurveTo(hw * 0.62, -hl, hw, -hl * 0.45, hw, hl * 0.28);
  s.lineTo(hw, hl);
  s.lineTo(-hw, hl);
  s.closePath();
  g.add(mesh(extrudeUp(s, 40, 2.2), M.ceramic));
  // Sitz mit Öffnung
  const seat = new THREE.Shape();
  seat.moveTo(-hw, hl * 0.28);
  seat.bezierCurveTo(-hw, -hl * 0.45, -hw * 0.62, -hl, 0, -hl);
  seat.bezierCurveTo(hw * 0.62, -hl, hw, -hl * 0.45, hw, hl * 0.28);
  seat.lineTo(hw, hl * 0.45);
  seat.lineTo(-hw, hl * 0.45);
  seat.closePath();
  const hole = new THREE.Path();
  hole.absellipse(0, -hl * 0.12, hw * 0.62, hl * 0.52, 0, Math.PI * 2, true);
  seat.holes.push(hole);
  const seatMesh = mesh(extrudeUp(seat, 3.4, 0.6), M.white, 0, 40.2, 0);
  g.add(seatMesh);
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 28), M.water);
  water.scale.set(hw * 0.6, hl * 0.5, 1);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 36, hl * 0.12);
  g.add(water);
  // Spülkasten und Taste
  const tankD = 18;
  g.add(mesh(new THREE.BoxGeometry(w, 40, tankD), M.ceramic, 0, 60.5, -d / 2 + tankD / 2));
  g.add(box(w - 1, 1.6, tankD + 1, M.white, 0, 81.1, -d / 2 + tankD / 2));
  g.add(box(9, 0.8, 5.5, M.chrome, 0, 82.2, -d / 2 + tankD / 2));
  void front;
  return g;
}

function buildBasin(f) {
  const g = new THREE.Group();
  const { w, d } = f;
  const small = w < 52;
  const cabH = small ? 0 : 38;
  if (!small) {
    const fz = d / 2 + 0.05;
    g.add(box(w, cabH, d - 2, M.oak, 0, 38 + cabH / 2, 1));
    g.add(box(w - 1, 0.35, 0.4, M.dark, 0, 38 + cabH / 2, fz));
    g.add(box(0.35, cabH - 1, 0.4, M.dark, 0, 38 + cabH / 2, fz));
    for (const sx of [-1, 1]) {
      g.add(box(w * 0.34, 1.1, 1.1, M.steel, sx * w * 0.2, 38 + cabH - 6, fz + 0.5));
      g.add(box(w * 0.34, 1.1, 1.1, M.steel, sx * w * 0.2, 38 + 10, fz + 0.5));
    }
  }
  const top = small ? 80 : 38 + cabH;
  const slab = rrShape(w, d, small ? 8 : 5);
  slab.holes.push(rrShape(w * 0.7, d * 0.62, small ? 12 : 16));
  g.add(mesh(extrudeUp(slab, small ? 5 : 8.5, 0.5), M.ceramic, 0, top, 0));
  g.add(mesh(extrudeUp(rrShape(w * 0.7 + 0.6, d * 0.62 + 0.6, small ? 12 : 16), 1.4, 0.4), M.ceramic, 0, top + 1.5, 0));
  g.add(cyl(2.2, 0.35, M.chrome, 0, top + 2.1, d * 0.04, 24));
  g.add(tap(0, top + (small ? 5 : 8.5), -d / 2 + 6.5, 11, 12));
  // Spiegel mit Rahmen
  const mw = Math.min(w * 0.92, 90), mh = 72;
  const mirror = box(mw, mh, 1.2, M.mirror, 0, 108 + mh / 2, -d / 2 + 0.8);
  mirror.castShadow = false;
  g.add(mirror);
  g.add(box(mw + 1.6, 0.8, 1.6, M.white, 0, 108 + mh + 0.4, -d / 2 + 0.9));
  g.add(box(mw + 1.6, 0.8, 1.6, M.white, 0, 107.6, -d / 2 + 0.9));
  g.add(box(0.8, mh + 1.6, 1.6, M.white, -mw / 2 - 0.4, 108 + mh / 2, -d / 2 + 0.9));
  g.add(box(0.8, mh + 1.6, 1.6, M.white, mw / 2 + 0.4, 108 + mh / 2, -d / 2 + 0.9));
  if (small) g.add(cyl(3, 74, M.ceramic, 0, 37, -d / 2 + 8)); // Säule
  return g;
}

function buildWasher(f) {
  const g = new THREE.Group();
  const { w, d } = f;
  g.add(box(w, 85, d, M.white, 0, 42.5, 0));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(19, w * 0.32), 2.6, 16, 48), M.chrome);
  ring.position.set(0, 40, d / 2 + 0.2);
  ring.castShadow = true;
  g.add(ring);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(Math.min(17, w * 0.28), 40), M.glassDark);
  glass.position.set(0, 40, d / 2 + 0.35);
  g.add(glass);
  g.add(box(w - 6, 9, 0.8, M.dark, 0, 77, d / 2 + 0.1));
  g.add(cyl(3, 1.4, M.steel, -w * 0.22, 77, d / 2 + 0.8).rotateX(Math.PI / 2));
  g.add(box(9, 3.4, 0.5, M.chrome, w * 0.18, 77, d / 2 + 0.6));
  return g;
}

function buildRadiator(f) {
  const g = new THREE.Group();
  const { w } = f, h = 118, y0 = 16;
  const n = 11;
  for (let i = 0; i < n; i++) {
    const bar = cyl(1.05, w - 4, M.white, 0, y0 + 6 + (i * (h - 12)) / (n - 1), 0, 16);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);
  }
  g.add(cyl(1.5, h, M.white, -w / 2 + 2, y0 + h / 2, 0, 16));
  g.add(cyl(1.5, h, M.white, w / 2 - 2, y0 + h / 2, 0, 16));
  g.add(box(3, 1.6, 3, M.steel, -w / 2 + 2, y0 + h + 0.8, 0));
  return g;
}

function buildCabinet(f) {
  const g = new THREE.Group();
  const { w, d } = f, h = 180;
  g.add(box(w - 2, 8, d - 2, M.dark, 0, 4, 0));
  g.add(box(w, h - 8, d, M.greige, 0, 8 + (h - 8) / 2, 0));
  g.add(box(0.5, h - 12, 0.5, M.dark, 0, 8 + (h - 8) / 2, d / 2 + 0.05));
  g.add(box(0.9, 22, 1.4, M.steel, -2.4, 100, d / 2 + 0.6));
  g.add(box(0.9, 22, 1.4, M.steel, 2.4, 100, d / 2 + 0.6));
  g.add(box(w - 1, 0.5, 0.5, M.dark, 0, 120, d / 2 + 0.05));
  return g;
}

const BUILDERS = { badewanne: buildTub, dusche: buildShower, wc: buildWc, waschtisch: buildBasin, waschmaschine: buildWasher, heizkoerper: buildRadiator, schrank: buildCabinet };

export function buildFixture(f) {
  const g = (BUILDERS[f.type] || buildCabinet)(f);
  g.traverse((o) => { if (o.isMesh) { o.userData.fixtureId = f.id; } });
  return g;
}
