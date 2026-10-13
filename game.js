import * as THREE from 'three';

// ============================================================
//  Renderer / scene
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
renderer.domElement.id = 'game';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa8cbe6);
scene.fog = new THREE.Fog(0xa8cbe6, 45, 120);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.03, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

// The view-model (gun in hand) is drawn in its own scene so it never clips into walls.
const weaponScene = new THREE.Scene();
const weaponCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = weaponCam.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  weaponCam.updateProjectionMatrix();
});

scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x8a7350, 1.4));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.position.set(30, 55, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
sun.shadow.bias = -0.0006;
scene.add(sun);

weaponScene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 2.2));
const wLight = new THREE.DirectionalLight(0xffffff, 1.5);
wLight.position.set(1, 2, 1);
weaponScene.add(wLight);

const muzzleLight = new THREE.PointLight(0xffc066, 0, 9, 2);
scene.add(muzzleLight);

// ============================================================
//  Procedural textures
// ============================================================
function makeTexture(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function speckle(g, s, base, amount, count, size = 2) {
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * amount;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(Math.random() * s, Math.random() * s, size, size);
  }
}

const sandTex = makeTexture((g, s) => {
  speckle(g, s, '#c9a96e', 0.25, 9000);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(120,90,50,${Math.random() * 0.08})`;
    g.beginPath();
    g.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 30, 0, Math.PI * 2);
    g.fill();
  }
});
sandTex.repeat.set(20, 20);

function brickTexture(base) {
  return makeTexture((g, s) => {
    speckle(g, s, base, 0.18, 6000);
    g.strokeStyle = 'rgba(70,50,25,0.28)';
    g.lineWidth = 2;
    const rows = 8, h = s / rows;
    for (let r = 0; r < rows; r++) {
      g.beginPath(); g.moveTo(0, r * h); g.lineTo(s, r * h); g.stroke();
      const off = r % 2 ? s / 8 : 0;
      for (let x = off; x < s; x += s / 4) {
        g.beginPath(); g.moveTo(x, r * h); g.lineTo(x, (r + 1) * h); g.stroke();
      }
    }
  });
}
const wallTex = brickTexture('#d9c49b');
const wallTex2 = brickTexture('#b59a72');

const crateTex = makeTexture((g, s) => {
  speckle(g, s, '#8c5c2c', 0.2, 5000);
  g.strokeStyle = 'rgba(40,22,8,0.45)';
  g.lineWidth = 3;
  for (let y = s / 5; y < s; y += s / 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
  g.strokeStyle = '#4a2e12';
  g.lineWidth = 22;
  g.strokeRect(11, 11, s - 22, s - 22);
  g.lineWidth = 18;
  g.beginPath(); g.moveTo(20, 20); g.lineTo(s - 20, s - 20); g.stroke();
});

const metalTex = makeTexture((g, s) => {
  speckle(g, s, '#5f6b63', 0.15, 4000);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let x = 0; x < s; x += s / 8) g.fillRect(x, 0, 3, s);
});

const mats = {
  ground: new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }),
  wall2: new THREE.MeshStandardMaterial({ map: wallTex2, roughness: 0.95 }),
  crate: new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 }),
  metal: new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.6, metalness: 0.3 }),
};

// ============================================================
//  Map
// ============================================================
const colliders = [];   // axis-aligned boxes used for physics
const worldMeshes = []; // meshes bullets can hit

// Box geometry whose UVs repeat the texture every `scale` world units.
function scaledBox(w, h, d, scale) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / scale, uv.getY(k) * dims[f][1] / scale);
    }
  }
  return geo;
}

function addBox(x, z, w, d, h, mat, texScale = 2.5, y = 0) {
  const mesh = new THREE.Mesh(scaledBox(w, h, d, texScale), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  worldMeshes.push(mesh);
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y, maxY: y + h });
  return mesh;
}
const crate = (x, z, s = 1.2, y = 0) => addBox(x, z, s, s, s, mats.crate, s, y);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 66), mats.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
worldMeshes.push(ground);

// Outer walls
addBox(0, -32.5, 66, 1, 7, mats.wall);
addBox(0, 32.5, 66, 1, 7, mats.wall);
addBox(-32.5, 0, 1, 66, 7, mats.wall);
addBox(32.5, 0, 1, 66, 7, mats.wall);

// Mid divider with two narrow passages around a central block
addBox(-18, 0, 20, 1.2, 5, mats.wall);
addBox(18, 0, 20, 1.2, 5, mats.wall);
addBox(0, 0, 6, 6, 4.2, mats.wall2);

// Buildings
addBox(-22, -14, 8, 10, 5.5, mats.wall2);
addBox(22, 16, 10, 8, 5.5, mats.wall2);
addBox(-4, 15, 6, 4, 3.5, mats.wall2);
addBox(5, -14, 4, 6, 3.5, mats.wall2);

// Long walls / corridors
addBox(-10, 19, 1.2, 12, 4.5, mats.wall);
addBox(11, -20, 1.2, 12, 4.5, mats.wall);
addBox(-26, 10, 8, 1.2, 4, mats.wall);
addBox(26, -8, 8, 1.2, 4, mats.wall);

// Containers
addBox(16, 6, 6, 2.4, 2.6, mats.metal, 3);
addBox(-15, -6, 2.4, 6, 2.6, mats.metal, 3);

// "A" site crates (north-west)
crate(-21, 21, 2); crate(-19, 21, 2); crate(-21, 21, 1.3, 2);
crate(-16, 25, 1.2); crate(-25, 17, 1.4);
// "B" site crates (south-east)
crate(21, -16, 2); crate(21, -18, 2); crate(21, -16, 1.3, 2);
crate(16, -12, 1.2); crate(25, -22, 1.4); crate(26, -24, 1.1);
// Scattered cover
crate(-6, -6, 1.3); crate(6, 6, 1.3); crate(-3, 7, 1.1); crate(3, -8, 1.1);
crate(-12, -24, 1.4); crate(12, 25, 1.4); crate(-28, -28, 1.6); crate(28, 28, 1.6);
crate(-28, 2.5, 1.2); crate(28, -2.5, 1.2); crate(0, 22, 1.2); crate(0, -22, 1.2);

// ============================================================
//  Physics helpers
// ============================================================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

function circleHitsBox(x, z, r, c) {
  const dx = x - clamp(x, c.minX, c.maxX), dz = z - clamp(z, c.minZ, c.maxZ);
  return dx * dx + dz * dz < r * r;
}

// Push a cylinder (feet at pos.y) out of any boxes it overlaps.
function collide(pos, r, h, step) {
  for (const c of colliders) {
    if (c.maxY <= pos.y + step || c.minY >= pos.y + h) continue;
    const cx = clamp(pos.x, c.minX, c.maxX), cz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x += (dx / d) * (r - d);
      pos.z += (dz / d) * (r - d);
    } else {
      const pl = pos.x - c.minX, pr = c.maxX - pos.x, pb = pos.z - c.minZ, pf = c.maxZ - pos.z;
      const m = Math.min(pl, pr, pb, pf);
      if (m === pl) pos.x = c.minX - r; else if (m === pr) pos.x = c.maxX + r;
      else if (m === pb) pos.z = c.minZ - r; else pos.z = c.maxZ + r;
    }
  }
}

const STEP = 0.4;
function groundHeight(pos, r) {
  let g = 0;
  for (const c of colliders) {
    if (c.maxY <= pos.y + STEP && c.maxY > g && circleHitsBox(pos.x, pos.z, r * 0.85, c)) g = c.maxY;
  }
  return g;
}

function isFree(x, z, r) {
  if (Math.abs(x) > 31 - r || Math.abs(z) > 31 - r) return false;
  return !colliders.some(c => circleHitsBox(x, z, r, c));
}

const rayLOS = new THREE.Raycaster();
const _tmpDir = new THREE.Vector3();
function hasLOS(from, to) {
  _tmpDir.subVectors(to, from);
  const dist = _tmpDir.length();
  rayLOS.set(from, _tmpDir.normalize());
  rayLOS.far = dist;
  return rayLOS.intersectObjects(worldMeshes, false).length === 0;
}

// Navigation points for bot patrols: random free spots on the map.
const waypoints = [];
while (waypoints.length < 60) {
  const x = rand(-30, 30), z = rand(-30, 30);
  if (isFree(x, z, 0.9)) waypoints.push(new THREE.Vector2(x, z));
}

// ============================================================
//  Audio (synthesised, no files needed)
// ============================================================
let actx = null, noiseBuf = null;
function audio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return actx;
}

function playShot(vol = 1, tone = 1) {
  const a = audio(), t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(3200 * tone, t);
  f.frequency.exponentialRampToValueAtTime(400, t + 0.2);
  const g = a.createGain();
  g.gain.setValueAtTime(0.5 * vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + 0.3);

  const o = a.createOscillator(), og = a.createGain();
  o.frequency.setValueAtTime(160 * tone, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  og.gain.setValueAtTime(0.6 * vol, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(og).connect(a.destination);
  o.start(t);
  o.stop(t + 0.15);
}

function playBeep(freq, dur = 0.05, vol = 0.15, type = 'square') {
  const a = audio(), t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur);
}

// ============================================================
//  Effects: tracers, sparks, blood, bullet holes
// ============================================================
const effects = [];
const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
const dustMat = new THREE.MeshBasicMaterial({ color: 0xb79a6a });
const bloodMat = new THREE.MeshBasicMaterial({ color: 0x9a0d0d });
const holeGeo = new THREE.CircleGeometry(0.06, 8);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x1a1410, polygonOffset: true, polygonOffsetFactor: -4 });
const decals = [];

function spawnTracer(from, to, color = 0xfff2b0) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  effects.push({ obj: line, life: 0.06, max: 0.06, fade: true });
}

function spawnParticles(point, normal, mat, count, speed) {
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(sparkGeo, mat);
    p.position.copy(point);
    const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).multiplyScalar(speed);
    if (normal) v.addScaledVector(normal, speed);
    scene.add(p);
    effects.push({ obj: p, vel: v, life: rand(0.2, 0.45) });
  }
}

function spawnHole(point, normal) {
  const m = new THREE.Mesh(holeGeo, holeMat);
  m.position.copy(point).addScaledVector(normal, 0.01);
  m.lookAt(point.clone().add(normal));
  scene.add(m);
  decals.push(m);
  if (decals.length > 80) scene.remove(decals.shift());
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.vel) {
      e.vel.y -= 12 * dt;
      e.obj.position.addScaledVector(e.vel, dt);
    }
    if (e.fade) e.obj.material.opacity = Math.max(0, e.life / e.max) * 0.8;
    if (e.life <= 0) {
      scene.remove(e.obj);
      if (e.fade) { e.obj.geometry.dispose(); e.obj.material.dispose(); }
      effects.splice(i, 1);
    }
  }
}

// ============================================================
//  HUD
// ============================================================
const $ = id => document.getElementById(id);
const hud = {
  health: $('health'), healthBox: $('health-box'), ammo: $('ammo'), reserve: $('reserve'),
  weapon: $('weapon-name'), timer: $('timer'), round: $('round'), enemies: $('enemies'),
  scoreCT: $('scoreCT'), scoreT: $('scoreT'), kills: $('kills'), killfeed: $('killfeed'),
  center: $('center-msg'), hit: $('hitmarker'), damage: $('damage'), crosshair: $('crosshair'),
  overlay: $('overlay'), play: $('play'), radar: $('radar'),
};
const radarCtx = hud.radar.getContext('2d');
let centerTimer = 0, hitTimer = 0, damageFlash = 0;

function centerMsg(text, sub = '', time = 2.5) {
  hud.center.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  hud.center.classList.add('show');
  centerTimer = time;
}

function killFeed(killer, victim, headshot, playerKilled) {
  const d = document.createElement('div');
  d.innerHTML = `<span class="${playerKilled ? 'bot' : 'you'}">${killer}</span> ➜ ` +
    `<span class="${playerKilled ? 'you' : 'bot'}">${victim}</span>` + (headshot ? ' <span class="hs">HS</span>' : '');
  hud.killfeed.prepend(d);
  setTimeout(() => d.remove(), 5000);
  while (hud.killfeed.children.length > 5) hud.killfeed.lastChild.remove();
}

function showHit(kill) {
  hud.hit.classList.toggle('kill', kill);
  hud.hit.style.opacity = 1;
  hitTimer = 0.18;
}

// ============================================================
//  Weapons + view-model
// ============================================================
const WEAPONS = {
  rifle: { name: 'RIFLE', mag: 30, reserve: 90, rate: 0.1, auto: true, dmg: 34, reload: 2.3, spread: 0.004, recoil: 0.011, kick: 0.016, speed: 6.0, adsFov: 45, adsY: -0.044 },
  pistol: { name: 'PISTOL', mag: 12, reserve: 48, rate: 0.17, auto: false, dmg: 27, reload: 1.6, spread: 0.006, recoil: 0.02, kick: 0.022, speed: 6.5, adsFov: 58, adsY: -0.03 },
};
const PART_MULT = { head: 4, body: 1, legs: 0.75 };

function buildViewModel(type) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.5, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc8916a, roughness: 0.9 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x2b2f26, roughness: 0.9 });
  const box = (w, h, d, m, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    g.add(mesh);
    return mesh;
  };
  if (type === 'rifle') {
    box(0.07, 0.09, 0.55, dark, 0, 0, -0.1);
    box(0.06, 0.07, 0.22, wood, 0, -0.01, -0.42);           // handguard
    box(0.065, 0.11, 0.24, wood, 0, -0.03, 0.27);           // stock
    box(0.05, 0.18, 0.08, dark, 0, -0.12, -0.12, 0.35);     // magazine
    box(0.045, 0.12, 0.05, wood, 0, -0.09, 0.06, -0.3);     // grip
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -0.62);
    g.add(barrel);
    box(0.012, 0.04, 0.012, dark, 0, 0.06, -0.66);          // front sight
    box(0.08, 0.08, 0.2, glove, -0.03, -0.06, -0.38);       // left hand
    box(0.08, 0.08, 0.14, skin, 0.02, -0.11, 0.08);         // right hand
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.78);
  } else {
    box(0.05, 0.06, 0.24, dark, 0, 0, -0.08);               // slide
    box(0.045, 0.14, 0.06, dark, 0, -0.08, 0.0, -0.25);     // grip
    box(0.09, 0.09, 0.12, glove, 0, -0.1, 0.03);            // hand
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.21);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  flash.position.copy(g.userData.muzzle);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;
  g.scale.setScalar(0.7);
  g.visible = false;
  weaponScene.add(g);
  return g;
}

const inventory = {
  rifle: { def: WEAPONS.rifle, ammo: 30, reserve: 90, model: buildViewModel('rifle') },
  pistol: { def: WEAPONS.pistol, ammo: 12, reserve: 48, model: buildViewModel('pistol') },
};
let current = inventory.rifle;
const VM_BASE = new THREE.Vector3(0.19, -0.2, -0.56);

const weaponState = { cooldown: 0, reloading: 0, switching: 0, recoil: 0, kickAnim: 0, flashTime: 0, bob: 0, ads: 0 };
let aiming = false; // right mouse held

function setWeapon(key) {
  const next = inventory[key];
  if (!next || next === current) return;
  current.model.visible = false;
  current = next;
  current.model.visible = true;
  weaponState.reloading = 0;
  weaponState.switching = 0.45;
  playBeep(220, 0.04, 0.08);
  updateAmmoHud();
}

function updateAmmoHud() {
  hud.weapon.textContent = current.def.name;
  hud.ammo.textContent = current.ammo;
  hud.reserve.textContent = current.reserve;
}

function reload() {
  const w = current;
  if (weaponState.reloading > 0 || w.ammo >= w.def.mag || w.reserve <= 0 || !player.alive) return;
  weaponState.reloading = w.def.reload;
  playBeep(320, 0.05, 0.1);
}

function finishReload() {
  const w = current;
  const need = w.def.mag - w.ammo, take = Math.min(need, w.reserve);
  w.ammo += take;
  w.reserve -= take;
  playBeep(520, 0.05, 0.1);
  updateAmmoHud();
}

// ============================================================
//  Player
// ============================================================
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: Math.PI, pitch: 0,
  onGround: true, health: 100, alive: true, eye: 1.65, speed: 0,
};
const P_RADIUS = 0.35, P_HEIGHT = 1.8;

function damagePlayer(amount, attacker) {
  if (!player.alive || game.state !== 'playing') return;
  player.health = Math.max(0, player.health - amount);
  damageFlash = Math.min(1, damageFlash + 0.45);
  hud.health.textContent = Math.ceil(player.health);
  hud.healthBox.classList.toggle('low', player.health <= 25);
  playBeep(90, 0.08, 0.2, 'sawtooth');
  if (player.health <= 0) {
    player.alive = false;
    killFeed(attacker.name, 'You', false, true);
    endRound('T');
  }
}

// ============================================================
//  Bots
// ============================================================
const BOT_NAMES = ['Viper', 'Jackal', 'Cobra', 'Raven', 'Ghost', 'Hyena', 'Scorpion', 'Wolf', 'Falcon', 'Mamba', 'Rook', 'Shadow'];
const botMats = {
  skin: new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.9 }),
  mask: new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x6b5638, roughness: 0.9 }),
  vest: new THREE.MeshStandardMaterial({ color: 0x3e4430, roughness: 0.8 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 0.9 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.5 }),
};
const bots = [];

class Bot {
  constructor(x, z, name) {
    this.name = name;
    this.pos = new THREE.Vector3(x, 0, z);
    this.health = 100;
    this.dead = false;
    this.deathT = 0;
    this.yaw = 0;
    this.alert = false;
    this.lastSeen = new THREE.Vector3();
    this.lostTimer = 0;
    this.reaction = 0;
    this.shootCD = 0;
    this.strafeDir = 0;
    this.strafeTimer = 0;
    this.target = null;
    this.stuckTimer = 0;
    this.stuckRef = this.pos.clone();
    this.walkPhase = Math.random() * 10;
    this.spotted = 0;
    this.parts = [];

    const g = this.group = new THREE.Group();
    const part = (geo, mat, x, y, z, partName, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData = { bot: this, part: partName };
      parent.add(m);
      if (partName) this.parts.push(m);
      return m;
    };
    this.legL = new THREE.Group(); this.legL.position.set(-0.14, 0.85, 0); g.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.14, 0.85, 0); g.add(this.legR);
    part(new THREE.BoxGeometry(0.22, 0.85, 0.24), botMats.pants, 0, -0.425, 0, 'legs', this.legL);
    part(new THREE.BoxGeometry(0.22, 0.85, 0.24), botMats.pants, 0, -0.425, 0, 'legs', this.legR);
    part(new THREE.BoxGeometry(0.58, 0.68, 0.32), botMats.shirt, 0, 1.2, 0, 'body');
    part(new THREE.BoxGeometry(0.6, 0.45, 0.36), botMats.vest, 0, 1.25, 0, 'body');
    part(new THREE.BoxGeometry(0.3, 0.32, 0.3), botMats.mask, 0, 1.74, 0, 'head');
    part(new THREE.BoxGeometry(0.2, 0.06, 0.02), botMats.skin, 0, 1.77, 0.16, 'head'); // eye slit
    part(new THREE.BoxGeometry(0.16, 0.16, 0.5), botMats.shirt, -0.22, 1.32, 0.22, 'body'); // arms
    part(new THREE.BoxGeometry(0.16, 0.16, 0.5), botMats.shirt, 0.22, 1.32, 0.22, 'body');
    part(new THREE.BoxGeometry(0.08, 0.1, 0.75), botMats.gun, 0.05, 1.36, 0.55, null);
    g.position.copy(this.pos);
    scene.add(g);
  }

  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + 1.65, this.pos.z); }

  damage(amount, part) {
    if (this.dead) return false;
    this.health -= amount;
    spawnParticles(this.eye().setY(this.pos.y + (part === 'head' ? 1.74 : part === 'legs' ? 0.5 : 1.2)), null, bloodMat, 8, 2);
    if (!this.alert) this.reaction = rand(0.15, 0.3);
    this.alert = true;
    this.lastSeen.copy(player.pos);
    if (this.health <= 0) { this.die(); return true; }
    return false;
  }

  die() {
    this.dead = true;
    this.parts.forEach(p => (p.userData.part = null));
  }

  hear(pos) {
    if (this.dead || this.alert) return;
    this.alert = true;
    this.reaction = rand(0.3, 0.6);
    this.lastSeen.copy(pos);
    this.lostTimer = 0;
  }

  pickWaypoint() {
    const from = new THREE.Vector3(this.pos.x, 0.9, this.pos.z);
    for (let i = 0; i < 20; i++) {
      const w = waypoints[(Math.random() * waypoints.length) | 0];
      const to = new THREE.Vector3(w.x, 0.9, w.y);
      if (from.distanceTo(to) > 5 && hasLOS(from, to)) { this.target = w; return; }
    }
    this.target = waypoints[(Math.random() * waypoints.length) | 0];
  }

  moveToward(tx, tz, speed, dt) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    const s = Math.min(speed * dt, d);
    this.pos.x += (dx / d) * s;
    this.pos.z += (dz / d) * s;
    return d;
  }

  faceToward(tx, tz, dt, rate = 8) {
    const want = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    let diff = want - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, rate * dt);
    return Math.abs(diff);
  }

  shoot(dist) {
    const playerEye = camera.position.clone();
    const muzzle = this.eye().setY(this.pos.y + 1.4);
    const moving = player.speed > 3.2 ? 0.18 : 0;
    const airborne = player.onGround ? 0 : 0.12;
    const crouchBonus = player.eye < 1.4 ? 0.06 : 0;
    const chance = clamp(0.5 + game.round * 0.035 - dist * 0.009 - moving - airborne - crouchBonus, 0.1, 0.8);
    const hit = Math.random() < chance;
    const aim = playerEye.clone().add(new THREE.Vector3(0, -0.35, 0));
    if (!hit) aim.add(new THREE.Vector3(rand(-1, 1), rand(-0.6, 0.8), rand(-1, 1)).multiplyScalar(0.6 + dist * 0.02));
    spawnTracer(muzzle, aim, 0xffc870);
    playShot(clamp(1.2 - dist / 40, 0.12, 0.8), 0.85);
    if (hit) damagePlayer(Math.round(rand(8, 15) * (Math.random() < 0.08 ? 2.5 : 1)), this);
  }

  update(dt) {
    if (this.dead) {
      this.deathT += dt;
      this.group.rotation.x = -Math.min(1, this.deathT * 3.5) * Math.PI / 2;
      this.group.position.y = Math.min(1, this.deathT * 3.5) * 0.18;
      return;
    }
    const eye = this.eye();
    const playerChest = camera.position.clone().add(new THREE.Vector3(0, -0.3, 0));
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    let sees = false;
    if (player.alive && dist < 55) {
      let ang = Math.atan2(dx, dz) - this.yaw;
      ang = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)));
      if (this.alert || ang < 1.25 || dist < 3) sees = hasLOS(eye, playerChest);
    }

    const before = this.pos.clone();
    let moveSpeed = 0;

    if (sees) {
      if (!this.alert) this.reaction = rand(0.45, 0.85) / (1 + game.round * 0.08);
      this.alert = true;
      this.spotted = 2;
      this.lastSeen.copy(player.pos);
      this.lostTimer = 0;
      this.faceToward(player.pos.x, player.pos.z, dt, 10);
      this.reaction -= dt;

      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeDir = [-1, 0, 1][(Math.random() * 3) | 0]; this.strafeTimer = rand(0.5, 1.4); }
      if (this.strafeDir) {
        const sx = (dz / dist) * this.strafeDir, sz = (-dx / dist) * this.strafeDir;
        this.pos.x += sx * 2.2 * dt;
        this.pos.z += sz * 2.2 * dt;
        moveSpeed = 2.2;
      }
      if (dist > 22) { this.moveToward(player.pos.x, player.pos.z, 2.5, dt); moveSpeed = 2.5; }

      if (this.reaction <= 0) {
        this.shootCD -= dt;
        if (this.shootCD <= 0) {
          this.shoot(dist);
          this.shootCD = Math.random() < 0.6 ? rand(0.1, 0.16) : rand(0.35, 0.8); // short bursts
        }
      }
    } else if (this.alert) {
      this.lostTimer += dt;
      this.faceToward(this.lastSeen.x, this.lastSeen.z, dt);
      const d = this.moveToward(this.lastSeen.x, this.lastSeen.z, 3.6, dt);
      moveSpeed = 3.6;
      if (d < 1.2 || this.lostTimer > 7) { this.alert = false; this.target = null; }
    } else {
      if (!this.target) this.pickWaypoint();
      this.faceToward(this.target.x, this.target.y, dt, 5);
      const d = this.moveToward(this.target.x, this.target.y, 2.4, dt);
      moveSpeed = 2.4;
      if (d < 0.8) this.pickWaypoint();
    }

    collide(this.pos, 0.4, 1.8, STEP);
    this.pos.y = groundHeight(this.pos, 0.4);
    this.pos.x = clamp(this.pos.x, -31.5, 31.5);
    this.pos.z = clamp(this.pos.z, -31.5, 31.5);

    // Unstick: if barely moving while trying to, pick somewhere else to go.
    this.stuckTimer += dt;
    if (this.stuckTimer > 1.2) {
      if (moveSpeed > 0 && this.pos.distanceTo(this.stuckRef) < 0.4) {
        if (!sees) { this.alert = false; this.pickWaypoint(); }
      }
      this.stuckRef.copy(this.pos);
      this.stuckTimer = 0;
    }

    const actual = before.distanceTo(this.pos) / Math.max(dt, 1e-4);
    this.walkPhase += dt * actual * 3.2;
    const swing = Math.sin(this.walkPhase) * Math.min(1, actual / 2) * 0.6;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.spotted = Math.max(0, this.spotted - dt);

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }
}

function clearBots() {
  for (const b of bots) scene.remove(b.group);
  bots.length = 0;
}

function spawnBots(n) {
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    let x, z, tries = 0;
    do { x = rand(-14, 14); z = rand(23, 30); tries++; } while ((!isFree(x, z, 0.6) || bots.some(b => Math.hypot(b.pos.x - x, b.pos.z - z) < 1.5)) && tries < 200);
    const b = new Bot(x, z, names[i % names.length]);
    b.yaw = Math.PI;
    bots.push(b);
  }
}

const aliveBots = () => bots.filter(b => !b.dead);

// ============================================================
//  Shooting
// ============================================================
const shootRay = new THREE.Raycaster();
let mouseDown = false;

function fire() {
  const w = current, ws = weaponState;
  if (game.state !== 'playing' || !player.alive || ws.cooldown > 0 || ws.reloading > 0 || ws.switching > 0) return;
  if (w.ammo <= 0) {
    playBeep(900, 0.02, 0.08);
    ws.cooldown = 0.25;
    if (w.reserve > 0) reload();
    return;
  }
  w.ammo--;
  ws.cooldown = w.def.rate;
  updateAmmoHud();

  const spread = currentSpread();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
  const dir = fwd.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();

  shootRay.set(camera.position, dir);
  shootRay.far = 200;
  const targets = worldMeshes.concat(...aliveBots().map(b => b.parts));
  const hit = shootRay.intersectObjects(targets, false)[0];
  const end = hit ? hit.point : camera.position.clone().addScaledVector(dir, 200);

  const muzzleWorld = camera.position.clone()
    .addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), 0.22)
    .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), -0.16)
    .addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), 0.7);
  spawnTracer(muzzleWorld, end);

  if (hit) {
    const ud = hit.object.userData;
    if (ud.bot && ud.part) {
      const bot = ud.bot, part = ud.part;
      const killed = bot.damage(w.def.dmg * PART_MULT[part], part);
      showHit(killed);
      playBeep(killed ? 1400 : 1100, 0.04, 0.12);
      if (killed) {
        game.kills++;
        hud.kills.textContent = game.kills;
        killFeed('You', bot.name, part === 'head', false);
        hud.enemies.textContent = aliveBots().length;
        if (aliveBots().length === 0) endRound('CT');
      }
    } else if (hit.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      spawnHole(hit.point, n);
      spawnParticles(hit.point, n, Math.random() < 0.5 ? sparkMat : dustMat, 5, 2.5);
    }
  }

  // Alert bots that can hear the shot.
  for (const b of aliveBots()) if (b.pos.distanceTo(player.pos) < 28) b.hear(player.pos);

  // Recoil
  ws.recoil = Math.min(ws.recoil + w.def.recoil, 0.09);
  player.pitch = clamp(player.pitch + w.def.kick * rand(0.6, 1), -1.5, 1.5);
  player.yaw += rand(-0.5, 0.5) * w.def.kick * 0.6;
  ws.kickAnim = 1;
  ws.flashTime = 0.05;
  w.model.userData.flash.rotation.z = Math.random() * Math.PI;
  muzzleLight.position.copy(muzzleWorld);
  muzzleLight.intensity = 6;
  playShot(1, current === inventory.rifle ? 1 : 1.3);
}

function currentSpread() {
  let s = current.def.spread + weaponState.recoil;
  if (player.speed > 3.4) s += 0.035;
  else if (player.speed > 0.5) s += 0.008;
  if (!player.onGround) s += 0.09;
  if (player.eye < 1.4) s *= 0.65;
  return s * (1 - 0.6 * weaponState.ads);
}

// ============================================================
//  Input
// ============================================================
const keys = {};
let locked = false;
const SENS = 0.0022;

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') reload();
  if (e.code === 'Digit1') setWeapon('rifle');
  if (e.code === 'Digit2') setWeapon('pistol');
  if (e.code === 'KeyQ') setWeapon(current === inventory.rifle ? 'pistol' : 'rifle');
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });

document.addEventListener('mousemove', e => {
  if (!locked) return;
  const sens = SENS * camera.fov / 75; // slower turning while zoomed
  player.yaw -= e.movementX * sens;
  player.pitch = clamp(player.pitch - e.movementY * sens, -1.5, 1.5);
});
document.addEventListener('mousedown', e => {
  if (!locked) return;
  if (e.button === 2) { aiming = true; return; }
  if (e.button !== 0) return;
  mouseDown = true;
  fire();
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) aiming = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', () => { if (locked) setWeapon(current === inventory.rifle ? 'pistol' : 'rifle'); });

hud.play.addEventListener('click', () => {
  audio().resume();
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => { hud.play.textContent = 'CLICK AGAIN TO PLAY'; });
  } catch { hud.play.textContent = 'CLICK AGAIN TO PLAY'; }
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  hud.overlay.classList.toggle('hidden', locked);
  if (locked && game.state === 'menu') startRound();
  if (!locked) { mouseDown = false; aiming = false; hud.play.textContent = 'CLICK TO RESUME'; }
});

// ============================================================
//  Game flow
// ============================================================
const ROUND_TIME = 115;
const game = { state: 'menu', round: 0, ct: 0, t: 0, kills: 0, timeLeft: ROUND_TIME, endTimer: 0 };

function resetPlayer() {
  let x, z;
  do { x = rand(-6, 6); z = rand(-30, -26); } while (!isFree(x, z, 0.5));
  player.pos.set(x, 0, z);
  player.vel.set(0, 0, 0);
  player.yaw = Math.PI;
  player.pitch = 0;
  player.health = 100;
  player.alive = true;
  player.onGround = true;
  hud.health.textContent = 100;
  hud.healthBox.classList.remove('low');
  for (const w of Object.values(inventory)) { w.ammo = w.def.mag; w.reserve = w.def.reserve; }
  Object.assign(weaponState, { cooldown: 0, reloading: 0, switching: 0.3, recoil: 0, ads: 0 });
  current.model.visible = false;
  current = inventory.rifle;
  current.model.visible = true;
  updateAmmoHud();
}

function startRound() {
  game.round++;
  game.state = 'playing';
  game.timeLeft = ROUND_TIME;
  clearBots();
  resetPlayer();
  spawnBots(Math.min(3 + Math.floor(game.round / 2), 8));
  hud.round.textContent = game.round;
  hud.enemies.textContent = aliveBots().length;
  centerMsg(`ROUND ${game.round}`, `${aliveBots().length} terrorists. Eliminate them all.`);
}

function endRound(winner) {
  if (game.state !== 'playing') return;
  game.state = 'roundEnd';
  game.endTimer = 4;
  if (winner === 'CT') {
    game.ct++;
    centerMsg('<span style="color:#8ec5ff">COUNTER-TERRORISTS WIN</span>', 'Next round starting…', 4);
  } else {
    game.t++;
    centerMsg('<span style="color:#f2c46d">TERRORISTS WIN</span>', player.alive ? "Time's up" : 'You were eliminated', 4);
  }
  hud.scoreCT.textContent = game.ct;
  hud.scoreT.textContent = game.t;
}

// ============================================================
//  Update loop
// ============================================================
function updatePlayer(dt) {
  if (!player.alive) {
    player.eye = Math.max(0.3, player.eye - dt * 2.5);
    camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, Math.min(0.5, (1.65 - player.eye)));
    return;
  }
  const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const wish = new THREE.Vector3();
  if (keys.KeyW || keys.ArrowUp) wish.add(fwd);
  if (keys.KeyS || keys.ArrowDown) wish.sub(fwd);
  if (keys.KeyD || keys.ArrowRight) wish.add(right);
  if (keys.KeyA || keys.ArrowLeft) wish.sub(right);
  if (wish.lengthSq() > 0) wish.normalize();

  const crouch = keys.KeyC || keys.ControlLeft;
  const walk = keys.ShiftLeft || keys.ShiftRight;
  const speed = (crouch ? 2.2 : walk ? 3 : current.def.speed) * (1 - 0.4 * weaponState.ads);
  const accel = player.onGround ? 12 : 2.5;
  const k = Math.min(1, accel * dt);
  player.vel.x += (wish.x * speed - player.vel.x) * k;
  player.vel.z += (wish.z * speed - player.vel.z) * k;

  if (keys.Space && player.onGround) { player.vel.y = 7; player.onGround = false; }
  player.vel.y -= 20 * dt;

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  collide(player.pos, P_RADIUS, P_HEIGHT, player.onGround ? STEP : 0.02);

  player.pos.y += player.vel.y * dt;
  const gh = groundHeight(player.pos, P_RADIUS);
  if (player.pos.y <= gh) {
    player.pos.y = gh; player.vel.y = 0; player.onGround = true;
  } else if (player.onGround && player.vel.y <= 0 && player.pos.y - gh < STEP) {
    player.pos.y = gh; player.vel.y = 0; // step down smoothly
  } else {
    player.onGround = false;
  }

  player.speed = Math.hypot(player.vel.x, player.vel.z);
  player.eye += ((crouch ? 1.15 : 1.65) - player.eye) * Math.min(1, dt * 12);
  camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

function updateWeapon(dt) {
  const ws = weaponState, model = current.model;
  ws.cooldown = Math.max(0, ws.cooldown - dt);
  ws.switching = Math.max(0, ws.switching - dt);
  ws.recoil = Math.max(0, ws.recoil - dt * (mouseDown ? 0.05 : 0.18));
  ws.kickAnim = Math.max(0, ws.kickAnim - dt * 12);
  if (ws.reloading > 0) {
    ws.reloading -= dt;
    if (ws.reloading <= 0) { ws.reloading = 0; finishReload(); }
  }
  if (mouseDown && current.def.auto) fire();

  // View-model placement: bob, kick, reload dip, switch raise
  ws.bob += dt * player.speed * (player.onGround ? 1.6 : 0);
  const bobX = Math.sin(ws.bob) * 0.012 * Math.min(1, player.speed / 3);
  const bobY = Math.abs(Math.cos(ws.bob)) * 0.012 * Math.min(1, player.speed / 3);
  let dip = 0, tilt = 0;
  if (ws.reloading > 0) {
    const p = 1 - ws.reloading / current.def.reload;
    dip = Math.sin(p * Math.PI) * 0.18;
    tilt = Math.sin(p * Math.PI) * 0.7;
  }
  if (ws.switching > 0) dip += ws.switching * 0.6;
  const canAim = aiming && player.alive && ws.reloading <= 0 && ws.switching <= 0;
  ws.ads += ((canAim ? 1 : 0) - ws.ads) * Math.min(1, dt * 12);
  const a = ws.ads, hip = 1 - a * 0.85;
  camera.fov = 75 + (current.def.adsFov - 75) * a;
  camera.updateProjectionMatrix();
  model.position.set(
    VM_BASE.x * (1 - a) + bobX * hip,
    VM_BASE.y + (current.def.adsY - VM_BASE.y) * a + bobY * hip - dip,
    VM_BASE.z - 0.16 * a + ws.kickAnim * 0.05 * hip);
  model.rotation.set(ws.kickAnim * 0.08 - tilt * 0.4, 0, tilt * 0.5);
  model.visible = player.alive;

  ws.flashTime -= dt;
  model.userData.flash.visible = ws.flashTime > 0;
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 120);

  const gap = 5 + currentSpread() * 260;
  hud.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  hud.crosshair.style.opacity = 1 - Math.min(1, ws.ads * 1.5);
}

function updateHud(dt) {
  const t = Math.max(0, Math.ceil(game.timeLeft));
  hud.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  hud.timer.classList.toggle('low', t <= 15);

  if (centerTimer > 0) { centerTimer -= dt; if (centerTimer <= 0) hud.center.classList.remove('show'); }
  if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) hud.hit.style.opacity = 0; }
  damageFlash = Math.max(0, damageFlash - dt * 1.5);
  hud.damage.style.opacity = damageFlash;
  drawRadar();
}

function drawRadar() {
  const c = radarCtx, S = 170, scale = 2.4;
  c.clearRect(0, 0, S, S);
  c.save();
  c.beginPath();
  c.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  c.clip();
  c.translate(S / 2, S / 2);
  c.rotate(player.yaw);
  c.fillStyle = 'rgba(200,180,140,0.55)';
  for (const col of colliders) {
    c.fillRect((col.minX - player.pos.x) * scale, (col.minZ - player.pos.z) * scale,
      (col.maxX - col.minX) * scale, (col.maxZ - col.minZ) * scale);
  }
  for (const b of bots) {
    if (!b.dead && b.spotted <= 0) continue;
    c.fillStyle = b.dead ? 'rgba(120,120,120,0.8)' : '#ff4a3a';
    c.beginPath();
    c.arc((b.pos.x - player.pos.x) * scale, (b.pos.z - player.pos.z) * scale, b.dead ? 2.5 : 4, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  // Player arrow (always points up)
  c.fillStyle = '#8ec5ff';
  c.beginPath();
  c.moveTo(S / 2, S / 2 - 7);
  c.lineTo(S / 2 - 5, S / 2 + 5);
  c.lineTo(S / 2 + 5, S / 2 + 5);
  c.closePath();
  c.fill();
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const running = game.state !== 'menu' && locked;

  if (running) {
    if (game.state === 'playing') {
      game.timeLeft -= dt;
      if (game.timeLeft <= 0) endRound('T');
    } else if (game.state === 'roundEnd') {
      game.endTimer -= dt;
      if (game.endTimer <= 0) startRound();
    }
    updatePlayer(dt);
    for (const b of bots) b.update(dt);
    updateWeapon(dt);
    updateEffects(dt);
    updateHud(dt);
  } else if (game.state === 'menu') {
    // Slow fly-over behind the menu
    const t = performance.now() * 0.00005;
    camera.position.set(Math.sin(t) * 26, 16, Math.cos(t) * 26);
    camera.lookAt(0, 0, 0);
  }

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  if (game.state !== 'menu') renderer.render(weaponScene, weaponCam);
}
frame();

// Handy for debugging from the browser console.
window.cs = { game, player, bots, inventory, weaponState };
