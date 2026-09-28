import { describe, expect, it } from 'vitest';
import { wrapAxisFor } from '../src/app/wrapAxis.js';

describe('wrap axis selection', () => {
  it('wraps sleeves around their own arm', () => {
    const l = wrapAxisFor('sleeve-left', [30, 110, 0]);
    const r = wrapAxisFor('sleeve-right', [-30, 110, 0]);
    expect(l.side).toBe(0);
    expect(r.origin[0]).toBeCloseTo(-l.origin[0]);
    expect(r.dir[0]).toBeCloseTo(-l.dir[0]);
  });

  it('wraps a single leg below the hips and the whole body above', () => {
    const leg = wrapAxisFor('leg-front-right', [-15, 30, 8]);
    expect(leg.side).toBe(-1);
    expect(leg.origin[0]).toBeLessThan(0);
    const hips = wrapAxisFor('leg-front-right', [-15, 90, 8]);
    expect(hips.origin).toEqual([0, 0, 0]);
    expect(hips.side).toBe(0);
  });
});
