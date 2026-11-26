import { SFX } from '../audio.js';
import {
  defaultSceneryLayer,
  isGearType,
  SCENERY_DRIFTS,
  SCENERY_MAX_LAYERS,
  SCENERY_PALETTE
} from '../constants.js';
import {
  audioPopover,
  closeSceneryBtn,
  closeSceneryX,
  openSceneryBtn,
  physMenuBtn,
  physPopover,
  pixoPopover,
  scAddLayerBtn,
  scAlphaCanvas,
  scAlphaCtx,
  scAlphaVal,
  scAlphaWrap,
  scAtmoNote,
  scAutoScaleCheck,
  scCanvas,
  scCanvasFrame,
  scClearBtn,
  scColorSwatch,
  scCoordEl,
  scCtx,
  scCtxHint,
  scCtxInfo,
  scCtxPoly,
  scCtxStamp,
  scDepthBadge,
  scDepthSlider,
  scDepthVal,
  scDriftSelect,
  sceneryModal,
  scHeightSlider,
  scHeightVal,
  scHexInput,
  scHueCanvas,
  scHueCtx,
  scHueWrap,
  scLayerCountPill,
  scLayerList,
  scLayerProps,
  scOpacitySlider,
  scOpacityVal,
  scPaletteGrid,
  scPickSkyBtn,
  scPolyCancelBtn,
  scPolyFinishBtn,
  scPolyHint,
  scPreviewBtn,
  scRedoBtn,
  scShiftLBtn,
  scShiftRBtn,
  scSizeGroup,
  scSkyChip,
  scSoloBtn,
  scStampFlipBtn,
  scStampScaleGroup,
  scStampStrip,
  scStatusMsg,
  scSvCanvas,
  scSvCtx,
  scSvWrap,
  scTileXCheck,
  scTintSlider,
  scTintVal,
  scToolGroup,
  scUndoBtn,
  scWorldPill,
  showToast
} from '../dom.js';
import {
  computeAtmosphericTintStrength,
  drawScenerySkyBackdrop,
  getSceneryLayerRawCanvas,
  getTintedSceneryLayerCanvas,
  invalidateSceneryLayerCache,
  renderSceneryComposite,
  sampleWorldSkyColor,
  syncSceneryLayerCanvasFromPixels
} from '../farback.js';
import { getActiveWorld, getSpriteById, state } from '../state.js';
import { decodeFrame, encodeFrame, saveWorldsNow, scheduleWorldAutoSave } from '../storage.js';
import { clamp, hexToRgb, hsvToRgb, normalizeHex, rgbaToHex, rgbToHsv } from '../utils.js';
import { closeOpenCustomSelect, syncCustomSelect } from './selects.js';

/* =========================================================================
   WORLD SCENERY STUDIO UI & WIDE-CANVAS PIXEL/POLYGON/LASSO/STAMP ENGINE
   ========================================================================= */

const W = 240;
const H = 120;
const DISP_SCALE = 3; // 240x120 logical px -> 720x360 crisp display canvas
const MAX_UNDO = 30;
const STAGGER_DEPTHS = [0.12, 0.24, 0.38, 0.54, 0.18, 0.46];

const sc = {
  activeLayerId: null,
  activePixels: null,
  tool: 'brush',       // 'brush' | 'eraser' | 'poly' | 'lasso' | 'fill' | 'line' | 'pick' | 'stamp'
  brushSize: 4,
  solo: false,
  preview: false,
  previewCamX: 0,
  previewCamY: 0,
  previewDragging: false,
  previewDragStartX: 0,
  previewDragStartY: 0,
  previewOriginX: 0,
  previewOriginY: 0,
  color: '#4c6588',
  alpha: 1,
  hsv: { h: 215, s: 0.44, v: 0.53 },
  drawing: false,
  drawBtn: 0,
  startX: 0,
  startY: 0,
  lastX: -1,
  lastY: -1,
  hoverX: -1,
  hoverY: -1,
  strokeSnap: null,
  polyPoints: [],
  lassoPoints: [],
  stampSpriteId: null,
  stampScale: 1,
  stampFlip: false,
  undoStack: [],
  redoStack: []
};

function ensureWorldScenery(world) {
  if (!world) return { layers: [] };
  if (!world.scenery || typeof world.scenery !== 'object' || !Array.isArray(world.scenery.layers)) {
    world.scenery = { layers: [] };
  }
  return world.scenery;
}

function getLayers() {
  const world = getActiveWorld();
  return ensureWorldScenery(world).layers;
}

function getActiveLayer() {
  const layers = getLayers();
  if (layers.length === 0) return null;
  let found = layers.find(l => l.id === sc.activeLayerId);
  if (!found) {
    found = layers[layers.length - 1];
    sc.activeLayerId = found.id;
  }
  return found;
}

function setStatus(msg) {
  if (scStatusMsg) scStatusMsg.textContent = String(msg || '').toUpperCase();
}

function depthTierLabel(d) {
  if (d <= 0.14) return 'HORIZON';
  if (d <= 0.28) return 'FAR';
  if (d <= 0.44) return 'MID';
  return 'NEAR';
}

function loadActiveLayerPixels() {
  const layer = getActiveLayer();
  if (!layer) {
    sc.activePixels = null;
    return;
  }
  sc.activePixels = decodeFrame(layer.pixels, W, H);
  syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
}

function pushUndoSnapshot(pixelsSnapshot = null) {
  const layer = getActiveLayer();
  if (!layer) return;
  const snap = pixelsSnapshot || (sc.activePixels ? sc.activePixels.slice() : null);
  if (!snap) return;
  sc.undoStack.push({ layerId: layer.id, pixels: snap });
  if (sc.undoStack.length > MAX_UNDO) sc.undoStack.shift();
  sc.redoStack.length = 0;
  updateUndoRedoButtons();
}

function commitActivePixels(persist = true) {
  const layer = getActiveLayer();
  if (!layer || !sc.activePixels) return;
  layer.pixels = encodeFrame(sc.activePixels);
  syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
  refreshLayerThumb(layer);
  if (persist) scheduleWorldAutoSave(true);
}

function updateUndoRedoButtons() {
  if (scUndoBtn) scUndoBtn.classList.toggle('disabled-soft', sc.undoStack.length === 0);
  if (scRedoBtn) scRedoBtn.classList.toggle('disabled-soft', sc.redoStack.length === 0);
}

function doSceneryUndo() {
  if (sc.undoStack.length === 0) {
    SFX.playError();
    setStatus('NOTHING TO UNDO');
    return;
  }
  const entry = sc.undoStack.pop();
  const layers = getLayers();
  const target = layers.find(l => l.id === entry.layerId);
  if (!target) {
    updateUndoRedoButtons();
    return;
  }
  const currentPx = (sc.activeLayerId === target.id && sc.activePixels)
    ? sc.activePixels.slice()
    : decodeFrame(target.pixels, W, H);
  sc.redoStack.push({ layerId: target.id, pixels: currentPx });
  sc.activeLayerId = target.id;
  sc.activePixels = entry.pixels.slice();
  sc.polyPoints.length = 0;
  sc.lassoPoints.length = 0;
  commitActivePixels(true);
  renderLayerList();
  syncLayerPropsUI();
  renderSceneryStudioCanvas();
  updateUndoRedoButtons();
  setStatus('UNDID STROKE');
}

function doSceneryRedo() {
  if (sc.redoStack.length === 0) {
    SFX.playError();
    setStatus('NOTHING TO REDO');
    return;
  }
  const entry = sc.redoStack.pop();
  const layers = getLayers();
  const target = layers.find(l => l.id === entry.layerId);
  if (!target) {
    updateUndoRedoButtons();
    return;
  }
  const currentPx = (sc.activeLayerId === target.id && sc.activePixels)
    ? sc.activePixels.slice()
    : decodeFrame(target.pixels, W, H);
  sc.undoStack.push({ layerId: target.id, pixels: currentPx });
  sc.activeLayerId = target.id;
  sc.activePixels = entry.pixels.slice();
  sc.polyPoints.length = 0;
  sc.lassoPoints.length = 0;
  commitActivePixels(true);
  renderLayerList();
  syncLayerPropsUI();
  renderSceneryStudioCanvas();
  updateUndoRedoButtons();
  setStatus('REDID STROKE');
}

/* =========================================================================
   PIXEL RASTERIZATION HELPERS (SEAMLESS WRAP-AWARE BRUSH, LINE, POLY, FILL)
   ========================================================================= */
function setPixel(pixels, x, y, hex, tileX) {
  if (y < 0 || y >= H) return false;
  let px = x;
  if (tileX) {
    px = ((px % W) + W) % W;
  } else if (px < 0 || px >= W) {
    return false;
  }
  const idx = y * W + px;
  if (pixels[idx] === hex) return false;
  pixels[idx] = hex;
  return true;
}

function paintBrushDab(pixels, cx, cy, size, hex, tileX) {
  const half = Math.floor(size * 0.5);
  const r2 = (size * 0.5) * (size * 0.5);
  let changed = false;
  for (let dy = -half; dy < size - half; dy++) {
    for (let dx = -half; dx < size - half; dx++) {
      if (size >= 4) {
        const rx = dx + (size % 2 === 0 ? 0.5 : 0);
        const ry = dy + (size % 2 === 0 ? 0.5 : 0);
        if (rx * rx + ry * ry > r2 + 0.35) continue;
      }
      if (setPixel(pixels, cx + dx, cy + dy, hex, tileX)) changed = true;
    }
  }
  return changed;
}

function paintLine(pixels, x0, y0, x1, y1, size, hex, tileX) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  let changed = false;
  let guard = 0;
  while (guard++ < 2000) {
    if (paintBrushDab(pixels, x, y, size, hex, tileX)) changed = true;
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return changed;
}

/* Crisp integer scanline polygon rasterizer (powers both POLY & LASSO freehand fill!) */
function fillPolygonPixels(pixels, pts, hex, tileX) {
  if (!Array.isArray(pts) || pts.length < 3) return false;
  let minY = H;
  let maxY = -1;
  for (let i = 0; i < pts.length; i++) {
    const py = Math.round(pts[i].y);
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  minY = clamp(minY, 0, H - 1);
  maxY = clamp(maxY, 0, H - 1);

  let changed = false;
  const nodes = [];
  for (let y = minY; y <= maxY; y++) {
    nodes.length = 0;
    const scanY = y + 0.5;
    let j = pts.length - 1;
    for (let i = 0; i < pts.length; i++) {
      const pi = pts[i];
      const pj = pts[j];
      if ((pi.y < scanY && pj.y >= scanY) || (pj.y < scanY && pi.y >= scanY)) {
        const ix = pi.x + ((scanY - pi.y) / (pj.y - pi.y)) * (pj.x - pi.x);
        nodes.push(ix);
      }
      j = i;
    }
    if (nodes.length < 2) continue;
    nodes.sort((a, b) => a - b);
    for (let k = 0; k < nodes.length - 1; k += 2) {
      const xStart = Math.round(nodes[k]);
      const xEnd = Math.round(nodes[k + 1]);
      for (let x = xStart; x <= xEnd; x++) {
        if (setPixel(pixels, x, y, hex, tileX)) changed = true;
      }
    }
  }
  // Crisp 1px boundary stroke so thin peaks and spires never drop out
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (paintLine(pixels, Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y), 1, hex, tileX)) {
      changed = true;
    }
  }
  return changed;
}

function floodFillPixels(pixels, startX, startY, fillHex, tileX) {
  if (startX < 0 || startX >= W || startY < 0 || startY >= H) return false;
  const target = pixels[startY * W + startX] || null;
  const next = fillHex || null;
  if (target === next) return false;

  const stack = [startX, startY];
  const visited = new Uint8Array(W * H);
  let changed = false;

  while (stack.length > 0) {
    const cy = stack.pop();
    const cx = stack.pop();
    const idx = cy * W + cx;
    if (visited[idx]) continue;
    if ((pixels[idx] || null) !== target) continue;
    visited[idx] = 1;
    pixels[idx] = next;
    changed = true;

    const lx = cx - 1;
    const rx = cx + 1;
    if (lx >= 0) stack.push(lx, cy);
    else if (tileX) stack.push(W - 1, cy);
    if (rx < W) stack.push(rx, cy);
    else if (tileX) stack.push(0, cy);
    if (cy > 0) stack.push(cx, cy - 1);
    if (cy + 1 < H) stack.push(cx, cy + 1);
  }
  return changed;
}

function stampSpriteIntoPixels(pixels, sp, cx, cy, scale, flipH, tileX) {
  if (!sp || !Array.isArray(sp.frames) || !sp.frames[0]) return false;
  const s = sp.size || 19;
  const src = decodeFrame(sp.frames[0], s);
  const drawW = s * scale;
  const drawH = s * scale;
  const ox = Math.round(cx - drawW * 0.5);
  const oy = Math.round(cy - drawH * 0.5);
  let changed = false;

  for (let sy = 0; sy < s; sy++) {
    for (let sx = 0; sx < s; sx++) {
      const hex = src[sy * s + sx];
      if (!hex) continue;
      const fx = flipH ? (s - 1 - sx) : sx;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          if (setPixel(pixels, ox + fx * scale + px, oy + sy * scale + py, hex, tileX)) {
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

function shiftPixelsHorizontal(pixels, deltaX) {
  const out = new Array(W * H).fill(null);
  const shift = ((deltaX % W) + W) % W;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const nx = (x + shift) % W;
      out[row + nx] = pixels[row + x];
    }
  }
  return out;
}

/* =========================================================================
   COLOR PICKER (HSV + ALPHA + LANDSCAPE SWATCHES)
   ========================================================================= */
function renderScHueBar() {
  if (!scHueCanvas || !scHueCtx) return;
  const w = scHueCanvas.width;
  const h = scHueCanvas.height;
  const grad = scHueCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#ff0000');
  grad.addColorStop(1 / 6, '#ffff00');
  grad.addColorStop(2 / 6, '#00ff00');
  grad.addColorStop(3 / 6, '#00ffff');
  grad.addColorStop(4 / 6, '#0000ff');
  grad.addColorStop(5 / 6, '#ff00ff');
  grad.addColorStop(1, '#ff0000');
  scHueCtx.fillStyle = grad;
  scHueCtx.fillRect(0, 0, w, h);

  const mx = Math.round((clamp(sc.hsv.h, 0, 360) / 360) * (w - 1));
  scHueCtx.fillStyle = '#0d0e11';
  scHueCtx.fillRect(mx - 2, 0, 5, h);
  scHueCtx.fillStyle = '#ffffff';
  scHueCtx.fillRect(mx - 1, 1, 3, h - 2);
}

function renderScAlphaBar() {
  if (!scAlphaCanvas || !scAlphaCtx) return;
  const w = scAlphaCanvas.width;
  const h = scAlphaCanvas.height;
  scAlphaCtx.clearRect(0, 0, w, h);
  const rgb = hsvToRgb(sc.hsv.h, sc.hsv.s, sc.hsv.v);
  const grad = scAlphaCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
  grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
  scAlphaCtx.fillStyle = grad;
  scAlphaCtx.fillRect(0, 0, w, h);

  const mx = Math.round(clamp(sc.alpha, 0, 1) * (w - 1));
  scAlphaCtx.fillStyle = '#0d0e11';
  scAlphaCtx.fillRect(mx - 2, 0, 5, h);
  scAlphaCtx.fillStyle = '#ffffff';
  scAlphaCtx.fillRect(mx - 1, 1, 3, h - 2);
}

function renderScSvCanvas() {
  if (!scSvCanvas || !scSvCtx) return;
  const w = scSvCanvas.width;
  const h = scSvCanvas.height;
  const pure = hsvToRgb(sc.hsv.h, 1, 1);
  scSvCtx.fillStyle = `rgb(${pure.r}, ${pure.g}, ${pure.b})`;
  scSvCtx.fillRect(0, 0, w, h);

  const wg = scSvCtx.createLinearGradient(0, 0, w, 0);
  wg.addColorStop(0, 'rgba(255,255,255,1)');
  wg.addColorStop(1, 'rgba(255,255,255,0)');
  scSvCtx.fillStyle = wg;
  scSvCtx.fillRect(0, 0, w, h);

  const bg = scSvCtx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(0,0,0,0)');
  bg.addColorStop(1, 'rgba(0,0,0,1)');
  scSvCtx.fillStyle = bg;
  scSvCtx.fillRect(0, 0, w, h);

  const cx = Math.round(clamp(sc.hsv.s, 0, 1) * (w - 1));
  const cy = Math.round((1 - clamp(sc.hsv.v, 0, 1)) * (h - 1));
  scSvCtx.strokeStyle = '#0d0e11';
  scSvCtx.lineWidth = 2;
  scSvCtx.strokeRect(cx - 4, cy - 4, 8, 8);
  scSvCtx.strokeStyle = '#ffffff';
  scSvCtx.lineWidth = 1;
  scSvCtx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
}

function updateScColorUI() {
  if (scColorSwatch) scColorSwatch.style.setProperty('--swatch-col', sc.color);
  if (scHexInput) scHexInput.value = sc.color.toUpperCase();
  if (scAlphaVal) scAlphaVal.textContent = `${Math.round(clamp(sc.alpha, 0, 1) * 100)}%`;
  renderScHueBar();
  renderScSvCanvas();
  renderScAlphaBar();
  if (scPaletteGrid) {
    scPaletteGrid.querySelectorAll('.pal-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.col === sc.color.toLowerCase());
    });
  }
}

function setScColor(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return;
  const rgb = hexToRgb(norm);
  sc.hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  sc.alpha = clamp(rgb.a, 0.05, 1);
  sc.color = norm;
  if (sc.tool === 'eraser') setScTool('brush');
  updateScColorUI();
}

function setScColorFromHSV() {
  const rgb = hsvToRgb(sc.hsv.h, sc.hsv.s, sc.hsv.v);
  sc.color = rgbaToHex(rgb.r, rgb.g, rgb.b, sc.alpha);
  if (sc.tool === 'eraser') setScTool('brush');
  updateScColorUI();
}

function renderScPaletteGrid() {
  if (!scPaletteGrid) return;
  scPaletteGrid.innerHTML = '';
  for (let i = 0; i < SCENERY_PALETTE.length; i++) {
    const hex = SCENERY_PALETTE[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pal-swatch' + (sc.color.toLowerCase() === hex ? ' active' : '');
    btn.dataset.col = hex;
    btn.style.setProperty('--swatch-col', hex);
    btn.dataset.tip = hex.toUpperCase();
    btn.addEventListener('click', () => setScColor(hex));
    scPaletteGrid.appendChild(btn);
  }
}

/* =========================================================================
   LAYER STACK & PROPERTIES UI
   Layers display Closest (highest depth) on top -> Farthest (horizon) below
   ========================================================================= */
function getLayersSortedForUI() {
  const layers = getLayers();
  return layers
    .map((layer, idx) => ({ layer, idx }))
    .sort((a, b) => {
      const da = Number(a.layer.depth) || 0.22;
      const db = Number(b.layer.depth) || 0.22;
      if (Math.abs(db - da) > 0.0001) return db - da;
      return b.idx - a.idx;
    });
}

function refreshLayerThumb(layer) {
  if (!layer || !scLayerList) return;
  const thumb = scLayerList.querySelector(`canvas[data-layer-id="${layer.id}"]`);
  if (!thumb) return;
  const ctx = thumb.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const world = getActiveWorld();
  const sky = drawScenerySkyBackdrop(ctx, thumb.width, thumb.height, world);
  const img = getTintedSceneryLayerCanvas(layer, sky.tint) || getSceneryLayerRawCanvas(layer);
  if (img) ctx.drawImage(img, 0, 0, thumb.width, thumb.height);
}

function startLayerRename(layer, nameEl) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'inline-rename-input';
  inp.maxLength = 20;
  inp.value = layer.name;
  nameEl.replaceWith(inp);
  inp.focus();
  inp.select();

  let done = false;
  const commit = save => {
    if (done) return;
    done = true;
    if (save) {
      const next = (inp.value || '').trim().toUpperCase().slice(0, 20);
      if (next && next !== layer.name) {
        layer.name = next;
        scheduleWorldAutoSave(true);
      }
    }
    renderLayerList();
  };
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); }
  });
  inp.addEventListener('click', e => e.stopPropagation());
}

function reorderLayerVisual(layerId, dir) {
  // dir = -1 moves closer (up in UI list, higher depth); dir = +1 moves farther (down in UI list, lower depth)
  const ordered = getLayersSortedForUI();
  const pos = ordered.findIndex(item => item.layer.id === layerId);
  if (pos === -1) return;
  const swapPos = pos + dir;
  if (swapPos < 0 || swapPos >= ordered.length) {
    SFX.playError();
    return;
  }
  const a = ordered[pos].layer;
  const b = ordered[swapPos].layer;
  const tmpDepth = a.depth;
  a.depth = b.depth;
  b.depth = tmpDepth;
  if (Math.abs(a.depth - b.depth) < 0.001) {
    // Same depth tie: swap array order too
    const layers = getLayers();
    const ia = layers.indexOf(a);
    const ib = layers.indexOf(b);
    if (ia >= 0 && ib >= 0) {
      layers[ia] = b;
      layers[ib] = a;
    }
  }
  invalidateSceneryLayerCache(a);
  invalidateSceneryLayerCache(b);
  scheduleWorldAutoSave(true);
  renderLayerList();
  syncLayerPropsUI();
  renderSceneryStudioCanvas();
}

function renderLayerList() {
  if (!scLayerList) return;
  const layers = getLayers();
  if (scLayerCountPill) {
    scLayerCountPill.textContent = `${layers.length} / ${SCENERY_MAX_LAYERS} LAYERS`;
  }
  if (scAddLayerBtn) {
    scAddLayerBtn.classList.toggle('disabled-soft', layers.length >= SCENERY_MAX_LAYERS);
  }

  scLayerList.innerHTML = '';
  if (layers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sc-layer-empty';
    empty.textContent = 'NO SCENERY LAYERS YET. CLICK + LAYER TO PAINT MOUNTAINS, CLOUDS OR CAVES!';
    scLayerList.appendChild(empty);
    return;
  }

  const active = getActiveLayer();
  const ordered = getLayersSortedForUI();
  const world = getActiveWorld();

  for (let i = 0; i < ordered.length; i++) {
    const layer = ordered[i].layer;
    const isAct = active && layer.id === active.id;

    const card = document.createElement('div');
    card.className = 'sc-layer-card' + (isAct ? ' active' : '') + (layer.visible === false ? ' hidden-layer' : '');
    card.addEventListener('click', () => {
      if (sc.activeLayerId === layer.id) return;
      sc.polyPoints.length = 0;
      sc.lassoPoints.length = 0;
      sc.activeLayerId = layer.id;
      loadActiveLayerPixels();
      renderLayerList();
      syncLayerPropsUI();
      renderSceneryStudioCanvas();
    });

    const top = document.createElement('div');
    top.className = 'sc-layer-top';

    const thumb = document.createElement('canvas');
    thumb.className = 'sc-layer-thumb';
    thumb.width = 56;
    thumb.height = 28;
    thumb.dataset.layerId = layer.id;
    const tCtx = thumb.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    const sky = drawScenerySkyBackdrop(tCtx, 56, 28, world);
    const img = getTintedSceneryLayerCanvas(layer, sky.tint) || getSceneryLayerRawCanvas(layer);
    if (img) tCtx.drawImage(img, 0, 0, 56, 28);

    const meta = document.createElement('div');
    meta.className = 'sc-layer-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'sc-layer-name';
    nameEl.textContent = layer.name;
    nameEl.title = layer.name + ' (Double-click to rename)';
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      startLayerRename(layer, nameEl);
    });

    const subEl = document.createElement('div');
    subEl.className = 'sc-layer-sub';
    subEl.textContent = `${depthTierLabel(layer.depth)} ${Number(layer.depth).toFixed(2)}X${layer.drift !== 'NONE' ? ' | ' + layer.drift : ''}`;

    meta.appendChild(nameEl);
    meta.appendChild(subEl);
    top.appendChild(thumb);
    top.appendChild(meta);

    const acts = document.createElement('div');
    acts.className = 'sc-layer-acts';

    const visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.className = 'btn sc-vis-btn' + (layer.visible === false ? ' off' : ' active');
    visBtn.textContent = layer.visible === false ? 'OFF' : 'VIS';
    visBtn.dataset.tip = 'Show / Hide layer';
    visBtn.addEventListener('click', e => {
      e.stopPropagation();
      layer.visible = layer.visible === false;
      scheduleWorldAutoSave(true);
      renderLayerList();
      renderSceneryStudioCanvas();
    });

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn';
    upBtn.textContent = '^';
    upBtn.dataset.tip = 'Bring closer (higher parallax depth)';
    if (i === 0) upBtn.classList.add('disabled-soft');
    upBtn.addEventListener('click', e => {
      e.stopPropagation();
      reorderLayerVisual(layer.id, -1);
    });

    const dnBtn = document.createElement('button');
    dnBtn.type = 'button';
    dnBtn.className = 'btn';
    dnBtn.textContent = 'v';
    dnBtn.dataset.tip = 'Push farther back (lower parallax depth)';
    if (i === ordered.length - 1) dnBtn.classList.add('disabled-soft');
    dnBtn.addEventListener('click', e => {
      e.stopPropagation();
      reorderLayerVisual(layer.id, 1);
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'btn';
    dupBtn.textContent = 'DUP';
    dupBtn.dataset.tip = 'Duplicate layer';
    if (layers.length >= SCENERY_MAX_LAYERS) dupBtn.classList.add('disabled-soft');
    dupBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (layers.length >= SCENERY_MAX_LAYERS) {
        SFX.playError();
        setStatus(`MAX ${SCENERY_MAX_LAYERS} LAYERS PER WORLD`);
        return;
      }
      const nextDepth = clamp(Math.round((layer.depth + 0.08) * 100) / 100, 0.05, 0.65);
      const copy = {
        ...layer,
        id: 'sc_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
        name: (layer.name.slice(0, 15) + ' COPY').slice(0, 20),
        depth: nextDepth,
        pixels: { p: layer.pixels.p.slice(), d: layer.pixels.d.slice() }
      };
      layers.push(copy);
      sc.activeLayerId = copy.id;
      loadActiveLayerPixels();
      scheduleWorldAutoSave(true);
      renderLayerList();
      syncLayerPropsUI();
      renderSceneryStudioCanvas();
      setStatus('DUPLICATED ' + copy.name);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn';
    delBtn.textContent = 'DEL';
    delBtn.dataset.tip = 'Delete layer (click twice)';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (delBtn.dataset.armed === '1') {
        const idx = layers.findIndex(l => l.id === layer.id);
        if (idx >= 0) layers.splice(idx, 1);
        sc.polyPoints.length = 0;
        sc.lassoPoints.length = 0;
        if (sc.activeLayerId === layer.id) {
          sc.activeLayerId = layers.length > 0 ? layers[layers.length - 1].id : null;
        }
        loadActiveLayerPixels();
        scheduleWorldAutoSave(true);
        renderLayerList();
        syncLayerPropsUI();
        renderSceneryStudioCanvas();
        setStatus('DELETED LAYER');
      } else {
        delBtn.dataset.armed = '1';
        delBtn.classList.add('danger-confirm');
        delBtn.textContent = 'DEL?';
        setTimeout(() => {
          if (delBtn.isConnected && delBtn.dataset.armed === '1') {
            delBtn.dataset.armed = '';
            delBtn.classList.remove('danger-confirm');
            delBtn.textContent = 'DEL';
          }
        }, 2000);
      }
    });

    acts.appendChild(visBtn);
    acts.appendChild(upBtn);
    acts.appendChild(dnBtn);
    acts.appendChild(dupBtn);
    acts.appendChild(delBtn);

    card.appendChild(top);
    card.appendChild(acts);
    scLayerList.appendChild(card);
  }
}

function updateAtmoReadout() {
  const world = getActiveWorld();
  const sky = sampleWorldSkyColor(world);
  if (scSkyChip) {
    scSkyChip.style.background = `rgb(${sky.tint.r}, ${sky.tint.g}, ${sky.tint.b})`;
  }
  const layer = getActiveLayer();
  if (!layer) {
    if (scAtmoNote) scAtmoNote.textContent = 'ADD A LAYER TO PAINT PARALLAX SCENERY';
    return;
  }
  const tintPct = Math.round(computeAtmosphericTintStrength(layer) * 100);
  const depthNorm = clamp((layer.depth - 0.05) / 0.60, 0, 1);
  const scale = layer.autoScale !== false ? (0.72 + depthNorm * 0.74) : 1.0;
  if (scAtmoNote) {
    scAtmoNote.textContent = `AUTO SKY TINT: ${tintPct}% | SCALE: ${scale.toFixed(2)}X`;
  }
}

function syncLayerPropsUI() {
  const layer = getActiveLayer();
  if (scLayerProps) scLayerProps.classList.toggle('disabled', !layer);
  if (!layer) {
    updateAtmoReadout();
    return;
  }

  const dInt = clamp(Math.round((Number(layer.depth) || 0.22) * 100), 5, 65);
  if (scDepthSlider) scDepthSlider.value = String(dInt);
  if (scDepthVal) scDepthVal.textContent = `${(dInt / 100).toFixed(2)}X`;
  if (scDepthBadge) scDepthBadge.textContent = `${depthTierLabel(dInt / 100)} ${(dInt / 100).toFixed(2)}X`;

  if (scTintSlider) scTintSlider.value = String(layer.atmoTint ?? 60);
  if (scTintVal) scTintVal.textContent = `${layer.atmoTint ?? 60}%`;

  const hVal = Number(layer.yOffset) || 0;
  if (scHeightSlider) scHeightSlider.value = String(hVal);
  if (scHeightVal) scHeightVal.textContent = `${hVal > 0 ? '+' : ''}${hVal}`;

  if (scOpacitySlider) scOpacitySlider.value = String(layer.opacity ?? 95);
  if (scOpacityVal) scOpacityVal.textContent = `${layer.opacity ?? 95}%`;

  if (scDriftSelect) {
    scDriftSelect.value = SCENERY_DRIFTS.includes(layer.drift) ? layer.drift : 'NONE';
    syncCustomSelect(scDriftSelect);
  }
  if (scTileXCheck) scTileXCheck.checked = layer.tileX !== false;
  if (scAutoScaleCheck) scAutoScaleCheck.checked = layer.autoScale !== false;

  updateAtmoReadout();
}

/* =========================================================================
   TOOL & CONTEXT BAR UI (INCLUDING STAMP SPRITE PICKER)
   ========================================================================= */
function renderStampPickerStrip() {
  if (!scStampStrip) return;
  scStampStrip.innerHTML = '';
  const candidates = state.sprites.filter(sp => sp && !isGearType(sp.type));
  if (candidates.length === 0) {
    const msg = document.createElement('span');
    msg.className = 'sc-ctx-hint';
    msg.textContent = 'NO PLACEABLE SPRITES YET - DRAW TREES/MOONS/HOUSES IN +CREATE TO STAMP HERE!';
    scStampStrip.appendChild(msg);
    sc.stampSpriteId = null;
    return;
  }

  if (!sc.stampSpriteId || !candidates.some(sp => sp.id === sc.stampSpriteId)) {
    sc.stampSpriteId = candidates[0].id;
  }

  for (let i = 0; i < candidates.length; i++) {
    const sp = candidates[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sc-stamp-item' + (sp.id === sc.stampSpriteId ? ' active' : '');
    btn.dataset.tip = `Stamp "${sp.name}" (${sp.size}x${sp.size})`;
    const c = document.createElement('canvas');
    c.width = sp.size;
    c.height = sp.size;
    const cCtx = c.getContext('2d');
    cCtx.imageSmoothingEnabled = false;
    if (sp._canvases && sp._canvases[0]) cCtx.drawImage(sp._canvases[0], 0, 0);
    btn.appendChild(c);
    btn.addEventListener('click', () => {
      sc.stampSpriteId = sp.id;
      renderStampPickerStrip();
      renderSceneryStudioCanvas();
    });
    scStampStrip.appendChild(btn);
  }
}

function updateContextBarUI() {
  const showPoly = !sc.preview && sc.tool === 'poly';
  const showStamp = !sc.preview && sc.tool === 'stamp';
  if (scCtxPoly) scCtxPoly.style.display = showPoly ? 'flex' : 'none';
  if (scCtxStamp) scCtxStamp.style.display = showStamp ? 'flex' : 'none';
  if (scCtxInfo) scCtxInfo.style.display = (!showPoly && !showStamp) ? 'flex' : 'none';

  if (showPoly && scPolyHint) {
    scPolyHint.textContent = sc.polyPoints.length >= 3
      ? `${sc.polyPoints.length} POINTS - CLICK START, DBL-CLICK, OR PRESS ENTER TO FILL`
      : `${sc.polyPoints.length} POINTS - CLICK MOUNTAIN/CLIFF CORNERS | RMB UNDO POINT`;
  }
  if (showStamp) {
    renderStampPickerStrip();
  }
  if (!showPoly && !showStamp && scCtxHint) {
    if (sc.preview) {
      scCtxHint.textContent = 'Drag canvas to preview scrolling parallax.';
    } else if (sc.tool === 'lasso') {
      scCtxHint.textContent = 'Drag any hill or cloud shape, release to fill.';
    } else if (sc.tool === 'fill') {
      scCtxHint.textContent = 'Click an area to flood fill.';
    } else if (sc.tool === 'line') {
      scCtxHint.textContent = 'Drag to draw a crisp straight line.';
    } else if (sc.tool === 'pick') {
      scCtxHint.textContent = 'Click anywhere on canvas to pick a color.';
    } else {
      scCtxHint.textContent = 'Paint hills & clouds. Bottom edge fades out.';
    }
  }
}

function setScTool(nextTool) {
  if (sc.preview) setScPreviewMode(false);
  if (sc.tool === 'poly' && nextTool !== 'poly' && sc.polyPoints.length > 0) {
    sc.polyPoints.length = 0;
  }
  sc.tool = nextTool;
  if (scToolGroup) {
    scToolGroup.querySelectorAll('button[data-sctool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sctool === nextTool);
    });
  }
  updateContextBarUI();
  renderSceneryStudioCanvas();
}

function setScBrushSize(sz) {
  sc.brushSize = clamp(Math.round(Number(sz) || 4), 1, 24);
  if (scSizeGroup) {
    scSizeGroup.querySelectorAll('button[data-scsize]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.scsize, 10) === sc.brushSize);
    });
  }
  renderSceneryStudioCanvas();
}

function setScPreviewMode(on) {
  sc.preview = Boolean(on);
  sc.polyPoints.length = 0;
  sc.lassoPoints.length = 0;
  sc.drawing = false;
  if (scPreviewBtn) scPreviewBtn.classList.toggle('active', sc.preview);
  if (scCanvasFrame) scCanvasFrame.classList.toggle('preview-mode', sc.preview);
  updateContextBarUI();
  renderSceneryStudioCanvas();
}

/* =========================================================================
   WIDE CANVAS RENDERING (LIVE SKY + ATMOSPHERIC LAYERS + INTERACTIVE OVERLAY)
   ========================================================================= */
export function renderSceneryStudioCanvas() {
  if (!scCanvas || !scCtx) return;
  const cw = scCanvas.width;
  const ch = scCanvas.height;
  const world = getActiveWorld();
  const layers = getLayers();

  scCtx.setTransform(1, 0, 0, 1, 0, 0);
  scCtx.imageSmoothingEnabled = false;

  // 1. Live World Sky Gradient Backdrop
  const sky = drawScenerySkyBackdrop(scCtx, cw, ch, world);

  if (sc.preview) {
    renderSceneryComposite(scCtx, cw, ch, layers, {
      camX: sc.previewCamX,
      camY: sc.previewCamY,
      zoom: 3.0,
      cx: cw * 0.5,
      cy: ch * 0.5,
      timeSec: state.uiTime,
      skyRgb: sky.tint,
      baseUnit: 1.9
    });
    // Subtle horizon frame HUD badge in Preview mode
    const badgeTxt = 'PARALLAX PREVIEW';
    scCtx.font = '16px "Pixellari", monospace';
    const badgeW = Math.ceil(scCtx.measureText(badgeTxt).width) + 14;
    const badgeH = 24;
    scCtx.fillStyle = 'rgba(13, 14, 17, 0.78)';
    scCtx.fillRect(8, 8, badgeW, badgeH);
    scCtx.strokeStyle = '#f28c38';
    scCtx.lineWidth = 1;
    scCtx.strokeRect(8.5, 8.5, badgeW - 1, badgeH - 1);
    scCtx.fillStyle = '#ffcf96';
    scCtx.textBaseline = 'middle';
    scCtx.fillText(badgeTxt, 15, 20);
    return;
  }

  // Subtle horizon centerline & seam guides in Edit mode
  scCtx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  scCtx.fillRect(0, Math.round(ch * 0.5), cw, 1);
  scCtx.fillRect(Math.round(cw * 0.5), 0, 1, ch);

  // 2. Render visible layers back-to-front with real automatic sky-color atmospheric tint
  const active = getActiveLayer();
  const sorted = layers
    .map((layer, idx) => ({ layer, idx }))
    .sort((a, b) => {
      const da = Number(a.layer.depth) || 0.22;
      const db = Number(b.layer.depth) || 0.22;
      if (Math.abs(da - db) > 0.0001) return da - db;
      return a.idx - b.idx;
    });

  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i].layer;
    const isAct = active && layer.id === active.id;
    if (sc.solo && !isAct) continue;
    if (!isAct && layer.visible === false) continue;
    const img = getTintedSceneryLayerCanvas(layer, sky.tint);
    if (!img) continue;
    const layerAlpha = clamp((layer.opacity ?? 95) / 100, 0.05, 1);
    scCtx.save();
    scCtx.globalAlpha = isAct ? layerAlpha : layerAlpha * 0.62;
    const yShiftPx = Math.round((Number(layer.yOffset) || 0) * 0.45 * DISP_SCALE);
    scCtx.drawImage(img, 0, isAct ? 0 : yShiftPx, cw, ch);
    scCtx.restore();
  }

  // 3. Interactive Tool Overlays
  if (!active) return;

  // Live Line preview
  if (sc.drawing && sc.tool === 'line' && sc.hoverX >= 0) {
    scCtx.save();
    scCtx.strokeStyle = sc.color;
    scCtx.lineWidth = Math.max(2, sc.brushSize * DISP_SCALE);
    scCtx.lineCap = 'square';
    scCtx.globalAlpha = 0.72;
    scCtx.beginPath();
    scCtx.moveTo((sc.startX + 0.5) * DISP_SCALE, (sc.startY + 0.5) * DISP_SCALE);
    scCtx.lineTo((sc.hoverX + 0.5) * DISP_SCALE, (sc.hoverY + 0.5) * DISP_SCALE);
    scCtx.stroke();
    scCtx.restore();
  }

  // Live Polygon shape vertices & rubberband
  if (sc.tool === 'poly' && sc.polyPoints.length > 0) {
    scCtx.save();
    scCtx.beginPath();
    for (let i = 0; i < sc.polyPoints.length; i++) {
      const sx = (sc.polyPoints[i].x + 0.5) * DISP_SCALE;
      const sy = (sc.polyPoints[i].y + 0.5) * DISP_SCALE;
      if (i === 0) scCtx.moveTo(sx, sy);
      else scCtx.lineTo(sx, sy);
    }
    if (sc.hoverX >= 0) {
      scCtx.lineTo((sc.hoverX + 0.5) * DISP_SCALE, (sc.hoverY + 0.5) * DISP_SCALE);
    }
    if (sc.polyPoints.length >= 2) {
      scCtx.closePath();
      scCtx.fillStyle = sc.color;
      scCtx.globalAlpha = 0.36;
      scCtx.fill();
    }
    scCtx.globalAlpha = 0.95;
    scCtx.strokeStyle = '#ffffff';
    scCtx.lineWidth = 1.5;
    scCtx.setLineDash([4, 3]);
    scCtx.stroke();
    scCtx.setLineDash([]);

    // Draw crisp vertex markers (highlight start vertex when closeable)
    for (let i = 0; i < sc.polyPoints.length; i++) {
      const sx = Math.round((sc.polyPoints[i].x + 0.5) * DISP_SCALE);
      const sy = Math.round((sc.polyPoints[i].y + 0.5) * DISP_SCALE);
      const isCloseHot = i === 0 && sc.polyPoints.length >= 3 && sc.hoverX >= 0 &&
        Math.hypot(sc.hoverX - sc.polyPoints[0].x, sc.hoverY - sc.polyPoints[0].y) <= 5;
      const r = isCloseHot ? 5 : 3;
      scCtx.fillStyle = isCloseHot ? '#f28c38' : '#ffffff';
      scCtx.fillRect(sx - r, sy - r, r * 2, r * 2);
      scCtx.strokeStyle = '#0d0e11';
      scCtx.lineWidth = 1;
      scCtx.strokeRect(sx - r - 0.5, sy - r - 0.5, r * 2 + 1, r * 2 + 1);
    }
    scCtx.restore();
  }

  // Live Freehand Fill (Lasso) silhouette preview
  if (sc.drawing && sc.tool === 'lasso' && sc.lassoPoints.length > 1) {
    scCtx.save();
    scCtx.beginPath();
    for (let i = 0; i < sc.lassoPoints.length; i++) {
      const sx = (sc.lassoPoints[i].x + 0.5) * DISP_SCALE;
      const sy = (sc.lassoPoints[i].y + 0.5) * DISP_SCALE;
      if (i === 0) scCtx.moveTo(sx, sy);
      else scCtx.lineTo(sx, sy);
    }
    scCtx.closePath();
    scCtx.fillStyle = sc.color;
    scCtx.globalAlpha = 0.42;
    scCtx.fill();
    scCtx.globalAlpha = 0.95;
    scCtx.strokeStyle = '#ffcf96';
    scCtx.lineWidth = 1.5;
    scCtx.setLineDash([3, 3]);
    scCtx.stroke();
    scCtx.restore();
  }

  // Live Stamp Sprite ghost preview
  if (sc.tool === 'stamp' && sc.hoverX >= 0 && sc.stampSpriteId) {
    const sp = getSpriteById(sc.stampSpriteId);
    if (sp && sp._canvases && sp._canvases[0]) {
      const dw = sp.size * sc.stampScale * DISP_SCALE;
      const dh = sp.size * sc.stampScale * DISP_SCALE;
      const ox = Math.round((sc.hoverX - sp.size * sc.stampScale * 0.5) * DISP_SCALE);
      const oy = Math.round((sc.hoverY - sp.size * sc.stampScale * 0.5) * DISP_SCALE);
      scCtx.save();
      scCtx.globalAlpha = 0.72;
      if (sc.stampFlip) {
        scCtx.translate(ox + dw, oy);
        scCtx.scale(-1, 1);
        scCtx.drawImage(sp._canvases[0], 0, 0, dw, dh);
      } else {
        scCtx.drawImage(sp._canvases[0], ox, oy, dw, dh);
      }
      scCtx.strokeStyle = '#f28c38';
      scCtx.lineWidth = 1;
      scCtx.strokeRect(ox + 0.5, oy + 0.5, dw - 1, dh - 1);
      scCtx.restore();
    }
  }

  // Crisp Brush / Eraser cursor outline
  if ((sc.tool === 'brush' || sc.tool === 'eraser') && sc.hoverX >= 0) {
    const half = Math.floor(sc.brushSize * 0.5);
    const bx = (sc.hoverX - half) * DISP_SCALE;
    const by = (sc.hoverY - half) * DISP_SCALE;
    const bs = sc.brushSize * DISP_SCALE;
    scCtx.save();
    scCtx.strokeStyle = '#0d0e11';
    scCtx.lineWidth = 2;
    scCtx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
    scCtx.strokeStyle = sc.tool === 'eraser' ? '#f06464' : '#ffffff';
    scCtx.lineWidth = 1;
    scCtx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
    scCtx.restore();
  }
}

export function tickSceneryStudioPreview(dt) {
  if (!sceneryModal || !sceneryModal.classList.contains('open') || !sc.preview) return;
  if (!sc.previewDragging) {
    sc.previewCamX += dt * 95;
  }
  renderSceneryStudioCanvas();
}

/* =========================================================================
   POLYGON COMMIT / CANCEL HELPERS
   ========================================================================= */
function finishPolygonShape() {
  const layer = getActiveLayer();
  if (!layer || !sc.activePixels || sc.polyPoints.length < 3) {
    SFX.playError();
    setStatus('NEED AT LEAST 3 VERTICES FOR A SHAPE');
    return;
  }
  pushUndoSnapshot();
  fillPolygonPixels(sc.activePixels, sc.polyPoints, sc.color, layer.tileX !== false);
  sc.polyPoints.length = 0;
  commitActivePixels(true);
  SFX.playPlaceBlock();
  updateContextBarUI();
  renderSceneryStudioCanvas();
  setStatus('FILLED POLYGON SHAPE');
}

function cancelPolygonShape() {
  if (sc.polyPoints.length === 0) return;
  sc.polyPoints.length = 0;
  updateContextBarUI();
  renderSceneryStudioCanvas();
  setStatus('CANCELLED POLYGON');
}

/* =========================================================================
   CANVAS POINTER EVENTS
   ========================================================================= */
function getCanvasCell(e) {
  const rect = scCanvas.getBoundingClientRect();
  const nx = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 0.9999);
  const ny = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 0.9999);
  return {
    x: clamp(Math.floor(nx * W), 0, W - 1),
    y: clamp(Math.floor(ny * H), 0, H - 1)
  };
}

function sampleColorAtCell(x, y) {
  if (sc.activePixels) {
    const c = sc.activePixels[y * W + x];
    if (c) return c;
  }
  const ordered = getLayersSortedForUI();
  for (let i = 0; i < ordered.length; i++) {
    const l = ordered[i].layer;
    if (l.visible === false) continue;
    const decoded = decodeFrame(l.pixels, W, H);
    if (decoded[y * W + x]) return decoded[y * W + x];
  }
  return null;
}

function handleCanvasPointerDown(e) {
  if (e.button !== 0 && e.button !== 2) return;
  e.preventDefault();

  if (sc.preview) {
    sc.previewDragging = true;
    sc.previewDragStartX = e.clientX;
    sc.previewDragStartY = e.clientY;
    sc.previewOriginX = sc.previewCamX;
    sc.previewOriginY = sc.previewCamY;
    if (scCanvasFrame) scCanvasFrame.classList.add('dragging');
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  let layer = getActiveLayer();
  if (!layer) {
    addNewSceneryLayer();
    layer = getActiveLayer();
    if (!layer) return;
  }
  if (!sc.activePixels) loadActiveLayerPixels();
  if (layer.visible === false) {
    layer.visible = true;
    renderLayerList();
  }

  const { x, y } = getCanvasCell(e);
  sc.hoverX = x;
  sc.hoverY = y;
  const tileX = layer.tileX !== false;

  // Alt+Click or Eyedropper tool samples pixel color
  if (e.altKey || sc.tool === 'pick') {
    const picked = sampleColorAtCell(x, y);
    if (picked) {
      setScColor(picked);
      SFX.playPickup();
      setStatus('PICKED ' + picked.toUpperCase());
    } else {
      SFX.playError();
      setStatus('NO PIXEL TO SAMPLE');
    }
    return;
  }

  if (sc.tool === 'poly') {
    if (e.button === 2) {
      if (sc.polyPoints.length > 0) {
        sc.polyPoints.pop();
        updateContextBarUI();
        renderSceneryStudioCanvas();
        setStatus('REMOVED LAST VERTEX');
      }
      return;
    }
    // Close shape when clicking near vertex 0 with >= 3 points
    if (sc.polyPoints.length >= 3 && Math.hypot(x - sc.polyPoints[0].x, y - sc.polyPoints[0].y) <= 5) {
      finishPolygonShape();
      return;
    }
    sc.polyPoints.push({ x, y });
    SFX.playButton('soft');
    updateContextBarUI();
    renderSceneryStudioCanvas();
    return;
  }

  if (sc.tool === 'fill') {
    const fillHex = e.button === 2 ? null : sc.color;
    const snap = sc.activePixels.slice();
    if (floodFillPixels(sc.activePixels, x, y, fillHex, tileX)) {
      pushUndoSnapshot(snap);
      commitActivePixels(true);
      SFX.playPlaceBlock();
      renderSceneryStudioCanvas();
      setStatus(fillHex ? 'FILLED REGION' : 'ERASED REGION');
    } else {
      SFX.playError();
    }
    return;
  }

  if (sc.tool === 'stamp') {
    if (e.button === 2) {
      sc.stampFlip = !sc.stampFlip;
      if (scStampFlipBtn) scStampFlipBtn.classList.toggle('active', sc.stampFlip);
      SFX.playRotate(true);
      renderSceneryStudioCanvas();
      return;
    }
    const sp = sc.stampSpriteId ? getSpriteById(sc.stampSpriteId) : null;
    if (!sp) {
      SFX.playError();
      setStatus('SELECT A SPRITE TO STAMP FIRST');
      return;
    }
    const snap = sc.activePixels.slice();
    if (stampSpriteIntoPixels(sc.activePixels, sp, x, y, sc.stampScale, sc.stampFlip, tileX)) {
      pushUndoSnapshot(snap);
      commitActivePixels(true);
      SFX.playPlaceBlock();
      renderSceneryStudioCanvas();
      setStatus('STAMPED ' + sp.name);
    }
    return;
  }

  if (sc.tool === 'lasso') {
    if (e.button === 2) return;
    sc.drawing = true;
    sc.drawBtn = 0;
    sc.lassoPoints = [{ x, y }];
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    renderSceneryStudioCanvas();
    return;
  }

  if (sc.tool === 'line') {
    sc.drawing = true;
    sc.drawBtn = e.button;
    sc.startX = x;
    sc.startY = y;
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    renderSceneryStudioCanvas();
    return;
  }

  // Brush / Eraser
  const paintHex = (sc.tool === 'eraser' || e.button === 2) ? null : sc.color;
  sc.drawing = true;
  sc.drawBtn = e.button;
  sc.strokeSnap = sc.activePixels.slice();
  if (e.shiftKey && sc.lastX >= 0 && sc.lastY >= 0) {
    paintLine(sc.activePixels, sc.lastX, sc.lastY, x, y, sc.brushSize, paintHex, tileX);
  } else {
    paintBrushDab(sc.activePixels, x, y, sc.brushSize, paintHex, tileX);
  }
  sc.lastX = x;
  sc.lastY = y;
  syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
  renderSceneryStudioCanvas();
  try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
}

function handleCanvasPointerMove(e) {
  if (sc.preview) {
    if (sc.previewDragging) {
      const dx = e.clientX - sc.previewDragStartX;
      const dy = e.clientY - sc.previewDragStartY;
      sc.previewCamX = sc.previewOriginX - dx * 0.85;
      sc.previewCamY = clamp(sc.previewOriginY - dy * 0.55, -180, 180);
      renderSceneryStudioCanvas();
    }
    return;
  }

  const { x, y } = getCanvasCell(e);
  sc.hoverX = x;
  sc.hoverY = y;
  if (scCoordEl) scCoordEl.textContent = `${x}, ${y}`;

  if (!sc.drawing) {
    renderSceneryStudioCanvas();
    return;
  }

  const layer = getActiveLayer();
  if (!layer || !sc.activePixels) return;
  const tileX = layer.tileX !== false;

  if (sc.tool === 'lasso') {
    const prev = sc.lassoPoints[sc.lassoPoints.length - 1];
    if (!prev || Math.hypot(x - prev.x, y - prev.y) >= 2) {
      sc.lassoPoints.push({ x, y });
    }
    renderSceneryStudioCanvas();
    return;
  }

  if (sc.tool === 'line') {
    renderSceneryStudioCanvas();
    return;
  }

  const paintHex = (sc.tool === 'eraser' || sc.drawBtn === 2) ? null : sc.color;
  if (sc.lastX >= 0 && sc.lastY >= 0) {
    paintLine(sc.activePixels, sc.lastX, sc.lastY, x, y, sc.brushSize, paintHex, tileX);
  } else {
    paintBrushDab(sc.activePixels, x, y, sc.brushSize, paintHex, tileX);
  }
  sc.lastX = x;
  sc.lastY = y;
  syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
  renderSceneryStudioCanvas();
}

function handleCanvasPointerUp(e) {
  if (sc.preview) {
    if (sc.previewDragging) {
      sc.previewDragging = false;
      if (scCanvasFrame) scCanvasFrame.classList.remove('dragging');
      try { scCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    return;
  }
  if (!sc.drawing) return;
  sc.drawing = false;
  try { scCanvas.releasePointerCapture(e.pointerId); } catch (_) {}

  const layer = getActiveLayer();
  if (!layer || !sc.activePixels) return;
  const tileX = layer.tileX !== false;

  if (sc.tool === 'lasso') {
    const pts = sc.lassoPoints.slice();
    sc.lassoPoints.length = 0;
    const snap = sc.activePixels.slice();
    let changed = false;
    if (pts.length >= 3) {
      changed = fillPolygonPixels(sc.activePixels, pts, sc.color, tileX);
    } else if (pts.length > 0) {
      changed = paintBrushDab(sc.activePixels, pts[0].x, pts[0].y, sc.brushSize, sc.color, tileX);
    }
    if (changed) {
      pushUndoSnapshot(snap);
      commitActivePixels(true);
      SFX.playPlaceBlock();
      setStatus('FILLED FREEHAND SHAPE');
    }
    renderSceneryStudioCanvas();
    return;
  }

  if (sc.tool === 'line') {
    const { x, y } = getCanvasCell(e);
    const paintHex = sc.drawBtn === 2 ? null : sc.color;
    const snap = sc.activePixels.slice();
    if (paintLine(sc.activePixels, sc.startX, sc.startY, x, y, sc.brushSize, paintHex, tileX)) {
      pushUndoSnapshot(snap);
      commitActivePixels(true);
      SFX.playPlaceBlock();
    }
    renderSceneryStudioCanvas();
    return;
  }

  // Commit Brush / Eraser stroke
  if (sc.strokeSnap) {
    pushUndoSnapshot(sc.strokeSnap);
    sc.strokeSnap = null;
  }
  commitActivePixels(true);
  renderSceneryStudioCanvas();
}

/* =========================================================================
   ADD LAYER / OPEN / CLOSE / KEYBOARD SHORTCUTS
   ========================================================================= */
function addNewSceneryLayer() {
  const layers = getLayers();
  if (layers.length >= SCENERY_MAX_LAYERS) {
    SFX.playError();
    setStatus(`MAX ${SCENERY_MAX_LAYERS} LAYERS PER WORLD`);
    return;
  }
  const idx = layers.length;
  const depth = STAGGER_DEPTHS[idx % STAGGER_DEPTHS.length];
  const defaultNames = ['DISTANT PEAKS', 'MID HILLS', 'CLOUD LAYER', 'NEAR RIDGE', 'HORIZON SILHOUETTE', 'DETAIL LAYER'];
  const name = defaultNames[idx % defaultNames.length];
  const created = defaultSceneryLayer(name, depth);
  layers.push(created);
  sc.activeLayerId = created.id;
  sc.polyPoints.length = 0;
  sc.lassoPoints.length = 0;
  loadActiveLayerPixels();
  scheduleWorldAutoSave(true);
  renderLayerList();
  syncLayerPropsUI();
  renderSceneryStudioCanvas();
  setStatus(`ADDED ${created.name} (${created.depth.toFixed(2)}X)`);
}

export function openSceneryModal() {
  if (!sceneryModal) return;
  if (audioPopover) audioPopover.classList.remove('open');
  if (physPopover) {
    physPopover.classList.remove('open');
    if (physMenuBtn) physMenuBtn.classList.remove('active');
  }
  if (pixoPopover) pixoPopover.classList.remove('open');

  const world = getActiveWorld();
  const layers = ensureWorldScenery(world).layers;
  sc.autoStarterId = null;
  if (layers.length === 0) {
    const starter = defaultSceneryLayer('DISTANT PEAKS', 0.14);
    layers.push(starter);
    sc.activeLayerId = starter.id;
    sc.autoStarterId = starter.id;
  } else if (!layers.some(l => l.id === sc.activeLayerId)) {
    sc.activeLayerId = layers[layers.length - 1].id;
  }

  sc.undoStack.length = 0;
  sc.redoStack.length = 0;
  sc.polyPoints.length = 0;
  sc.lassoPoints.length = 0;
  sc.drawing = false;
  sc.preview = false;
  sc.previewCamX = 0;
  sc.previewCamY = 0;
  if (scPreviewBtn) scPreviewBtn.classList.remove('active');
  if (scCanvasFrame) scCanvasFrame.classList.remove('preview-mode', 'dragging');
  if (scWorldPill) scWorldPill.textContent = world.name || 'WORLD 1';

  loadActiveLayerPixels();
  renderScPaletteGrid();
  updateScColorUI();
  renderLayerList();
  syncLayerPropsUI();
  updateUndoRedoButtons();
  updateContextBarUI();
  renderSceneryStudioCanvas();
  setStatus('Auto-saves to your world.');

  sceneryModal.classList.add('open');
}

export function closeSceneryModal() {
  if (!sceneryModal || !sceneryModal.classList.contains('open')) return;
  closeOpenCustomSelect(false);
  sc.drawing = false;
  sc.preview = false;
  sc.polyPoints.length = 0;
  sc.lassoPoints.length = 0;
  if (scPreviewBtn) scPreviewBtn.classList.remove('active');
  if (scCanvasFrame) scCanvasFrame.classList.remove('preview-mode', 'dragging');
  // Remove untouched auto-created starter layer if the user merely opened Scenery and left without drawing
  const layers = getLayers();
  if (sc.autoStarterId && layers.length === 1 && layers[0].id === sc.autoStarterId) {
    const p = layers[0].pixels;
    if (!p || !Array.isArray(p.p) || p.p.length === 0) {
      layers.length = 0;
      sc.activeLayerId = null;
      sc.activePixels = null;
    }
  }
  sc.autoStarterId = null;
  saveWorldsNow(true);
  sceneryModal.classList.remove('open');
}

export function handleSceneryKeydown(e, inTextField) {
  if (!sceneryModal || !sceneryModal.classList.contains('open')) return false;

  if (e.key === 'Escape') {
    e.preventDefault();
    if (closeOpenCustomSelect(true)) return true;
    if (sc.polyPoints.length > 0) {
      cancelPolygonShape();
      return true;
    }
    if (sc.preview) {
      setScPreviewMode(false);
      return true;
    }
    closeSceneryModal();
    return true;
  }

  if (inTextField) return true;

  if (e.key === 'Enter' && sc.tool === 'poly' && sc.polyPoints.length >= 3) {
    e.preventDefault();
    finishPolygonShape();
    return true;
  }
  if (e.key === 'Backspace' && sc.tool === 'poly' && sc.polyPoints.length > 0) {
    e.preventDefault();
    sc.polyPoints.pop();
    updateContextBarUI();
    renderSceneryStudioCanvas();
    return true;
  }

  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) doSceneryRedo();
      else doSceneryUndo();
      return true;
    }
    if (e.code === 'KeyY') {
      e.preventDefault();
      doSceneryRedo();
      return true;
    }
  }

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.code === 'KeyB') { e.preventDefault(); setScTool('brush'); return true; }
    if (e.code === 'KeyE') { e.preventDefault(); setScTool('eraser'); return true; }
    if (e.code === 'KeyP') { e.preventDefault(); setScTool('poly'); return true; }
    if (e.code === 'KeyL') { e.preventDefault(); setScTool('lasso'); return true; }
    if (e.code === 'KeyG') { e.preventDefault(); setScTool('fill'); return true; }
    if (e.code === 'KeyN') { e.preventDefault(); setScTool('line'); return true; }
    if (e.code === 'KeyI') { e.preventDefault(); setScTool('pick'); return true; }
    if (e.code === 'KeyS') { e.preventDefault(); setScTool('stamp'); return true; }
    if (e.code === 'Space') { e.preventDefault(); setScPreviewMode(!sc.preview); return true; }
  }
  return true;
}

/* =========================================================================
   STATIC UI INITIALIZATION
   ========================================================================= */
export function initSceneryUI() {
  if (openSceneryBtn) {
    openSceneryBtn.addEventListener('click', openSceneryModal);
  }
  window.addEventListener('spritelab:open-scenery', openSceneryModal);

  if (closeSceneryX) closeSceneryX.addEventListener('click', closeSceneryModal);
  if (closeSceneryBtn) closeSceneryBtn.addEventListener('click', closeSceneryModal);
  if (sceneryModal) {
    sceneryModal.addEventListener('click', e => {
      if (e.target === sceneryModal) closeSceneryModal();
    });
  }

  if (scPreviewBtn) {
    scPreviewBtn.addEventListener('click', () => setScPreviewMode(!sc.preview));
  }
  if (scAddLayerBtn) {
    scAddLayerBtn.addEventListener('click', addNewSceneryLayer);
  }

  // Layer Property Sliders & Toggles
  const onPropChange = (rebuildList = false) => {
    const layer = getActiveLayer();
    if (!layer) return;
    if (scDepthSlider) layer.depth = Math.round(clamp(parseInt(scDepthSlider.value, 10) || 22, 5, 65)) / 100;
    if (scTintSlider) layer.atmoTint = clamp(parseInt(scTintSlider.value, 10) || 0, 0, 100);
    if (scHeightSlider) layer.yOffset = clamp(parseInt(scHeightSlider.value, 10) || 0, -160, 160);
    if (scOpacitySlider) layer.opacity = clamp(parseInt(scOpacitySlider.value, 10) || 95, 10, 100);
    if (scDriftSelect) layer.drift = SCENERY_DRIFTS.includes(scDriftSelect.value) ? scDriftSelect.value : 'NONE';
    if (scTileXCheck) layer.tileX = scTileXCheck.checked;
    if (scAutoScaleCheck) layer.autoScale = scAutoScaleCheck.checked;
    invalidateSceneryLayerCache(layer);
    syncLayerPropsUI();
    if (rebuildList) renderLayerList();
    else refreshLayerThumb(layer);
    renderSceneryStudioCanvas();
    scheduleWorldAutoSave(true);
  };

  if (scDepthSlider) {
    scDepthSlider.addEventListener('input', () => onPropChange(false));
    scDepthSlider.addEventListener('change', () => onPropChange(true));
  }
  if (scTintSlider) scTintSlider.addEventListener('input', () => onPropChange(false));
  if (scHeightSlider) scHeightSlider.addEventListener('input', () => onPropChange(false));
  if (scOpacitySlider) scOpacitySlider.addEventListener('input', () => onPropChange(false));
  if (scDriftSelect) scDriftSelect.addEventListener('change', () => onPropChange(true));
  if (scTileXCheck) scTileXCheck.addEventListener('change', () => onPropChange(false));
  if (scAutoScaleCheck) scAutoScaleCheck.addEventListener('change', () => onPropChange(false));

  // Tool & Brush Size buttons
  if (scToolGroup) {
    scToolGroup.addEventListener('click', e => {
      const btn = e.target.closest('button[data-sctool]');
      if (btn) setScTool(btn.dataset.sctool);
    });
  }
  if (scSizeGroup) {
    scSizeGroup.addEventListener('click', e => {
      const btn = e.target.closest('button[data-scsize]');
      if (btn) setScBrushSize(btn.dataset.scsize);
    });
  }

  if (scUndoBtn) scUndoBtn.addEventListener('click', doSceneryUndo);
  if (scRedoBtn) scRedoBtn.addEventListener('click', doSceneryRedo);

  const shiftActiveLayer = delta => {
    const layer = getActiveLayer();
    if (!layer || !sc.activePixels) { SFX.playError(); return; }
    pushUndoSnapshot();
    sc.activePixels = shiftPixelsHorizontal(sc.activePixels, delta);
    commitActivePixels(true);
    renderSceneryStudioCanvas();
    setStatus(delta < 0 ? 'SHIFTED LAYER 16PX LEFT' : 'SHIFTED LAYER 16PX RIGHT');
  };
  if (scShiftLBtn) scShiftLBtn.addEventListener('click', () => shiftActiveLayer(-16));
  if (scShiftRBtn) scShiftRBtn.addEventListener('click', () => shiftActiveLayer(16));

  if (scSoloBtn) {
    scSoloBtn.addEventListener('click', () => {
      sc.solo = !sc.solo;
      scSoloBtn.classList.toggle('active', sc.solo);
      renderSceneryStudioCanvas();
      setStatus(sc.solo ? 'SOLO MODE: SHOWING ACTIVE LAYER ONLY' : 'SHOWING ALL VISIBLE LAYERS');
    });
  }

  if (scClearBtn) {
    scClearBtn.addEventListener('click', () => {
      const layer = getActiveLayer();
      if (!layer || !sc.activePixels) { SFX.playError(); return; }
      const hasAny = sc.activePixels.some(Boolean);
      if (!hasAny) {
        SFX.playError();
        setStatus('LAYER IS ALREADY EMPTY');
        return;
      }
      pushUndoSnapshot();
      sc.activePixels.fill(null);
      sc.polyPoints.length = 0;
      sc.lassoPoints.length = 0;
      commitActivePixels(true);
      renderSceneryStudioCanvas();
      setStatus('CLEARED ' + layer.name);
    });
  }

  if (scPolyFinishBtn) scPolyFinishBtn.addEventListener('click', finishPolygonShape);
  if (scPolyCancelBtn) scPolyCancelBtn.addEventListener('click', cancelPolygonShape);

  if (scStampScaleGroup) {
    scStampScaleGroup.addEventListener('click', e => {
      const btn = e.target.closest('button[data-stampscale]');
      if (!btn) return;
      sc.stampScale = clamp(parseInt(btn.dataset.stampscale, 10) || 1, 1, 3);
      scStampScaleGroup.querySelectorAll('button[data-stampscale]').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.stampscale, 10) === sc.stampScale);
      });
      renderSceneryStudioCanvas();
    });
  }
  if (scStampFlipBtn) {
    scStampFlipBtn.addEventListener('click', () => {
      sc.stampFlip = !sc.stampFlip;
      scStampFlipBtn.classList.toggle('active', sc.stampFlip);
      renderSceneryStudioCanvas();
    });
  }

  // Canvas pointer listeners
  if (scCanvas) {
    scCanvas.addEventListener('contextmenu', e => e.preventDefault());
    scCanvas.addEventListener('pointerdown', handleCanvasPointerDown);
    scCanvas.addEventListener('pointermove', handleCanvasPointerMove);
    scCanvas.addEventListener('pointerup', handleCanvasPointerUp);
    scCanvas.addEventListener('pointercancel', handleCanvasPointerUp);
    scCanvas.addEventListener('pointerleave', () => {
      if (!sc.drawing) {
        sc.hoverX = -1;
        sc.hoverY = -1;
        renderSceneryStudioCanvas();
      }
    });
    scCanvas.addEventListener('dblclick', e => {
      if (!sc.preview && sc.tool === 'poly' && sc.polyPoints.length >= 3) {
        e.preventDefault();
        finishPolygonShape();
      }
    });
  }

  // HSV / Alpha / Hex Picker bindings
  const bindDragCanvas = (wrapEl, onSample) => {
    if (!wrapEl) return;
    let dragging = false;
    const sample = e => {
      const rect = wrapEl.getBoundingClientRect();
      const nx = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const ny = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      onSample(nx, ny);
    };
    wrapEl.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      sample(e);
      try { wrapEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    wrapEl.addEventListener('pointermove', e => { if (dragging) sample(e); });
    const stop = e => {
      if (!dragging) return;
      dragging = false;
      try { wrapEl.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    wrapEl.addEventListener('pointerup', stop);
    wrapEl.addEventListener('pointercancel', stop);
  };

  bindDragCanvas(scSvWrap, (nx, ny) => {
    sc.hsv.s = nx;
    sc.hsv.v = 1 - ny;
    setScColorFromHSV();
  });
  bindDragCanvas(scHueWrap, nx => {
    sc.hsv.h = nx * 360;
    setScColorFromHSV();
  });
  bindDragCanvas(scAlphaWrap, nx => {
    sc.alpha = clamp(Math.round(nx * 20) / 20, 0.05, 1);
    setScColorFromHSV();
  });

  if (scHexInput) {
    scHexInput.addEventListener('change', () => {
      const norm = normalizeHex(scHexInput.value);
      if (norm) {
        setScColor(norm);
      } else {
        SFX.playError();
        updateScColorUI();
        setStatus('INVALID HEX COLOR');
      }
    });
  }

  if (scPickSkyBtn) {
    scPickSkyBtn.addEventListener('click', () => {
      const sky = sampleWorldSkyColor(getActiveWorld());
      const hex = rgbaToHex(sky.horizon.r, sky.horizon.g, sky.horizon.b, 1);
      setScColor(hex);
      showToast('SAMPLED WORLD SKY COLOR');
    });
  }
}
