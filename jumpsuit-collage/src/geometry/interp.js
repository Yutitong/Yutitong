// Monotone cubic (PCHIP / Fritsch–Carlson) interpolation through keyframes.
// Used for all body profiles so shapes are smooth and never overshoot.
export function pchip(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const n = xs.length;
  const h = [];
  const delta = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h[i] * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h[i] * m[i + 1]
    );
  };
}

// Find x in [lo, hi] with f(x) = target, f monotone on the interval.
export function solveMonotone(f, target, lo, hi, iterations = 60) {
  const increasing = f(hi) > f(lo);
  for (let k = 0; k < iterations; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target === increasing) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
