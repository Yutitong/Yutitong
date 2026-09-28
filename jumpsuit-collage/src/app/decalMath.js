// Geometry of placed images. Kept free of three.js so it can be unit-tested.
// - "project" mode: a box centred on a surface point, projected along a direction.
// - "wrap" mode: the image is wound around a body axis like a band (cylindrical
//   coordinates), so it can go all the way round a leg, arm or the torso.

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function decalFrame(d, aspect) {
  const n = norm(d.normal);
  // "Up" follows the garment's vertical; on near-horizontal surfaces (shoulder tops)
  // fall back to pointing toward the back so images read correctly from the front.
  let ref = [0, 1, 0];
  if (Math.abs(n[1]) > 0.92) ref = n[1] > 0 ? [0, 0, -1] : [0, 0, 1];
  const k = dot(ref, n);
  let up = norm([ref[0] - k * n[0], ref[1] - k * n[1], ref[2] - k * n[2]]);
  let right = norm(cross(up, n));
  const a = (d.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r2 = [right[0] * c + up[0] * s, right[1] * c + up[1] * s, right[2] * c + up[2] * s];
  const u2 = [up[0] * c - right[0] * s, up[1] * c - right[1] * s, up[2] * c - right[2] * s];
  right = r2;
  up = u2;
  const width = d.size;
  const height = d.size / aspect;
  const depth = d.depth ?? Math.min(Math.max(Math.max(width, height) * 0.5, 4), 30);
  return { center: d.position, normal: n, right, up, width, height, depth };
}

// Cylindrical frame of a wrapped image: angle around `dir` measured from the
// image centre, scaled by the centre's radius so the image keeps its proportions.
export function wrapFrame(d, aspect) {
  const { origin, dir } = d.wrap;
  const D = norm(dir);
  const q = [d.position[0] - origin[0], d.position[1] - origin[1], d.position[2] - origin[2]];
  const tc = dot(q, D);
  const radial = [q[0] - tc * D[0], q[1] - tc * D[1], q[2] - tc * D[2]];
  const radius = Math.max(Math.hypot(...radial), 1e-3);
  const A = norm(radial);
  const right = cross(D, A);
  const a = (d.rotation * Math.PI) / 180;
  return {
    origin,
    dir: D,
    A,
    right,
    radius,
    tc,
    cos: Math.cos(a),
    sin: Math.sin(a),
    width: d.size,
    height: d.size / aspect,
    radialRange: [0.25 * radius, 2.1 * radius],
    side: d.wrap.side ?? 0,
  };
}

// Local image coordinates (before the 0..1 range check) of a point for a wrapped image.
function wrapLocal(f, p) {
  const q = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  const t = dot(q, f.dir);
  const radial = [q[0] - t * f.dir[0], q[1] - t * f.dir[1], q[2] - t * f.dir[2]];
  const r = Math.hypot(...radial);
  if (r < f.radialRange[0] || r > f.radialRange[1] || p[0] * f.side < -0.5) return null;
  const phi = Math.atan2(dot(radial, f.right), dot(radial, f.A));
  const sx = phi * f.radius;
  const sy = t - f.tc;
  return [(sx * f.cos + sy * f.sin) / f.width + 0.5, (sy * f.cos - sx * f.sin) / f.height + 0.5];
}

// 3D point of a local image coordinate (0..1 across, 0..1 up), used to place the
// on-model handles. Wrapped images keep handles within `maxAngle` of the centre so
// they stay on the visible side of the body.
export function decalPoint(d, aspect, lx, ly, maxAngle = 1.3) {
  if (d.mode === 'wrap') {
    const f = wrapFrame(d, aspect);
    const x = (lx - 0.5) * f.width;
    const y = (ly - 0.5) * f.height;
    const sx = f.cos * x - f.sin * y;
    const sy = f.sin * x + f.cos * y;
    const phi = Math.max(-maxAngle, Math.min(maxAngle, sx / f.radius));
    const t = f.tc + sy;
    return [0, 1, 2].map(
      (c) => f.origin[c] + f.dir[c] * t + f.radius * (f.A[c] * Math.cos(phi) + f.right[c] * Math.sin(phi)),
    );
  }
  const f = decalFrame(d, aspect);
  const x = (lx - 0.5) * f.width;
  const y = (ly - 0.5) * f.height;
  return [0, 1, 2].map((c) => f.center[c] + f.right[c] * x + f.up[c] * y);
}

// Direction the image faces outward at its centre (for hiding handles seen from behind).
export function decalFacing(d, aspect) {
  return d.mode === 'wrap' ? wrapFrame(d, aspect).A : decalFrame(d, aspect).normal;
}

export const circumference = (d) => 2 * Math.PI * wrapFrame(d, 1).radius;

// Local (0..1) coordinates of a 3D point inside a placed image, or null.
export function decalLocal(d, aspect, p) {
  let local;
  if (d.mode === 'wrap') {
    local = wrapLocal(wrapFrame(d, aspect), p);
    if (!local) return null;
  } else {
    const f = decalFrame(d, aspect);
    const v = [p[0] - f.center[0], p[1] - f.center[1], p[2] - f.center[2]];
    if (Math.abs(dot(v, f.normal)) > f.depth) return null;
    local = [dot(v, f.right) / f.width + 0.5, dot(v, f.up) / f.height + 0.5];
  }
  const [lx, ly] = local;
  if (lx < 0 || lx > 1 || ly < 0 || ly > 1) return null;
  return local;
}

export function mirrorDecal(d) {
  return {
    ...d,
    position: [-d.position[0], d.position[1], d.position[2]],
    normal: [-d.normal[0], d.normal[1], d.normal[2]],
    rotation: -d.rotation,
    flipX: !d.flipX,
    pieceId: d.pieceId?.replace(/(left|right)$/, (m) => (m === 'left' ? 'right' : 'left')),
    ...(d.wrap && {
      wrap: {
        ...d.wrap,
        origin: [-d.wrap.origin[0], d.wrap.origin[1], d.wrap.origin[2]],
        dir: [-d.wrap.dir[0], d.wrap.dir[1], d.wrap.dir[2]],
        side: -(d.wrap.side ?? 0),
      },
    }),
  };
}
