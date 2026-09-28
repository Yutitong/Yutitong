import { describe, expect, it } from 'vitest';
import { decalFrame, decalLocal, mirrorDecal } from '../src/app/decalMath.js';

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
