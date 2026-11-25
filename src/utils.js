import { TILE } from './constants.js';

/* =========================================================================
   UTILITY HELPERS
   ========================================================================= */
export function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

export function normalizeHex(str) {
  if (typeof str !== 'string') return null;
  let s = str.trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{8}$/.test(s)) {
    const low = s.toLowerCase();
    return low.endsWith('ff') ? low.slice(0, 7) : low;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  }
  if (/^#[0-9a-fA-F]{4}$/.test(s)) {
    const a = (s[4] + s[4]).toLowerCase();
    const rgb = ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    return a === 'ff' ? rgb : (rgb + a);
  }
  return null;
}

export function stripHexAlpha(hex) {
  const norm = normalizeHex(hex);
  return norm ? norm.slice(0, 7) : null;
}

export function getHexAlpha(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return 1;
  return norm.length === 9 ? parseInt(norm.slice(7, 9), 16) / 255 : 1;
}

export function withHexAlpha(hex, alpha = 1) {
  const rgb = stripHexAlpha(hex);
  if (!rgb) return null;
  const aByte = clamp(Math.round(clamp(alpha, 0, 1) * 255), 0, 255);
  if (aByte >= 255) return rgb;
  return rgb + aByte.toString(16).padStart(2, '0');
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(v | 0, 0, 255).toString(16).padStart(2, '0')).join('');
}

export function rgbaToHex(r, g, b, a = 1) {
  const base = rgbToHex(r, g, b);
  const aByte = clamp(Math.round(clamp(a, 0, 1) * 255), 0, 255);
  if (aByte >= 255) return base;
  return base + aByte.toString(16).padStart(2, '0');
}

export function hexToRgb(hex) {
  const norm = normalizeHex(hex) || '#f28c38';
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
    a: norm.length === 9 ? parseInt(norm.slice(7, 9), 16) / 255 : 1
  };
}

export function hsvToRgb(h, s, v) {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function createEmptyPixels(size) {
  return new Array(size * size).fill(null);
}

export function hasAnyPixel(pixels) {
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i]) return true;
  }
  return false;
}

/* Clean sequential naming for new items & duplicates (e.g. ROCK -> ROCK 2 -> ROCK 3) */
export function generateUniqueName(baseName, existingNames, maxLen, startFromOne = false) {
  const used = new Set(existingNames.map(n => String(n || '').trim().toUpperCase()));
  const clean = String(baseName || 'SPRITE').trim().toUpperCase();
  let root = clean.replace(/\s+COPY(?:\s+\d+)?$/i, '').trim();
  const numMatch = root.match(/^(.*?)\s+(\d+)$/);
  let nextNum = startFromOne ? 1 : 2;
  if (numMatch && numMatch[1].trim()) {
    root = numMatch[1].trim();
    nextNum = startFromOne ? 1 : (parseInt(numMatch[2], 10) + 1);
  }
  if (!root) root = 'SPRITE';
  let n = Math.max(startFromOne ? 1 : 2, nextNum);
  while (n < 9999) {
    const suffix = ' ' + n;
    const trimmedRoot = root.slice(0, Math.max(1, maxLen - suffix.length)).trimEnd();
    const candidate = (trimmedRoot + suffix).slice(0, maxLen);
    if (!used.has(candidate)) return candidate;
    n++;
  }
  return root.slice(0, maxLen);
}

export function getSpriteStateFps(sp, stateName) {
  if (sp && sp.stateFps && Number.isFinite(sp.stateFps[stateName])) {
    return clamp(Math.round(sp.stateFps[stateName]), 1, 24);
  }
  return clamp(Math.round((sp && sp.fps) || 6), 1, 24);
}


export function pixelsToCanvas(pixels, size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const hex = pixels[row + x];
      if (hex) {
        ctx.fillStyle = hex;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

export function layerForType(type, subType) {
  if (type === 'BACK') return 'bg';
  if (type === 'LIGHT' || type === 'ENVIRONMENT' || type === 'PLACES') return 'bg';
  if (type === 'THING') return subType === 'IN FRONT' ? 'fg' : 'bg';
  if (type === 'BIG_THING') return subType === 'FRONT 2X2' ? 'fg' : 'bg';
  return 'main';
}

/* =========================================================================
   INTERNAL BUILT-IN STARTER BLOCK CANVAS (NOT IN SAVED SPRITES DOCK)
   Dark slate #22262f, crisp 1px #353b49 top bevel, subtle #16181e border.
   ========================================================================= */
export const starterTileCanvas = (() => {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#22262f';
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.fillStyle = '#16181e';
  ctx.fillRect(0, 0, TILE, 1);
  ctx.fillRect(0, TILE - 1, TILE, 1);
  ctx.fillRect(0, 0, 1, TILE);
  ctx.fillRect(TILE - 1, 0, 1, TILE);
  ctx.fillStyle = '#353b49';
  ctx.fillRect(1, 1, TILE - 2, 1);
  return c;
})();
