// 描画と入力。チャンクごとに world の owner / color をそのまま「ディスプレイ」として映す。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World, step, spawnPlayer, ensureAround, chunkKey, CHUNK, HEIGHT, VOXEL_METERS, TICK_SECONDS, cellIndex, floorDiv } from './world.js';
import { HUMAN_SIZE } from './humanoid.js';

const TICK_MS = TICK_SECONDS * 1000; // 1秒に25回、体の位置と姿勢を更新する
const VOXEL_SIZE = 0.94; // 1未満にして隙間を作り、ディスプレイの画素のように見せる
const VIEW_RADIUS = 5; // 描画するチャンクの半径
const SKY = 0xa9c9e8;

const world = new World({ seed: 20261004 });
const player = spawnPlayer(world);
ensureAround(world, player.pos[0], player.pos[2], VIEW_RADIUS);

// ---- three.js のセットアップ ----------------------------------------------

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 110, 190);

const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 25;
controls.maxDistance = 140;
controls.maxPolarAngle = Math.PI * 0.46;

const center = (e) => new THREE.Vector3(e.pos[0] + HUMAN_SIZE[0] / 2, e.pos[1] + HUMAN_SIZE[1] / 2, e.pos[2] + HUMAN_SIZE[2] / 2);
controls.target.copy(center(player));
camera.position.copy(controls.target).add(new THREE.Vector3(-28, 42, 58));
controls.update();

scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x4a5a3a, 1.5));
const sun = new THREE.DirectionalLight(0xfff3dd, 1.9);
sun.position.set(0.6, 1, 0.35);
scene.add(sun);

const geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
const material = new THREE.MeshLambertMaterial();

// チャンクごとの InstancedMesh
const meshes = new Map();
const matrix = new THREE.Matrix4();
const color = new THREE.Color();
const flash = new THREE.Color(0xffffff);
let highlight = new Set(); // 押し出された物体（一瞬明るくする）

function buildChunkMesh(chunk) {
  let lit = 0;
  for (const c of chunk.color) if (c) lit++;
  let mesh = meshes.get(chunk.key);
  if (!mesh || mesh.instanceMatrix.count < lit) {
    if (mesh) {
      scene.remove(mesh);
      mesh.dispose();
    }
    const capacity = Math.max(512, 1 << Math.ceil(Math.log2(lit)));
    mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.position.set(chunk.cx * CHUNK, 0, chunk.cz * CHUNK);
    mesh.frustumCulled = false;
    meshes.set(chunk.key, mesh);
    scene.add(mesh);
  }
  let n = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const i = cellIndex(x, y, z);
        if (!chunk.color[i]) continue;
        matrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
        mesh.setMatrixAt(n, matrix);
        color.setHex(chunk.color[i]);
        if (highlight.has(chunk.owner[i])) color.lerp(flash, 0.35);
        mesh.setColorAt(n, color);
        n++;
      }
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// プレイヤーの周りのチャンクを用意し、変わったチャンクだけ描き直す。遠いチャンクは片付ける。
function syncChunks() {
  const pcx = floorDiv(player.pos[0], CHUNK);
  const pcz = floorDiv(player.pos[2], CHUNK);
  ensureAround(world, player.pos[0], player.pos[2], VIEW_RADIUS);
  const near = (c) => Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= VIEW_RADIUS;
  for (const key of world.dirty) {
    const chunk = world.chunks.get(key);
    if (near(chunk)) buildChunkMesh(chunk);
  }
  world.dirty.clear();
  for (const [key, mesh] of meshes) {
    const chunk = world.chunks.get(key);
    if (!near(chunk)) {
      scene.remove(mesh);
      mesh.dispose();
      meshes.delete(key);
    }
  }
  for (const chunk of world.chunks.values()) {
    if (near(chunk) && !meshes.has(chunk.key)) buildChunkMesh(chunk);
  }
}

// 当たり判定の直方体（動く物だけ）
const hitboxGroup = new THREE.Group();
hitboxGroup.visible = false;
scene.add(hitboxGroup);
const hitboxes = new Map();
const hitboxMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });

function bounds(e) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let o = 0; o < e.offsets.length; o += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], e.offsets[o + a]);
      max[a] = Math.max(max[a], e.offsets[o + a] + 1);
    }
  }
  return { min, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function syncHitboxes() {
  if (!hitboxGroup.visible) return;
  for (const e of world.entities.values()) {
    if (e.kind === 'terrain') continue;
    const far = Math.max(Math.abs(e.pos[0] - player.pos[0]), Math.abs(e.pos[2] - player.pos[2])) > VIEW_RADIUS * CHUNK;
    let line = hitboxes.get(e.id);
    if (far) {
      if (line) line.visible = false;
      continue;
    }
    if (!line) {
      const { min, size } = bounds(e);
      const box = new THREE.BoxGeometry(...size);
      box.translate(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
      line = new THREE.LineSegments(new THREE.EdgesGeometry(box), hitboxMaterial);
      hitboxes.set(e.id, line);
      hitboxGroup.add(line);
    }
    line.visible = true;
    line.position.set(...e.pos);
  }
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---- 入力 -------------------------------------------------------------------

// 画面上の向き（前後左右）を、カメラの向きに最も近い世界の軸に合わせる。
// 2つのキーを同時に押すと斜め（8方向）。Shift を押している間は走る。
const KEYMAP = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
};
const held = [];
let running = false;
let runButton = false;

function worldDir(rel) {
  const fx = controls.target.x - camera.position.x;
  const fz = controls.target.z - camera.position.z;
  const f = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
  const r = [-f[1], f[0]];
  const d = { f, b: [-f[0], -f[1]], r, l: [-r[0], -r[1]] }[rel];
  return [d[0], 0, d[1]];
}

function playerInput() {
  let dx = 0;
  let dz = 0;
  for (const rel of held) {
    const [x, , z] = worldDir(rel);
    dx += x;
    dz += z;
  }
  dx = Math.sign(dx);
  dz = Math.sign(dz);
  return { dir: dx || dz ? [dx, dz] : null, run: running || runButton };
}

function press(rel) {
  if (!held.includes(rel)) held.push(rel);
}
function release(rel) {
  const i = held.indexOf(rel);
  if (i >= 0) held.splice(i, 1);
}

window.addEventListener('keydown', (e) => {
  running = e.shiftKey;
  if (KEYMAP[e.code]) {
    e.preventDefault();
    if (!e.repeat) press(KEYMAP[e.code]);
  } else if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.code === 'Period' && paused) {
    tick();
  }
});
window.addEventListener('keyup', (e) => {
  running = e.shiftKey;
  if (KEYMAP[e.code]) release(KEYMAP[e.code]);
});
window.addEventListener('blur', () => {
  held.length = 0;
  running = false;
});

const runBtn = document.querySelector('[data-run]');
runBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  runButton = !runButton;
  runBtn.setAttribute('aria-pressed', String(runButton));
});

for (const btn of document.querySelectorAll('[data-dir]')) {
  const rel = btn.dataset.dir;
  btn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    btn.setPointerCapture(e.pointerId);
    press(rel);
  });
  btn.addEventListener('pointerup', () => release(rel));
  btn.addEventListener('pointercancel', () => release(rel));
}

// ---- 出来事ログ ---------------------------------------------------------------

const logList = document.getElementById('log');
const tickLabel = document.getElementById('tick');
const posLabel = document.getElementById('pos');
const chunkLabel = document.getElementById('chunks');
const speedLabel = document.getElementById('speed');
const fmtP = (p) => (p === Infinity ? '∞' : p);

function describe(ev) {
  const a = ev.actor;
  const t = ev.target;
  if (ev.type === 'push') {
    return { cls: 'push', text: `${a.name} が ${t.name} を押し出した`, rule: `${fmtP(a.priority)} > ${fmtP(t.priority)}` };
  }
  if (ev.reason === 'edge') return { cls: 'block', text: `${a.name} は世界の端で止まった`, rule: '' };
  if (ev.via !== a) {
    const why = ev.reason === 'depth' ? `${ev.via.name} の後ろに ${t.name}` : `${ev.via.name} の先に ${t.name}`;
    return { cls: 'block', text: `${a.name} は ${ev.via.name} を押せない（${why}）`, rule: ev.reason === 'depth' ? '1段まで' : `${fmtP(a.priority)} ≤ ${fmtP(t.priority)}` };
  }
  return { cls: 'block', text: `${a.name} は ${t.name} に止められた`, rule: `${fmtP(a.priority)} ≤ ${fmtP(t.priority)}` };
}

// NPC が木にぶつかるたびに書くと流れてしまうので、プレイヤーが関わる出来事だけ記録する
function shouldLog(ev) {
  return ev.actor.kind === 'player' || ev.target?.kind === 'player';
}

function log(ev) {
  const { cls, text, rule } = describe(ev);
  // 直近の数行に同じ出来事があれば、回数を増やして先頭に移す
  const same = [...logList.children].slice(0, 3).find((li) => li.dataset.text === text);
  if (same) {
    const n = Number(same.dataset.count) + 1;
    same.dataset.count = n;
    same.querySelector('.t').textContent = world.tickCount;
    same.querySelector('.count').textContent = `×${n}`;
    logList.prepend(same);
    return;
  }
  const li = document.createElement('li');
  li.className = cls;
  li.dataset.text = text;
  li.dataset.count = 1;
  li.innerHTML = '<span class="t"></span><span class="msg"></span><span class="rule"></span><span class="count"></span>';
  li.querySelector('.t').textContent = world.tickCount;
  li.querySelector('.msg').textContent = text;
  li.querySelector('.rule').textContent = rule;
  logList.prepend(li);
  while (logList.children.length > 9) logList.lastElementChild.remove();
}

// ---- ゲームループ ---------------------------------------------------------------

let paused = false;
const pauseBtn = document.getElementById('pause');
const stepBtn = document.getElementById('step');

function setPaused(v) {
  paused = v;
  pauseBtn.textContent = paused ? '再開' : '一時停止';
  pauseBtn.setAttribute('aria-pressed', String(paused));
  stepBtn.disabled = !paused;
  stage.classList.toggle('paused', paused);
}
pauseBtn.addEventListener('click', () => setPaused(!paused));
stepBtn.addEventListener('click', () => tick());
document.getElementById('hitbox').addEventListener('change', (e) => {
  hitboxGroup.visible = e.target.checked;
  syncHitboxes();
});

function markOwners(ids) {
  // 光らせる / 光を消す物体のチャンクを描き直し対象にする
  for (const id of ids) {
    const e = world.entities.get(id);
    if (!e) continue;
    for (const [x, , z] of world.cellsOf(e)) world.dirty.add(chunkKey(floorDiv(x, CHUNK), floorDiv(z, CHUNK)));
  }
}

function tick() {
  const events = step(world, playerInput());
  const pushed = new Set();
  for (const ev of events) {
    if (ev.type === 'push') pushed.add(ev.target.id);
    if (shouldLog(ev)) log(ev);
  }
  markOwners(highlight);
  highlight = pushed;
  markOwners(highlight);
  syncChunks();
  syncHitboxes();
  tickLabel.textContent = world.tickCount;
  posLabel.textContent = `${(player.pos[0] * VOXEL_METERS).toFixed(1)}, ${(player.pos[2] * VOXEL_METERS).toFixed(1)} m`;
  speedLabel.textContent = `${(player.speed * VOXEL_METERS).toFixed(1)} m/s`;
  chunkLabel.textContent = world.chunks.size;
}

// カメラはプレイヤーをなめらかに追いかける（ボクセルの表示自体はコマ送りのまま）
const followed = new THREE.Vector3();
function follow(dt) {
  followed.copy(center(player));
  const k = 1 - Math.exp(-dt * 8);
  const delta = followed.sub(controls.target).multiplyScalar(k);
  controls.target.add(delta);
  camera.position.add(delta);
}

let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(now - last, 500);
  last = now;
  acc += dt;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    if (!paused) tick();
  }
  follow(dt / 1000);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
syncChunks();
tick();
requestAnimationFrame(frame);
