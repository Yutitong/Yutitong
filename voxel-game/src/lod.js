// 少し遠くのチャンクを、ボクセルをまとめた粗いブロックで描くためのデータ
//
// - 2×2×2 のセルを 1 つのブロックにまとめる（30cm）。さらに遠くは 4×4×4（60cm）
// - ブロックの色は、中で一番上にある色のついたセルの色（上から見える面の色）。色のついたセルが 1 つでもあれば埋まっている
//   （細い幹や枝も消えないように）。水面もそのまま色の箱にする
// - 描くのは、外（空いているブロック）に面したブロックだけ。チャンクの端は、となりのチャンクが分からないので、
//   地表の近くのブロックだけ描く（地中の奥の壁は見えない）
//
// チャンクを作るスレッドでも、画面のスレッドでも使う（three.js には依存しない）

const CHUNK = 16;

// チャンクの色の配列から、2×2×2 のブロックの色の格子を作る。
// c: チャンク（color / owner / base / top / height）。skip(持ち主): 入れないセル（草・動く物）
export function downsample(c, skip = null) {
  const { color, owner, base, top, height } = c;
  const s = 2;
  const y0 = Math.floor(base / s) * s;
  const ny = Math.max(1, Math.ceil((top - y0) / s));
  const n = CHUNK / s;
  const grid = new Uint32Array(n * n * ny);
  const layer = CHUNK * CHUNK;
  const cells = color.length / layer;
  for (let y = Math.max(base, y0); y < top; y++) {
    const ly = y - base;
    if (ly >= cells) break;
    const by = Math.floor((y - y0) / s);
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const i = x + CHUNK * (z + CHUNK * ly);
        const v = color[i];
        if (!v || (skip && skip(owner[i]))) continue;
        // 上のセルほど後に来るので、上書きすると一番上の色になる。黒でも 0 にならないように印を立てる
        grid[(x >> 1) + n * ((z >> 1) + n * by)] = (v & 0xffffff) | 0x1000000;
      }
    }
  }
  // ブロックの列ごとの地面の高さ（いちばん高い所）
  const heights = new Uint16Array(n * n);
  for (let z = 0; z < CHUNK; z++) {
    for (let x = 0; x < CHUNK; x++) {
      const i = (x >> 1) + n * (z >> 1);
      heights[i] = Math.max(heights[i], height[x + CHUNK * z]);
    }
  }
  return { s, y0, ny, grid, heights };
}

// 2×2×2 の格子から、4×4×4 の格子を作る
export function coarser(lod) {
  const s = lod.s * 2;
  const n0 = CHUNK / lod.s, n = CHUNK / s;
  const y0 = Math.floor(lod.y0 / s) * s;
  const ny = Math.max(1, Math.ceil((lod.y0 + lod.ny * lod.s - y0) / s));
  const grid = new Uint32Array(n * n * ny);
  for (let by = 0; by < lod.ny; by++) {
    const y = lod.y0 + by * lod.s;
    const cy = Math.floor((y - y0) / s);
    for (let bz = 0; bz < n0; bz++) {
      for (let bx = 0; bx < n0; bx++) {
        const c = lod.grid[bx + n0 * (bz + n0 * by)];
        if (c) grid[(bx >> 1) + n * ((bz >> 1) + n * cy)] = c;
      }
    }
  }
  const heights = new Uint16Array(n * n);
  for (let bz = 0; bz < n0; bz++) {
    for (let bx = 0; bx < n0; bx++) {
      const i = (bx >> 1) + n * (bz >> 1);
      heights[i] = Math.max(heights[i], lod.heights[bx + n0 * bz]);
    }
  }
  return { s, y0, ny, grid, heights };
}

// 描くブロック: 外に面したものだけ。戻り値 { count, cell: Float32Array(x, y, z, 1 ...)（チャンクの中の位置・ブロックの中心）, rgb: Uint8Array }
export function lodInstances(lod) {
  const { s, y0, ny, grid, heights } = lod;
  const n = CHUNK / s;
  const filled = (x, y, z) => y >= 0 && y < ny && grid[x + n * (z + n * y)] !== 0;
  let count = 0;
  const cell = new Float32Array(grid.length * 4);
  const rgb = new Uint8Array(grid.length * 3);
  for (let by = 0; by < ny; by++) {
    for (let bz = 0; bz < n; bz++) {
      for (let bx = 0; bx < n; bx++) {
        const c = grid[bx + n * (bz + n * by)];
        if (!c) continue;
        // 下は地中とみなす。チャンクの端の向こうは、地表より下なら埋まっているとみなす
        const top = y0 + (by + 1) * s;
        const nearSurface = top >= heights[bx + n * bz] - 1;
        const open = (by + 1 < ny ? !filled(bx, by + 1, bz) : true)
          || (by > 0 && !filled(bx, by - 1, bz))
          || (bx + 1 < n ? !filled(bx + 1, by, bz) : nearSurface)
          || (bx > 0 ? !filled(bx - 1, by, bz) : nearSurface)
          || (bz + 1 < n ? !filled(bx, by, bz + 1) : nearSurface)
          || (bz > 0 ? !filled(bx, by, bz - 1) : nearSurface);
        if (!open) continue;
        cell[count * 4] = bx * s + s / 2;
        cell[count * 4 + 1] = y0 + by * s + s / 2;
        cell[count * 4 + 2] = bz * s + s / 2;
        cell[count * 4 + 3] = 1;
        rgb[count * 3] = (c >> 16) & 255; // 0x1000000 の印は捨てる
        rgb[count * 3 + 1] = (c >> 8) & 255;
        rgb[count * 3 + 2] = c & 255;
        count++;
      }
    }
  }
  return { count, cell: cell.subarray(0, count * 4), rgb: rgb.subarray(0, count * 3) };
}

// チャンクから、2×2×2 と 4×4×4 の描くブロックを作る
export function chunkLod(c, skip = null) {
  const l1 = downsample(c, skip);
  return { i1: lodInstances(l1), i2: lodInstances(coarser(l1)) };
}
