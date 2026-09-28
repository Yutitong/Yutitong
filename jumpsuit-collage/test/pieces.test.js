import { describe, expect, it } from 'vitest';
import { ARMHOLE_X } from '../src/geometry/body.js';
import { strainStats } from '../src/geometry/flatten.js';
import { buildPieces, layoutPieces, offsetPolygon, signedArea } from '../src/geometry/pieces.js';

const pieces = buildPieces();
const byId = Object.fromEntries(pieces.map((p) => [p.id, p]));

// 2D (pattern) length of a polyline through grid vertices.
function patternLength(piece, indices) {
  let l = 0;
  for (let k = 1; k < indices.length; k++) {
    const a = indices[k - 1];
    const b = indices[k];
    l += Math.hypot(piece.pattern[2 * a] - piece.pattern[2 * b], piece.pattern[2 * a + 1] - piece.pattern[2 * b + 1]);
  }
  return l;
}
const row = (p, j) => Array.from({ length: p.grid.nu }, (_, i) => j * p.grid.nu + i);
const col = (p, i) => Array.from({ length: p.grid.nv }, (_, j) => j * p.grid.nu + i);
const x3 = (p, k) => p.positions[3 * k];

describe('pattern pieces', () => {
  it('builds the eight pieces of a jumpsuit', () => {
    expect(pieces.map((p) => p.id).sort()).toEqual(
      [
        'bodice-back',
        'bodice-front',
        'leg-back-left',
        'leg-back-right',
        'leg-front-left',
        'leg-front-right',
        'sleeve-left',
        'sleeve-right',
      ].sort(),
    );
  });

  it.each(pieces.map((p) => [p.id, p]))('%s flattens without folds and with low distortion', (_, p) => {
    const tris = p.displayIndex;
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      const P = p.pattern;
      const area = (P[2 * b] - P[2 * a]) * (P[2 * c + 1] - P[2 * a + 1]) - (P[2 * b + 1] - P[2 * a + 1]) * (P[2 * c] - P[2 * a]);
      expect(area).toBeGreaterThan(0);
    }
    const s = strainStats(p.positions, p.pattern, Array.from(tris));
    expect(s.mean).toBeLessThan(0.02);
    expect(signedArea(p.seamLoop)).toBeGreaterThan(0);
  });

  it('matches side seam lengths of the bodice front and back', () => {
    const f = byId['bodice-front'];
    const b = byId['bodice-back'];
    // Front column nu-1 and back column 0 are both on the wearer's left side (x > 0).
    expect(x3(f, f.grid.nu - 1)).toBeGreaterThan(0);
    expect(x3(b, 0)).toBeGreaterThan(0);
    const lf = patternLength(f, col(f, f.grid.nu - 1));
    const lb = patternLength(b, col(b, 0));
    expect(Math.abs(lf - lb) / lf).toBeLessThan(0.02);
  });

  it('matches trouser outseams and inseams between front and back', () => {
    const f = byId['leg-front-left'];
    const b = byId['leg-back-left'];
    const out = [patternLength(f, col(f, 0)), patternLength(b, col(b, 0))];
    const inn = [patternLength(f, col(f, f.grid.nu - 1)), patternLength(b, col(b, b.grid.nu - 1))];
    expect(Math.abs(out[0] - out[1]) / out[0]).toBeLessThan(0.02);
    // Inner edges share the inseam; the back crotch is deeper, so compare below the crotch only.
    const below = (p) => col(p, p.grid.nu - 1).filter((k) => p.positions[3 * k + 1] <= 72 + 1e-9);
    const i0 = patternLength(f, below(f));
    const i1 = patternLength(b, below(b));
    expect(Math.abs(i0 - i1) / i0).toBeLessThan(0.02);
    expect(inn[1]).toBeGreaterThan(inn[0]); // longer back crotch curve
  });

  it('matches the waist seam of bodice and trousers', () => {
    const f = byId['bodice-front'];
    const bodice = patternLength(f, row(f, 0));
    const legs = ['leg-front-left', 'leg-front-right'].map((id) => {
      const p = byId[id];
      return patternLength(p, row(p, p.grid.nv - 1));
    });
    expect(Math.abs(bodice - (legs[0] + legs[1])) / bodice).toBeLessThan(0.02);
  });

  it('gives the sleeve cap a normal amount of ease over the armhole', () => {
    const armhole = ['bodice-front', 'bodice-back']
      .map((id) => {
        const p = byId[id];
        const top = row(p, p.grid.nv - 1).filter((k) => Math.abs(x3(p, k) - ARMHOLE_X) < 0.01);
        return patternLength(p, top);
      })
      .reduce((a, b) => a + b);
    const s = byId['sleeve-left'];
    const cap = patternLength(s, row(s, 0));
    expect(armhole).toBeGreaterThan(35);
    // Flattening the rounded cap lengthens it slightly: that is ordinary cap ease
    // (typically 2-4 cm), eased in when setting the sleeve.
    expect(cap).toBeGreaterThanOrEqual(armhole);
    expect(cap - armhole).toBeLessThan(4);
  });

  it('keeps pieces upright (grainline along the garment vertical)', () => {
    for (const id of ['bodice-front', 'leg-front-left', 'leg-back-right']) {
      const p = byId[id];
      const topRow = row(p, p.grid.nv - 1);
      const bottomRow = row(p, 0);
      const avgY = (idx) => idx.reduce((s, k) => s + p.pattern[2 * k + 1], 0) / idx.length;
      expect(avgY(topRow)).toBeGreaterThan(avgY(bottomRow));
    }
    const s = byId['sleeve-left'];
    const capY = row(s, 0).reduce((a, k) => a + s.pattern[2 * k + 1], 0);
    const cuffY = row(s, s.grid.nv - 1).reduce((a, k) => a + s.pattern[2 * k + 1], 0);
    expect(capY).toBeGreaterThan(cuffY);
  });

  it('mirrors left and right pieces', () => {
    const l = byId['sleeve-left'];
    const r = byId['sleeve-right'];
    expect(r.width).toBeCloseTo(l.width, 6);
    expect(r.height).toBeCloseTo(l.height, 6);
    expect(x3(r, 5)).toBeCloseTo(-x3(l, 5), 9);
  });

  it('packs the pieces onto the fabric without overlap', () => {
    const L = layoutPieces(pieces, 150);
    const boxes = pieces.map((p, i) => [L.offsets[i][0], L.offsets[i][1], p.width, p.height]);
    for (const [x, y, w, h] of boxes) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(L.width);
      expect(y + h).toBeLessThanOrEqual(L.height);
    }
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        const [ax, ay, aw, ah] = boxes[a];
        const [bx, by, bw, bh] = boxes[b];
        expect(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay).toBe(true);
      }
  });

  it('offsets the seam line outward to make the cut line', () => {
    const p = byId['bodice-front'];
    const cut = offsetPolygon(p.seamLoop, 1.5);
    expect(signedArea(cut)).toBeGreaterThan(signedArea(p.seamLoop));
  });
});
