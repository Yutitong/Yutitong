// 人型キャラのボクセル模型と歩行アニメーション
//
// キャラは常に 9×14×9 の直方体（当たり判定）を占有する。
// アニメーションはこの直方体の中で「どのボクセルを何色で点灯するか」を切り替えるだけ。
// 色 0 は「占有しているが消灯」を表す。
//
// 正面 (+z 向き) から見た寸法（1ボクセル ≈ 15cm、身長 14 ≈ 2.1m 弱）
//   y 10-13  頭      x 2-6, z 2-6
//   y  5-9   胴      x 2-6, z 3-5   / 腕 x 0-1 と x 7-8, z 3-5（一番下は手）
//   y  1-4   脚      x 2-3 と x 5-6, z 3-5（y 4 は腰で一続き）
//   y  0     靴

export const HUMAN_SIZE = [9, 14, 9];
const [W, H, D] = HUMAN_SIZE;
const C = (W - 1) / 2; // 回転の中心 (4)

// 歩行の1周期（8コマ = 8ボクセル進む ≈ 1.2m の歩幅）。値は足先の前後のずれ。
export const WALK_CYCLE = [0, 1, 2, 1, 0, -1, -2, -1];

// 向き: 0 = +z, 1 = +x, 2 = -z, 3 = -x
export const FACING_DIRS = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 0, -1],
  [-1, 0, 0],
];

export function facingOf(dir) {
  return FACING_DIRS.findIndex((d) => d[0] === dir[0] && d[2] === dir[2]);
}

// 0 を挟んで対称に丸める（Math.round(-0.5) が 0 になる問題を避ける）
const roundSym = (v) => Math.sign(v) * Math.round(Math.abs(v));

function buildFrontFacing(p, swing) {
  const grid = new Uint32Array(W * H * D); // 0 = 消灯
  const set = (x, y, z, color) => {
    if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) grid[x + W * (z + D * y)] = color;
  };
  const slab = (x0, x1, y, z0, z1, color) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) set(x, y, z, color);
  };

  // 脚: 腰 (y4) を支点に、足先ほど大きく前後にずれる。左右で逆向き。
  for (let y = 0; y <= 4; y++) {
    const k = (4 - y) / 4;
    const color = y === 0 ? p.shoes : p.pants;
    const left = roundSym(swing * k);
    const right = roundSym(-swing * k);
    slab(2, 3, y, 3 + left, 5 + left, color);
    slab(5, 6, y, 3 + right, 5 + right, color);
  }
  slab(4, 4, 4, 3, 5, p.pants); // 股

  // 胴
  for (let y = 5; y <= 9; y++) slab(2, 6, y, 3, 5, p.shirt);

  // 腕: 肩 (y9) を支点に、同じ側の脚と逆に振る
  for (let y = 5; y <= 9; y++) {
    const k = (9 - y) / 4;
    const color = y === 5 ? p.skin : p.shirt;
    const left = roundSym(-swing * k);
    const right = roundSym(swing * k);
    slab(0, 1, y, 3 + left, 5 + left, color);
    slab(7, 8, y, 3 + right, 5 + right, color);
  }

  // 頭
  for (let y = 10; y <= 13; y++) slab(2, 6, y, 2, 6, p.skin);
  slab(2, 6, 13, 2, 6, p.hair); // 頭頂
  for (let y = 10; y <= 12; y++) slab(2, 6, y, 2, 2, p.hair); // 後頭部
  for (let z = 2; z <= 5; z++) {
    set(2, 12, z, p.hair); // 横髪
    set(6, 12, z, p.hair);
  }
  set(3, 11, 6, p.eyes);
  set(5, 11, 6, p.eyes);

  return grid;
}

// 正面向きの模型を facing の向きに回す。中心 (4, 4) まわりの 90° 回転なので
// 足元の 9×9 は変わらず、当たり判定も変わらない。
function rotate(x, z, facing) {
  switch (facing) {
    case 1: return [z, 2 * C - x];
    case 2: return [2 * C - x, 2 * C - z];
    case 3: return [2 * C - z, x];
    default: return [x, z];
  }
}

const cache = new Map();

// [[dx, dy, dz, color], ...] を返す。直方体の全セルを含む（消灯セルは color 0）。
export function humanoidVoxels(palette, facing, frame) {
  const key = `${palette.id}|${facing}|${frame}`;
  let voxels = cache.get(key);
  if (voxels) return voxels;
  const grid = buildFrontFacing(palette, WALK_CYCLE[frame % WALK_CYCLE.length]);
  voxels = [];
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const [rx, rz] = rotate(x, z, facing);
        voxels.push([rx, y, rz, grid[x + W * (z + D * y)]]);
      }
    }
  }
  cache.set(key, voxels);
  return voxels;
}

export const PALETTES = {
  player: { id: 'player', skin: 0xf1c7a0, hair: 0x3a2618, eyes: 0x1b1d2a, shirt: 0xf2a541, pants: 0x2f4a7a, shoes: 0x3b2b22 },
  npc: [
    { id: 'npc0', skin: 0xe8b58e, hair: 0x1f1f2b, eyes: 0x1b1d2a, shirt: 0x3cc4b0, pants: 0x4a4a5c, shoes: 0x2a2a30 },
    { id: 'npc1', skin: 0xc68d63, hair: 0x6b3b1f, eyes: 0x1b1d2a, shirt: 0x9b7bff, pants: 0x2e3b4e, shoes: 0x4a3426 },
    { id: 'npc2', skin: 0xf6d2b5, hair: 0xc9a25a, eyes: 0x1b1d2a, shirt: 0xff6f6f, pants: 0x5b4a3a, shoes: 0x2a2a30 },
    { id: 'npc3', skin: 0x8d5a3b, hair: 0x14141a, eyes: 0x1b1d2a, shirt: 0xf0f0f0, pants: 0x3d6b4a, shoes: 0x2a2a30 },
  ],
};
