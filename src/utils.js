import { isGearType, STARTER_TILE_ID, TILE } from './constants.js';

/* =========================================================================
   UTILITY HELPERS
   ========================================================================= */
export function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/* Fast cached parser for 'tx,ty' sparse-grid keys (eliminates per-frame slice + parseInt churn) */
const _parsedTileKeyCache = new Map();
export function parseTileKey(key) {
  let hit = _parsedTileKeyCache.get(key);
  if (hit !== undefined) return hit;
  const sep = key.indexOf(',');
  if (sep <= 0) return null;
  const tx = parseInt(key.slice(0, sep), 10);
  const ty = parseInt(key.slice(sep + 1), 10);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  hit = { tx, ty };
  if (_parsedTileKeyCache.size > 32768) _parsedTileKeyCache.clear();
  _parsedTileKeyCache.set(key, hit);
  return hit;
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

export function layerForType(type, subType, opts = null) {
  if (isGearType(type)) return null;
  if (type === 'BACK') return 'bg';
  if (type === 'LIGHT' || type === 'ENVIRONMENT' || type === 'PLACES') return 'bg';
  if (type === 'THING') return subType === 'IN FRONT' ? 'fg' : 'bg';
  if (type === 'BIG_THING') {
    if (subType === 'BACK + FRONT') return 'bg';
    if (subType === 'FRONT 2X2') return 'fg';
    if (opts && opts.placement === 'IN FRONT') return 'fg';
    return 'bg';
  }
  return 'main';
}

/* =========================================================================
   8-STATE TILE ORIENTATION (D4: 0/90/180/270 CW, THEN FLIP + CCW 0/-90/-180/-270)
   ========================================================================= */
export function normalizeOrient(o) {
  const n = Number(o);
  if (!Number.isFinite(n)) return 0;
  return (Math.round(n) & 7);
}

export function nextBrushOrient(o) {
  return (normalizeOrient(o) + 1) & 7;
}

export function orientToTransform(orient) {
  const o = normalizeOrient(orient);
  const flip = o >= 4;
  // Normal side (0..3): rotates CW 0, 90, 180, 270
  // Flipped side (4..7): rotates CCW 0, -90 (270), -180 (180), -270 (90)
  const rot = o < 4 ? o : ((8 - o) & 3);
  return { flip, rot };
}

export function orientToAnimAngle(orient) {
  const o = normalizeOrient(orient);
  const halfPi = Math.PI * 0.5;
  if (o === 0) return 0;
  if (o <= 4) return o * halfPi;
  return (8 - o) * halfPi;
}

export function transformOrientVec(vx, vy, orient) {
  const { flip, rot } = orientToTransform(orient);
  const fx = flip ? -vx : vx;
  if (rot === 1) return { x: -vy, y: fx };
  if (rot === 2) return { x: -fx, y: -vy };
  if (rot === 3) return { x: vy, y: -fx };
  return { x: fx, y: vy };
}

const ORIENT_LABELS = [
  '0 DEG',
  '90 DEG',
  '180 DEG',
  '270 DEG',
  'FLIP 0 DEG',
  'FLIP -90 DEG',
  'FLIP -180 DEG',
  'FLIP -270 DEG'
];

export function orientLabel(orient) {
  return ORIENT_LABELS[normalizeOrient(orient)] || '0 DEG';
}

/* =========================================================================
   RHYTHMIC DEADLY EMERGING & DEADLY MOVING HAZARD TIMING HELPERS
   Shared across physics, world solidity, world renderer, and editor preview.
   ========================================================================= */
const EMERGE_SPEED_TIMINGS = {
  SLOW:   { hidden: 1.55, shake: 0.45, emerge: 0.22, hold: 1.28, retract: 0.30 },
  NORMAL: { hidden: 1.00, shake: 0.34, emerge: 0.16, hold: 0.86, retract: 0.24 },
  FAST:   { hidden: 0.60, shake: 0.24, emerge: 0.12, hold: 0.56, retract: 0.18 }
};

export function evalEmergingHazard(tx, ty, harmOpts, orient, t, usePhaseOffset = true) {
  const opts = harmOpts || {};
  const cfg = EMERGE_SPEED_TIMINGS[opts.speed] || EMERGE_SPEED_TIMINGS.NORMAL;
  const total = cfg.hidden + cfg.shake + cfg.emerge + cfg.hold + cfg.retract;
  const offset = usePhaseOffset ? ((((tx * 13 + ty * 7) % 11) + 11) % 11) * 0.17 : 0;
  const cyc = (((t + offset) % total) + total) % total;

  let bx = 0;
  let by = -1;
  if (opts.emergeDir === 'DOWN') { bx = 0; by = 1; }
  else if (opts.emergeDir === 'LEFT') { bx = -1; by = 0; }
  else if (opts.emergeDir === 'RIGHT') { bx = 1; by = 0; }
  const dir = transformOrientVec(bx, by, orient || 0);

  const t1 = cfg.hidden + cfg.shake;
  const t2 = t1 + cfg.emerge;
  const t3 = t2 + cfg.hold;

  let phase = 'hidden';
  let amount = 0;
  let shakeX = 0;
  let shakeY = 0;

  if (cyc < cfg.hidden) {
    phase = 'hidden';
    amount = 0;
  } else if (cyc < t1) {
    phase = 'shake';
    const p = (cyc - cfg.hidden) / cfg.shake;
    amount = 0.08 + p * 0.08;
    const jitter = Math.sin(t * 58 + (usePhaseOffset ? tx * 3.1 + ty * 1.7 : 0)) * (0.9 + p * 0.7);
    shakeX = dir.y !== 0 ? jitter : 0;
    shakeY = dir.x !== 0 ? jitter : 0;
  } else if (cyc < t2) {
    phase = 'emerge';
    const p = (cyc - t1) / cfg.emerge;
    amount = clamp(1 - Math.pow(1 - p, 3), 0, 1);
  } else if (cyc < t3) {
    phase = 'hold';
    amount = 1;
  } else {
    phase = 'retract';
    const p = (cyc - t3) / cfg.retract;
    amount = clamp(1 - p * p, 0, 1);
  }

  const active = amount >= 0.42;
  const solidActive = Boolean(opts.solid) && active;
  return { phase, amount, active, solidActive, shakeX, shakeY, dirX: dir.x, dirY: dir.y };
}

export function getDeadlyMovingParams(harmOpts) {
  const spd = (harmOpts && harmOpts.speed) || 'NORMAL';
  if (spd === 'SLOW') return { freq: 0.95, span: TILE * 2.5 };
  if (spd === 'FAST') return { freq: 2.65, span: TILE * 3.0 };
  return { freq: 1.65, span: TILE * 2.75 };
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

/* =========================================================================
   DOMINANT BLOCK COLOR ANALYSIS FOR WORLD FX (SPLASHES, DELETION, DEBRIS, DUST)
   Quantizes pixel RGB into 16-step buckets so shaded art beats thin outlines.
   ========================================================================= */
export function buildFxColorsFromRgb(r, g, b, secondaryHex = null) {
  const cr = clamp(Math.round(r), 0, 255);
  const cg = clamp(Math.round(g), 0, 255);
  const cb = clamp(Math.round(b), 0, 255);
  const mixW = (c, amt) => Math.round(c + (255 - c) * amt);
  const mixB = (c, amt) => Math.round(c * (1 - amt));
  const main = rgbToHex(cr, cg, cb);
  const light = rgbToHex(mixW(cr, 0.34), mixW(cg, 0.34), mixW(cb, 0.34));
  const bright = rgbToHex(mixW(cr, 0.64), mixW(cg, 0.64), mixW(cb, 0.64));
  const dark = rgbToHex(mixB(cr, 0.24), mixB(cg, 0.24), mixB(cb, 0.24));
  return {
    main,
    light,
    bright,
    dark,
    secondary: secondaryHex || light,
    rgb: { r: cr, g: cg, b: cb }
  };
}

export const STARTER_FX_COLORS = Object.freeze(buildFxColorsFromRgb(53, 59, 73, '#474f61'));

export function computePixelsDominantColors(pixels, fallbackHex = null) {
  const buckets = new Map();
  if (Array.isArray(pixels)) {
    for (let i = 0; i < pixels.length; i++) {
      const hex = pixels[i];
      if (!hex) continue;
      const rgb = hexToRgb(hex);
      if (rgb.a < 0.15) continue;
      const key = ((rgb.r >> 4) << 8) | ((rgb.g >> 4) << 4) | (rgb.b >> 4);
      let b = buckets.get(key);
      if (!b) {
        b = { count: 0, rSum: 0, gSum: 0, bSum: 0, exact: new Map() };
        buckets.set(key, b);
      }
      b.count++;
      b.rSum += rgb.r;
      b.gSum += rgb.g;
      b.bSum += rgb.b;
      const solidHex = rgbToHex(rgb.r, rgb.g, rgb.b);
      b.exact.set(solidHex, (b.exact.get(solidHex) || 0) + 1);
    }
  }

  if (buckets.size === 0) {
    if (!fallbackHex) return null;
    const fb = hexToRgb(fallbackHex);
    return buildFxColorsFromRgb(fb.r, fb.g, fb.b);
  }

  const ranked = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  const pickRep = bucket => {
    let bestHex = null;
    let bestCount = -1;
    for (const [h, c] of bucket.exact.entries()) {
      if (c > bestCount) {
        bestCount = c;
        bestHex = h;
      }
    }
    return bestHex ? hexToRgb(bestHex) : {
      r: Math.round(bucket.rSum / bucket.count),
      g: Math.round(bucket.gSum / bucket.count),
      b: Math.round(bucket.bSum / bucket.count)
    };
  };

  const dom = pickRep(ranked[0]);
  let secondaryHex = null;
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].count < Math.max(2, ranked[0].count * 0.08)) break;
    const cand = pickRep(ranked[i]);
    const dist = Math.hypot(cand.r - dom.r, cand.g - dom.g, cand.b - dom.b);
    if (dist >= 34) {
      secondaryHex = rgbToHex(cand.r, cand.g, cand.b);
      break;
    }
  }

  return buildFxColorsFromRgb(dom.r, dom.g, dom.b, secondaryHex);
}

export function getTileFxColors(tileOrSprite, fallbackHex = '#8a94a8') {
  if (!tileOrSprite) {
    const fb = hexToRgb(fallbackHex);
    return buildFxColorsFromRgb(fb.r, fb.g, fb.b);
  }
  if (tileOrSprite === STARTER_TILE_ID || tileOrSprite.id === STARTER_TILE_ID) {
    return STARTER_FX_COLORS;
  }
  const sp = tileOrSprite.sp || tileOrSprite.sprite || tileOrSprite;
  if (sp && sp._fxColors) return sp._fxColors;
  const fb = hexToRgb(fallbackHex);
  return buildFxColorsFromRgb(fb.r, fb.g, fb.b);
}
