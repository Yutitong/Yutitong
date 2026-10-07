// 隕石落下の見た目: 赤くなる空、落ちてくる火の玉と尾、激突の閃光、立ちのぼる火の玉ときのこ雲、
// 空気を伝わる衝撃波のドーム、地面を伝わる砂ぼこりの輪、空から時間差で降ってくる岩の火の筋。
// 地面そのものが波打つのは、ボクセルのマテリアルに入れた quakeY（下の QUAKE_GLSL）で描く。
//
// 遠くの物（火の玉・雲・衝撃波など）は、遠くまで描ける別のカメラで先に描き、その上に世界を描く（世界の方が手前）

import * as THREE from 'three';
import { T_FALL, GROUND_WAVE, AIR_BLAST, waveAmp, RIM_Y } from './meteor.js';

// 地面の波: x, y = 激突した所（x, z）、z = 波の先頭の半径、w = 1 なら波がある
export const quake = { uQuake: { value: new THREE.Vector4(0, 0, 0, 0) } };
export const QUAKE_GLSL = `
uniform vec4 uQuake;
float quakeY(vec2 p) {
  if (uQuake.w < 0.5) return 0.0;
  float r = distance(p, uQuake.xy);
  float s = r - uQuake.z;
  if (s > 500.0 || s < -1700.0) return 0.0;
  float amp = 70.0 / (1.0 + r / 700.0) + 2.0;
  float g = s >= 0.0 ? exp(-s * s / 14400.0) : exp(s / 520.0);
  return amp * g * cos(s * 0.016);
}
`;
// 同じ式（カメラを波に乗せるため）
export function quakeAt(x, z) {
  const u = quake.uQuake.value;
  if (u.w < 0.5) return 0;
  const r = Math.hypot(x - u.x, z - u.y);
  const s = r - u.z;
  if (s > 500 || s < -1700) return 0;
  const g = s >= 0 ? Math.exp(-(s * s) / 14400) : Math.exp(s / 520);
  return waveAmp(r) * g * Math.cos(s * 0.016);
}

const SKY = new THREE.Color(0xa9c9e8);
const RED = new THREE.Color(0xd2583a); // 落ちてくる間の、赤く焼けた空
const DUSK = new THREE.Color(0x7a3022); // 激突のあと、ちりで暗く赤い空
const HAZE = new THREE.Color(0xc89a86); // ちりが薄くなった空

const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 丸く光る点の絵（加算で重ねる）
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,240,200,0.9)');
  grad.addColorStop(0.45, 'rgba(255,150,60,0.35)');
  grad.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MeteorView {
  // main: 世界を描くシーン（近くの降ってくる岩の火の筋を入れる）、flashEl: 画面全体を白く光らせる要素
  constructor(main, flashEl) {
    this.main = main;
    this.flashEl = flashEl;
    this.fx = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(75, 1, 20, 90000);
    this.built = false;
    this.sky = SKY.clone();
    this.shake = 0;
    this.redness = 0;
    this.dust = 0;
  }

  build() {
    this.built = true;
    const fx = this.fx;
    const tex = glowTexture();
    const additive = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false };
    // 落ちてくる火の玉
    this.core = new THREE.Mesh(new THREE.SphereGeometry(330, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff1c8, fog: false }));
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffb050, ...additive }));
    this.glow.scale.setScalar(5200);
    // 尾: 頭が明るく、後ろほど赤く薄くなる円錐
    // 頭の方は太く明るく、後ろほど赤く薄くなる円錐。縁（見る向きと平行な面）は透かして、やわらかく見せる
    const VS = 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }';
    const trailMat = new THREE.ShaderMaterial({
      ...additive,
      side: THREE.DoubleSide,
      vertexShader: VS,
      fragmentShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { float t = vUv.y; float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4); vec3 c = mix(vec3(1.0, 0.92, 0.7), vec3(1.0, 0.25, 0.04), t); gl_FragColor = vec4(c * (1.0 - t) * 1.2 * edge, 1.0); }',
    });
    this.trail = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 24, 1, true), trailMat);
    this.smoke = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 24, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      vertexShader: VS,
      fragmentShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { float t = vUv.y; float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); gl_FragColor = vec4(vec3(0.33, 0.27, 0.25), (1.0 - t) * (1.0 - t) * 0.55 * edge); }',
    }));
    fx.add(this.core, this.glow, this.trail, this.smoke);
    // 激突の閃光
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, ...additive }));
    this.flash.visible = false;
    fx.add(this.flash);
    // 立ちのぼる火の玉（光の塊）と、きのこ雲（柱と笠）。雲はボクセルらしく、傾いた箱を積み重ねる
    this.cloud = new THREE.MeshLambertMaterial({ color: 0x5c4a42, transparent: true, opacity: 0.97, fog: false, flatShading: true });
    this.hotGlow = new THREE.SpriteMaterial({ map: tex, color: 0xff7a28, ...additive });
    fx.add(new THREE.HemisphereLight(0xffc8a8, 0x2a140c, 1.5));
    const sun = new THREE.DirectionalLight(0xffb080, 1.4);
    sun.position.set(0.4, 1, 0.3);
    fx.add(sun);
    const cube = new THREE.BoxGeometry(1, 1, 1);
    this.puffs = [];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 150; k++) {
      const cap = k >= 50;
      const p = {
        cap,
        a: rnd() * Math.PI * 2,
        f: rnd(), // 柱の高さ・笠の中の位置
        r: rnd(), // 笠の中の、中心からの距離
        size: 0.7 + rnd() * 0.6,
        shade: 0.75 + rnd() * 0.35,
        mesh: new THREE.Mesh(cube, this.cloud),
      };
      p.mesh.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      fx.add(p.mesh);
      this.puffs.push(p);
    }
    this.fireballs = Array.from({ length: 14 }, () => {
      const sp = new THREE.Sprite(this.hotGlow);
      fx.add(sp);
      return { sp, a: rnd() * Math.PI * 2, f: rnd(), r: rnd() };
    });
    // 衝撃波のドーム（縁ほど明るい半球）
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
      ...additive,
      side: THREE.DoubleSide,
      uniforms: { uFade: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'uniform float uFade; varying vec3 vN; varying vec3 vV; void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); gl_FragColor = vec4(vec3(1.0, 0.93, 0.85) * f * uFade, 1.0); }',
    }));
    fx.add(this.dome);
    // 地面を伝わる砂ぼこりの輪
    this.ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0x8a6c58, transparent: true, opacity: 0.6, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    fx.add(this.ring);
    // 空から降ってくる岩の火の筋（遠く）
    const N = 120;
    this.streaks = Array.from({ length: N }, () => ({ live: false, p: [0, 0, 0], v: [0, 0, 0] }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.streakLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, ...additive }));
    this.streakLines.frustumCulled = false;
    fx.add(this.streakLines);
    // 筋の先の、赤く光る岩
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.heads = new THREE.Points(hg, new THREE.PointsMaterial({ map: tex, color: 0xffa050, size: 160, sizeAttenuation: true, ...additive }));
    this.heads.frustumCulled = false;
    fx.add(this.heads);
    // 近くの降ってくる岩の火の筋（世界のシーンに入れる）
    const M = 16;
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 6), 3));
    ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(M * 6), 3));
    this.nearLines = new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ vertexColors: true, ...additive }));
    this.nearLines.frustumCulled = false;
    this.main.add(this.nearLines);
    this.rnd = rnd;
  }

  // m: world.meteor、t: ボタンを押してからの時間（ティックの間もなめらかに）、eye: カメラの位置、dt: 秒
  update(m, t, eye, dt) {
    if (!m) return;
    if (!this.built) this.build();
    const site = m.site;
    const tau = t - T_FALL; // 激突からの時間
    const ground = RIM_Y * 0.15;
    // ---- 空の色 ----
    const falling = smooth(0, T_FALL * 0.85, t);
    const after = tau > 0 ? smooth(0, 4, tau) * (1 - smooth(60, 200, tau)) : 0;
    this.sky.copy(SKY).lerp(RED, falling * (tau > 0 ? 1 - smooth(0, 4, tau) : 1) * 0.85);
    if (tau > 0) this.sky.lerp(DUSK, after * 0.9).lerp(HAZE, smooth(60, 200, tau) * (1 - smooth(200, 320, tau)) * 0.5);
    this.redness = Math.max(falling * (tau > 0 ? 0 : 1), after);
    this.dust = tau > 0 ? smooth(2, 12, tau) * (1 - smooth(50, 160, tau)) : 0;
    // ---- 落ちてくる火の玉 ----
    const flying = tau < 0;
    for (const o of [this.core, this.glow, this.trail, this.smoke]) o.visible = flying;
    if (flying) {
      const p = m.meteorPos(t), q = m.meteorPos(t - 0.1);
      const dir = new THREE.Vector3(p[0] - q[0], p[1] - q[1], p[2] - q[2]).normalize();
      const back = dir.clone().negate();
      this.core.position.set(...p);
      this.glow.position.set(...p);
      this.glow.material.opacity = 0.6 + 0.4 * Math.sin(t * 23) * 0.5 + 0.2;
      const len = 9000 + 6000 * (t / T_FALL);
      const place = (mesh, L, r) => {
        mesh.position.set(p[0] + back.x * L / 2, p[1] + back.y * L / 2, p[2] + back.z * L / 2);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), back);
        mesh.scale.set(r, L, r);
      };
      place(this.trail, len, 700);
      place(this.smoke, len * 1.6, 1300);
    }
    // ---- 激突の閃光 ----
    this.flash.visible = tau > 0 && tau < 4;
    if (this.flash.visible) {
      this.flash.position.set(site.x, ground + 300, site.z);
      this.flash.scale.setScalar(4000 + 40000 * smooth(0, 0.35, tau));
      this.flash.material.opacity = 1 - smooth(0.2, 4, tau);
    }
    const dist = Math.hypot(eye.x - site.x, eye.z - site.z);
    const white = tau > 0 ? (1 - smooth(0, 0.9, tau)) * (0.55 + 0.45 * smooth(16000, 3000, dist)) : 0;
    this.flashEl.style.opacity = white.toFixed(3);
    // ---- 火の玉ときのこ雲 ----
    const rise = tau > 0;
    const T = Math.max(0, tau);
    const H = 6000 * (1 - Math.exp(-T / 13)); // 雲の柱の高さ
    const capR = 600 + 2400 * (1 - Math.exp(-T / 16)); // 笠の半径
    const heat = rise ? 1 - smooth(1, 18, tau) : 0;
    this.hotGlow.opacity = heat;
    this.cloud.opacity = 0.97 * smooth(0.5, 4, tau) * (1 - smooth(150, 280, tau));
    // はじめは下から火に照らされて赤く、冷えると灰色がかった茶色
    this.cloud.color.setHex(0x55463f).lerp(new THREE.Color(0xc0603a), heat * 0.75);
    const grow = smooth(0, 2, tau);
    for (const pf of this.puffs) {
      pf.mesh.visible = rise && this.cloud.opacity > 0.01;
      if (!pf.mesh.visible) continue;
      let x, y, z, s;
      if (!pf.cap) {
        // 柱: 根元は広がり、上は細い。ゆっくりねじれながら昇る
        const hh = pf.f * H;
        const w = 380 + 700 * (1 - pf.f) ** 3;
        const a = pf.a + T * 0.05 * (1 - pf.f);
        x = site.x + Math.cos(a) * w * 0.55;
        z = site.z + Math.sin(a) * w * 0.55;
        y = ground + hh;
        s = (240 + w * 0.55) * pf.size;
      } else {
        // 笠: 柱のてっぺんで外へ巻き込みながら広がる、平たいドーナツ
        const roll = pf.f * Math.PI * 2 + T * 0.1;
        const rr = capR * (0.25 + 0.75 * pf.r) * (0.85 + 0.15 * Math.cos(roll));
        x = site.x + Math.cos(pf.a) * rr;
        z = site.z + Math.sin(pf.a) * rr;
        y = ground + H + capR * (0.32 * Math.sin(roll) * (1 - pf.r * 0.5) + 0.12 * (1 - pf.r));
        s = (200 + capR * 0.28) * pf.size;
      }
      pf.mesh.position.set(x, y, z);
      pf.mesh.scale.setScalar(s * grow);
    }
    // 激突の直後に立ちのぼる火の玉（光の塊）
    for (const fb of this.fireballs) {
      fb.sp.visible = rise && heat > 0.01;
      if (!fb.sp.visible) continue;
      const hh = H * (0.15 + 0.85 * fb.f) * Math.min(1, 0.4 + T / 6);
      const rr = (300 + capR * 0.6 * fb.f) * fb.r;
      fb.sp.position.set(site.x + Math.cos(fb.a) * rr, ground + hh * 0.9, site.z + Math.sin(fb.a) * rr);
      fb.sp.scale.setScalar((1800 + 2400 * fb.f) * (0.5 + 0.5 * grow));
    }
    // ---- 衝撃波のドームと、砂ぼこりの輪 ----
    const R = Math.max(1, AIR_BLAST * tau);
    this.dome.visible = rise && R < 26000;
    if (this.dome.visible) {
      this.dome.position.set(site.x, ground, site.z);
      this.dome.scale.set(R, R * 0.55, R);
      this.dome.material.uniforms.uFade.value = 0.9 * Math.exp(-tau / 6);
    }
    const Rg = Math.max(1, GROUND_WAVE * tau);
    this.ring.visible = rise && Rg < 22000;
    if (this.ring.visible) {
      const h = 160 + waveAmp(Rg) * 6;
      this.ring.position.set(site.x, ground + h * 0.35, site.z);
      this.ring.scale.set(Rg, h, Rg);
      this.ring.material.opacity = 0.65 * Math.exp(-tau / 9);
    }
    // 地面の波（ボクセルを上下させる）
    const u = quake.uQuake.value;
    u.set(site.x, site.z, GROUND_WAVE * Math.max(0, tau), rise && Rg < 24000 ? 1 : 0);
    // ---- 空から降ってくる岩の火の筋 ----
    this.updateStreaks(m, tau, eye, dt);
    this.updateNear(m);
    // ---- 揺れ（激突の衝撃と、波・衝撃波が届いたとき） ----
    const front = (c) => Math.exp(-(((tau * c - dist) / 900) ** 2));
    this.shake = rise ? 2.2 * front(GROUND_WAVE) * Math.min(1, waveAmp(dist) / 8) + 1.6 * front(AIR_BLAST) * smooth(14000, 2000, dist) + 1.2 * (1 - smooth(0, 1.5, tau)) * smooth(16000, 4000, dist) : 0;
  }

  updateStreaks(m, tau, eye, dt) {
    const pos = this.streakLines.geometry.attributes.position.array;
    const col = this.streakLines.geometry.attributes.color.array;
    const heads = this.heads.geometry.attributes.position.array;
    const active = tau > 3 && tau < 55;
    const rate = active ? 22 * Math.exp(-(tau - 3) / 22) : 0;
    let spawn = rate * dt;
    this.streaks.forEach((s, i) => {
      if (s.live) {
        s.p[0] += s.v[0] * dt;
        s.p[1] += s.v[1] * dt;
        s.p[2] += s.v[2] * dt;
        if (s.p[1] < 0) s.live = false;
      }
      if (!s.live && spawn > 0 && (spawn >= 1 || this.rnd() < spawn)) {
        spawn -= 1;
        const a = this.rnd() * Math.PI * 2, r = 1200 + this.rnd() * 9000;
        s.p = [eye.x + Math.cos(a) * r, 3500 + this.rnd() * 4000, eye.z + Math.sin(a) * r];
        const away = [s.p[0] - m.site.x, s.p[2] - m.site.z];
        const L = Math.hypot(...away) || 1;
        s.v = [(away[0] / L) * 160, -(700 + this.rnd() * 500), (away[1] / L) * 160];
        s.live = true;
      }
      const k = i * 6;
      if (!s.live) {
        pos.fill(0, k, k + 6);
        col.fill(0, k, k + 6);
        heads.fill(-1e6, i * 3, i * 3 + 3);
        return;
      }
      pos.set([s.p[0], s.p[1], s.p[2], s.p[0] - s.v[0] * 0.9, s.p[1] - s.v[1] * 0.9, s.p[2] - s.v[2] * 0.9], k);
      col.set([1, 0.75, 0.35, 0, 0, 0], k);
      heads.set(s.p, i * 3);
    });
    this.heads.geometry.attributes.position.needsUpdate = true;
    this.streakLines.geometry.attributes.position.needsUpdate = true;
    this.streakLines.geometry.attributes.color.needsUpdate = true;
  }

  // 近くに降ってくる岩（ボクセル）の後ろの火の筋
  updateNear(m) {
    const pos = this.nearLines.geometry.attributes.position.array;
    const col = this.nearLines.geometry.attributes.color.array;
    pos.fill(0);
    col.fill(0);
    m.debris.slice(0, 16).forEach((d, i) => {
      if (d.done) return;
      const k = i * 6;
      pos.set([d.p[0], d.p[1] + 1, d.p[2], d.p[0] - d.v[0] * 0.35, d.p[1] - d.v[1] * 0.35, d.p[2] - d.v[2] * 0.35], k);
      col.set([1, 0.6, 0.2, 0, 0, 0], k);
    });
    this.nearLines.geometry.attributes.position.needsUpdate = true;
    this.nearLines.geometry.attributes.color.needsUpdate = true;
  }

  // 遠くの物を先に描く（このあと深度を消して世界を描く）
  render(renderer, camera) {
    this.cam.position.copy(camera.position);
    this.cam.quaternion.copy(camera.quaternion);
    this.cam.fov = camera.fov;
    this.cam.aspect = camera.aspect;
    this.cam.updateProjectionMatrix();
    renderer.render(this.fx, this.cam);
  }
}
