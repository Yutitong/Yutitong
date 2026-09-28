import { describe, expect, it } from 'vitest';
import { crc32, withPhysicalSize } from '../src/app/png.js';
import { History } from '../src/app/history.js';

// Minimal 1x1 PNG (signature, IHDR, IDAT, IEND).
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

describe('png', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('inserts a pHYs chunk with the requested DPI', () => {
    const out = withPhysicalSize(PNG, 150);
    const dv = new DataView(out.buffer);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    expect(dv.getUint32(41)).toBe(Math.round(150 / 0.0254));
    expect(out[49]).toBe(1);
    expect(dv.getUint32(50)).toBe(crc32(out.subarray(37, 50)));
    // Idempotent: re-applying replaces rather than duplicates.
    const again = withPhysicalSize(out, 300);
    expect(again.length).toBe(out.length);
  });
});

describe('history', () => {
  it('undoes and redoes snapshots', () => {
    const h = new History();
    h.push('a');
    h.push('b');
    h.push('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toBe('b');
    h.push('d');
    expect(h.canRedo()).toBe(false);
  });
});
