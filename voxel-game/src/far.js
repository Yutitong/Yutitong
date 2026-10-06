// 遠景: 作ったチャンクより遠くの地形を、粗いブロックで描く（遠くの山が見えるように）
//
// - 近い方から 4・16・64 ボクセル四方の柱。1 本の柱 = 1 つの箱（インスタンス）
// - 16×16 本の柱のタイルごとに 1 つのメッシュを作り、プレイヤーが動いたら新しいタイルを少しずつ作る
// - 細かく描いている範囲（チャンク / 手前の段の遠景）の中にある柱は、シェーダーでつぶして見せない
// - 森は、木の色と高さ（樹冠）をのせた箱で表す

import * as THREE from 'three';
import { floorDiv } from './grid.js';
import { noise2, shade } from './rng.js';
import { groundColor, waterColor } from './terrain.js';
import { forestDensity, regionSpec, REGION } from './trees.js';
import { giantSpec, giantBoxes, GIANT_CELL } from './giant.js';

const LEVELS = [
  { cell: 4, tile: 64, reach: 5 }, // 4 ボクセル四方の柱を、まわり 5 タイル（≈ 350 ボクセル ≈ 50m）
  { cell: 16, tile: 256, reach: 5 }, // ≈ 1400 ボクセル ≈ 210m
  { cell: 64, tile: 1024, reach: 2 }, // ≈ 2500 ボクセル ≈ 380m
];
const CANOPY = [0x3b6a34, 0x2f5a33]; // 遠くから見た森（広葉樹 / 針葉樹）

const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

// 遠くの木: 幹と、種類ごとの樹冠の形（箱を 2〜4 個重ねる）
const TREE_LOOK = {
  broad: { bark: 0x6b4e37, leaf: 0x467f37 },
  round: { bark: 0x5a4636, leaf: 0x386f30 },
  conifer: { bark: 0x4e3326, leaf: 0x2b5236 },
  birch: { bark: 0xe6e2d6, leaf: 0x86ad48 },
};
function treeBoxes(spec, out) {
  const H = 66 * spec.scale;
  const look = TREE_LOOK[spec.species];
  const x = spec.x + 0.5, z = spec.z + 0.5, y = spec.y;
  const f = 0.9 + (spec.seed % 20) / 100;
  const leaf = shade(look.leaf, f);
  const trunk = Math.max(1.5, 3 * spec.scale);
  const add = (dx, y0, dz, wd, h, c) => out.push(x + dx, y + y0, z + dz, wd, h, c, 0);
  if (spec.species === 'conifer') {
    add(0, 0, 0, trunk, H * 0.4, look.bark);
    add(0, H * 0.16, 0, H * 0.36, H * 0.3, shade(leaf, 0.9));
    add(0, H * 0.44, 0, H * 0.25, H * 0.3, leaf);
    add(0, H * 0.72, 0, H * 0.12, H * 0.28, shade(leaf, 1.08));
  } else {
    const birch = spec.species === 'birch';
    const wide = birch ? 0.36 : 0.6;
    const side = ((spec.seed >>> 4) % 2 ? 1 : -1) * H * 0.12;
    add(0, 0, 0, trunk * (birch ? 0.7 : 1), H * 0.5, look.bark);
    add(0, H * 0.36, 0, H * wide, H * 0.42, shade(leaf, 0.92));
    add(side, H * 0.58, -side * 0.6, H * wide * 0.65, H * 0.36, shade(leaf, 1.08));
  }
}

function mix(a, b, t) {
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// hide: (x, z, 半径) の正方形の中のブロックは描かない
function farMaterial() {
  const hide = { value: new THREE.Vector3(0, 0, -1) };
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHide = hide;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHide;')
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vec2 ic = instanceMatrix[3].xz;
        if (abs(ic.x - uHide.x) < uHide.z && abs(ic.y - uHide.y) < uHide.z) transformed = vec3(0.0);
        // カメラのすぐそばの柱や木は、大きく見えて視界をふさぐので描かない
        if (distance(ic, cameraPosition.xz) < 70.0) transformed = vec3(0.0);
      `);
  };
  return { m, hide };
}

export class FarTerrain {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.levels = LEVELS.map((l) => ({ ...l, tiles: new Map(), center: null, ...farMaterial() }));
    this.tmp = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  // 使う段の数を変える（重いときは遠い段を描かない）
  setLevels(n) {
    this.active = n;
    this.levels.forEach((L, k) => {
      for (const mesh of L.tiles.values()) mesh.visible = k < n;
    });
  }

  // (x, z) のまわりのタイルを、近い順に budget ミリ秒まで作る。
  // near: チャンクで細かく描いている正方形 { x, z, half }（なければ null）
  update(x, z, near, budget = 4) {
    const start = performance.now();
    for (const L of this.levels.slice(0, this.active ?? this.levels.length)) {
      const tx = floorDiv(x, L.tile), tz = floorDiv(z, L.tile);
      let ready = true;
      for (let r = 0; r <= L.reach && ready; r++) {
        for (let dz = -r; dz <= r && ready; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const key = `${tx + dx},${tz + dz}`;
            if (L.tiles.has(key)) continue;
            if (performance.now() - start > budget) {
              ready = false;
              break;
            }
            L.tiles.set(key, this.build(L, tx + dx, tz + dz));
          }
        }
      }
      // 全部そろったら、この位置を中心にする（そろうまでは前の中心のまま。遠景に穴が開かないように）
      if (ready && (!L.center || L.center[0] !== tx || L.center[1] !== tz)) {
        L.center = [tx, tz];
        for (const [key, mesh] of L.tiles) {
          const [kx, kz] = key.split(',').map(Number);
          if (Math.max(Math.abs(kx - tx), Math.abs(kz - tz)) <= L.reach + 1) continue;
          this.scene.remove(mesh);
          mesh.dispose();
          L.tiles.delete(key);
        }
      }
    }
    // いちばん近い段はチャンクの範囲を、その先の段は一つ手前の段の範囲を隠す
    if (near) this.levels[0].hide.value.set(near.x, near.z, near.half);
    for (let k = 1; k < this.levels.length; k++) {
      const a = this.levels[k - 1];
      if (a.center) this.levels[k].hide.value.set((a.center[0] + 0.5) * a.tile, (a.center[1] + 0.5) * a.tile, (a.reach + 0.5) * a.tile);
    }
  }

  build(L, tx, tz) {
    const w = this.world;
    const n = L.tile / L.cell;
    const S = n + 2;
    const cols = new Array(S * S);
    for (let j = -1; j <= n; j++) {
      for (let i = -1; i <= n; i++) {
        const x = tx * L.tile + i * L.cell + L.cell / 2, z = tz * L.tile + j * L.cell + L.cell / 2;
        const col = w.sample(x, z, {});
        col.top = Math.max(col.h, col.water);
        cols[(i + 1) + S * (j + 1)] = col;
      }
    }
    const boxes = []; // [中心 x, 下, 中心 z, 幅, 高さ, 色, 縦の軸まわりの回転]
    const trees = L.cell <= 16 && w.terrain; // 近い段は木を 1 本ずつ描く。遠い段は森の色と高さだけ
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const at = (di, dj) => cols[(i + 1 + di) + S * (j + 1 + dj)];
        const col = at(0, 0);
        const x = tx * L.tile + i * L.cell + L.cell / 2, z = tz * L.tile + j * L.cell + L.cell / 2;
        let lo = col.top, slope = 0;
        for (const nb of [at(1, 0), at(-1, 0), at(0, 1), at(0, -1)]) {
          lo = Math.min(lo, nb.top);
          slope = Math.max(slope, Math.abs(nb.h - col.h));
        }
        let top = col.top;
        let color;
        if (col.water > col.h) {
          color = waterColor(x, z, col.water - col.h, col.water > w.waterLevel) & 0xffffff;
        } else {
          color = groundColor(w.seed, x, col.h - 1, z, col, Math.round((slope / L.cell) * 2.2));
          const forest = !trees && w.terrain ? forestDensity(w, x, z, col) : 0;
          if (forest > 0.2) {
            // 樹冠: 木ごとに高さがでこぼこする
            const crown = noise2(x / 11, z / 11, w.seed + 41);
            color = shade(mix(color, CANOPY[col.h > 120 ? 1 : 0], Math.min(0.85, forest)), 0.85 + 0.3 * crown);
            top += Math.round(48 * forest * (0.35 + crown));
          }
        }
        const bottom = Math.max(0, Math.min(lo, col.top) - 4);
        boxes.push(x, bottom, z, L.cell, top - bottom, color, 0);
      }
    }
    if (trees) {
      // 幹の根元がこのタイルにある木
      const x0 = tx * L.tile, z0 = tz * L.tile;
      for (let rz = floorDiv(z0, REGION) - 1; rz <= floorDiv(z0 + L.tile - 1, REGION); rz++) {
        for (let rx = floorDiv(x0, REGION) - 1; rx <= floorDiv(x0 + L.tile - 1, REGION); rx++) {
          const spec = regionSpec(w, rx, rz, false);
          if (!spec || spec.x < x0 || spec.x >= x0 + L.tile || spec.z < z0 || spec.z >= z0 + L.tile) continue;
          treeBoxes(spec, boxes);
        }
      }
    }
    if (w.terrain) {
      // 巨大樹は遠くからも見える（どの段でも 1 本ずつ描く）
      const x0 = tx * L.tile, z0 = tz * L.tile;
      for (let gz = floorDiv(z0, GIANT_CELL); gz <= floorDiv(z0 + L.tile - 1, GIANT_CELL); gz++) {
        for (let gx = floorDiv(x0, GIANT_CELL); gx <= floorDiv(x0 + L.tile - 1, GIANT_CELL); gx++) {
          const spec = giantSpec(w, gx, gz);
          if (!spec || spec.x < x0 || spec.x >= x0 + L.tile || spec.z < z0 || spec.z >= z0 + L.tile) continue;
          giantBoxes(w, spec, boxes);
        }
      }
    }
    const count = boxes.length / 7;
    const mesh = new THREE.InstancedMesh(box, L.m, count);
    mesh.frustumCulled = false;
    for (let k = 0; k < count; k++) {
      const b = k * 7;
      this.tmp.position.set(boxes[b], boxes[b + 1], boxes[b + 2]);
      this.tmp.rotation.set(0, boxes[b + 6], 0);
      this.tmp.scale.set(boxes[b + 3], boxes[b + 4], boxes[b + 3]);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(k, this.tmp.matrix);
      mesh.setColorAt(k, this.color.setHex(boxes[b + 5]));
    }
    this.scene.add(mesh);
    return mesh;
  }
}
