import { deselectBtn } from '../dom.js';
import { markEditorDirty } from './draft.js';
import { drawEditorCanvas, refreshEditorAll } from './render.js';
import { editor, setEditorMsg, syncLightGlowBuffers } from './state.js';
import { pushUndo } from './tools.js';
import { clamp, createEmptyPixels } from '../utils.js';

export function isSelectionTool(tool) {
  return tool === 'marquee' || tool === 'lasso' || tool === 'wand';
}

export function hasAnySelectedCell(mask) {
  if (!mask) return false;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) return true;
  }
  return false;
}

export function editorHasSelection() {
  return Boolean(editor.floating || hasAnySelectedCell(editor.selection));
}

export function updateSelectionUI() {
  const hasSel = editorHasSelection();
  if (deselectBtn) {
    deselectBtn.classList.toggle('disabled-soft', !hasSel);
    deselectBtn.classList.toggle('active', hasSel);
  }
}

export function getCompositeFramePixels(framePixels = null) {
  const base = framePixels || editor.frames[editor.frameIdx];
  if (!base) return createEmptyPixels(editor.size);
  if (!editor.floating || !editor.floating.pixels) return base;
  const s = editor.size;
  const out = base.slice();
  const fp = editor.floating.pixels;
  const ox = editor.floating.ox;
  const oy = editor.floating.oy;
  for (let y = 0; y < s; y++) {
    const ny = y + oy;
    if (ny < 0 || ny >= s) continue;
    const srcRow = y * s;
    const dstRow = ny * s;
    for (let x = 0; x < s; x++) {
      const hex = fp[srcRow + x];
      if (!hex) continue;
      const nx = x + ox;
      if (nx >= 0 && nx < s) out[dstRow + nx] = hex;
    }
  }
  return out;
}

export function commitFloatingSelection(markDirty = true) {
  if (!editor.floating) return false;
  editor.frames[editor.frameIdx] = getCompositeFramePixels();
  editor.floating = null;
  syncLightGlowBuffers();
  updateSelectionUI();
  if (markDirty) markEditorDirty();
  return true;
}

export function clearEditorSelection(commit = true, showMsg = false) {
  const hadSel = editorHasSelection();
  if (commit) commitFloatingSelection(true);
  else editor.floating = null;
  editor.selection = null;
  editor.selDragPoints = [];
  updateSelectionUI();
  if (hadSel) {
    refreshEditorAll();
    if (showMsg) setEditorMsg('DESELECTED');
  }
  return hadSel;
}

export function shiftSelectionMask(mask, dx, dy, s) {
  if (!mask) return null;
  const out = new Uint8Array(s * s);
  let any = false;
  for (let y = 0; y < s; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= s) continue;
    const srcRow = y * s;
    const dstRow = ny * s;
    for (let x = 0; x < s; x++) {
      if (!mask[srcRow + x]) continue;
      const nx = x + dx;
      if (nx >= 0 && nx < s) {
        out[dstRow + nx] = 1;
        any = true;
      }
    }
  }
  return any ? out : null;
}

export function liftSelectionToFloating() {
  if (editor.floating) return true;
  if (!hasAnySelectedCell(editor.selection)) return false;
  const s = editor.size;
  const cur = editor.frames[editor.frameIdx];
  const floated = createEmptyPixels(s);
  const remaining = cur.slice();
  for (let i = 0; i < s * s; i++) {
    if (editor.selection[i] && cur[i]) {
      floated[i] = cur[i];
      remaining[i] = null;
    }
  }
  editor.frames[editor.frameIdx] = remaining;
  editor.floating = {
    pixels: floated,
    ox: 0,
    oy: 0,
    startOx: 0,
    startOy: 0,
    baseMask: editor.selection.slice()
  };
  updateSelectionUI();
  return true;
}

export function buildRectMask(x0, y0, x1, y1, s) {
  const mask = new Uint8Array(s * s);
  const minX = clamp(Math.min(x0, x1), 0, s - 1);
  const maxX = clamp(Math.max(x0, x1), 0, s - 1);
  const minY = clamp(Math.min(y0, y1), 0, s - 1);
  const maxY = clamp(Math.max(y0, y1), 0, s - 1);
  for (let y = minY; y <= maxY; y++) {
    const row = y * s;
    for (let x = minX; x <= maxX; x++) {
      mask[row + x] = 1;
    }
  }
  return mask;
}

export function rasterMaskSegment(mask, x0, y0, x1, y1, s) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  let guard = 0;
  while (guard++ < 512) {
    if (cx >= 0 && cx < s && cy >= 0 && cy < s) mask[cy * s + cx] = 1;
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
}

export function buildLassoMask(points, s) {
  const mask = new Uint8Array(s * s);
  if (!points || points.length === 0) return mask;
  if (points.length === 1) {
    const p = points[0];
    if (p.x >= 0 && p.x < s && p.y >= 0 && p.y < s) mask[p.y * s + p.x] = 1;
    return mask;
  }

  // Mark polygon perimeter pixels so even thin freehand loops stay intact
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    rasterMaskSegment(mask, a.x, a.y, b.x, b.y, s);
  }

  // Fill polygon interior via ray-casting at pixel centers
  let minX = s - 1, maxX = 0, minY = s - 1, maxY = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].x < minX) minX = points[i].x;
    if (points[i].x > maxX) maxX = points[i].x;
    if (points[i].y < minY) minY = points[i].y;
    if (points[i].y > maxY) maxY = points[i].y;
  }
  minX = clamp(minX, 0, s - 1);
  maxX = clamp(maxX, 0, s - 1);
  minY = clamp(minY, 0, s - 1);
  maxY = clamp(maxY, 0, s - 1);

  const n = points.length;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      if (mask[y * s + x]) continue;
      const px = x + 0.5;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = points[i].x + 0.5, yi = points[i].y + 0.5;
        const xj = points[j].x + 0.5, yj = points[j].y + 0.5;
        const intersect = ((yi > py) !== (yj > py)) &&
          (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      if (inside) mask[y * s + x] = 1;
    }
  }
  return mask;
}

export function buildWandMask(pixels, sx, sy, s) {
  const mask = new Uint8Array(s * s);
  if (sx < 0 || sx >= s || sy < 0 || sy >= s) return mask;
  const target = pixels[sy * s + sx];
  const stack = [[sx, sy]];
  const visited = new Uint8Array(s * s);
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= s || y < 0 || y >= s) continue;
    const idx = y * s + x;
    if (visited[idx] || pixels[idx] !== target) continue;
    visited[idx] = 1;
    mask[idx] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return mask;
}

export function applySelectionMaskOp(nextMask, mode = 'replace') {
  const s = editor.size;
  const total = s * s;
  const out = new Uint8Array(total);
  const prev = (editor.selection && editor.selection.length === total) ? editor.selection : null;
  let count = 0;

  for (let i = 0; i < total; i++) {
    const a = prev ? prev[i] : 0;
    const b = nextMask ? nextMask[i] : 0;
    let v = 0;
    if (mode === 'add') v = (a || b) ? 1 : 0;
    else if (mode === 'sub') v = (a && !b) ? 1 : 0;
    else v = b ? 1 : 0;
    out[i] = v;
    if (v) count++;
  }

  editor.selection = count > 0 ? out : null;
  updateSelectionUI();
  drawEditorCanvas();
  return count;
}

export function selectAllEditorPixels() {
  commitFloatingSelection(true);
  const s = editor.size;
  const mask = new Uint8Array(s * s);
  mask.fill(1);
  editor.selection = mask;
  updateSelectionUI();
  drawEditorCanvas();
  setEditorMsg('SELECTED ALL');
}

export function deleteSelectedPixels() {
  if (!editorHasSelection()) return false;
  pushUndo();
  if (editor.floating) {
    editor.floating = null;
    syncLightGlowBuffers();
    refreshEditorAll();
    markEditorDirty();
    setEditorMsg('CLEARED SELECTION');
    return true;
  }
  const s = editor.size;
  const cur = editor.frames[editor.frameIdx];
  let changed = false;
  for (let i = 0; i < s * s; i++) {
    if (editor.selection[i] && cur[i]) {
      cur[i] = null;
      changed = true;
    }
  }
  if (!changed) {
    editor.undoStack.pop();
    return false;
  }
  syncLightGlowBuffers();
  refreshEditorAll();
  markEditorDirty();
  setEditorMsg('CLEARED SELECTION');
  return true;
}

export function writeStampToSystemClipboard(stamp) {
  if (!stamp) return;
  editor.writingClipboard = true;
  try {
    const prevFocus = document.activeElement;
    const ta = document.createElement('textarea');
    ta.value = stamp;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    if (prevFocus && prevFocus !== document.body && typeof prevFocus.focus === 'function') {
      prevFocus.focus({ preventScroll: true });
    }
  } catch (_) {
    // Internal editor.clipboard remains available even if OS clipboard is restricted
  } finally {
    editor.writingClipboard = false;
  }
}

export function copyEditorSelection(isCut = false) {
  const s = editor.size;
  const src = getCompositeFramePixels();
  const mask = hasAnySelectedCell(editor.selection) ? editor.selection : null;

  let minX = s, maxX = -1, minY = s, maxY = -1;
  for (let y = 0; y < s; y++) {
    const row = y * s;
    for (let x = 0; x < s; x++) {
      const idx = row + x;
      if (mask && !mask[idx]) continue;
      if (!src[idx]) continue; // Never copy transparent space
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    setEditorMsg('NOTHING TO COPY');
    return null;
  }

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const pixels = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (minY + y) * s + (minX + x);
      if (mask && !mask[idx]) continue;
      if (src[idx]) pixels[y * w + x] = src[idx];
    }
  }

  const stamp = 'SPRITELAB_CLIP:' + Date.now();
  editor.clipboard = { w, h, ox: minX, oy: minY, pixels, stamp };
  editor.clipboardPreferInternal = true;

  if (isCut) {
    pushUndo();
    if (editor.floating) {
      editor.floating = null;
      editor.selection = null;
      updateSelectionUI();
    } else {
      const cur = editor.frames[editor.frameIdx];
      for (let i = 0; i < s * s; i++) {
        if (!mask || mask[i]) cur[i] = null;
      }
    }
    syncLightGlowBuffers();
    refreshEditorAll();
    markEditorDirty();
    setEditorMsg(`CUT ${w}x${h}`);
  } else {
    setEditorMsg(`COPIED ${w}x${h}`);
  }
  return stamp;
}

export function pasteEditorClipboard() {
  if (!editor.clipboard || !editor.clipboard.pixels) return false;
  commitFloatingSelection(true);
  pushUndo();

  const s = editor.size;
  const cb = editor.clipboard;
  const floated = createEmptyPixels(s);
  const mask = new Uint8Array(s * s);

  // Keep exact cel-to-cel alignment when it fits; center cleanly if pasting onto a smaller/different canvas
  const baseOx = (cb.ox + cb.w <= s && cb.oy + cb.h <= s)
    ? cb.ox
    : Math.floor((s - cb.w) * 0.5);
  const baseOy = (cb.ox + cb.w <= s && cb.oy + cb.h <= s)
    ? cb.oy
    : Math.floor((s - cb.h) * 0.5);

  let count = 0;
  for (let y = 0; y < cb.h; y++) {
    const ty = baseOy + y;
    if (ty < 0 || ty >= s) continue;
    for (let x = 0; x < cb.w; x++) {
      const hex = cb.pixels[y * cb.w + x];
      if (!hex) continue; // Never paste transparent space
      const tx = baseOx + x;
      if (tx < 0 || tx >= s) continue;
      const idx = ty * s + tx;
      floated[idx] = hex;
      mask[idx] = 1;
      count++;
    }
  }

  if (count === 0) {
    editor.undoStack.pop();
    return false;
  }

  editor.floating = {
    pixels: floated,
    ox: 0,
    oy: 0,
    startOx: 0,
    startOy: 0,
    baseMask: mask.slice()
  };
  editor.selection = mask;
  syncLightGlowBuffers();
  updateSelectionUI();
  refreshEditorAll();
  markEditorDirty();
  setEditorMsg(`PASTED ${cb.w}x${cb.h} (MOVE OR ESC)`);
  return true;
}

export function transformSelectedPixels(kind) {
  commitFloatingSelection(true);
  const s = editor.size;
  const mask = editor.selection;
  if (!hasAnySelectedCell(mask)) return false;

  let minX = s, maxX = -1, minY = s, maxY = -1;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (mask[y * s + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return false;

  pushUndo();
  const cur = editor.frames[editor.frameIdx];
  const nextPx = cur.slice();
  const nextMask = new Uint8Array(s * s);
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (mask[y * s + x]) nextPx[y * s + x] = null;
    }
  }

  if (kind === 'flipH' || kind === 'flipV') {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!mask[y * s + x]) continue;
        const nx = kind === 'flipH' ? (minX + maxX - x) : x;
        const ny = kind === 'flipV' ? (minY + maxY - y) : y;
        nextPx[ny * s + nx] = cur[y * s + x];
        nextMask[ny * s + nx] = 1;
      }
    }
  } else if (kind === 'rotate') {
    const cx = minX + (bw - 1) * 0.5;
    const cy = minY + (bh - 1) * 0.5;
    const newOx = Math.round(cx - (bh - 1) * 0.5);
    const newOy = Math.round(cy - (bw - 1) * 0.5);
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const sx = minX + lx;
        const sy = minY + ly;
        if (!mask[sy * s + sx]) continue;
        const nx = newOx + (bh - 1 - ly);
        const ny = newOy + lx;
        if (nx >= 0 && nx < s && ny >= 0 && ny < s) {
          nextPx[ny * s + nx] = cur[sy * s + sx];
          nextMask[ny * s + nx] = 1;
        }
      }
    }
  }

  editor.frames[editor.frameIdx] = nextPx;
  editor.selection = hasAnySelectedCell(nextMask) ? nextMask : null;
  syncLightGlowBuffers();
  updateSelectionUI();
  refreshEditorAll();
  markEditorDirty();
  return true;
}
