import {
  defaultLightOpts,
  LIGHT_CORE_RADIUS,
  LIGHT_PROXIMITY_RADIUS,
  SCENERY_H,
  SCENERY_W,
  TILE
} from './constants.js';
import { wCtx } from './dom.js';
import { envSys } from './environment.js';
import {
  camera,
  getBgEffectFadeIn,
  getBgEffectIndex,
  player,
  state,
  viewport
} from './state.js';
import { decodeFrame } from './storage.js';
import { clamp, hexToRgb } from './utils.js';

/* =========================================================================
   WORLD SCENERY PARALLAX ENGINE (WIDE-CANVAS BACKDROPS & ATMOSPHERIC TINT)
   Renders each world's painted panoramic scenery layers back-to-front by
   depth (0.05..0.65) with automatic sky-color atmospheric blending, automatic
   depth perspective scaling, seamless horizontal tiling, and wind drift.
   ========================================================================= */

const layerCacheMap = new WeakMap();

function getOrCreateCache(layer) {
  let entry = layerCacheMap.get(layer);
  if (!entry) {
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = layer.w || SCENERY_W;
    rawCanvas.height = layer.h || SCENERY_H;
    const rawCtx = rawCanvas.getContext('2d');
    rawCtx.imageSmoothingEnabled = false;

    const tintedCanvas = document.createElement('canvas');
    tintedCanvas.width = rawCanvas.width;
    tintedCanvas.height = rawCanvas.height;
    const tintedCtx = tintedCanvas.getContext('2d');
    tintedCtx.imageSmoothingEnabled = false;

    entry = {
      rawCanvas,
      rawCtx,
      tintedCanvas,
      tintedCtx,
      pixelsRef: null,
      version: 0,
      tintSig: '',
      hasArt: false
    };
    layerCacheMap.set(layer, entry);
  }
  return entry;
}

function writePixelsToCanvas(ctx, w, h, pixels) {
  const img = ctx.createImageData(w, h);
  const data = img.data;
  let hasArt = false;
  const total = Math.min(w * h, Array.isArray(pixels) ? pixels.length : 0);
  for (let i = 0; i < total; i++) {
    const hex = pixels[i];
    if (!hex) continue;
    const rgb = hexToRgb(hex);
    const a255 = Math.round(clamp(rgb.a, 0, 1) * 255);
    if (a255 <= 0) continue;
    const off = i * 4;
    data[off] = rgb.r;
    data[off + 1] = rgb.g;
    data[off + 2] = rgb.b;
    data[off + 3] = a255;
    hasArt = true;
  }
  ctx.putImageData(img, 0, 0);
  return hasArt;
}

export function invalidateSceneryLayerCache(layer) {
  if (!layer) return;
  const entry = layerCacheMap.get(layer);
  if (entry) {
    entry.pixelsRef = null;
    entry.tintSig = '';
    entry.version++;
  }
}

/* Fast direct pixel buffer sync while painting inside the Scenery Studio (zero RLE decode lag) */
export function syncSceneryLayerCanvasFromPixels(layer, pixels) {
  if (!layer) return null;
  const w = layer.w || SCENERY_W;
  const h = layer.h || SCENERY_H;
  const entry = getOrCreateCache(layer);
  if (entry.rawCanvas.width !== w || entry.rawCanvas.height !== h) {
    entry.rawCanvas.width = w;
    entry.rawCanvas.height = h;
    entry.tintedCanvas.width = w;
    entry.tintedCanvas.height = h;
  }
  entry.hasArt = writePixelsToCanvas(entry.rawCtx, w, h, pixels);
  entry.pixelsRef = layer.pixels;
  entry.version++;
  entry.tintSig = '';
  return entry;
}

export function getSceneryLayerCache(layer) {
  if (!layer) return null;
  const w = layer.w || SCENERY_W;
  const h = layer.h || SCENERY_H;
  const entry = getOrCreateCache(layer);
  if (entry.pixelsRef !== layer.pixels || entry.rawCanvas.width !== w || entry.rawCanvas.height !== h) {
    if (entry.rawCanvas.width !== w || entry.rawCanvas.height !== h) {
      entry.rawCanvas.width = w;
      entry.rawCanvas.height = h;
      entry.tintedCanvas.width = w;
      entry.tintedCanvas.height = h;
    }
    const decoded = decodeFrame(layer.pixels, w, h);
    entry.hasArt = writePixelsToCanvas(entry.rawCtx, w, h, decoded);
    entry.pixelsRef = layer.pixels;
    entry.version++;
    entry.tintSig = '';
  }
  return entry;
}

export function getSceneryLayerRawCanvas(layer) {
  const entry = getSceneryLayerCache(layer);
  return entry ? entry.rawCanvas : null;
}

/* Automatic depth-weighted atmospheric tinting toward the world's live sky color */
export function computeAtmosphericTintStrength(layer) {
  const atmoPct = clamp(Number(layer.atmoTint ?? 60), 0, 100) / 100;
  if (atmoPct <= 0.001) return 0;
  const depth = clamp(Number(layer.depth) || 0.22, 0.05, 0.65);
  // Farther layers (depth 0.05..0.18) pick up strong horizon haze; near layers (0.50..0.65) stay crisp & bold
  const distFactor = clamp((0.72 - depth) / 0.67, 0.06, 1.0);
  return clamp(atmoPct * distFactor * 0.68, 0, 0.72);
}

export function getTintedSceneryLayerCanvas(layer, skyRgb) {
  const entry = getSceneryLayerCache(layer);
  if (!entry || !entry.hasArt) return null;

  const strength = computeAtmosphericTintStrength(layer);
  if (strength <= 0.008 || !skyRgb) {
    return entry.rawCanvas;
  }

  const r = clamp(Math.round(skyRgb.r), 0, 255);
  const g = clamp(Math.round(skyRgb.g), 0, 255);
  const b = clamp(Math.round(skyRgb.b), 0, 255);
  const sKey = Math.round(strength * 100);
  const sig = `${entry.version}|${r},${g},${b}|${sKey}`;

  if (entry.tintSig !== sig) {
    const w = entry.rawCanvas.width;
    const h = entry.rawCanvas.height;
    const tCtx = entry.tintedCtx;
    tCtx.setTransform(1, 0, 0, 1, 0, 0);
    tCtx.globalCompositeOperation = 'source-over';
    tCtx.globalAlpha = 1;
    tCtx.imageSmoothingEnabled = false;
    tCtx.clearRect(0, 0, w, h);
    tCtx.drawImage(entry.rawCanvas, 0, 0);
    tCtx.globalCompositeOperation = 'source-atop';
    tCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(sKey / 100).toFixed(2)})`;
    tCtx.fillRect(0, 0, w, h);
    tCtx.globalCompositeOperation = 'source-over';
    entry.tintSig = sig;
  }

  return entry.tintedCanvas;
}

/* Sample the active world's live sky tone (TOP LIGHT / FILL LIGHT / LIGHT over dark studio abyss) */
export function sampleWorldSkyColor(world) {
  const baseR = 19;
  const baseG = 24;
  const baseB = 36;
  const bgIdx = getBgEffectIndex(world);
  const lights = bgIdx ? bgIdx.bgLights : null;
  if (!lights || lights.length === 0) {
    return {
      top: { r: 15, g: 20, b: 31 },
      horizon: { r: 29, g: 38, b: 56 },
      tint: { r: 30, g: 40, b: 60 }
    };
  }

  const refX = state.mode === 'PLAY' ? (player.x + player.w * 0.5) : camera.x;
  const refY = state.mode === 'PLAY' ? (player.y + player.h * 0.5) : camera.y;

  let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
  let topR = 0, topG = 0, topB = 0, topW = 0;
  let fillRgb = null;
  let fillWeight = 0;

  for (let i = 0; i < lights.length; i++) {
    const e = lights[i];
    const sp = e.sp;
    if (!sp || sp.type !== 'LIGHT') continue;
    const fade = getBgEffectFadeIn(e.key);
    if (fade <= 0.005) continue;

    const wx = e.tx * TILE + TILE * 0.5;
    const wy = e.ty * TILE + TILE * 0.5;
    const dist = Math.hypot(wx - refX, wy - refY);
    if (dist >= LIGHT_PROXIMITY_RADIUS) continue;
    let prox = 1;
    if (dist > LIGHT_CORE_RADIUS) {
      const t = 1 - (dist - LIGHT_CORE_RADIUS) / Math.max(1, LIGHT_PROXIMITY_RADIUS - LIGHT_CORE_RADIUS);
      prox = t * t * (3 - 2 * t);
    }
    const w = prox * fade;
    if (w <= 0.005) continue;

    const rgb = hexToRgb(sp.lightColor || (sp.palette && sp.palette[0]) || '#f28c38');
    const opts = sp.lightOpts || defaultLightOpts();

    if (sp.subType === 'TOP LIGHT') {
      topR += rgb.r * w;
      topG += rgb.g * w;
      topB += rgb.b * w;
      topW += w;
    } else if (sp.subType === 'FILL LIGHT') {
      if (w >= fillWeight) {
        fillWeight = w;
        fillRgb = rgb;
      }
    } else {
      const mult = opts.thick ? 0.62 : 0.38;
      rSum += rgb.r * w * mult;
      gSum += rgb.g * w * mult;
      bSum += rgb.b * w * mult;
      wSum += w * mult;
    }
  }

  let skyR = baseR;
  let skyG = baseG;
  let skyB = baseB;

  if (wSum > 0.01) {
    const blend = clamp(wSum, 0, 0.72);
    skyR = Math.round(skyR * (1 - blend) + (rSum / wSum) * blend);
    skyG = Math.round(skyG * (1 - blend) + (gSum / wSum) * blend);
    skyB = Math.round(skyB * (1 - blend) + (bSum / wSum) * blend);
  }
  if (fillRgb && fillWeight > 0.01) {
    const blend = clamp(fillWeight * 0.78, 0, 0.82);
    skyR = Math.round(skyR * (1 - blend) + fillRgb.r * blend);
    skyG = Math.round(skyG * (1 - blend) + fillRgb.g * blend);
    skyB = Math.round(skyB * (1 - blend) + fillRgb.b * blend);
  }

  let topCol = { r: skyR, g: skyG, b: skyB };
  if (topW > 0.01) {
    const blend = clamp(topW * 0.78, 0, 0.85);
    topCol = {
      r: Math.round(skyR * (1 - blend) + (topR / topW) * blend),
      g: Math.round(skyG * (1 - blend) + (topG / topW) * blend),
      b: Math.round(skyB * (1 - blend) + (topB / topW) * blend)
    };
  }

  const horizon = {
    r: Math.round(skyR * 0.68 + topCol.r * 0.32),
    g: Math.round(skyG * 0.68 + topCol.g * 0.32),
    b: Math.round(skyB * 0.68 + topCol.b * 0.32)
  };
  const tint = {
    r: Math.round(horizon.r * 0.65 + topCol.r * 0.35),
    g: Math.round(horizon.g * 0.65 + topCol.g * 0.35),
    b: Math.round(horizon.b * 0.65 + topCol.b * 0.35)
  };
  return { top: topCol, horizon, tint };
}

export function drawScenerySkyBackdrop(ctx, w, h, world) {
  const sky = sampleWorldSkyColor(world);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `rgb(${sky.top.r}, ${sky.top.g}, ${sky.top.b})`);
  grad.addColorStop(0.68, `rgb(${sky.horizon.r}, ${sky.horizon.g}, ${sky.horizon.b})`);
  grad.addColorStop(1, `rgb(${Math.max(8, sky.horizon.r - 10)}, ${Math.max(9, sky.horizon.g - 11)}, ${Math.max(12, sky.horizon.b - 14)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return sky;
}

function computeLayerDriftPx(layer, timeSec) {
  if (!layer || layer.drift === 'NONE') return 0;
  const depth = clamp(Number(layer.depth) || 0.22, 0.05, 0.65);
  const speed = 7 + depth * 22;
  if (layer.drift === 'LEFT') return timeSec * speed;
  if (layer.drift === 'RIGHT') return -timeSec * speed;
  if (layer.drift === 'WIND') {
    const wVel = Number.isFinite(envSys.wind) && Math.abs(envSys.wind) > 1 ? envSys.wind : 16;
    return -timeSec * wVel * (0.14 + depth * 0.34);
  }
  return 0;
}

/* Shared multi-depth parallax composite pass (used by live world, Studio preview & Worlds thumbnails) */
export function renderSceneryComposite(ctx, vpW, vpH, layers, opts = {}) {
  if (!Array.isArray(layers) || layers.length === 0) return;

  const sorted = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer || layer.visible === false) continue;
    sorted.push({ layer, idx: i });
  }
  if (sorted.length === 0) return;

  // Back-to-front by parallax depth (0.05 horizon first -> 0.65 near last)
  sorted.sort((a, b) => {
    const da = Number(a.layer.depth) || 0.22;
    const db = Number(b.layer.depth) || 0.22;
    if (Math.abs(da - db) > 0.0001) return da - db;
    return a.idx - b.idx;
  });

  const camX = Number.isFinite(opts.camX) ? opts.camX : 0;
  const camY = Number.isFinite(opts.camY) ? opts.camY : 0;
  const zoom = Number.isFinite(opts.zoom) ? opts.zoom : 3.0;
  const cx = Number.isFinite(opts.cx) ? opts.cx : vpW * 0.5;
  const cy = Number.isFinite(opts.cy) ? opts.cy : vpH * 0.5;
  const timeSec = Number.isFinite(opts.timeSec) ? opts.timeSec : 0;
  const skyRgb = opts.skyRgb || null;
  const baseUnit = Number.isFinite(opts.baseUnit) ? opts.baseUnit : Math.max(1, (zoom / 3.0) * (vpH / 185));

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i].layer;
    const img = getTintedSceneryLayerCanvas(layer, skyRgb);
    if (!img) continue;

    const depth = clamp(Number(layer.depth) || 0.22, 0.05, 0.65);
    const depthNorm = clamp((depth - 0.05) / 0.60, 0, 1);
    const autoScaleMult = layer.autoScale !== false ? (0.72 + depthNorm * 0.74) : 1.0;
    const pxScale = Math.max(0.5, baseUnit * autoScaleMult);
    const drawW = Math.max(8, Math.round(img.width * pxScale));
    const drawH = Math.max(4, Math.round(img.height * pxScale));

    const driftPx = computeLayerDriftPx(layer, timeSec);
    const scrollScrX = (camX * depth + driftPx) * (zoom / 3.0) * baseUnit * 0.95;
    const scrollScrY = camY * depth * 0.42 * (zoom / 3.0) * baseUnit * 0.85;
    const yOffScr = (Number(layer.yOffset) || 0) * pxScale * 0.55;
    const drawY = Math.round(cy - drawH * 0.5 + yOffScr - scrollScrY);

    ctx.globalAlpha = clamp((layer.opacity ?? 95) / 100, 0.05, 1);

    if (layer.tileX !== false) {
      const startX = -(((Math.round(scrollScrX) % drawW) + drawW) % drawW);
      for (let x = startX - drawW; x < vpW + drawW; x += drawW) {
        if (x + drawW < 0) continue;
        ctx.drawImage(img, Math.round(x), drawY, drawW, drawH);
      }
    } else {
      const drawX = Math.round(cx - drawW * 0.5 - scrollScrX);
      if (drawX + drawW >= -16 && drawX <= vpW + 16 && drawY + drawH >= -16 && drawY <= vpH + 16) {
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
      }
    }
  }

  ctx.restore();
}

/* Main World Renderer Pass: renders per-world Scenery Studio parallax layers behind bg tiles */
export function renderWorldScenery(world) {
  if (!world || !world.scenery || !Array.isArray(world.scenery.layers) || world.scenery.layers.length === 0) {
    return;
  }

  const vpW = viewport.width;
  const vpH = viewport.height;
  const cx = vpW * 0.5 - camera.offsetX;
  const cy = vpH * 0.5 + camera.offsetY;
  const tNow = state.mode === 'PLAY' ? state.simTime : state.uiTime;
  const sky = sampleWorldSkyColor(world);

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  wCtx.imageSmoothingEnabled = false;

  renderSceneryComposite(wCtx, vpW, vpH, world.scenery.layers, {
    camX: camera.x,
    camY: camera.y,
    zoom: camera.zoom,
    cx,
    cy,
    timeSec: tNow,
    skyRgb: sky.tint
  });

  wCtx.restore();
}

export const renderFarBacks = renderWorldScenery;
