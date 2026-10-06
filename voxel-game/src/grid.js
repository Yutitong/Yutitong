// 世界の格子の寸法と、座標 ↔ チャンクの変換

export const CHUNK = 16; // チャンクの一辺（ボクセル）
export const HEIGHT = 1024; // 世界の高さ（ボクセル ≈ 154m）。巨大樹（およそ 100m）や山（40〜60m）の上の空を龍が飛ぶ
// 1段（y が同じセル）のセル数。チャンクの配列は y の段ごとに並ぶので、上に継ぎ足せる
export const LAYER = CHUNK * CHUNK;

export const floorDiv = (a, b) => Math.floor(a / b);
// チャンクの番号を1つの数値にまとめる（文字列を作らずに Map を引くため）
export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
export const chunkKeyAt = (x, z) => chunkKey(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
// 段 (y - チャンクの base) の中のセル番号。チャンクは base より下（地中の奥）を持たない
export const cellIndex = (lx, y, lz) => lx + CHUNK * (lz + CHUNK * y);
