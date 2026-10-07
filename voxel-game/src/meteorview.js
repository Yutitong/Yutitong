// 隕石落下の見た目: 赤くなる空、落ちてくる火の玉と尾、激突の閃光、空気を伝わる衝撃波のドーム、
// ボクセルのキノコ雲（世界の格子にそろった箱の粒。火の玉が渦を巻くトーラスになって昇り、数分かけて薄れて消える）、
// 空洞の縁から外へ放り出される岩と土の塊（箱の粒）、空から降ってくる岩の火の筋。
// 地面が動くのは世界のセル（impact.js）と遠景のシェーダー（far.js）。ここでは描かない
//
// 遠くの物は、遠くまで描ける別のカメラで先に描き、その上に世界を描く（世界の方が手前）

import * as THREE from 'three';
import { T_FALL, AIR_BLAST, CRATER_R } from './meteor.js';

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
    // ボクセルのキノコ雲と、放り出される岩と土の塊（箱の粒。動きはシェーダーで計算する）
    this.cloud = voxelCloud();
    fx.add(this.cloud.mesh);
    const rnd = (() => {
      let seed = 11;
      return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    })();
    // 衝撃波のドーム（縁ほど明るい半球）
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
      ...additive,
      side: THREE.DoubleSide,
      uniforms: { uFade: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'uniform float uFade; varying vec3 vN; varying vec3 vV; void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); gl_FragColor = vec4(vec3(1.0, 0.93, 0.85) * f * uFade, 1.0); }',
    }));
    fx.add(this.dome);
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
    const ground = 100;
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
    // ---- キノコ雲と、放り出される塊 ----
    const rise = tau > 0;
    this.cloud.mesh.visible = rise && tau < 330;
    this.cloud.uniforms.uCloud.value.set(site.x, site.z, Math.max(0, tau), 60);
    // ---- 衝撃波のドームと、砂ぼこりの輪 ----
    const R = Math.max(1, AIR_BLAST * tau);
    this.dome.visible = rise && R < 26000;
    if (this.dome.visible) {
      this.dome.position.set(site.x, ground, site.z);
      this.dome.scale.set(R, R * 0.55, R);
      this.dome.material.uniforms.uFade.value = 0.9 * Math.exp(-tau / 6);
    }
    // ---- 空から降ってくる岩の火の筋 ----
    this.updateStreaks(m, tau, eye, dt);
    this.updateNear(m);
    // ---- 揺れ（激突の衝撃と、波・衝撃波が届いたとき） ----
    const front = (c) => Math.exp(-(((tau * c - dist) / 900) ** 2));
    this.shake = rise ? 1.6 * front(AIR_BLAST) * smooth(14000, 2000, dist) + 1.2 * (1 - smooth(0, 1.5, tau)) * smooth(16000, 4000, dist) : 0;
  }

  updateStreaks(m, tau, eye, dt) {
    const pos = this.streakLines.geometry.attributes.position.array;
    const col = this.streakLines.geometry.attributes.color.array;
    const heads = this.heads.geometry.attributes.position.array;
    const active = tau > 3 && tau < 55;
    const rate = active ? 10 * Math.exp(-(tau - 3) / 22) : 0;
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

// ---- ボクセルのキノコ雲 ----------------------------------------------------------------
//
// 粒（箱）ごとに、トーラスの中の位置（輪のまわりの角度・断面の角度・断面の中心からの距離）を持つ。
// シェーダーで時刻から位置を求め、世界の格子（40 ボクセル）にそろえて置く（箱が積み重なったボクセルの雲に見える）。
// - はじめの数秒: 地面の上で火の玉が膨らみながら昇る
// - その後: 火の玉が渦の輪（トーラス）になり、内側が昇って外側が下がるように巻き込みながら、広がって昇っていく。
//   下には地面から吸い上げられる柱が立つ。熱いうちは中ほど赤く光り、冷えると灰色がかった茶色になる
// - 数分かけて粒が減っていき、薄れて消える
// 放り出される塊: 空洞の縁から、外へ斜め上に飛び出し、放物線を描いて落ちる（16 ボクセルの格子にそろえる）
const RING = 9000, STEM = 2600, EJECTA = 3200;
function voxelCloud() {
  const N = RING + STEM + EJECTA;
  const geo = new THREE.InstancedBufferGeometry();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  geo.setIndex(cube.index);
  geo.setAttribute('position', cube.attributes.position);
  geo.setAttribute('normal', cube.attributes.normal);
  const P = new Float32Array(N * 4), Q = new Float32Array(N * 4);
  let seed = 977;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < N; k++) {
    const kind = k < RING ? 0 : k < RING + STEM ? 1 : 2;
    P.set([kind, rnd(), rnd(), rnd()], k * 4);
    Q.set([rnd(), rnd(), 0.7 + rnd() * 0.6, rnd()], k * 4);
  }
  geo.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 4));
  geo.setAttribute('aQ', new THREE.InstancedBufferAttribute(Q, 4));
  geo.instanceCount = N;
  const uniforms = { uCloud: { value: new THREE.Vector4() } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      uniform vec4 uCloud; // 落ちた所 x, z、激突からの時間、地面の高さ
      attribute vec4 aP; // 種類（0 = 輪、1 = 柱、2 = 放り出される塊）、乱数 3 つ
      attribute vec4 aQ; // 乱数 2 つ、大きさ、寿命
      varying vec3 vColor;
      const float PI = 3.14159265;
      void main() {
        float tau = uCloud.z;
        float g = uCloud.w;
        vec3 site = vec3(uCloud.x, g, uCloud.y);
        float kind = aP.x;
        vec3 c;
        float S = 40.0; // 格子の大きさ
        float size = aQ.z;
        float heat = exp(-tau / 7.0);
        float alive = 1.0;
        vec3 hot = vec3(1.0, 0.42, 0.08), dark = vec3(0.30, 0.25, 0.23), ash = vec3(0.48, 0.42, 0.38);
        vec3 col;
        if (kind < 0.5) {
          // 輪: 火の玉（はじめ）→ 渦の輪
          float m = smoothstep(1.5, 9.0, tau);
          float Hc = 700.0 + 6200.0 * (1.0 - exp(-tau / 26.0));
          float Rm = 650.0 + 1700.0 * (1.0 - exp(-tau / 30.0));
          float a = 420.0 + 650.0 * (1.0 - exp(-tau / 24.0));
          float th = aP.y * 2.0 * PI + 0.04 * tau;
          float ph = aP.z * 2.0 * PI - 0.32 * tau; // 内側が昇り、外側が下がる
          float rho = a * (0.5 + 0.5 * aP.w);
          vec3 ring = vec3((Rm + rho * cos(ph)) * cos(th), Hc + rho * sin(ph) * 0.75, (Rm + rho * cos(ph)) * sin(th));
          // 火の玉: 地面の上で膨らみながら昇る球
          float Rb = 1300.0 * (1.0 - exp(-tau / 1.6));
          vec3 dir = normalize(vec3(cos(aP.y * 6.2832) * sin(aP.z * 3.1416), cos(aP.z * 3.1416), sin(aP.y * 6.2832) * sin(aP.z * 3.1416)));
          vec3 ball = vec3(0.0, Rb * 0.9 + 200.0 * tau, 0.0) + dir * Rb * pow(aP.w, 0.35);
          c = site + mix(ball, ring, m);
          c += vec3(sin(tau * 0.31 + aQ.x * 40.0), sin(tau * 0.27 + aQ.y * 40.0), cos(tau * 0.23 + aQ.x * 31.0)) * 90.0;
          float inner = 1.0 - aP.w;
          col = mix(mix(dark, ash, aQ.y * 0.6), hot * (1.2 + inner), clamp(heat * (0.5 + inner), 0.0, 1.0));
          // だんだん粒が減る（1 分ほどから、4〜5 分で消える）
          alive = step(tau, 60.0 + 240.0 * aQ.w);
        } else if (kind < 1.5) {
          // 柱: 地面から吸い上げられて昇る
          float Hc = 700.0 + 6200.0 * (1.0 - exp(-tau / 26.0));
          float f = fract(aP.w + tau * 0.03);
          float top = Hc - 300.0;
          float rr = (220.0 + 520.0 * pow(1.0 - f, 2.0)) * sqrt(aP.z);
          float th = aP.y * 2.0 * PI + tau * (0.25 + 0.4 * (1.0 - f));
          c = site + vec3(rr * cos(th), f * top, rr * sin(th));
          col = mix(mix(dark, ash, aQ.y * 0.5), hot * 1.3, clamp(heat * (1.2 - f), 0.0, 1.0));
          alive = step(6.0, tau) * step(tau, 40.0 + 150.0 * aQ.w) * step(f * top, Hc);
        } else {
          // 放り出される塊: 空洞の縁から、外へ斜め上に飛び出して落ちる
          S = 16.0;
          float t0 = aP.y * 4.0;
          float t = tau - t0;
          float r0 = ${CRATER_R.toFixed(1)} * (1.0 - exp(-max(t0, 0.05) / 1.4));
          float th = aP.z * 2.0 * PI;
          float v = 380.0 + 820.0 * aP.w;
          float el = 0.75 + 0.35 * aQ.x;
          float G = 140.0;
          float y = v * sin(el) * t - 0.5 * G * t * t;
          float r = r0 + v * cos(el) * t;
          c = site + vec3(r * cos(th), y, r * sin(th));
          size = 0.6 + aQ.z * 0.8;
          col = mix(vec3(0.24, 0.2, 0.17), hot * 1.4, clamp(exp(-t / 4.0) * aQ.y, 0.0, 1.0));
          alive = step(0.0, t) * step(0.0, y + 40.0);
        }
        vec3 snapped = floor(c / S + 0.5) * S;
        vec3 p = snapped + position * S * size * alive;
        // 上から光が当たる（下の面は暗い）
        float light = 0.62 + 0.38 * max(dot(normal, normalize(vec3(0.4, 1.0, 0.3))), 0.0);
        vColor = col * light;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: 'varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, uniforms };
}
