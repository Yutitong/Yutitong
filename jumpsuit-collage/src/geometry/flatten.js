// Flatten a 3D quad grid into the plane while preserving edge lengths as well as
// possible (position-based dynamics on structural + shear springs).
// Grids are row-major: index = j * nu + i, with i across (columns) and j along (rows).

export function gridTriangles(nu, nv) {
  const tris = [];
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      const b = a + 1;
      const c = a + nu;
      const d = c + 1;
      tris.push(a, b, d, a, d, c);
    }
  }
  return tris;
}

function len3(p, a, b) {
  return Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
}

// Initial layout: rows unrolled by arc length around the middle column,
// which is itself unrolled by arc length.
function initialLayout(p3, nu, nv) {
  const uv = new Float64Array(nu * nv * 2);
  const mid = Math.floor(nu / 2);
  let y = 0;
  for (let j = 0; j < nv; j++) {
    if (j > 0) y += len3(p3, (j - 1) * nu + mid, j * nu + mid);
    const base = j * nu;
    uv[2 * (base + mid)] = 0;
    uv[2 * (base + mid) + 1] = y;
    let x = 0;
    for (let i = mid + 1; i < nu; i++) {
      x += len3(p3, base + i - 1, base + i);
      uv[2 * (base + i)] = x;
      uv[2 * (base + i) + 1] = y;
    }
    x = 0;
    for (let i = mid - 1; i >= 0; i--) {
      x -= len3(p3, base + i + 1, base + i);
      uv[2 * (base + i)] = x;
      uv[2 * (base + i) + 1] = y;
    }
  }
  return uv;
}

// Banded Cholesky factorisation of a symmetric positive definite matrix stored as
// band[i * (bw + 1) + (i - j)] = a_ij for i - bw <= j <= i.
function bandCholesky(n, bw, band) {
  const w = bw + 1;
  const L = new Float64Array(n * w);
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++) {
      let sum = band[i * w + (i - j)];
      const k0 = Math.max(j0, j - bw);
      for (let k = k0; k < j; k++) sum -= L[i * w + (i - k)] * L[j * w + (j - k)];
      if (i === j) L[i * w] = Math.sqrt(Math.max(sum, 1e-12));
      else L[i * w + (i - j)] = sum / L[j * w];
    }
  }
  return (b) => {
    const y = Float64Array.from(b);
    for (let i = 0; i < n; i++) {
      let s = y[i];
      for (let k = Math.max(0, i - bw); k < i; k++) s -= L[i * w + (i - k)] * y[k];
      y[i] = s / L[i * w];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= L[k * w + (k - i)] * y[k];
      y[i] = s / L[i * w];
    }
    return y;
  };
}

// As-rigid-as-possible parameterisation (Liu et al. 2008) of a triangulated grid.
// `tris` must be wound so that the outside of the surface ends up counter-clockwise.
export function flattenGrid(p3, nu, nv, tris, iterations = 40) {
  const n = nu * nv;
  const uv = initialLayout(p3, nu, nv);
  const nt = tris.length / 3;

  // Rest shape of each triangle in its own 2D frame, plus clamped cotangent weights.
  const rest = new Float64Array(nt * 6);
  const wts = new Float64Array(nt * 3); // weight of edge (k, k+1) sits at index k
  let flipped = 0;
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
    const e1 = [0, 1, 2].map((r) => p3[3 * b + r] - p3[3 * a + r]);
    const e2 = [0, 1, 2].map((r) => p3[3 * c + r] - p3[3 * a + r]);
    const l1 = Math.hypot(...e1) || 1e-9;
    const cx = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / l1;
    const cy = Math.sqrt(Math.max(0, e2[0] ** 2 + e2[1] ** 2 + e2[2] ** 2 - cx * cx));
    const pts = [
      [0, 0],
      [l1, 0],
      [cx, cy],
    ];
    rest.set([0, 0, l1, 0, cx, cy], 6 * t);
    for (let k = 0; k < 3; k++) {
      const p = pts[k];
      const q = pts[(k + 1) % 3];
      const o = pts[(k + 2) % 3];
      const ux = p[0] - o[0];
      const uy = p[1] - o[1];
      const vx = q[0] - o[0];
      const vy = q[1] - o[1];
      const cot = (ux * vx + uy * vy) / Math.max(Math.abs(ux * vy - uy * vx), 1e-12);
      wts[3 * t + k] = Math.min(Math.max(cot, 0.05), 8) / 2;
    }
    const ax = uv[2 * b] - uv[2 * a];
    const ay = uv[2 * b + 1] - uv[2 * a + 1];
    const bx = uv[2 * c] - uv[2 * a];
    const by = uv[2 * c + 1] - uv[2 * a + 1];
    if (ax * by - ay * bx < 0) flipped++;
  }
  // The initial unrolling may be mirrored relative to the winding; rotations cannot fix that.
  if (flipped > nt / 2) for (let k = 0; k < n; k++) uv[2 * k] = -uv[2 * k];

  const bw = nu + 1;
  const band = new Float64Array(n * (bw + 1));
  const addBand = (i, j, v) => {
    if (i < j) [i, j] = [j, i];
    band[i * (bw + 1) + (i - j)] += v;
  };
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const i = tris[3 * t + k];
      const j = tris[3 * t + ((k + 1) % 3)];
      const w = wts[3 * t + k];
      addBand(i, i, w);
      addBand(j, j, w);
      addBand(i, j, -w);
    }
  }
  const pin = 0;
  const pinW = 1;
  const pinX = uv[0];
  const pinY = uv[1];
  addBand(pin, pin, pinW);
  const solve = bandCholesky(n, bw, band);

  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    bx.fill(0);
    by.fill(0);
    for (let t = 0; t < nt; t++) {
      const idx = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
      // Local step: best rotation mapping the rest triangle onto the current one.
      let s00 = 0;
      let s01 = 0;
      let s10 = 0;
      let s11 = 0;
      for (let k = 0; k < 3; k++) {
        const i = idx[k];
        const j = idx[(k + 1) % 3];
        const w = wts[3 * t + k];
        const ux = uv[2 * i] - uv[2 * j];
        const uy = uv[2 * i + 1] - uv[2 * j + 1];
        const xx = rest[6 * t + 2 * k] - rest[6 * t + 2 * ((k + 1) % 3)];
        const xy = rest[6 * t + 2 * k + 1] - rest[6 * t + 2 * ((k + 1) % 3) + 1];
        s00 += w * ux * xx;
        s01 += w * ux * xy;
        s10 += w * uy * xx;
        s11 += w * uy * xy;
      }
      const ang = Math.atan2(s10 - s01, s00 + s11);
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      for (let k = 0; k < 3; k++) {
        const i = idx[k];
        const j = idx[(k + 1) % 3];
        const w = wts[3 * t + k];
        const xx = rest[6 * t + 2 * k] - rest[6 * t + 2 * ((k + 1) % 3)];
        const xy = rest[6 * t + 2 * k + 1] - rest[6 * t + 2 * ((k + 1) % 3) + 1];
        const rx = w * (cs * xx - sn * xy);
        const ry = w * (sn * xx + cs * xy);
        bx[i] += rx;
        by[i] += ry;
        bx[j] -= rx;
        by[j] -= ry;
      }
    }
    bx[pin] += pinW * pinX;
    by[pin] += pinW * pinY;
    const sx = solve(bx);
    const sy = solve(by);
    for (let k = 0; k < n; k++) {
      uv[2 * k] = sx[k];
      uv[2 * k + 1] = sy[k];
    }
  }
  return uv;
}

// Relative edge-length error statistics of a flattening (for tests / diagnostics).
export function strainStats(p3, uv, tris) {
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e];
      const b = tris[t + ((e + 1) % 3)];
      const l3 = len3(p3, a, b);
      const l2 = Math.hypot(uv[2 * a] - uv[2 * b], uv[2 * a + 1] - uv[2 * b + 1]);
      if (l3 < 1e-9) continue;
      const s = Math.abs(l2 - l3) / l3;
      max = Math.max(max, s);
      sum += s;
      count++;
    }
  }
  return { max, mean: sum / count };
}
