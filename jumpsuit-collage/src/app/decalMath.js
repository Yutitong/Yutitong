// Geometry of a projected image: a box centred on a surface point, facing along
// the surface normal. Kept free of three.js so it can be unit-tested.

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

// Local (0..1) coordinates of a 3D point inside a decal's projection box, or null.
export function decalLocal(d, aspect, p) {
  const f = decalFrame(d, aspect);
  const v = [p[0] - f.center[0], p[1] - f.center[1], p[2] - f.center[2]];
  const lx = dot(v, f.right) / f.width + 0.5;
  const ly = dot(v, f.up) / f.height + 0.5;
  const lz = dot(v, f.normal);
  if (lx < 0 || lx > 1 || ly < 0 || ly > 1 || Math.abs(lz) > f.depth) return null;
  return [lx, ly];
}

export function mirrorDecal(d) {
  return {
    ...d,
    position: [-d.position[0], d.position[1], d.position[2]],
    normal: [-d.normal[0], d.normal[1], d.normal[2]],
    rotation: -d.rotation,
    flipX: !d.flipX,
  };
}
