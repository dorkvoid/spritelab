import { defaultLightOpts, STARTER_TILE_ID, TILE } from '../constants.js';
import {
  closeWorldsBtn,
  closeWorldsX,
  exportDataBtn,
  importDataBtn,
  importFileInput,
  newWorldBtn,
  openWorldsBtn,
  showToast,
  worldsCountBadge,
  worldSearchClearBtn,
  worldSearchInput,
  worldsList,
  worldsModal,
  worldSortSelect
} from '../dom.js';
import { loadWorldPlayerPos } from '../physics.js';
import { getActiveWorld, getSpriteById, rebuildSpriteIndex, state, worldFX } from '../state.js';
import {
  createStarterWorld,
  sanitizeSprite,
  sanitizeWorld,
  savePrefsNow,
  saveSpritesNow,
  saveWorldsNow,
  serializeSprites
} from '../storage.js';
import { closeOpenCustomSelect, syncCustomSelect } from './selects.js';
import { renderSidebar } from './sidebar.js';
import { updateTopUI } from './topbar.js';
import { clamp, generateUniqueName, hexToRgb, orientToTransform, starterTileCanvas } from '../utils.js';
import { clearWorldHistory, getTileOrient } from '../world.js';

/* =========================================================================
   SAVED WORLDS GALLERY & LIVE PIXEL-ART WORLD PREVIEW RENDERER
   ========================================================================= */
const PREVIEW_W = 240;
const PREVIEW_H = 136;

let worldSearchQuery = '';
let worldSortMode = 'RECENT';

export function countWorldTiles(w) {
  return (
    Object.keys(w.layers.bg || {}).length +
    Object.keys(w.layers.main || {}).length +
    Object.keys(w.layers.fg || {}).length
  );
}

function formatWorldTime(ts) {
  const stamp = Number.isFinite(ts) ? ts : Date.now();
  const diffSec = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
  if (diffSec < 60) return 'JUST NOW';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + 'M AGO';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'H AGO';
  const dt = new Date(stamp);
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase();
}

function parseWorldTileLayer(world, layerName) {
  const src = (world.layers && world.layers[layerName]) || {};
  const entries = [];
  for (const key of Object.keys(src)) {
    const id = src[key];
    if (!id) continue;
    const sep = key.indexOf(',');
    if (sep <= 0) continue;
    const tx = parseInt(key.slice(0, sep), 10);
    const ty = parseInt(key.slice(sep + 1), 10);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    const isStarter = id === STARTER_TILE_ID;
    const sp = isStarter ? null : getSpriteById(id);
    if (!isStarter && !sp) continue;
    entries.push({
      key,
      tx,
      ty,
      id,
      sp,
      orient: getTileOrient(world, layerName, key)
    });
  }
  return entries;
}

function drawPreviewTile(ctx, img, dx, dy, dw, dh, orient, alpha = 1) {
  if (!img) return;
  const x0 = Math.round(dx);
  const y0 = Math.round(dy);
  const x1 = Math.round(dx + dw);
  const y1 = Math.round(dy + dh);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  if (!orient && alpha >= 0.999) {
    ctx.drawImage(img, x0, y0, w, h);
    return;
  }

  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = clamp(alpha, 0, 1);
  if (!orient) {
    ctx.drawImage(img, x0, y0, w, h);
  } else {
    const { flip, rot } = orientToTransform(orient);
    const drawW = (rot & 1) ? h : w;
    const drawH = (rot & 1) ? w : h;
    ctx.translate(x0 + w * 0.5, y0 + h * 0.5);
    if (rot) ctx.rotate(rot * Math.PI * 0.5);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  }
  ctx.restore();
}

function drawPreviewBackdropLights(ctx, bgEntries, camTx, camTy, tilePx, originX, originY) {
  let stdR = 0, stdG = 0, stdB = 0, stdW = 0, stdMaxA = 0, stdSx = 0, stdSy = 0;
  let topR = 0, topG = 0, topB = 0, topW = 0, topMaxW = 0;
  let bestFill = null;

  for (let i = 0; i < bgEntries.length; i++) {
    const e = bgEntries[i];
    if (!e.sp || e.sp.type !== 'LIGHT') continue;
    const sub = e.sp.subType;
    if (sub === 'LIGHT GLOW' || sub === 'SURROUND LIGHT') continue;

    const dist = Math.hypot(e.tx + 0.5 - camTx, e.ty + 0.5 - camTy);
    const maxDist = 26;
    if (dist >= maxDist) continue;
    const w = dist <= 10 ? 1 : (1 - (dist - 10) / (maxDist - 10));
    const rgb = hexToRgb(e.sp.lightColor || (e.sp.palette && e.sp.palette[0]) || '#f28c38');
    const opts = e.sp.lightOpts || defaultLightOpts();

    if (sub === 'TOP LIGHT') {
      topR += rgb.r * w;
      topG += rgb.g * w;
      topB += rgb.b * w;
      topW += w;
      if (w > topMaxW) topMaxW = w;
    } else if (sub === 'FILL LIGHT') {
      if (!bestFill || w >= bestFill.w) {
        bestFill = { rgb, w, fillMode: opts.fillMode || 'FULL SCREEN' };
      }
    } else {
      const baseA = opts.thick ? 0.54 : 0.30;
      const contribA = baseA * w;
      stdR += rgb.r * w;
      stdG += rgb.g * w;
      stdB += rgb.b * w;
      stdW += w;
      if (contribA > stdMaxA) stdMaxA = contribA;
      stdSx += clamp(originX + (e.tx + 0.5) * tilePx, -PREVIEW_W * 0.2, PREVIEW_W * 1.2) * w;
      stdSy += clamp(originY + (e.ty + 0.5) * tilePx, -PREVIEW_H * 0.2, PREVIEW_H * 1.2) * w;
    }
  }

  if (stdW > 0.01) {
    const r = Math.round(stdR / stdW);
    const g = Math.round(stdG / stdW);
    const b = Math.round(stdB / stdW);
    const cx = clamp(stdSx / stdW, 0, PREVIEW_W);
    const cy = clamp(stdSy / stdW, 0, PREVIEW_H);
    const maxR = Math.hypot(PREVIEW_W, PREVIEW_H) * 0.78;
    const peakA = clamp(stdMaxA * 1.1, 0, 0.74);
    const ambA = clamp(stdMaxA * 0.58, 0, 0.48);
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, maxR);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${peakA})`);
    grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${ambA})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${ambA * 0.45})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  }

  if (bestFill) {
    const { r, g, b } = bestFill.rgb;
    const fillA = clamp(bestFill.w * 0.78, 0, 0.84);
    const m = bestFill.fillMode;
    if (m === 'TOP HALF') {
      const grad = ctx.createLinearGradient(0, 0, 0, PREVIEW_H * 0.62);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      grad.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, ${fillA * 0.9})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, PREVIEW_W, Math.ceil(PREVIEW_H * 0.64));
    } else if (m === 'BOTTOM HALF') {
      const grad = ctx.createLinearGradient(0, PREVIEW_H * 0.38, 0, PREVIEW_H);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, ${fillA * 0.9})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, Math.floor(PREVIEW_H * 0.38), PREVIEW_W, Math.ceil(PREVIEW_H * 0.64));
    } else if (m === 'LEFT HALF') {
      const grad = ctx.createLinearGradient(0, 0, PREVIEW_W * 0.62, 0);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      grad.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, ${fillA * 0.9})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, Math.ceil(PREVIEW_W * 0.64), PREVIEW_H);
    } else if (m === 'RIGHT HALF') {
      const grad = ctx.createLinearGradient(PREVIEW_W * 0.38, 0, PREVIEW_W, 0);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, ${fillA * 0.9})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      ctx.fillStyle = grad;
      ctx.fillRect(Math.floor(PREVIEW_W * 0.38), 0, Math.ceil(PREVIEW_W * 0.64), PREVIEW_H);
    } else if (m === 'CENTER BAND') {
      const grad = ctx.createLinearGradient(0, PREVIEW_H * 0.16, 0, PREVIEW_H * 0.84);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      grad.addColorStop(0.8, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, Math.floor(PREVIEW_H * 0.16), PREVIEW_W, Math.ceil(PREVIEW_H * 0.68));
    } else {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillA})`;
      ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    }
  }

  if (topW > 0.01) {
    const r = Math.round(topR / topW);
    const g = Math.round(topG / topW);
    const b = Math.round(topB / topW);
    const w = clamp(topMaxW, 0, 1);
    const mixLight = c => Math.min(255, Math.round(c + (255 - c) * 0.22));
    const grad = ctx.createLinearGradient(0, 0, 0, PREVIEW_H * 0.82);
    grad.addColorStop(0, `rgba(${mixLight(r)}, ${mixLight(g)}, ${mixLight(b)}, ${clamp(w * 0.78, 0, 0.85)})`);
    grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${clamp(w * 0.48, 0, 0.58)})`);
    grad.addColorStop(0.70, `rgba(${r}, ${g}, ${b}, ${clamp(w * 0.16, 0, 0.24)})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H * 0.84);
  }
}

function drawPreviewEnvHints(ctx, bgEntries, camTx, camTy) {
  let hasStars = false;
  let hasClouds = false;
  let hasRain = false;
  let hasSnow = false;
  let hasMist = false;
  let hasHeat = false;

  for (let i = 0; i < bgEntries.length; i++) {
    const e = bgEntries[i];
    if (!e.sp || e.sp.type !== 'ENVIRONMENT') continue;
    if (Math.hypot(e.tx - camTx, e.ty - camTy) > 28) continue;
    const sub = e.sp.subType;
    if (sub === 'STARS') hasStars = true;
    else if (sub === 'CLOUDS') hasClouds = true;
    else if (sub === 'RAIN') hasRain = true;
    else if (sub === 'SNOW') hasSnow = true;
    else if (sub === 'MIST' || sub === 'STEAM') hasMist = true;
    else if (sub === 'RISING HEAT') hasHeat = true;
  }

  if (hasStars) {
    for (let i = 0; i < 26; i++) {
      const sx = ((i * 53 + 17) % (PREVIEW_W - 8)) + 4;
      const sy = ((i * 29 + 7) % Math.floor(PREVIEW_H * 0.62)) + 3;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(255, 240, 200, 0.72)' : 'rgba(215, 230, 255, 0.55)';
      ctx.fillRect(sx, sy, 1, 1);
    }
  }
  if (hasClouds) {
    ctx.fillStyle = 'rgba(210, 224, 242, 0.14)';
    ctx.fillRect(18, 16, 44, 7);
    ctx.fillRect(26, 12, 26, 4);
    ctx.fillRect(114, 22, 54, 8);
    ctx.fillRect(126, 18, 30, 4);
    ctx.fillRect(186, 13, 36, 6);
  }
  if (hasRain) {
    ctx.fillStyle = 'rgba(130, 186, 238, 0.36)';
    for (let i = 0; i < 24; i++) {
      const rx = ((i * 37 + 11) % PREVIEW_W);
      const ry = ((i * 43 + 5) % PREVIEW_H);
      ctx.fillRect(rx, ry, 1, 5);
    }
  }
  if (hasSnow) {
    ctx.fillStyle = 'rgba(235, 245, 255, 0.62)';
    for (let i = 0; i < 22; i++) {
      const fx = ((i * 47 + 9) % PREVIEW_W);
      const fy = ((i * 31 + 13) % PREVIEW_H);
      ctx.fillRect(fx, fy, i % 3 === 0 ? 2 : 1, 1);
    }
  }
  if (hasMist) {
    const grad = ctx.createLinearGradient(0, PREVIEW_H * 0.55, 0, PREVIEW_H);
    grad.addColorStop(0, 'rgba(190, 208, 224, 0)');
    grad.addColorStop(1, 'rgba(190, 208, 224, 0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, PREVIEW_H * 0.55, PREVIEW_W, PREVIEW_H * 0.45);
  }
  if (hasHeat) {
    const grad = ctx.createLinearGradient(0, PREVIEW_H * 0.62, 0, PREVIEW_H);
    grad.addColorStop(0, 'rgba(245, 132, 62, 0)');
    grad.addColorStop(1, 'rgba(245, 132, 62, 0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, PREVIEW_H * 0.62, PREVIEW_W, PREVIEW_H * 0.38);
  }
}

export function renderWorldPreviewCanvas(world, canvas) {
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Base dark-studio abyss backdrop
  ctx.fillStyle = '#0d0e11';
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

  const bgEntries = parseWorldTileLayer(world, 'bg');
  const mainEntries = parseWorldTileLayer(world, 'main');
  const fgEntries = parseWorldTileLayer(world, 'fg');
  const allEntries = [...bgEntries, ...mainEntries, ...fgEntries];

  // Determine anchor from playerPos or spawn
  const rawAnchor = world.playerPos || world.spawn || { x: 0, y: 0 };
  const anchorTx = (Number.isFinite(rawAnchor.x) ? rawAnchor.x : 0) / TILE + 0.45;
  const anchorTy = (Number.isFinite(rawAnchor.y) ? rawAnchor.y : 0) / TILE + 0.45;

  let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity;
  for (let i = 0; i < allEntries.length; i++) {
    const e = allEntries[i];
    let x0 = e.tx;
    let x1 = e.tx + 1;
    let y0 = e.ty;
    let y1 = e.ty + 1;
    if (e.sp && e.sp.type === 'BIG_THING') {
      const mult = e.sp.subType === '3X3 HUGE' ? 3 : 2;
      x0 = e.tx - (mult - 1) * 0.5;
      x1 = x0 + mult;
      y0 = e.ty - (mult - 1);
      y1 = y0 + mult;
    }
    if (x0 < minTx) minTx = x0;
    if (x1 > maxTx) maxTx = x1;
    if (y0 < minTy) minTy = y0;
    if (y1 > maxTy) maxTy = y1;
  }

  let tilePx = 12;
  let camTx = anchorTx;
  let camTy = anchorTy;

  if (allEntries.length > 0 && Number.isFinite(minTx)) {
    const spanX = Math.max(1, maxTx - minTx);
    const spanY = Math.max(1, maxTy - minTy);

    if (spanX <= 30 && spanY <= 17) {
      // Compact/medium build: frame entire world cleanly with comfortable breathing room
      const fitPx = Math.min(PREVIEW_W / (spanX + 3.0), PREVIEW_H / (spanY + 2.6));
      tilePx = Math.max(6, Math.round(clamp(fitPx, 6, 15)));
      camTx = (minTx + maxTx) * 0.5;
      camTy = (minTy + maxTy) * 0.5;
    } else {
      // Large/sprawling world: frame a crisp viewport around the player/spawn neighborhood
      let nearCount = 0;
      let sumX = 0;
      let sumY = 0;
      for (let i = 0; i < allEntries.length; i++) {
        const e = allEntries[i];
        if (Math.abs(e.tx + 0.5 - anchorTx) <= 14 && Math.abs(e.ty + 0.5 - anchorTy) <= 9) {
          nearCount++;
          sumX += e.tx + 0.5;
          sumY += e.ty + 0.5;
        }
      }
      if (nearCount >= 2) {
        tilePx = 10;
        const cx = sumX / nearCount;
        const cy = sumY / nearCount;
        camTx = anchorTx * 0.55 + cx * 0.45;
        camTy = anchorTy * 0.55 + cy * 0.45;
      } else {
        const fitPx = Math.min(PREVIEW_W / (spanX + 2), PREVIEW_H / (spanY + 2));
        tilePx = Math.max(3, Math.floor(clamp(fitPx, 3, 12)));
        camTx = (minTx + maxTx) * 0.5;
        camTy = (minTy + maxTy) * 0.5;
      }
    }
  }

  const originX = Math.round(PREVIEW_W * 0.5 - camTx * tilePx);
  const originY = Math.round(PREVIEW_H * 0.5 - camTy * tilePx);

  // Subtle dark-studio grid lines behind tiles (just like the workspace viewport)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.024)';
  const step = Math.max(8, tilePx);
  const gxStart = ((originX % step) + step) % step;
  const gyStart = ((originY % step) + step) % step;
  for (let x = gxStart; x < PREVIEW_W; x += step) {
    ctx.fillRect(x, 0, 1, PREVIEW_H);
  }
  for (let y = gyStart; y < PREVIEW_H; y += step) {
    ctx.fillRect(0, y, PREVIEW_W, 1);
  }

  // 1. Background Lights (LIGHT / TOP LIGHT / FILL LIGHT)
  drawPreviewBackdropLights(ctx, bgEntries, camTx, camTy, tilePx, originX, originY);

  // 2. Subtle Environment Atmosphere Hints (STARS / CLOUDS / RAIN / SNOW / MIST / HEAT)
  drawPreviewEnvHints(ctx, bgEntries, camTx, camTy);

  const isInFrame = (dx, dy, dw, dh) =>
    (dx + dw) >= -tilePx && dx <= (PREVIEW_W + tilePx) &&
    (dy + dh) >= -tilePx && dy <= (PREVIEW_H + tilePx);

  const frontBigPass = [];
  const lightGlows = [];
  let surroundLight = null;

  // 3. BG Layer (FAR BACK, BACK, BIG_THING back cell, LIGHT fixtures)
  for (let i = 0; i < bgEntries.length; i++) {
    const e = bgEntries[i];
    const sp = e.sp;
    if (!sp) continue;

    if (sp.type === 'LIGHT' && sp.subType === 'SURROUND LIGHT') {
      const dist = Math.hypot(e.tx + 0.5 - camTx, e.ty + 0.5 - camTy);
      if (dist < 26 && (!surroundLight || dist < surroundLight.dist)) {
        surroundLight = { sp, dist };
      }
    }
    if (sp.type === 'LIGHT' && sp.subType === 'LIGHT GLOW') {
      lightGlows.push(e);
    }
    if (sp.type === 'BIG_THING' && sp.subType === 'BACK + FRONT' && sp._canvases && sp._canvases[1]) {
      frontBigPass.push(e);
    }

    const canvasImg = sp._canvases && sp._canvases[0];
    if (!canvasImg) continue;

    let dx = originX + e.tx * tilePx;
    let dy = originY + e.ty * tilePx;
    let dw = tilePx;
    let dh = tilePx;
    let alpha = 1;

    if (sp.type === 'BIG_THING') {
      const mult = sp.subType === '3X3 HUGE' ? 3 : 2;
      dw = tilePx * mult;
      dh = tilePx * mult;
      dx = originX + (e.tx - (mult - 1) * 0.5) * tilePx;
      dy = originY + (e.ty - (mult - 1)) * tilePx;
    } else if (sp.type === 'BACK' && sp.subType === 'FAR BACK') {
      alpha = 0.55;
    } else if (sp.type === 'LIGHT' && sp.subType !== 'LIGHT GLOW') {
      alpha = 0.52;
    } else if (sp.type === 'ENVIRONMENT') {
      alpha = 0.42;
    }

    if (!isInFrame(dx, dy, dw, dh)) continue;
    drawPreviewTile(ctx, canvasImg, dx, dy, dw, dh, e.orient, alpha);
  }

  // Build quick liquid lookup for crisp exposed top-row waterline accents
  const mainLayerMap = (world.layers && world.layers.main) || {};

  // 4. MAIN Layer (starter blocks + all placed sprites with exact orientation)
  for (let i = 0; i < mainEntries.length; i++) {
    const e = mainEntries[i];
    const img = e.id === STARTER_TILE_ID
      ? starterTileCanvas
      : (e.sp && e.sp._canvases && e.sp._canvases[0]);
    if (!img) continue;

    const dx = originX + e.tx * tilePx;
    const dy = originY + e.ty * tilePx;
    if (!isInFrame(dx, dy, tilePx, tilePx)) continue;

    drawPreviewTile(ctx, img, dx, dy, tilePx, tilePx, e.orient, 1);

    // Subtle crisp water surface crest on exposed top-row LIQUID tiles
    if (e.sp && e.sp.type === 'LIQUID') {
      const aboveId = mainLayerMap[`${e.tx},${e.ty - 1}`];
      const aboveSp = aboveId && aboveId !== STARTER_TILE_ID ? getSpriteById(aboveId) : null;
      if (!aboveSp || aboveSp.type !== 'LIQUID') {
        ctx.fillStyle = 'rgba(235, 248, 255, 0.34)';
        ctx.fillRect(Math.round(dx), Math.round(dy), Math.max(1, Math.round(tilePx)), 1);
      }
    }
  }

  // 5. BIG_THING BACK + FRONT (Cell 2 overlay in front of main)
  for (let i = 0; i < frontBigPass.length; i++) {
    const e = frontBigPass[i];
    const sp = e.sp;
    const img = sp._canvases[1];
    const mult = 2;
    const dw = tilePx * mult;
    const dh = tilePx * mult;
    const dx = originX + (e.tx - 0.5) * tilePx;
    const dy = originY + (e.ty - 1) * tilePx;
    if (!isInFrame(dx, dy, dw, dh)) continue;
    drawPreviewTile(ctx, img, dx, dy, dw, dh, e.orient, 1);
  }

  // 6. FG Layer
  for (let i = 0; i < fgEntries.length; i++) {
    const e = fgEntries[i];
    const sp = e.sp;
    const img = sp && sp._canvases && sp._canvases[0];
    if (!img) continue;
    let dx = originX + e.tx * tilePx;
    let dy = originY + e.ty * tilePx;
    let dw = tilePx;
    let dh = tilePx;
    if (sp.type === 'BIG_THING') {
      const mult = sp.subType === '3X3 HUGE' ? 3 : 2;
      dw = tilePx * mult;
      dh = tilePx * mult;
      dx = originX + (e.tx - (mult - 1) * 0.5) * tilePx;
      dy = originY + (e.ty - (mult - 1)) * tilePx;
    }
    if (!isInFrame(dx, dy, dw, dh)) continue;
    drawPreviewTile(ctx, img, dx, dy, dw, dh, e.orient, 1);
  }

  // 7. LIGHT GLOW Halos & 38x38 Glow Sprites
  for (let i = 0; i < lightGlows.length; i++) {
    const e = lightGlows[i];
    const sp = e.sp;
    const cx = originX + (e.tx + 0.5) * tilePx;
    const cy = originY + (e.ty + 0.5) * tilePx;
    const glowSz = tilePx * 2;
    if (!isInFrame(cx - glowSz, cy - glowSz, glowSz * 2, glowSz * 2)) continue;
    const rgb = hexToRgb(sp.lightColor || (sp.palette && sp.palette[0]) || '#f28c38');
    const haloR = glowSz * 0.95;
    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, haloR);
    grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.34)`);
    grad.addColorStop(0.55, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`);
    grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - haloR, cy - haloR, haloR * 2, haloR * 2);
    if (sp._glowCanvas) {
      drawPreviewTile(ctx, sp._glowCanvas, cx - glowSz * 0.5, cy - glowSz * 0.5, glowSz, glowSz, e.orient, 0.65);
    }
  }

  // 8. SURROUND LIGHT Perimeter Vignette
  if (surroundLight) {
    const sp = surroundLight.sp;
    const rgb = hexToRgb(sp.lightColor || (sp.palette && sp.palette[0]) || '#000000');
    const cx = PREVIEW_W * 0.5;
    const cy = PREVIEW_H * 0.5;
    const grad = ctx.createRadialGradient(cx, cy, PREVIEW_H * 0.22, cx, cy, Math.hypot(cx, cy));
    grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    grad.addColorStop(0.65, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
    grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.72)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  }

  // Empty world crisp spawn crosshair marker so blank worlds look intentional
  if (allEntries.length === 0) {
    const cx = Math.round(PREVIEW_W * 0.5);
    const cy = Math.round(PREVIEW_H * 0.5);
    ctx.fillStyle = 'rgba(242, 140, 56, 0.55)';
    ctx.fillRect(cx - 8, cy, 5, 1);
    ctx.fillRect(cx + 4, cy, 5, 1);
    ctx.fillRect(cx, cy - 8, 1, 5);
    ctx.fillRect(cx, cy + 4, 1, 5);
    ctx.fillStyle = '#f28c38';
    ctx.fillRect(cx - 1, cy - 1, 3, 3);
  }
}

export function switchWorld(worldId) {
  if (worldId === state.activeWorldId) {
    closeWorldsModal();
    return;
  }
  const target = state.worlds.find(w => w.id === worldId);
  if (!target) return;
  saveWorldsNow(false);
  state.activeWorldId = target.id;
  clearWorldHistory();
  worldFX.tileTriggers.clear();
  worldFX.bounceTimers.clear();
  worldFX.buildPops.clear();
  worldFX.particles.length = 0;
  loadWorldPlayerPos(target);
  savePrefsNow();
  updateTopUI();
  renderWorldsModal();
  closeWorldsModal();
  showToast('LOADED ' + target.name);
}

function getFilteredSortedWorlds() {
  const q = worldSearchQuery.trim().toLowerCase();
  const list = state.worlds.filter(w => {
    if (!q) return true;
    return String(w.name || '').toLowerCase().includes(q);
  });

  const sorted = [...list];
  if (worldSortMode === 'NAME') {
    sorted.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }));
  } else if (worldSortMode === 'TILES') {
    sorted.sort((a, b) => {
      const diff = countWorldTiles(b) - countWorldTiles(a);
      if (diff !== 0) return diff;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  } else if (worldSortMode === 'OLDEST') {
    sorted.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  } else {
    // RECENT: most recently edited first (active world naturally rises to top when open)
    sorted.sort((a, b) => {
      if (a.id === state.activeWorldId && b.id !== state.activeWorldId) return -1;
      if (b.id === state.activeWorldId && a.id !== state.activeWorldId) return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }
  return sorted;
}

function startInlineWorldRename(w, nameEl) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'inline-rename-input';
  inp.maxLength = 24;
  inp.value = w.name;
  nameEl.replaceWith(inp);
  inp.focus();
  inp.select();

  let done = false;
  const commit = saveChange => {
    if (done) return;
    done = true;
    if (saveChange) {
      const val = (inp.value || '').trim().toUpperCase().slice(0, 24);
      if (val && val !== w.name) {
        w.name = val;
        w.updatedAt = Date.now();
        saveWorldsNow(true);
        updateTopUI();
      }
    }
    renderWorldsModal();
  };

  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      commit(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      commit(false);
    }
  });
  inp.addEventListener('click', ev => ev.stopPropagation());
}

export function renderWorldsModal() {
  const total = state.worlds.length;
  const visible = getFilteredSortedWorlds();

  if (worldsCountBadge) {
    if (worldSearchQuery.trim()) {
      worldsCountBadge.textContent = `${visible.length} / ${total}`;
    } else {
      worldsCountBadge.textContent = `${total} ${total === 1 ? 'WORLD' : 'WORLDS'}`;
    }
  }
  if (worldSearchClearBtn) {
    worldSearchClearBtn.classList.toggle('visible', worldSearchQuery.length > 0);
  }

  worldsList.innerHTML = '';

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'worlds-empty';
    const msg = document.createElement('div');
    msg.textContent = `NO WORLDS MATCHING "${worldSearchQuery.trim().toUpperCase()}"`;
    const clrBtn = document.createElement('button');
    clrBtn.type = 'button';
    clrBtn.className = 'btn';
    clrBtn.textContent = 'CLEAR SEARCH';
    clrBtn.addEventListener('click', () => {
      worldSearchQuery = '';
      if (worldSearchInput) worldSearchInput.value = '';
      renderWorldsModal();
      if (worldSearchInput) worldSearchInput.focus();
    });
    empty.appendChild(msg);
    empty.appendChild(clrBtn);
    worldsList.appendChild(empty);
    return;
  }

  for (const w of visible) {
    const isActive = w.id === state.activeWorldId;
    const tiles = countWorldTiles(w);

    const card = document.createElement('div');
    card.className = 'world-card' + (isActive ? ' active' : '');
    card.dataset.worldId = w.id;

    // Top: crisp live pixel-art preview stage
    const stage = document.createElement('div');
    stage.className = 'world-preview-stage';

    const previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'world-preview-canvas';
    renderWorldPreviewCanvas(w, previewCanvas);
    stage.appendChild(previewCanvas);

    if (isActive) {
      const activeBadge = document.createElement('span');
      activeBadge.className = 'world-badge-active';
      activeBadge.textContent = 'ACTIVE';
      stage.appendChild(activeBadge);
    }

    const openBadge = document.createElement('span');
    openBadge.className = 'world-badge-open';
    openBadge.textContent = isActive ? 'RESUME' : 'ENTER';
    stage.appendChild(openBadge);

    const tileBadge = document.createElement('span');
    tileBadge.className = 'world-badge-tiles';
    tileBadge.textContent = `${tiles} ${tiles === 1 ? 'TILE' : 'TILES'}`;
    stage.appendChild(tileBadge);

    // Bottom: name, updated timestamp, and compact actions
    const footer = document.createElement('div');
    footer.className = 'world-card-footer';

    const head = document.createElement('div');
    head.className = 'world-card-head';

    const nameEl = document.createElement('div');
    nameEl.className = 'world-card-name';
    nameEl.textContent = w.name;
    nameEl.title = w.name + ' (Double-click to rename)';
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      startInlineWorldRename(w, nameEl);
    });

    const timeEl = document.createElement('span');
    timeEl.className = 'world-card-time';
    timeEl.textContent = formatWorldTime(w.updatedAt);

    head.appendChild(nameEl);
    head.appendChild(timeEl);

    const acts = document.createElement('div');
    acts.className = 'world-card-actions';

    const renBtn = document.createElement('button');
    renBtn.type = 'button';
    renBtn.className = 'btn world-act-btn';
    renBtn.textContent = 'REN';
    renBtn.dataset.tip = 'Rename world';
    renBtn.addEventListener('click', e => {
      e.stopPropagation();
      startInlineWorldRename(w, nameEl);
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'btn world-act-btn';
    dupBtn.textContent = 'DUP';
    dupBtn.dataset.tip = 'Duplicate world';
    dupBtn.addEventListener('click', e => {
      e.stopPropagation();
      const copyName = generateUniqueName(w.name, state.worlds.map(item => item.name), 24, false);
      const copy = sanitizeWorld({
        ...JSON.parse(JSON.stringify(w)),
        id: 'w_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
        name: copyName,
        updatedAt: Date.now()
      }, state.worlds.length + 1);
      state.worlds.push(copy);
      saveWorldsNow(true);
      renderWorldsModal();
      showToast('COPIED ' + copy.name);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn world-act-btn';
    delBtn.textContent = 'DEL';
    delBtn.dataset.tip = 'Delete world (click twice)';
    if (state.worlds.length <= 1) {
      delBtn.style.opacity = '0.38';
      delBtn.style.pointerEvents = 'none';
    }
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (state.worlds.length <= 1) return;
      if (delBtn.dataset.armed === '1') {
        const wasActive = w.id === state.activeWorldId;
        state.worlds = state.worlds.filter(item => item.id !== w.id);
        if (wasActive) {
          state.activeWorldId = state.worlds[0].id;
          clearWorldHistory();
          loadWorldPlayerPos(getActiveWorld());
        }
        saveWorldsNow(true);
        savePrefsNow();
        updateTopUI();
        renderWorldsModal();
        showToast('DELETED WORLD');
      } else {
        delBtn.dataset.armed = '1';
        delBtn.classList.add('danger-confirm');
        delBtn.textContent = 'SURE?';
        setTimeout(() => {
          if (delBtn.isConnected && delBtn.dataset.armed === '1') {
            delBtn.dataset.armed = '';
            delBtn.classList.remove('danger-confirm');
            delBtn.textContent = 'DEL';
          }
        }, 2200);
      }
    });

    acts.appendChild(renBtn);
    acts.appendChild(dupBtn);
    acts.appendChild(delBtn);

    footer.appendChild(head);
    footer.appendChild(acts);

    card.appendChild(stage);
    card.appendChild(footer);
    card.addEventListener('click', () => switchWorld(w.id));
    worldsList.appendChild(card);
  }
}

export function openWorldsModal() {
  saveWorldsNow(false);
  worldSearchQuery = '';
  if (worldSearchInput) worldSearchInput.value = '';
  if (worldSortSelect) {
    worldSortSelect.value = worldSortMode;
    syncCustomSelect(worldSortSelect);
  }
  renderWorldsModal();
  worldsModal.classList.add('open');
}

export function closeWorldsModal() {
  closeOpenCustomSelect(false);
  worldsModal.classList.remove('open');
}

export function initWorldsUI() {
  openWorldsBtn.addEventListener('click', openWorldsModal);
  closeWorldsX.addEventListener('click', closeWorldsModal);
  closeWorldsBtn.addEventListener('click', closeWorldsModal);
  worldsModal.addEventListener('click', e => {
    if (e.target === worldsModal) closeWorldsModal();
  });

  if (worldSearchInput) {
    worldSearchInput.addEventListener('input', () => {
      worldSearchQuery = worldSearchInput.value || '';
      renderWorldsModal();
    });
  }

  if (worldSearchClearBtn) {
    worldSearchClearBtn.addEventListener('click', () => {
      worldSearchQuery = '';
      if (worldSearchInput) {
        worldSearchInput.value = '';
        worldSearchInput.focus();
      }
      renderWorldsModal();
    });
  }

  if (worldSortSelect) {
    worldSortSelect.addEventListener('change', () => {
      worldSortMode = worldSortSelect.value || 'RECENT';
      renderWorldsModal();
    });
  }

  newWorldBtn.addEventListener('click', () => {
    saveWorldsNow(false);
    const nextName = generateUniqueName('WORLD', state.worlds.map(w => w.name), 24, true);
    const created = createStarterWorld(nextName);
    state.worlds.push(created);
    state.activeWorldId = created.id;
    clearWorldHistory();
    loadWorldPlayerPos(created);
    saveWorldsNow(true);
    savePrefsNow();
    updateTopUI();
    worldSearchQuery = '';
    if (worldSearchInput) worldSearchInput.value = '';
    renderWorldsModal();
    showToast('CREATED ' + created.name);
  });

  exportDataBtn.addEventListener('click', () => {
    saveWorldsNow(false);
    const payload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      sprites: serializeSprites(),
      worlds: state.worlds
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spritelab_backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('EXPORTED JSON');
  });

  importDataBtn.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || '{}'));
        if (Array.isArray(data.sprites)) {
          state.sprites = data.sprites.map(sanitizeSprite).filter(Boolean);
          rebuildSpriteIndex();
        }
        if (Array.isArray(data.worlds) && data.worlds.length > 0) {
          state.worlds = data.worlds.map((w, i) => sanitizeWorld(w, i + 1));
          state.activeWorldId = state.worlds[0].id;
        }
        clearWorldHistory();
        loadWorldPlayerPos(getActiveWorld());
        saveSpritesNow();
        saveWorldsNow(true);
        savePrefsNow();
        updateTopUI();
        renderSidebar();
        renderWorldsModal();
        showToast('IMPORTED DATA');
      } catch (_) {
        showToast('INVALID JSON FILE');
      }
    };
    reader.readAsText(file);
  });
}
