// 人型キャラの動き（速度・向き・歩行周期）と、それに合わせた姿勢の更新
//
// 体の位置は1ボクセル単位でしか動かないが、速度・向き・歩行周期は連続的に変わる。
// アニメーションは毎ティック姿勢から描き直すので、移動のコマとは切り離されている。

import { createPose, humanColors, rasterizeTool, CHOP_IMPACT, DIG_IMPACT, PLACE_IMPACT, SLASH_IMPACT, SHOOT_IMPACT } from './humanoid.js';

export const WALK_SPEED = 13; // ボクセル/秒（≈ 2 m/s）
export const RUN_SPEED = 33; // ≈ 5 m/s
export const SPRINT_SPEED = 53; // ≈ 8 m/s（走り続けると全力疾走になる）
export const SPRINT_AFTER = 1.2; // 走り始めてから全力疾走になるまで（秒）
export const PUSH_SPEED = 4;
const ACCEL = 45; // ボクセル/秒²
const DECEL = 70;
const TURN_RATE = 9; // ラジアン/秒
const STRIDE_WALK = 10; // 1周期（左右1歩ずつ）で進むボクセル数（≈ 1.5m）
const STRIDE_RUN = 22;
const STRIDE_SPRINT = 29;
const SWING_TIME = 0.6; // 斧を1回振る時間（秒）
const DIG_TIME = 0.75; // シャベルで1回掘る・盛る時間（秒）
const SLASH_TIME = 0.5; // 太刀でひと太刀の時間（秒）
const SHOOT_TIME = 0.6; // ショットガンを 1 発撃って、次を撃てるようになるまで（秒）
export const MAX_STEP = 2; // 歩いて登り降りできる段差（ボクセル ≈ 30cm）
const GRAVITY = 65; // ボクセル/秒²（≈ 9.8 m/s²）
const DOWN = [0, -1, 0];

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, maxStep) => (v < target ? Math.min(target, v + maxStep) : Math.max(target, v - maxStep));
const sameDir = (a, b) => Boolean(b) && a[0] * b[0] + a[1] * b[1] > 0.98; // ほぼ同じ向き（長さ 1 の向き同士）
const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

// 向き dir（長さ 1）へ進むときに試す1歩（x か z に1ボクセル）。成分の大きい方の軸から。ほとんど動かない軸は試さない
function stepAxes(dir) {
  const out = [];
  if (Math.abs(dir[0]) > 0.15) out.push([Math.sign(dir[0]), 0, 0]);
  if (Math.abs(dir[1]) > 0.15) out.push([0, 0, Math.sign(dir[1])]);
  if (Math.abs(dir[1]) > Math.abs(dir[0])) out.reverse();
  return out;
}

export function initCharacter(e, rng = Math.random) {
  e.pose = createPose();
  e.pose.yaw = e.yaw ?? 0;
  e.speed = 0;
  e.sub = [0, 0]; // まだ使っていない x / z の移動量（ボクセル）
  e.moveDir = null;
  e.diagToggle = false;
  e.pushing = 0;
  e.blockedDir = null; // 動かせない物に当たった方向
  e.waitBlocked = 0; // 次に道が空いたか確かめるまでの時間
  e.idleTime = 0;
  e.breathPhase = rng();
  e.blinkIn = 1 + rng() * 3;
  e.blinkLeft = 0;
  e.lookIn = 2 + rng() * 3;
  e.headTarget = 0;
  e.vy = 0; // 落ちる速さ（ボクセル/秒）
  e.fall = 0; // まだ使っていない落下量
  e.fallen = 0; // 今回の落下で落ちたボクセル数
  e.look = new Uint32Array(e.colors.length);
  e.tool = 'axe'; // 右手の道具（斧 / シャベル / 太刀 / ショットガン）
  e.soil = 0; // シャベルにのせている土（ボクセル）
  return e;
}

// 足元が空いていれば重力で落ちる。着地したら落ちた高さに応じて膝を曲げる。
function applyGravity(world, e, dt) {
  if (world.canMove(e.id, DOWN)) {
    e.vy = Math.min(e.vy + GRAVITY * dt, 40);
    e.fall += e.vy * dt;
    for (let n = 0; n < 2 && e.fall >= 1; n++) {
      if (!world.tryMove(e.id, DOWN, { push: false }).ok) break;
      e.fall -= 1;
      e.fallen++;
    }
    return true;
  }
  if (e.fallen > MAX_STEP) e.pose.crouch = Math.min(1, e.fallen / 10); // 着地
  e.vy = 0;
  e.fall = 0;
  e.fallen = 0;
  return false;
}

// 1歩進む。地面の段差が MAX_STEP 以下なら登り、降りる段差も MAX_STEP までは足を下ろす。
function stepOnce(world, e, d3) {
  // 行き先の足元が胸より深い水なら入らない（岸から深みへ踏み出さない）
  const cx = e.pos[0] + d3[0] + 4, cz = e.pos[2] + d3[2] + 4;
  const level = world.waterAt(cx, cz);
  if (level && level - world.groundAt(cx, cz) >= e.wade) {
    return { ok: false, pushed: [], blocker: world.deepWater, via: e, reason: 'priority' };
  }
  let r = world.tryMove(e.id, d3);
  if (!r.ok && r.via === e && r.blocker?.ground) {
    for (let h = 1; h <= MAX_STEP; h++) {
      const up = world.tryMove(e.id, [d3[0], h, d3[2]], { push: false });
      if (up.ok) {
        e.pose.crouch = Math.max(e.pose.crouch, 0.3 * h); // 段を上がった直後は膝が曲がっている
        return up;
      }
    }
  }
  if (r.ok && e.vy === 0) {
    for (let h = 0; h < MAX_STEP && world.canMove(e.id, DOWN); h++) world.tryMove(e.id, DOWN, { push: false });
  }
  return r;
}

// 1ティック分キャラを動かす。
// input: { dir: [dx, dz]（どの向きでもよい。長さは問わない）または null, run: boolean,
//   face: 体を向ける向き（一人称の視線。なければ進む向きへ回る）, pitch: 視線の上下（道具を視線の先へ向ける。なければ null） }
// report(e, result) は移動の結果（押し出し・止められた）を出来事として記録する。
// input.tool で道具を持ち替える（'axe' | 'shovel' | 'sword' | 'gun'）。input.chop が true なら持っている道具を使う
// （斧なら振る、シャベルなら掘る、太刀なら振り下ろしと横薙ぎを交互に、ショットガンなら撃つ）。input.place が true ならシャベルで土を盛る。
// 刃が当たる（弾が出る）瞬間に onChop(e, action) を呼ぶ（action: 'chop' | 'dig' | 'place' | 'slashV' | 'slashH' | 'shoot'）
export function updateCharacter(world, e, input, dt, rng, report, onChop) {
  const pose = e.pose;
  // 視線: 体はすぐにその向きを向き（横歩き・後ずさりもできる）、道具はその先へ使う（道具を使う前に決める）
  const hasFace = input.face !== undefined && input.face !== null;
  if (hasFace) pose.yaw = wrapAngle(input.face);
  e.aimPitch = input.pitch ?? null;
  const tools = Boolean(e.palette.axe); // 道具を持っているのはプレイヤーだけ
  if (tools && input.tool && !e.swingT) e.tool = input.tool;
  const tool = e.tool ?? 'axe';
  if (tools && !e.swingT && (input.chop || (input.place && tool === 'shovel'))) {
    e.swingT = 1e-4;
    e.chopDone = false;
    if (tool === 'sword') {
      e.action = e.lastSlash === 'slashV' ? 'slashH' : 'slashV'; // 振り下ろしと横薙ぎを交互に
      e.lastSlash = e.action;
    } else if (tool === 'gun') {
      if (!input.chop) e.swingT = 0; // G（土を盛る）では撃たない
      e.action = 'shoot';
    } else {
      e.action = tool === 'axe' ? 'chop' : input.chop ? 'dig' : 'place';
    }
  }
  if (e.swingT) {
    const slashing = e.action === 'slashV' || e.action === 'slashH';
    const shooting = e.action === 'shoot';
    e.swingT += dt / (e.action === 'chop' ? SWING_TIME : slashing ? SLASH_TIME : shooting ? SHOOT_TIME : DIG_TIME);
    const impact = e.action === 'chop' ? CHOP_IMPACT : slashing ? SLASH_IMPACT : shooting ? SHOOT_IMPACT
      : e.action === 'dig' ? DIG_IMPACT : PLACE_IMPACT;
    if (!e.chopDone && e.swingT >= impact) {
      e.chopDone = true;
      onChop?.(e, e.action);
    }
    if (e.swingT >= 1) e.swingT = 0;
  }
  pose.swing = e.swingT ?? 0;
  pose.tool = tool;
  pose.action = e.action ?? 'chop';
  pose.carry = e.soil > 0 ? 1 : 0;
  const airborne = applyGravity(world, e, dt);
  let dir = null;
  if (input.dir && (input.dir[0] || input.dir[1])) {
    const l = Math.hypot(input.dir[0], input.dir[1]);
    dir = [input.dir[0] / l, input.dir[1] / l];
  }

  // 向き: 視線（face）があればすぐにそちらを向く（はじめに済ませてある）。
  // なければ行きたい方向へ一定の速さで回る。大きく向きを変えるときは減速する。
  let turnLeft = 0;
  if (!hasFace && dir) {
    const target = Math.atan2(dir[0], dir[1]);
    turnLeft = wrapAngle(target - pose.yaw);
    pose.yaw = wrapAngle(pose.yaw + clamp(turnLeft, -TURN_RATE * dt, TURN_RATE * dt));
    turnLeft = wrapAngle(target - pose.yaw);
  }
  if (dir) e.moveDir = dir;

  // 速度: 加速・減速は一定の割合で。走り続けると全力疾走になる
  e.runFor = dir && input.run && e.speed > WALK_SPEED ? (e.runFor ?? 0) + dt : 0;
  let targetSpeed = dir ? (input.run ? (e.runFor >= SPRINT_AFTER ? SPRINT_SPEED : RUN_SPEED) : WALK_SPEED) : 0;
  if (Math.abs(turnLeft) > 1.2) targetSpeed *= 0.3; // 振り返るときは足を止め気味に
  if (e.swingT && e.action !== 'shoot') targetSpeed *= 0.35; // 斧を振っている間はゆっくり（撃つときは歩きながらでも）
  if (e.pushing > 0) targetSpeed = Math.min(targetSpeed, PUSH_SPEED);
  // 木や岩にぶつかったら、その場で足踏みせずに立ち止まる。
  // 同じ方向に行こうとしている間は、ときどき道が空いたかだけ確かめる。
  if (dir && sameDir(dir, e.blockedDir)) {
    e.waitBlocked -= dt;
    if (e.waitBlocked <= 0) {
      // 歩くときと同じく、段を上がるのは地面（や岩）の段差に当たったときだけ
      const free = stepAxes(dir).some((d3) => {
        if (world.canMove(e.id, d3)) return true;
        if (world._fail?.via !== e || !world._fail.blocker?.ground) return false;
        for (let h = 1; h <= MAX_STEP; h++) if (world.canMove(e.id, [d3[0], h, d3[2]])) return true;
        return false;
      });
      if (free) e.blockedDir = null;
      else e.waitBlocked = 0.3;
    }
    if (e.blockedDir) targetSpeed = 0;
  } else {
    e.blockedDir = null;
  }
  e.speed = approach(e.speed, targetSpeed, (targetSpeed > e.speed ? ACCEL : DECEL) * dt);

  // 位置: x と z それぞれにたまった移動量が1ボクセル分を超えるたびに、その軸へ1ボクセル進む（速いときは1ティックに数歩）。
  // どの角度へも進める（斜めなら x と z に交互に進む）。1歩ごとに当たり判定をするので、速くても物をすり抜けない。
  // 片方の軸が塞がっていれば、もう一方の軸に沿って壁ぞいに滑る
  let pushedNow = false;
  let strain = false;
  if (e.moveDir && e.speed > 0) {
    const md = e.moveDir;
    const sub = e.sub;
    for (const a of [0, 1]) {
      if (sub[a] * md[a] < 0) sub[a] = 0; // 向きを変えたら、逆向きにたまった分は捨てる
      sub[a] = clamp(sub[a] + md[a] * e.speed * dt, -4, 4);
    }
    let movedAny = false;
    let failed = null;
    while (Math.abs(sub[0]) >= 1 || Math.abs(sub[1]) >= 1) {
      const ax = Math.abs(sub[0]), az = Math.abs(sub[1]);
      const first = ax > az || (ax === az && e.diagToggle) ? 0 : 1;
      let moved = null;
      for (const a of [first, 1 - first]) {
        // たまっていない軸も、先の軸が塞がっていれば試す（壁ぞいに滑る）
        if (Math.abs(sub[a]) < 1 && !(a !== first && failed && Math.abs(md[a]) > 0.15)) continue;
        const sgn = Math.abs(sub[a]) >= 1 ? Math.sign(sub[a]) : Math.sign(md[a]);
        const r = stepOnce(world, e, a === 0 ? [sgn, 0, 0] : [0, 0, sgn]);
        if (r.ok) {
          moved = r;
          sub[a] -= sgn;
          break;
        }
        failed = r;
        sub[a] = 0; // この軸は塞がっている
      }
      if (!moved) break;
      movedAny = true;
      report(e, moved);
      e.diagToggle = !e.diagToggle;
      if (moved.pushed.length) pushedNow = true;
    }
    if (!movedAny && failed) {
      report(e, failed);
      sub[0] = sub[1] = 0;
      // 自分より弱い物に阻まれた（押そうとしたが動かない）ときは踏ん張る
      const b = failed.blocker;
      strain = Boolean(dir) && b && (failed.via !== e || b.priority < e.priority);
      e.speed = strain ? Math.min(e.speed, 2.5) : 0;
      if (!strain && dir) {
        e.waitBlocked = 0.3;
        e.blockedDir = dir;
      }
    }
  }
  e.pushing = pushedNow || strain ? 0.35 : Math.max(0, e.pushing - dt);

  // 歩行周期は実際の速さに合わせて進める（足が滑らないように）
  const runAmt = clamp((e.speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
  pose.run = approach(pose.run, runAmt, dt * 4);
  pose.walk = clamp(e.speed / WALK_SPEED, 0, 1) ** 0.7;
  if (strain) pose.walk = Math.max(pose.walk, 0.45);
  pose.sprint = approach(pose.sprint ?? 0, clamp((e.speed - RUN_SPEED) / (SPRINT_SPEED - RUN_SPEED), 0, 1), dt * 3);
  const stride = STRIDE_WALK + (STRIDE_RUN - STRIDE_WALK) * pose.run + (STRIDE_SPRINT - STRIDE_RUN) * pose.sprint;
  pose.phase = (pose.phase + (Math.max(e.speed, strain ? 2.5 : 0) * dt) / stride) % 1;
  pose.push = approach(pose.push, e.pushing > 0 ? 1 : 0, dt * 6);
  pose.crouch = approach(pose.crouch, 0, dt * 3);
  pose.air = approach(pose.air, airborne && e.vy > 12 ? 1 : 0, dt * 6);

  // 立ち止まっているとき: 呼吸・まばたき・周りを見る・重心移動
  const still = 1 - pose.walk;
  if (e.speed < 0.5 && !strain) e.idleTime += dt;
  else e.idleTime = 0;
  e.breathPhase = (e.breathPhase + dt / 3.6) % 1;
  pose.breath = (0.5 - 0.5 * Math.cos(e.breathPhase * TAU)) * still;
  pose.sway = Math.sin(e.idleTime * 0.7) * Math.min(1, e.idleTime / 2);

  e.blinkIn -= dt;
  if (e.blinkIn <= 0) {
    e.blinkLeft = 0.12;
    e.blinkIn = 2 + rng() * 3.5;
  }
  e.blinkLeft -= dt;
  pose.blink = e.blinkLeft > 0;

  if (e.idleTime > 1.5) {
    e.lookIn -= dt;
    if (e.lookIn <= 0) {
      e.headTarget = rng() < 0.35 ? 0 : (rng() * 2 - 1) * 0.8;
      e.lookIn = 1.2 + rng() * 2.5;
    }
  } else {
    e.headTarget = 0;
  }
  pose.headYaw = approach(pose.headYaw, e.headTarget, dt * 2.5);

  // 姿勢からボクセルを描き直し、変わったセルだけ塗り替える
  humanColors(e.palette, pose, e.look);
  world.recolor(e, e.look);
  if (e.toolId) drawTool(world, e);
}

// 斧の、体の円柱からはみ出した部分を描く。空いているセルにだけ入り、いつでも場所をゆずる
function drawTool(world, e) {
  for (const [x, y, z] of e.toolCells) {
    if (world.ownerAt(x, y, z) === e.toolId) world.setCell(x, y, z, 0, 0);
  }
  const next = [];
  for (const [tx, ty, tz, color] of rasterizeTool(e.palette, e.pose)) {
    const x = e.pos[0] + tx, y = e.pos[1] + ty, z = e.pos[2] + tz;
    if (y < 1 || world.ownerAt(x, y, z) !== 0) continue;
    world.setCell(x, y, z, e.toolId, color);
    next.push([x, y, z]);
  }
  e.toolCells = next;
}
