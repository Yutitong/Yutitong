// Builds the jumpsuit's pattern pieces: each piece is a patch of the 3D garment surface
// together with its flattened (sewable) 2D shape, so every point of the 3D model has an
// exact location on a pattern piece.
import {
  ARM_DIR,
  SLEEVE_ANGLE,
  Y_ARMPIT,
  Y_CROTCH,
  Y_WAIST,
  lowerMaxPhi,
  lowerPoint,
  makeSleeveSurface,
  torsoPoint,
  torsoTopEta,
} from './body.js';
import { flattenGrid, gridTriangles } from './flatten.js';

// Extra fabric rendered around each piece (cm) so seam allowances are printed too.
export const SKIRT_RINGS = [0.8, 1.6, 2.4, 3.2];
export const MAX_SEAM_ALLOWANCE = 2.5;

// Transfinite (Coons) interpolation of four boundary curves, each given as an
// array of 2D points: bottom/top have nu points, left/right have nv points.
function coonsGrid(bottom, top, left, right) {
  const nu = bottom.length;
  const nv = left.length;
  const grid = [];
  for (let j = 0; j < nv; j++) {
    const t = j / (nv - 1);
    for (let i = 0; i < nu; i++) {
      const s = i / (nu - 1);
      const p = [0, 1].map(
        (c) =>
          (1 - t) * bottom[i][c] +
          t * top[i][c] +
          (1 - s) * left[j][c] +
          s * right[j][c] -
          ((1 - s) * (1 - t) * bottom[0][c] +
            s * (1 - t) * bottom[nu - 1][c] +
            (1 - s) * t * top[0][c] +
            s * t * top[nu - 1][c]),
      );
      grid.push(p);
    }
  }
  return grid;
}

// Resample an open 2D polyline to n points evenly spaced by (scaled) arc length.
function resampleOpen(pts, n, sx = 1, sy = 1) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * sx, (pts[i][1] - pts[i - 1][1]) * sy));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < pts.length - 2 && cum[seg + 1] < target) seg++;
    const u = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    out.push([
      pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * u,
      pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * u,
    ]);
  }
  return out;
}

const THETA_SCALE = 17; // approx. torso radius, makes (theta, eta) distances roughly cm

function torsoSpec(back) {
  const nu = 61;
  const nv = 41;
  // Parameter domain (theta, eta). The top edge runs armpit -> armhole -> shoulder seam
  // -> neckline -> ... -> other armpit; the sides are the side seams.
  const dense = [];
  const m = 1200;
  for (let k = 0; k <= m; k++) {
    const theta = -Math.PI / 2 + (Math.PI * k) / m;
    dense.push([theta, torsoTopEta(theta, back)]);
  }
  const top = resampleOpen(dense, nu, THETA_SCALE, 1);
  const bottom = [];
  for (let i = 0; i < nu; i++) bottom.push([-Math.PI / 2 + (Math.PI * i) / (nu - 1), Y_WAIST]);
  const left = [];
  const right = [];
  for (let j = 0; j < nv; j++) {
    const eta = Y_WAIST + ((Y_ARMPIT - Y_WAIST) * j) / (nv - 1);
    left.push([-Math.PI / 2, eta]);
    right.push([Math.PI / 2, eta]);
  }
  const domain = coonsGrid(bottom, top, left, right);
  return {
    id: back ? 'bodice-back' : 'bodice-front',
    name: back ? 'Bodice back' : 'Bodice front',
    nu,
    nv,
    point: (i, j) => {
      const [theta, eta] = domain[j * nu + i];
      return torsoPoint(theta, eta, back);
    },
    grain: (p) => p[1],
    outward: back ? [0, 0, -1] : [0, 0, 1],
  };
}

function lowerRows() {
  const rows = [];
  const n1 = 48;
  for (let k = 0; k <= n1; k++) rows.push((Y_CROTCH * k) / n1);
  const n2 = 24;
  for (let k = 1; k <= n2; k++) rows.push(Y_CROTCH + (Y_WAIST - Y_CROTCH) * (k / n2) ** 1.7);
  return rows;
}

function lowerSpec(back) {
  const rows = lowerRows();
  const nu = 37;
  return {
    id: back ? 'leg-back-left' : 'leg-front-left',
    name: back ? 'Left back leg' : 'Left front leg',
    nu,
    nv: rows.length,
    point(i, j) {
      const y = rows[j];
      return lowerPoint((lowerMaxPhi(y) * i) / (nu - 1), y, back);
    },
    grain: (p) => p[1],
    outward: back ? [0, 0, -1] : [0, 0, 1],
  };
}

function sleeveSpec() {
  const nu = 49;
  const nv = 61;
  const surface = makeSleeveSurface(nu - 1);
  return {
    id: 'sleeve-left',
    name: 'Left sleeve',
    nu,
    nv,
    point: (i, j) => surface(i / (nu - 1), j / (nv - 1)),
    // Grain runs along the arm with the sleeve cap at the top.
    grain: (p) => -(p[0] * ARM_DIR[0] + p[1] * ARM_DIR[1] + p[2] * ARM_DIR[2]),
    outward: [Math.cos(SLEEVE_ANGLE), Math.sin(SLEEVE_ANGLE), 0],
  };
}

// --------------------------------------------------------------- helpers ---
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function at3(arr, k) {
  return [arr[3 * k], arr[3 * k + 1], arr[3 * k + 2]];
}

function boundaryLoop(nu, nv) {
  const loop = [];
  for (let i = 0; i < nu; i++) loop.push(i);
  for (let j = 1; j < nv; j++) loop.push(j * nu + nu - 1);
  for (let i = nu - 2; i >= 0; i--) loop.push((nv - 1) * nu + i);
  for (let j = nv - 2; j >= 1; j--) loop.push(j * nu);
  return loop;
}

export function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Outward unit normals (with miter scaling) for a counter-clockwise polygon.
export function miterNormals(poly, limit = 2.5) {
  const n = poly.length;
  const edgeN = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    edgeN.push([dy / l, -dx / l]);
  }
  return poly.map((_, i) => {
    const a = edgeN[(i - 1 + n) % n];
    const b = edgeN[i];
    let nx = a[0] + b[0];
    let ny = a[1] + b[1];
    const l = Math.hypot(nx, ny);
    if (l < 1e-9) return b;
    nx /= l;
    ny /= l;
    const c = Math.max(nx * b[0] + ny * b[1], 1 / limit);
    return [nx / c, ny / c];
  });
}

// Offset a counter-clockwise polygon outward by d (mitered corners).
export function offsetPolygon(poly, d) {
  const normals = miterNormals(poly);
  return poly.map((p, i) => [p[0] + normals[i][0] * d, p[1] + normals[i][1] * d]);
}

// Drop consecutive points closer than eps (keeps outlines clean for export).
export function dedupe(poly, eps = 1e-3) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p);
  }
  while (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > eps) break;
    out.pop();
  }
  return out;
}

function vertexNormals(pos, tris, count) {
  const nrm = new Float64Array(count * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = at3(pos, tris[t]);
    const b = at3(pos, tris[t + 1]);
    const c = at3(pos, tris[t + 2]);
    const n = cross(sub(b, a), sub(c, a));
    for (let e = 0; e < 3; e++) {
      const k = tris[t + e];
      nrm[3 * k] += n[0];
      nrm[3 * k + 1] += n[1];
      nrm[3 * k + 2] += n[2];
    }
  }
  for (let k = 0; k < count; k++) {
    const l = Math.hypot(nrm[3 * k], nrm[3 * k + 1], nrm[3 * k + 2]) || 1;
    nrm[3 * k] /= l;
    nrm[3 * k + 1] /= l;
    nrm[3 * k + 2] /= l;
  }
  return nrm;
}

// Rotate/mirror/translate the flattened piece so that it is seen from the outside of
// the fabric, the grain points up (+y) and the seam outline starts at the origin.
function orientPattern(uv, pos, tris, grainValues, outward) {
  const n = grainValues.length;
  // Mirror if the pattern shows the inside of the fabric.
  let outwardSign = 0;
  let areaSign = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    const nrm = cross(sub(at3(pos, b), at3(pos, a)), sub(at3(pos, c), at3(pos, a)));
    outwardSign += dot(nrm, outward);
    const ax = uv[2 * b] - uv[2 * a];
    const ay = uv[2 * b + 1] - uv[2 * a + 1];
    const bx = uv[2 * c] - uv[2 * a];
    const by = uv[2 * c + 1] - uv[2 * a + 1];
    areaSign += ax * by - ay * bx;
  }
  if (outwardSign < 0) throw new Error('triangle winding must face outward');
  if (areaSign < 0) for (let k = 0; k < n; k++) uv[2 * k] = -uv[2 * k];

  // Least-squares gradient of the grain value over the pattern.
  let sx = 0;
  let sy = 0;
  let sg = 0;
  for (let k = 0; k < n; k++) {
    sx += uv[2 * k];
    sy += uv[2 * k + 1];
    sg += grainValues[k];
  }
  sx /= n;
  sy /= n;
  sg /= n;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let xg = 0;
  let yg = 0;
  for (let k = 0; k < n; k++) {
    const x = uv[2 * k] - sx;
    const y = uv[2 * k + 1] - sy;
    const g = grainValues[k] - sg;
    xx += x * x;
    xy += x * y;
    yy += y * y;
    xg += x * g;
    yg += y * g;
  }
  const det = xx * yy - xy * xy;
  const gx = (yy * xg - xy * yg) / det;
  const gy = (xx * yg - xy * xg) / det;
  const angle = Math.PI / 2 - Math.atan2(gy, gx);
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  for (let k = 0; k < n; k++) {
    const x = uv[2 * k] - sx;
    const y = uv[2 * k + 1] - sy;
    uv[2 * k] = x * cs - y * sn;
    uv[2 * k + 1] = x * sn + y * cs;
  }
}

function buildPiece(spec) {
  const { nu, nv } = spec;
  const count = nu * nv;
  const p3 = new Float64Array(count * 3);
  const grain = new Float64Array(count);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      const p = spec.point(i, j);
      p3[3 * k] = p[0];
      p3[3 * k + 1] = p[1];
      p3[3 * k + 2] = p[2];
      grain[k] = spec.grain(p);
    }
  }
  let tris = gridTriangles(nu, nv);
  // Make the triangle winding face outward.
  let s = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = at3(p3, tris[t]);
    s += dot(cross(sub(at3(p3, tris[t + 1]), a), sub(at3(p3, tris[t + 2]), a)), spec.outward);
  }
  if (s < 0) {
    for (let t = 0; t < tris.length; t += 3) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
  }
  const uv = flattenGrid(p3, nu, nv, tris);
  orientPattern(uv, p3, tris, grain, spec.outward);
  return { spec, p3, uv, tris, grain };
}

function mirrorPiece(built, id, name) {
  const { p3, uv, tris } = built;
  const m3 = Float64Array.from(p3);
  for (let k = 0; k < m3.length; k += 3) m3[k] = -m3[k];
  const muv = Float64Array.from(uv);
  for (let k = 0; k < muv.length; k += 2) muv[k] = -muv[k];
  const mt = tris.slice();
  for (let t = 0; t < mt.length; t += 3) [mt[t + 1], mt[t + 2]] = [mt[t + 2], mt[t + 1]];
  return { spec: { ...built.spec, id, name }, p3: m3, uv: muv, tris: mt };
}

// Adds skirt rings around the piece (extrapolating the surface tangentially) and
// packages everything the renderer and exporter need.
function finishPiece(built) {
  const { spec, p3, uv, tris } = built;
  const { nu, nv } = spec;
  const gridCount = nu * nv;
  const nrmGrid = vertexNormals(p3, tris, gridCount);

  let loop = boundaryLoop(nu, nv);
  let poly = loop.map((k) => [uv[2 * k], uv[2 * k + 1]]);
  if (signedArea(poly) < 0) {
    loop = loop.reverse();
    poly = poly.reverse();
  }
  const normals2 = miterNormals(poly);

  // Average 2D->3D Jacobian of the triangles around each boundary vertex.
  const jac = new Map();
  for (const k of loop) jac.set(k, [0, 0, 0, 0, 0, 0, 0]);
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = tris[t + e];
      const J = jac.get(k);
      if (!J) continue;
      const a = tris[t];
      const b = tris[t + 1];
      const c = tris[t + 2];
      const e1 = sub(at3(p3, b), at3(p3, a));
      const e2 = sub(at3(p3, c), at3(p3, a));
      const u1x = uv[2 * b] - uv[2 * a];
      const u1y = uv[2 * b + 1] - uv[2 * a + 1];
      const u2x = uv[2 * c] - uv[2 * a];
      const u2y = uv[2 * c + 1] - uv[2 * a + 1];
      const det = u1x * u2y - u2x * u1y;
      if (Math.abs(det) < 1e-12) continue;
      // inverse of [[u1x,u2x],[u1y,u2y]]
      const i00 = u2y / det;
      const i01 = -u2x / det;
      const i10 = -u1y / det;
      const i11 = u1x / det;
      for (let r = 0; r < 3; r++) {
        J[2 * r] += e1[r] * i00 + e2[r] * i10;
        J[2 * r + 1] += e1[r] * i01 + e2[r] * i11;
      }
      J[6] += 1;
    }
  }

  const rings = SKIRT_RINGS.length;
  const L = loop.length;
  const total = gridCount + rings * L;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const pat = new Float64Array(total * 2);
  pos.set(p3);
  nrm.set(nrmGrid);
  pat.set(uv);
  loop.forEach((k, li) => {
    const J = jac.get(k);
    const w = J[6] || 1;
    const [nx, ny] = normals2[li];
    const dir = [0, 1, 2].map((r) => (J[2 * r] * nx + J[2 * r + 1] * ny) / w);
    SKIRT_RINGS.forEach((d, r) => {
      const v = gridCount + r * L + li;
      for (let c = 0; c < 3; c++) {
        pos[3 * v + c] = p3[3 * k + c] + dir[c] * d;
        nrm[3 * v + c] = nrmGrid[3 * k + c];
      }
      pat[2 * v] = uv[2 * k] + nx * d;
      pat[2 * v + 1] = uv[2 * k + 1] + ny * d;
    });
  });
  const skirt = [];
  const ringIndex = (r, li) => (r < 0 ? loop[li] : gridCount + r * L + li);
  for (let r = -1; r < rings - 1; r++) {
    for (let li = 0; li < L; li++) {
      const a = ringIndex(r, li);
      const b = ringIndex(r, (li + 1) % L);
      const c = ringIndex(r + 1, li);
      const d = ringIndex(r + 1, (li + 1) % L);
      skirt.push(a, b, d, a, d, c);
    }
  }

  // Bounds of the full printed area (skirt included), then shift to the origin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < total; v++) {
    minX = Math.min(minX, pat[2 * v]);
    maxX = Math.max(maxX, pat[2 * v]);
    minY = Math.min(minY, pat[2 * v + 1]);
    maxY = Math.max(maxY, pat[2 * v + 1]);
  }
  for (let v = 0; v < total; v++) {
    pat[2 * v] -= minX;
    pat[2 * v + 1] -= minY;
  }
  const seamLoop = dedupe(loop.map((k) => [pat[2 * k], pat[2 * k + 1]]));

  let sMinY = Infinity;
  let sMaxY = -Infinity;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of seamLoop) {
    sMinY = Math.min(sMinY, y);
    sMaxY = Math.max(sMaxY, y);
    cx += x;
    cy += y;
  }
  cx /= seamLoop.length;
  cy /= seamLoop.length;
  const grainHalf = (sMaxY - sMinY) * 0.3;

  return {
    id: spec.id,
    name: spec.name,
    cut: 1,
    grid: { nu, nv },
    vertexCount: total,
    gridVertexCount: gridCount,
    positions: pos,
    normals: nrm,
    pattern: pat,
    displayIndex: Uint32Array.from(tris),
    bakeIndex: Uint32Array.from([...tris, ...skirt]),
    seamLoop,
    width: maxX - minX,
    height: maxY - minY,
    center: [cx, cy],
    grain: [
      [cx, cy - grainHalf],
      [cx, cy + grainHalf],
    ],
  };
}

export function buildPieces() {
  const front = buildPiece(torsoSpec(false));
  const back = buildPiece(torsoSpec(true));
  const sleeve = buildPiece(sleeveSpec());
  const legFront = buildPiece(lowerSpec(false));
  const legBack = buildPiece(lowerSpec(true));
  return [
    front,
    back,
    sleeve,
    mirrorPiece(sleeve, 'sleeve-right', 'Right sleeve'),
    legFront,
    mirrorPiece(legFront, 'leg-front-right', 'Right front leg'),
    legBack,
    mirrorPiece(legBack, 'leg-back-right', 'Right back leg'),
  ].map(finishPiece);
}

// Shelf-pack pieces onto a strip of fabric. Returns offsets (cm) and the fabric size.
export function layoutPieces(pieces, fabricWidth = 150, gap = 1) {
  const order = pieces.map((p, i) => i).sort((a, b) => pieces[b].height - pieces[a].height);
  const offsets = new Array(pieces.length);
  let x = gap;
  let y = gap;
  let rowH = 0;
  let usedW = 0;
  for (const i of order) {
    const p = pieces[i];
    if (x + p.width + gap > fabricWidth && x > gap) {
      x = gap;
      y += rowH + gap;
      rowH = 0;
    }
    offsets[i] = [x, y];
    x += p.width + gap;
    usedW = Math.max(usedW, x);
    rowH = Math.max(rowH, p.height);
  }
  const height = y + rowH + gap;
  // Rows were stacked top-down; convert to the y-up pattern coordinate system.
  for (let i = 0; i < pieces.length; i++) offsets[i][1] = height - offsets[i][1] - pieces[i].height;
  return { offsets, width: Math.max(usedW, fabricWidth), height };
}
