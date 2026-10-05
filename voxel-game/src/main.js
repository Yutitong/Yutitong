// 描画と入力。チャンクごとに world の owner / color をそのまま「ディスプレイ」として映す。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World, step, spawnPlayer, ensureAround, forgetFar, chunkKey, CHUNK, VOXEL_METERS, TICK_SECONDS, WATER_FLAG, floorDiv } from './world.js';
import { HUMAN_SIZE } from './humanoid.js';
import { spawnDragon, DRAGON_MODES } from './dragon.js';
import { FarTerrain } from './far.js';
import { LAYER } from './grid.js';

const TICK_MS = TICK_SECONDS * 1000; // 1秒に25回、体の位置と姿勢を更新する
const VOXEL_SIZE = 1.002; // 隙間なく密着させる（わずかに重ねて、継ぎ目に細い線が出ないようにする）
const VIEW_RADIUS = 6; // 描画するチャンクの半径
const KEEP_RADIUS = 24; // これより遠いチャンクは片付ける
const LOAD_BUDGET_MS = 7; // 1フレームでチャンク作りに使ってよい時間
const FAR_BUDGET_MS = 3; // 1フレームで遠景作りに使ってよい時間
const SKY = 0xa9c9e8;

const world = new World({ seed: 20261004 });
const player = spawnPlayer(world);
ensureAround(world, player.pos[0], player.pos[2], 2); // 足元だけ先に作り、残りは少しずつ
const dragon = spawnDragon(world, player.pos);

// ---- three.js のセットアップ ----------------------------------------------

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 600, 2300);

const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 4000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 25;
controls.maxDistance = 420;
controls.maxPolarAngle = Math.PI * 0.47;

const center = (e) => new THREE.Vector3(e.pos[0] + HUMAN_SIZE[0] / 2, e.pos[1] + HUMAN_SIZE[1] / 2, e.pos[2] + HUMAN_SIZE[2] / 2);
controls.target.copy(center(player));
camera.position.copy(controls.target).add(new THREE.Vector3(-34, 40, 66));
controls.update();

scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x4a5a3a, 1.5));
const sun = new THREE.DirectionalLight(0xfff3dd, 1.9);
sun.position.set(0.6, 1, 0.35);
scene.add(sun);

// ---- ボクセルの描画 ---------------------------------------------------------
//
// チャンクごとに1つのメッシュ。ボクセル1つ = 箱1つ（インスタンス）で、
// 各インスタンスは「チャンク内の位置・表示するか」と「色」だけを持つ。
// セルが変わったら、そのセルのインスタンスだけ書き換える。

const box = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
// 水面（滝の段で側面も見えるので、ほかのボクセルと同じ大きさ）
const waterBox = new THREE.BoxGeometry(1, 1, 1);
const cutaway = { uHead: { value: new THREE.Vector3() }, uCut: { value: 1 } };

// ボクセル用のマテリアル。インスタンスごとの位置・表示・色をシェーダーで読む
function voxelMaterial(options) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...options });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHead = cutaway.uHead;
    shader.uniforms.uCut = cutaway.uCut;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 iCell;\nuniform vec3 uHead;\nuniform float uCut;')
      .replace('#include <color_vertex>', 'vColor = pow(color, vec3(2.2));') // 色は sRGB で持っている
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float show = iCell.w;
        // カメラとプレイヤーの頭の間にある、頭より高いボクセル（木の葉など）は消して見通す
        vec3 wc = (modelMatrix * vec4(iCell.xyz, 1.0)).xyz;
        vec3 seg = uHead - cameraPosition;
        float t = clamp(dot(wc - cameraPosition, seg) / dot(seg, seg), 0.0, 1.0);
        float d = length(wc - (cameraPosition + seg * t));
        if (uCut > 0.5 && t < 0.97 && wc.y > uHead.y - 3.0 && d < 10.0) show = 0.0;
        transformed = transformed * show + iCell.xyz;
      `);
  };
  return m;
}
const solidMaterial = voxelMaterial();
const waterMaterial = voxelMaterial({ transparent: true, opacity: 0.72, depthWrite: false });

const views = new Map(); // チャンク key → 描画の状態
let highlight = new Set(); // 押し出された物体（一瞬明るくする）

// 1つのメッシュ（不透明 / 水）。セル番号 → インスタンス番号の対応を持つ
function makeLayer(chunk, capacity, shape, material) {
  const geo = new THREE.InstancedBufferGeometry();
  // 箱の形はチャンクごとに複製する（共有すると、片付けたチャンクと一緒に消されてしまう）
  geo.setIndex(shape.index.clone());
  geo.setAttribute('position', shape.attributes.position.clone());
  geo.setAttribute('normal', shape.attributes.normal.clone());
  const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const rgbAttr = new THREE.InstancedBufferAttribute(new Uint8Array(capacity * 3), 3, true);
  cellAttr.setUsage(THREE.DynamicDrawUsage);
  rgbAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iCell', cellAttr);
  geo.setAttribute('color', rgbAttr);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(chunk.cx * CHUNK, 0, chunk.cz * CHUNK);
  mesh.frustumCulled = false;
  if (material.transparent) mesh.renderOrder = 1;
  scene.add(mesh);
  return {
    mesh, geo, cellAttr, rgbAttr, cell: cellAttr.array, rgb: rgbAttr.array,
    slots: new Map(), count: 0, hidden: 0, capacity, lo: Infinity, hi: -1,
    touch(slot) {
      if (slot < this.lo) this.lo = slot;
      if (slot > this.hi) this.hi = slot;
    },
    hide(i) {
      const slot = this.slots.get(i);
      if (slot === undefined || this.cell[slot * 4 + 3] === 0) return;
      this.cell[slot * 4 + 3] = 0;
      this.hidden++;
      this.touch(slot);
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
    },
  };
}

// セル i の色を、そのセルの層（不透明 / 水）に書く。入りきらなければ false
function writeCell(v, chunk, i) {
  const c = chunk.color[i];
  const water = (c & WATER_FLAG) !== 0;
  const layer = water ? v.water : v.solid;
  (water ? v.solid : v.water).hide(i);
  if (!c) {
    layer.hide(i);
    return true;
  }
  let slot = layer.slots.get(i);
  if (slot === undefined) {
    if (layer.count >= layer.capacity) return false;
    slot = layer.count++;
    layer.slots.set(i, slot);
    const lx = i % CHUNK, lz = Math.floor(i / CHUNK) % CHUNK, y = chunk.yOf(i);
    layer.cell.set([lx + 0.5, y + 0.5, lz + 0.5, 1], slot * 4);
  } else if (layer.cell[slot * 4 + 3] === 0) {
    layer.cell[slot * 4 + 3] = 1;
    layer.hidden--;
  }
  const f = highlight.has(chunk.owner[i]) ? 0.35 : 0;
  layer.rgb[slot * 3] = ((c >> 16) & 255) * (1 - f) + 255 * f;
  layer.rgb[slot * 3 + 1] = ((c >> 8) & 255) * (1 - f) + 255 * f;
  layer.rgb[slot * 3 + 2] = (c & 255) * (1 - f) + 255 * f;
  layer.touch(slot);
  return true;
}

// チャンクの描画を一から作る（初回・入りきらないとき・隠れたインスタンスが増えたとき）
function buildView(chunk) {
  const old = views.get(chunk.key);
  if (old) {
    old.solid.dispose();
    old.water.dispose();
  }
  const limit = Math.min(chunk.color.length, LAYER * (chunk.top - chunk.base));
  let solid = 0;
  let water = 0;
  for (let i = 0; i < limit; i++) {
    const c = chunk.color[i];
    if (!c) continue;
    if (c & WATER_FLAG) water++;
    else solid++;
  }
  const cap = (n, min) => Math.max(min, Math.ceil((n * 1.25) / 256) * 256);
  const v = {
    solid: makeLayer(chunk, cap(solid, 512), box, solidMaterial),
    water: makeLayer(chunk, cap(water, 64), waterBox, waterMaterial),
  };
  views.set(chunk.key, v);
  for (let i = 0; i < limit; i++) if (chunk.color[i]) writeCell(v, chunk, i);
  upload(v.solid, true);
  upload(v.water, true);
  chunk.changed.length = 0;
  return v;
}

function upload(layer, all) {
  layer.geo.instanceCount = layer.count;
  for (const [attr, size] of [[layer.cellAttr, 4], [layer.rgbAttr, 3]]) {
    if (!all && layer.hi >= layer.lo) {
      attr.clearUpdateRanges?.();
      attr.addUpdateRange?.(layer.lo * size, (layer.hi - layer.lo + 1) * size);
    }
    if (all || layer.hi >= layer.lo) attr.needsUpdate = true;
  }
  layer.lo = Infinity;
  layer.hi = -1;
}

// 変わったセルだけ描き直す
function updateView(chunk) {
  const v = views.get(chunk.key);
  if (!v) return;
  for (const i of chunk.changed) {
    if (!writeCell(v, chunk, i)) {
      buildView(chunk);
      return;
    }
  }
  chunk.changed.length = 0;
  const wasteful = (l) => l.hidden > 2000 && l.hidden > l.count / 2;
  if (wasteful(v.solid) || wasteful(v.water)) {
    buildView(chunk);
    return;
  }
  upload(v.solid, false);
  upload(v.water, false);
}

// プレイヤーの周りのチャンクを近い順に少しずつ作り、変わったチャンクを描き直す。遠いチャンクは片付ける。
// 描画の中心はカメラの注視点（龍を追っているときは龍のまわり）
function syncChunks() {
  const pcx = floorDiv(Math.floor(controls.target.x), CHUNK);
  const pcz = floorDiv(Math.floor(controls.target.z), CHUNK);
  const near = (c) => Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= VIEW_RADIUS;
  const start = performance.now();
  outer: for (let r = 0; r <= VIEW_RADIUS; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (world.chunks.has(chunkKey(pcx + dx, pcz + dz))) continue;
        if (performance.now() - start > LOAD_BUDGET_MS) break outer;
        world.chunkAt(pcx + dx, pcz + dz);
      }
    }
  }
  for (const key of world.dirty) {
    const chunk = world.chunks.get(key);
    if (!chunk) continue;
    if (!near(chunk)) {
      chunk.changed.length = 0;
      continue;
    }
    if (views.has(key)) updateView(chunk);
  }
  world.dirty.clear();
  for (const [key, v] of views) {
    const chunk = world.chunks.get(key);
    if (!chunk || !near(chunk)) {
      v.solid.dispose();
      v.water.dispose();
      views.delete(key);
    }
  }
  let all = true;
  for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
      const chunk = world.chunks.get(chunkKey(pcx + dx, pcz + dz));
      if (!chunk) all = false;
      else if (!views.has(chunk.key)) buildView(chunk);
    }
  }
  // チャンクがそろったら、その範囲の遠景を隠す
  if (all) shown = { x: (pcx + 0.5) * CHUNK, z: (pcz + 0.5) * CHUNK, half: (VIEW_RADIUS + 0.5) * CHUNK };
}
let shown = null; // チャンクで描いている正方形

// 遠景と、遠くのチャンクの片付け
const far = new FarTerrain(scene, world);
let frames = 0;
function syncFar() {
  far.update(controls.target.x, controls.target.z, shown, FAR_BUDGET_MS);
  if (++frames % 120 === 0) {
    const centers = [[player.pos[0], player.pos[2]], [controls.target.x, controls.target.z]];
    if (dragon) centers.push([dragon.head[0], dragon.head[2]]);
    forgetFar(world, centers, KEEP_RADIUS);
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
    if (e.kind === 'terrain' || !e.offsets.length) continue;
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
let chopHeld = false; // F を押している間は振り続ける
let chopPending = false; // 次のティックで1回振る

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
  const chop = chopHeld || chopPending;
  chopPending = false;
  return { dir: dx || dz ? [dx, dz] : null, run: running || runButton, chop };
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
  } else if (e.code === 'KeyF') {
    e.preventDefault();
    chopHeld = true;
    chopPending = true;
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
  if (e.code === 'KeyF') chopHeld = false;
});
window.addEventListener('blur', () => {
  held.length = 0;
  running = false;
  chopHeld = false;
});

document.querySelector('[data-chop]').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  chopPending = true;
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
const dragonLabel = document.getElementById('dragonState');
const fmtP = (p) => (p === Infinity ? '∞' : p);

function describe(ev) {
  const a = ev.actor;
  if (ev.type === 'chop') {
    const t = ev.target;
    const pct = `${Math.round(ev.progress * 100)}%`;
    switch (ev.result) {
      case 'notch': return { cls: 'push', text: `${a.name} が ${t.name} の幹に斧を入れた`, rule: `切り込み ${pct}` };
      case 'felled': return { cls: 'push', text: `${t.name} が倒れる！`, rule: '倒木' };
      case 'wound': return { cls: 'push', text: `${a.name} が ${t.name} を切りつけた`, rule: `傷の深さ ${pct}` };
      case 'severed': return { cls: 'push', text: `${t.name} の尾を切り落とした！`, rule: '切断' };
      case 'glance': return { cls: 'block', text: `斧が ${t.name} の足やひれをかすめた`, rule: '' };
      default: return { cls: 'block', text: t ? `斧が ${t.name} に当たったが、切れない` : `${a.name} は斧を空振りした`, rule: '' };
    }
  }
  const t = ev.target;
  if (ev.type === 'push') {
    return { cls: 'push', text: `${a.name} が ${t.name} を押し出した`, rule: `${fmtP(a.priority)} > ${fmtP(t.priority)}` };
  }
  if (ev.reason === 'edge') return { cls: 'block', text: `${a.name} は世界の端で止まった`, rule: '' };
  if (ev.reason === 'support') return { cls: 'block', text: `${a.name} は ${ev.via.name} を押せない（先に足場がない）`, rule: '' };
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
document.getElementById('watchDragon').addEventListener('change', (e) => {
  watchDragon = e.target.checked;
  cutaway.uCut.value = watchDragon ? 0 : 1;
  if (watchDragon && camera.position.distanceTo(controls.target) < 200) {
    // 龍の全体が入るように引く
    const offset = camera.position.clone().sub(controls.target).setLength(240);
    camera.position.copy(controls.target).add(offset);
  }
});
document.getElementById('hitbox').addEventListener('change', (e) => {
  hitboxGroup.visible = e.target.checked;
  syncHitboxes();
});

function markOwners(ids) {
  // 光らせる / 光を消す物体のセルを描き直し対象にする
  for (const id of ids) {
    const e = world.entities.get(id);
    if (!e) continue;
    for (const [x, y, z] of world.cellsOf(e)) {
      const chunk = world.chunks.get(chunkKey(floorDiv(x, CHUNK), floorDiv(z, CHUNK)));
      if (!chunk || y < chunk.base) continue;
      chunk.changed.push(chunk.index(x - chunk.cx * CHUNK, y, z - chunk.cz * CHUNK));
      world.dirty.add(chunk.key);
    }
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
  syncHitboxes();
  tickLabel.textContent = world.tickCount;
  posLabel.textContent = `${(player.pos[0] * VOXEL_METERS).toFixed(1)}, ${(player.pos[2] * VOXEL_METERS).toFixed(1)} m`;
  speedLabel.textContent = `${(player.speed * VOXEL_METERS).toFixed(1)} m/s`;
  chunkLabel.textContent = world.chunks.size;
  dragonLabel.textContent = DRAGON_MODES[dragon.mode];
}

// カメラはプレイヤー（または龍）をなめらかに追いかける（ボクセルの表示自体はコマ送りのまま）
const followed = new THREE.Vector3();
let watchDragon = false;
function follow(dt) {
  if (watchDragon) {
    // 龍の胴のなかほどを見る
    const mid = dragon.spine()[120]?.c ?? dragon.head;
    followed.set(mid[0], mid[1], mid[2]);
  } else {
    followed.copy(center(player));
  }
  const k = 1 - Math.exp(-dt * (watchDragon ? 3 : 8));
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
  // カメラが丘や山の中に入らないように
  const ground = world.heightAt(Math.floor(camera.position.x), Math.floor(camera.position.z)) + 4;
  if (camera.position.y < ground) camera.position.y = ground;
  syncChunks();
  syncFar();
  cutaway.uHead.value.copy(controls.target).y += 6;
  // 霧はカメラからの距離に合わせて遠ざける。遠くの山はかすんで見える
  const dist = camera.position.distanceTo(controls.target);
  scene.fog.near = dist + 350;
  scene.fog.far = dist + 2300;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
syncChunks();
tick();
requestAnimationFrame(frame);
