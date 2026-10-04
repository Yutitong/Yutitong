// 人型キャラの動き（速度・向き・歩行周期）と、それに合わせた姿勢の更新
//
// 体の位置は1ボクセル単位でしか動かないが、速度・向き・歩行周期は連続的に変わる。
// アニメーションは毎ティック姿勢から描き直すので、移動のコマとは切り離されている。

import { createPose, rasterizeHuman } from './humanoid.js';

export const WALK_SPEED = 9; // ボクセル/秒（≈ 1.35 m/s）
export const RUN_SPEED = 21; // ≈ 3.2 m/s
export const PUSH_SPEED = 4;
const ACCEL = 30; // ボクセル/秒²
const DECEL = 45;
const TURN_RATE = 9; // ラジアン/秒
const STRIDE_WALK = 11; // 1周期（左右1歩ずつ）で進むボクセル数
const STRIDE_RUN = 18;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, maxStep) => (v < target ? Math.min(target, v + maxStep) : Math.max(target, v - maxStep));
const sameDir = (a, b) => Boolean(b) && a[0] === b[0] && a[1] === b[1];
const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

// 1歩で試す移動（斜めは x と z を交互に。先に試す方が塞がっていたらもう一方へ）
function stepAxes(dir, toggle) {
  const x = [dir[0], 0, 0];
  const z = [0, 0, dir[1]];
  if (dir[0] && dir[1]) return toggle ? [x, z] : [z, x];
  return [dir[0] ? x : z];
}

export function initCharacter(e, rng = Math.random) {
  e.pose = createPose();
  e.pose.yaw = e.yaw ?? 0;
  e.speed = 0;
  e.travel = 0; // まだ使っていない移動量（ボクセル）
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
  e.look = new Uint32Array(e.colors.length);
  return e;
}

// 1ティック分キャラを動かす。
// input: { dir: [dx, dz]（各 -1..1、8方向）または null, run: boolean }
// act(e, dir3) は1ボクセルの移動を試み、tryMove の結果を返す。
export function updateCharacter(world, e, input, dt, rng, act) {
  const pose = e.pose;
  const dir = input.dir && (input.dir[0] || input.dir[1]) ? input.dir : null;

  // 向き: 行きたい方向へ一定の速さで回る。大きく向きを変えるときは減速する。
  let turnLeft = 0;
  if (dir) {
    const target = Math.atan2(dir[0], dir[1]);
    turnLeft = wrapAngle(target - pose.yaw);
    pose.yaw = wrapAngle(pose.yaw + clamp(turnLeft, -TURN_RATE * dt, TURN_RATE * dt));
    turnLeft = wrapAngle(target - pose.yaw);
    e.moveDir = dir;
  }

  // 速度: 加速・減速は一定の割合で
  let targetSpeed = dir ? (input.run ? RUN_SPEED : WALK_SPEED) : 0;
  if (Math.abs(turnLeft) > 1.2) targetSpeed *= 0.3; // 振り返るときは足を止め気味に
  if (e.pushing > 0) targetSpeed = Math.min(targetSpeed, PUSH_SPEED);
  // 木や岩にぶつかったら、その場で足踏みせずに立ち止まる。
  // 同じ方向に行こうとしている間は、ときどき道が空いたかだけ確かめる。
  if (dir && sameDir(dir, e.blockedDir)) {
    e.waitBlocked -= dt;
    if (e.waitBlocked <= 0) {
      const free = stepAxes(dir, e.diagToggle).some((d3) => world.canMove(e.id, d3));
      if (free) e.blockedDir = null;
      else e.waitBlocked = 0.3;
    }
    if (e.blockedDir) targetSpeed = 0;
  } else {
    e.blockedDir = null;
  }
  e.speed = approach(e.speed, targetSpeed, (targetSpeed > e.speed ? ACCEL : DECEL) * dt);

  // 位置: たまった移動量が1ボクセル分を超えたら1歩進む
  let pushedNow = false;
  let strain = false;
  if (e.moveDir && e.speed > 0) {
    const diag = e.moveDir[0] !== 0 && e.moveDir[1] !== 0;
    const cost = diag ? Math.SQRT1_2 : 1; // 斜めは x と z に交互に1歩ずつ
    e.travel = Math.min(e.travel + e.speed * dt, 1.5);
    if (e.travel >= cost) {
      let moved = null;
      let last = null;
      for (const d3 of stepAxes(e.moveDir, e.diagToggle)) {
        last = act(e, d3);
        if (last.ok) {
          moved = last;
          break;
        }
      }
      if (moved) {
        e.travel -= cost;
        e.diagToggle = !e.diagToggle;
        if (moved.pushed.length) pushedNow = true;
      } else {
        e.travel = 0;
        // 自分より弱い物に阻まれた（押そうとしたが動かない）ときは踏ん張る
        const b = last.blocker;
        strain = Boolean(dir) && b && (last.via !== e || b.priority < e.priority);
        e.speed = strain ? Math.min(e.speed, 2.5) : 0;
        if (!strain && dir) {
          e.waitBlocked = 0.3;
          e.blockedDir = dir;
        }
      }
    }
  }
  e.pushing = pushedNow || strain ? 0.35 : Math.max(0, e.pushing - dt);

  // 歩行周期は実際の速さに合わせて進める（足が滑らないように）
  const runAmt = clamp((e.speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
  pose.run = approach(pose.run, runAmt, dt * 4);
  pose.walk = clamp(e.speed / WALK_SPEED, 0, 1) ** 0.7;
  if (strain) pose.walk = Math.max(pose.walk, 0.45);
  const stride = STRIDE_WALK + (STRIDE_RUN - STRIDE_WALK) * pose.run;
  pose.phase = (pose.phase + (Math.max(e.speed, strain ? 2.5 : 0) * dt) / stride) % 1;
  pose.push = approach(pose.push, e.pushing > 0 ? 1 : 0, dt * 6);

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
  rasterizeHuman(e.palette, pose, e.look);
  world.recolor(e, e.look);
}
