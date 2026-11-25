import {
  brushShapeBtn,
  brushSizeBtn,
  edBrushHud,
  edCursorCoord,
  editorCanvas,
  editorCanvasFrame,
  editorStageScroll,
  edZoomLabel,
  shapeFillBtn
} from '../dom.js';
import { markEditorDirty } from './draft.js';
import {
  ensureColorInPalette,
  renderPaletteSwatches,
  setEditorColor,
  setEditorTransparent,
  updateColorSwatchUI
} from './palette.js';
import { drawEditorCanvas, refreshEditorAll, renderEditorPreview, updatePreviewHeaderUI } from './render.js';
import {
  applySelectionMaskOp,
  buildLassoMask,
  buildRectMask,
  buildWandMask,
  clearEditorSelection,
  commitFloatingSelection,
  editorHasSelection,
  getCompositeFramePixels,
  hasAnySelectedCell,
  isSelectionTool,
  liftSelectionToFloating,
  shiftSelectionMask,
  updateSelectionUI
} from './selection.js';
import {
  editor,
  isBodyRigMode,
  isLightGlowMode,
  selectLightGlowCell,
  setEditorMsg,
  syncActiveFramesFromState,
  syncLightGlowBuffers,
  updateBodyStateTabDots
} from './state.js';
import { state } from '../state.js';
import { clamp, createEmptyPixels } from '../utils.js';

export function applyEditorPanTransform() {
  editorCanvasFrame.style.transform = `translate(${Math.round(editor.panX)}px, ${Math.round(editor.panY)}px)`;
}

export function setEditorZoom(nextZoom, clientX = null, clientY = null) {
  const z = clamp(Math.round(nextZoom), 2, 48);
  if (z === editor.zoom && editorCanvas.width === editor.size * z) return;
  const oldZ = editor.zoom;
  if (clientX !== null && clientY !== null && oldZ > 0) {
    const rect = editorStageScroll.getBoundingClientRect();
    const relX = clientX - (rect.left + rect.width * 0.5) - editor.panX;
    const relY = clientY - (rect.top + rect.height * 0.5) - editor.panY;
    const ratio = z / oldZ;
    editor.panX -= relX * (ratio - 1);
    editor.panY -= relY * (ratio - 1);
  }
  editor.zoom = z;
  editorCanvas.width = editor.size * z;
  editorCanvas.height = editor.size * z;
  editorCanvas.style.width = editorCanvas.width + 'px';
  editorCanvas.style.height = editorCanvas.height + 'px';
  edZoomLabel.textContent = `${z}x`;
  applyEditorPanTransform();
  drawEditorCanvas();
}

export function fitEditorZoom() {
  const rect = editorStageScroll.getBoundingClientRect();
  const availW = Math.max(120, rect.width - 36);
  const availH = Math.max(120, rect.height - 36);
  const best = clamp(Math.floor(Math.min(availW, availH) / editor.size), 2, 32);
  editor.panX = 0;
  editor.panY = 0;
  editor.zoom = best;
  editorCanvas.width = editor.size * best;
  editorCanvas.height = editor.size * best;
  editorCanvas.style.width = editorCanvas.width + 'px';
  editorCanvas.style.height = editorCanvas.height + 'px';
  edZoomLabel.textContent = `${best}x`;
  applyEditorPanTransform();
  refreshEditorAll();
}

export function getEffectiveEditorTool() {
  if (editor.modCtrl) return 'move';
  if (isSelectionTool(editor.tool)) return editor.tool;
  if (editor.modShift) return 'eyedropper';
  if (editor.modAlt) return 'fill';
  return editor.tool;
}

export function syncEditorModifierUI() {
  const eff = getEffectiveEditorTool();
  editorCanvasFrame.classList.toggle('move-cursor', eff === 'move');
  editorCanvasFrame.classList.toggle('eyedrop-cursor', eff === 'eyedropper');
  editorCanvasFrame.classList.toggle('fill-cursor', eff === 'fill');
  editorCanvasFrame.classList.toggle('select-cursor', isSelectionTool(eff));
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === eff);
  });
}

export function setEditorTool(tool) {
  editor.tool = tool;
  if (tool === 'eraser') {
    editor.transparent = true;
    updateColorSwatchUI();
    renderPaletteSwatches();
  } else if (tool === 'pencil' && editor.transparent) {
    editor.transparent = false;
    updateColorSwatchUI();
    renderPaletteSwatches();
  }
  syncEditorModifierUI();
  drawEditorCanvas();
}

export function updateBrushUI() {
  brushSizeBtn.textContent = `${editor.brushSize}px`;
  brushShapeBtn.innerHTML = editor.brushShape === 'circle'
    ? '<svg class="px-ico" viewBox="0 0 12 12"><rect x="4" y="1" width="4" height="10"/><rect x="1" y="4" width="10" height="4"/><rect x="2" y="2" width="8" height="8"/></svg>'
    : '<svg class="px-ico" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8"/></svg>';
}

export function showBrushSizeHud() {
  edBrushHud.textContent = `${editor.brushSize}PX ${editor.brushShape.toUpperCase()}`;
  edBrushHud.classList.add('show');
  editor.brushPreviewUntil = state.uiTime + 0.85;
  drawEditorCanvas();
}

export function setEditorBrushSize(val, showHud = false) {
  const next = clamp(Math.round(val), 1, 12);
  editor.brushSize = next;
  updateBrushUI();
  if (showHud) showBrushSizeHud();
}

export function setEditorBrushShape(shape, showHud = false) {
  editor.brushShape = shape === 'circle' ? 'circle' : 'square';
  updateBrushUI();
  if (showHud) showBrushSizeHud();
}

export function updateShapeFillBtnUI() {
  shapeFillBtn.classList.toggle('active', editor.shapeFilled);
  shapeFillBtn.innerHTML = editor.shapeFilled
    ? '<svg class="px-ico" style="width:11px;height:11px" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8"/></svg><span>FILL</span>'
    : '<svg class="px-ico" style="width:11px;height:11px" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="1"/><rect x="2" y="9" width="8" height="1"/><rect x="2" y="3" width="1" height="6"/><rect x="9" y="3" width="1" height="6"/></svg><span>OUT</span>';
}

/* Editor Undo / Redo (body-state & light-glow cell aware) */
export function captureUndoSnapshot() {
  return {
    bodyState: isBodyRigMode() ? editor.bodyState : null,
    lightGlowCell: isLightGlowMode() ? editor.lightGlowCell : null,
    frameIdx: editor.frameIdx,
    size: editor.size,
    pixels: getCompositeFramePixels().slice(),
    selection: editor.selection ? editor.selection.slice() : null
  };
}

export function applyUndoSnapshot(snap) {
  if (!snap) return;
  editor.floating = null;
  if (isLightGlowMode() && snap.lightGlowCell !== null && snap.lightGlowCell !== editor.lightGlowCell) {
    selectLightGlowCell(snap.lightGlowCell, true);
  } else if (isBodyRigMode() && snap.bodyState && snap.bodyState !== editor.bodyState) {
    editor.bodyState = snap.bodyState;
    syncActiveFramesFromState();
    updateBodyStateTabDots();
    updatePreviewHeaderUI();
  }
  if (snap.size === editor.size) {
    editor.frameIdx = clamp(snap.frameIdx, 0, editor.frames.length - 1);
    editor.frames[editor.frameIdx] = snap.pixels.slice();
    editor.selection = (snap.selection && snap.selection.length === snap.size * snap.size)
      ? snap.selection.slice()
      : null;
    syncLightGlowBuffers();
    updateSelectionUI();
    refreshEditorAll();
    markEditorDirty();
  }
}

export function pushUndo() {
  editor.undoStack.push(captureUndoSnapshot());
  if (editor.undoStack.length > 60) editor.undoStack.shift();
  editor.redoStack.length = 0;
}

export function doUndo() {
  if (editor.undoStack.length === 0) return;
  editor.redoStack.push(captureUndoSnapshot());
  applyUndoSnapshot(editor.undoStack.pop());
}

export function doRedo() {
  if (editor.redoStack.length === 0) return;
  editor.undoStack.push(captureUndoSnapshot());
  applyUndoSnapshot(editor.redoStack.pop());
}

/* Pixel Drawing, Brush Footprint, Flood Fill & Toroidal Wrap-Around Shift */
export function getBrushOffsets(size, shape) {
  const n = clamp(Math.round(size), 1, 12);
  const min = -Math.floor((n - 1) / 2);
  const max = min + n - 1;
  const offsets = [];
  if (shape === 'circle' && n >= 3) {
    const center = (min + max) * 0.5;
    const rSq = (n * 0.5) * (n * 0.5);
    for (let dy = min; dy <= max; dy++) {
      for (let dx = min; dx <= max; dx++) {
        const distSq = (dx - center) * (dx - center) + (dy - center) * (dy - center);
        if (distSq <= rSq + 0.08) offsets.push([dx, dy]);
      }
    }
    return offsets;
  }
  for (let dy = min; dy <= max; dy++) {
    for (let dx = min; dx <= max; dx++) {
      offsets.push([dx, dy]);
    }
  }
  return offsets;
}

export function plotSinglePixel(pixels, x, y, hex, mirrorX) {
  const s = editor.size;
  const mask = (!editor.floating && hasAnySelectedCell(editor.selection)) ? editor.selection : null;
  if (x >= 0 && x < s && y >= 0 && y < s) {
    const idx = y * s + x;
    if (!mask || mask[idx]) pixels[idx] = hex;
  }
  if (mirrorX) {
    const mx = s - 1 - x;
    if (mx >= 0 && mx < s && y >= 0 && y < s) {
      const midx = y * s + mx;
      if (!mask || mask[midx]) pixels[midx] = hex;
    }
  }
}

export function stampBrushPixel(pixels, cx, cy, hex, mirrorX) {
  const offsets = getBrushOffsets(editor.brushSize, editor.brushShape);
  for (let i = 0; i < offsets.length; i++) {
    plotSinglePixel(pixels, cx + offsets[i][0], cy + offsets[i][1], hex, mirrorX);
  }
}

export function drawPixelLine(pixels, x0, y0, x1, y1, hex, mirrorX) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  let guard = 0;
  while (guard++ < 512) {
    stampBrushPixel(pixels, cx, cy, hex, mirrorX);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
}

export function drawPixelRect(pixels, x0, y0, x1, y1, hex, filled, mirrorX) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (filled || x === minX || x === maxX || y === minY || y === maxY) {
        plotSinglePixel(pixels, x, y, hex, mirrorX);
      }
    }
  }
}

export function drawPixelCircle(pixels, x0, y0, x1, y1, hex, filled, mirrorX) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const rx = Math.max(0.5, (maxX - minX) * 0.5 + 0.35);
  const ry = Math.max(0.5, (maxY - minY) * 0.5 + 0.35);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (filled) {
        if (d <= 1.0) plotSinglePixel(pixels, x, y, hex, mirrorX);
      } else if (d <= 1.0) {
        const inX = Math.max(0.01, rx - 1.05);
        const inY = Math.max(0.01, ry - 1.05);
        const id = ((x - cx) / inX) ** 2 + ((y - cy) / inY) ** 2;
        if (id >= 1.0 || rx <= 1.2 || ry <= 1.2) {
          plotSinglePixel(pixels, x, y, hex, mirrorX);
        }
      }
    }
  }
}

export function floodFill(pixels, sx, sy, fillHex) {
  const s = editor.size;
  const mask = (!editor.floating && hasAnySelectedCell(editor.selection)) ? editor.selection : null;
  if (mask && !mask[sy * s + sx]) return false;
  const target = pixels[sy * s + sx];
  if (target === fillHex) return false;
  const stack = [[sx, sy]];
  const visited = new Uint8Array(s * s);
  let changed = false;
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= s || y < 0 || y >= s) continue;
    const idx = y * s + x;
    if (visited[idx] || pixels[idx] !== target) continue;
    if (mask && !mask[idx]) continue;
    visited[idx] = 1;
    pixels[idx] = fillHex;
    changed = true;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return changed;
}

/* Seamless toroidal wrap-around shift (never clips or deletes pixels) */
export function shiftPixels(pixels, dx, dy) {
  const s = editor.size;
  const out = createEmptyPixels(s);
  const sx = ((dx % s) + s) % s;
  const sy = ((dy % s) + s) % s;
  for (let y = 0; y < s; y++) {
    const ny = (y + sy) % s;
    const srcRow = y * s;
    const dstRow = ny * s;
    for (let x = 0; x < s; x++) {
      out[dstRow + ((x + sx) % s)] = pixels[srcRow + x];
    }
  }
  return out;
}

export function nudgeEditorFrame(dx, dy) {
  if (editor.drawing) return;
  if (editorHasSelection()) {
    if (!editor.floating) {
      pushUndo();
      liftSelectionToFloating();
    }
    editor.floating.ox += dx;
    editor.floating.oy += dy;
    editor.selection = shiftSelectionMask(editor.floating.baseMask, editor.floating.ox, editor.floating.oy, editor.size);
    syncLightGlowBuffers();
    updateSelectionUI();
    drawEditorCanvas();
    renderEditorPreview();
    markEditorDirty();
    return;
  }
  pushUndo();
  editor.frames[editor.frameIdx] = shiftPixels(editor.frames[editor.frameIdx], dx, dy);
  syncLightGlowBuffers();
  refreshEditorAll();
  markEditorDirty();
}

export function getEditorCanvasCoords(e) {
  const rect = editorCanvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * editor.size);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * editor.size);
  return {
    x: clamp(x, 0, editor.size - 1),
    y: clamp(y, 0, editor.size - 1)
  };
}

export function applyEditorStroke(x, y, isStart) {
  const tool = editor.activeStrokeTool || getEffectiveEditorTool();
  const isErase = editor.drawButton === 2 || tool === 'eraser' || editor.transparent;
  const drawHex = isErase ? null : editor.color;

  if (tool === 'marquee') {
    if (x !== editor.selDragEndX || y !== editor.selDragEndY) editor.selDragMoved = true;
    editor.selDragEndX = x;
    editor.selDragEndY = y;
    drawEditorCanvas();
    return;
  }

  if (tool === 'lasso') {
    const pts = editor.selDragPoints;
    const last = pts[pts.length - 1];
    if (!last || last.x !== x || last.y !== y) {
      if (pts.length > 0) editor.selDragMoved = true;
      pts.push({ x, y });
      drawEditorCanvas();
    }
    return;
  }

  if (tool === 'move') {
    const dx = x - editor.startX;
    const dy = y - editor.startY;
    if (editor.floating) {
      editor.floating.ox = editor.floating.startOx + dx;
      editor.floating.oy = editor.floating.startOy + dy;
      editor.selection = shiftSelectionMask(editor.floating.baseMask, editor.floating.ox, editor.floating.oy, editor.size);
      syncLightGlowBuffers();
      drawEditorCanvas();
      renderEditorPreview();
      markEditorDirty();
      return;
    }
    if (!editor.strokeBase) return;
    editor.frames[editor.frameIdx] = shiftPixels(editor.strokeBase, dx, dy);
    syncLightGlowBuffers();
    drawEditorCanvas();
    renderEditorPreview();
    markEditorDirty();
    return;
  }

  if (tool === 'pencil' || tool === 'eraser') {
    const px = editor.frames[editor.frameIdx];
    if (isStart) {
      stampBrushPixel(px, x, y, drawHex, editor.mirrorX);
    } else {
      drawPixelLine(px, editor.lastX, editor.lastY, x, y, drawHex, editor.mirrorX);
    }
    if (drawHex) ensureColorInPalette(drawHex);
    editor.lastX = x;
    editor.lastY = y;
    syncLightGlowBuffers();
    drawEditorCanvas();
    renderEditorPreview();
    markEditorDirty();
    return;
  }

  if (tool === 'line' || tool === 'rect' || tool === 'circle') {
    if (!editor.strokeBase) return;
    const next = editor.strokeBase.slice();
    if (tool === 'line') {
      drawPixelLine(next, editor.startX, editor.startY, x, y, drawHex, editor.mirrorX);
    } else if (tool === 'rect') {
      drawPixelRect(next, editor.startX, editor.startY, x, y, drawHex, editor.shapeFilled, editor.mirrorX);
    } else {
      drawPixelCircle(next, editor.startX, editor.startY, x, y, drawHex, editor.shapeFilled, editor.mirrorX);
    }
    editor.frames[editor.frameIdx] = next;
    if (drawHex) ensureColorInPalette(drawHex);
    syncLightGlowBuffers();
    drawEditorCanvas();
    renderEditorPreview();
    markEditorDirty();
  }
}

export function stopEditorDraw(e) {
  if (!editor.drawing) return;
  const activeTool = editor.activeStrokeTool;
  const wasEyedropper = activeTool === 'eyedropper';
  const wasSelection = activeTool === 'marquee' || activeTool === 'lasso';
  editor.drawing = false;
  editor.strokeBase = null;
  editor.activeStrokeTool = null;
  if (e) {
    try { editorCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  if (activeTool === 'marquee') {
    if (!editor.selDragMoved && editor.selDragMode === 'replace' && editorHasSelection()) {
      clearEditorSelection(true, true);
    } else {
      const mask = buildRectMask(editor.startX, editor.startY, editor.selDragEndX, editor.selDragEndY, editor.size);
      const count = applySelectionMaskOp(mask, editor.selDragMode);
      setEditorMsg(count > 0 ? `SELECTED ${count} PX` : 'DESELECTED');
    }
    return;
  }

  if (activeTool === 'lasso') {
    const pts = editor.selDragPoints;
    editor.selDragPoints = [];
    if (!editor.selDragMoved && editor.selDragMode === 'replace' && editorHasSelection()) {
      clearEditorSelection(true, true);
    } else {
      const mask = buildLassoMask(pts, editor.size);
      const count = applySelectionMaskOp(mask, editor.selDragMode);
      setEditorMsg(count > 0 ? `SELECTED ${count} PX` : 'DESELECTED');
    }
    return;
  }

  syncLightGlowBuffers();
  refreshEditorAll();
  if (!wasEyedropper && !wasSelection) markEditorDirty();
}

export function initEditorCanvasEvents() {
  editorCanvas.addEventListener('contextmenu', e => e.preventDefault());
  editorCanvas.addEventListener('mousedown', e => {
    if (e.button === 1) e.preventDefault();
  });

  editorCanvas.addEventListener('pointerdown', e => {
    if (e.button === 1) return; // Middle mouse handled by stage pan
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();

    editor.modShift = e.shiftKey;
    editor.modAlt = e.altKey;
    editor.modCtrl = e.ctrlKey || e.metaKey;
    syncEditorModifierUI();

    const { x, y } = getEditorCanvasCoords(e);
    editor.hoverX = x;
    editor.hoverY = y;
    edCursorCoord.textContent = `${x}, ${y}`;

    const effTool = getEffectiveEditorTool();

    // Magic Wand Selection (Shift+Click adds to current selection, Alt+Click subtracts)
    if (effTool === 'wand') {
      if (e.button === 2) {
        clearEditorSelection(true, true);
        return;
      }
      commitFloatingSelection(true);
      const mode = e.shiftKey ? 'add' : (e.altKey ? 'sub' : 'replace');
      const mask = buildWandMask(editor.frames[editor.frameIdx], x, y, editor.size);
      const count = applySelectionMaskOp(mask, mode);
      setEditorMsg(count > 0 ? `SELECTED ${count} PX` : 'DESELECTED');
      return;
    }

    // Marquee & Lasso Selection (Shift+Drag/Click adds, Alt subtracts, RMB deselects)
    if (effTool === 'marquee' || effTool === 'lasso') {
      if (e.button === 2) {
        clearEditorSelection(true, true);
        return;
      }
      commitFloatingSelection(true);
      editor.drawing = true;
      editor.drawButton = e.button;
      editor.activeStrokeTool = effTool;
      editor.selDragMode = e.shiftKey ? 'add' : (e.altKey ? 'sub' : 'replace');
      editor.startX = x;
      editor.startY = y;
      editor.selDragEndX = x;
      editor.selDragEndY = y;
      editor.selDragMoved = false;
      editor.selDragPoints = effTool === 'lasso' ? [{ x, y }] : [];
      drawEditorCanvas();
      try { editorCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // Eyedropper (tool or Shift hold): picking empty canvas switches to transparency
    if (effTool === 'eyedropper') {
      const comp = getCompositeFramePixels();
      const picked = comp[y * editor.size + x];
      if (picked) {
        setEditorColor(picked);
      } else {
        setEditorTransparent(true);
      }
      editor.drawing = true;
      editor.activeStrokeTool = 'eyedropper';
      try { editorCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // Move Tool (V or Ctrl+Drag): lifts/drags active selection if present, else shifts whole frame
    if (effTool === 'move') {
      if (editorHasSelection()) {
        if (!editor.floating) {
          pushUndo();
          liftSelectionToFloating();
        }
        editor.floating.startOx = editor.floating.ox;
        editor.floating.startOy = editor.floating.oy;
        editor.drawing = true;
        editor.drawButton = e.button;
        editor.activeStrokeTool = 'move';
        editor.startX = x;
        editor.startY = y;
        try { editorCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }
      pushUndo();
      editor.drawing = true;
      editor.drawButton = e.button;
      editor.activeStrokeTool = 'move';
      editor.startX = x;
      editor.startY = y;
      editor.strokeBase = editor.frames[editor.frameIdx].slice();
      try { editorCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // Commit any active floating selection before painting or filling
    if (editor.floating) commitFloatingSelection(true);

    // Contiguous Flood Fill (tool or Alt hold)
    if (effTool === 'fill') {
      const fillHex = (e.button === 2 || editor.transparent) ? null : editor.color;
      pushUndo();
      if (floodFill(editor.frames[editor.frameIdx], x, y, fillHex)) {
        if (fillHex) ensureColorInPalette(fillHex);
        syncLightGlowBuffers();
        refreshEditorAll();
        markEditorDirty();
      } else {
        editor.undoStack.pop();
      }
      return;
    }

    pushUndo();
    editor.drawing = true;
    editor.drawButton = e.button;
    editor.activeStrokeTool = effTool;
    editor.startX = x;
    editor.startY = y;
    editor.lastX = x;
    editor.lastY = y;
    editor.strokeBase = editor.frames[editor.frameIdx].slice();
    applyEditorStroke(x, y, true);
    try { editorCanvas.setPointerCapture(e.pointerId); } catch (_) {}
  });

  editorCanvas.addEventListener('pointermove', e => {
    const { x, y } = getEditorCanvasCoords(e);
    const moved = x !== editor.hoverX || y !== editor.hoverY;
    editor.hoverX = x;
    editor.hoverY = y;
    edCursorCoord.textContent = `${x}, ${y}`;

    if (editor.drawing) {
      if (editor.activeStrokeTool === 'eyedropper') {
        const comp = getCompositeFramePixels();
        const picked = comp[y * editor.size + x];
        if (picked) setEditorColor(picked);
        else setEditorTransparent(true);
        return;
      }
      if (moved) applyEditorStroke(x, y, false);
    } else if (moved) {
      drawEditorCanvas();
    }
  });

  editorCanvas.addEventListener('pointerup', stopEditorDraw);
  editorCanvas.addEventListener('pointercancel', stopEditorDraw);
  editorCanvas.addEventListener('pointerleave', () => {
    editor.hoverX = -1;
    editor.hoverY = -1;
    if (!editor.drawing) drawEditorCanvas();
  });
}
