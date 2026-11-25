import {
  edFxBar,
  editorCanvasFrame,
  fxAlphaSlider,
  fxAlphaVal,
  fxApplyBtn,
  fxCancelBtn,
  fxHslBtn,
  fxHslResetBtn,
  fxHueSlider,
  fxHueVal,
  fxOut4Btn,
  fxOut8Btn,
  fxOutBlackBtn,
  fxOutBrushBtn,
  fxOutColorChip,
  fxOutInnerBtn,
  fxOutlineBtn,
  fxOutOuterBtn,
  fxOutPickBtn,
  fxPanelHsl,
  fxPanelOutline,
  fxPanelReplace,
  fxRepFromChip,
  fxRepFromPickBtn,
  fxReplaceBtn,
  fxRepSwapBtn,
  fxRepToChip,
  fxRepTolSlider,
  fxRepTolVal,
  fxRepToPickBtn,
  fxRepToTransBtn,
  fxSatSlider,
  fxSatVal,
  fxScopeBtn,
  fxTitleEl,
  fxValSlider,
  fxValVal
} from '../dom.js';
import { markEditorDirty } from './draft.js';
import { ensureColorInPalette, renderPaletteSwatches } from './palette.js';
import { drawEditorCanvas, refreshEditorAll, renderEditorPreview } from './render.js';
import { commitFloatingSelection, editorHasSelection, hasAnySelectedCell } from './selection.js';
import { editor, setEditorMsg, syncLightGlowBuffers } from './state.js';
import { pushUndo, syncEditorModifierUI } from './tools.js';
import { clamp, hexToRgb, hsvToRgb, normalizeHex, rgbaToHex, rgbToHsv } from '../utils.js';

/* =========================================================================
   ASEPRITE-STYLE CREATE EDITOR FX TOOLS
   1. Hue / Saturation / Value / Alpha live adjustment (Ctrl+U)
   2. Add Outline (4-way / 8-way, Outside / Inside) (Shift+O)
   3. Replace Color with Eyedropper & Tolerance (Shift+R)
   ========================================================================= */
const fxState = {
  mode: null,                 // 'hsl' | 'outline' | 'replace' | null
  scope: 'frame',             // 'frame' | 'all'
  originals: null,            // Array<Array<string|null>> snapshot of editor.frames
  selection: null,            // Uint8Array | null snapshot of active selection mask
  pickTarget: null,           // 'from' | 'to' | 'outline' | null
  // Hue / Saturation / Value / Alpha deltas
  hue: 0,                     // -180..180
  sat: 0,                     // -100..100
  val: 0,                     // -100..100
  alpha: 0,                   // -100..100
  // Outline options
  outlineColor: '#000000',
  outline8Way: false,
  outlineInside: false,
  syncOutlineToBrush: false,
  // Replace Color options
  replaceFrom: null,          // string | null (null = transparent)
  replaceFromSet: false,      // true once user picked a FROM color (including transparent)
  replaceTo: '#f28c38',       // string | null
  replaceTol: 0,              // 0..60
  syncToBrush: true
};

const DIRS_4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIRS_8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

export function isEditorFxOpen() {
  return Boolean(fxState.mode);
}

export function isEditorFxPicking() {
  return Boolean(fxState.mode && fxState.pickTarget);
}

function getActiveBrushHex() {
  if (editor.transparent || editor.alpha <= 0.002) return null;
  return normalizeHex(editor.color) || '#ffffff';
}

function setChipVisual(el, hex, unset = false) {
  if (!el) return;
  if (unset) {
    el.classList.add('unset');
    el.classList.remove('transparent');
    el.style.removeProperty('--fx-col');
    el.textContent = '?';
    return;
  }
  el.classList.remove('unset');
  if (!hex) {
    el.classList.add('transparent');
    el.style.setProperty('--fx-col', 'transparent');
    el.textContent = 'T';
  } else {
    el.classList.remove('transparent');
    el.style.setProperty('--fx-col', hex);
    el.textContent = '';
  }
}

function transformHslAlphaFrame(src, size, dHue, dSat, dVal, dAlpha, mask) {
  const len = size * size;
  const out = src.slice();
  if (dHue === 0 && dSat === 0 && dVal === 0 && dAlpha === 0) {
    return { pixels: out, changed: 0 };
  }
  let changed = 0;
  for (let i = 0; i < len; i++) {
    if (mask && !mask[i]) continue;
    const hex = src[i];
    if (!hex) continue;
    const rgb = hexToRgb(hex);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const h = ((hsv.h + dHue) % 360 + 360) % 360;
    const s = dSat >= 0
      ? clamp(hsv.s + dSat / 100, 0, 1)
      : clamp(hsv.s * (1 + dSat / 100), 0, 1);
    const v = dVal >= 0
      ? clamp(hsv.v + (1 - hsv.v) * (dVal / 100), 0, 1)
      : clamp(hsv.v * (1 + dVal / 100), 0, 1);
    const a = dAlpha >= 0
      ? clamp(rgb.a + (1 - rgb.a) * (dAlpha / 100), 0, 1)
      : clamp(rgb.a * (1 + dAlpha / 100), 0, 1);
    const nextRgb = hsvToRgb(h, s, v);
    const nextHex = a <= 0.004 ? null : rgbaToHex(nextRgb.r, nextRgb.g, nextRgb.b, a);
    if (nextHex !== hex) {
      out[i] = nextHex;
      changed++;
    }
  }
  return { pixels: out, changed };
}

function transformOutlineFrame(src, size, outHex, mode8Way, inside, mask) {
  const out = src.slice();
  if (!outHex) return { pixels: out, changed: 0 };
  const dirs = mode8Way ? DIRS_8 : DIRS_4;
  let changed = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (mask && !mask[idx]) continue;
      const cur = src[idx];
      if (!inside) {
        if (cur) continue;
        let touchesArt = false;
        for (let k = 0; k < dirs.length; k++) {
          const nx = x + dirs[k][0];
          const ny = y + dirs[k][1];
          if (nx >= 0 && nx < size && ny >= 0 && ny < size && src[ny * size + nx]) {
            touchesArt = true;
            break;
          }
        }
        if (touchesArt) {
          out[idx] = outHex;
          changed++;
        }
      } else {
        if (!cur) continue;
        let touchesEdge = false;
        for (let k = 0; k < dirs.length; k++) {
          const nx = x + dirs[k][0];
          const ny = y + dirs[k][1];
          if (nx < 0 || nx >= size || ny < 0 || ny >= size || !src[ny * size + nx]) {
            touchesEdge = true;
            break;
          }
        }
        if (touchesEdge && cur !== outHex) {
          out[idx] = outHex;
          changed++;
        }
      }
    }
  }
  return { pixels: out, changed };
}

function transformReplaceFrame(src, size, fromHex, toHex, tol, mask) {
  const len = size * size;
  const out = src.slice();
  const normFrom = fromHex ? normalizeHex(fromHex) : null;
  const normTo = toHex ? normalizeHex(toHex) : null;
  if (normFrom === normTo && tol <= 0) return { pixels: out, changed: 0 };

  const fromRgb = normFrom ? hexToRgb(normFrom) : null;
  const maxDist = tol * 4.41;
  let changed = 0;

  for (let i = 0; i < len; i++) {
    if (mask && !mask[i]) continue;
    const cur = src[i];
    if (!normFrom) {
      if (!cur && normTo !== null) {
        out[i] = normTo;
        changed++;
      }
      continue;
    }
    if (!cur) continue;
    let match = false;
    if (tol <= 0) {
      match = normalizeHex(cur) === normFrom;
    } else {
      const cRgb = hexToRgb(cur);
      const d = Math.hypot(
        cRgb.r - fromRgb.r,
        cRgb.g - fromRgb.g,
        cRgb.b - fromRgb.b,
        (cRgb.a - fromRgb.a) * 255
      );
      match = d <= maxDist;
    }
    if (match && cur !== normTo) {
      out[i] = normTo;
      changed++;
    }
  }
  return { pixels: out, changed };
}

function computeFxForFrame(origPixels, useMask) {
  const mask = (useMask && hasAnySelectedCell(fxState.selection)) ? fxState.selection : null;
  if (fxState.mode === 'hsl') {
    return transformHslAlphaFrame(origPixels, editor.size, fxState.hue, fxState.sat, fxState.val, fxState.alpha, mask);
  }
  if (fxState.mode === 'outline') {
    return transformOutlineFrame(origPixels, editor.size, fxState.outlineColor, fxState.outline8Way, fxState.outlineInside, mask);
  }
  if (fxState.mode === 'replace') {
    if (!fxState.replaceFromSet) return { pixels: origPixels.slice(), changed: 0 };
    return transformReplaceFrame(origPixels, editor.size, fxState.replaceFrom, fxState.replaceTo, fxState.replaceTol, mask);
  }
  return { pixels: origPixels.slice(), changed: 0 };
}

function syncFxUI() {
  const open = Boolean(fxState.mode);
  if (edFxBar) edFxBar.classList.toggle('visible', open);
  if (fxHslBtn) fxHslBtn.classList.toggle('active', fxState.mode === 'hsl');
  if (fxOutlineBtn) fxOutlineBtn.classList.toggle('active', fxState.mode === 'outline');
  if (fxReplaceBtn) fxReplaceBtn.classList.toggle('active', fxState.mode === 'replace');

  if (fxPanelHsl) fxPanelHsl.hidden = fxState.mode !== 'hsl';
  if (fxPanelOutline) fxPanelOutline.hidden = fxState.mode !== 'outline';
  if (fxPanelReplace) fxPanelReplace.hidden = fxState.mode !== 'replace';

  if (fxTitleEl) {
    if (fxState.mode === 'hsl') fxTitleEl.textContent = 'HUE / SAT / ALPHA';
    else if (fxState.mode === 'outline') fxTitleEl.textContent = 'ADD OUTLINE';
    else if (fxState.mode === 'replace') fxTitleEl.textContent = 'REPLACE COLOR';
  }

  const hasSel = hasAnySelectedCell(fxState.selection);
  const multiFrame = editor.frames.length > 1;
  if (fxScopeBtn) {
    fxScopeBtn.disabled = !multiFrame;
    if (!multiFrame) fxState.scope = 'frame';
    fxScopeBtn.classList.toggle('active', fxState.scope === 'all');
    fxScopeBtn.textContent = fxState.scope === 'all'
      ? `ALL (${editor.frames.length})`
      : (hasSel ? 'SELECTION' : 'FRAME');
  }

  // HSL / Alpha readouts
  if (fxHueSlider) fxHueSlider.value = String(fxState.hue);
  if (fxHueVal) fxHueVal.textContent = `${fxState.hue > 0 ? '+' : ''}${fxState.hue}`;
  if (fxSatSlider) fxSatSlider.value = String(fxState.sat);
  if (fxSatVal) fxSatVal.textContent = `${fxState.sat > 0 ? '+' : ''}${fxState.sat}%`;
  if (fxValSlider) fxValSlider.value = String(fxState.val);
  if (fxValVal) fxValVal.textContent = `${fxState.val > 0 ? '+' : ''}${fxState.val}%`;
  if (fxAlphaSlider) fxAlphaSlider.value = String(fxState.alpha);
  if (fxAlphaVal) fxAlphaVal.textContent = `${fxState.alpha > 0 ? '+' : ''}${fxState.alpha}%`;

  // Outline UI
  setChipVisual(fxOutColorChip, fxState.outlineColor, false);
  if (fxOutPickBtn) fxOutPickBtn.classList.toggle('active', fxState.pickTarget === 'outline');
  if (fxOut4Btn) fxOut4Btn.classList.toggle('active', !fxState.outline8Way);
  if (fxOut8Btn) fxOut8Btn.classList.toggle('active', fxState.outline8Way);
  if (fxOutOuterBtn) fxOutOuterBtn.classList.toggle('active', !fxState.outlineInside);
  if (fxOutInnerBtn) fxOutInnerBtn.classList.toggle('active', fxState.outlineInside);

  // Replace Color UI
  setChipVisual(fxRepFromChip, fxState.replaceFrom, !fxState.replaceFromSet);
  setChipVisual(fxRepToChip, fxState.replaceTo, false);
  if (fxRepFromPickBtn) fxRepFromPickBtn.classList.toggle('active', fxState.pickTarget === 'from');
  if (fxRepToPickBtn) fxRepToPickBtn.classList.toggle('active', fxState.pickTarget === 'to');
  if (fxRepToTransBtn) fxRepToTransBtn.classList.toggle('active', fxState.replaceTo === null);
  if (fxRepTolSlider) fxRepTolSlider.value = String(fxState.replaceTol);
  if (fxRepTolVal) fxRepTolVal.textContent = String(fxState.replaceTol);

  // Show Eyedropper cursor on canvas whenever picking a color for FX
  if (editorCanvasFrame) {
    if (isEditorFxPicking()) {
      editorCanvasFrame.dataset.cursorTool = 'eyedropper';
    } else {
      syncEditorModifierUI();
    }
  }
}

export function previewEditorFx() {
  if (!fxState.mode || !fxState.originals) return 0;
  let totalChanged = 0;
  for (let i = 0; i < fxState.originals.length; i++) {
    if (fxState.scope === 'all' || i === editor.frameIdx) {
      const res = computeFxForFrame(fxState.originals[i], fxState.scope !== 'all');
      editor.frames[i] = res.pixels;
      totalChanged += res.changed;
    } else {
      editor.frames[i] = fxState.originals[i].slice();
    }
  }
  syncLightGlowBuffers();
  drawEditorCanvas();
  renderEditorPreview();
  return totalChanged;
}

export function cancelEditorFx(silent = false) {
  if (!fxState.mode) return false;
  if (fxState.originals) {
    for (let i = 0; i < fxState.originals.length && i < editor.frames.length; i++) {
      editor.frames[i] = fxState.originals[i].slice();
    }
  }
  fxState.mode = null;
  fxState.originals = null;
  fxState.selection = null;
  fxState.pickTarget = null;
  syncLightGlowBuffers();
  syncFxUI();
  refreshEditorAll();
  if (!silent) setEditorMsg('FX CANCELED');
  return true;
}

export function applyEditorFx() {
  if (!fxState.mode || !fxState.originals) return false;
  const mode = fxState.mode;
  const applyAll = fxState.scope === 'all' && editor.frames.length > 1;
  const finalFrames = [];
  let totalChanged = 0;
  const newColors = new Set();

  for (let i = 0; i < fxState.originals.length; i++) {
    if (applyAll || i === editor.frameIdx) {
      const res = computeFxForFrame(fxState.originals[i], !applyAll);
      finalFrames.push(res.pixels);
      totalChanged += res.changed;
      if (mode === 'outline' && fxState.outlineColor) newColors.add(fxState.outlineColor);
      if (mode === 'replace' && fxState.replaceTo) newColors.add(fxState.replaceTo);
    } else {
      finalFrames.push(fxState.originals[i].slice());
    }
  }

  // Restore originals briefly so Undo snapshot captures exact pre-FX state cleanly
  for (let i = 0; i < fxState.originals.length && i < editor.frames.length; i++) {
    editor.frames[i] = fxState.originals[i].slice();
  }
  if (totalChanged > 0) {
    pushUndo(applyAll);
    for (let i = 0; i < finalFrames.length && i < editor.frames.length; i++) {
      editor.frames[i] = finalFrames[i];
    }
    for (const c of newColors) ensureColorInPalette(c);
    if (mode === 'hsl') {
      // Sample up to 6 newly shifted colors into palette without flooding
      let added = 0;
      const cur = editor.frames[editor.frameIdx];
      for (let i = 0; i < cur.length && added < 6; i++) {
        if (cur[i] && ensureColorInPalette(cur[i])) added++;
      }
    }
    markEditorDirty();
  }

  fxState.mode = null;
  fxState.originals = null;
  fxState.selection = null;
  fxState.pickTarget = null;
  syncLightGlowBuffers();
  syncFxUI();
  renderPaletteSwatches();
  refreshEditorAll();

  if (totalChanged > 0) {
    if (mode === 'hsl') setEditorMsg(`ADJUSTED ${totalChanged} PX`);
    else if (mode === 'outline') setEditorMsg(`ADDED ${totalChanged} OUTLINE PX`);
    else setEditorMsg(`REPLACED ${totalChanged} PX`);
  } else {
    setEditorMsg('NO PIXELS CHANGED');
  }
  return true;
}

function findFirstOpaquePixel(pixels) {
  if (!Array.isArray(pixels)) return null;
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i]) return normalizeHex(pixels[i]);
  }
  return null;
}

export function openEditorFx(mode, opts = null) {
  if (!mode) return;
  if (fxState.mode === mode && !opts) {
    cancelEditorFx(false);
    return;
  }
  if (fxState.mode) {
    cancelEditorFx(true);
  }
  commitFloatingSelection(true);

  fxState.mode = mode;
  fxState.scope = 'frame';
  fxState.originals = editor.frames.map(f => f.slice());
  fxState.selection = editorHasSelection() ? editor.selection.slice() : null;
  fxState.pickTarget = null;

  if (mode === 'hsl') {
    fxState.hue = 0;
    fxState.sat = 0;
    fxState.val = 0;
    fxState.alpha = 0;
    setEditorMsg('DRAG SLIDERS FOR LIVE PREVIEW');
  } else if (mode === 'outline') {
    fxState.syncOutlineToBrush = false;
    if (!fxState.outlineColor) fxState.outlineColor = '#000000';
    setEditorMsg('LIVE OUTLINE PREVIEW');
  } else if (mode === 'replace') {
    fxState.replaceTol = 0;
    fxState.syncToBrush = true;
    fxState.replaceTo = getActiveBrushHex();
    if (opts && opts.fromSet) {
      fxState.replaceFrom = opts.fromHex ? normalizeHex(opts.fromHex) : null;
      fxState.replaceFromSet = true;
      fxState.pickTarget = 'from';
    } else {
      const sample = findFirstOpaquePixel(fxState.originals[editor.frameIdx]);
      fxState.replaceFrom = sample;
      fxState.replaceFromSet = Boolean(sample);
      fxState.pickTarget = 'from';
    }
    setEditorMsg('CLICK CANVAS WITH EYEDROPPER TO PICK FROM COLOR');
  }

  syncFxUI();
  previewEditorFx();
}

export function handleEditorFxCanvasPick(x, y) {
  if (!fxState.mode || !fxState.originals) return false;
  const orig = fxState.originals[editor.frameIdx];
  if (!orig) return false;
  const raw = orig[y * editor.size + x] || null;
  const picked = raw ? normalizeHex(raw) : null;

  if (fxState.mode === 'replace') {
    if (fxState.pickTarget === 'to') {
      fxState.replaceTo = picked;
      fxState.syncToBrush = false;
      fxState.pickTarget = 'from';
      setEditorMsg(picked ? `TO: ${picked.toUpperCase()}` : 'TO: TRANSPARENT');
    } else {
      fxState.replaceFrom = picked;
      fxState.replaceFromSet = true;
      setEditorMsg(picked ? `FROM: ${picked.toUpperCase()} (PICK TO OR DRAG COLOR)` : 'FROM: TRANSPARENT');
    }
    syncFxUI();
    previewEditorFx();
    return true;
  }

  if (fxState.mode === 'outline' && fxState.pickTarget === 'outline') {
    if (picked) {
      fxState.outlineColor = picked;
      fxState.syncOutlineToBrush = false;
      fxState.pickTarget = null;
      setEditorMsg(`OUTLINE: ${picked.toUpperCase()}`);
      syncFxUI();
      previewEditorFx();
    } else {
      setEditorMsg('PICK A NON-TRANSPARENT PIXEL');
    }
    return true;
  }

  return false;
}

/* Instant one-click Eyedropper Shift+Click color replace (current frame or active selection) */
export function quickReplaceColorAt(x, y) {
  commitFloatingSelection(true);
  const frame = editor.frames[editor.frameIdx];
  if (!frame) return false;
  const fromHex = frame[y * editor.size + x] || null;
  const toHex = getActiveBrushHex();
  const mask = hasAnySelectedCell(editor.selection) ? editor.selection : null;
  const res = transformReplaceFrame(frame, editor.size, fromHex, toHex, 0, mask);
  if (res.changed <= 0) {
    setEditorMsg('COLOR ALREADY MATCHES');
    return false;
  }
  pushUndo(false);
  editor.frames[editor.frameIdx] = res.pixels;
  if (toHex) ensureColorInPalette(toHex);
  syncLightGlowBuffers();
  refreshEditorAll();
  markEditorDirty();
  setEditorMsg(`REPLACED ${res.changed} PX`);
  return true;
}

export function initEditorFxUI() {
  if (fxHslBtn) fxHslBtn.addEventListener('click', () => openEditorFx('hsl'));
  if (fxOutlineBtn) fxOutlineBtn.addEventListener('click', () => openEditorFx('outline'));
  if (fxReplaceBtn) fxReplaceBtn.addEventListener('click', () => openEditorFx('replace'));

  if (fxScopeBtn) {
    fxScopeBtn.addEventListener('click', () => {
      if (editor.frames.length <= 1) return;
      fxState.scope = fxState.scope === 'all' ? 'frame' : 'all';
      syncFxUI();
      previewEditorFx();
    });
  }

  // HSL / Alpha live sliders
  if (fxHueSlider) {
    fxHueSlider.addEventListener('input', () => {
      fxState.hue = parseInt(fxHueSlider.value, 10) || 0;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxSatSlider) {
    fxSatSlider.addEventListener('input', () => {
      fxState.sat = parseInt(fxSatSlider.value, 10) || 0;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxValSlider) {
    fxValSlider.addEventListener('input', () => {
      fxState.val = parseInt(fxValSlider.value, 10) || 0;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxAlphaSlider) {
    fxAlphaSlider.addEventListener('input', () => {
      fxState.alpha = parseInt(fxAlphaSlider.value, 10) || 0;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxHslResetBtn) {
    fxHslResetBtn.addEventListener('click', () => {
      fxState.hue = 0;
      fxState.sat = 0;
      fxState.val = 0;
      fxState.alpha = 0;
      syncFxUI();
      previewEditorFx();
    });
  }

  // Outline controls
  if (fxOutPickBtn) {
    fxOutPickBtn.addEventListener('click', () => {
      fxState.pickTarget = fxState.pickTarget === 'outline' ? null : 'outline';
      syncFxUI();
      if (fxState.pickTarget === 'outline') setEditorMsg('CLICK CANVAS TO PICK OUTLINE COLOR');
    });
  }
  if (fxOutBrushBtn) {
    fxOutBrushBtn.addEventListener('click', () => {
      const b = getActiveBrushHex();
      if (!b) {
        setEditorMsg('SELECT A NON-TRANSPARENT COLOR FIRST');
        return;
      }
      fxState.outlineColor = b;
      fxState.syncOutlineToBrush = true;
      fxState.pickTarget = null;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxOutBlackBtn) {
    fxOutBlackBtn.addEventListener('click', () => {
      fxState.outlineColor = '#000000';
      fxState.syncOutlineToBrush = false;
      fxState.pickTarget = null;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxOut4Btn) {
    fxOut4Btn.addEventListener('click', () => {
      fxState.outline8Way = false;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxOut8Btn) {
    fxOut8Btn.addEventListener('click', () => {
      fxState.outline8Way = true;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxOutOuterBtn) {
    fxOutOuterBtn.addEventListener('click', () => {
      fxState.outlineInside = false;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxOutInnerBtn) {
    fxOutInnerBtn.addEventListener('click', () => {
      fxState.outlineInside = true;
      syncFxUI();
      previewEditorFx();
    });
  }

  // Replace Color controls
  if (fxRepFromPickBtn) {
    fxRepFromPickBtn.addEventListener('click', () => {
      fxState.pickTarget = 'from';
      syncFxUI();
      setEditorMsg('CLICK CANVAS TO PICK SOURCE (FROM) COLOR');
    });
  }
  if (fxRepToPickBtn) {
    fxRepToPickBtn.addEventListener('click', () => {
      fxState.pickTarget = 'to';
      syncFxUI();
      setEditorMsg('CLICK CANVAS TO PICK TARGET (TO) COLOR');
    });
  }
  if (fxRepSwapBtn) {
    fxRepSwapBtn.addEventListener('click', () => {
      if (!fxState.replaceFromSet) return;
      const tmp = fxState.replaceFrom;
      fxState.replaceFrom = fxState.replaceTo;
      fxState.replaceTo = tmp;
      fxState.syncToBrush = false;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxRepToTransBtn) {
    fxRepToTransBtn.addEventListener('click', () => {
      fxState.replaceTo = null;
      fxState.syncToBrush = false;
      syncFxUI();
      previewEditorFx();
    });
  }
  if (fxRepTolSlider) {
    fxRepTolSlider.addEventListener('input', () => {
      fxState.replaceTol = parseInt(fxRepTolSlider.value, 10) || 0;
      syncFxUI();
      previewEditorFx();
    });
  }

  if (fxCancelBtn) fxCancelBtn.addEventListener('click', () => cancelEditorFx(false));
  if (fxApplyBtn) fxApplyBtn.addEventListener('click', () => applyEditorFx());

  // Live color sync when the user clicks a palette swatch or drags the HSV/Alpha picker while FX is open!
  window.addEventListener('spritelab:ed-color-change', () => {
    if (!fxState.mode) return;
    if (fxState.mode === 'replace') {
      fxState.replaceTo = getActiveBrushHex();
      fxState.syncToBrush = true;
      syncFxUI();
      previewEditorFx();
    } else if (fxState.mode === 'outline') {
      const b = getActiveBrushHex();
      if (b) {
        fxState.outlineColor = b;
        fxState.syncOutlineToBrush = true;
        syncFxUI();
        previewEditorFx();
      }
    }
  });
}
