// 3D-Ansicht (Three.js): Raumhülle, Fliesenflächen, Öffnungen, Ausstattung, Kamera, Licht.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { renderSurface } from './tilegen.js';
import { wallInfo, polyBBox, offsetPolygon, WALL_THICK, rad } from './room.js';
import { buildFixture } from './fixtures3d.js';
import { floorId, wallId, tileOf, groutOf, paintOf, trimOf } from './design.js';
import { prefersReducedMotion } from './dom.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const PLASTER = 0xeceae4;

const plasterMat = new THREE.MeshStandardMaterial({ color: PLASTER, roughness: 0.9, side: THREE.DoubleSide });
const casingMat = new THREE.MeshStandardMaterial({ color: 0xf6f5f1, roughness: 0.45 });
const doorMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.42 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.18, metalness: 1 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdbeef5, roughness: 0.02, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
const daylightMat = new THREE.MeshBasicMaterial({ color: 0xeaf4fa, side: THREE.DoubleSide, toneMapped: false });
const stoneMat = new THREE.MeshStandardMaterial({ color: 0xe4e1da, roughness: 0.5 });
const capMat = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.8, side: THREE.DoubleSide });
const plinthMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e0, roughness: 0.9 });

function box(w, h, d, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

function wallGeometry(W, openings, H) {
  const L = W.len;
  const shape = new THREE.Shape();
  const doors = openings.filter((o) => o.type === 'door').sort((a, b) => a.offset - b.offset);
  shape.moveTo(0, 0);
  for (const d of doors) {
    const dh = Math.min(d.height, H - 2);
    shape.lineTo(d.offset, 0); shape.lineTo(d.offset, dh); shape.lineTo(d.offset + d.width, dh); shape.lineTo(d.offset + d.width, 0);
  }
  shape.lineTo(L, 0); shape.lineTo(L, H); shape.lineTo(0, H); shape.closePath();
  for (const w of openings.filter((o) => o.type === 'window')) {
    const p = new THREE.Path();
    const top = Math.min(w.sill + w.height, H - 2);
    p.moveTo(w.offset, w.sill); p.lineTo(w.offset, top); p.lineTo(w.offset + w.width, top); p.lineTo(w.offset + w.width, w.sill); p.closePath();
    shape.holes.push(p);
  }
  const geo = new THREE.ShapeGeometry(shape, 6);
  const pos = geo.attributes.position, uv = geo.attributes.uv, nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i), h = pos.getY(i);
    pos.setXYZ(i, W.a.x + W.ux * s, h, W.a.y + W.uy * s);
    uv.setXY(i, s / L, h / H);
    nrm.setXYZ(i, W.nx, 0, W.ny);
  }
  geo.computeBoundingSphere();
  return geo;
}

function floorGeometry(poly, bb) {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ShapeGeometry(shape, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv, nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setXYZ(i, x, 0, y);
    uv.setXY(i, (x - bb.minx) / bb.w, 1 - (y - bb.miny) / bb.h);
    nrm.setXYZ(i, 0, 1, 0);
  }
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  geo.index.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

export class Scene3D {
  constructor(host, { onPick, onBusy } = {}) {
    this.host = host;
    this.onPick = onPick || (() => {});
    this.onBusy = onBusy || (() => {});
    this.room = null; this.design = null; this.catalog = null;
    this.surfaces = new Map();
    this.wallGroups = [];
    this.queue = new Set();
    this.busy = false;
    this.needsRender = true;
    this.active = true;
    this.dirty = true;
    this.forceAllWalls = false;
    this.lightMode = 'tag';
    this.tween = null;
    this.pulses = [];

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    r.domElement.setAttribute('role', 'img');
    r.domElement.setAttribute('aria-label', '3D-Ansicht des Raums. Ziehen zum Drehen, Scrollen zum Zoomen.');
    r.domElement.tabIndex = 0;
    host.append(r.domElement);

    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();

    this.camera = new THREE.PerspectiveCamera(36, 1, 6, 8000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, rotateSpeed: 0.7, zoomSpeed: 0.9, panSpeed: 0.8, screenSpacePanning: true, minDistance: 40, maxPolarAngle: Math.PI / 2 - 0.02 });
    this.controls.addEventListener('change', () => { this.needsRender = true; });
    this.controls.addEventListener('start', () => { this.tween = null; });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2c8, 0.45);
    this.sun = new THREE.DirectionalLight(0xfff5e6, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.7;
    this.sun.shadow.radius = 3;
    this.lamp = new THREE.PointLight(0xffe2bd, 0, 0, 0);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.lamp);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.bindPicking();
    this.resize();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  // ------------------------------------------------------------- Eingaben
  bindPicking() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved > 5 || dt > 450) return;
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.onPick(id);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      el.style.cursor = this.pick(e.clientX, e.clientY) ? 'pointer' : 'grab';
    });
  }

  pick(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets = [];
    for (const [id, s] of this.surfaces) if (s.mesh && s.mesh.parent && s.mesh.parent.visible !== false) { s.mesh.userData.surface = id; targets.push(s.mesh); }
    const hit = ray.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.surface : null;
  }

  // ------------------------------------------------------------- Größe, Schleife
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  setActive(a) { this.active = a; if (a) { this.resize(); this.needsRender = true; if (this.dirty) this.rebuild(); } }
  invalidate() { this.needsRender = true; }

  _tick(t) {
    requestAnimationFrame(this._tick);
    if (!this.active) return;
    if (this.tween) {
      const k = Math.min(1, (t - this.tween.t0) / this.tween.dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e);
      this.controls.target.lerpVectors(this.tween.c0, this.tween.c1, e);
      if (k >= 1) this.tween = null;
      this.needsRender = true;
    }
    if (this.pulses.length) {
      this.pulses = this.pulses.filter((p) => {
        const k = (t - p.t0) / p.dur;
        if (k >= 1) { p.mesh.parent?.remove(p.mesh); p.mesh.material.dispose(); return false; }
        p.mesh.material.opacity = 0.34 * (1 - k) * (1 - k);
        return true;
      });
      this.needsRender = true;
    }
    const moved = this.controls.update();
    if (moved || this.needsRender) {
      this.updateWallVisibility();
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  }

  updateWallVisibility() {
    const cam = this.camera.position;
    for (const wg of this.wallGroups) {
      const u = wg.userData;
      wg.visible = this.forceAllWalls || (cam.x - u.px) * u.nx + (cam.z - u.pz) * u.nz > 0.5;
    }
  }

  // ------------------------------------------------------------- Daten
  setCatalog(cat) { this.catalog = cat; }

  setRoom(room) {
    this.room = room;
    if (!this.active) { this.dirty = true; return; }
    this.rebuild();
  }

  setDesign(design, surfaces = 'all') {
    this.design = design;
    if (!this.room) return;
    const ids = surfaces === 'all' ? [floorId, ...this.room.polygon.map((_, i) => wallId(i))] : surfaces;
    ids.forEach((id) => this.queue.add(id));
    this.pump();
  }

  setLight(mode) {
    this.lightMode = mode;
    const night = mode === 'abend';
    this.sun.color.set(night ? 0xffb470 : 0xfff5e6);
    this.sun.intensity = night ? 0.25 : 1.5;
    this.hemi.intensity = night ? 0.16 : 0.45;
    this.scene.environmentIntensity = night ? 0.2 : 0.55;
    this.lamp.intensity = night ? 1.25 : 0;
    this.renderer.toneMappingExposure = night ? 1.12 : 1.0;
    this.needsRender = true;
  }

  // ------------------------------------------------------------- Aufbau
  clearGroup() {
    this.group.traverse((o) => { if (o.isMesh && !o.userData.keepGeo) o.geometry?.dispose(); });
    this.group.clear();
    this.wallGroups = [];
  }

  surfaceFor(id) {
    let s = this.surfaces.get(id);
    if (!s) {
      s = { mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, bumpScale: 1.6, envMapIntensity: 0.9 }), sig: null, map: null, data: null, mesh: null };
      this.surfaces.set(id, s);
    }
    return s;
  }

  rebuild() {
    this.dirty = false;
    const room = this.room;
    if (!room) return;
    this.clearGroup();
    const W = wallInfo(room);
    const poly = room.polygon;
    const bb = polyBBox(poly);
    const H = room.height;
    const T = WALL_THICK;
    const outer = offsetPolygon(poly, T);

    // Flächen, die es nicht mehr gibt, entfernen
    for (const id of [...this.surfaces.keys()]) {
      if (id.startsWith('wall:') && parseInt(id.slice(5), 10) >= W.length) { this.disposeSurface(id); this.surfaces.delete(id); }
    }

    // Bodenplatte
    const plinthShape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, p.y)));
    const pg = new THREE.ExtrudeGeometry(plinthShape, { depth: 9, bevelEnabled: false });
    pg.rotateX(Math.PI / 2);
    pg.translate(0, -0.5, 0);
    const plinth = new THREE.Mesh(pg, plinthMat);
    plinth.receiveShadow = true;
    this.group.add(plinth);

    // Boden
    const fs = this.surfaceFor(floorId);
    const fm = new THREE.Mesh(floorGeometry(poly, bb), fs.mat);
    fm.receiveShadow = true;
    fs.mesh = fm;
    this.group.add(fm);

    // Wände
    W.forEach((w, i) => {
      const g = new THREE.Group();
      g.userData = { px: w.a.x, pz: w.a.y, nx: w.nx, nz: w.ny, wall: i };
      const ops = room.openings.filter((o) => o.wall === i);
      const s = this.surfaceFor(wallId(i));
      const m = new THREE.Mesh(wallGeometry(w, ops, H), s.mat);
      m.receiveShadow = true;
      s.mesh = m;
      g.add(m);
      // Oberkante der Wand
      const A = poly[i], B = poly[(i + 1) % poly.length], A2 = outer[i], B2 = outer[(i + 1) % poly.length];
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute([A.x, H, A.y, B.x, H, B.y, B2.x, H, B2.y, A2.x, H, A2.y], 3));
      cg.setIndex([0, 1, 2, 0, 2, 3]);
      cg.computeVertexNormals();
      g.add(new THREE.Mesh(cg, capMat));
      // Öffnungen
      for (const o of ops) g.add(this.buildOpening(w, o, H));
      this.group.add(g);
      this.wallGroups[i] = g;
    });

    // Ausstattung
    for (const f of room.fixtures) {
      const fg = buildFixture(f);
      fg.position.set(f.x, 0, f.y);
      fg.rotation.y = -rad(f.rot || 0);
      this.group.add(fg);
    }

    // Licht an Raumgröße anpassen
    const R = Math.hypot(bb.w, bb.h) / 2 + 60;
    const c = V3(bb.cx, 0, bb.cy);
    this.sun.position.set(c.x + R * 0.55, H + R * 1.5, c.z + R * 0.75);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 10; sc.far = H + R * 4;
    sc.updateProjectionMatrix();
    this.lamp.position.set(bb.cx, H - 12, bb.cy);
    this.setLight(this.lightMode);

    this.controls.maxDistance = Math.max(600, R * 7);
    // Texturen sicherstellen
    if (this.design) this.setDesign(this.design, 'all');
    this.needsRender = true;
  }

  disposeSurface(id) {
    const s = this.surfaces.get(id);
    if (!s) return;
    s.map?.dispose(); s.data?.dispose(); s.mat.dispose();
  }

  buildOpening(w, o, H) {
    const T = WALL_THICK;
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const u = V3(w.ux, 0, w.uy), n = V3(w.nx, 0, w.ny);
    g.matrix.makeBasis(u, V3(0, 1, 0), n).setPosition(w.a.x, 0, w.a.y);
    const s0 = o.offset, s1 = o.offset + o.width, cx = (s0 + s1) / 2;
    const isDoor = o.type === 'door';
    const bottom = isDoor ? 0 : o.sill;
    const top = Math.min(isDoor ? Math.min(o.height, H - 2) : o.sill + o.height, H - 2);
    const hgt = top - bottom;
    // Laibungen
    g.add(box(1, hgt, T, plasterMat, s0 + 0.5, bottom + hgt / 2, -T / 2, false));
    g.add(box(1, hgt, T, plasterMat, s1 - 0.5, bottom + hgt / 2, -T / 2, false));
    g.add(box(o.width, 1, T, plasterMat, cx, top - 0.5, -T / 2, false));
    if (!isDoor) g.add(box(o.width, 1, T, plasterMat, cx, bottom + 0.5, -T / 2, false));

    if (isDoor) {
      // Zarge
      const cw = 5.5;
      g.add(box(cw, hgt + cw, 1.6, casingMat, s0 - cw / 2 + 0.2, (hgt + cw) / 2, 0.8));
      g.add(box(cw, hgt + cw, 1.6, casingMat, s1 + cw / 2 - 0.2, (hgt + cw) / 2, 0.8));
      g.add(box(o.width + cw * 2 - 0.4, cw, 1.6, casingMat, cx, hgt + cw / 2, 0.8));
      // Türblatt
      const leaf = box(o.width - 1.5, hgt - 1, 4, doorMat, cx, (hgt - 1) / 2 + 0.5, -T / 2 + 1);
      g.add(leaf);
      // Füllung
      const inlay = box(o.width * 0.62, hgt * 0.36, 0.5, new THREE.MeshStandardMaterial({ color: 0xeceae3, roughness: 0.55 }), cx, hgt * 0.7, -T / 2 + 3.2, false);
      const inlay2 = box(o.width * 0.62, hgt * 0.36, 0.5, inlay.material, cx, hgt * 0.27, -T / 2 + 3.2, false);
      g.add(inlay, inlay2);
      // Drücker auf der freien Seite
      const free = o.hinge === 'rechts' ? s0 + 6 : s1 - 6;
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.8, 24), metalMat);
      rose.rotation.x = Math.PI / 2; rose.position.set(free, 104, -T / 2 + 3.4);
      const dir = o.hinge === 'rechts' ? 1 : -1;
      const lever = box(10, 1.5, 1.5, metalMat, free + dir * 4.6, 104, -T / 2 + 4.6);
      g.add(rose, lever);
    } else {
      // Fensterrahmen, Flügel, Glas
      const fw = 5;
      const zc = -T / 2;
      g.add(box(fw, hgt, 6, casingMat, s0 + fw / 2, bottom + hgt / 2, zc));
      g.add(box(fw, hgt, 6, casingMat, s1 - fw / 2, bottom + hgt / 2, zc));
      g.add(box(o.width, fw, 6, casingMat, cx, top - fw / 2, zc));
      g.add(box(o.width, fw, 6, casingMat, cx, bottom + fw / 2, zc));
      if (o.width > 125) g.add(box(4, hgt - fw * 2, 6, casingMat, cx, bottom + hgt / 2, zc));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(o.width - fw * 2, hgt - fw * 2), glassMat);
      glass.position.set(cx, bottom + hgt / 2, zc);
      g.add(glass);
      const day = new THREE.Mesh(new THREE.PlaneGeometry(o.width + 20, hgt + 20), daylightMat);
      day.position.set(cx, bottom + hgt / 2, -T - 4);
      g.add(day);
      // Fensterbank
      g.add(box(o.width + 8, 2.4, T + 3.5, stoneMat, cx, bottom + 1.2, -T / 2 + 1.75));
      const hx = o.hinge === 'rechts' ? s0 + 10 : s1 - 10;
      g.add(box(1.8, 9, 1.8, metalMat, hx, bottom + hgt / 2, zc + 3.6));
    }
    return g;
  }

  // ------------------------------------------------------------- Texturen
  pump() {
    if (this.busy || !this.queue.size) return;
    this.busy = true;
    this.onBusy(true);
    const step = () => {
      const id = this.queue.values().next().value;
      if (id === undefined) { this.busy = false; this.onBusy(false); return; }
      this.queue.delete(id);
      try { this.buildSurface(id); } catch (e) { console.error('Fläche konnte nicht gezeichnet werden', id, e); }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  buildSurface(id) {
    const room = this.room, design = this.design, cat = this.catalog;
    if (!room || !design || !cat) return;
    const isFloor = id === floorId;
    const idx = isFloor ? -1 : parseInt(id.slice(5), 10);
    const spec = isFloor ? design.floor : design.walls[idx];
    if (!spec) return;
    const surf = this.surfaceFor(id);
    const tile = tileOf(cat, spec.tile);
    const groutHex = groutOf(cat, spec.grout).color;
    const paintHex = paintOf(cat, design.paint).color;
    const trimHex = trimOf(cat, design.trim).color;
    const bb = polyBBox(room.polygon);
    const W = wallInfo(room);
    const maxPx = Math.min(this.renderer.capabilities.maxTextureSize, window.matchMedia('(pointer:coarse)').matches ? 1792 : 2560);
    const dims = isFloor ? { w: bb.w, h: bb.h } : { w: W[idx].len, h: room.height };
    const params = {
      kind: isFloor ? 'floor' : 'wall',
      widthCm: dims.w, heightCm: dims.h,
      polygon: isFloor ? room.polygon.map((p) => ({ x: p.x - bb.minx, y: p.y - bb.miny })) : null,
      tile, pattern: spec.pattern, rotated: !!spec.rotated, groutMm: spec.groutMm, groutColor: groutHex,
      offset: spec.offset || { x: 0, y: 0 }, tileHeightCm: isFloor ? null : spec.height, paintColor: paintHex, trimColor: isFloor ? null : trimHex,
      pxMax: 8, maxPx,
    };
    const sig = JSON.stringify([params.kind, Math.round(dims.w), Math.round(dims.h), isFloor ? room.polygon : 0, tile?.id, params.pattern, params.rotated, params.groutMm, groutHex, params.offset, params.tileHeightCm, paintHex, trimHex, maxPx]);
    if (surf.sig === sig) return;
    surf.sig = sig;
    const res = renderSurface(params);
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const mk = (canvas, srgb) => {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    };
    surf.map?.dispose(); surf.data?.dispose();
    surf.map = mk(res.map, true);
    surf.data = mk(res.data, false);
    surf.mat.map = surf.map;
    surf.mat.bumpMap = surf.data;
    surf.mat.roughnessMap = surf.data;
    surf.mat.needsUpdate = true;
    this.needsRender = true;
  }

  // ------------------------------------------------------------- Hervorheben
  pulse(ids) {
    if (!this.room) return;
    const list = ids === 'walls' ? this.room.polygon.map((_, i) => wallId(i)) : [ids];
    for (const id of list) {
      const s = this.surfaces.get(id);
      if (!s?.mesh) continue;
      const m = new THREE.Mesh(s.mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x19b5a8, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.userData.keepGeo = true;
      s.mesh.parent.add(m);
      this.pulses.push({ mesh: m, t0: performance.now(), dur: prefersReducedMotion() ? 300 : 1400 });
    }
    this.needsRender = true;
  }

  // ------------------------------------------------------------- Kamera
  frame() {
    const bb = polyBBox(this.room.polygon);
    const H = this.room.height;
    const vf = (this.camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const r = 0.5 * Math.hypot(bb.w, bb.h, H);
    return { bb, H, r, dist: (r / Math.sin(Math.min(vf, hf) / 2)) * 0.98 };
  }

  viewPose(name) {
    const { bb, H, r, dist } = this.frame();
    const center = V3(bb.cx, H * 0.3, bb.cy);
    if (name === 'top') {
      const d = dist * 1.02;
      return { pos: V3(bb.cx, d, bb.cy + 0.01), target: V3(bb.cx, 0, bb.cy), all: true };
    }
    if (name === 'enter') {
      const door = this.room.openings.find((o) => o.type === 'door');
      const W = wallInfo(this.room);
      if (door) {
        const w = W[door.wall];
        const s = door.offset + door.width / 2;
        const p = V3(w.a.x + w.ux * s + w.nx * 38, 150, w.a.y + w.uy * s + w.ny * 38);
        const look = V3(bb.cx - w.nx * 0, 105, bb.cy);
        const toC = V3(bb.cx - p.x, 0, bb.cy - p.z);
        if (toC.length() < 60) look.set(p.x + w.nx * 200, 105, p.z + w.ny * 200);
        return { pos: p, target: look, fov: 64 };
      }
      return { pos: V3(bb.minx + 30, 150, bb.maxy - 30), target: V3(bb.cx, 100, bb.cy), fov: 64 };
    }
    if (name.startsWith('wall:')) {
      const w = wallInfo(this.room)[parseInt(name.slice(5), 10)];
      const vf = (this.camera.fov * Math.PI) / 180;
      const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
      const d = Math.max((H / 2) / Math.tan(vf / 2), (w.len / 2) / Math.tan(hf / 2)) * 1.12 + 10;
      const mid = V3(w.a.x + (w.ux * w.len) / 2, H / 2, w.a.y + (w.uy * w.len) / 2);
      return { pos: mid.clone().add(V3(w.nx * d, 0, w.ny * d)), target: mid, wall: true };
    }
    // Überblick
    const dir = V3(0.55, 0.78, 0.92).normalize();
    return { pos: center.clone().add(dir.multiplyScalar(dist)), target: center };
  }

  goView(name = 'overview', { instant = false } = {}) {
    if (!this.room) return;
    this.currentView = name;
    this.forceAllWalls = name === 'top';
    const defaultFov = 36;
    this.camera.fov = defaultFov; this.camera.updateProjectionMatrix();
    const pose = this.viewPose(name);
    if (pose.fov) { this.camera.fov = pose.fov; this.camera.updateProjectionMatrix(); }
    const same = (a, b) => a.distanceTo(b) < 0.01;
    if (instant || prefersReducedMotion()) {
      this.camera.position.copy(pose.pos); this.controls.target.copy(pose.target);
      this.controls.update(); this.needsRender = true; return;
    }
    if (!same(pose.pos, this.camera.position)) {
      this.tween = { t0: performance.now(), dur: 700, p0: this.camera.position.clone(), p1: pose.pos, c0: this.controls.target.clone(), c1: pose.target };
    }
  }

  // ------------------------------------------------------------- Export
  /** Rendert ein Bild in hoher Auflösung mit hellem Hintergrund. */
  capture(width = 2200) {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const pr = r.getPixelRatio();
    const aspect = size.x / size.y;
    r.setPixelRatio(1);
    r.setSize(width, Math.round(width / aspect), false);
    r.setClearColor(0xe9eeec, 1);
    this.updateWallVisibility();
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    r.setClearColor(0x000000, 0);
    r.setPixelRatio(pr);
    r.setSize(size.x, size.y, false);
    this.needsRender = true;
    return url;
  }

  dispose() {
    this.ro.disconnect();
    this.renderer.dispose();
  }
}
