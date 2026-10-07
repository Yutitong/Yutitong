// チャンクを作るスレッドに仕事を頼み、できたチャンクを世界に入れる（画面を描くスレッドの側）
//
// スレッドが使えないとき（古いブラウザ・読み込みの失敗）は ok が false になり、いままでどおりその場で作る

import { installChunk, chunkKey } from './world.js';

const MAX_PENDING = 8; // 一度に頼んでおくチャンクの数

export class ChunkGenerator {
  constructor(world) {
    this.world = world;
    this.pending = new Set();
    this.ready = [];
    this.failed = false;
    try {
      this.worker = new Worker(new URL('./genworker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev) => this.ready.push(ev.data);
      this.worker.onerror = () => {
        this.failed = true;
      };
      this.worker.postMessage({ type: 'init', seed: world.seed });
      // この世界で忘れた木は、次に必要になったら形を送ってもらう
      world.onForgetTrees = (keys) => this.worker.postMessage({ type: 'forget', keys });
    } catch {
      this.worker = null;
    }
  }

  get ok() {
    return Boolean(this.worker) && !this.failed;
  }

  // 隕石が落ちた: スレッドの世界にも知らせる（激突の前に頼んだチャンクは、届いても捨てて頼み直す）
  impact(at) {
    this.worker?.postMessage({ type: 'impact', at });
  }

  // チャンク (cx, cz) を頼む。頼めなかった（頼みすぎ）なら false
  request(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.pending.has(key)) return true;
    if (this.pending.size >= MAX_PENDING) return false;
    this.pending.add(key);
    this.worker.postMessage({ type: 'gen', cx, cz });
    return true;
  }

  // できたチャンクを、budget ミリ秒まで世界に入れる。入れたチャンクの数を返す
  install(budget) {
    const start = performance.now();
    let n = 0;
    while (this.ready.length && performance.now() - start < budget) {
      const m = this.ready.shift();
      this.pending.delete(chunkKey(m.cx, m.cz));
      if ((m.epoch ?? 0) !== (this.world.impactEpoch ?? 0)) continue; // 激突の前の地形で作ったもの
      if (installChunk(this.world, m)) n++;
    }
    return n;
  }
}

// 少し遠くのチャンクの粗いブロックを作るスレッド（細かいチャンク作りを待たせないように、別のスレッドにする）
export class LodGenerator {
  constructor(world, maxPending = 6) {
    this.world = world;
    this.pending = new Set();
    this.ready = [];
    this.failed = false;
    this.maxPending = maxPending;
    try {
      this.worker = new Worker(new URL('./genworker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev) => this.ready.push(ev.data);
      this.worker.onerror = () => {
        this.failed = true;
      };
      this.worker.postMessage({ type: 'init', seed: world.seed });
    } catch {
      this.worker = null;
    }
  }

  get ok() {
    return Boolean(this.worker) && !this.failed;
  }

  get busy() {
    return this.pending.size >= this.maxPending;
  }

  impact(at) {
    this.worker?.postMessage({ type: 'impact', at });
  }

  request(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.pending.has(key)) return true;
    if (this.busy) return false;
    this.pending.add(key);
    this.worker.postMessage({ type: 'lod', cx, cz });
    return true;
  }

  // できあがったものを 1 つ取り出す（なければ null）
  take() {
    let m;
    while ((m = this.ready.shift())) {
      this.pending.delete(chunkKey(m.cx, m.cz));
      if ((m.epoch ?? 0) === (this.world.impactEpoch ?? 0)) return m; // 激突の前の地形で作ったものは捨てる
    }
    return null;
  }
}
