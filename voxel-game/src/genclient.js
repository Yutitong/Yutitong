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
      if (installChunk(this.world, m)) n++;
    }
    return n;
  }
}
