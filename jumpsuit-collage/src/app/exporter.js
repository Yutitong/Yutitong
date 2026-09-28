// Print-ready export: each pattern piece at true scale as a PNG (with DPI metadata)
// and an SVG (cut line, seam line, grainline in centimetres), plus a fabric layout.
import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';
import { offsetPolygon } from '../geometry/pieces.js';
import { withPhysicalSize } from './png.js';

const CM_PER_INCH = 2.54;

function bounds(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

// Pattern space is y-up; SVG/PNG are y-down. `top` is the pattern y mapped to 0.
function svgPoints(poly, left, top) {
  return poly.map(([x, y]) => `${fmt(x - left)},${fmt(top - y)}`).join(' ');
}

function pieceSvgBody(piece, cut, left, top, opts) {
  const parts = [];
  if (opts.seamLine) {
    parts.push(
      `<polygon points="${svgPoints(piece.seamLoop, left, top)}" fill="none" stroke="#d0203a" stroke-width="0.05" stroke-dasharray="0.6 0.4"/>`,
    );
  }
  if (opts.cutLine) {
    parts.push(`<polygon points="${svgPoints(cut, left, top)}" fill="none" stroke="#000" stroke-width="0.05"/>`);
  }
  if (opts.labels) {
    const [a, b] = piece.grain;
    parts.push(
      `<polyline points="${svgPoints([a, b], left, top)}" fill="none" stroke="#000" stroke-width="0.05"/>`,
      `<polyline points="${svgPoints([[b[0] - 0.8, b[1] - 1.6], b, [b[0] + 0.8, b[1] - 1.6]], left, top)}" fill="none" stroke="#000" stroke-width="0.05"/>`,
      `<text x="${fmt(piece.center[0] - left)}" y="${fmt(top - piece.center[1])}" font-family="sans-serif" font-size="1.6" text-anchor="middle">${piece.name} — cut 1</text>`,
    );
  }
  return parts.join('\n  ');
}

function drawPath(ctx, poly, toPx) {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const [x, y] = toPx(p);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

async function renderPiecePng(baker, collage, pieceIndex, rect, dpi, cut, opts) {
  const piece = baker.pieces[pieceIndex];
  const [ox, oy] = baker.layout.offsets[pieceIndex];
  const ppc = dpi / CM_PER_INCH;
  const W = Math.ceil((rect.maxX - rect.minX) * ppc);
  const H = Math.ceil((rect.maxY - rect.minY) * ppc);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`The browser could not create a ${W}×${H} canvas; try a lower DPI.`);

  const T = Math.min(4096, baker.renderer.capabilities.maxTextureSize);
  const target = new THREE.WebGLRenderTarget(T, T, {
    colorSpace: THREE.SRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const buf = new Uint8Array(T * T * 4);
  for (let ty = 0; ty < H; ty += T) {
    for (let tx = 0; tx < W; tx += T) {
      const tileCm = T / ppc;
      const x0 = rect.minX + tx / ppc + ox;
      const yTop = rect.maxY - ty / ppc + oy;
      baker.render(collage, target, [x0, yTop - tileCm, tileCm, tileCm], pieceIndex);
      baker.renderer.readRenderTargetPixels(target, 0, 0, T, T, buf);
      const w = Math.min(T, W - tx);
      const h = Math.min(T, H - ty);
      const img = ctx.createImageData(w, h);
      for (let row = 0; row < h; row++) {
        // GL rows start at the bottom of the tile.
        const src = (T - 1 - row) * T * 4;
        img.data.set(buf.subarray(src, src + w * 4), row * w * 4);
      }
      ctx.putImageData(img, tx, ty);
      await new Promise((r) => setTimeout(r)); // keep the page responsive
    }
  }
  target.dispose();

  const toPx = ([x, y]) => [(x - rect.minX) * ppc, (rect.maxY - y) * ppc];
  // Keep only the fabric inside the cut line, on white.
  ctx.globalCompositeOperation = 'destination-in';
  drawPath(ctx, cut, toPx);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  const lw = Math.max(1, 0.05 * ppc);
  if (opts.seamLine) {
    ctx.setLineDash([0.6 * ppc, 0.4 * ppc]);
    ctx.strokeStyle = 'rgba(208,32,58,0.9)';
    ctx.lineWidth = lw;
    drawPath(ctx, piece.seamLoop, toPx);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (opts.cutLine) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = lw;
    drawPath(ctx, cut, toPx);
    ctx.stroke();
  }
  if (opts.labels) {
    const [a, b] = piece.grain.map(toPx);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.moveTo(b[0] - 0.8 * ppc, b[1] + 1.6 * ppc);
    ctx.lineTo(...b);
    ctx.lineTo(b[0] + 0.8 * ppc, b[1] + 1.6 * ppc);
    ctx.stroke();
    const [cx, cy] = toPx(piece.center);
    ctx.font = `600 ${1.6 * ppc}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 0.4 * ppc;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(`${piece.name} — cut 1`, cx, cy);
    ctx.fillStyle = '#000';
    ctx.fillText(`${piece.name} — cut 1`, cx, cy);
  }
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
  return withPhysicalSize(new Uint8Array(await blob.arrayBuffer()), dpi);
}

export async function exportPattern(baker, collage, opts, onProgress = () => {}) {
  const { dpi, seamAllowance } = opts;
  const pieces = baker.pieces;
  const files = {};
  const manifest = {
    generator: 'Jumpsuit Collage',
    units: 'cm',
    dpi,
    seamAllowance,
    fabricWidth: baker.layout.width,
    pieces: [],
  };
  const margin = 0.5;
  const layoutParts = [];
  const H = baker.layout.height;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    onProgress(`Rendering ${piece.name} (${i + 1}/${pieces.length})…`, i / pieces.length);
    const cut = offsetPolygon(piece.seamLoop, seamAllowance);
    const b = bounds(cut);
    const rect = { minX: b.minX - margin, minY: b.minY - margin, maxX: b.maxX + margin, maxY: b.maxY + margin };
    const png = await renderPiecePng(baker, collage, i, rect, dpi, cut, opts);
    const w = rect.maxX - rect.minX;
    const h = rect.maxY - rect.minY;
    files[`pieces/${piece.id}.png`] = [png, { level: 0 }];
    files[`pieces/${piece.id}.svg`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(w)}cm" height="${fmt(h)}cm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">
  <title>${piece.name}</title>
  <image href="${piece.id}.png" xlink:href="${piece.id}.png" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="none"/>
  ${pieceSvgBody(piece, cut, rect.minX, rect.maxY, opts)}
</svg>
`);
    const [ox, oy] = baker.layout.offsets[i];
    layoutParts.push(
      `<g transform="translate(${fmt(rect.minX + ox)} ${fmt(H - (rect.maxY + oy))})">
    <image href="pieces/${piece.id}.png" xlink:href="pieces/${piece.id}.png" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="none"/>
    ${pieceSvgBody(piece, cut, rect.minX, rect.maxY, { ...opts, cutLine: true })}
  </g>`,
    );
    const toMm = (poly) => poly.map(([x, y]) => [+(x * 10).toFixed(2), +(y * 10).toFixed(2)]);
    manifest.pieces.push({
      id: piece.id,
      name: piece.name,
      cut: piece.cut,
      image: `pieces/${piece.id}.png`,
      imageSizeCm: [+w.toFixed(3), +h.toFixed(3)],
      note: 'Outlines are in millimetres, y axis pointing up, origin at the piece bounding box.',
      seamLineMm: toMm(piece.seamLoop),
      cutLineMm: toMm(cut),
      grainlineMm: toMm(piece.grain),
      layoutOffsetCm: baker.layout.offsets[i],
    });
  }

  onProgress('Packing files…', 0.98);
  files['layout.svg'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(baker.layout.width)}cm" height="${fmt(H)}cm" viewBox="0 0 ${fmt(baker.layout.width)} ${fmt(H)}">
  <title>Jumpsuit collage — fabric layout (${fmt(baker.layout.width)} cm wide)</title>
  <rect width="100%" height="100%" fill="#fff"/>
  ${layoutParts.join('\n  ')}
</svg>
`);
  files['pattern.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['README.txt'] = strToU8(readme(manifest, pieces));
  const zip = zipSync(files, { level: 6 });
  onProgress('Done', 1);
  return new Blob([zip], { type: 'application/zip' });
}

function readme(m, pieces) {
  return `JUMPSUIT COLLAGE — PRINT-READY PATTERN
======================================

Units: centimetres. Seam allowance (${m.seamAllowance} cm) is INCLUDED.
Print at 100% / actual size. PNGs carry ${m.dpi} DPI metadata, so
1 cm on the pattern = ${(m.dpi / 2.54).toFixed(1)} pixels.

Files
-----
pieces/<id>.png   Each piece with your collage, cut line (solid) and
                  seam line (dashed). White outside the cut line.
pieces/<id>.svg   The same piece as a true-scale SVG (image + vector lines).
layout.svg        All pieces arranged on ${m.fabricWidth} cm wide fabric,
                  ready for fabric-printing services that accept SVG.
pattern.json      Machine-readable outlines (mm) for cutting software.

Pieces (cut 1 of each — every piece carries its own artwork)
------
${pieces.map((p) => `- ${p.name.padEnd(18)} ${p.id}`).join('\n')}

Sewing order
------------
1. Sew each leg: front to back along the outer side seam and the inseam.
2. Join the legs along the crotch seam (centre front and centre back).
3. Sew bodice front to bodice back at the shoulders and side seams.
4. Sew the sleeve underarm seam, then set the sleeves into the armholes.
5. Join bodice to trousers at the waist. Finish neckline, cuffs and hems.
   Add a closure of your choice (e.g. centre-front zip or a keyhole back).
`;
}
