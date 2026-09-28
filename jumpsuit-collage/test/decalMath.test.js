import { describe, expect, it } from 'vitest';
import { circumference, decalFrame, decalLocal, decalPoint, mirrorDecal } from '../src/app/decalMath.js';

const base = { position: [5, 110, 12], normal: [0.3, 0, 1], rotation: 20, size: 20, flipX: false };

describe('decal projection', () => {
  it('builds an orthonormal frame', () => {
    const f = decalFrame(base, 2);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(f.right, f.up)).toBeCloseTo(0);
    expect(dot(f.right, f.normal)).toBeCloseTo(0);
    expect(dot(f.up, f.normal)).toBeCloseTo(0);
    expect(f.height).toBeCloseTo(10);
  });

  it('maps the centre to the middle of the image', () => {
    expect(decalLocal(base, 1, base.position)).toEqual([0.5, 0.5]);
    expect(decalLocal(base, 1, [200, 0, 0])).toBeNull();
  });

  it('mirror copies show the same image pixel at mirrored points', () => {
    const m = mirrorDecal(base);
    const p = [9, 113, 11];
    const q = [-9, 113, 11];
    const a = decalLocal(base, 1, p);
    const b = decalLocal(m, 1, q);
    // Account for flipX when sampling the image.
    const sample = (d, l) => [d.flipX ? 1 - l[0] : l[0], l[1]];
    expect(sample(m, b)[0]).toBeCloseTo(sample(base, a)[0]);
    expect(sample(m, b)[1]).toBeCloseTo(sample(base, a)[1]);
  });

  it('keeps a stable frame on horizontal surfaces', () => {
    const f = decalFrame({ ...base, normal: [0, 1, 0], rotation: 0 }, 1);
    expect(f.up[2]).toBeCloseTo(-1);
  });
});

describe('wrap-around images', () => {
  const leg = {
    position: [15, 40, 10],
    normal: [0, 0, 1],
    rotation: 0,
    size: 20,
    flipX: false,
    mode: 'wrap',
    wrap: { origin: [15, 0, 0], dir: [0, 1, 0], side: 1 },
  };

  it('winds around the axis: arc length maps to image width', () => {
    // Quarter turn toward the wearer's left (+x) at radius 10 is 2*pi*10/4 cm along the image.
    const p = [25, 40, 0];
    const [lx, ly] = decalLocal({ ...leg, size: 40 }, 1, p);
    expect(lx).toBeCloseTo(0.5 + (Math.PI * 5) / 40);
    expect(ly).toBeCloseTo(0.5);
  });

  it('covers the full circumference when fitted around, continuing behind the leg', () => {
    const d = { ...leg, size: circumference(leg) };
    expect(d.size).toBeCloseTo(2 * Math.PI * 10);
    // Points all the way round, including the back (behind the side seams), are covered.
    for (let a = -3.1; a <= 3.1; a += 0.2) {
      const p = [15 + 10 * Math.sin(a), 40, 10 * Math.cos(a)];
      const local = decalLocal(d, 4, p);
      expect(local).not.toBeNull();
      expect(local[0]).toBeCloseTo(0.5 + a / (2 * Math.PI));
    }
  });

  it('ignores points far from the axis (e.g. the other leg)', () => {
    expect(decalLocal(leg, 1, [-15, 40, 10])).toBeNull();
  });

  it('mirrors onto the opposite limb', () => {
    const m = mirrorDecal(leg);
    expect(m.wrap.origin[0]).toBe(-15);
    expect(m.wrap.side).toBe(-1);
    const a = decalLocal(leg, 1, [20, 44, 8.66]);
    const b = decalLocal(m, 1, [-20, 44, 8.66]);
    expect(1 - b[0]).toBeCloseTo(a[0]); // flipX is toggled on the copy
    expect(b[1]).toBeCloseTo(a[1]);
  });
});

describe('handle positions', () => {
  const wrapped = {
    position: [15, 40, 10],
    normal: [0, 0, 1],
    rotation: 30,
    size: 20,
    flipX: false,
    mode: 'wrap',
    wrap: { origin: [15, 0, 0], dir: [0, 1, 0], side: 1 },
  };
  it.each([
    ['projected', base],
    ['wrapped', wrapped],
  ])('%s corners map back to the image corners', (_, d) => {
    for (const [u, v] of [
      [0.001, 0.001],
      [0.999, 0.001],
      [0.999, 0.999],
      [0.5, 0.999],
    ]) {
      const p = decalPoint(d, 1.5, u, v);
      const local = decalLocal(d, 1.5, p);
      expect(local[0]).toBeCloseTo(u, 6);
      expect(local[1]).toBeCloseTo(v, 6);
    }
  });
});
