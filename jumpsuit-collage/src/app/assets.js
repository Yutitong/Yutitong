// Image library: built-in procedural stickers, uploaded images and text stickers.
import * as THREE from 'three';

const MAX_SIZE = 2048;
let counter = 0;

export function makeAsset(source, name, renderer) {
  const w = source.naturalWidth ?? source.width;
  const h = source.naturalHeight ?? source.height;
  let canvas = source;
  const scale = Math.min(1, MAX_SIZE / Math.max(w, h));
  if (scale < 1 || !(source instanceof HTMLCanvasElement)) {
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const thumb = document.createElement('canvas');
  const ts = 160 / Math.max(canvas.width, canvas.height);
  thumb.width = Math.max(1, Math.round(canvas.width * ts));
  thumb.height = Math.max(1, Math.round(canvas.height * ts));
  thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return {
    id: `asset-${++counter}`,
    name,
    canvas,
    texture,
    aspect: canvas.width / canvas.height,
    thumbUrl: thumb.toDataURL(),
  };
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}`));
    };
    img.src = url;
  });
}

export function textSticker(text, color, font = 'Impact, "Arial Black", sans-serif') {
  const size = 200;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${size}px ${font}`;
  const lines = text.split('\n');
  const width = Math.max(...lines.map((l) => measure.measureText(l).width)) + size * 0.3;
  const c = document.createElement('canvas');
  c.width = Math.ceil(width);
  c.height = Math.ceil(size * 1.15 * lines.length + size * 0.25);
  const ctx = c.getContext('2d');
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, c.width / 2, size * (0.7 + 1.15 * i)));
  return c;
}

// ------------------------------------------------------------ built-ins ---
const PALETTE = ['#ff5a36', '#ffc933', '#2b6cff', '#16a67a', '#ff7eb6', '#1d1d1f', '#7a4dff', '#f4efe6'];

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function sunburst() {
  const [c, ctx] = canvas(512);
  ctx.translate(256, 256);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = i % 2 ? PALETTE[1] : PALETTE[0];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 250, (i * Math.PI) / 12, ((i + 1) * Math.PI) / 12);
    ctx.fill();
  }
  ctx.fillStyle = PALETTE[7];
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function checker() {
  const [c, ctx] = canvas(512);
  const n = 8;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? PALETTE[5] : PALETTE[7];
      ctx.fillRect((x * 512) / n, (y * 512) / n, 512 / n, 512 / n);
    }
  return c;
}

function stripes() {
  const [c, ctx] = canvas(512);
  const colors = [PALETTE[2], PALETTE[7], PALETTE[4], PALETTE[7]];
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(0, i * 32, 512, 32);
  }
  return c;
}

function flower() {
  const [c, ctx] = canvas(512);
  ctx.translate(256, 256);
  ctx.fillStyle = PALETTE[4];
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.ellipse(0, -130, 70, 120, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = PALETTE[1];
  ctx.beginPath();
  ctx.arc(0, 0, 80, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function dots() {
  const [c, ctx] = canvas(512);
  ctx.fillStyle = PALETTE[3];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const cx = x * 32 + 16 + (y % 2) * 16;
      const cy = y * 32 + 16;
      const r = 4 + 10 * (1 - Math.hypot(cx - 256, cy - 256) / 362);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  return c;
}

function waves() {
  const [c, ctx] = canvas(512, 256);
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  [PALETTE[2], PALETTE[0], PALETTE[1]].forEach((col, k) => {
    ctx.strokeStyle = col;
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 4) {
      const y = 70 + k * 58 + Math.sin(x / 40 + k) * 26;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  return c;
}

function paperScrap() {
  const [c, ctx] = canvas(512, 384);
  const r = rng(7);
  ctx.beginPath();
  const pts = [];
  const edge = (x0, y0, x1, y1) => {
    for (let t = 0; t < 1; t += 0.04) {
      const j = (r() - 0.5) * 18;
      pts.push([x0 + (x1 - x0) * t + (y1 !== y0 ? j : 0), y0 + (y1 - y0) * t + (x1 !== x0 ? j : 0)]);
    }
  };
  edge(20, 20, 492, 20);
  edge(492, 20, 492, 364);
  edge(492, 364, 20, 364);
  edge(20, 364, 20, 20);
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = '#e9dcc3';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(43,108,255,0.45)';
  ctx.lineWidth = 3;
  for (let y = 60; y < 384; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,90,54,0.6)';
  ctx.beginPath();
  ctx.moveTo(80, 0);
  ctx.lineTo(80, 384);
  ctx.stroke();
  ctx.restore();
  return c;
}

function star() {
  const [c, ctx] = canvas(512);
  ctx.translate(256, 262);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? 105 : 245;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = PALETTE[6];
  ctx.fill();
  return c;
}

export function builtinStickers() {
  return [
    ['Sunburst', sunburst()],
    ['Checker', checker()],
    ['Stripes', stripes()],
    ['Flower', flower()],
    ['Dots', dots()],
    ['Waves', waves()],
    ['Paper scrap', paperScrap()],
    ['Star', star()],
  ];
}
