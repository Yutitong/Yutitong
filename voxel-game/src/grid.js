// 世界の格子の寸法と、座標 ↔ チャンクの変換

export const CHUNK = 16; // チャンクの一辺（ボクセル）
export const HEIGHT = 96; // 世界の高さ（ボクセル ≈ 14m）。y = 0 が地面

export const floorDiv = (a, b) => Math.floor(a / b);
// チャンクの番号を1つの数値にまとめる（文字列を作らずに Map を引くため）
export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
export const chunkKeyAt = (x, z) => chunkKey(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
// チャンクの中のセル番号
export const cellIndex = (lx, y, lz) => lx + CHUNK * (lz + CHUNK * y);
