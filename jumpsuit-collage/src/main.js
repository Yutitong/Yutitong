import * as THREE from 'three';
import { buildPieces, layoutPieces } from './geometry/pieces.js';
import { Baker } from './render/baker.js';
import { GarmentView } from './render/garmentView.js';
import { PatternView } from './render/patternView.js';
import { builtinStickers, loadImageFile, makeAsset, textSticker } from './app/assets.js';
import { circumference, decalLocal, mirrorDecal } from './app/decalMath.js';
import { wrapAxisFor } from './app/wrapAxis.js';
import { History } from './app/history.js';
import { exportPattern } from './app/exporter.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ setup ---
const canvas = $('canvas');
const stage = $('stage');
const view3d = $('view-3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setScissorTest(true);

const pieces = buildPieces();
const layout = layoutPieces(pieces, 150);
const baker = new Baker(renderer, pieces, layout);
const garmentView = new GarmentView(renderer, view3d, pieces, layout, baker.texture);
const patternView = new PatternView($('view-pattern'), pieces, layout, baker.texture);

const state = {
  assets: new Map(),
  decals: [],
  selectedId: null,
  armedAssetId: null,
  baseColor: $('base-color').value,
};
const history = new History();
let dirty = true;
let nextDecalId = 1;

function collage(highlight = true) {
  return {
    decals: state.decals,
    assets: state.assets,
    baseColor: state.baseColor,
    highlightId: highlight ? state.selectedId : null,
  };
}

function snapshot() {
  return JSON.stringify({ decals: state.decals, baseColor: state.baseColor });
}

function restore(json) {
  const s = JSON.parse(json);
  state.decals = s.decals;
  state.baseColor = s.baseColor;
  $('base-color').value = s.baseColor;
  if (!state.decals.some((d) => d.id === state.selectedId)) state.selectedId = null;
  changed(false);
}

// Call after any edit. `commit` records an undo step.
function changed(commit = true) {
  dirty = true;
  if (commit) history.push(snapshot());
  refreshUi();
}

const selected = () => state.decals.find((d) => d.id === state.selectedId) ?? null;

// ---------------------------------------------------------------- library ---
function addAsset(source, name, arm = false) {
  const asset = makeAsset(source, name, renderer);
  state.assets.set(asset.id, asset);
  const btn = document.createElement('button');
  btn.title = `${name} — click, then click the model (or drag onto it)`;
  btn.dataset.assetId = asset.id;
  btn.draggable = true;
  const img = document.createElement('img');
  img.src = asset.thumbUrl;
  img.alt = name;
  btn.append(img);
  btn.addEventListener('click', () => {
    state.armedAssetId = state.armedAssetId === asset.id ? null : asset.id;
    refreshUi();
  });
  btn.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-asset', asset.id);
    e.dataTransfer.effectAllowed = 'copy';
  });
  $('library').append(btn);
  if (arm) state.armedAssetId = asset.id;
  refreshUi();
  return asset;
}

async function addFiles(files, arm) {
  let last = null;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      last = addAsset(await loadImageFile(file), file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      $('view-hint').textContent = err.message;
    }
  }
  if (last && arm) {
    state.armedAssetId = last.id;
    refreshUi();
  }
  return last;
}

for (const [name, c] of builtinStickers()) addAsset(c, name);

$('file-input').addEventListener('change', (e) => {
  addFiles([...e.target.files], true);
  e.target.value = '';
});
const dropzone = $('dropzone');
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  addFiles([...e.dataTransfer.files], true);
});

$('text-add').addEventListener('click', () => {
  const text = $('text-input').value.trim();
  if (!text) return;
  addAsset(textSticker(text, $('text-color').value), `“${text}”`, true);
  $('text-input').value = '';
});
$('text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('text-add').click();
});

// ------------------------------------------------------------ placement ---
function placeDecal(assetId, hit) {
  const asset = state.assets.get(assetId);
  const d = {
    id: `decal-${nextDecalId++}`,
    assetId,
    name: asset.name,
    position: hit.point,
    normal: hit.normal,
    rotation: 0,
    size: asset.aspect >= 1 ? 22 : 22 * asset.aspect,
    opacity: 1,
    flipX: false,
    depth: null,
    pieceId: hit.pieceId,
    mode: 'project',
    wrap: null,
  };
  state.decals.push(d);
  state.selectedId = d.id;
  changed();
}

// Topmost decal whose projection covers a surface point (ignores transparent pixels).
function decalAt(point) {
  for (let k = state.decals.length - 1; k >= 0; k--) {
    const d = state.decals[k];
    const asset = state.assets.get(d.assetId);
    const local = asset && decalLocal(d, asset.aspect, point);
    if (!local) continue;
    const c = asset.canvas;
    const u = d.flipX ? 1 - local[0] : local[0];
    const x = Math.min(c.width - 1, Math.floor(u * c.width));
    const y = Math.min(c.height - 1, Math.floor((1 - local[1]) * c.height));
    asset.alpha ??= c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    if (asset.alpha[(y * c.width + x) * 4 + 3] > 10) return d;
  }
  return null;
}

let drag = null;

view3d.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0) return;
    const hit = garmentView.pick(e.clientX, e.clientY);
    drag = { x: e.clientX, y: e.clientY, moved: false, hit: !!hit, decal: null };
    if (!hit) return;
    if (state.armedAssetId) {
      placeDecal(state.armedAssetId, hit);
      if (!e.shiftKey) state.armedAssetId = null;
      refreshUi();
    }
    // Prefer the current selection (even when it sits under other images) so it stays draggable.
    const sel = selected();
    const selAspect = sel && state.assets.get(sel.assetId)?.aspect;
    const d = state.armedAssetId
      ? null
      : sel && selAspect && decalLocal(sel, selAspect, hit.point)
        ? sel
        : decalAt(hit.point);
    if (d) {
      state.selectedId = d.id;
      const [sx, sy] = garmentView.project(d.position);
      drag.decal = d;
      drag.offset = [sx - e.clientX, sy - e.clientY];
      garmentView.controls.enabled = false;
      view3d.setPointerCapture(e.pointerId);
      dirty = true;
      refreshUi();
    }
  },
  { capture: true },
);

view3d.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
  if (!drag.decal || !drag.moved) return;
  const hit = garmentView.pick(e.clientX + drag.offset[0], e.clientY + drag.offset[1]);
  if (!hit) return;
  drag.decal.position = hit.point;
  drag.decal.normal = hit.normal;
  drag.decal.pieceId = hit.pieceId;
  if (drag.decal.mode === 'wrap') drag.decal.wrap = wrapAxisFor(hit.pieceId, hit.point);
  dirty = true;
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.decal && drag.moved) changed();
  if (!drag.decal && !drag.moved && !state.armedAssetId && state.selectedId) {
    state.selectedId = null;
    dirty = true;
    refreshUi();
  }
  garmentView.controls.enabled = true;
  drag = null;
});

view3d.addEventListener(
  'wheel',
  (e) => {
    const d = selected();
    if (!d || !(e.shiftKey || e.altKey)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const delta = e.deltaY || e.deltaX;
    if (e.shiftKey) d.size = clamp(d.size * Math.exp(-delta * 0.0015), 2, 150);
    else d.rotation = wrapAngle(d.rotation - Math.sign(delta) * 5);
    dirty = true;
    refreshInspector();
    scheduleCommit();
  },
  { capture: true, passive: false },
);

view3d.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
view3d.addEventListener('drop', async (e) => {
  e.preventDefault();
  const hit = garmentView.pick(e.clientX, e.clientY);
  let assetId = e.dataTransfer.getData('application/x-asset');
  if (!assetId && e.dataTransfer.files.length) assetId = (await addFiles([...e.dataTransfer.files], false))?.id;
  if (assetId && hit) placeDecal(assetId, hit);
});

let commitTimer = 0;
function scheduleCommit() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => history.push(snapshot()), 400);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrapAngle = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

// ---------------------------------------------------------- inspector ---
const sliders = {
  size: (v) => `${(+v).toFixed(1)} cm`,
  rotation: (v) => `${Math.round(v)}°`,
  opacity: (v) => `${Math.round(v * 100)}%`,
  depth: (v) => `${(+v).toFixed(1)} cm`,
};
for (const key of Object.keys(sliders)) {
  $(key).addEventListener('input', (e) => {
    const d = selected();
    if (!d) return;
    d[key] = +e.target.value;
    dirty = true;
    refreshInspector();
  });
  $(key).addEventListener('change', () => changed());
}

function withSelected(fn) {
  return () => {
    const d = selected();
    if (d) fn(d);
  };
}

$('flip').addEventListener(
  'click',
  withSelected((d) => {
    d.flipX = !d.flipX;
    changed();
  }),
);
$('mirror').addEventListener(
  'click',
  withSelected((d) => {
    const m = { ...mirrorDecal(d), id: `decal-${nextDecalId++}` };
    state.decals.push(m);
    state.selectedId = m.id;
    changed();
  }),
);
$('wrap').addEventListener('change', (e) => {
  const d = selected();
  if (!d) return;
  d.mode = e.target.checked ? 'wrap' : 'project';
  d.wrap = e.target.checked ? wrapAxisFor(d.pieceId, d.position) : null;
  changed();
});
$('fit-around').addEventListener(
  'click',
  withSelected((d) => {
    // A little over one full turn: the overlapping ends are blended into each other
    // behind the body, so the band has no visible join.
    d.size = Math.min(circumference(d) * 1.12, 150);
    changed();
  }),
);
$('duplicate').addEventListener('click', withSelected(duplicate));
$('delete').addEventListener('click', withSelected(remove));
$('forward').addEventListener('click', withSelected((d) => move(d, 1)));
$('backward').addEventListener('click', withSelected((d) => move(d, -1)));

function duplicate(d) {
  const c = { ...d, id: `decal-${nextDecalId++}`, rotation: wrapAngle(d.rotation + 12) };
  state.decals.push(c);
  state.selectedId = c.id;
  changed();
}

function remove(d) {
  state.decals = state.decals.filter((x) => x !== d);
  state.selectedId = null;
  changed();
}

function move(d, step) {
  const i = state.decals.indexOf(d);
  const j = clamp(i + step, 0, state.decals.length - 1);
  if (i === j) return;
  state.decals.splice(i, 1);
  state.decals.splice(j, 0, d);
  changed();
}

function refreshInspector() {
  const d = selected();
  $('inspector').classList.toggle('disabled', !d);
  if (!d) return;
  const wrap = d.mode === 'wrap';
  $('wrap').checked = wrap;
  $('fit-around').hidden = !wrap;
  $('depth-label').hidden = wrap;
  const values = { ...d, depth: depthOf(d) };
  for (const [key, format] of Object.entries(sliders)) {
    $(key).value = values[key];
    $(`${key}-out`).value = format(values[key]);
  }
}

function depthOf(d) {
  if (d.depth != null) return d.depth;
  const aspect = state.assets.get(d.assetId)?.aspect ?? 1;
  return clamp(Math.max(d.size, d.size / aspect) * 0.5, 4, 30);
}

function refreshUi() {
  for (const btn of $('library').children) btn.classList.toggle('armed', btn.dataset.assetId === state.armedAssetId);
  view3d.classList.toggle('placing', !!state.armedAssetId);
  $('view-hint').textContent = state.armedAssetId
    ? 'Click the jumpsuit to place the image (Shift+click to place several)'
    : 'Drag to orbit · Scroll to zoom · Click an image on the model to select it';
  const list = $('layers');
  list.replaceChildren(
    ...[...state.decals].reverse().map((d) => {
      const li = document.createElement('li');
      li.classList.toggle('selected', d.id === state.selectedId);
      const img = document.createElement('img');
      img.src = state.assets.get(d.assetId)?.thumbUrl ?? '';
      const span = document.createElement('span');
      span.textContent = d.name;
      li.append(img, span);
      li.addEventListener('click', () => {
        state.selectedId = d.id;
        dirty = true;
        refreshUi();
      });
      return li;
    }),
  );
  $('layers-empty').hidden = state.decals.length > 0;
  $('undo').disabled = !history.canUndo();
  $('redo').disabled = !history.canRedo();
  refreshInspector();
}

// ------------------------------------------------------------ top bar ---
$('undo').addEventListener('click', () => history.canUndo() && restore(history.undo()));
$('redo').addEventListener('click', () => history.canRedo() && restore(history.redo()));
$('base-color').addEventListener('input', (e) => {
  state.baseColor = e.target.value;
  dirty = true;
});
$('base-color').addEventListener('change', () => changed());
$('show-seams').addEventListener('change', (e) => garmentView.setSeamsVisible(e.target.checked));

for (const btn of document.querySelectorAll('[data-view]')) {
  if (btn.tagName !== 'BUTTON') continue;
  btn.addEventListener('click', () => {
    stage.dataset.view = btn.dataset.view;
    garmentView.needsFit = true;
    for (const b of document.querySelectorAll('.segmented button')) b.classList.toggle('active', b === btn);
  });
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    $(e.shiftKey ? 'redo' : 'undo').click();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    $('redo').click();
    return;
  }
  if (e.key === 'Escape') {
    state.armedAssetId = null;
    state.selectedId = null;
    dirty = true;
    refreshUi();
    return;
  }
  const d = selected();
  if (!d) return;
  if (e.key === 'Delete' || e.key === 'Backspace') remove(d);
  else if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicate(d);
  } else if (e.key === '[' || e.key === ']') {
    d.rotation = wrapAngle(d.rotation + (e.key === '[' ? -5 : 5));
    changed();
  } else if (e.key === '-' || e.key === '=' || e.key === '+') {
    d.size = clamp(d.size * (e.key === '-' ? 1 / 1.08 : 1.08), 2, 150);
    changed();
  }
});

// --------------------------------------------------------------- export ---
const dialog = $('export-dialog');
$('export-open').addEventListener('click', () => {
  $('export-progress').textContent = '';
  patternView.setSeamAllowance(+$('export-sa').value);
  dialog.showModal();
});
$('export-sa').addEventListener('change', (e) => patternView.setSeamAllowance(+e.target.value));
$('export-go').addEventListener('click', async (e) => {
  e.preventDefault();
  const go = $('export-go');
  go.disabled = true;
  try {
    const blob = await exportPattern(
      baker,
      collage(false),
      {
        dpi: +$('export-dpi').value,
        seamAllowance: +$('export-sa').value,
        cutLine: $('export-cut').checked,
        seamLine: $('export-seam').checked,
        labels: $('export-labels').checked,
      },
      (msg) => ($('export-progress').textContent = msg),
    );
    const size = `${(blob.size / 1e6).toFixed(1)} MB`;
    const saved = await saveFile('jumpsuit-collage-pattern.zip', blob);
    $('export-progress').textContent = saved ? `Saved (${size}).` : 'Download cancelled.';
  } catch (err) {
    console.error(err);
    $('export-progress').textContent = `Export failed: ${err.message}`;
  } finally {
    go.disabled = false;
    dirty = true;
  }
});

// When hosted as a claude.ai artifact, pages can't start downloads themselves; the
// host's save dialog is used instead. Elsewhere, fall back to a normal download.
const downloadsReady = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

async function saveFile(filename, blob) {
  const downloads = await downloadsReady;
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      return true;
    } catch (err) {
      if (err?.code === 'declined') return false;
      throw new Error(err?.message || 'The file could not be saved.');
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

// ---------------------------------------------------------------- loop ---
function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
  }
}

function renderView(view, element) {
  const r = element.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;
  const x = r.left - s.left;
  const y = s.bottom - r.bottom;
  renderer.setViewport(x, y, r.width, r.height);
  renderer.setScissor(x, y, r.width, r.height);
  view.render(renderer, r);
}

function frame() {
  resize();
  if (dirty) {
    baker.render(collage());
    dirty = false;
  }
  renderView(garmentView, view3d);
  renderView(patternView, $('view-pattern'));
  requestAnimationFrame(frame);
}

history.push(snapshot());
refreshUi();
requestAnimationFrame(frame);

// Handy for debugging and automated tests.
window.jumpsuit = { state, pieces, layout, baker, garmentView, patternView, placeDecal, changed };
