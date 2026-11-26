import { SFX } from '../audio.js';
import { BASE_PALETTE, BODY_STATES } from '../constants.js';
import {
  alphaCanvas,
  alphaCtx,
  alphaValEl,
  colorPreviewSwatch,
  hexInput,
  hueCanvas,
  hueCtx,
  paletteGrid,
  svCanvas,
  svCtx
} from '../dom.js';
import { markEditorDirty } from './draft.js';
import { renderEditorPreview, updateLightOptionsUI } from './render.js';
import { editor, isBodyRigMode, isLightGlowMode, setEditorMsg } from './state.js';
import { syncEditorModifierUI } from './tools.js';
import {
  clamp,
  getHexAlpha,
  hexToRgb,
  hsvToRgb,
  normalizeHex,
  rgbaToHex,
  rgbToHsv
} from '../utils.js';

export function renderHueBar() {
  const w = hueCanvas.width;
  const h = hueCanvas.height;
  const grad = hueCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#ff0000');
  grad.addColorStop(1 / 6, '#ffff00');
  grad.addColorStop(2 / 6, '#00ff00');
  grad.addColorStop(3 / 6, '#00ffff');
  grad.addColorStop(4 / 6, '#0000ff');
  grad.addColorStop(5 / 6, '#ff00ff');
  grad.addColorStop(1, '#ff0000');
  hueCtx.fillStyle = grad;
  hueCtx.fillRect(0, 0, w, h);

  const mx = Math.round((clamp(editor.hsv.h, 0, 360) / 360) * (w - 1));
  hueCtx.fillStyle = '#0d0e11';
  hueCtx.fillRect(mx - 2, 0, 5, h);
  hueCtx.fillStyle = '#ffffff';
  hueCtx.fillRect(mx - 1, 1, 3, h - 2);
}

export function renderAlphaBar() {
  if (!alphaCanvas || !alphaCtx) return;
  const w = alphaCanvas.width;
  const h = alphaCanvas.height;
  alphaCtx.clearRect(0, 0, w, h);

  const rgb = hsvToRgb(editor.hsv.h, editor.hsv.s, editor.hsv.v);
  const grad = alphaCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
  grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
  alphaCtx.fillStyle = grad;
  alphaCtx.fillRect(0, 0, w, h);

  const effAlpha = editor.transparent ? 0 : clamp(editor.alpha, 0, 1);
  const mx = Math.round(effAlpha * (w - 1));
  alphaCtx.fillStyle = '#0d0e11';
  alphaCtx.fillRect(mx - 2, 0, 5, h);
  alphaCtx.fillStyle = '#ffffff';
  alphaCtx.fillRect(mx - 1, 1, 3, h - 2);
}

export function renderSVCanvas() {
  const w = svCanvas.width;
  const h = svCanvas.height;
  const pure = hsvToRgb(editor.hsv.h, 1, 1);
  svCtx.fillStyle = `rgb(${pure.r}, ${pure.g}, ${pure.b})`;
  svCtx.fillRect(0, 0, w, h);

  const whiteGrad = svCtx.createLinearGradient(0, 0, w, 0);
  whiteGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  whiteGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  svCtx.fillStyle = whiteGrad;
  svCtx.fillRect(0, 0, w, h);

  const blackGrad = svCtx.createLinearGradient(0, 0, 0, h);
  blackGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  blackGrad.addColorStop(1, 'rgba(0, 0, 0, 1)');
  svCtx.fillStyle = blackGrad;
  svCtx.fillRect(0, 0, w, h);

  const cx = Math.round(clamp(editor.hsv.s, 0, 1) * (w - 1));
  const cy = Math.round((1 - clamp(editor.hsv.v, 0, 1)) * (h - 1));
  svCtx.strokeStyle = '#0d0e11';
  svCtx.lineWidth = 2;
  svCtx.strokeRect(cx - 4, cy - 4, 8, 8);
  svCtx.strokeStyle = '#ffffff';
  svCtx.lineWidth = 1;
  svCtx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
}

export function updateColorSwatchUI() {
  if (editor.transparent) {
    colorPreviewSwatch.classList.add('transparent');
    colorPreviewSwatch.style.setProperty('--swatch-col', 'transparent');
    hexInput.value = 'TRANS';
    if (alphaValEl) alphaValEl.textContent = '0%';
  } else {
    colorPreviewSwatch.classList.remove('transparent');
    colorPreviewSwatch.style.setProperty('--swatch-col', editor.color);
    hexInput.value = editor.color.toUpperCase();
    if (alphaValEl) alphaValEl.textContent = `${Math.round(clamp(editor.alpha, 0, 1) * 100)}%`;
  }
  renderAlphaBar();
}

function notifyEditorColorChanged() {
  window.dispatchEvent(new Event('spritelab:ed-color-change'));
}

export function setEditorColor(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return;
  const rgb = hexToRgb(norm);
  editor.hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  editor.alpha = getHexAlpha(norm);
  editor.color = norm;
  editor.transparent = false;
  if (editor.tool === 'eraser') editor.tool = 'pencil';
  updateColorSwatchUI();
  renderHueBar();
  renderSVCanvas();
  renderPaletteSwatches();
  syncEditorModifierUI();
  notifyEditorColorChanged();
}

export function setEditorColorFromHSV() {
  const rgb = hsvToRgb(editor.hsv.h, editor.hsv.s, editor.hsv.v);
  editor.color = rgbaToHex(rgb.r, rgb.g, rgb.b, editor.alpha);
  editor.transparent = false;
  if (editor.tool === 'eraser') editor.tool = 'pencil';
  updateColorSwatchUI();
  renderHueBar();
  renderSVCanvas();
  renderPaletteSwatches();
  syncEditorModifierUI();
  notifyEditorColorChanged();
}

export function setEditorAlpha(val) {
  const next = clamp(Math.round(clamp(val, 0, 1) * 100) / 100, 0, 1);
  editor.alpha = next;
  const rgb = hsvToRgb(editor.hsv.h, editor.hsv.s, editor.hsv.v);
  editor.color = rgbaToHex(rgb.r, rgb.g, rgb.b, editor.alpha);
  editor.transparent = false;
  if (editor.tool === 'eraser' && next > 0) editor.tool = 'pencil';
  updateColorSwatchUI();
  renderPaletteSwatches();
  syncEditorModifierUI();
  notifyEditorColorChanged();
}

export function setEditorTransparent(val) {
  editor.transparent = Boolean(val);
  updateColorSwatchUI();
  renderPaletteSwatches();
  syncEditorModifierUI();
  notifyEditorColorChanged();
}

export function ensureColorInPalette(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return false;
  if (editor.palette.includes(norm)) return false;
  if (editor.palette.length >= 64) return false;
  editor.palette.push(norm);
  renderPaletteSwatches();
  updateLightOptionsUI();
  return true;
}

export function promoteColorToFirstPalette(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return;
  editor.palette = [norm, ...editor.palette.filter(c => c !== norm)].slice(0, 64);
  renderPaletteSwatches();
  updateLightOptionsUI();
  renderEditorPreview();
  markEditorDirty();
}

export function rebuildPaletteFromEditorArt(savedPal = null) {
  const seen = new Set();
  const out = [];
  const addHex = h => {
    const n = normalizeHex(h);
    if (n && !seen.has(n) && out.length < 64) {
      seen.add(n);
      out.push(n);
    }
  };
  const seed = (Array.isArray(savedPal) && savedPal.length > 0) ? savedPal : BASE_PALETTE;
  for (let i = 0; i < seed.length; i++) addHex(seed[i]);

  const scanPixels = px => {
    if (!Array.isArray(px)) return;
    for (let i = 0; i < px.length && out.length < 64; i++) {
      if (px[i]) addHex(px[i]);
    }
  };

  if (isLightGlowMode()) {
    scanPixels(editor.baseLightPixels);
    scanPixels(editor.glowPixels);
  } else if (isBodyRigMode()) {
    for (const st of BODY_STATES) {
      const list = editor.stateFrames[st];
      if (Array.isArray(list)) list.forEach(scanPixels);
    }
  } else if (Array.isArray(editor.frames)) {
    editor.frames.forEach(scanPixels);
  }

  if (out.length === 0) BASE_PALETTE.forEach(addHex);
  editor.palette = out;
  renderPaletteSwatches();
  updateLightOptionsUI();
}

export function renderPaletteSwatches() {
  paletteGrid.innerHTML = '';

  const eraserBtn = document.createElement('button');
  eraserBtn.type = 'button';
  eraserBtn.className = 'pal-swatch eraser-swatch' + (editor.transparent ? ' active' : '');
  eraserBtn.textContent = 'T';
  eraserBtn.dataset.tip = 'Transparent / Eraser';
  eraserBtn.addEventListener('click', () => setEditorTransparent(!editor.transparent));
  paletteGrid.appendChild(eraserBtn);

  const showLightMark = editor.type === 'LIGHT' && !isLightGlowMode();
  for (let i = 0; i < editor.palette.length; i++) {
    const hex = editor.palette[i];
    const sw = document.createElement('button');
    sw.type = 'button';
    const isAct = !editor.transparent && editor.color === hex;
    sw.className = 'pal-swatch' + (isAct ? ' active' : '') + (i === 0 && showLightMark ? ' light-primary-swatch' : '');
    sw.style.setProperty('--swatch-col', hex);
    const pct = Math.round(getHexAlpha(hex) * 100);
    const label = pct < 100 ? `${hex.toUpperCase()} (${pct}%)` : hex.toUpperCase();
    sw.dataset.tip = (i === 0 && showLightMark)
      ? `${label} (1st Palette = Light Color | RMB removes)`
      : `${label} (Click select | RMB remove)`;
    sw.addEventListener('click', () => setEditorColor(hex));
    sw.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (editor.palette.length <= 1) {
        setEditorMsg('KEEP AT LEAST 1 COLOR');
        SFX.playError();
        return;
      }
      editor.palette.splice(i, 1);
      renderPaletteSwatches();
      updateLightOptionsUI();
      if (editor.type === 'LIGHT') renderEditorPreview();
      markEditorDirty();
    });
    paletteGrid.appendChild(sw);
  }
}
