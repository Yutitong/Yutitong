// On-model handles for the selected image: drag a corner to resize, drag the round
// handle above it to rotate. Drawn as an SVG overlay on top of the 3D view.
import { decalFacing, decalPoint } from './decalMath.js';

const SVG = 'http://www.w3.org/2000/svg';
const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const ROTATE_GAP = 34; // px between the image's top edge and the rotate handle
export const MIN_SIZE = 1;
export const MAX_SIZE = 250;

function el(name, attrs, parent) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

export class HandleOverlay {
  // `app` supplies: selected(), aspectOf(decal), onChange(), onCommit(), onInfo(text|null)
  constructor(container, view, app) {
    this.container = container;
    this.view = view;
    this.app = app;
    this.svg = el('svg', { class: 'handles' }, container);
    this.frame = el('polygon', { class: 'handle-frame' }, this.svg);
    this.stem = el('line', { class: 'handle-stem' }, this.svg);
    this.corners = CORNERS.map((c) => {
      const h = el('circle', { class: 'handle handle-scale', r: 7 }, this.svg);
      h.style.cursor = c[0] === c[1] ? 'nesw-resize' : 'nwse-resize';
      this.bind(h, 'scale');
      return h;
    });
    this.rotor = el('g', { class: 'handle handle-rotate' }, this.svg);
    el('circle', { r: 11 }, this.rotor);
    el('path', { d: 'M -5 -2 A 5 5 0 1 1 -2 5 M -5 -2 L -5.5 -6.5 M -5 -2 L -1 -3', fill: 'none' }, this.rotor);
    this.bind(this.rotor, 'rotate');
    this.active = null;
  }

  // Screen position relative to the overlay.
  toLocal(p) {
    const [x, y] = this.view.project(p);
    const r = this.container.getBoundingClientRect();
    return [x - r.left, y - r.top];
  }

  update() {
    const d = this.app.selected();
    const aspect = d && this.app.aspectOf(d);
    let visible = !!(d && aspect);
    if (visible && !this.active) {
      // Hide when the image faces away from the camera (it is behind the body).
      const n = decalFacing(d, aspect);
      const cam = this.view.camera.position;
      const c = d.position;
      const to = [cam.x - c[0], cam.y - c[1], cam.z - c[2]];
      const l = Math.hypot(...to);
      visible = (n[0] * to[0] + n[1] * to[1] + n[2] * to[2]) / l > 0.15;
    }
    this.svg.style.display = visible ? '' : 'none';
    if (!visible) return;
    const pts = CORNERS.map(([u, v]) => this.toLocal(decalPoint(d, aspect, u, v)));
    // Trace the outline along the surface so it follows wrapped (curved) images.
    const outline = [];
    CORNERS.forEach(([u0, v0], i) => {
      const [u1, v1] = CORNERS[(i + 1) % 4];
      for (let k = 0; k < 16; k++) {
        const t = k / 16;
        outline.push(this.toLocal(decalPoint(d, aspect, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t)));
      }
    });
    this.frame.setAttribute('points', outline.map((p) => p.join(',')).join(' '));
    pts.forEach((p, i) => {
      this.corners[i].setAttribute('cx', p[0]);
      this.corners[i].setAttribute('cy', p[1]);
    });
    const center = this.toLocal(d.position);
    const top = this.toLocal(decalPoint(d, aspect, 0.5, 1));
    let dx = top[0] - center[0];
    let dy = top[1] - center[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const knob = [top[0] + dx * ROTATE_GAP, top[1] + dy * ROTATE_GAP];
    this.stem.setAttribute('x1', top[0]);
    this.stem.setAttribute('y1', top[1]);
    this.stem.setAttribute('x2', knob[0]);
    this.stem.setAttribute('y2', knob[1]);
    this.rotor.setAttribute('transform', `translate(${knob[0]} ${knob[1]})`);
  }

  bind(handle, kind) {
    handle.addEventListener('pointerdown', (e) => {
      const d = this.app.selected();
      if (!d || e.button !== 0) return;
      // Keep the camera controls and the model's own drag logic out of this gesture.
      e.stopPropagation();
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const [cx, cy] = this.view.project(d.position);
      this.active = {
        kind,
        decal: d,
        cx,
        cy,
        size0: d.size,
        rot0: d.rotation,
        dist0: Math.max(Math.hypot(e.clientX - cx, e.clientY - cy), 1),
        ang0: Math.atan2(-(e.clientY - cy), e.clientX - cx),
      };
      this.container.classList.add(kind === 'scale' ? 'scaling' : 'rotating');
    });
    handle.addEventListener('pointermove', (e) => {
      const a = this.active;
      if (!a) return;
      if (a.kind === 'scale') {
        const dist = Math.hypot(e.clientX - a.cx, e.clientY - a.cy);
        const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, (a.size0 * dist) / a.dist0));
        a.decal.size = Math.round(size * 10) / 10;
        this.app.onInfo(`${a.decal.size.toFixed(1)} cm wide`);
      } else {
        const ang = Math.atan2(-(e.clientY - a.cy), e.clientX - a.cx);
        let rot = a.rot0 + ((ang - a.ang0) * 180) / Math.PI;
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        rot = ((((rot + 180) % 360) + 360) % 360) - 180;
        a.decal.rotation = Math.round(rot * 10) / 10;
        this.app.onInfo(`${Math.round(a.decal.rotation)}°${e.shiftKey ? '' : ' · hold Shift to snap to 15°'}`);
      }
      this.app.onChange();
    });
    const end = () => {
      if (!this.active) return;
      this.active = null;
      this.container.classList.remove('scaling', 'rotating');
      this.app.onInfo(null);
      this.app.onCommit();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}
