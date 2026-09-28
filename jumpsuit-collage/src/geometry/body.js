// Parametric jumpsuit surface. Units are centimetres.
// World axes: +y up, +z forward (front of the garment), +x toward the wearer's left.
// y = 0 is the trouser hem.
import { pchip, solveMonotone } from './interp.js';

export const Y_CROTCH = 72;
export const Y_WAIST = 100;
export const Y_ARMPIT = 120;
export const Y_DOME = 130; // where the shoulders start rounding over
export const DOME_H = 8; // height of the shoulder dome
export const ETA_TOP = Y_DOME + (DOME_H * Math.PI) / 2; // torso parameter at the shoulder ridge
export const Y_TOP = Y_DOME + DOME_H;

export const ARMHOLE_X = 18; // armhole plane: the sleeve replaces the torso where |x| > ARMHOLE_X
export const NECK_HALF_WIDTH = 8;
export const NECK_DROP_FRONT = 11; // measured along the surface (torso parameter units)
export const NECK_DROP_BACK = 3;

export const SLEEVE_LENGTH = 58;
export const SLEEVE_ANGLE = (38 * Math.PI) / 180; // from vertical (A-pose)
export const WRIST_RADIUS = 5.5;

// ---------------------------------------------------------------- torso ---
// The torso is a stack of ellipses indexed by eta. Below Y_DOME eta equals the height;
// above it eta walks over the shoulder dome by arc angle so rows stay evenly spaced.
const torsoHalfWidth = pchip([
  [Y_WAIST, 16],
  [110, 17],
  [Y_ARMPIT, ARMHOLE_X],
  [Y_DOME, 20],
  [ETA_TOP, 20.5],
]);
const torsoDepthFront = pchip([
  [Y_WAIST, 11],
  [110, 12.5],
  [Y_ARMPIT, 13],
  [Y_DOME, 12],
]);
const torsoDepthBack = pchip([
  [Y_WAIST, 11],
  [110, 11.5],
  [Y_ARMPIT, 12],
  [Y_DOME, 11.5],
]);

function domeAngle(eta) {
  return eta <= Y_DOME ? 0 : Math.min((eta - Y_DOME) / DOME_H, Math.PI / 2);
}

export function torsoY(eta) {
  return eta <= Y_DOME ? eta : Y_DOME + DOME_H * Math.sin(domeAngle(eta));
}

export function torsoA(eta) {
  return torsoHalfWidth(eta);
}

function torsoB(eta, back) {
  const base = back ? torsoDepthBack(Math.min(eta, Y_DOME)) : torsoDepthFront(Math.min(eta, Y_DOME));
  return base * Math.cos(domeAngle(eta));
}

// theta = 0 is centre front (or centre back for the back piece), +-pi/2 the side seams.
export function torsoPoint(theta, eta, back) {
  const a = torsoA(eta);
  const b = torsoB(eta, back);
  const x = a * Math.sin(theta);
  const z = b * Math.cos(theta);
  return back ? [-x, torsoY(eta), -z] : [x, torsoY(eta), z];
}

// The shoulder point: where the armhole meets the shoulder ridge.
export const THETA_SHOULDER = Math.asin(ARMHOLE_X / torsoA(ETA_TOP));
export const THETA_NECK = Math.asin(NECK_HALF_WIDTH / torsoA(ETA_TOP));

// Height (in eta) of the armhole for a given |theta| in [THETA_SHOULDER, pi/2].
export function armholeEta(absTheta) {
  const targetA = ARMHOLE_X / Math.sin(absTheta);
  return solveMonotone(torsoA, targetA, Y_ARMPIT, ETA_TOP);
}

// Top edge of a torso piece (in eta) as a function of theta.
export function torsoTopEta(theta, back) {
  const t = Math.abs(theta);
  if (t >= THETA_SHOULDER) return armholeEta(t);
  if (t >= THETA_NECK) return ETA_TOP;
  const drop = back ? NECK_DROP_BACK : NECK_DROP_FRONT;
  const u = t / THETA_NECK;
  return ETA_TOP - drop * (1 - u * u) ** 0.75;
}

// The armhole as a closed loop on the left side (x = +ARMHOLE_X).
// s in [0,1): 0 = armpit, 0.5 = shoulder point; front half first.
export function armholeLoop(samples = 400) {
  const pts = [];
  const half = samples / 2;
  // Sample eta with a cosine spacing so the steep ends are well resolved.
  const etaAt = (k) => Y_ARMPIT + (ETA_TOP - Y_ARMPIT) * (0.5 - 0.5 * Math.cos((Math.PI * k) / half));
  for (let k = 0; k <= half; k++) {
    const eta = etaAt(k);
    const a = torsoA(eta);
    const c = Math.sqrt(Math.max(0, 1 - (ARMHOLE_X / a) ** 2));
    pts.push([ARMHOLE_X, torsoY(eta), torsoB(eta, false) * c]);
  }
  for (let k = half - 1; k > 0; k--) {
    const eta = etaAt(k);
    const a = torsoA(eta);
    const c = Math.sqrt(Math.max(0, 1 - (ARMHOLE_X / a) ** 2));
    pts.push([ARMHOLE_X, torsoY(eta), -torsoB(eta, true) * c]);
  }
  return pts; // open list; last point connects back to the first
}

// -------------------------------------------------------------- sleeves ---
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Resample a closed polyline to n points evenly spaced by arc length.
export function resampleClosed(pts, n) {
  const m = pts.length;
  const cum = [0];
  for (let i = 0; i < m; i++) cum.push(cum[i] + dist(pts[i], pts[(i + 1) % m]));
  const total = cum[m];
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / n;
    while (cum[seg + 1] < target) seg++;
    const t = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    const a = pts[seg];
    const b = pts[(seg + 1) % m];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

export const ARM_DIR = [Math.sin(SLEEVE_ANGLE), -Math.cos(SLEEVE_ANGLE), 0];
export const ARM_ROOT = [ARMHOLE_X, (Y_ARMPIT + Y_TOP) / 2, 0];
export const WRIST_CENTER = add(ARM_ROOT, scale(ARM_DIR, SLEEVE_LENGTH));
// Unit vector pointing from the arm axis toward the underarm side.
const ARM_IN = [-Math.cos(SLEEVE_ANGLE), -Math.sin(SLEEVE_ANGLE), 0];

// Left sleeve surface. s wraps around the arm (0 and 1 are the underarm seam,
// 0.25 front, 0.5 top), t runs from the armhole (0) to the wrist hem (1).
export function makeSleeveSurface(loopSamples) {
  const loop = resampleClosed(armholeLoop(), loopSamples);
  const k0 = 24;
  const k1 = 40;
  const t0 = [k0, 0, 0];
  const t1 = scale(ARM_DIR, k1);
  const loopAt = (s) => {
    const f = (((s % 1) + 1) % 1) * loopSamples;
    const i = Math.floor(f);
    const u = f - i;
    const a = loop[i % loopSamples];
    const b = loop[(i + 1) % loopSamples];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  };
  return (s, t) => {
    const ang = 2 * Math.PI * s;
    const wrist = add(
      WRIST_CENTER,
      add(scale(ARM_IN, WRIST_RADIUS * Math.cos(ang)), [0, 0, WRIST_RADIUS * Math.sin(ang)]),
    );
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const p0 = loopAt(s);
    return [
      h00 * p0[0] + h10 * t0[0] + h01 * wrist[0] + h11 * t1[0],
      h00 * p0[1] + h10 * t0[1] + h01 * wrist[1] + h11 * t1[1],
      h00 * p0[2] + h10 * t0[2] + h01 * wrist[2] + h11 * t1[2],
    ];
  };
}

// ------------------------------------------------------ legs and pelvis ---
// Each half of the lower body is one generalised cylinder. phi = 0 is the side seam,
// pi/2 the front (or back), and the inner edge is the inseam below the crotch and the
// centre-front/back seam above it (where the curve reaches the x = 0 plane).
const legRadius = pchip([
  [0, 9.5],
  [35, 10],
  [Y_CROTCH, 10.5],
]);
const LEG_SPREAD = 5 / Y_CROTCH;
const pelvisCenterX = pchip([
  [Y_CROTCH, 10.5],
  [78, 8.5],
  [88, 5],
  [Y_WAIST, 0],
]);
const pelvisRadiusX = pchip([
  [Y_CROTCH, 10.5],
  [78, 12.5],
  [88, 15],
  [Y_WAIST, 16],
]);
const pelvisDepthFront = pchip([
  [Y_CROTCH, 10.5],
  [80, 11.5],
  [88, 11.8],
  [Y_WAIST, 11],
]);
const pelvisDepthBack = pchip([
  [Y_CROTCH, 10.5],
  [80, 13],
  [88, 13.5],
  [Y_WAIST, 11],
]);

export function legCenterX(y) {
  return legRadius(Y_CROTCH) + (Y_CROTCH - y) * LEG_SPREAD;
}

export function lowerMaxPhi(y) {
  if (y <= Y_CROTCH) return Math.PI;
  const r = Math.min(1, pelvisCenterX(y) / pelvisRadiusX(y));
  return Math.acos(-r);
}

// Left half of the lower body.
export function lowerPoint(phi, y, back) {
  let x;
  let z;
  if (y <= Y_CROTCH) {
    const r = legRadius(y);
    x = legCenterX(y) + r * Math.cos(phi);
    z = r * Math.sin(phi);
  } else {
    x = pelvisCenterX(y) + pelvisRadiusX(y) * Math.cos(phi);
    z = (back ? pelvisDepthBack(y) : pelvisDepthFront(y)) * Math.sin(phi);
    if (Math.abs(x) < 1e-9) x = 0;
  }
  return [x, y, back ? -z : z];
}
