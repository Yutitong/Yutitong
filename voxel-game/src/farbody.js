// 遠くの大きな物（龍・古代魚）: 細かく描く範囲（チャンク）の外にある体を、距離に合わせた粗いブロックで描く
//
// - 物の形（shapeAll）をそのまま使い、細かく描く範囲の外にあるセルだけを、ブロックにまとめる
//   （約 30m までは 2×2×2 = 30cm、約 48m までは 4×4×4 = 60cm、その先は 8×8×8 = 1.2m）
// - 細かく描く範囲の中の部分は、いままでどおりチャンクに描く。龍が範囲の境目をまたぐと、内側は細かく外側は粗く見える
// - 龍が動くたび（1 秒に 12.5 回）に作り直す。龍がまるごと範囲の中にいるときは何もしない

import * as THREE from 'three';

export class FarBody {
  // material: ボクセルのマテリアル（iCell の w を箱の大きさとして使う）
  constructor(scene, material, voxelSize = 1) {
    const shape = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setIndex(shape.index);
    this.geo.setAttribute('position', shape.attributes.position);
    this.geo.setAttribute('normal', shape.attributes.normal);
    this.capacity = 0;
    this.grow(1024);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.seen = -1;
    this.blocks = new Map();
    this.count = 0;
  }

  grow(n) {
    this.capacity = n;
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.rgbAttr = new THREE.InstancedBufferAttribute(new Uint8Array(n * 3), 3, true);
    this.cellAttr.setUsage(THREE.DynamicDrawUsage);
    this.rgbAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iCell', this.cellAttr);
    this.geo.setAttribute('color', this.rgbAttr);
  }

  // body: 龍・古代魚（version と shapeAll(emit, skip) を持つ）、center / half: 細かく描く正方形の中心 [x, z] と半分の幅、r1 / r2: 30cm / 60cm のブロックで描く距離（ボクセル）
  update(body, center, half, r1, r2) {
    if (!body || body.version === this.seen) return;
    this.seen = body.version;
    const [fx, fz] = center;
    const cheb = (x, z) => Math.max(Math.abs(x - fx), Math.abs(z - fz));
    const blocks = this.blocks;
    blocks.clear();
    // 細かく描く範囲にすっぽり入る部分は、形を作らない
    const skip = (p, extra) => cheb(p[0], p[2]) < half - extra;
    body.shapeAll((x, y, z, color) => {
      const d = cheb(x + 0.5, z + 0.5);
      if (d < half) return;
      const s = d <= r1 ? 2 : d <= r2 ? 4 : 8;
      const bx = Math.floor(x / s), by = Math.floor(y / s), bz = Math.floor(z / s);
      // 大きさごとに別の key（同じ所に大きさの違うブロックが重なってもよい）
      blocks.set(((bx + 65536) * 131072 + (bz + 65536)) * 8192 + by * 16 + s, color);
    }, skip);
    this.count = blocks.size;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    if (this.count > this.capacity) this.grow(Math.ceil(this.count * 1.5));
    const cell = this.cellAttr.array, rgb = this.rgbAttr.array;
    let i = 0;
    for (const [key, color] of blocks) {
      const s = key % 16;
      const by = Math.floor(key / 16) % 512;
      const rest = Math.floor(key / 8192);
      const bz = (rest % 131072) - 65536, bx = Math.floor(rest / 131072) - 65536;
      cell[i * 4] = bx * s + s / 2;
      cell[i * 4 + 1] = by * s + s / 2;
      cell[i * 4 + 2] = bz * s + s / 2;
      cell[i * 4 + 3] = s; // 箱の大きさ
      rgb[i * 3] = (color >> 16) & 255;
      rgb[i * 3 + 1] = (color >> 8) & 255;
      rgb[i * 3 + 2] = color & 255;
      i++;
    }
    this.geo.instanceCount = this.count;
    this.cellAttr.needsUpdate = true;
    this.rgbAttr.needsUpdate = true;
  }
}
