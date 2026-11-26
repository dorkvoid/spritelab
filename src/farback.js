import {
  defaultLightOpts,
  FARBACK_CORE_RADIUS,
  FARBACK_PROXIMITY_RADIUS,
  FARBACK_WIDE_CORE_RADIUS,
  FARBACK_WIDE_PROXIMITY_RADIUS,
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
  getBgEffectFadeOut,
  getBgEffectIndex,
  player,
  state,
  viewport,
  worldFX
} from './state.js';
import { decodeFrame } from './storage.js';
import { clamp, hexToRgb } from './utils.js';

/* =========================================================================
   WORLD SCENERY PARALLAX ENGINE (WIDE-CANVAS BACKDROPS & ATMOSPHERIC TINT)
   Renders each world's painted panoramic scenery layers back-to-front by
   depth (0.05..0.65) with automatic sky-color atmospheric blending, automatic
   depth perspective scaling, seamless horizontal tiling, and wind drift.
   ========================================================================= */

const SCENERY_SKIRT_H = 96;
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

    const skirtCanvas = document.createElement('canvas');
    skirtCanvas.width = rawCanvas.width;
    skirtCanvas.height = SCENERY_SKIRT_H;
    const skirtCtx = skirtCanvas.getContext('2d');
    skirtCtx.imageSmoothingEnabled = false;

    entry = {
      rawCanvas,
      rawCtx,
      tintedCanvas,
      tintedCtx,
      skirtCanvas,
      skirtCtx,
      pixelsRef: null,
      version: 0,
      tintSig: '',
      skirtSig: '',
      hasArt: false,
      hasBottomSkirt: false
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
    entry.skirtSig = '';
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
    entry.skirtCanvas.width = w;
    entry.skirtCanvas.height = SCENERY_SKIRT_H;
  }
  entry.hasArt = writePixelsToCanvas(entry.rawCtx, w, h, pixels);
  entry.pixelsRef = layer.pixels;
  entry.version++;
  entry.tintSig = '';
  entry.skirtSig = '';
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
      entry.skirtCanvas.width = w;
      entry.skirtCanvas.height = SCENERY_SKIRT_H;
    }
    const decoded = decodeFrame(layer.pixels, w, h);
    entry.hasArt = writePixelsToCanvas(entry.rawCtx, w, h, decoded);
    entry.pixelsRef = layer.pixels;
    entry.version++;
    entry.tintSig = '';
    entry.skirtSig = '';
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

function refreshSceneryBottomSkirt(entry, srcCanvas, srcCtx, skirtSig, skyRgb) {
  if (entry.skirtSig === skirtSig) return;
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  let touchesBottom = false;
  if (w > 0 && h > 0) {
    const rowData = srcCtx.getImageData(0, h - 1, w, 1).data;
    for (let i = 3; i < rowData.length; i += 4) {
      if (rowData[i] > 0) {
        touchesBottom = true;
        break;
      }
    }
  }
  entry.hasBottomSkirt = touchesBottom;
  if (touchesBottom) {
    const sCtx = entry.skirtCtx;
    sCtx.setTransform(1, 0, 0, 1, 0, 0);
    sCtx.globalCompositeOperation = 'source-over';
    sCtx.globalAlpha = 1;
    sCtx.imageSmoothingEnabled = false;
    sCtx.clearRect(0, 0, w, SCENERY_SKIRT_H);
    // Seamlessly extend bottom-edge columns downward (transparent sky/floating-cloud columns stay empty)
    sCtx.drawImage(srcCanvas, 0, h - 1, w, 1, 0, 0, w, SCENERY_SKIRT_H);

    // Gently deepen extended mountain/terrain bases toward the world's lower atmosphere/abyss tone
    const sr = skyRgb ? clamp(Math.round(skyRgb.r * 0.52), 10, 140) : 13;
    const sg = skyRgb ? clamp(Math.round(skyRgb.g * 0.52), 11, 140) : 14;
    const sb = skyRgb ? clamp(Math.round(skyRgb.b * 0.52), 14, 150) : 17;
    sCtx.globalCompositeOperation = 'source-atop';
    const shadeGrad = sCtx.createLinearGradient(0, 0, 0, SCENERY_SKIRT_H);
    shadeGrad.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, 0)`);
    shadeGrad.addColorStop(0.45, `rgba(${sr}, ${sg}, ${sb}, 0.24)`);
    shadeGrad.addColorStop(1, `rgba(${sr}, ${sg}, ${sb}, 0.56)`);
    sCtx.fillStyle = shadeGrad;
    sCtx.fillRect(0, 0, w, SCENERY_SKIRT_H);

    // Softly dissolve alpha into the void below (no hard horizontal cutout)
    sCtx.globalCompositeOperation = 'destination-in';
    const fadeGrad = sCtx.createLinearGradient(0, 0, 0, SCENERY_SKIRT_H);
    fadeGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    fadeGrad.addColorStop(0.14, 'rgba(255, 255, 255, 0.94)');
    fadeGrad.addColorStop(0.38, 'rgba(255, 255, 255, 0.70)');
    fadeGrad.addColorStop(0.64, 'rgba(255, 255, 255, 0.36)');
    fadeGrad.addColorStop(0.84, 'rgba(255, 255, 255, 0.12)');
    fadeGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    sCtx.fillStyle = fadeGrad;
    sCtx.fillRect(0, 0, w, SCENERY_SKIRT_H);
    sCtx.globalCompositeOperation = 'source-over';
  }
  entry.skirtSig = skirtSig;
}

export function getSceneryLayerRenderData(layer, skyRgb) {
  const entry = getSceneryLayerCache(layer);
  if (!entry || !entry.hasArt) return null;

  const skyKey = skyRgb
    ? `${clamp(Math.round(skyRgb.r), 0, 255)},${clamp(Math.round(skyRgb.g), 0, 255)},${clamp(Math.round(skyRgb.b), 0, 255)}`
    : 'none';

  const strength = computeAtmosphericTintStrength(layer);
  if (strength <= 0.008 || !skyRgb) {
    refreshSceneryBottomSkirt(entry, entry.rawCanvas, entry.rawCtx, `raw|${entry.version}|${skyKey}`, skyRgb);
    return {
      canvas: entry.rawCanvas,
      skirt: entry.hasBottomSkirt ? entry.skirtCanvas : null
    };
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

  refreshSceneryBottomSkirt(entry, entry.tintedCanvas, entry.tintedCtx, sig, skyRgb);
  return {
    canvas: entry.tintedCanvas,
    skirt: entry.hasBottomSkirt ? entry.skirtCanvas : null
  };
}

export function getTintedSceneryLayerCanvas(layer, skyRgb) {
  const data = getSceneryLayerRenderData(layer, skyRgb);
  return data ? data.canvas : null;
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
  const masterAlpha = Number.isFinite(opts.masterAlpha) ? clamp(opts.masterAlpha, 0, 1) : 1;
  if (masterAlpha <= 0.004) return;
  const hasExplicitUnit = Number.isFinite(opts.baseUnit);
  const refUnit = hasExplicitUnit ? opts.baseUnit : clamp(vpH / 185, 2.2, 5.5);
  const zoomRatio = clamp(zoom / 3.0, 0.25, 2.5);

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i].layer;
    const renderData = getSceneryLayerRenderData(layer, skyRgb);
    if (!renderData || !renderData.canvas) continue;
    const img = renderData.canvas;
    const skirt = renderData.skirt;

    const depth = clamp(Number(layer.depth) || 0.22, 0.05, 0.65);
    const depthNorm = clamp((depth - 0.05) / 0.60, 0, 1);
    const autoScaleMult = layer.autoScale !== false ? (0.72 + depthNorm * 0.74) : 1.0;
    // Depth-damped optical zoom: horizon barely scales, near layers respond gently; zero drift at screen center
    const zoomResponse = 0.22 + depth * 0.65;
    const layerZoomMult = hasExplicitUnit ? 1.0 : Math.pow(zoomRatio, zoomResponse);
    const pxScale = Math.max(0.5, refUnit * autoScaleMult * layerZoomMult);
    const drawW = Math.max(8, Math.round(img.width * pxScale));
    const drawH = Math.max(4, Math.round(img.height * pxScale));

    // Express camera offset in zoom-invariant layer pixels anchored at screen center (cx, cy)
    const driftPx = computeLayerDriftPx(layer, timeSec);
    const scrollRateX = (depth * 0.50) / autoScaleMult;
    const scrollRateY = (depth * 0.24) / autoScaleMult;
    const layerCenterX = camX * scrollRateX + driftPx;
    const layerCenterY = camY * scrollRateY - (Number(layer.yOffset) || 0) * 0.55;

    const drawY = Math.round(cy - (img.height * 0.5 + layerCenterY) * pxScale);
    const skirtY = drawY + drawH;
    const voidBelow = vpH - skirtY;
    const skirtDrawH = (skirt && voidBelow > 0)
      ? Math.max(12, Math.min(Math.round(vpH * 0.62), Math.max(Math.round(drawH * 0.55), voidBelow)))
      : 0;
    const imgVisibleY = drawY + drawH > -16 && drawY < vpH + 16;
    const skirtVisibleY = skirtDrawH > 0 && skirtY < vpH && (skirtY + skirtDrawH) > 0;
    if (!imgVisibleY && !skirtVisibleY) continue;

    ctx.globalAlpha = clamp((layer.opacity ?? 95) / 100, 0.05, 1) * masterAlpha;

    if (layer.tileX !== false) {
      const anchorScrX = cx - (img.width * 0.5 + layerCenterX) * pxScale;
      const startX = Math.round(((anchorScrX % drawW) + drawW) % drawW) - drawW;
      for (let x = startX; x < vpW + drawW; x += drawW) {
        if (x + drawW <= 0) continue;
        if (imgVisibleY) ctx.drawImage(img, x, drawY, drawW, drawH);
        if (skirtVisibleY) ctx.drawImage(skirt, x, skirtY, drawW, skirtDrawH);
      }
    } else {
      const drawX = Math.round(cx - (img.width * 0.5 + layerCenterX) * pxScale);
      if (drawX + drawW >= -16 && drawX <= vpW + 16) {
        if (imgVisibleY) ctx.drawImage(img, drawX, drawY, drawW, drawH);
        if (skirtVisibleY) ctx.drawImage(skirt, drawX, skirtY, drawW, skirtDrawH);
      }
    }
  }

  ctx.restore();
}

export function computeFarbackProximity(subType, tx, ty, refX, refY) {
  if (subType === 'WORLD-WIDE') return 1;
  const isWide = subType === 'WIDE ZONE';
  const core = isWide ? FARBACK_WIDE_CORE_RADIUS : FARBACK_CORE_RADIUS;
  const outer = isWide ? FARBACK_WIDE_PROXIMITY_RADIUS : FARBACK_PROXIMITY_RADIUS;
  const wx = tx * TILE + TILE * 0.5;
  const wy = ty * TILE + TILE * 0.5;
  const dist = Math.hypot(wx - refX, wy - refY);
  if (dist >= outer) return 0;
  if (dist <= core) return 1;
  const t = 1 - (dist - core) / Math.max(1, outer - core);
  return t * t * (3 - 2 * t);
}

/* Render a compact static panoramic composite for sidebar cards, editor inspector & BUILD badges */
export function renderFarbackPreviewToCanvas(ctx, w, h, layers, world = null) {
  if (!ctx || w <= 0 || h <= 0) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const sky = world ? drawScenerySkyBackdrop(ctx, w, h, world) : (() => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#141b2b');
    grad.addColorStop(0.7, '#222f47');
    grad.addColorStop(1, '#121723');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    return { tint: { r: 30, g: 40, b: 60 } };
  })();
  if (!Array.isArray(layers) || layers.length === 0) return false;

  const sorted = [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!l || l.visible === false) continue;
    sorted.push({ layer: l, idx: i });
  }
  sorted.sort((a, b) => {
    const da = Number(a.layer.depth) || 0.22;
    const db = Number(b.layer.depth) || 0.22;
    if (Math.abs(da - db) > 0.0001) return da - db;
    return a.idx - b.idx;
  });

  let drewAny = false;
  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i].layer;
    const img = getTintedSceneryLayerCanvas(layer, sky.tint) || getSceneryLayerRawCanvas(layer);
    if (!img) continue;
    ctx.globalAlpha = clamp((layer.opacity ?? 95) / 100, 0.05, 1);
    ctx.drawImage(img, 0, 0, w, h);
    drewAny = true;
  }
  ctx.globalAlpha = 1;
  return drewAny;
}

/* Collect proximity-weighted placed FARBACK objects (deduplicated per sprite ID for seamless biome zones) */
export function collectActiveFarbacks(world, refX, refY, includeFades = true) {
  const bySprite = new Map();
  const consider = (sp, tx, ty, fade, order) => {
    if (!sp || sp.type !== 'FARBACK' || fade <= 0.004) return;
    const layers = sp.farbackOpts && Array.isArray(sp.farbackOpts.layers) ? sp.farbackOpts.layers : null;
    if (!layers || layers.length === 0) return;
    const prox = computeFarbackProximity(sp.subType, tx, ty, refX, refY);
    const w = prox * fade;
    if (w <= 0.004) return;
    const isWorldWide = sp.subType === 'WORLD-WIDE';
    const layerOver = Boolean(sp.farbackOpts && sp.farbackOpts.layerOver);
    const prev = bySprite.get(sp.id);
    if (!prev) {
      bySprite.set(sp.id, { sp, layers, w, order, isWorldWide, layerOver });
    } else {
      if (w > prev.w) prev.w = w;
      if (order > prev.order) prev.order = order;
    }
  };

  const bgIdx = getBgEffectIndex(world);
  const entries = bgIdx ? bgIdx.farbacks : null;
  if (entries) {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const fade = includeFades ? getBgEffectFadeIn(e.key) : 1;
      consider(e.sp, e.tx, e.ty, fade, e.order);
    }
  }
  if (includeFades && worldFX.bgFadeOuts.length > 0) {
    for (let i = 0; i < worldFX.bgFadeOuts.length; i++) {
      const e = worldFX.bgFadeOuts[i];
      if (e.sp && e.sp.type === 'FARBACK') {
        consider(e.sp, e.tx, e.ty, getBgEffectFadeOut(e), e.order);
      }
    }
  }

  let maxOverrideZoneW = 0;
  for (const item of bySprite.values()) {
    if (!item.isWorldWide && !item.layerOver && item.w > maxOverrideZoneW) {
      maxOverrideZoneW = item.w;
    }
  }

  const out = [];
  const legacyLayers = (world && world.scenery && Array.isArray(world.scenery.layers) && world.scenery.layers.length > 0)
    ? world.scenery.layers
    : null;
  if (legacyLayers) {
    const legW = clamp(1 - maxOverrideZoneW, 0, 1);
    if (legW > 0.004) {
      out.push({ layers: legacyLayers, alpha: legW, isWorldWide: true, order: -1 });
    }
  }

  for (const item of bySprite.values()) {
    const alpha = item.isWorldWide ? clamp(item.w * (1 - maxOverrideZoneW), 0, 1) : clamp(item.w, 0, 1);
    if (alpha <= 0.004) continue;
    out.push({ layers: item.layers, alpha, isWorldWide: item.isWorldWide, order: item.order });
  }

  out.sort((a, b) => {
    if (a.isWorldWide !== b.isWorldWide) return a.isWorldWide ? -1 : 1;
    return a.order - b.order;
  });
  return out;
}

/* Main World Renderer Pass: renders proximity-blended placed FARBACK objects behind bg tiles */
export function renderWorldScenery(world) {
  if (!world) return;
  const refX = state.mode === 'PLAY' ? (player.x + player.w * 0.5) : camera.x;
  const refY = state.mode === 'PLAY' ? (player.y + player.h * 0.5) : camera.y;
  const activeList = collectActiveFarbacks(world, refX, refY, true);
  if (activeList.length === 0) return;

  const vpW = viewport.width;
  const vpH = viewport.height;
  const cx = vpW * 0.5 - camera.offsetX;
  const cy = vpH * 0.5 + camera.offsetY;
  const tNow = state.mode === 'PLAY' ? state.simTime : state.uiTime;
  const sky = sampleWorldSkyColor(world);

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  wCtx.imageSmoothingEnabled = false;

  for (let i = 0; i < activeList.length; i++) {
    const fb = activeList[i];
    renderSceneryComposite(wCtx, vpW, vpH, fb.layers, {
      camX: camera.x,
      camY: camera.y,
      zoom: camera.zoom,
      cx,
      cy,
      timeSec: tNow,
      skyRgb: sky.tint,
      masterAlpha: fb.alpha
    });
  }

  wCtx.restore();
}

export const renderFarBacks = renderWorldScenery;
