// 描画と入力。チャンクごとに world の owner / color をそのまま「ディスプレイ」として映す。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World, step, spawnPlayer, ensureAround, forgetFar, chunkKey, CHUNK, VOXEL_METERS, TICK_SECONDS, WATER_FLAG, FALL_ID, floorDiv, PLAYER_HP } from './world.js';
import { HUMAN_SIZE } from './humanoid.js';
import { spawnDragon, DRAGON_MODES } from './dragon.js';
import { spawnMonster } from './monster.js';
import { EYE } from './shotgun.js';
import { FarTerrain } from './far.js';
import { SOIL_MAX } from './shovel.js';
import { LAYER } from './grid.js';
import { ALPHA_SHIFT } from './terrain.js';

const TICK_MS = TICK_SECONDS * 1000; // 1秒に25回、体の位置と姿勢を更新する
const VOXEL_SIZE = 1.002; // 隙間なく密着させる（わずかに重ねて、継ぎ目に細い線が出ないようにする）
let viewRadius = 6; // 描画するチャンクの半径（重いときは自動で狭める）
const KEEP_RADIUS = 24; // これより遠いチャンクは片付ける
const LOAD_BUDGET_MS = 7; // 1フレームでチャンク作りに使ってよい時間
const FAR_BUDGET_MS = 3; // 1フレームで遠景作りに使ってよい時間
const SKY = 0xa9c9e8;

const world = new World({ seed: 20261004 });
world.bodyMakesChunks = false; // 龍の体が、まだ作っていない遠くのチャンクを作り始めないように
const player = spawnPlayer(world);
ensureAround(world, player.pos[0], player.pos[2], 2); // 足元だけ先に作り、残りは少しずつ
const dragon = spawnDragon(world, player.pos);
spawnMonster(world, player.pos); // 黄色い球体（14m ほど先に浮かんでいる）

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

// ---- 視点: 一人称（はじめ）と三人称（V で切り替え） ---------------------------------
//
// 一人称: 画面をクリックするとマウスカーソルが固定され、マウスを動かすだけで上下左右どこでも見回せる（Esc で解除）。
// 固定中は左クリックで道具を使い、右クリックで土を盛る。スマホは画面をドラッグして見回す。
// 三人称: いままでどおり、ドラッグでプレイヤーのまわりを回る
let firstPerson = true;
let lookYaw = 0; // 視線の左右（0 で +z）
let lookPitch = -0.12; // 視線の上下（上が正）
const canvas = renderer.domElement;

function setView(fp) {
  firstPerson = fp;
  controls.enabled = !fp;
  camera.fov = fp ? 75 : 40;
  camera.near = fp ? 0.2 : 0.5;
  camera.updateProjectionMatrix();
  stage.classList.toggle('fp', fp);
  cutaway.uCut.value = fp || watchDragon ? 0 : 1;
  if (fp) {
    lookYaw = player.pose.yaw;
    eyeAt.set(player.pos[0] + 4.5, player.pos[1] + EYE, player.pos[2] + 4.5);
  } else {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    cutaway.uSelf.value.w = 0;
    // 視線の後ろ上からプレイヤーを見る
    controls.target.copy(center(player));
    camera.position.copy(controls.target).add(new THREE.Vector3(-Math.sin(lookYaw) * 70, 42, -Math.cos(lookYaw) * 70));
    camera.lookAt(controls.target);
  }
}

function look(dx, dy, speed) {
  lookYaw -= dx * speed;
  lookPitch = Math.max(-1.55, Math.min(1.55, lookPitch - dy * speed));
}

let dragLook = null; // ドラッグで見回している指（スマホ）やマウス
let lockFailed = !canvas.requestPointerLock; // カーソルを固定できない（埋め込まれたページなど）ときは、マウスもドラッグで見回す
function lockFailedNow() {
  lockFailed = true;
  document.querySelector('.look-hint').textContent = 'ドラッグで見回す・V で三人称';
}
document.addEventListener('pointerlockerror', lockFailedNow);
canvas.addEventListener('pointerdown', (e) => {
  if (!firstPerson || watchDragon) return;
  if (e.pointerType === 'mouse' && !lockFailed) {
    if (document.pointerLockElement !== canvas) {
      try {
        canvas.requestPointerLock()?.catch?.(lockFailedNow);
      } catch {
        lockFailedNow();
      }
      return;
    }
    if (e.button === 0) chopHeld = chopPending = true;
    if (e.button === 2) placeHeld = placePending = true;
  } else {
    dragLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragLook || e.pointerId !== dragLook.id) return;
  look(e.clientX - dragLook.x, e.clientY - dragLook.y, 0.006);
  dragLook.x = e.clientX;
  dragLook.y = e.clientY;
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') {
    if (e.button === 0) chopHeld = false;
    if (e.button === 2) placeHeld = false;
  }
  if (dragLook && e.pointerId === dragLook.id) dragLook = null;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY, 0.0022);
});
document.addEventListener('pointerlockchange', () => {
  stage.classList.toggle('locked', document.pointerLockElement === canvas);
  if (document.pointerLockElement !== canvas) chopHeld = placeHeld = false;
});

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
// 水面は上の面だけの板（となりの水面との境目が透けて格子に見えないように）。滝は箱で描く
const waterTop = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.4, 0);
const fallBox = new THREE.BoxGeometry(1, 1, 1);
const cutaway = { uHead: { value: new THREE.Vector3() }, uCut: { value: 1 }, uSelf: { value: new THREE.Vector4() } };

// ボクセル用のマテリアル。インスタンスごとの位置・表示・色をシェーダーで読む
function voxelMaterial(options, alpha = false) {
  // 色の属性が 4 つ組（不透明度つき）なら、three.js が自動で不透明度も使う
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...options });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHead = cutaway.uHead;
    shader.uniforms.uCut = cutaway.uCut;
    shader.uniforms.uSelf = cutaway.uSelf;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 iCell;\nuniform vec3 uHead;\nuniform float uCut;\nuniform vec4 uSelf;')
      // 色は sRGB で持っている（水は不透明度も持つ）
      .replace('#include <color_vertex>', alpha ? 'vColor = vec4(pow(color.rgb, vec3(2.2)), color.a);' : 'vColor = pow(color, vec3(2.2));')
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float show = iCell.w;
        // カメラとプレイヤーの頭の間にある、頭より高いボクセル（木の葉など）は消して見通す
        vec3 wc = (modelMatrix * vec4(iCell.xyz, 1.0)).xyz;
        vec3 seg = uHead - cameraPosition;
        float t = clamp(dot(wc - cameraPosition, seg) / dot(seg, seg), 0.0, 1.0);
        float d = length(wc - (cameraPosition + seg * t));
        if (uCut > 0.5 && t < 0.97 && wc.y > uHead.y - 3.0 && d < 10.0) show = 0.0;
        // 一人称のときは、自分の体（当たり判定の円柱の中）を描かない（道具ははみ出した所だけ見える）
        if (uSelf.w > 0.5 && wc.y > uSelf.z && wc.y < uSelf.z + 15.0 && length(wc.xz - uSelf.xy) < 4.65) show = 0.0;
        transformed = transformed * show + iCell.xyz;
      `);
  };
  return m;
}
const solidMaterial = voxelMaterial();
// 水は、セルごとの不透明度で描く（澄んだ浅瀬はよく透け、深い淵は濃い）
const waterMaterial = voxelMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }, true);
const fallMaterial = voxelMaterial({ transparent: true, depthWrite: false }, true);
const WATER_ALPHA = 0.72; // 不透明度を持たない水の色の既定値

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
  const ch = material.transparent ? 4 : 3; // 水は不透明度も持つ
  const rgbAttr = new THREE.InstancedBufferAttribute(new Uint8Array(capacity * ch), ch, true);
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
    mesh, geo, cellAttr, rgbAttr, cell: cellAttr.array, rgb: rgbAttr.array, ch, shape, material,
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

// 層が満杯になったら、2 倍の大きさの層に移す（チャンク全体を作り直すより、ずっと軽い）
function growLayer(v, layer, chunk) {
  const name = layer === v.solid ? 'solid' : layer === v.water ? 'water' : 'fall';
  const next = makeLayer(chunk, layer.capacity * 2, layer.shape, layer.material);
  next.cell.set(layer.cell);
  next.rgb.set(layer.rgb);
  next.slots = layer.slots;
  next.count = layer.count;
  next.hidden = layer.hidden;
  next.lo = 0;
  next.hi = layer.count - 1;
  next.full = true;
  layer.dispose();
  v[name] = next;
  return next;
}

// セル i の色を、そのセルの層（不透明 / 水 / 滝）に書く
function writeCell(v, chunk, i) {
  const c = chunk.color[i];
  const water = (c & WATER_FLAG) !== 0;
  const target = !water ? v.solid : chunk.owner[i] === FALL_ID ? v.fall : v.water;
  for (const other of [v.solid, v.water, v.fall]) if (other !== target) other.hide(i);
  if (!c) {
    target.hide(i);
    return;
  }
  let layer = target;
  let slot = layer.slots.get(i);
  if (slot === undefined) {
    if (layer.count >= layer.capacity) layer = growLayer(v, layer, chunk);
    slot = layer.count++;
    layer.slots.set(i, slot);
    const lx = i % CHUNK, lz = Math.floor(i / CHUNK) % CHUNK, y = chunk.yOf(i);
    layer.cell.set([lx + 0.5, y + 0.5, lz + 0.5, 1], slot * 4);
  } else if (layer.cell[slot * 4 + 3] === 0) {
    layer.cell[slot * 4 + 3] = 1;
    layer.hidden--;
  }
  const f = highlight.has(chunk.owner[i]) ? 0.35 : 0;
  const k = slot * layer.ch;
  layer.rgb[k] = ((c >> 16) & 255) * (1 - f) + 255 * f;
  layer.rgb[k + 1] = ((c >> 8) & 255) * (1 - f) + 255 * f;
  layer.rgb[k + 2] = (c & 255) * (1 - f) + 255 * f;
  if (layer.ch === 4) {
    const a = (c >>> ALPHA_SHIFT) & 15;
    layer.rgb[k + 3] = Math.round((a ? a / 15 : WATER_ALPHA) * 255);
  }
  layer.touch(slot);
}

// チャンクの描画を一から作る（初回・入りきらないとき・隠れたインスタンスが増えたとき）
function buildView(chunk) {
  const old = views.get(chunk.key);
  if (old) {
    old.solid.dispose();
    old.water.dispose();
    old.fall.dispose();
  }
  const limit = Math.min(chunk.color.length, LAYER * (chunk.top - chunk.base));
  let solid = 0;
  let water = 0;
  let fall = 0;
  for (let i = 0; i < limit; i++) {
    const c = chunk.color[i];
    if (!c) continue;
    if (c & WATER_FLAG) {
      if (chunk.owner[i] === FALL_ID) fall++;
      else water++;
    }
    else solid++;
  }
  const cap = (n, min) => Math.max(min, Math.ceil((n * 1.25) / 256) * 256);
  const v = {
    solid: makeLayer(chunk, cap(solid, 512), box, solidMaterial),
    water: makeLayer(chunk, cap(water, 64), waterTop, waterMaterial),
    fall: makeLayer(chunk, cap(fall, 64), fallBox, fallMaterial),
  };
  views.set(chunk.key, v);
  for (let i = 0; i < limit; i++) if (chunk.color[i]) writeCell(v, chunk, i);
  upload(v.solid, true);
  upload(v.water, true);
  upload(v.fall, true);
  chunk.changed.length = 0;
  return v;
}

function upload(layer, all) {
  if (layer.full) {
    all = true;
    layer.full = false;
  }
  layer.geo.instanceCount = layer.count;
  for (const [attr, size] of [[layer.cellAttr, 4], [layer.rgbAttr, layer.ch]]) {
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
  for (const i of chunk.changed) writeCell(v, chunk, i);
  chunk.changed.length = 0;
  const wasteful = (l) => l.hidden > 2000 && l.hidden > l.count / 2;
  if (wasteful(v.solid) || wasteful(v.water) || wasteful(v.fall)) {
    buildView(chunk);
    return;
  }
  upload(v.solid, false);
  upload(v.water, false);
  upload(v.fall, false);
}

// プレイヤーの周りのチャンクを近い順に少しずつ作り、変わったチャンクを描き直す。遠いチャンクは片付ける。
// 描画の中心はカメラの注視点（龍を追っているときは龍のまわり）
function syncChunks() {
  const pcx = floorDiv(Math.floor(controls.target.x), CHUNK);
  const pcz = floorDiv(Math.floor(controls.target.z), CHUNK);
  const near = (c) => Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= viewRadius;
  const start = performance.now();
  outer: for (let r = 0; r <= viewRadius; r++) {
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
      v.fall.dispose();
      views.delete(key);
    }
  }
  let all = true;
  for (let dz = -viewRadius; dz <= viewRadius; dz++) {
    for (let dx = -viewRadius; dx <= viewRadius; dx++) {
      const chunk = world.chunks.get(chunkKey(pcx + dx, pcz + dz));
      if (!chunk) all = false;
      else if (!views.has(chunk.key)) buildView(chunk);
    }
  }
  // チャンクがそろったら、その範囲の遠景を隠す
  if (all) shown = { x: (pcx + 0.5) * CHUNK, z: (pcz + 0.5) * CHUNK, half: (viewRadius + 0.5) * CHUNK };
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
    if (world.monster) centers.push([world.monster.c[0], world.monster.c[2]]);
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
    const far = Math.max(Math.abs(e.pos[0] - player.pos[0]), Math.abs(e.pos[2] - player.pos[2])) > viewRadius * CHUNK;
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
// 移動は視点の向き基準（W で見ている方へ、A / D で横へ。2つ同時で斜め）。Shift を押している間は走る。
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
let placeHeld = false; // G を押している間は土を盛り続ける
let placePending = false;
let toolWanted = null; // 次のティックで持ち替える道具
let jumpHeld = false; // Space を押している間は、着地するたびに跳ぶ
let jumpPending = false;
const TOOL_KEYS = { Digit1: 'axe', Digit2: 'shovel', Digit3: 'sword', Digit4: 'gun' };
const TOOL_NAMES = { axe: '斧', shovel: 'シャベル', sword: '太刀', gun: 'ショットガン' };

// 視点の向き（ラジアン。0 で +z、前 = (sin, cos)）。一人称では視線、三人称ではカメラの向き
function viewYaw() {
  if (firstPerson && !watchDragon) return lookYaw;
  return Math.atan2(controls.target.x - camera.position.x, controls.target.z - camera.position.z);
}

// 押しているキーから、行きたい向き（視点の向き基準。どの角度でもよい）
function playerInput() {
  let fwd = 0;
  let side = 0;
  for (const rel of held) {
    if (rel === 'f') fwd++;
    else if (rel === 'b') fwd--;
    else if (rel === 'r') side++;
    else side--;
  }
  const yaw = viewYaw();
  const dx = Math.sin(yaw) * fwd - Math.cos(yaw) * side;
  const dz = Math.cos(yaw) * fwd + Math.sin(yaw) * side;
  const chop = chopHeld || chopPending;
  const place = placeHeld || placePending;
  const tool = toolWanted;
  const jump = jumpHeld || jumpPending;
  chopPending = placePending = jumpPending = false;
  toolWanted = null;
  const moving = Boolean(fwd || side);
  const fp = firstPerson && !watchDragon;
  return {
    dir: moving ? [dx, dz] : null, run: running || runButton, chop, place, tool, jump,
    // 一人称: 体はいつも視線の向きを向き、道具は視線の先（上下も）へ使う。
    // 三人称: 立ち止まって道具を使うときは、カメラの向いている方を向く
    face: fp ? lookYaw : !moving && (chop || place) ? yaw : null,
    pitch: fp ? lookPitch : null,
  };
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
  } else if (TOOL_KEYS[e.code]) {
    toolWanted = TOOL_KEYS[e.code];
  } else if (e.code === 'KeyV' && !e.repeat) {
    if (!watchDragon) setView(!firstPerson);
  } else if (e.code === 'KeyG') {
    e.preventDefault();
    placeHeld = true;
    placePending = true;
  } else if (e.code === 'KeyF') {
    e.preventDefault();
    chopHeld = true;
    chopPending = true;
  } else if (e.code === 'Space') {
    e.preventDefault();
    jumpHeld = true;
    jumpPending = true;
  } else if (e.code === 'KeyP') {
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
  if (e.code === 'KeyG') placeHeld = false;
  if (e.code === 'Space') jumpHeld = false;
});
window.addEventListener('blur', () => {
  held.length = 0;
  running = false;
  chopHeld = false;
  placeHeld = false;
  jumpHeld = false;
});

document.querySelector('[data-tool]').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  toolWanted = { axe: 'shovel', shovel: 'sword', sword: 'gun', gun: 'axe' }[player.tool]; // 斧 → シャベル → 太刀 → ショットガン
});
document.querySelector('[data-jump]').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  jumpPending = true;
});
document.querySelector('[data-place]').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  placePending = true;
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
const toolLabel = document.getElementById('tool');
const soilLabel = document.getElementById('soil');
const monsterLabel = document.getElementById('monsterState');
const hpBar = document.getElementById('hpBar');
const hpText = document.getElementById('hpText');
const chopBtn = document.querySelector('[data-chop]');
const fmtP = (p) => (p === Infinity ? '∞' : p);

function describe(ev) {
  const a = ev.actor;
  if (ev.type === 'shoot') {
    const n = `${ev.hits} 粒`;
    switch (ev.result) {
      case 'dent': return { cls: 'push', text: '散弾で黄色い球体が大きくえぐれた（波打って戻っていく）', rule: n };
      case 'chip': return { cls: 'push', text: '散弾で正八面体が欠けた！', rule: n };
      case 'killed': return { cls: 'push', text: '黄色い球体が砕け散った！', rule: '撃破' };
      case 'blocked': return { cls: 'block', text: '散弾が木や地面に当たった', rule: '' };
      default: return { cls: 'block', text: `${a.name} はショットガンを撃った（外れ）`, rule: '' };
    }
  }
  if (ev.type === 'spot') return { cls: 'push', text: `${a.name} が ${ev.target.name} に気づいた（マゼンタの縞）`, rule: '' };
  if (ev.type === 'octa') return { cls: 'push', text: `${a.name} が正八面体に変わった！（今なら撃って削れる）`, rule: '' };
  if (ev.type === 'beam') return { cls: 'push', text: `${a.name} が紫の光線を放った`, rule: '光線の上は消える' };
  if (ev.type === 'beamHit') return { cls: 'push', text: `紫の光線が ${ev.target.name} に当たった`, rule: `体力 ${Math.round(ev.hp)}` };
  if (ev.type === 'respawn') return { cls: 'block', text: `${a.name} は力尽きて出発地点に戻った`, rule: '体力 0' };
  if (ev.type === 'absorb') return { cls: 'push', text: `${a.name} が ${ev.target.name} を包み込んで吸収した`, rule: '少し大きくなる' };
  if (ev.type === 'vanish') return { cls: 'push', text: `紫の光線で ${ev.target.name} が消えた`, rule: '' };
  if (ev.type === 'beamDragon') return { cls: 'push', text: ev.severed ? '紫の光線が龍の尾を焼き切った' : '紫の光線が龍の体を焼いた', rule: '' };
  if (ev.type === 'dig') {
    const soil = `土 ${ev.soil}/${SOIL_MAX}`;
    switch (ev.result) {
      case 'dug': return { cls: 'push', text: `${a.name} が地面を掘った`, rule: soil };
      case 'rock': return { cls: 'block', text: 'シャベルが岩に当たって弾かれた（カチン）', rule: '岩は掘れない' };
      case 'full': return { cls: 'block', text: 'シャベルが土でいっぱい。G で盛ろう', rule: soil };
      default: return { cls: 'block', text: 'シャベルが届く所に地面がない', rule: '' };
    }
  }
  if (ev.type === 'slash') {
    const t = ev.target;
    const how = ev.cut === 'h' ? '横に薙いだ' : '斬り下ろした';
    switch (ev.result) {
      case 'wound': return { cls: 'push', text: `${a.name} が ${t.name} を太刀で${how}`, rule: `傷の深さ ${Math.round(ev.progress * 100)}%` };
      case 'severed': return { cls: 'push', text: `太刀で ${t.name} の尾を斬り落とした！`, rule: '切断' };
      case 'glance': return { cls: 'block', text: `太刀が ${t.name} の足やひれをかすめた`, rule: '' };
      case 'blocked': return { cls: 'block', text: '太刀が弾かれた（龍しか斬れない）', rule: '' };
      default: return { cls: 'block', text: `${a.name} は太刀を空振りした`, rule: '' };
    }
  }
  if (ev.type === 'place') {
    const soil = `土 ${ev.soil}/${SOIL_MAX}`;
    switch (ev.result) {
      case 'placed': return { cls: 'push', text: `${a.name} が土を盛った`, rule: soil };
      case 'empty': return { cls: 'block', text: 'シャベルに土がない。F で掘ろう', rule: '' };
      default: return { cls: 'block', text: 'そこには土を盛れない', rule: '' };
    }
  }
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
  return ev.actor.kind === 'player' || ev.target?.kind === 'player' || (ev.actor.kind === 'monster' && ev.type !== 'push');
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
  // 龍を追うときは三人称にする（やめたら元の視点に戻す）
  if (e.target.checked && firstPerson) {
    setView(false);
    resumeFirstPerson = true;
  }
  watchDragon = e.target.checked;
  cutaway.uCut.value = watchDragon ? 0 : 1;
  if (!watchDragon && resumeFirstPerson) {
    resumeFirstPerson = false;
    setView(true);
  }
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
  toolLabel.textContent = TOOL_NAMES[player.tool];
  soilLabel.textContent = `${player.soil}/${SOIL_MAX}`;
  chopBtn.textContent = { axe: '斧', shovel: '掘る', sword: '斬る', gun: '撃つ' }[player.tool];
  monsterLabel.textContent = world.monster ? world.monster.label : '砕け散った';
  const hp = Math.round(player.hp);
  hpBar.style.width = `${(player.hp / PLAYER_HP) * 100}%`;
  hpBar.dataset.low = String(hp <= 30);
  hpText.textContent = hp;
}

// カメラはプレイヤー（または龍）をなめらかに追いかける（ボクセルの表示自体はコマ送りのまま）
const followed = new THREE.Vector3();
let watchDragon = false;
let resumeFirstPerson = false;
const eyeAt = new THREE.Vector3(); // 一人称のカメラの位置（体の動きよりなめらかに追う）
function follow(dt) {
  if (firstPerson && !watchDragon) {
    // 一人称: 目の位置から視線の向きを見る。体は1ボクセルずつ動くので、カメラはなめらかに追う
    const tx = player.pos[0] + 4.5, ty = player.pos[1] + EYE, tz = player.pos[2] + 4.5;
    if (Math.hypot(tx - eyeAt.x, ty - eyeAt.y, tz - eyeAt.z) > 20) eyeAt.set(tx, ty, tz); // 出発地点に戻ったときなど
    const k = 1 - Math.exp(-dt * 22);
    eyeAt.x += (tx - eyeAt.x) * k;
    eyeAt.y += (ty - eyeAt.y) * k;
    eyeAt.z += (tz - eyeAt.z) * k;
    camera.position.copy(eyeAt);
    camera.rotation.set(lookPitch, lookYaw + Math.PI, 0, 'YXZ');
    controls.target.copy(eyeAt); // 描くチャンクの中心など
    cutaway.uSelf.value.set(tx, tz, player.pos[1], 1);
    return;
  }
  cutaway.uSelf.value.w = 0;
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

// 重いときは描く範囲を自動で狭める（フレームの時間をならして見る）
const fpsLabel = document.getElementById('fps');
let frameAvg = 16;
let slowFor = 0, fastFor = 0, fpsShown = 0;
const QUALITY = [{ view: 3, far: 1 }, { view: 4, far: 2 }, { view: 5, far: 3 }, { view: 6, far: 3 }];
let quality = QUALITY.length - 1;
function adjustQuality(dt) {
  frameAvg += (dt - frameAvg) * 0.05;
  fpsShown += dt;
  if (fpsShown > 500) {
    fpsShown = 0;
    fpsLabel.textContent = Math.round(1000 / frameAvg);
  }
  slowFor = frameAvg > 50 ? slowFor + dt : 0;
  fastFor = frameAvg < 22 ? fastFor + dt : 0;
  if (slowFor > 1500 && quality > 0) setQuality(quality - 1);
  else if (fastFor > 8000 && quality < QUALITY.length - 1) setQuality(quality + 1);
}
function setQuality(q) {
  quality = q;
  slowFor = fastFor = 0;
  viewRadius = QUALITY[q].view;
  far.setLevels(QUALITY[q].far);
  shown = null;
}

let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(now - last, 500);
  last = now;
  acc += dt;
  // 1 フレームで進めるのは 2 ティックまで。追いつけないときは遅れを捨てる
  // （遅れを取り戻そうとして 1 フレームに何十ティックも進めると、ますます重くなって止まってしまう）
  let ticks = 0;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    if (!paused) tick();
    if (++ticks >= 2) {
      acc = Math.min(acc, TICK_MS);
      break;
    }
  }
  adjustQuality(dt);
  follow(dt / 1000);
  if (!firstPerson || watchDragon) {
    controls.update();
    // カメラが丘や山の中に入らないように
    const ground = world.heightAt(Math.floor(camera.position.x), Math.floor(camera.position.z)) + 4;
    if (camera.position.y < ground) camera.position.y = ground;
  }
  syncChunks();
  syncFar();
  cutaway.uHead.value.copy(controls.target).y += 6;
  // 霧はカメラからの距離に合わせて遠ざける。遠くの山はかすんで見える
  const dist = firstPerson && !watchDragon ? 0 : camera.position.distanceTo(controls.target);
  scene.fog.near = dist + 350;
  scene.fog.far = dist + 2300;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
setView(true);
syncChunks();
tick();
requestAnimationFrame(frame);
