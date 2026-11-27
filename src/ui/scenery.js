import { SFX } from '../audio.js';
import {
  defaultFarbackOpts,
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
  scBottomFadeCheck,
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
  scDeselectBtn,
  scDriftSelect,
  sceneryModal,
  scGridBtn,
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
  scShapeFillBtn,
  scShiftLBtn,
  scShiftRBtn,
  scSizeGroup,
  scSkyChip,
  scSoloBtn,
  scStageWrap,
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
  scToolStatus,
  scUndoBtn,
  scWorldPill,
  scZoomInBtn,
  scZoomOutBtn,
  scZoomResetBtn,
  showToast,
  spriteNameInput
} from '../dom.js';
import { markEditorDirty } from '../editor/draft.js';
import { renderEditorPreview, updateFarbackOptionsUI } from '../editor/render.js';
import { editor } from '../editor/state.js';
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
import { decodeFrame, encodeFrame } from '../storage.js';
import { clamp, hexToRgb, hsvToRgb, normalizeHex, rgbaToHex, rgbToHsv } from '../utils.js';
import { closeOpenCustomSelect, syncCustomSelect } from './selects.js';

/* =========================================================================
   FARBACK STUDIO UI & CREATE-PARITY WIDE-CANVAS PIXEL/SELECTION/STAMP ENGINE
   ========================================================================= */

const W = 240;
const H = 120;
const ZOOM_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const BRUSH_SIZES = [1, 2, 4, 8, 14];
const MAX_UNDO = 30;
const STAGGER_DEPTHS = [0.12, 0.24, 0.38, 0.54, 0.18, 0.46];

const scFloatCanvas = document.createElement('canvas');
scFloatCanvas.width = W;
scFloatCanvas.height = H;
const scFloatCtx = scFloatCanvas.getContext('2d');
if (scFloatCtx) scFloatCtx.imageSmoothingEnabled = false;

const sc = {
  activeLayerId: null,
  activePixels: null,
  tool: 'brush', // 'marquee' | 'lassoSel' | 'wand' | 'move' | 'brush' | 'eraser' | 'fill' | 'pick' | 'line' | 'rect' | 'circle' | 'poly' | 'lassoFill' | 'stamp'
  activeStrokeTool: null,
  brushSize: 4,
  shapeFilled: true,
  showGrid: true,
  modShift: false,
  modAlt: false,
  modCtrl: false,
  zoom: 3,       // Physical pixel multiplier (W*zoom x H*zoom CSS px)
  panX: 0,       // CSS translate X of scCanvasFrame inside scStageWrap
  panY: 0,       // CSS translate Y of scCanvasFrame inside scStageWrap
  panning: false,
  panStartX: 0,
  panStartY: 0,
  panOriginX: 0,
  panOriginY: 0,
  panPointerId: null,
  spacePan: false,
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
  fillDragTarget: undefined,
  fillDragChanged: false,
  polyPoints: [],
  lassoPoints: [],
  selection: null,       // Uint8Array(W * H) | null
  floating: null,        // { basePixels, baseMask, ox, oy, startOx, startOy, fromStamp, stampSpriteId, stampScale, stampFlip } | null
  clipboard: null,       // { w, h, pixels, mask } | null
  selDragMode: 'replace',
  selDragEndX: 0,
  selDragEndY: 0,
  selDragMoved: false,
  selDragPoints: [],
  antsTickAccum: 0,
  stampSpriteId: null,
  stampScale: 1,
  stampFlip: false,
  undoStack: [],
  redoStack: [],
  autoStarterId: null
};

function ensureEditorFarback() {
  if (!editor.farbackOpts || typeof editor.farbackOpts !== 'object') {
    editor.farbackOpts = defaultFarbackOpts();
  }
  if (!Array.isArray(editor.farbackOpts.layers)) {
    editor.farbackOpts.layers = [];
  }
  return editor.farbackOpts;
}

function getLayers() {
  return ensureEditorFarback().layers;
}

function notifyFarbackChanged() {
  markEditorDirty();
  updateFarbackOptionsUI();
  renderEditorPreview();
}

function isScSelectionTool(tool) {
  return tool === 'marquee' || tool === 'lassoSel' || tool === 'wand';
}

function getEffectiveScTool() {
  if (sc.modCtrl) return 'move';
  if (isScSelectionTool(sc.tool)) return sc.tool;
  if (sc.modShift) return 'pick';
  if (sc.modAlt) return 'fill';
  return sc.tool;
}

function getBackingScale(z) {
  // Exact integer backing scale up to 8px/cell (1920x960 max) with 2x crisp integer CSS scaling at 10x/12x/16x
  return z <= 8 ? z : Math.max(4, Math.round(z / 2));
}

function applyScPanTransform() {
  if (!scCanvasFrame) return;
  if (sc.preview) {
    scCanvasFrame.style.transform = 'translate(0px, 0px)';
  } else {
    scCanvasFrame.style.transform = `translate(${Math.round(sc.panX)}px, ${Math.round(sc.panY)}px)`;
  }
}

function applyScCanvasSize() {
  if (!scCanvas) return;
  if (sc.preview) {
    const rect = scStageWrap ? scStageWrap.getBoundingClientRect() : { width: 744, height: 384 };
    const availW = Math.max(360, Math.floor((rect.width || 744) - 24));
    const availH = Math.max(180, Math.floor((rect.height || 384) - 24));
    const pw = Math.max(360, Math.min(720, Math.floor(Math.min(availW, availH * 2))));
    const ph = Math.max(180, Math.round(pw / 2));
    scCanvas.width = pw;
    scCanvas.height = ph;
    scCanvas.style.width = pw + 'px';
    scCanvas.style.height = ph + 'px';
    applyScPanTransform();
    return;
  }

  const bs = getBackingScale(sc.zoom);
  const bw = W * bs;
  const bh = H * bs;
  if (scCanvas.width !== bw) scCanvas.width = bw;
  if (scCanvas.height !== bh) scCanvas.height = bh;
  scCanvas.style.width = (W * sc.zoom) + 'px';
  scCanvas.style.height = (H * sc.zoom) + 'px';
  applyScPanTransform();
}

function updateZoomUI() {
  if (scZoomResetBtn) scZoomResetBtn.textContent = `${sc.zoom}x`;
  if (scZoomOutBtn) scZoomOutBtn.classList.toggle('disabled-soft', sc.zoom <= ZOOM_STEPS[0]);
  if (scZoomInBtn) scZoomInBtn.classList.toggle('disabled-soft', sc.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  if (scGridBtn) scGridBtn.classList.toggle('active', sc.showGrid);
  if (scStageWrap) {
    scStageWrap.classList.toggle('pan-ready', !sc.preview && sc.spacePan && !sc.panning);
    scStageWrap.classList.toggle('panning', !sc.preview && sc.panning);
  }
  if (scCanvasFrame) {
    scCanvasFrame.classList.toggle('pan-ready', !sc.preview && sc.spacePan && !sc.panning);
    scCanvasFrame.classList.toggle('panning', !sc.preview && sc.panning);
  }
}

function setScZoom(nextZoom, clientX = null, clientY = null) {
  const target = clamp(Math.round(Number(nextZoom) || 3), ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  let chosen = ZOOM_STEPS[0];
  let bestDiff = Infinity;
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const diff = Math.abs(ZOOM_STEPS[i] - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      chosen = ZOOM_STEPS[i];
    }
  }
  const oldZ = sc.zoom;
  if (chosen === oldZ && scCanvas && scCanvas.style.width === `${W * chosen}px`) return;

  if (clientX !== null && clientY !== null && scStageWrap && oldZ > 0) {
    const rect = scStageWrap.getBoundingClientRect();
    const relX = clientX - (rect.left + rect.width * 0.5) - sc.panX;
    const relY = clientY - (rect.top + rect.height * 0.5) - sc.panY;
    const ratio = chosen / oldZ;
    sc.panX -= relX * (ratio - 1);
    sc.panY -= relY * (ratio - 1);
  }

  sc.zoom = chosen;
  applyScCanvasSize();
  updateZoomUI();
  renderSceneryStudioCanvas();
}

function fitSceneryZoom() {
  const rect = scStageWrap ? scStageWrap.getBoundingClientRect() : null;
  const availW = rect && rect.width > 120 ? (rect.width - 28) : 720;
  const availH = rect && rect.height > 80 ? (rect.height - 28) : 360;
  const maxFit = Math.min(availW / W, availH / H);
  let best = ZOOM_STEPS[0];
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    if (ZOOM_STEPS[i] <= maxFit) best = ZOOM_STEPS[i];
  }
  best = clamp(best, 2, 6);
  sc.zoom = best;
  sc.panX = 0;
  sc.panY = 0;
  applyScCanvasSize();
  updateZoomUI();
  renderSceneryStudioCanvas();
}

function stepScZoom(delta, clientX = null, clientY = null) {
  const idx = ZOOM_STEPS.indexOf(sc.zoom);
  const curIdx = idx >= 0 ? idx : 2;
  const nextIdx = clamp(curIdx + (delta > 0 ? 1 : -1), 0, ZOOM_STEPS.length - 1);
  if (nextIdx === curIdx) return;
  setScZoom(ZOOM_STEPS[nextIdx], clientX, clientY);
  setStatus(`CANVAS ZOOM ${sc.zoom}X - MIDDLE OR SPACE+DRAG TO PAN`);
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
  if (persist) notifyFarbackChanged();
}

function updateUndoRedoButtons() {
  if (scUndoBtn) scUndoBtn.classList.toggle('disabled-soft', sc.undoStack.length === 0);
  if (scRedoBtn) scRedoBtn.classList.toggle('disabled-soft', sc.redoStack.length === 0);
}

function doSceneryUndo() {
  if (sc.floating) {
    // Undoing a floating move/stamp drops it cleanly via undo stack
    sc.floating = null;
    sc.selection = null;
  }
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
  sc.selection = null;
  sc.floating = null;
  commitActivePixels(true);
  updateSelectionUI();
  renderLayerList();
  syncLayerPropsUI();
  renderSceneryStudioCanvas();
  updateUndoRedoButtons();
  setStatus('UNDID CHANGE');
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
  sc.selection = null;
  sc.floating = null;
  commitActivePixels(true);
  updateSelectionUI();
  renderLayerList();
  syncLayerPropsUI();
  renderSceneryStudioCanvas();
  updateUndoRedoButtons();
  setStatus('REDID CHANGE');
}

/* =========================================================================
   SELECTION, FLOATING ASSETS & CLIPBOARD ENGINE (CREATE EDITOR PARITY)
   ========================================================================= */
function scHasSelection() {
  if (!sc.selection) return false;
  for (let i = 0; i < sc.selection.length; i++) {
    if (sc.selection[i]) return true;
  }
  return false;
}

function isCellInScSelection(x, y) {
  if (!sc.selection || x < 0 || x >= W || y < 0 || y >= H) return false;
  return sc.selection[y * W + x] === 1;
}

function isCellInScFloatingHitbox(x, y) {
  if (!sc.floating || !sc.selection) return false;
  if (isCellInScSelection(x, y)) return true;
  // Tight bounding-box hit test (+2px pad) so thin sprites like trees or rings are easy to grab
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let py = 0; py < H; py++) {
    const row = py * W;
    for (let px = 0; px < W; px++) {
      if (!sc.selection[row + px]) continue;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (maxX < minX) return false;
  // Skip bounding-box fallback when selection wraps across left/right edges (huge span)
  if ((maxX - minX) > W * 0.75) return false;
  return x >= minX - 2 && x <= maxX + 2 && y >= minY - 2 && y <= maxY + 2;
}

function updateSelectionUI() {
  if (scDeselectBtn) {
    scDeselectBtn.classList.toggle('disabled-soft', !scHasSelection() && !sc.floating);
  }
  syncScModifierUI();
}

function rebuildScFloatCanvas() {
  if (!scFloatCtx) return;
  scFloatCtx.clearRect(0, 0, W, H);
  if (!sc.floating) return;
  const img = scFloatCtx.createImageData(W, H);
  const data = img.data;
  const px = sc.floating.basePixels;
  const mask = sc.floating.baseMask;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const hex = px[i];
    if (!hex) continue;
    const rgb = hexToRgb(hex);
    const a255 = Math.round(clamp(rgb.a, 0, 1) * 255);
    if (a255 <= 0) continue;
    const off = i * 4;
    data[off] = rgb.r;
    data[off + 1] = rgb.g;
    data[off + 2] = rgb.b;
    data[off + 3] = a255;
  }
  scFloatCtx.putImageData(img, 0, 0);
}

function shiftScMask(baseMask, ox, oy, tileX) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ny = y + oy;
    if (ny < 0 || ny >= H) continue;
    const srcRow = y * W;
    const dstRow = ny * W;
    for (let x = 0; x < W; x++) {
      if (!baseMask[srcRow + x]) continue;
      let nx = x + ox;
      if (tileX) {
        nx = ((nx % W) + W) % W;
      } else if (nx < 0 || nx >= W) {
        continue;
      }
      out[dstRow + nx] = 1;
    }
  }
  return out;
}

function compositeFloatingInto(basePixels, floating, tileX) {
  const out = basePixels.slice();
  if (!floating) return out;
  const { basePixels: fp, baseMask: fm, ox, oy } = floating;
  for (let y = 0; y < H; y++) {
    const ny = y + oy;
    if (ny < 0 || ny >= H) continue;
    const srcRow = y * W;
    const dstRow = ny * W;
    for (let x = 0; x < W; x++) {
      if (!fm[srcRow + x]) continue;
      const hex = fp[srcRow + x];
      if (!hex) continue;
      let nx = x + ox;
      if (tileX) {
        nx = ((nx % W) + W) % W;
      } else if (nx < 0 || nx >= W) {
        continue;
      }
      out[dstRow + nx] = hex;
    }
  }
  return out;
}

function commitScFloating(persist = true) {
  if (!sc.floating) return false;
  const layer = getActiveLayer();
  if (layer && sc.activePixels) {
    sc.activePixels = compositeFloatingInto(sc.activePixels, sc.floating, layer.tileX !== false);
    sc.floating = null;
    commitActivePixels(persist);
  } else {
    sc.floating = null;
  }
  updateSelectionUI();
  return true;
}

function clearScSelection(commitFloat = true, render = true) {
  if (commitFloat && sc.floating) commitScFloating(true);
  sc.selection = null;
  sc.floating = null;
  updateSelectionUI();
  if (render) renderSceneryStudioCanvas();
}

function liftScSelectionToFloating() {
  if (!sc.selection || !sc.activePixels) return false;
  const basePixels = new Array(W * H).fill(null);
  const baseMask = new Uint8Array(W * H);
  let any = false;
  for (let i = 0; i < W * H; i++) {
    if (!sc.selection[i]) continue;
    baseMask[i] = 1;
    if (sc.activePixels[i]) {
      basePixels[i] = sc.activePixels[i];
      sc.activePixels[i] = null;
      any = true;
    }
  }
  sc.floating = {
    basePixels,
    baseMask,
    ox: 0,
    oy: 0,
    startOx: 0,
    startOy: 0,
    fromStamp: false,
    label: 'SELECTION'
  };
  rebuildScFloatCanvas();
  const layer = getActiveLayer();
  if (layer) syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
  updateSelectionUI();
  return any;
}

function buildScRectMask(x0, y0, x1, y1) {
  const mask = new Uint8Array(W * H);
  const minX = clamp(Math.min(x0, x1), 0, W - 1);
  const maxX = clamp(Math.max(x0, x1), 0, W - 1);
  const minY = clamp(Math.min(y0, y1), 0, H - 1);
  const maxY = clamp(Math.max(y0, y1), 0, H - 1);
  for (let y = minY; y <= maxY; y++) {
    const row = y * W;
    for (let x = minX; x <= maxX; x++) {
      mask[row + x] = 1;
    }
  }
  return mask;
}

function buildScLassoMask(pts) {
  const mask = new Uint8Array(W * H);
  if (!pts || pts.length === 0) return mask;
  if (pts.length < 3) {
    for (let i = 0; i < pts.length; i++) {
      const px = clamp(Math.round(pts[i].x), 0, W - 1);
      const py = clamp(Math.round(pts[i].y), 0, H - 1);
      mask[py * W + px] = 1;
    }
    return mask;
  }
  let minY = H, maxY = -1;
  for (let i = 0; i < pts.length; i++) {
    const py = Math.round(pts[i].y);
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  minY = clamp(minY, 0, H - 1);
  maxY = clamp(maxY, 0, H - 1);
  const nodes = [];
  for (let y = minY; y <= maxY; y++) {
    nodes.length = 0;
    const scanY = y + 0.5;
    let j = pts.length - 1;
    for (let i = 0; i < pts.length; i++) {
      const pi = pts[i];
      const pj = pts[j];
      if ((pi.y < scanY && pj.y >= scanY) || (pj.y < scanY && pi.y >= scanY)) {
        nodes.push(pi.x + ((scanY - pi.y) / (pj.y - pi.y)) * (pj.x - pi.x));
      }
      j = i;
    }
    nodes.sort((a, b) => a - b);
    for (let k = 0; k < nodes.length - 1; k += 2) {
      const xs = clamp(Math.round(nodes[k]), 0, W - 1);
      const xe = clamp(Math.round(nodes[k + 1]), 0, W - 1);
      for (let x = xs; x <= xe; x++) mask[y * W + x] = 1;
    }
  }
  // Ensure outline pixels are included too
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    let x0 = clamp(Math.round(a.x), 0, W - 1);
    let y0 = clamp(Math.round(a.y), 0, H - 1);
    const x1 = clamp(Math.round(b.x), 0, W - 1);
    const y1 = clamp(Math.round(b.y), 0, H - 1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, g = 0;
    while (g++ < 2000) {
      mask[y0 * W + x0] = 1;
      if (x0 === x1 && y0 === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }
  return mask;
}

function buildScWandMask(pixels, startX, startY, tileX) {
  const mask = new Uint8Array(W * H);
  if (!pixels || startX < 0 || startX >= W || startY < 0 || startY >= H) return mask;
  const target = pixels[startY * W + startX] || null;
  const stack = [startX, startY];
  while (stack.length > 0) {
    const cy = stack.pop();
    const cx = stack.pop();
    const idx = cy * W + cx;
    if (mask[idx]) continue;
    if ((pixels[idx] || null) !== target) continue;
    mask[idx] = 1;
    const lx = cx - 1;
    const rx = cx + 1;
    if (lx >= 0) stack.push(lx, cy);
    else if (tileX) stack.push(W - 1, cy);
    if (rx < W) stack.push(rx, cy);
    else if (tileX) stack.push(0, cy);
    if (cy > 0) stack.push(cx, cy - 1);
    if (cy + 1 < H) stack.push(cx, cy + 1);
  }
  return mask;
}

function applyScSelectionMaskOp(mask, mode = 'replace') {
  let next;
  if (mode === 'add' && sc.selection) {
    next = sc.selection.slice();
    for (let i = 0; i < W * H; i++) if (mask[i]) next[i] = 1;
  } else if (mode === 'sub' && sc.selection) {
    next = sc.selection.slice();
    for (let i = 0; i < W * H; i++) if (mask[i]) next[i] = 0;
  } else {
    next = mask;
  }
  let count = 0;
  for (let i = 0; i < W * H; i++) if (next[i]) count++;
  sc.selection = count > 0 ? next : null;
  updateSelectionUI();
  renderSceneryStudioCanvas();
  return count;
}

function selectAllScPixels() {
  const layer = getActiveLayer();
  if (!layer || !sc.activePixels) return;
  commitScFloating(true);
  const mask = new Uint8Array(W * H);
  let count = 0;
  for (let i = 0; i < W * H; i++) {
    if (sc.activePixels[i]) {
      mask[i] = 1;
      count++;
    }
  }
  if (count === 0) mask.fill(1);
  sc.selection = mask;
  updateSelectionUI();
  renderSceneryStudioCanvas();
  setStatus(count > 0 ? `SELECTED ${count} PIXELS` : 'SELECTED FULL LAYER');
}

function deleteScSelection() {
  const layer = getActiveLayer();
  if (!layer || !sc.activePixels) return;
  if (sc.floating) {
    // Discard floating selection (undo snapshot was pushed when lifted/stamped)
    sc.floating = null;
    sc.selection = null;
    commitActivePixels(true);
    updateSelectionUI();
    renderSceneryStudioCanvas();
    setStatus('DELETED SELECTION');
    return;
  }
  if (scHasSelection()) {
    const snap = sc.activePixels.slice();
    let changed = false;
    for (let i = 0; i < W * H; i++) {
      if (sc.selection[i] && sc.activePixels[i]) {
        sc.activePixels[i] = null;
        changed = true;
      }
    }
    if (changed) {
      pushUndoSnapshot(snap);
      commitActivePixels(true);
      setStatus('DELETED SELECTED PIXELS');
    } else {
      setStatus('SELECTION ALREADY EMPTY');
    }
    sc.selection = null;
    updateSelectionUI();
    renderSceneryStudioCanvas();
    return;
  }
  // No selection -> clear layer (matches Create Editor Delete behavior)
  if (!sc.activePixels.some(Boolean)) {
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
}

function copyScSelection(cut = false) {
  const layer = getActiveLayer();
  if (!layer || !sc.activePixels) {
    SFX.playError();
    return false;
  }
  const tileX = layer.tileX !== false;
  const comp = sc.floating ? compositeFloatingInto(sc.activePixels, sc.floating, tileX) : sc.activePixels;
  const hasSel = scHasSelection();

  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (hasSel && !sc.selection[row + x]) continue;
      if (!comp[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) {
    SFX.playError();
    setStatus('NOTHING TO COPY');
    return false;
  }

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const clipPx = new Array(cw * ch).fill(null);
  const clipMask = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = (minY + y) * W + (minX + x);
      if (hasSel && !sc.selection[si]) continue;
      const hex = comp[si];
      if (!hex) continue;
      clipPx[y * cw + x] = hex;
      clipMask[y * cw + x] = 1;
    }
  }
  sc.clipboard = { w: cw, h: ch, pixels: clipPx, mask: clipMask };

  if (cut) {
    if (sc.floating) {
      sc.floating = null;
      sc.selection = null;
      commitActivePixels(true);
    } else {
      pushUndoSnapshot();
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const idx = y * W + x;
          if (!hasSel || sc.selection[idx]) sc.activePixels[idx] = null;
        }
      }
      sc.selection = null;
      commitActivePixels(true);
    }
    updateSelectionUI();
    renderSceneryStudioCanvas();
    setStatus(`CUT ${cw}X${ch} PIXELS`);
  } else {
    setStatus(`COPIED ${cw}X${ch} PIXELS`);
  }
  return true;
}

function pasteScClipboard() {
  if (!sc.clipboard) {
    SFX.playError();
    setStatus('CLIPBOARD EMPTY');
    return false;
  }
  let layer = getActiveLayer();
  if (!layer) {
    addNewSceneryLayer();
    layer = getActiveLayer();
    if (!layer) return false;
  }
  if (!sc.activePixels) loadActiveLayerPixels();
  if (sc.floating) commitScFloating(true);

  pushUndoSnapshot();
  const { w: cw, h: ch, pixels: clipPx, mask: clipMask } = sc.clipboard;
  const ox0 = clamp(Math.floor((W - cw) * 0.5), 0, Math.max(0, W - cw));
  const oy0 = clamp(Math.floor((H - ch) * 0.5), 0, Math.max(0, H - ch));
  const basePixels = new Array(W * H).fill(null);
  const baseMask = new Uint8Array(W * H);

  for (let y = 0; y < ch; y++) {
    const ty = oy0 + y;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < cw; x++) {
      if (!clipMask[y * cw + x]) continue;
      const tx = ox0 + x;
      if (tx < 0 || tx >= W) continue;
      basePixels[ty * W + tx] = clipPx[y * cw + x];
      baseMask[ty * W + tx] = 1;
    }
  }
  sc.floating = {
    basePixels,
    baseMask,
    ox: 0,
    oy: 0,
    startOx: 0,
    startOy: 0,
    fromStamp: false,
    label: `PASTE ${cw}X${ch}`
  };
  sc.selection = baseMask.slice();
  rebuildScFloatCanvas();
  updateSelectionUI();
  renderSceneryStudioCanvas();
  setStatus(`PASTED ${cw}X${ch} - DRAG OR USE ARROWS TO POSITION`);
  return true;
}

function flipFloatingHorizontal() {
  if (!sc.floating) return false;
  const { basePixels, baseMask } = sc.floating;
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!baseMask[y * W + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) return false;
  const nextPx = new Array(W * H).fill(null);
  const nextMask = new Uint8Array(W * H);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const fx = minX + (maxX - x);
      const si = y * W + x;
      const di = y * W + fx;
      nextPx[di] = basePixels[si];
      nextMask[di] = baseMask[si];
    }
  }
  sc.floating.basePixels = nextPx;
  sc.floating.baseMask = nextMask;
  const layer = getActiveLayer();
  const tileX = layer ? (layer.tileX !== false) : true;
  sc.selection = shiftScMask(nextMask, sc.floating.ox, sc.floating.oy, tileX);
  rebuildScFloatCanvas();
  renderSceneryStudioCanvas();
  return true;
}

function placeSpriteAsFloating(sp, cx, cy) {
  const layer = getActiveLayer();
  if (!layer || !sc.activePixels || !sp || !Array.isArray(sp.frames) || !sp.frames[0]) return false;
  if (sc.floating) commitScFloating(true);

  const s = sp.size || 19;
  const src = decodeFrame(sp.frames[0], s);
  const scale = sc.stampScale;
  const drawW = s * scale;
  const drawH = s * scale;
  const ox = Math.round(cx - drawW * 0.5);
  const oy = Math.round(cy - drawH * 0.5);
  const tileX = layer.tileX !== false;

  const basePixels = new Array(W * H).fill(null);
  const baseMask = new Uint8Array(W * H);
  let any = false;

  for (let sy = 0; sy < s; sy++) {
    for (let sx = 0; sx < s; sx++) {
      const hex = src[sy * s + sx];
      if (!hex) continue;
      const fx = sc.stampFlip ? (s - 1 - sx) : sx;
      for (let py = 0; py < scale; py++) {
        const ty = oy + sy * scale + py;
        if (ty < 0 || ty >= H) continue;
        for (let px = 0; px < scale; px++) {
          let tx = ox + fx * scale + px;
          if (tileX) tx = ((tx % W) + W) % W;
          else if (tx < 0 || tx >= W) continue;
          basePixels[ty * W + tx] = hex;
          baseMask[ty * W + tx] = 1;
          any = true;
        }
      }
    }
  }
  if (!any) return false;

  pushUndoSnapshot();
  sc.floating = {
    basePixels,
    baseMask,
    ox: 0,
    oy: 0,
    startOx: 0,
    startOy: 0,
    fromStamp: true,
    label: sp.name
  };
  sc.selection = baseMask.slice();
  rebuildScFloatCanvas();
  updateSelectionUI();
  SFX.playPlaceBlock();
  renderSceneryStudioCanvas();
  setStatus(`STAMPED ${sp.name} - DRAG OR ARROWS TO MOVE, ENTER TO LOCK`);
  return true;
}

function nudgeScActive(dx, dy) {
  const layer = getActiveLayer();
  if (!layer || !sc.activePixels || sc.drawing) return;
  const tileX = layer.tileX !== false;
  if (scHasSelection() || sc.floating) {
    if (!sc.floating) {
      pushUndoSnapshot();
      liftScSelectionToFloating();
    }
    sc.floating.ox += dx;
    sc.floating.oy += dy;
    sc.selection = shiftScMask(sc.floating.baseMask, sc.floating.ox, sc.floating.oy, tileX);
    updateSelectionUI();
    renderSceneryStudioCanvas();
    return;
  }
  pushUndoSnapshot();
  sc.activePixels = shiftPixelsXY(sc.activePixels, dx, dy, tileX);
  commitActivePixels(true);
  renderSceneryStudioCanvas();
}

/* =========================================================================
   PIXEL RASTERIZATION HELPERS (SEAMLESS WRAP-AWARE BRUSH, LINE, SHAPES, FILL)
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

function paintRect(pixels, x0, y0, x1, y1, hex, filled, tileX) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  let changed = false;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!filled && x !== minX && x !== maxX && y !== minY && y !== maxY) continue;
      if (setPixel(pixels, x, y, hex, tileX)) changed = true;
    }
  }
  return changed;
}

function paintCircle(pixels, x0, y0, x1, y1, hex, filled, tileX) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const rx = Math.max(0.5, (maxX - minX) * 0.5);
  const ry = Math.max(0.5, (maxY - minY) * 0.5);
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const irx = Math.max(0, rx - 1);
  const iry = Math.max(0, ry - 1);
  let changed = false;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = (dx * dx) / rx2 + (dy * dy) / ry2;
      if (d > 1.04) continue;
      if (!filled && irx > 0.25 && iry > 0.25) {
        const inner = (dx * dx) / (irx * irx) + (dy * dy) / (iry * iry);
        if (inner < 0.88) continue;
      }
      if (setPixel(pixels, x, y, hex, tileX)) changed = true;
    }
  }
  return changed;
}

/* Crisp integer scanline polygon rasterizer (powers both POLY & SHAPE freehand fill!) */
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

/* Drag-safe flood fill segment (exact Create Editor Alt-fill parity: protects outlines while dragging) */
function applyScFloodFillSegment(pixels, x0, y0, x1, y1, fillHex, tileX) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;
  let guard = 0;
  let changed = false;

  while (guard++ < 1024) {
    if (cx >= 0 && cx < W && cy >= 0 && cy < H) {
      const curPx = pixels[cy * W + cx] || null;
      if (sc.fillDragTarget === undefined && curPx !== (fillHex || null)) {
        sc.fillDragTarget = curPx;
      }
      if (sc.fillDragTarget !== undefined && curPx === sc.fillDragTarget) {
        if (floodFillPixels(pixels, cx, cy, fillHex, tileX)) changed = true;
      }
    }
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
  return changed;
}

function shiftPixelsXY(pixels, deltaX, deltaY, tileX) {
  const out = new Array(W * H).fill(null);
  const sx = tileX ? (((deltaX % W) + W) % W) : deltaX;
  for (let y = 0; y < H; y++) {
    const ny = y + deltaY;
    if (ny < 0 || ny >= H) continue;
    const srcRow = y * W;
    const dstRow = ny * W;
    for (let x = 0; x < W; x++) {
      let nx = x + sx;
      if (tileX) {
        nx = nx % W;
      } else if (nx < 0 || nx >= W) {
        continue;
      }
      out[dstRow + nx] = pixels[srcRow + x];
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
        notifyFarbackChanged();
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
  notifyFarbackChanged();
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
      commitScFloating(true);
      sc.selection = null;
      sc.polyPoints.length = 0;
      sc.lassoPoints.length = 0;
      sc.activeLayerId = layer.id;
      loadActiveLayerPixels();
      updateSelectionUI();
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
      notifyFarbackChanged();
      renderLayerList();
      renderSceneryStudioCanvas();
    });

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn';
    upBtn.setAttribute('aria-label', 'Move layer closer');
    upBtn.innerHTML = '<svg class="px-ico px-ico-12" viewBox="0 0 12 12" aria-hidden="true"><rect x="5" y="1" width="2" height="2"/><rect x="4" y="3" width="4" height="1"/><rect x="3" y="4" width="6" height="1"/><rect x="2" y="5" width="8" height="1"/><rect x="5" y="6" width="2" height="5"/></svg>';
    upBtn.dataset.tip = 'Move layer closer to the front';
    if (i === 0) upBtn.classList.add('disabled-soft');
    upBtn.addEventListener('click', e => {
      e.stopPropagation();
      reorderLayerVisual(layer.id, -1);
    });

    const dnBtn = document.createElement('button');
    dnBtn.type = 'button';
    dnBtn.className = 'btn';
    dnBtn.setAttribute('aria-label', 'Move layer farther back');
    dnBtn.innerHTML = '<svg class="px-ico px-ico-12" viewBox="0 0 12 12" aria-hidden="true"><rect x="5" y="1" width="2" height="5"/><rect x="2" y="6" width="8" height="1"/><rect x="3" y="7" width="6" height="1"/><rect x="4" y="8" width="4" height="1"/><rect x="5" y="9" width="2" height="2"/></svg>';
    dnBtn.dataset.tip = 'Move layer farther into the background';
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
        setStatus(`MAX ${SCENERY_MAX_LAYERS} LAYERS PER FARBACK`);
        return;
      }
      commitScFloating(true);
      sc.selection = null;
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
      notifyFarbackChanged();
      updateSelectionUI();
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
        if (sc.activeLayerId === layer.id) {
          sc.floating = null;
          sc.selection = null;
        }
        const idx = layers.findIndex(l => l.id === layer.id);
        if (idx >= 0) layers.splice(idx, 1);
        sc.polyPoints.length = 0;
        sc.lassoPoints.length = 0;
        if (sc.activeLayerId === layer.id) {
          sc.activeLayerId = layers.length > 0 ? layers[layers.length - 1].id : null;
        }
        loadActiveLayerPixels();
        notifyFarbackChanged();
        updateSelectionUI();
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
  if (scBottomFadeCheck) scBottomFadeCheck.checked = Boolean(layer.bottomFade);

  updateAtmoReadout();
}

/* =========================================================================
   TOOL, MODIFIER & CONTEXT BAR UI (CREATE EDITOR PARITY)
   ========================================================================= */
function renderStampPickerStrip() {
  if (!scStampStrip) return;
  scStampStrip.innerHTML = '';
  const candidates = state.sprites.filter(sp => sp && !isGearType(sp.type) && sp.type !== 'FARBACK');
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
    btn.dataset.tip = `Stamp "${sp.name}" (${sp.size}x${sp.size}) - drag after stamping to move!`;
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

function updateShapeFillUI() {
  if (!scShapeFillBtn) return;
  scShapeFillBtn.classList.toggle('active', sc.shapeFilled);
  scShapeFillBtn.textContent = sc.shapeFilled ? 'FILL' : 'OUT';
}

function syncScModifierUI() {
  const eff = getEffectiveScTool();
  if (scCanvasFrame) {
    scCanvasFrame.classList.toggle('move-cursor', !sc.preview && eff === 'move');
    scCanvasFrame.classList.toggle('eyedrop-cursor', !sc.preview && eff === 'pick');
    scCanvasFrame.classList.toggle('fill-cursor', !sc.preview && eff === 'fill');
    scCanvasFrame.classList.toggle('select-cursor', !sc.preview && isScSelectionTool(eff));
  }
  if (scToolGroup) {
    scToolGroup.querySelectorAll('button[data-sctool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sctool === eff);
    });
  }
  if (scToolStatus) {
    let label = eff.toUpperCase();
    if (eff === 'brush' || eff === 'eraser' || eff === 'line') {
      label = `${eff.toUpperCase()} ${sc.brushSize}PX`;
    } else if (eff === 'rect' || eff === 'circle') {
      label = `${eff.toUpperCase()} ${sc.shapeFilled ? 'FILL' : 'OUT'}`;
    } else if (eff === 'marquee') {
      label = 'BOX SEL';
    } else if (eff === 'lassoSel') {
      label = 'LASSO SEL';
    } else if (eff === 'lassoFill') {
      label = 'SHAPE FILL';
    } else if (eff === 'pick') {
      label = sc.modShift && sc.tool !== 'pick' ? 'PICK (SHIFT)' : 'PICK';
    } else if (eff === 'fill') {
      label = sc.modAlt && sc.tool !== 'fill' ? 'FILL (ALT)' : 'FILL';
    } else if (eff === 'move') {
      label = sc.modCtrl && sc.tool !== 'move' ? 'MOVE (CTRL)' : 'MOVE';
    }
    if (sc.floating) label += ' | FLOAT';
    scToolStatus.textContent = label;
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
      : `${sc.polyPoints.length} POINTS - CLICK CORNERS | RMB UNDO POINT`;
  }
  if (showStamp) {
    renderStampPickerStrip();
  }
  if (!showPoly && !showStamp && scCtxHint) {
    if (sc.preview) {
      scCtxHint.textContent = 'Drag canvas to preview scrolling parallax.';
    } else if (sc.floating) {
      scCtxHint.textContent = 'Drag or press Arrows to move | Enter: Lock | Esc: Clear';
    } else if (sc.tool === 'move') {
      scCtxHint.textContent = scHasSelection()
        ? 'Drag to move selection | Ctrl+Arrows to nudge 1px.'
        : 'Drag to move layer | Select with S/Q/W to move pieces.';
    } else if (isScSelectionTool(sc.tool)) {
      scCtxHint.textContent = 'Shift: Add | Alt: Subtract | V/Ctrl: Move | Ctrl+C/X/V | RMB: Clear';
    } else if (sc.tool === 'lassoFill') {
      scCtxHint.textContent = 'Sketch any hill or cloud outline, release to fill.';
    } else if (sc.tool === 'fill') {
      scCtxHint.textContent = 'Click or drag to fill matching spaces | RMB erases.';
    } else if (sc.tool === 'line') {
      scCtxHint.textContent = 'Drag to draw a crisp straight line | RMB erases.';
    } else if (sc.tool === 'rect' || sc.tool === 'circle') {
      scCtxHint.textContent = 'Drag to draw shape | Toggle FILL/OUT | RMB erases.';
    } else if (sc.tool === 'pick') {
      scCtxHint.textContent = 'Click or drag on canvas to sample color.';
    } else {
      scCtxHint.textContent = 'Alt: Fill | Shift: Pick | Ctrl: Move | RMB: Erase';
    }
  }
  syncScModifierUI();
}

function setScTool(nextTool) {
  if (sc.preview) setScPreviewMode(false);
  if (sc.tool === 'poly' && nextTool !== 'poly' && sc.polyPoints.length > 0) {
    sc.polyPoints.length = 0;
  }
  // Commit floating asset automatically when switching to a painting/shape tool (keep alive for move/select/stamp!)
  if (sc.floating && nextTool !== 'move' && !isScSelectionTool(nextTool) && nextTool !== 'stamp') {
    commitScFloating(true);
  }
  sc.tool = nextTool;
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
  syncScModifierUI();
  renderSceneryStudioCanvas();
}

function stepScBrushSize(delta) {
  let idx = BRUSH_SIZES.indexOf(sc.brushSize);
  if (idx < 0) {
    idx = 0;
    for (let i = 0; i < BRUSH_SIZES.length; i++) {
      if (BRUSH_SIZES[i] <= sc.brushSize) idx = i;
    }
  }
  const next = BRUSH_SIZES[clamp(idx + (delta > 0 ? 1 : -1), 0, BRUSH_SIZES.length - 1)];
  setScBrushSize(next);
  setStatus(`BRUSH SIZE ${next}PX`);
}

function setScPreviewMode(on) {
  const next = Boolean(on);
  if (next && sc.floating) commitScFloating(true);
  sc.preview = next;
  sc.polyPoints.length = 0;
  sc.lassoPoints.length = 0;
  sc.drawing = false;
  if (scPreviewBtn) scPreviewBtn.classList.toggle('active', sc.preview);
  if (scCanvasFrame) scCanvasFrame.classList.toggle('preview-mode', sc.preview);
  applyScCanvasSize();
  updateZoomUI();
  updateContextBarUI();
  renderSceneryStudioCanvas();
}

/* =========================================================================
   WIDE CANVAS RENDERING (LIVE SKY + LAYERS + FLOATING ASSETS + MARCHING ANTS)
   ========================================================================= */
function drawSelectionMarchingAnts(ctx, mask, pxScale) {
  if (!mask) return;
  const dashPhase = Math.floor(state.uiTime * 8) & 3;
  ctx.save();
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (!mask[row + x]) continue;
      const sx = x * pxScale;
      const sy = y * pxScale;
      const topEdge = y === 0 || !mask[(y - 1) * W + x];
      const botEdge = y === H - 1 || !mask[(y + 1) * W + x];
      const leftEdge = x === 0 || !mask[row + x - 1];
      const rightEdge = x === W - 1 || !mask[row + x + 1];
      if (!topEdge && !botEdge && !leftEdge && !rightEdge) continue;

      const phase = ((x + y + dashPhase) & 2) === 0;
      ctx.fillStyle = phase ? '#ffffff' : '#0d0e11';
      if (topEdge) ctx.fillRect(sx, sy, pxScale, 1);
      if (botEdge) ctx.fillRect(sx, sy + pxScale - 1, pxScale, 1);
      if (leftEdge) ctx.fillRect(sx, sy, 1, pxScale);
      if (rightEdge) ctx.fillRect(sx + pxScale - 1, sy, 1, pxScale);
    }
  }
  ctx.restore();
}

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

  const pxScale = getBackingScale(sc.zoom);
  const toScrX = lx => lx * pxScale;
  const toScrY = ly => ly * pxScale;

  // Subtle horizon centerline & seam guides
  const midY = Math.round(ch * 0.5);
  const midX = Math.round(cw * 0.5);
  scCtx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  scCtx.fillRect(0, midY, cw, 1);
  scCtx.fillRect(midX, 0, 1, ch);

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
    const layerAlpha = clamp((layer.opacity ?? 95) / 100, 0.05, 1);
    scCtx.save();
    scCtx.globalAlpha = isAct ? layerAlpha : layerAlpha * 0.62;
    const yShiftLogical = isAct ? 0 : (Number(layer.yOffset) || 0) * 0.45;
    const drawY0 = Math.round(yShiftLogical * pxScale);
    if (img) scCtx.drawImage(img, 0, drawY0, cw, ch);

    // Draw movable floating selection / stamped asset directly over active layer
    if (isAct && sc.floating) {
      const fy = Math.round(sc.floating.oy * pxScale);
      if (layer.tileX !== false) {
        const wrapOx = ((sc.floating.ox % W) + W) % W;
        const fx = Math.round(wrapOx * pxScale);
        scCtx.drawImage(scFloatCanvas, fx, fy, cw, ch);
        if (wrapOx > 0) scCtx.drawImage(scFloatCanvas, fx - cw, fy, cw, ch);
      } else {
        const fx = Math.round(sc.floating.ox * pxScale);
        scCtx.drawImage(scFloatCanvas, fx, fy, cw, ch);
      }
    }
    scCtx.restore();
  }

  // Crisp pixel grid when zoomed in >= 5x and grid toggle is ON
  if (sc.showGrid && sc.zoom >= 5) {
    scCtx.save();
    scCtx.fillStyle = sc.zoom >= 10 ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.08)';
    for (let c = 1; c < W; c++) {
      scCtx.fillRect(c * pxScale, 0, 1, ch);
    }
    for (let r = 1; r < H; r++) {
      scCtx.fillRect(0, r * pxScale, cw, 1);
    }
    scCtx.restore();
  }

  // 3. Active Selection Marching Ants & Drag Selection Previews
  if (sc.selection) {
    drawSelectionMarchingAnts(scCtx, sc.selection, pxScale);
  }

  if (sc.drawing && sc.activeStrokeTool === 'marquee') {
    const minX = Math.min(sc.startX, sc.selDragEndX);
    const maxX = Math.max(sc.startX, sc.selDragEndX);
    const minY = Math.min(sc.startY, sc.selDragEndY);
    const maxY = Math.max(sc.startY, sc.selDragEndY);
    const rx = minX * pxScale;
    const ry = minY * pxScale;
    const rw = (maxX - minX + 1) * pxScale;
    const rh = (maxY - minY + 1) * pxScale;
    scCtx.save();
    scCtx.fillStyle = sc.selDragMode === 'sub' ? 'rgba(240, 100, 100, 0.16)' : 'rgba(242, 140, 56, 0.16)';
    scCtx.fillRect(rx, ry, rw, rh);
    scCtx.strokeStyle = sc.selDragMode === 'sub' ? '#f06464' : '#ffcf96';
    scCtx.lineWidth = 1;
    scCtx.setLineDash([4, 3]);
    scCtx.strokeRect(rx + 0.5, ry + 0.5, Math.max(1, rw - 1), Math.max(1, rh - 1));
    scCtx.restore();
  }

  if (sc.drawing && sc.activeStrokeTool === 'lassoSel' && sc.selDragPoints.length > 1) {
    scCtx.save();
    scCtx.beginPath();
    for (let i = 0; i < sc.selDragPoints.length; i++) {
      const sx = toScrX(sc.selDragPoints[i].x + 0.5);
      const sy = toScrY(sc.selDragPoints[i].y + 0.5);
      if (i === 0) scCtx.moveTo(sx, sy);
      else scCtx.lineTo(sx, sy);
    }
    scCtx.closePath();
    scCtx.fillStyle = sc.selDragMode === 'sub' ? 'rgba(240, 100, 100, 0.18)' : 'rgba(242, 140, 56, 0.18)';
    scCtx.fill();
    scCtx.strokeStyle = sc.selDragMode === 'sub' ? '#f06464' : '#ffffff';
    scCtx.lineWidth = 1;
    scCtx.setLineDash([3, 3]);
    scCtx.stroke();
    scCtx.restore();
  }

  // 4. Interactive Drawing Tool Overlays
  const effTool = getEffectiveScTool();
  if (active) {
    // Live Polygon shape vertices & rubberband
    if (effTool === 'poly' && sc.polyPoints.length > 0) {
      scCtx.save();
      scCtx.beginPath();
      for (let i = 0; i < sc.polyPoints.length; i++) {
        const sx = toScrX(sc.polyPoints[i].x + 0.5);
        const sy = toScrY(sc.polyPoints[i].y + 0.5);
        if (i === 0) scCtx.moveTo(sx, sy);
        else scCtx.lineTo(sx, sy);
      }
      if (sc.hoverX >= 0) {
        scCtx.lineTo(toScrX(sc.hoverX + 0.5), toScrY(sc.hoverY + 0.5));
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

      const closeRad = Math.max(2, 6 / Math.max(1, sc.zoom * 0.5));
      for (let i = 0; i < sc.polyPoints.length; i++) {
        const sx = Math.round(toScrX(sc.polyPoints[i].x + 0.5));
        const sy = Math.round(toScrY(sc.polyPoints[i].y + 0.5));
        const isCloseHot = i === 0 && sc.polyPoints.length >= 3 && sc.hoverX >= 0 &&
          Math.hypot(sc.hoverX - sc.polyPoints[0].x, sc.hoverY - sc.polyPoints[0].y) <= closeRad;
        const r = isCloseHot ? Math.max(4, pxScale) : Math.max(3, Math.floor(pxScale * 0.65));
        scCtx.fillStyle = isCloseHot ? '#f28c38' : '#ffffff';
        scCtx.fillRect(sx - r, sy - r, r * 2, r * 2);
        scCtx.strokeStyle = '#0d0e11';
        scCtx.lineWidth = 1;
        scCtx.strokeRect(sx - r - 0.5, sy - r - 0.5, r * 2 + 1, r * 2 + 1);
      }
      scCtx.restore();
    }

    // Live Freehand Fill (Shape) silhouette preview
    if (sc.drawing && sc.activeStrokeTool === 'lassoFill' && sc.lassoPoints.length > 1) {
      scCtx.save();
      scCtx.beginPath();
      for (let i = 0; i < sc.lassoPoints.length; i++) {
        const sx = toScrX(sc.lassoPoints[i].x + 0.5);
        const sy = toScrY(sc.lassoPoints[i].y + 0.5);
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

    // Live Stamp Sprite ghost preview (hide ghost while hovering inside a floating stamp ready to drag!)
    const overFloating = sc.floating && sc.hoverX >= 0 && isCellInScFloatingHitbox(sc.hoverX, sc.hoverY);
    if (effTool === 'stamp' && sc.hoverX >= 0 && sc.stampSpriteId && !overFloating && !sc.spacePan && !sc.panning) {
      const sp = getSpriteById(sc.stampSpriteId);
      if (sp && sp._canvases && sp._canvases[0]) {
        const dw = sp.size * sc.stampScale * pxScale;
        const dh = sp.size * sc.stampScale * pxScale;
        const ox = Math.round(toScrX(Math.round(sc.hoverX - sp.size * sc.stampScale * 0.5)));
        const oy = Math.round(toScrY(Math.round(sc.hoverY - sp.size * sc.stampScale * 0.5)));
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
    if ((effTool === 'brush' || effTool === 'eraser') && sc.hoverX >= 0 && !sc.spacePan && !sc.panning) {
      const half = Math.floor(sc.brushSize * 0.5);
      const bx = Math.round(toScrX(sc.hoverX - half));
      const by = Math.round(toScrY(sc.hoverY - half));
      const bs = Math.round(sc.brushSize * pxScale);
      scCtx.save();
      scCtx.strokeStyle = '#0d0e11';
      scCtx.lineWidth = 2;
      scCtx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
      scCtx.strokeStyle = effTool === 'eraser' ? '#f06464' : '#ffffff';
      scCtx.lineWidth = 1;
      scCtx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
      scCtx.restore();
    }
  }
}

export function tickSceneryStudioPreview(dt) {
  if (!sceneryModal || !sceneryModal.classList.contains('open')) return;
  if (sc.preview) {
    if (!sc.previewDragging) {
      sc.previewCamX += dt * 95;
    }
    renderSceneryStudioCanvas();
    return;
  }
  if (sc.selection) {
    sc.antsTickAccum += dt;
    if (sc.antsTickAccum >= 0.12) {
      sc.antsTickAccum = 0;
      renderSceneryStudioCanvas();
    }
  }
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
  if (sc.floating) commitScFloating(true);
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
   CANVAS & STAGE POINTER EVENTS (CREATE EDITOR PARITY)
   ========================================================================= */
function getCanvasCell(e) {
  const rect = scCanvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * W);
  const y = Math.floor(((e.clientY - rect.top) / Math.max(1, rect.height)) * H);
  return {
    x: clamp(x, 0, W - 1),
    y: clamp(y, 0, H - 1)
  };
}

function sampleColorAtCell(x, y) {
  const layer = getActiveLayer();
  const tileX = layer ? (layer.tileX !== false) : true;
  if (sc.activePixels) {
    const comp = sc.floating ? compositeFloatingInto(sc.activePixels, sc.floating, tileX) : sc.activePixels;
    const c = comp[y * W + x];
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

function startStagePan(e) {
  if (sc.preview) return;
  e.preventDefault();
  sc.panning = true;
  sc.panStartX = e.clientX;
  sc.panStartY = e.clientY;
  sc.panOriginX = sc.panX;
  sc.panOriginY = sc.panY;
  sc.panPointerId = e.pointerId;
  updateZoomUI();
  try { if (scStageWrap) scStageWrap.setPointerCapture(e.pointerId); } catch (_) {}
}

function handleStagePointerMove(e) {
  if (!sc.panning) return;
  sc.panX = sc.panOriginX + (e.clientX - sc.panStartX);
  sc.panY = sc.panOriginY + (e.clientY - sc.panStartY);
  applyScPanTransform();
}

function stopStagePan(e) {
  if (!sc.panning) return;
  sc.panning = false;
  sc.panPointerId = null;
  updateZoomUI();
  try { if (scStageWrap && e) scStageWrap.releasePointerCapture(e.pointerId); } catch (_) {}
}

function beginFloatingDrag(e, x, y) {
  sc.floating.startOx = sc.floating.ox;
  sc.floating.startOy = sc.floating.oy;
  sc.drawing = true;
  sc.drawBtn = e.button;
  sc.activeStrokeTool = 'move';
  sc.startX = x;
  sc.startY = y;
  if (scCanvasFrame) scCanvasFrame.classList.add('dragging-move');
  try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
}

function handleCanvasPointerDown(e) {
  if (e.button === 1 || (e.button === 0 && sc.spacePan && !sc.preview)) {
    return; // Handled cleanly by scStageWrap pan listener
  }
  if (e.button !== 0 && e.button !== 2) return;
  e.preventDefault();

  sc.modShift = e.shiftKey;
  sc.modAlt = e.altKey;
  sc.modCtrl = e.ctrlKey || e.metaKey;
  syncScModifierUI();

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
  if (scCoordEl) scCoordEl.textContent = `${x}, ${y}`;
  const tileX = layer.tileX !== false;
  const effTool = getEffectiveScTool();

  // 1. Direct drag of an active floating asset when clicking inside it with Stamp or Selection tools
  if (sc.floating && e.button === 0 && !sc.modAlt && !sc.modShift &&
      (effTool === 'stamp' || isScSelectionTool(effTool)) && isCellInScFloatingHitbox(x, y)) {
    beginFloatingDrag(e, x, y);
    return;
  }

  // 2. Magic Wand Selection (W: Shift adds, Alt subtracts, RMB deselects)
  if (effTool === 'wand') {
    if (e.button === 2) {
      clearScSelection(true, true);
      setStatus('DESELECTED');
      return;
    }
    if (sc.floating) commitScFloating(true);
    const mode = e.shiftKey ? 'add' : (e.altKey ? 'sub' : 'replace');
    const mask = buildScWandMask(sc.activePixels, x, y, tileX);
    const count = applyScSelectionMaskOp(mask, mode);
    setStatus(count > 0 ? `SELECTED ${count} PX - PRESS V OR HOLD CTRL TO MOVE` : 'DESELECTED');
    return;
  }

  // 3. Marquee (S) & Lasso Select (Q)
  if (effTool === 'marquee' || effTool === 'lassoSel') {
    if (e.button === 2) {
      clearScSelection(true, true);
      setStatus('DESELECTED');
      return;
    }
    if (sc.floating) commitScFloating(true);
    sc.drawing = true;
    sc.drawBtn = e.button;
    sc.activeStrokeTool = effTool;
    sc.selDragMode = e.shiftKey ? 'add' : (e.altKey ? 'sub' : 'replace');
    sc.startX = x;
    sc.startY = y;
    sc.selDragEndX = x;
    sc.selDragEndY = y;
    sc.selDragMoved = false;
    sc.selDragPoints = effTool === 'lassoSel' ? [{ x, y }] : [];
    renderSceneryStudioCanvas();
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  // 4. Eyedropper (I or hold Shift) - click & drag color sampling
  if (effTool === 'pick') {
    const picked = sampleColorAtCell(x, y);
    if (picked) {
      setScColor(picked);
      SFX.playPickup();
      setStatus('PICKED ' + picked.toUpperCase());
    } else {
      SFX.playError();
      setStatus('NO PIXEL TO SAMPLE');
    }
    sc.drawing = true;
    sc.drawBtn = e.button;
    sc.activeStrokeTool = 'pick';
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  // 5. Move Tool (V or hold Ctrl) - drags active selection / floating asset, else shifts whole layer
  if (effTool === 'move') {
    if (scHasSelection() || sc.floating) {
      if (!sc.floating) {
        pushUndoSnapshot();
        liftScSelectionToFloating();
      }
      beginFloatingDrag(e, x, y);
      return;
    }
    pushUndoSnapshot();
    sc.drawing = true;
    sc.drawBtn = e.button;
    sc.activeStrokeTool = 'move';
    sc.startX = x;
    sc.startY = y;
    sc.strokeSnap = sc.activePixels.slice();
    if (scCanvasFrame) scCanvasFrame.classList.add('dragging-move');
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  // 6. Stamp Sprite (T) - stamps as a floating movable asset! RMB flips (floating or next stamp)
  if (effTool === 'stamp') {
    if (e.button === 2) {
      if (sc.floating && sc.floating.fromStamp) {
        flipFloatingHorizontal();
        SFX.playRotate(true);
        setStatus('FLIPPED STAMP');
      } else {
        sc.stampFlip = !sc.stampFlip;
        if (scStampFlipBtn) scStampFlipBtn.classList.toggle('active', sc.stampFlip);
        SFX.playRotate(true);
        renderSceneryStudioCanvas();
      }
      return;
    }
    const sp = sc.stampSpriteId ? getSpriteById(sc.stampSpriteId) : null;
    if (!sp) {
      SFX.playError();
      setStatus('SELECT A SPRITE TO STAMP FIRST');
      return;
    }
    if (placeSpriteAsFloating(sp, x, y)) {
      // Allow dragging immediately in the same click-and-hold gesture!
      beginFloatingDrag(e, x, y);
    }
    return;
  }

  // Commit any floating asset before painting, filling, or drawing shapes
  if (sc.floating) commitScFloating(true);

  // 7. Polygon Fill (P)
  if (effTool === 'poly') {
    if (e.button === 2) {
      if (sc.polyPoints.length > 0) {
        sc.polyPoints.pop();
        updateContextBarUI();
        renderSceneryStudioCanvas();
        setStatus('REMOVED LAST VERTEX');
      }
      return;
    }
    const closeRad = Math.max(2, 6 / Math.max(1, sc.zoom * 0.5));
    if (sc.polyPoints.length >= 3 && Math.hypot(x - sc.polyPoints[0].x, y - sc.polyPoints[0].y) <= closeRad) {
      finishPolygonShape();
      return;
    }
    sc.polyPoints.push({ x, y });
    SFX.playButton('soft');
    updateContextBarUI();
    renderSceneryStudioCanvas();
    return;
  }

  // 8. Contiguous Flood Fill (G or hold Alt) - click OR drag across matching regions (RMB erases!)
  if (effTool === 'fill') {
    const fillHex = e.button === 2 ? null : sc.color;
    pushUndoSnapshot();
    sc.drawing = true;
    sc.drawBtn = e.button;
    sc.activeStrokeTool = 'fill';
    sc.startX = x;
    sc.startY = y;
    sc.lastX = x;
    sc.lastY = y;
    const initPx = sc.activePixels[y * W + x] || null;
    sc.fillDragTarget = initPx !== (fillHex || null) ? initPx : undefined;
    sc.fillDragChanged = false;
    if (applyScFloodFillSegment(sc.activePixels, x, y, x, y, fillHex, tileX)) {
      sc.fillDragChanged = true;
      syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
      SFX.playPlaceBlock();
      setStatus(fillHex ? 'FILLED REGION' : 'ERASED REGION');
    }
    renderSceneryStudioCanvas();
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  // 9. Freehand Fill Shape (F)
  if (effTool === 'lassoFill') {
    if (e.button === 2) return;
    sc.drawing = true;
    sc.drawBtn = 0;
    sc.activeStrokeTool = 'lassoFill';
    sc.lassoPoints = [{ x, y }];
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    renderSceneryStudioCanvas();
    return;
  }

  // 10. Line (L), Rectangle (R), Circle (O)
  if (effTool === 'line' || effTool === 'rect' || effTool === 'circle') {
    const paintHex = e.button === 2 ? null : sc.color;
    pushUndoSnapshot();
    sc.drawing = true;
    sc.drawBtn = e.button;
    sc.activeStrokeTool = effTool;
    sc.startX = x;
    sc.startY = y;
    sc.strokeSnap = sc.activePixels.slice();
    const next = sc.strokeSnap.slice();
    if (effTool === 'line') paintLine(next, x, y, x, y, sc.brushSize, paintHex, tileX);
    else if (effTool === 'rect') paintRect(next, x, y, x, y, paintHex, sc.shapeFilled, tileX);
    else paintCircle(next, x, y, x, y, paintHex, sc.shapeFilled, tileX);
    sc.activePixels = next;
    syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
    renderSceneryStudioCanvas();
    try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  // 11. Brush (B) / Eraser (E)
  const paintHex = (effTool === 'eraser' || e.button === 2) ? null : sc.color;
  sc.drawing = true;
  sc.drawBtn = e.button;
  sc.activeStrokeTool = effTool;
  sc.strokeSnap = sc.activePixels.slice();
  paintBrushDab(sc.activePixels, x, y, sc.brushSize, paintHex, tileX);
  sc.lastX = x;
  sc.lastY = y;
  syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
  renderSceneryStudioCanvas();
  try { scCanvas.setPointerCapture(e.pointerId); } catch (_) {}
}

function handleCanvasPointerMove(e) {
  if (sc.panning) {
    handleStagePointerMove(e);
    return;
  }
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
  const moved = x !== sc.hoverX || y !== sc.hoverY;
  sc.hoverX = x;
  sc.hoverY = y;
  if (scCoordEl) scCoordEl.textContent = `${x}, ${y}`;

  // Show grab cursor when hovering over a movable floating asset in stamp/select tools
  if (!sc.drawing && scCanvasFrame && sc.floating && (sc.tool === 'stamp' || isScSelectionTool(sc.tool))) {
    scCanvasFrame.classList.toggle('move-cursor', isCellInScFloatingHitbox(x, y) || getEffectiveScTool() === 'move');
  }

  if (!sc.drawing) {
    if (moved) renderSceneryStudioCanvas();
    return;
  }

  const layer = getActiveLayer();
  if (!layer || !sc.activePixels) return;
  const tileX = layer.tileX !== false;
  const tool = sc.activeStrokeTool;

  if (tool === 'pick') {
    if (moved) {
      const picked = sampleColorAtCell(x, y);
      if (picked) setScColor(picked);
    }
    return;
  }

  if (tool === 'marquee') {
    if (x !== sc.selDragEndX || y !== sc.selDragEndY) sc.selDragMoved = true;
    sc.selDragEndX = x;
    sc.selDragEndY = y;
    renderSceneryStudioCanvas();
    return;
  }

  if (tool === 'lassoSel') {
    const prev = sc.selDragPoints[sc.selDragPoints.length - 1];
    if (!prev || prev.x !== x || prev.y !== y) {
      if (sc.selDragPoints.length > 0) sc.selDragMoved = true;
      sc.selDragPoints.push({ x, y });
      renderSceneryStudioCanvas();
    }
    return;
  }

  if (tool === 'move') {
    if (!moved) return;
    const dx = x - sc.startX;
    const dy = y - sc.startY;
    if (sc.floating) {
      sc.floating.ox = sc.floating.startOx + dx;
      sc.floating.oy = sc.floating.startOy + dy;
      sc.selection = shiftScMask(sc.floating.baseMask, sc.floating.ox, sc.floating.oy, tileX);
      renderSceneryStudioCanvas();
      return;
    }
    if (sc.strokeSnap) {
      sc.activePixels = shiftPixelsXY(sc.strokeSnap, dx, dy, tileX);
      syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
      renderSceneryStudioCanvas();
    }
    return;
  }

  if (tool === 'fill') {
    if (!moved) return;
    const fillHex = sc.drawBtn === 2 ? null : sc.color;
    if (applyScFloodFillSegment(sc.activePixels, sc.lastX, sc.lastY, x, y, fillHex, tileX)) {
      sc.fillDragChanged = true;
      syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
      renderSceneryStudioCanvas();
    }
    sc.lastX = x;
    sc.lastY = y;
    return;
  }

  if (tool === 'lassoFill') {
    const prev = sc.lassoPoints[sc.lassoPoints.length - 1];
    if (!prev || Math.hypot(x - prev.x, y - prev.y) >= 2) {
      sc.lassoPoints.push({ x, y });
    }
    renderSceneryStudioCanvas();
    return;
  }

  if (tool === 'line' || tool === 'rect' || tool === 'circle') {
    if (!moved || !sc.strokeSnap) return;
    const paintHex = sc.drawBtn === 2 ? null : sc.color;
    const next = sc.strokeSnap.slice();
    if (tool === 'line') paintLine(next, sc.startX, sc.startY, x, y, sc.brushSize, paintHex, tileX);
    else if (tool === 'rect') paintRect(next, sc.startX, sc.startY, x, y, paintHex, sc.shapeFilled, tileX);
    else paintCircle(next, sc.startX, sc.startY, x, y, paintHex, sc.shapeFilled, tileX);
    sc.activePixels = next;
    syncSceneryLayerCanvasFromPixels(layer, sc.activePixels);
    renderSceneryStudioCanvas();
    return;
  }

  // Brush / Eraser
  const paintHex = (tool === 'eraser' || sc.drawBtn === 2) ? null : sc.color;
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
  if (sc.panning) {
    stopStagePan(e);
    return;
  }
  if (sc.preview) {
    if (sc.previewDragging) {
      sc.previewDragging = false;
      if (scCanvasFrame) scCanvasFrame.classList.remove('dragging');
      try { scCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    return;
  }
  if (!sc.drawing) return;

  const tool = sc.activeStrokeTool;
  const fillChanged = sc.fillDragChanged;
  sc.drawing = false;
  sc.activeStrokeTool = null;
  sc.fillDragTarget = undefined;
  sc.fillDragChanged = false;
  if (scCanvasFrame) scCanvasFrame.classList.remove('dragging-move');
  try { scCanvas.releasePointerCapture(e.pointerId); } catch (_) {}

  const layer = getActiveLayer();
  if (!layer || !sc.activePixels) return;
  const tileX = layer.tileX !== false;

  if (tool === 'pick') {
    return;
  }

  if (tool === 'marquee') {
    if (!sc.selDragMoved && sc.selDragMode === 'replace' && scHasSelection()) {
      clearScSelection(true, true);
      setStatus('DESELECTED');
    } else {
      const mask = buildScRectMask(sc.startX, sc.startY, sc.selDragEndX, sc.selDragEndY);
      const count = applyScSelectionMaskOp(mask, sc.selDragMode);
      setStatus(count > 0 ? `SELECTED ${count} PX - PRESS V OR HOLD CTRL TO MOVE` : 'DESELECTED');
    }
    return;
  }

  if (tool === 'lassoSel') {
    const pts = sc.selDragPoints.slice();
    sc.selDragPoints = [];
    if (!sc.selDragMoved && sc.selDragMode === 'replace' && scHasSelection()) {
      clearScSelection(true, true);
      setStatus('DESELECTED');
    } else {
      const mask = buildScLassoMask(pts);
      const count = applyScSelectionMaskOp(mask, sc.selDragMode);
      setStatus(count > 0 ? `SELECTED ${count} PX - PRESS V OR HOLD CTRL TO MOVE` : 'DESELECTED');
    }
    return;
  }

  if (tool === 'move') {
    sc.strokeSnap = null;
    if (sc.floating) {
      updateContextBarUI();
      renderSceneryStudioCanvas();
    } else {
      commitActivePixels(true);
      renderSceneryStudioCanvas();
    }
    return;
  }

  if (tool === 'fill') {
    if (!fillChanged) {
      sc.undoStack.pop();
      updateUndoRedoButtons();
      SFX.playError();
    } else {
      commitActivePixels(true);
    }
    renderSceneryStudioCanvas();
    return;
  }

  if (tool === 'lassoFill') {
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

  if (tool === 'line' || tool === 'rect' || tool === 'circle') {
    sc.strokeSnap = null;
    commitActivePixels(true);
    SFX.playPlaceBlock();
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
   ADD LAYER / OPEN / CLOSE / KEYBOARD SHORTCUTS (CREATE EDITOR PARITY)
   ========================================================================= */
function addNewSceneryLayer() {
  const layers = getLayers();
  if (layers.length >= SCENERY_MAX_LAYERS) {
    SFX.playError();
    setStatus(`MAX ${SCENERY_MAX_LAYERS} LAYERS PER FARBACK`);
    return;
  }
  commitScFloating(true);
  sc.selection = null;
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
  notifyFarbackChanged();
  updateSelectionUI();
  renderLayerList();
  syncLayerPropsUI();
  renderSceneryStudioCanvas();
  setStatus(`ADDED ${created.name} (${created.depth.toFixed(2)}X)`);
}

function resetScModifiers() {
  sc.modShift = false;
  sc.modAlt = false;
  sc.modCtrl = false;
  sc.spacePan = false;
  sc.panning = false;
  updateZoomUI();
  syncScModifierUI();
}

export function openSceneryModal() {
  if (!sceneryModal) return;
  if (audioPopover) audioPopover.classList.remove('open');
  if (physPopover) {
    physPopover.classList.remove('open');
    if (physMenuBtn) physMenuBtn.classList.remove('active');
  }
  if (pixoPopover) pixoPopover.classList.remove('open');

  const layers = getLayers();
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
  sc.selection = null;
  sc.floating = null;
  sc.drawing = false;
  sc.activeStrokeTool = null;
  sc.panning = false;
  sc.spacePan = false;
  sc.modShift = false;
  sc.modAlt = false;
  sc.modCtrl = false;
  sc.preview = false;
  sc.previewCamX = 0;
  sc.previewCamY = 0;
  if (scPreviewBtn) scPreviewBtn.classList.remove('active');
  if (scCanvasFrame) {
    scCanvasFrame.classList.remove(
      'preview-mode', 'dragging', 'pan-ready', 'panning',
      'move-cursor', 'dragging-move', 'eyedrop-cursor', 'fill-cursor', 'select-cursor'
    );
  }
  const spName = (spriteNameInput && spriteNameInput.value ? spriteNameInput.value.trim().toUpperCase() : '') || 'FARBACK';
  if (scWorldPill) scWorldPill.textContent = spName.slice(0, 20);

  loadActiveLayerPixels();
  renderScPaletteGrid();
  updateScColorUI();
  updateShapeFillUI();
  renderLayerList();
  syncLayerPropsUI();
  updateUndoRedoButtons();
  updateSelectionUI();
  updateContextBarUI();

  sceneryModal.classList.add('open');
  fitSceneryZoom();
  requestAnimationFrame(() => {
    if (sceneryModal && sceneryModal.classList.contains('open') && !sc.preview) {
      fitSceneryZoom();
    }
  });
  setStatus('Scroll to zoom canvas, Middle/Space+drag to pan | Alt: Fill | Shift: Pick | Ctrl: Move');
}

export function closeSceneryModal(silent = false) {
  if (!sceneryModal || !sceneryModal.classList.contains('open')) return;
  closeOpenCustomSelect(false);
  if (sc.floating) commitScFloating(true);
  sc.selection = null;
  sc.drawing = false;
  sc.activeStrokeTool = null;
  sc.preview = false;
  sc.polyPoints.length = 0;
  sc.lassoPoints.length = 0;
  resetScModifiers();
  if (scPreviewBtn) scPreviewBtn.classList.remove('active');
  if (scCanvasFrame) {
    scCanvasFrame.classList.remove(
      'preview-mode', 'dragging', 'pan-ready', 'panning',
      'move-cursor', 'dragging-move', 'eyedrop-cursor', 'fill-cursor', 'select-cursor'
    );
  }
  // Remove untouched auto-created starter layer if the user opened Farback Studio and left without drawing
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
  sceneryModal.classList.remove('open');
  if (!silent) {
    updateFarbackOptionsUI();
    renderEditorPreview();
  }
}

export function handleSceneryKeyup(e) {
  if (!sceneryModal || !sceneryModal.classList.contains('open')) return false;
  let handled = false;
  if (e.code === 'Space' && sc.spacePan) {
    sc.spacePan = false;
    updateZoomUI();
    renderSceneryStudioCanvas();
    handled = true;
  }
  if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
    sc.modShift = e.shiftKey;
    sc.modAlt = e.altKey;
    sc.modCtrl = e.ctrlKey || e.metaKey;
    syncScModifierUI();
    renderSceneryStudioCanvas();
    handled = true;
  }
  return handled;
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
    if (sc.floating || scHasSelection()) {
      clearScSelection(true, true);
      setStatus('COMMITTED & DESELECTED');
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

  // Live Create-Editor modifier keys (Alt = Fill, Shift = Eyedropper, Ctrl = Move)
  if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
    if (e.key === 'Alt') e.preventDefault();
    sc.modShift = e.shiftKey;
    sc.modAlt = e.altKey;
    sc.modCtrl = e.ctrlKey || e.metaKey;
    syncScModifierUI();
    renderSceneryStudioCanvas();
    return true;
  }

  if (e.key === 'Enter') {
    if (sc.tool === 'poly' && sc.polyPoints.length >= 3) {
      e.preventDefault();
      finishPolygonShape();
      return true;
    }
    if (sc.floating) {
      e.preventDefault();
      clearScSelection(true, true);
      SFX.playPlaceBlock();
      setStatus('LOCKED IN PLACE');
      return true;
    }
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (e.key === 'Backspace' && sc.tool === 'poly' && sc.polyPoints.length > 0) {
      sc.polyPoints.pop();
      updateContextBarUI();
      renderSceneryStudioCanvas();
      return true;
    }
    if (!e.repeat && (e.key === 'Delete' || scHasSelection() || sc.floating)) {
      deleteScSelection();
    }
    return true;
  }

  // Ctrl / Cmd shortcuts (Undo, Redo, Copy, Cut, Paste, Select All, Deselect, Nudge)
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
    if (e.code === 'KeyC') {
      e.preventDefault();
      copyScSelection(false);
      return true;
    }
    if (e.code === 'KeyX') {
      e.preventDefault();
      copyScSelection(true);
      return true;
    }
    if (e.code === 'KeyV') {
      e.preventDefault();
      pasteScClipboard();
      return true;
    }
    if (e.code === 'KeyA') {
      e.preventDefault();
      selectAllScPixels();
      return true;
    }
    if (e.code === 'KeyD') {
      e.preventDefault();
      clearScSelection(true, true);
      setStatus('DESELECTED');
      return true;
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeScActive(-1, 0); return true; }
    if (e.key === 'ArrowRight') { e.preventDefault(); nudgeScActive(1, 0); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); nudgeScActive(0, -1); return true; }
    if (e.key === 'ArrowDown') { e.preventDefault(); nudgeScActive(0, 1); return true; }
  }

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
      e.preventDefault();
      if (!sc.preview) stepScZoom(1);
      return true;
    }
    if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
      e.preventDefault();
      if (!sc.preview) stepScZoom(-1);
      return true;
    }
    if (e.key === '0' || e.code === 'Numpad0') {
      e.preventDefault();
      if (!sc.preview) {
        fitSceneryZoom();
        setStatus(`FIT CANVAS ${sc.zoom}X`);
      }
      return true;
    }
    if (e.key === '[') { e.preventDefault(); stepScBrushSize(-1); return true; }
    if (e.key === ']') { e.preventDefault(); stepScBrushSize(1); return true; }

    // Arrow keys: nudge floating selection/asset cleanly, otherwise pan zoomed canvas
    if (!sc.preview && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const step = e.shiftKey ? 8 : 1;
      if (sc.floating || scHasSelection()) {
        if (e.key === 'ArrowLeft') nudgeScActive(-step, 0);
        else if (e.key === 'ArrowRight') nudgeScActive(step, 0);
        else if (e.key === 'ArrowUp') nudgeScActive(0, -step);
        else if (e.key === 'ArrowDown') nudgeScActive(0, step);
      } else {
        const panStep = 48;
        if (e.key === 'ArrowLeft') sc.panX += panStep;
        else if (e.key === 'ArrowRight') sc.panX -= panStep;
        else if (e.key === 'ArrowUp') sc.panY += panStep;
        else if (e.key === 'ArrowDown') sc.panY -= panStep;
        applyScPanTransform();
      }
      return true;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (!sc.preview) {
        if (!sc.spacePan) {
          sc.spacePan = true;
          updateZoomUI();
          renderSceneryStudioCanvas();
        }
      } else {
        setScPreviewMode(false);
      }
      return true;
    }

    // Create-Editor Parity Single-Key Tool Shortcuts
    if (e.code === 'KeyS') { e.preventDefault(); setScTool('marquee'); return true; }
    if (e.code === 'KeyQ') { e.preventDefault(); setScTool('lassoSel'); return true; }
    if (e.code === 'KeyW') { e.preventDefault(); setScTool('wand'); return true; }
    if (e.code === 'KeyV') { e.preventDefault(); setScTool('move'); return true; }
    if (e.code === 'KeyB') { e.preventDefault(); setScTool('brush'); return true; }
    if (e.code === 'KeyE') { e.preventDefault(); setScTool('eraser'); return true; }
    if (e.code === 'KeyG') { e.preventDefault(); setScTool('fill'); return true; }
    if (e.code === 'KeyI') { e.preventDefault(); setScTool('pick'); return true; }
    if (e.code === 'KeyL') { e.preventDefault(); setScTool('line'); return true; }
    if (e.code === 'KeyR') { e.preventDefault(); setScTool('rect'); return true; }
    if (e.code === 'KeyO') { e.preventDefault(); setScTool('circle'); return true; }
    if (e.code === 'KeyP') { e.preventDefault(); setScTool('poly'); return true; }
    if (e.code === 'KeyF') { e.preventDefault(); setScTool('lassoFill'); return true; }
    if (e.code === 'KeyT') { e.preventDefault(); setScTool('stamp'); return true; }
  }
  return true;
}

/* =========================================================================
   STATIC UI INITIALIZATION
   ========================================================================= */
export function initSceneryUI() {
  window.addEventListener('spritelab:open-scenery', openSceneryModal);
  window.addEventListener('blur', () => {
    if (sceneryModal && sceneryModal.classList.contains('open')) {
      resetScModifiers();
    }
  });

  if (closeSceneryX) closeSceneryX.addEventListener('click', () => closeSceneryModal(false));
  if (closeSceneryBtn) closeSceneryBtn.addEventListener('click', () => closeSceneryModal(false));
  if (sceneryModal) {
    sceneryModal.addEventListener('click', e => {
      if (e.target === sceneryModal) closeSceneryModal(false);
    });
  }

  if (scZoomOutBtn) scZoomOutBtn.addEventListener('click', () => { if (!sc.preview) stepScZoom(-1); });
  if (scZoomInBtn) scZoomInBtn.addEventListener('click', () => { if (!sc.preview) stepScZoom(1); });
  if (scZoomResetBtn) {
    scZoomResetBtn.addEventListener('click', () => {
      if (!sc.preview) {
        fitSceneryZoom();
        setStatus(`FIT CANVAS ${sc.zoom}X`);
      }
    });
  }
  if (scGridBtn) {
    scGridBtn.addEventListener('click', () => {
      sc.showGrid = !sc.showGrid;
      updateZoomUI();
      renderSceneryStudioCanvas();
      setStatus(sc.showGrid ? 'PIXEL GRID ON (VISIBLE AT 5X+)' : 'PIXEL GRID OFF');
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
    if (scBottomFadeCheck) layer.bottomFade = scBottomFadeCheck.checked;
    invalidateSceneryLayerCache(layer);
    syncLayerPropsUI();
    if (rebuildList) renderLayerList();
    else refreshLayerThumb(layer);
    renderSceneryStudioCanvas();
    notifyFarbackChanged();
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
  if (scBottomFadeCheck) scBottomFadeCheck.addEventListener('change', () => onPropChange(false));

  // Tool & Brush Size buttons
  if (scToolGroup) {
    scToolGroup.addEventListener('click', e => {
      const btn = e.target.closest('button[data-sctool]');
      if (btn) setScTool(btn.dataset.sctool);
    });
  }
  if (scDeselectBtn) {
    scDeselectBtn.addEventListener('click', () => {
      if (scHasSelection() || sc.floating) {
        clearScSelection(true, true);
        setStatus('DESELECTED');
      }
    });
  }
  if (scShapeFillBtn) {
    scShapeFillBtn.addEventListener('click', () => {
      sc.shapeFilled = !sc.shapeFilled;
      updateShapeFillUI();
      syncScModifierUI();
      setStatus(sc.shapeFilled ? 'SHAPES: SOLID FILL' : 'SHAPES: OUTLINE');
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
    if (sc.floating) commitScFloating(true);
    pushUndoSnapshot();
    sc.activePixels = shiftPixelsXY(sc.activePixels, delta, 0, true);
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
    scClearBtn.addEventListener('click', deleteScSelection);
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
      if (sc.floating && sc.floating.fromStamp) {
        flipFloatingHorizontal();
        SFX.playRotate(true);
        setStatus('FLIPPED STAMP');
      } else {
        sc.stampFlip = !sc.stampFlip;
        scStampFlipBtn.classList.toggle('active', sc.stampFlip);
        renderSceneryStudioCanvas();
      }
    });
  }

  // Stage-level wheel zoom & middle-drag / Space-drag pan (works on margins AND canvas just like Create Editor!)
  if (scStageWrap) {
    scStageWrap.addEventListener('contextmenu', e => e.preventDefault());
    scStageWrap.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    scStageWrap.addEventListener('wheel', e => {
      if (sc.preview) return;
      e.preventDefault();
      stepScZoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    }, { passive: false });
    scStageWrap.addEventListener('pointerdown', e => {
      if (e.button === 1 || (e.button === 0 && sc.spacePan && !sc.preview)) {
        startStagePan(e);
      }
    });
    scStageWrap.addEventListener('pointermove', handleStagePointerMove);
    scStageWrap.addEventListener('pointerup', stopStagePan);
    scStageWrap.addEventListener('pointercancel', stopStagePan);
  }

  // Canvas pointer listeners
  if (scCanvas) {
    scCanvas.addEventListener('contextmenu', e => e.preventDefault());
    scCanvas.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
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
