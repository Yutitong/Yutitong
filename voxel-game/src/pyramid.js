// 巨大ピラミッドと、その中のダンジョン
//
// - 出発地点から 250m ほど先の平らな所に、底辺およそ 150m（1000 ボクセル）・高さおよそ 90m（600 ボクセル）の
//   階段状のピラミッドを建てる。まわりは石畳の広場にならす（木・巨大樹は生えない）
// - 正面（出発地点の側）の中腹に入り口があり、麓から巨大な階段が続く。入り口には柱と、翼のある日輪の飾り
// - 正面からまっすぐに参道が伸び、両脇にオベリスク・スフィンクス・火の燃える鉢・低い壁。参道の途中に巨大な門
//   （塔門）があり、その外側の台座の上に 2 体の巨アヌビス像（guardians.js）
// - 中のダンジョン:
//   入り口の廊下（きれいに整えた石の廊下）→ 巨岩の入り組んだ下り坂の洞窟 → 天井のとても高い祈祷室（列柱と、奥の台の上の棺）。
//   脇には小部屋と洞窟。祈祷室の奥の隅の狭い割れ目から、らせん状の洞窟を地下深くへ下ると、廊下の先に隠された玉座の間があり、
//   赤い骨の王（bones.js）が鎮座している
// - 整えた廊下・部屋の壁には、竜の紋様の帯と、太古の歴代王の調べ（象形文字の帯・名を囲む枠・王の行列）が描いてある。天井は青に金の星
// - 中は暗く、壁の松明のまわりだけが暖かい色に照らされる（明るさは色に焼き込む）。入り口の近くは外の光が差し込む
//
// ピラミッドの石は「岩」（掘れない）。チャンクを作るとき（どちらのスレッドでも）に塗る。
// チャンクは中の空間のある所だけ深くまで持ち、ほかは表面の近くだけ持つ（それより下は中まで詰まった石とみなす）

import { CHUNK, HEIGHT, floorDiv } from './grid.js';
import { EMPTY, GROUND_ID, ROCK_ID, WATER_ID, FALL_ID, PLANT_ID } from './ids.js';
import { hash3, noise3, shade } from './rng.js';

export const HB = 500; // 底辺の半分（ボクセル）
export const PH = 600; // 高さ
const COURSE = 12, SETBACK = 10; // 1 段の高さと、段ごとの後退
const COURSES = PH / COURSE;
const FRONT = 557; // 正面の階段の麓（中心からの距離）。一番下の段は参道の石畳（広場 + 1）と同じ高さ
const ENTRY_Y = 240; // 入り口の床の高さ（広場から）
const STAIR_HALF = 30;
const AVENUE_END = 1080, AVENUE_HALF = 26;
export const GATE_U = 900;
export const STATUE_U = 955, STATUE_V = 62, PEDESTAL_H = 14;
export const CRYSTAL_Y = PH + 46; // 水晶の中心の高さ（広場から）
// 広場（ならす所）: u ∈ [-PLAZA, AVENUE_END]、|v| < PLAZA。まわり RAMP ボクセルで元の地形へつなぐ
const PLAZA = 560, RAMP = 90;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function mix(a, b, t) {
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// ---- 敷地 ----------------------------------------------------------------------

// 出発地点から見て 4 方向のどれかの、平らで川や巨大樹の森のない所。正面は出発地点を向く
export function pyramidSite(world) {
  if (world._site !== undefined) return world._site;
  world._site = null;
  const T = world.terrain;
  if (!T) return null;
  let best = null;
  const tmp = {};
  for (const D of [1700, 2000, 2400]) {
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const cx = dx * D, cz = dz * D;
      const f = [-dx, -dz]; // 正面（出発地点の向き）
      const hs = [];
      let bad = 0;
      for (let u = -PLAZA - 40; u <= AVENUE_END + 40; u += 64) {
        for (let v = -PLAZA - 40; v <= PLAZA + 40; v += 64) {
          const x = cx + u * f[0] - v * f[1], z = cz + u * f[1] + v * f[0];
          const s = T.sample(x, z, tmp);
          hs.push(s.h);
          if (s.channel || s.bank || s.edge < 40 || s.pond) bad += 1;
        }
      }
      hs.sort((a, b) => a - b);
      const med = hs[hs.length >> 1];
      const spread = hs[Math.floor(hs.length * 0.9)] - hs[Math.floor(hs.length * 0.1)];
      const score = spread + bad * 40 + D * 0.01;
      if (!best || score < best.score) best = { score, cx, cz, f, P: Math.max(med, world.waterLevel + 3) };
    }
  }
  world._site = { cx: best.cx, cz: best.cz, f: best.f, P: Math.round(best.P) };
  return world._site;
}

// 世界の座標 ↔ ピラミッドの座標（u: 正面の向き、v: 横）
export const toLocal = (s, x, z) => [(x - s.cx) * s.f[0] + (z - s.cz) * s.f[1], -(x - s.cx) * s.f[1] + (z - s.cz) * s.f[0]];
export const toWorld = (s, u, v) => [s.cx + u * s.f[0] - v * s.f[1], s.cz + u * s.f[1] + v * s.f[0]];
// ピラミッドの座標の向き（u の向き）の、世界の yaw（0 = +z）
export const frontYaw = (s) => Math.atan2(s.f[0], s.f[1]);

// 広場の外からの距離（中は 0）
function plazaOutside(u, v) {
  const du = u < -PLAZA ? -PLAZA - u : u > AVENUE_END ? u - AVENUE_END : 0;
  const dv = Math.max(0, Math.abs(v) - PLAZA);
  return Math.hypot(du, dv);
}

// 地形をならす（world.sample から呼ぶ）
export function flattenSite(world, x, z, out) {
  const s = world._site === undefined ? pyramidSite(world) : world._site;
  if (!s) return out;
  const [u, v] = toLocal(s, x, z);
  const d = plazaOutside(u, v);
  if (d >= RAMP) return out;
  const m = d <= 0 ? 1 : 1 - (d / RAMP) ** 2 * (3 - 2 * (d / RAMP));
  out.h = Math.round(lerp(out.h, s.P, m));
  if (m > 0.3) {
    out.water = 0;
    out.channel = false;
    out.bank = false;
    out.pond = false;
  }
  return out;
}

// 広場（とまわり）の中か。木や巨大樹を生やさない
export function inSite(world, x, z, margin = 0) {
  const s = world._site === undefined ? pyramidSite(world) : world._site;
  if (!s) return false;
  const [u, v] = toLocal(s, x, z);
  return plazaOutside(u, v) < margin + RAMP * 0.6;
}

// ---- 外の形 --------------------------------------------------------------------

// 階段状のピラミッドの、列 (u, v) の高さ（広場から）
function stepTop(u, v) {
  const d = Math.max(Math.abs(u), Math.abs(v));
  if (d >= HB) return 0;
  return Math.min(COURSES, Math.floor((HB - d - 1) / SETBACK) + 1) * COURSE;
}

const stairTop = (u) => (u < 318 ? ENTRY_Y : ENTRY_Y - (u - 318));

// 外の形（ピラミッド・階段・入り口の正面の壁・柱・まぐさ石）。高さ y（広場から）のセルが石か
function outerSolid(u, v, y) {
  if (y < stepTop(u, v)) return true;
  const av = Math.abs(v);
  if (u >= 304 && u < FRONT) {
    const t = stairTop(u);
    if (av < STAIR_HALF && y < t) return true;
    if (av >= STAIR_HALF && av < STAIR_HALF + 4 && y < t + 4) return true; // 欄干
  }
  if (u >= 290 && u < 304 && av < 26 && y < 300) return true; // 入り口の正面の壁
  if (u >= 304 && u < 309) {
    if (av >= 9 && av < 15 && y >= ENTRY_Y && y < 292) return true; // 柱
    if (av < 20 && y >= 280 && y < 294) return true; // まぐさ石と日輪
  }
  return false;
}

// 外の形の上限（列の中でこれより上に石はない）
function outerTopBound(u, v) {
  let t = stepTop(u, v);
  const av = Math.abs(v);
  if (u >= 304 && u < FRONT && av < STAIR_HALF + 4) t = Math.max(t, stairTop(u) + 4);
  if (u >= 290 && u < 309 && av < 26) t = Math.max(t, 300);
  return t;
}

// ---- 中の空間 ------------------------------------------------------------------

// 箱の部屋・廊下（床 y0、天井 y1。広場からの高さ）。style で壁の飾りが変わる
const BOXES = [
  { name: 'entry', u0: 150, u1: 305, v0: -8, v1: 8, y0: ENTRY_Y, y1: 266, style: 'corr', day: true },
  { name: 'gallery', u0: 213, u1: 227, v0: 8, v1: 72, y0: ENTRY_Y, y1: 262, style: 'corr' },
  { name: 'side', u0: -26, u1: -12, v0: 55, v1: 122, y0: 140, y1: 162, style: 'corr' },
  { name: 'store', u0: -42, u1: 2, v0: 121, v1: 162, y0: 140, y1: 172, style: 'room' },
  { name: 'hall', u0: -90, u1: 52, v0: -56, v1: 56, y0: 140, y1: 400, style: 'hall' },
  { name: 'kingway', u0: -252, u1: -184, v0: -7, v1: 7, y0: 10, y1: 34, style: 'corr' },
  { name: 'throne', u0: -332, u1: -250, v0: -42, v1: 42, y0: 10, y1: 72, style: 'throne' },
];
// 巨岩の洞窟（点の列は床の高さ。半径 r の筒を、床から上だけ掘る。壁はでこぼこ）
const TUNNELS = [
  { name: 'descent', r: 13, pts: [[156, 0, 240], [120, 18, 222], [92, -14, 190], [74, 14, 160], [54, 2, 141], [40, 0, 140]] },
  { name: 'cave', r: 11, pts: [[10, -50, 140], [8, -90, 140], [-12, -116, 143], [-22, -136, 146]] },
  { name: 'den', r: 22, pts: [[-22, -140, 146], [-34, -152, 146]] },
  // 祈祷室の奥の隅の狭い割れ目から、らせん状にピラミッドの芯の奥深くへ（隠された道）
  { name: 'hidden', r: 11, pts: [[-84, 46, 140], [-108, 58, 132], [-146, 60, 118], [-168, 22, 100], [-150, -28, 84], [-118, -46, 66], [-106, -16, 48], [-136, 8, 30], [-178, 0, 10], [-192, 0, 10]] },
];
for (const t of TUNNELS) {
  const R = t.r * 1.4 + 2;
  t.segs = [];
  for (let i = 0; i + 1 < t.pts.length; i++) {
    const a = t.pts[i], b = t.pts[i + 1];
    const ca = [a[0], a[2] + t.r * 0.6, a[1]], cb = [b[0], b[2] + t.r * 0.6, b[1]]; // (u, y, v) の中心
    t.segs.push({ a: ca, b: cb, fa: a[2], fb: b[2] });
  }
  const us = t.pts.map((p) => p[0]), vs = t.pts.map((p) => p[1]), ys = t.pts.map((p) => p[2]);
  t.u0 = Math.min(...us) - R;
  t.u1 = Math.max(...us) + R;
  t.v0 = Math.min(...vs) - R;
  t.v1 = Math.max(...vs) + R;
  t.y0 = Math.min(...ys) - 1;
  t.y1 = Math.max(...ys) + R * 1.3;
  t.style = 'rough';
}
const SPACES = [...BOXES, ...TUNNELS];

// 洞窟の中か（y は広場から）
// 洞窟の芯からの距離（いちばん近い区間）と、その所の床の高さ。
// 床は、いちばん近い区間とその前後の区間の床を、真上から見た近さで重みをつけて混ぜる。
// （曲がり角で区間が入れ替わる所や、高さによって近い区間が変わる所に段ができないように。段があると、下りられても上り返せない）
function tunnelDist(t, u, v, y) {
  let best = Infinity, bi = 0;
  const segs = t.segs;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1], ez = s.b[2] - s.a[2];
    const L2 = ex * ex + ey * ey + ez * ez || 1;
    let k = ((u - s.a[0]) * ex + (y - s.a[1]) * ey + (v - s.a[2]) * ez) / L2;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const dx = u - (s.a[0] + ex * k), dy = y - (s.a[1] + ey * k), dz = v - (s.a[2] + ez * k);
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) {
      best = d2;
      bi = i;
    }
  }
  let sw = 0, sf = 0, near = Infinity;
  const h = [];
  for (let i = Math.max(0, bi - 1); i <= Math.min(segs.length - 1, bi + 1); i++) {
    const s = segs[i];
    const ex = s.b[0] - s.a[0], ez = s.b[2] - s.a[2];
    const L2 = ex * ex + ez * ez || 1;
    let k = ((u - s.a[0]) * ex + (v - s.a[2]) * ez) / L2;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const d = Math.hypot(u - (s.a[0] + ex * k), v - (s.a[2] + ez * k));
    h.push(d, s.fa + (s.fb - s.fa) * k);
    if (d < near) near = d;
  }
  for (let n = 0; n < h.length; n += 2) {
    const wt = Math.exp(-(h[n] - near) / 3);
    sw += wt;
    sf += wt * h[n + 1];
  }
  return [Math.sqrt(best), sf / sw];
}
function inTunnel(t, u, v, y) {
  const [d, floor] = tunnelDist(t, u, v, y);
  if (d >= t.r * 1.38 || y < floor) return false;
  if (d < t.r) return true;
  return d < t.r * (1 + 0.38 * noise3(u / 9, y / 7, v / 9, 404));
}
// 空間の壁から 1.5 ボクセル以内か（中の面になりうるか）
function nearSpace(sp, u, v, y) {
  for (const s of sp) {
    if (s.style === 'rough') {
      if (y < s.y0 - 1 || y > s.y1 + 1) continue;
      const [d, floor] = tunnelDist(s, u, v, y);
      if (d < s.r * 1.38 + 1.5 && y >= floor - 2) return true;
    } else if (u >= s.u0 - 1 && u <= s.u1 && v >= s.v0 - 1 && v <= s.v1 && y >= s.y0 - 1 && y <= s.y1) {
      return true;
    }
  }
  return false;
}

// 部屋の中に置いた石の物（柱・台・棺・玉座）。色の種類（なければ 0）
function fixture(box, u, v, y) {
  const av = Math.abs(v);
  if (box.name === 'hall') {
    const h = y - box.y0, top = box.y1 - y;
    // いちばん近い柱だけ調べる（柱は u = -60, -30, 0, 30、v = ±30）
    const cu = clamp(Math.round(u / 30) * 30, -60, 30), cv = v < 0 ? -30 : 30;
    const d = Math.hypot(u - cu + 0.5, v - cv + 0.5);
    const r = h < 4 ? 8.5 : top <= 14 ? 6 + (14 - top) * 0.35 : 6;
    if (d < r) return h < 4 ? 'base' : top <= 14 ? 'capital' : 'column';
    // 奥の台（3 段）と棺
    if (u < -64 && av < 22 && h < 2) return 'dais';
    if (u < -68 && av < 18 && h < 4) return 'dais';
    if (u < -72 && av < 14 && h < 6) return 'dais';
    if (u >= -86 && u < -74 && av < 4 && h >= 6 && h < 13) return 'coffin';
  }
  if (box.name === 'throne') {
    const h = y - box.y0, top = box.y1 - y;
    const tu = u < -292 ? -310 : -275, tv = v < 0 ? -30 : 30;
    if (Math.hypot(u - tu + 0.5, v - tv + 0.5) < (h < 3 || top < 4 ? 7 : 5)) return 'tcolumn';
    if (u < -296 && av < 24 && h < 2) return 'tdais';
    if (u < -302 && av < 20 && h < 4) return 'tdais';
    if (u < -306 && av < 16 && h < 6) return 'tdais';
    // 玉座: 座面・背もたれ・ひじ掛け
    if (u >= -326 && u < -312 && av < 10 && h >= 6 && h < 18) return 'throne';
    if (u >= -330 && u < -326 && av < 11 && h >= 6 && h < 58) return 'throne';
    if (u >= -326 && u < -312 && av >= 10 && av < 13 && h >= 6 && h < 24) return 'throne';
  }
  return null;
}

// 柱の芯（まわりを石に囲まれていて、外から見えない所）
function fixtureDeep(box, u, v, y) {
  const h = y - box.y0, top = box.y1 - y;
  if (box.name === 'hall') {
    if (h < 5 || top < 16) return false;
    const cu = clamp(Math.round(u / 30) * 30, -60, 30), cv = v < 0 ? -30 : 30;
    return Math.hypot(u - cu + 0.5, v - cv + 0.5) < 4.4;
  }
  if (box.name === 'throne') {
    if (h < 4 || top < 5) return false;
    const tu = u < -292 ? -310 : -275, tv = v < 0 ? -30 : 30;
    return Math.hypot(u - tu + 0.5, v - tv + 0.5) < 3.4;
  }
  return false;
}

// 列 (u, v) にかかる空間
function spacesAt(u, v, list = SPACES) {
  const out = [];
  for (const s of list) if (u >= s.u0 - 1 && u < s.u1 + 1 && v >= s.v0 - 1 && v < s.v1 + 1) out.push(s);
  return out;
}

// セル (u, v, y) が空いているなら、その空間（空いていなければ null）
function spaceAt(sp, u, v, y) {
  for (const s of sp) {
    if (y < s.y0 || y >= s.y1) continue;
    if (s.style === 'rough') {
      if (inTunnel(s, u, v, y)) return s;
    } else if (u >= s.u0 && u < s.u1 && v >= s.v0 && v < s.v1) {
      if (!fixture(s, u, v, y)) return s;
    }
  }
  return null;
}

// ---- 松明と明かり --------------------------------------------------------------

// 松明: 壁ぎわの空いたセル { u, v, y, n: 壁の向き [du, dv] }
export const TORCHES = [];
for (const b of BOXES) {
  const H = b.y1 - b.y0;
  const ty = b.y0 + (b.style === 'hall' ? 22 : b.style === 'throne' ? 16 : 11);
  const step = b.style === 'hall' ? 24 : b.style === 'throne' ? 16 : 18;
  const alongU = b.u1 - b.u0 >= b.v1 - b.v0;
  if (alongU || b.style === 'hall' || b.style === 'throne' || b.style === 'room') {
    for (let u = b.u0 + step / 2; u < b.u1 - 4; u += step) {
      TORCHES.push({ u: Math.floor(u), v: b.v0, y: ty, n: [0, -1] });
      TORCHES.push({ u: Math.floor(u), v: b.v1 - 1, y: ty, n: [0, 1] });
    }
  }
  if (!alongU || b.style === 'hall' || b.style === 'throne' || b.style === 'room') {
    for (let v = b.v0 + step / 2; v < b.v1 - 4; v += step) {
      if (b.name === 'hall' && Math.abs(v - 46) < 10) continue; // 隠された割れ目のまわりは暗く
      TORCHES.push({ u: b.u0, v: Math.floor(v), y: ty, n: [-1, 0] });
      if (b.name !== 'hall' || Math.abs(v) > 16) TORCHES.push({ u: b.u1 - 1, v: Math.floor(v), y: ty, n: [1, 0] });
    }
  }
  void H;
}
// 洞窟の松明（とびとび）
for (const t of TUNNELS) {
  if (t.name === 'hidden') continue; // 隠された道は真っ暗（王の間の手前だけ明るい）
  let acc = 0;
  for (const s of t.segs) {
    const L = Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]);
    acc += L;
    if (acc < 36) continue;
    acc = 0;
    const du = (s.b[0] - s.a[0]) / L, dv = (s.b[2] - s.a[2]) / L;
    TORCHES.push({ u: Math.floor(s.b[0] - dv * (t.r * 0.8)), v: Math.floor(s.b[2] + du * (t.r * 0.8)), y: Math.floor(s.fb + 9), n: [-dv, du], cave: true });
  }
}
// 松明は空いているセルにだけ置く（壁の中に埋もれた所はやめる）
for (let i = TORCHES.length - 1; i >= 0; i--) {
  const t = TORCHES[i];
  if (!spaceAt(spacesAt(t.u, t.v), t.u, t.v, t.y)) TORCHES.splice(i, 1);
}
// 明るさを調べるための、32 ボクセルごとの格子
const TORCH_GRID = new Map();
for (const t of TORCHES) {
  const k = `${floorDiv(t.u, 32)},${floorDiv(t.v, 32)}`;
  if (!TORCH_GRID.has(k)) TORCH_GRID.set(k, []);
  TORCH_GRID.get(k).push(t);
}

// 明るさ（色に掛ける）と、松明の暖かい色の強さ
function lightAt(u, v, y, space) {
  let warm = 0;
  const gu = floorDiv(u, 32), gv = floorDiv(v, 32);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const list = TORCH_GRID.get(`${gu + a},${gv + b}`);
      if (!list) continue;
      for (const t of list) {
        const d2 = (u - t.u) ** 2 + (v - t.v) ** 2 + ((y - t.y) * 1.2) ** 2;
        if (d2 < 1600) warm += 1.25 * Math.exp(-d2 / (t.cave ? 260 : 330));
      }
    }
  }
  let day = 0;
  if (space?.day) day = clamp((u - 220) / 85, 0, 1) * 0.95;
  const amb = space?.style === 'hall' ? 0.2 : space?.style === 'throne' ? 0.16 : 0.12;
  return { k: Math.min(1.25, amb + warm + day), warm: Math.min(1, warm) };
}

function lit(color, L) {
  const r = ((color >> 16) & 255) * L.k * (1 + 0.18 * L.warm);
  const g = ((color >> 8) & 255) * L.k * (1 - 0.02 * L.warm);
  const b = (color & 255) * L.k * (1 - 0.3 * L.warm);
  return (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255) || 0x010101;
}

// ---- 壁の絵 --------------------------------------------------------------------

const C = {
  sand: [0xd8bf8a, 0xd0b47c, 0xcdb27e, 0xdcc596, 0xc9ab73], joint: 0x9c8458, gold: 0xe6b84a, gold2: 0xc99a34,
  red: 0x9e2a20, blue: 0x2d4f8e, lapis: 0x24407a, black: 0x1c1a18, white: 0xece4d0, ochre: 0xc27a3a, green: 0x3f7a5a,
  plaster: 0xcdb791, skirt: 0x4a3a2a, teal: 0x1d3b3a, ceil: 0x1b2a55, floor: 0x8a7a64, floor2: 0x7d6e59,
  runner: 0x6a1e18, tred: 0x5a1a14, tfloor: 0x1e1816, stair: 0xe3d3b0, stair2: 0xd6c49c,
  rough: [0x8a7356, 0x7a644a, 0x9b8463, 0x6b5a45, 0x5a4c3c, 0x8f7b5e], crack: 0x3a2e24,
  coffin: 0xd8a63a, coffin2: 0x2d4f8e, torch: 0x2a2420, flame: 0xffb030, flame2: 0xffe27a,
};

// 竜の紋様（t: 帯の中の高さ 0..1）
function dragonBand(a, t, bg = C.teal, body = C.gold, body2 = C.red) {
  if (t < 0.08 || t > 0.92) return C.gold;
  const P = 48, ph = ((a % P) + P) % P;
  const ct = 0.5 + 0.28 * Math.sin((a / P) * Math.PI * 2);
  if (ph < 10) {
    const dx = (ph - 5) / 5, dy = (t - ct) / 0.32;
    if (dx * dx + dy * dy < 1) {
      if (Math.abs(ph - 6.5) < 1 && Math.abs(t - ct - 0.08) < 0.08) return C.black; // 目
      return ph > 8 ? body2 : body;
    }
  }
  if (Math.abs(t - ct) < 0.17) return (Math.floor(a) + Math.floor(t * 7)) % 2 ? body : body2;
  // 背びれ
  if (t > ct + 0.17 && t < ct + 0.26 && ph % 4 < 2) return body2;
  return bg;
}

// 象形文字の帯（h: 帯の中の高さ 0..7）。王の名は金の枠（カルトゥーシュ）で囲む
function glyphBand(a, h, bg = C.plaster, ink = null) {
  const gx = Math.floor(a / 5), la = ((Math.floor(a) % 5) + 5) % 5;
  const grp = ((gx % 9) + 9) % 9;
  const cart = grp >= 3 && grp < 6;
  if (cart && (h === 0 || h === 7 || (grp === 3 && la === 0) || (grp === 5 && la === 4))) return C.gold;
  if (la === 4 || h === 0 || h === 7) return cart ? mix(bg, C.gold, 0.25) : bg;
  const bit = hash3(gx, h, la) % 5 < 2;
  if (!bit) return cart ? mix(bg, C.gold, 0.25) : bg;
  const k = hash3(gx, 3, 9) % 3;
  return ink ?? (k === 0 ? C.lapis : k === 1 ? C.black : C.red);
}

// 歴代王の行列（h: 帯の中の高さ 0..34）。王ごとに冠の色が違う
function kingBand(a, h, bg = C.plaster) {
  const idx = Math.floor(a / 28);
  const la = (((a % 28) + 28) % 28) - 14;
  const al = Math.abs(la);
  if (h < 1) return C.gold;
  if (h >= 2 && h < 12 && al < 2 && al > 0.4) return C.ochre; // 脚
  if (h >= 10 && h < 16 && al < 4 - (h - 10) * 0.3) return C.white; // 腰布
  if (h >= 16 && h < 24 && al < 3) return h >= 21 ? (al < 2.6 ? C.gold : C.lapis) : C.ochre; // 胴と胸飾り
  if (h >= 18 && h < 20 && la >= 3 && la < 7) return C.ochre; // 前へ伸ばした腕
  if (la >= 6 && la < 7 && h >= 2 && h < 32) return C.gold; // 王笏
  if (h >= 24 && h < 29 && al < 2) return h === 26 && la === 1 ? C.black : C.ochre; // 顔
  const crown = [C.white, C.red, C.lapis, C.gold][idx & 3];
  if (h >= 29 && h < 34 && al < 2 - (h - 29) * 0.3) return crown;
  return bg;
}

// 天井: 青に金の星
const starCeil = (u, v, base = C.ceil, star = C.gold) => (hash3(u, v, 77) % 41 === 0 ? star : base);

// 整えた石の床（石畳）
function flagstone(u, v, base = C.floor, alt = C.floor2) {
  if (((u % 8) + 8) % 8 === 0 || ((v % 8) + 8) % 8 === 0) return C.joint;
  return hash3(floorDiv(u, 8), floorDiv(v, 8), 5) % 2 ? base : alt;
}

// 部屋・廊下の面の色。face: 'floor' | 'ceil' | 'wall'、a: 壁に沿った位置、h: 床からの高さ
function interiorColor(space, face, u, v, y, a) {
  const h = y - space.y0, H = space.y1 - space.y0;
  if (space.style === 'rough') {
    const n = noise3(u / 5, y / 5, v / 5, 909);
    if (n > 0.78) return C.crack;
    const bc = hash3(floorDiv(u + Math.floor(n * 6), 9), floorDiv(y, 7), floorDiv(v + Math.floor(n * 6), 9));
    return shade(C.rough[bc % C.rough.length], 0.9 + (hash3(u, y, v) % 20) / 100);
  }
  if (space.style === 'throne') {
    if (face === 'floor') return (u + v) % 2 === 0 ? C.tfloor : 0x2a201c;
    if (face === 'ceil') return starCeil(u, v, 0x1a0c0a, C.red);
    if (h < 2) return C.black;
    if (h >= 6 && h < 16) return dragonBand(a, (h - 6) / 10, C.tred, C.gold, C.gold2);
    if (h >= 20 && h < 28) return glyphBand(a, h - 20, C.tred, C.gold);
    if (h >= 32 && h < 66) return kingBand(a, h - 32, C.tred);
    return hash3(floorDiv(a, 12), floorDiv(h, 8), 3) % 3 ? C.tred : 0x4e1612;
  }
  if (face === 'floor') {
    if (space.style === 'hall' && Math.abs(v) < 7) return Math.abs(v) >= 6 ? C.gold : C.runner; // 中央の敷物
    return flagstone(u, v);
  }
  if (face === 'ceil') return starCeil(u, v);
  if (h < 2) return C.skirt;
  if (space.style === 'hall') {
    if (h >= 6 && h < 40) return kingBand(a, h - 6);
    if (h >= 46 && h < 60) return dragonBand(a, (h - 46) / 14);
    if (h >= 66 && h < 222) {
      // 縦に並ぶ象形文字の列（10 ボクセルごと）
      const col = ((Math.floor(a) % 10) + 10) % 10;
      if (col === 0) return C.gold;
      if (col >= 2 && col < 7) return glyphBand(Math.floor(a / 10) * 5 + col - 2, ((h - 66) % 8 + 8) % 8, C.plaster);
      return C.plaster;
    }
    if (h >= 226 && h < 236) return ((Math.floor(a) + h) % 6 < 3) ? C.lapis : C.gold;
    return C.plaster;
  }
  if (space.style === 'room') {
    if (h >= 8 && h < 16) return glyphBand(a, h - 8);
    return C.plaster;
  }
  // 廊下
  if (h >= 4 && h < 11) return dragonBand(a, (h - 4) / 7);
  if (h >= 13 && h < 21) return glyphBand(a, h - 13);
  if (h >= H - 2) return (Math.floor(a / 2) % 3 === 0) ? C.red : Math.floor(a / 2) % 3 === 1 ? C.lapis : C.gold;
  return C.plaster;
}

function fixtureColor(kind, u, v, y, space) {
  const h = y - space.y0;
  switch (kind) {
    case 'base': return C.gold2;
    case 'capital': return (Math.floor(Math.atan2(v, u) * 6) % 2) ? C.green : C.gold;
    case 'column': return h % 18 < 2 ? C.gold : ((Math.floor(Math.atan2(v % 30, u % 30) * 3) + h) % 12 < 6 ? C.plaster : mix(C.plaster, C.ochre, 0.4));
    case 'dais': return h % 2 ? C.stair : C.gold2;
    case 'coffin': return h >= 11 ? C.gold : (h + Math.abs(v)) % 3 === 0 ? C.coffin2 : C.coffin;
    case 'tcolumn': return h % 12 < 2 ? C.gold : 0x3a1410;
    case 'tdais': return h % 2 ? 0x2a1a16 : C.gold2;
    case 'throne': return h > 50 ? C.gold : (h + Math.abs(v)) % 5 === 0 ? C.red : 0x2a1a16;
    default: return C.plaster;
  }
}

// ---- 外の色 --------------------------------------------------------------------

function blockColor(u, v, y, face) {
  const k = Math.floor(y / COURSE);
  if (k >= COURSES - 3) return (hash3(u, y, v) % 4 === 0) ? C.gold2 : C.gold; // 頂上の冠石（金）
  const a = face === 'u' ? v : u;
  if (y % COURSE === 0) return C.joint;
  const off = (k % 2) * 8;
  if (((a + off) % 16 + 16) % 16 === 0) return C.joint;
  const blk = hash3(k, floorDiv(a + off, 16), face === 'u' ? 1 : 2);
  const base = C.sand[blk % C.sand.length];
  const wear = noise3(u / 13, y / 13, v / 13, 21);
  return shade(base, 0.88 + wear * 0.2);
}

function outerColor(u, v, y) {
  const av = Math.abs(v);
  if (u >= 304 && u < 309) {
    // 柱（パピルスの柱頭）とまぐさ石の日輪
    if (y >= 280) {
      if (av < 4 && y >= 283 && y < 291) return av < 2.5 ? C.red : C.gold;
      if (av < 19 && y >= 285 && y < 289) return (av % 3 < 1.5) ? C.lapis : C.gold;
      return y >= 292 ? C.gold : C.white;
    }
    if (y >= 274) return (y % 2) ? C.green : C.gold;
    return (y % 10 < 1) ? C.gold : C.white;
  }
  if (u >= 290 && u < 304 && av < 26) {
    if (y >= 266 && y < 274 && av < 22) return glyphBand(v + 30, y - 266);
    return av < 12 && y >= ENTRY_Y && y < 280 ? C.gold2 : (y % 12 === 0 ? C.joint : C.white);
  }
  if (u >= 304 && u < FRONT && av < STAIR_HALF + 4) {
    if (av >= STAIR_HALF) return (y % 6 < 3) ? C.ochre : C.red; // 欄干
    const t = stairTop(u);
    if (y === t - 1) return (u % 2) ? C.stair : C.stair2;
    return C.stair2;
  }
  const face = Math.abs(u) >= Math.abs(v) ? 'u' : 'v';
  return blockColor(u, v, y, face);
}

// ---- 参道と門の飾り -------------------------------------------------------------

const OBELISKS = [];
const SPHINXES = [];
const BRAZIERS = [];
for (const side of [-1, 1]) {
  for (const u of [620, 740, 860]) OBELISKS.push([u, side * 38]);
  for (const u of [580, 680, 780, 1000]) SPHINXES.push([u, side * 38, side]);
  for (let u = 600; u < AVENUE_END - 20; u += 40) if (Math.abs(u - GATE_U) > 30 && Math.abs(u - STATUE_U) > 30) BRAZIERS.push([u, side * 30]);
}

// 列 (u, v) の近くにある参道の飾り
function extContext(u, v) {
  const near = (list) => list.filter((q) => Math.abs(u - q[0]) <= 7 && Math.abs(v - q[1]) <= 12);
  return { obs: near(OBELISKS), sph: near(SPHINXES), br: near(BRAZIERS) };
}

// 参道のまわりの物の、高さ y（広場から）のセルの色（なければ 0）。色は表面かどうかに関係なく返す
function extCell(u, v, y, ctx = extContext(u, v)) {
  const av = Math.abs(v);
  if (u < FRONT - 2 || u >= AVENUE_END + 2 || av > 90) return 0;
  // 塔門: 外側へ傾いた 2 つの塔と、まぐさ・コーニス
  if (Math.abs(u - GATE_U) < 14 && av < 76) {
    const du = Math.abs(u - GATE_U);
    const h = y;
    if (h < 124) {
      const outer = 74 - h * 0.08, depth = 13 - h * 0.025;
      const cornice = h >= 118;
      const inTower = av >= 26 && av < (cornice ? outer + 2 : outer) && du < (cornice ? depth + 1.5 : depth);
      const lintel = av < 26 && h >= 92 && du < (cornice ? depth + 1.5 : depth);
      if (inTower || lintel) {
        if (cornice) return h % 2 ? C.gold : C.lapis;
        if (lintel && du > depth - 1.5) {
          // 翼のある日輪
          if (av < 5 && h >= 100 && h < 110) return av < 3.5 ? C.red : C.gold;
          if (av < 24 && h >= 102 && h < 108) return Math.floor(av) % 3 ? C.lapis : C.gold;
        }
        if (inTower && du > depth - 1.5) {
          const a = u + v;
          if (h >= 20 && h < 54) return kingBand(av - 26 + 2, h - 20, C.sand[1]);
          if (h >= 60 && h < 68) return glyphBand(av, h - 60, C.sand[0]);
          if (h >= 74 && h < 88) return dragonBand(av * 1.3, (h - 74) / 14, C.sand[2], C.red, C.gold);
          void a;
        }
        return h % COURSE === 0 ? C.joint : C.sand[(Math.floor(h / COURSE) + Math.floor(av / 16)) % C.sand.length];
      }
    }
  }
  // アヌビス像の台座
  if (Math.abs(u - STATUE_U) < 17 && Math.abs(av - STATUE_V) < 15 && y < PEDESTAL_H) {
    if (y >= 4 && y < 11 && (Math.abs(u - STATUE_U) > 15.5 || Math.abs(av - STATUE_V) > 13.5)) return glyphBand(u + av, y - 4, C.black, C.gold);
    return y >= PEDESTAL_H - 1 ? C.gold2 : 0x2a2622;
  }
  // 参道の石畳（1 段高い）と、両脇の低い壁
  if (av < AVENUE_HALF && y === 0) return av >= AVENUE_HALF - 2 ? C.gold2 : ((u + Math.floor(av / 4)) % 6 === 0 ? C.joint : 0xb9a37a);
  if (av >= 44 && av < 47 && y < 4 && Math.abs(u - GATE_U) > 80 && Math.abs(u - STATUE_U) > 24) return y === 3 ? C.gold2 : C.sand[2];
  // オベリスク
  for (const [ou, ov] of ctx.obs) {
    const du = Math.abs(u - ou), dv = Math.abs(v - ov);
    if (du > 5 || dv > 5) continue;
    if (y < 3) return du < 4.5 && dv < 4.5 ? C.sand[4] : 0;
    const w = 3.2 - (y - 3) * 0.035;
    if (y < 52 && du < w && dv < w) {
      if (du > w - 1 && y > 8 && y < 48) return glyphBand(y, Math.floor(dv * 2) % 8, C.sand[3], C.lapis);
      return C.sand[3];
    }
    if (y >= 52 && y < 57 && du < 57 - y - 1.5 && dv < 57 - y - 1.5) return C.gold;
  }
  // スフィンクス（道の方を向いて伏せる）
  for (const [su, sv, side] of ctx.sph) {
    const du = u - su, b = (sv - v) * side; // b: 道の方向へ +
    if (Math.abs(du) > 6 || b < -10 || b > 12) continue;
    if (y < 2) return Math.abs(du) < 6 && b > -10 && b < 12 ? C.sand[4] : 0;
    if (y < 8 && Math.abs(du) < 4 && b > -8 && b < 6) return C.sand[1]; // 胴
    if (y < 4 && Math.abs(du) < 3.5 && b >= 6 && b < 11 && Math.abs(du) > 1) return C.sand[1]; // 前脚
    if (y >= 6 && y < 15 && Math.abs(du) < 3 && b >= 4 && b < 9) {
      // 頭と頭巾（金と青の縞）
      if (b >= 8 && y >= 9 && y < 13 && Math.abs(du) < 2) return y === 11 && Math.abs(du) > 0.5 ? C.black : C.sand[0];
      return (y % 2) ? C.gold : C.lapis;
    }
  }
  // 火の燃える鉢
  for (const [bu, bv] of ctx.br) {
    const du = Math.abs(u - bu), dv = Math.abs(v - bv);
    if (du > 3 || dv > 3) continue;
    if (y < 9 && du < 1 && dv < 1) return 0x3a302a;
    if (y >= 9 && y < 11 && du < 3 && dv < 3) return y === 10 && du < 2 && dv < 2 ? 0 : C.gold2;
    if (y >= 10 && y < 14 && du < 2 - (y - 10) * 0.4 && dv < 2 - (y - 10) * 0.4) return y >= 12 ? C.flame2 : C.flame;
  }
  return 0;
}
const EXT_TOP = 130;

// ---- チャンクへの塗り ------------------------------------------------------------

// 世界の範囲（チャンクがかかるか調べるため）
function siteBounds(s) {
  const pts = [toWorld(s, -PLAZA, -PLAZA), toWorld(s, AVENUE_END, -PLAZA), toWorld(s, -PLAZA, PLAZA), toWorld(s, AVENUE_END, PLAZA)];
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) };
}

function touches(world, cx, cz) {
  const s = pyramidSite(world);
  if (!s) return null;
  s.bounds ??= siteBounds(s);
  const b = s.bounds;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  if (x0 + CHUNK < b.x0 || x0 > b.x1 || z0 + CHUNK < b.z0 || z0 > b.z1) return null;
  return s;
}

// 列の、空間の下限（その列で一番低い空間の床の 1 つ下）
function columnBottom(u, v) {
  let lo = Infinity;
  for (const s of spacesAt(u, v)) lo = Math.min(lo, s.y0 - 1);
  return lo;
}

// チャンクの base（持つ高さの下限）を決める。ピラミッドの中は、表面の近くと空間のある所だけ持つ
export function structureBase(world, cx, cz, base) {
  const s = touches(world, cx, cz);
  if (!s) return base;
  let lo = Infinity, any = false;
  for (let lz = -1; lz <= CHUNK; lz++) {
    for (let lx = -1; lx <= CHUNK; lx++) {
      const [u, v] = toLocal(s, cx * CHUNK + lx, cz * CHUNK + lz);
      const t = outerTopBound(u, v);
      if (lx < 0 || lz < 0 || lx === CHUNK || lz === CHUNK) {
        if (t > 0) lo = Math.min(lo, s.P + t - 2);
        continue;
      }
      if (t <= 0) return base; // ピラミッドの外の列がある（ふつうの地面）
      any = true;
      lo = Math.min(lo, s.P + t - 2, s.P + columnBottom(u, v) - 1);
    }
  }
  if (!any) return base;
  return Math.max(0, Math.min(lo, HEIGHT - 2));
}

// チャンクにピラミッド・参道・広場の石畳を塗る（地面を塗ったあと、木を塗る前）
export function paintPyramidInto(world, c) {
  const s = touches(world, c.cx, c.cz);
  if (!s) return;
  const P = s.P;
  const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
  // このチャンクにかかる空間
  const corners = [toLocal(s, x0 - 2, z0 - 2), toLocal(s, x0 + CHUNK + 2, z0 + CHUNK + 2)];
  const cu0 = Math.min(corners[0][0], corners[1][0]), cu1 = Math.max(corners[0][0], corners[1][0]);
  const cv0 = Math.min(corners[0][1], corners[1][1]), cv1 = Math.max(corners[0][1], corners[1][1]);
  const local = SPACES.filter((sp) => sp.u1 + 2 > cu0 && sp.u0 - 2 < cu1 && sp.v1 + 2 > cv0 && sp.v0 - 2 < cv1);
  const torches = TORCHES.filter((t) => t.u >= cu0 - 1 && t.u <= cu1 + 1 && t.v >= cv0 - 1 && t.v <= cv1 + 1);
  const solid = (u, v, y, sp) => {
    if (!outerSolid(u, v, y)) return false;
    return !spaceAt(sp, u, v, y);
  };
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, z = z0 + lz;
      const [u, v] = toLocal(s, x, z);
      const col = lx + CHUNK * lz;
      const top = outerTopBound(u, v);
      if (top > 0) {
        // ピラミッド
        const sp = local.length ? spacesAt(u, v, local) : [];
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([du, dv]) => [u + du, v + dv]);
        const nsp = nb.map(([nu, nv]) => (local.length ? spacesAt(nu, nv, local) : []));
        const nTop = Math.min(...nb.map(([nu, nv]) => outerTopBound(nu, nv)));
        const complex = (u >= 288 && u < FRONT + 1 && Math.abs(v) < 40);
        const near = [...new Set([...sp, ...nsp.flat()])];
        const spLo = near.length ? Math.min(...near.map((q) => q.y0 - 1)) : Infinity;
        const spHi = near.length ? Math.max(...near.map((q) => q.y1 + 1)) : -Infinity;
        const yTop = P + Math.max(top, spHi);
        c.ensure(Math.min(HEIGHT - 1, yTop));
        let colTop = 0;
        for (let y = Math.max(c.base, P - 80); y < Math.min(HEIGHT, yTop + 1); y++) {
          const yr = y - P;
          const i = c.index(lx, y, lz);
          if (yr < 0 && !(yr >= spLo - 1)) continue; // 地面の下（空間がなければそのまま）
          const isSolid = yr < 0 ? !spaceAt(sp, u, v, yr) : solid(u, v, yr, sp);
          if (!isSolid) {
            if (c.owner[i] === GROUND_ID || c.owner[i] === ROCK_ID || c.owner[i] === PLANT_ID) {
              c.owner[i] = EMPTY;
              c.color[i] = 0;
            }
            continue;
          }
          c.owner[i] = ROCK_ID;
          colTop = Math.max(colTop, y + 1);
          // 表面か（外・中の空間に面しているか）
          let inner = yr >= spLo - 1 && yr <= spHi && nearSpace(near, u, v, yr);
          if (inner) for (const q of sp) if (q.style !== 'rough' && u >= q.u0 && u < q.u1 && v >= q.v0 && v < q.v1 && yr >= q.y0 && yr < q.y1 && fixtureDeep(q, u, v, yr)) inner = false;
          if (!inner && !complex && yr < nTop - 1 && yr < top - 1) {
            c.color[i] = 0;
            continue;
          }
          let face = null, space = null, along = 0;
          const up = yr + 1 < 0 ? !spaceAt(sp, u, v, yr + 1) : solid(u, v, yr + 1, sp);
          if (!up) {
            space = spaceAt(sp, u, v, yr + 1);
            face = 'floor';
          } else {
            const down = yr - 1 < 0 ? !spaceAt(sp, u, v, yr - 1) : solid(u, v, yr - 1, sp);
            if (!down && yr - 1 >= -80) {
              space = spaceAt(sp, u, v, yr - 1);
              face = 'ceil';
            }
          }
          if (!face) {
            for (let k = 0; k < 4; k++) {
              const [nu, nv] = nb[k];
              const ns = yr < 0 ? !spaceAt(nsp[k], nu, nv, yr) : solid(nu, nv, yr, nsp[k]);
              if (!ns) {
                face = 'wall';
                space = spaceAt(nsp[k], nu, nv, yr);
                along = k < 2 ? v : u;
                break;
              }
            }
          }
          if (!face) {
            c.color[i] = 0;
            continue;
          }
          if (space) {
            // 中の面: 部屋の飾り・明かり
            const fx = space.style !== 'rough' ? fixture(space, u, v, yr) : null;
            const base = fx ? fixtureColor(fx, u, v, yr, space) : interiorColor(space, face, u, v, yr, along);
            c.color[i] = lit(base, lightAt(u, v, yr, space));
          } else {
            c.color[i] = outerColor(u, v, yr);
          }
        }
        c.height[col] = Math.max(c.height[col], colTop || c.height[col]);
        if (colTop > c.top) c.top = colTop;
        continue;
      }
      // ピラミッドの外: 参道の飾りと、広場の石畳
      if (plazaOutside(u, v) <= 0) {
        const g = c.height[col];
        if (g - 1 >= c.base && g === P) {
          const i = c.index(lx, g - 1, lz);
          if (c.owner[i] === GROUND_ID) c.color[i] = (((u % 10) + 10) % 10 === 0 || ((v % 10) + 10) % 10 === 0) ? 0xb39d74 : (hash3(floorDiv(u, 10), floorDiv(v, 10), 8) % 3 ? 0xd2bd92 : 0xc8b286);
        }
        if (u >= FRONT - 2 && u < AVENUE_END + 2 && Math.abs(v) < 92) {
          let colTop = 0;
          const ctx = extContext(u, v);
          const nctx = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([du, dv]) => [u + du, v + dv, extContext(u + du, v + dv)]);
          const tall = Math.abs(u - GATE_U) < 15 || ctx.obs.length ? EXT_TOP : Math.abs(u - STATUE_U) < 18 ? PEDESTAL_H + 1 : 16;
          for (let yr = 0; yr < tall; yr++) {
            const color = extCell(u, v, yr, ctx);
            if (!color) continue;
            const y = P + yr;
            c.ensure(y);
            const i = c.index(lx, y, lz);
            c.owner[i] = ROCK_ID;
            const open = nctx.some(([nu, nv, nc]) => !extCell(nu, nv, yr, nc)) || !extCell(u, v, yr + 1, ctx) || (yr > 0 && !extCell(u, v, yr - 1, ctx));
            c.color[i] = open ? color : 0;
            colTop = y + 1;
          }
          if (colTop) {
            c.height[col] = Math.max(c.height[col], colTop);
            if (colTop > c.top) c.top = colTop;
          }
        }
      }
    }
  }
  // 松明（腕木と炎）
  for (const t of torches) {
    const [x, z] = toWorld(s, t.u, t.v);
    if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
    const y = P + t.y;
    if (y < c.base) continue;
    c.ensure(y + 3);
    const lx = x - x0, lz = z - z0;
    const put = (yy, color) => {
      const i = c.index(lx, yy, lz);
      if (c.owner[i] !== EMPTY) return;
      c.owner[i] = ROCK_ID;
      c.color[i] = color;
      if (yy + 1 > c.top) c.top = yy + 1;
    };
    put(y - 1, C.torch);
    put(y, C.torch);
    put(y + 1, C.flame);
    put(y + 2, C.flame2);
  }
}

// 列 (x, z) の建物のてっぺん（世界の高さ。なければ 0）。遠景や、空を飛ぶ物がぶつからないように
export function structureTop(world, x, z) {
  const s = world._site === undefined ? pyramidSite(world) : world._site;
  if (!s) return 0;
  const [u, v] = toLocal(s, x, z);
  const t = outerTopBound(u, v);
  if (t > 0) return s.P + t;
  if (Math.abs(u - GATE_U) < 14 && Math.abs(v) < 76) return s.P + 124;
  if (Math.abs(u - STATUE_U) < 17 && Math.abs(Math.abs(v) - STATUE_V) < 15) return s.P + PEDESTAL_H + 100;
  return 0;
}

// 遠景用: 列のてっぺんの高さと色（なければ null）
export function farStructure(world, x, z) {
  const s = world._site === undefined ? pyramidSite(world) : world._site;
  if (!s) return null;
  const [u, v] = toLocal(s, x, z);
  const t = outerTopBound(u, v);
  if (t > 0) {
    const k = Math.floor((t - 1) / COURSE);
    return { top: s.P + t, color: k >= COURSES - 3 ? C.gold : shade(C.sand[(k + 3) % C.sand.length], k % 2 ? 0.86 : 1.04) };
  }
  if (Math.abs(u - GATE_U) < 14 && Math.abs(v) < 76 && Math.abs(v) >= 26) return { top: s.P + 120, color: C.sand[1] };
  if (Math.abs(u - GATE_U) < 14 && Math.abs(v) < 26) return { top: s.P + 120, color: C.gold2, bottom: s.P + 92 };
  if (Math.abs(u - STATUE_U) < 17 && Math.abs(Math.abs(v) - STATUE_V) < 15) return { top: s.P + PEDESTAL_H, color: 0x2a2622 };
  return null;
}

// ---- ほかのモジュールが使う場所 ----------------------------------------------------

// 世界の座標の点（ピラミッドの座標 u, v, 広場からの高さ y）
export function sitePoint(world, u, v, y) {
  const s = pyramidSite(world);
  const [x, z] = toWorld(s, u, v);
  return [x, s.P + y, z];
}

// 骸骨（墓場泥棒）が倒れている所（ピラミッドの座標。床の高さ）
export const SKELETON_SPOTS = [
  [262, -4, ENTRY_Y], [220, 60, ENTRY_Y], [108, 10, 214], [-20, 96, 140], [-28, 140, 140],
  [-40, -146, 146], [20, -40, 140], [-60, 46, 140], [-230, 2, 10],
];
// 赤い骨の王の玉座（足もとの位置。正面は +u）
export const KING_SPOT = [-310, 0, 16];
export const THRONE_ROOM = BOXES.find((b) => b.name === 'throne');
