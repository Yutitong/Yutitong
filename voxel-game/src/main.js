// 描画と入力。world.js の cells / colors をそのまま「ディスプレイ」として映す。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World, buildDemo, step } from './world.js';

const TICK_MS = 125; // 1秒に8回更新
const VOXEL_SIZE = 0.9; // 1未満にして隙間を作り、LEDの粒のように見せる

const world = new World(20, 6, 20);
buildDemo(world);

// ---- three.js のセットアップ ----------------------------------------------

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f1c);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(-6, 24, 26);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.update();

scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1f33, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(8, 20, 6);
scene.add(sun);

// 点灯しているボクセル
const capacity = world.sx * world.sy * world.sz;
const voxels = new THREE.InstancedMesh(
  new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE),
  new THREE.MeshLambertMaterial(),
  capacity,
);
voxels.setColorAt(0, new THREE.Color()); // instanceColor を用意しておく
scene.add(voxels);

// 消灯しているボクセル（表示用の小さな点）
const ghostPositions = new Float32Array(capacity * 3);
const ghostGeometry = new THREE.BufferGeometry();
ghostGeometry.setAttribute('position', new THREE.BufferAttribute(ghostPositions, 3));
const ghosts = new THREE.Points(
  ghostGeometry,
  new THREE.PointsMaterial({ color: 0x46507a, size: 0.09, sizeAttenuation: true }),
);
scene.add(ghosts);

const ox = -world.sx / 2 + 0.5;
const oz = -world.sz / 2 + 0.5;
const matrix = new THREE.Matrix4();
const color = new THREE.Color();
const flash = new THREE.Color(0xffffff);

// cells / colors を読んで画面を更新する。highlight にある物体は一瞬明るくする。
function refresh(highlight = new Set()) {
  let lit = 0;
  let dark = 0;
  for (let y = 0; y < world.sy; y++) {
    for (let z = 0; z < world.sz; z++) {
      for (let x = 0; x < world.sx; x++) {
        const i = world.index(x, y, z);
        const id = world.cells[i];
        if (id) {
          matrix.makeTranslation(x + ox, y + 0.5, z + oz);
          voxels.setMatrixAt(lit, matrix);
          color.setHex(world.colors[i]);
          if (highlight.has(id)) color.lerp(flash, 0.35);
          voxels.setColorAt(lit, color);
          lit++;
        } else if (y > 0) {
          ghostPositions.set([x + ox, y + 0.5, z + oz], dark * 3);
          dark++;
        }
      }
    }
  }
  voxels.count = lit;
  voxels.instanceMatrix.needsUpdate = true;
  voxels.instanceColor.needsUpdate = true;
  ghostGeometry.setDrawRange(0, dark);
  ghostGeometry.attributes.position.needsUpdate = true;
  litCount.textContent = lit;
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // 縦長の画面でも世界全体が入るように距離を調整する
  const dist = 36 * Math.max(1, 1.1 / camera.aspect);
  camera.position.sub(controls.target).setLength(dist).add(controls.target);
}
new ResizeObserver(resize).observe(stage);

// ---- 入力 -------------------------------------------------------------------

// 画面上の向き（前後左右）を、カメラの向きに最も近い世界の軸に合わせる
const KEYMAP = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
};
const held = [];
let pending = null;

function worldDir(rel) {
  const fx = controls.target.x - camera.position.x;
  const fz = controls.target.z - camera.position.z;
  const f = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
  const r = [-f[1], f[0]];
  const d = { f, b: [-f[0], -f[1]], r, l: [-r[0], -r[1]] }[rel];
  return [d[0], 0, d[1]];
}

function press(rel) {
  pending = rel;
  if (!held.includes(rel)) held.push(rel);
}
function release(rel) {
  const i = held.indexOf(rel);
  if (i >= 0) held.splice(i, 1);
}

window.addEventListener('keydown', (e) => {
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
  if (KEYMAP[e.code]) release(KEYMAP[e.code]);
});
window.addEventListener('blur', () => (held.length = 0));

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
const litCount = document.getElementById('lit');
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

// NPC が壁にぶつかるたびに書くと流れてしまうので、プレイヤーが関わる出来事と押し出しだけ記録する
function shouldLog(ev) {
  if (ev.type === 'push') return true;
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
document.getElementById('ghost').addEventListener('change', (e) => (ghosts.visible = e.target.checked));

function tick() {
  const rel = pending ?? held[held.length - 1];
  pending = null;
  const events = step(world, rel ? worldDir(rel) : null);
  const pushed = new Set();
  for (const ev of events) {
    if (ev.type === 'push') pushed.add(ev.target.id);
    if (shouldLog(ev)) log(ev);
  }
  tickLabel.textContent = world.tickCount;
  refresh(pushed);
}

let last = performance.now();
let acc = 0;
function frame(now) {
  acc += Math.min(now - last, 500);
  last = now;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    if (!paused) tick();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
refresh();
requestAnimationFrame(frame);
