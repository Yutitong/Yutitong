// 少し遠くのチャンクを、ボクセルをまとめた粗いブロックで描く（細かく描く範囲のまわりの 2 つの輪）
//
// - 内側の輪は 2×2×2（30cm）、外側の輪は 4×4×4（60cm）のブロック
// - 粗いブロックは、別のスレッドでチャンクを作ってまとめたもの（lod.js）。この世界にチャンクがあれば
//   （掘った・燃えたなどの変化が見えるように）そちらから作る。変わったチャンクは少し間をおいて作り直す
// - 4×4 チャンクのタイルごとに 1 つのメッシュ（描く回数を減らす）。プレイヤーが動いたら、変わったタイルだけ作り直す
// - 細かい描画がまだできていないチャンクは、粗いブロックのまま描いておく（歩いても穴が開かないように）

import * as THREE from 'three';
import { CHUNK, chunkKey, floorDiv } from './grid.js';
import { chunkLod } from './lod.js';
import { PLANT_ID, SOIL_ID } from './ids.js';

const TILE = 4; // タイルの一辺（チャンク）
const REDO_MS = 2500; // 変わったチャンクを作り直す間隔

export class LodRings {
  // material: ボクセルのマテリアル（iCell と色を読む）、gen: 粗いブロックを作るスレッド（LodGenerator）
  constructor(scene, world, material, gen, voxelSize = 1) {
    this.scene = scene;
    this.world = world;
    this.material = material;
    this.gen = gen;
    this.data = new Map(); // チャンク key → { i1, i2, ver, local: 作った時刻（この世界のチャンクから作ったとき） }
    this.edited = new Set(); // 変わったチャンク（この世界のチャンクから作り直す）
    this.tiles = new Map(); // タイルの番号 × 4 + 段 → { mesh, sig }
    this.ver = 0;
    this.detail = 6;
    this.r1 = 12;
    this.r2 = 20;
    this.changed = true; // タイルを調べ直す
    this.ready = 0; // 粗いブロックがそろっている半径（チャンク）
    this.boxes = [null, 2, 4].map((s) => s && new THREE.BoxGeometry(s * voxelSize, s * voxelSize, s * voxelSize));
    this.hasView = () => false;
  }

  setRadii(detail, r1, r2) {
    this.detail = detail;
    this.r1 = r1;
    this.r2 = r2;
    this.changed = true;
  }

  // 地形が変わった（隕石のクレーター）: 当てはまるチャンクの粗いブロックを忘れて作り直す
  forget(test) {
    for (const key of [...this.data.keys()]) {
      const cx = Math.floor(key / 65536) - 32768, cz = (key % 65536) - 32768;
      if (test(cx, cz)) this.data.delete(key);
    }
    this.changed = true;
  }

  // チャンクのセルが変わった
  markDirty(key) {
    this.edited.add(key);
  }

  // 中心から (dx, dz) のチャンクを、粗いブロックで描けるか（粗く描く範囲の外なら、描かなくてよい）
  covers(dx, dz, key) {
    return Math.max(Math.abs(dx), Math.abs(dz)) > this.r2 || (this.data.has(key) && !this.changed);
  }

  // 中心からのチャンクの距離（チェビシェフ）で、どの段で描くか（0 = 細かく、-1 = 描かない）
  levelOf(r, key) {
    if (r <= this.detail) return this.hasView(key) ? 0 : 1;
    if (r <= this.r1) return 1;
    if (r <= this.r2) return 2;
    return -1;
  }

  update(pcx, pcz, budget) {
    const start = performance.now();
    const w = this.world;
    if (!this.center || this.center[0] !== pcx || this.center[1] !== pcz) {
      this.center = [pcx, pcz];
      this.changed = true;
    }
    // 別のスレッドから届いたもの（この世界のチャンクから作ったものがあれば、そちらを使う）
    for (let m; (m = this.gen.take()); ) {
      const key = chunkKey(m.cx, m.cz);
      if (this.data.get(key)?.local) continue;
      this.data.set(key, { i1: m.i1, i2: m.i2, ver: ++this.ver, local: 0 });
      this.changed = true;
    }
    // 近い順に: この世界にチャンクがあれば、ここで作る。なければ別のスレッドに頼む
    const now = performance.now();
    let missing = Infinity; // 粗いブロックがまだないいちばん近い輪
    for (let r = 0; r <= this.r2; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = pcx + dx, cz = pcz + dz, key = chunkKey(cx, cz);
          if (r <= this.detail && this.hasView(key)) continue;
          const d = this.data.get(key);
          const chunk = w.chunks.get(key);
          if (chunk && (!d || (this.edited.has(key) && now - d.local > REDO_MS))) {
            if (performance.now() - start > budget) {
              if (!d) missing = Math.min(missing, r);
              continue;
            }
            this.edited.delete(key);
            const { i1, i2 } = chunkLod(chunk, this.skipper());
            this.data.set(key, { i1, i2, ver: ++this.ver, local: now });
            this.changed = true;
            continue;
          }
          if (d) continue;
          missing = Math.min(missing, r);
          if (r > this.detail && this.gen.ok) this.gen.request(cx, cz);
        }
      }
    }
    if (this.changed) this.rebuildTiles(pcx, pcz, start, budget);
    if (!this.changed) this.ready = Math.min(this.r2, missing - 1);
    // 遠くなったものは忘れる
    if (this.data.size > (2 * this.r2 + 5) ** 2) {
      for (const key of this.data.keys()) {
        const cx = Math.floor(key / 65536) - 32768, cz = (key % 65536) - 32768;
        if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > this.r2 + 2) this.data.delete(key);
      }
    }
    for (const key of this.edited) if (!w.chunks.has(key)) this.edited.delete(key);
  }

  // 草と動く物（龍・人・倒れていく木など）は粗いブロックに入れない
  skipper() {
    const memo = new Map();
    return (o) => {
      if (o === PLANT_ID) return true;
      if (o <= SOIL_ID) return false;
      let s = memo.get(o);
      if (s === undefined) {
        const e = this.world.entities.get(o);
        s = !(e?.tree || e?.giant);
        memo.set(o, s);
      }
      return s;
    };
  }

  // タイルごとに、描くチャンクの組が変わったものだけ作り直す
  rebuildTiles(pcx, pcz, start, budget) {
    const want = new Map(); // タイル key → { level, tx, tz, list: [[key, cx, cz, d]] }
    for (let dz = -this.r2; dz <= this.r2; dz++) {
      for (let dx = -this.r2; dx <= this.r2; dx++) {
        const cx = pcx + dx, cz = pcz + dz, key = chunkKey(cx, cz);
        const level = this.levelOf(Math.max(Math.abs(dx), Math.abs(dz)), key);
        if (level <= 0) continue;
        const d = this.data.get(key);
        if (!d) continue;
        const tx = floorDiv(cx, TILE), tz = floorDiv(cz, TILE);
        const tk = chunkKey(tx, tz) * 4 + level;
        let t = want.get(tk);
        if (!t) want.set(tk, (t = { level, tx, tz, list: [], sig: 0 }));
        t.list.push([key, cx, cz, d]);
        // 組の印（チャンクと、その粗いブロックの版から作る数）
        t.sig = (Math.imul(t.sig, 0x9e3779b1) + Math.imul(key % 0x7fffffff, 31) + d.ver) | 0;
      }
    }
    let done = true;
    for (const [tk, t] of want) {
      const sig = t.sig;
      const old = this.tiles.get(tk);
      if (old && old.sig === sig) continue;
      if (performance.now() - start > budget) {
        done = false;
        continue;
      }
      if (old) this.dispose(old);
      this.tiles.set(tk, { mesh: this.build(t), sig });
    }
    for (const [tk, old] of this.tiles) {
      if (want.has(tk)) continue;
      this.dispose(old);
      this.tiles.delete(tk);
    }
    this.changed = !done;
  }

  build({ level, tx, tz, list }) {
    const pick = (d) => (level === 1 ? d.i1 : d.i2);
    let total = 0;
    for (const [, , , d] of list) total += pick(d).count;
    const cell = new Float32Array(Math.max(1, total) * 4);
    const rgb = new Uint8Array(Math.max(1, total) * 3);
    let n = 0, lo = Infinity, hi = -Infinity;
    for (const [, cx, cz, d] of list) {
      const l = pick(d);
      const ox = (cx - tx * TILE) * CHUNK, oz = (cz - tz * TILE) * CHUNK;
      for (let i = 0; i < l.count; i++) {
        cell[(n + i) * 4] = l.cell[i * 4] + ox;
        const y = l.cell[i * 4 + 1];
        cell[(n + i) * 4 + 1] = y;
        cell[(n + i) * 4 + 2] = l.cell[i * 4 + 2] + oz;
        cell[(n + i) * 4 + 3] = 1;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      rgb.set(l.rgb.subarray(0, l.count * 3), n * 3);
      n += l.count;
    }
    const shape = this.boxes[level];
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(shape.index.clone());
    geo.setAttribute('position', shape.attributes.position.clone());
    geo.setAttribute('normal', shape.attributes.normal.clone());
    geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cell, 4));
    geo.setAttribute('color', new THREE.InstancedBufferAttribute(rgb, 3, true));
    geo.instanceCount = total;
    // 画面の外のタイルは描かない（インスタンスの広がりから、包む球を決める）
    const side = TILE * CHUNK;
    if (!total) lo = hi = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(side / 2, (lo + hi) / 2, side / 2), Math.hypot(side / 2 + 4, (hi - lo) / 2 + 4, side / 2 + 4));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(tx * side, 0, tz * side);
    mesh.visible = total > 0;
    this.scene.add(mesh);
    return mesh;
  }

  dispose(tile) {
    this.scene.remove(tile.mesh);
    tile.mesh.geometry.dispose();
  }
}
