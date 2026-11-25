import { SFX } from './audio.js';
import {
  defaultLightOpts,
  isAnimatedHarmSubType,
  LIGHT_CORE_RADIUS,
  LIGHT_GLOW_SIZE,
  LIGHT_PROXIMITY_RADIUS,
  STARTER_TILE_ID,
  TILE
} from './constants.js';
import { isAnyModalOpen, wCtx, zoomReadoutBtn } from './dom.js';
import { envSys } from './environment.js';
import {
  camera,
  getActiveWorld,
  getBgEffectFadeIn,
  getBgEffectFadeOut,
  getBgEffectIndex,
  getSpriteById,
  isBgEffectType,
  player,
  pointer,
  pruneBgEffectFades,
  runtime,
  state,
  viewport,
  worldFX
} from './state.js';
import { clamp, getSpriteStateFps, hexToRgb, starterTileCanvas } from './utils.js';
import {
  getMainTileType,
  getTileMeta,
  getWorldLineTiles,
  getWorldRectTiles,
  screenToWorld,
  worldToScreen
} from './world.js';

export function drawCursorFX() {
  const invZ = 1 / camera.zoom;

  if (worldFX.cursorPickup) {
    const p = (state.uiTime - worldFX.cursorPickup.startUiTime) / 0.24;
    if (p >= 1) {
      worldFX.cursorPickup = null;
    } else {
      const ease = 1 - Math.pow(1 - p, 3);
      const pad = ease * 6;
      wCtx.save();
      wCtx.globalAlpha = (1 - p) * 0.85;
      wCtx.strokeStyle = worldFX.cursorPickup.color || '#f28c38';
      wCtx.lineWidth = 1.4 * invZ;
      wCtx.strokeRect(
        worldFX.cursorPickup.tx * TILE - pad,
        worldFX.cursorPickup.ty * TILE - pad,
        TILE + pad * 2,
        TILE + pad * 2
      );
      wCtx.restore();
    }
  }

  if (worldFX.cursorDeselects.length > 0) {
    wCtx.save();
    for (let i = worldFX.cursorDeselects.length - 1; i >= 0; i--) {
      const fx = worldFX.cursorDeselects[i];
      const p = (state.uiTime - fx.startUiTime) / 0.22;
      if (p >= 1) {
        worldFX.cursorDeselects.splice(i, 1);
        continue;
      }
      const sc = Math.max(0.15, 1 - p * 0.72);
      const sz = TILE * sc;
      wCtx.globalAlpha = (1 - p) * 0.72;
      if (fx.canvas) {
        wCtx.drawImage(fx.canvas, fx.wx - sz * 0.5, fx.wy - sz * 0.5, sz, sz);
      }
      wCtx.fillStyle = fx.color || '#f28c38';
      for (let j = 0; j < fx.sparks.length; j++) {
        const spk = fx.sparks[j];
        wCtx.fillRect(fx.wx + spk.vx * p - 0.75, fx.wy + spk.vy * p - 0.75, 1.5, 1.5);
      }
    }
    wCtx.restore();
  }
}

/* =========================================================================
   LIGHTING, LIQUID SURFACE, LAYER TILES, RUNTIME ENTITIES & PLAYER RENDERING
   ========================================================================= */
export function getLightRefPoint() {
  if (state.mode === 'PLAY') {
    return { x: player.x + player.w * 0.5, y: player.y + player.h * 0.5 };
  }
  return { x: camera.x, y: camera.y };
}

export function getAtmosphereProximity(tx, ty, refX, refY, coreR, maxR) {
  const wx = tx * TILE + TILE * 0.5;
  const wy = ty * TILE + TILE * 0.5;
  const dist = Math.hypot(wx - refX, wy - refY);
  if (dist >= maxR) return 0;
  if (dist <= coreR) return 1;
  const t = 1 - (dist - coreR) / Math.max(1, maxR - coreR);
  return t * t * (3 - 2 * t);
}

export function drawLightGlowOverlay(ctx, glowCanvas, cx, cy, drawSize, opts, tNow, seed = 0, haloRgb = null) {
  if (!glowCanvas) return;
  const behavior = (opts && opts.glowBehavior) || 'PULSATING';
  const style = (opts && opts.glowStyle) || 'TRANSLUCENT';

  let alpha = style === 'SOFT HAZE' ? 0.50 : (style === 'ADDITIVE GLOW' ? 0.80 : 0.64);
  let scale = 1;
  let rot = 0;
  let energy = 1;

  if (behavior === 'PULSATING') {
    const wave = 0.5 + 0.5 * Math.sin(tNow * 2.3 + seed);
    const smoothWave = wave * wave * (3 - 2 * wave);
    energy = 0.66 + smoothWave * 0.44;
    alpha *= energy;
    scale = 0.94 + smoothWave * 0.13;
  } else if (behavior === 'FLICKERING') {
    const f1 = Math.sin(tNow * 14.7 + seed * 3.1);
    const f2 = Math.sin(tNow * 27.3 + seed * 1.7);
    const f3 = Math.sin(tNow * 43.1 + seed * 5.3);
    energy = clamp(0.76 + f1 * 0.15 + f2 * 0.09 + f3 * 0.06, 0.44, 1.08);
    alpha *= energy;
    scale = 0.96 + energy * 0.06;
  } else if (behavior === 'SPINNING') {
    rot = tNow * 0.85 + seed;
  }

  ctx.save();
  ctx.translate(cx, cy);

  // Luminous soft radial halo behind the crisp 38x38 pixel glow art
  if (haloRgb) {
    const haloR = drawSize * (style === 'SOFT HAZE' ? 1.15 : (style === 'ADDITIVE GLOW' ? 1.05 : 0.82)) * scale;
    const haloCoreA = clamp(
      (style === 'ADDITIVE GLOW' ? 0.42 : (style === 'SOFT HAZE' ? 0.30 : 0.22)) * energy,
      0,
      0.75
    );
    const grad = ctx.createRadialGradient(0, 0, Math.max(1, haloR * 0.08), 0, 0, haloR);
    grad.addColorStop(0, `rgba(${haloRgb.r}, ${haloRgb.g}, ${haloRgb.b}, ${haloCoreA})`);
    grad.addColorStop(0.45, `rgba(${haloRgb.r}, ${haloRgb.g}, ${haloRgb.b}, ${haloCoreA * 0.42})`);
    grad.addColorStop(1, `rgba(${haloRgb.r}, ${haloRgb.g}, ${haloRgb.b}, 0)`);
    ctx.save();
    if (style !== 'TRANSLUCENT') ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(-haloR, -haloR, haloR * 2, haloR * 2);
    ctx.restore();
  }

  if (rot !== 0) ctx.rotate(rot);
  if (style === 'ADDITIVE GLOW') ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = clamp(alpha, 0, 1);
  const s = drawSize * scale;
  ctx.drawImage(glowCanvas, -s * 0.5, -s * 0.5, s, s);
  ctx.restore();
}

export function drawBackgroundLights(world) {
  const bgIdx = getBgEffectIndex(world);
  const entries = bgIdx.bgLights;
  const hasFadeOuts = worldFX.bgFadeOuts.length > 0;
  if (entries.length === 0 && !hasFadeOuts) return;

  const ref = getLightRefPoint();
  let bestFill = null;

  // Proximity-weighted color blending accumulators (prevents harsh snaps & muddy saturation stacking)
  let stdR = 0, stdG = 0, stdB = 0, stdW = 0, stdMaxAlpha = 0, stdScrX = 0, stdScrY = 0;
  let topR = 0, topG = 0, topB = 0, topW = 0, topMaxW = 0;

  const consider = (sp, tx, ty, fade, order) => {
    if (!sp || sp.type !== 'LIGHT' || fade <= 0.002) return;
    const sub = sp.subType;
    if (sub === 'LIGHT GLOW' || sub === 'SURROUND LIGHT') return;
    const prox = getAtmosphereProximity(tx, ty, ref.x, ref.y, LIGHT_CORE_RADIUS, LIGHT_PROXIMITY_RADIUS);
    if (prox <= 0.002) return;

    const w = prox * fade;
    const rgb = hexToRgb(sp.lightColor || (sp.palette && sp.palette[0]) || '#f28c38');
    const opts = sp.lightOpts || defaultLightOpts();

    if (sub === 'TOP LIGHT') {
      topR += rgb.r * w;
      topG += rgb.g * w;
      topB += rgb.b * w;
      topW += w;
      if (w > topMaxW) topMaxW = w;
    } else if (sub === 'FILL LIGHT') {
      if (!bestFill || order > bestFill.order || (order === bestFill.order && w > bestFill.w)) {
        bestFill = { rgb, w, fillMode: opts.fillMode || 'FULL SCREEN', order };
      }
    } else {
      const seed = tx * 0.7 + ty * 1.1;
      const pulse = opts.pulsating ? (0.60 + 0.40 * (0.5 + 0.5 * Math.sin(state.uiTime * 2.1 + seed))) : 1;
      const effW = w * pulse;
      const baseA = opts.thick ? 0.56 : 0.30;
      const contribA = baseA * effW;
      stdR += rgb.r * effW;
      stdG += rgb.g * effW;
      stdB += rgb.b * effW;
      stdW += effW;
      if (contribA > stdMaxAlpha) stdMaxAlpha = contribA;
      const scr = worldToScreen(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5);
      stdScrX += clamp(scr.sx, -viewport.width * 0.25, viewport.width * 1.25) * effW;
      stdScrY += clamp(scr.sy, -viewport.height * 0.25, viewport.height * 1.25) * effW;
    }
  };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    consider(e.sp, e.tx, e.ty, getBgEffectFadeIn(e.key), e.order);
  }
  for (let i = 0; i < worldFX.bgFadeOuts.length; i++) {
    const e = worldFX.bgFadeOuts[i];
    consider(e.sp, e.tx, e.ty, getBgEffectFadeOut(e), e.order);
  }

  if (stdW <= 0.002 && topW <= 0.002 && !bestFill) return;

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

  // 1. Standard LIGHT blended atmospheric glow (radiates smoothly from light centroid + soft room wash)
  if (stdW > 0.002) {
    const r = Math.round(stdR / stdW);
    const g = Math.round(stdG / stdW);
    const b = Math.round(stdB / stdW);
    const cx = clamp(stdScrX / stdW, 0, viewport.width);
    const cy = clamp(stdScrY / stdW, 0, viewport.height);
    const maxR = Math.hypot(viewport.width, viewport.height) * 0.78;
    const peakA = clamp(stdMaxAlpha * 1.12, 0, 0.78);
    const ambA = clamp(stdMaxAlpha * 0.62, 0, 0.52);

    const grad = wCtx.createRadialGradient(cx, cy, 8, cx, cy, maxR);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${peakA})`);
    grad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${ambA * 1.15})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${ambA * 0.55})`);
    wCtx.fillStyle = grad;
    wCtx.fillRect(0, 0, viewport.width, viewport.height);
  }

  // 2. FILL LIGHT (most recently placed wins overlap; smooth feathered horizon/band transitions)
  if (bestFill) {
    const { r, g, b } = bestFill.rgb;
    const fillA = clamp(bestFill.w * 0.80, 0, 0.88);
    const m = bestFill.fillMode;
    const vw = viewport.width;
    const vh = viewport.height;
    if (m === 'TOP HALF') {
      const grad = wCtx.createLinearGradient(0, 0, 0, vh * 0.62);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      grad.addColorStop(0.76, `rgba(${r}, ${g}, ${b}, ${fillA * 0.92})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      wCtx.fillStyle = grad;
      wCtx.fillRect(0, 0, vw, Math.ceil(vh * 0.64));
    } else if (m === 'BOTTOM HALF') {
      const grad = wCtx.createLinearGradient(0, vh * 0.38, 0, vh);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(0.24, `rgba(${r}, ${g}, ${b}, ${fillA * 0.92})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      wCtx.fillStyle = grad;
      wCtx.fillRect(0, Math.floor(vh * 0.38), vw, Math.ceil(vh * 0.64));
    } else if (m === 'LEFT HALF') {
      const grad = wCtx.createLinearGradient(0, 0, vw * 0.62, 0);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      grad.addColorStop(0.76, `rgba(${r}, ${g}, ${b}, ${fillA * 0.92})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      wCtx.fillStyle = grad;
      wCtx.fillRect(0, 0, Math.ceil(vw * 0.64), vh);
    } else if (m === 'RIGHT HALF') {
      const grad = wCtx.createLinearGradient(vw * 0.38, 0, vw, 0);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(0.24, `rgba(${r}, ${g}, ${b}, ${fillA * 0.92})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      wCtx.fillStyle = grad;
      wCtx.fillRect(Math.floor(vw * 0.38), 0, Math.ceil(vw * 0.64), vh);
    } else if (m === 'CENTER BAND') {
      const grad = wCtx.createLinearGradient(0, vh * 0.16, 0, vh * 0.84);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      grad.addColorStop(0.82, `rgba(${r}, ${g}, ${b}, ${fillA})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      wCtx.fillStyle = grad;
      wCtx.fillRect(0, Math.floor(vh * 0.16), vw, Math.ceil(vh * 0.68));
    } else {
      wCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillA})`;
      wCtx.fillRect(0, 0, vw, vh);
    }
  }

  // 3. TOP LIGHT blended atmospheric sky dome (smooth color crossfade, capped intensity)
  if (topW > 0.002) {
    const r = Math.round(topR / topW);
    const g = Math.round(topG / topW);
    const b = Math.round(topB / topW);
    const w = clamp(topMaxW, 0, 1);
    const mixLight = c => Math.min(255, Math.round(c + (255 - c) * 0.22));
    const grad = wCtx.createLinearGradient(0, 0, 0, viewport.height * 0.80);
    grad.addColorStop(0, `rgba(${mixLight(r)}, ${mixLight(g)}, ${mixLight(b)}, ${clamp(w * 0.78, 0, 0.86)})`);
    grad.addColorStop(0.32, `rgba(${r}, ${g}, ${b}, ${clamp(w * 0.50, 0, 0.60)})`);
    grad.addColorStop(0.68, `rgba(${r}, ${g}, ${b}, ${clamp(w * 0.18, 0, 0.26)})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    wCtx.fillStyle = grad;
    wCtx.fillRect(0, 0, viewport.width, viewport.height * 0.82);
  }

  wCtx.restore();
}

export function drawSurroundLights(world) {
  const bgIdx = getBgEffectIndex(world);
  const entries = bgIdx.surroundLights;
  const hasFadeOuts = worldFX.bgFadeOuts.length > 0;
  if (entries.length === 0 && !hasFadeOuts) return;

  const ref = getLightRefPoint();
  let sumR = 0, sumG = 0, sumB = 0, sumW = 0, maxW = 0;
  let innerSum = 0, edgeSum = 0;

  const consider = (sp, tx, ty, fade) => {
    if (!sp || sp.type !== 'LIGHT' || sp.subType !== 'SURROUND LIGHT' || fade <= 0.002) return;
    const prox = getAtmosphereProximity(tx, ty, ref.x, ref.y, LIGHT_CORE_RADIUS, LIGHT_PROXIMITY_RADIUS);
    if (prox <= 0.002) return;
    const w = prox * fade;
    const rgb = hexToRgb(sp.lightColor || (sp.palette && sp.palette[0]) || '#f28c38');
    const thick = (sp.lightOpts && sp.lightOpts.surroundThick) || 'NORMAL';
    const inner = thick === 'VERY THICK' ? 0.18 : (thick === 'THICK' ? 0.34 : 0.50);
    const edge = thick === 'VERY THICK' ? 0.84 : (thick === 'THICK' ? 0.68 : 0.54);
    sumR += rgb.r * w;
    sumG += rgb.g * w;
    sumB += rgb.b * w;
    innerSum += inner * w;
    edgeSum += edge * w;
    sumW += w;
    if (w > maxW) maxW = w;
  };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    consider(e.sp, e.tx, e.ty, getBgEffectFadeIn(e.key));
  }
  for (let i = 0; i < worldFX.bgFadeOuts.length; i++) {
    const e = worldFX.bgFadeOuts[i];
    consider(e.sp, e.tx, e.ty, getBgEffectFadeOut(e));
  }
  if (sumW <= 0.002) return;

  const r = Math.round(sumR / sumW);
  const g = Math.round(sumG / sumW);
  const b = Math.round(sumB / sumW);
  const innerFrac = innerSum / sumW;
  const breath = 0.97 + 0.03 * Math.sin(state.uiTime * 1.4);
  const edgeA = clamp((edgeSum / sumW) * maxW * breath, 0, 0.9);
  const cx = viewport.width * 0.5;
  const cy = viewport.height * 0.5;
  const rx = Math.max(1, cx * 1.18);
  const aspectY = viewport.height / Math.max(1, viewport.width);

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  // Elliptical viewport-matched vignette frames widescreen & square displays evenly
  wCtx.translate(cx, cy);
  wCtx.scale(1, aspectY);
  const grad = wCtx.createRadialGradient(0, 0, rx * innerFrac, 0, 0, rx);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
  grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${edgeA * 0.28})`);
  grad.addColorStop(0.82, `rgba(${r}, ${g}, ${b}, ${edgeA * 0.68})`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${edgeA})`);
  wCtx.fillStyle = grad;
  wCtx.fillRect(-rx, -rx, rx * 2, rx * 2);
  wCtx.restore();
}

/* Minecraft-style Pixel-Art Breath Bar (10 bubbles, right-to-left depletion) */
export function drawPixelBubble(ctx, x, y, px, stateKind, urgentTint = false) {
  // Crisp 9x9 Minecraft-inspired pixel bubble rendered at integer pixel scale
  const p = (dx, dy, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x + dx * px, y + dy * px, w * px, h * px);
  };

  if (stateKind === 'pop') {
    // Bursting bubble ring + snapping droplets
    const rim = urgentTint ? '#f08a8a' : '#7fd3fc';
    const core = urgentTint ? '#ffd6d6' : '#e6f9ff';
    p(3, 0, 3, 1, rim);
    p(3, 8, 3, 1, rim);
    p(0, 3, 1, 3, rim);
    p(8, 3, 1, 3, rim);
    p(1, 1, 1, 1, core);
    p(7, 1, 1, 1, core);
    p(1, 7, 1, 1, core);
    p(7, 7, 1, 1, core);
    p(2, 2, 1, 1, rim);
    p(6, 2, 1, 1, rim);
    p(2, 6, 1, 1, rim);
    p(6, 6, 1, 1, rim);
    return;
  }

  if (stateKind === 'empty') {
    // Subtle translucent empty slot outline so remaining bubbles read clearly
    const dim = 'rgba(126, 195, 232, 0.16)';
    p(2, 1, 5, 1, dim);
    p(2, 7, 5, 1, dim);
    p(1, 2, 1, 5, dim);
    p(7, 2, 1, 5, dim);
    return;
  }

  // Drop shadow for legibility over bright lights & water
  const sh = 'rgba(8, 12, 20, 0.58)';
  p(2, 2, 6, 6, sh);
  p(3, 8, 4, 1, sh);

  const outline = urgentTint ? '#7c2430' : '#17426b';
  const mid = urgentTint ? '#c94c5b' : '#2e83c7';
  const light = urgentTint ? '#f28c97' : '#65c2f5';
  const glint = '#ffffff';
  const subGlint = urgentTint ? '#ffdbe0' : '#c9f1ff';

  // Outer pixel ring
  p(2, 0, 5, 1, outline);
  p(2, 8, 5, 1, outline);
  p(0, 2, 1, 5, outline);
  p(8, 2, 1, 5, outline);
  p(1, 1, 1, 1, outline);
  p(7, 1, 1, 1, outline);
  p(1, 7, 1, 1, outline);
  p(7, 7, 1, 1, outline);

  // Translucent aqua interior
  p(2, 1, 5, 7, mid);
  p(1, 2, 7, 5, mid);

  // Lighter inner body highlight
  p(2, 2, 4, 4, light);
  p(3, 6, 3, 1, light);

  // Crisp Minecraft top-left white specular shine
  p(2, 2, 2, 1, glint);
  p(2, 3, 1, 1, glint);
  p(3, 3, 1, 1, subGlint);
  p(5, 6, 1, 1, subGlint);
}

/* Crisp 9x9 Minecraft-style pixel heart (supports full, half, empty & damage flash) */
export function drawPixelHeart(ctx, x, y, px, fillKind, flash = false) {
  const p = (dx, dy, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x + dx * px, y + dy * px, w * px, h * px);
  };

  const outline = flash ? '#ffffff' : '#2a0f14';
  const emptyBg = 'rgba(42, 18, 24, 0.55)';
  const fillCol = flash ? '#ff8a8a' : '#d63b47';
  const shadeCol = flash ? '#ff6464' : '#9c2230';
  const shineCol = '#ffd6dc';

  // Outer pixel heart silhouette
  p(1, 0, 2, 1, outline);
  p(6, 0, 2, 1, outline);
  p(0, 1, 1, 3, outline);
  p(8, 1, 1, 3, outline);
  p(3, 1, 1, 1, outline);
  p(5, 1, 1, 1, outline);
  p(4, 2, 1, 1, outline);
  p(1, 4, 1, 1, outline);
  p(7, 4, 1, 1, outline);
  p(2, 5, 1, 1, outline);
  p(6, 5, 1, 1, outline);
  p(3, 6, 1, 1, outline);
  p(5, 6, 1, 1, outline);
  p(4, 7, 1, 1, outline);

  // Interior cavity
  p(1, 1, 2, 3, emptyBg);
  p(6, 1, 2, 3, emptyBg);
  p(3, 2, 1, 4, emptyBg);
  p(5, 2, 1, 4, emptyBg);
  p(4, 3, 1, 4, emptyBg);
  p(2, 4, 1, 1, emptyBg);
  p(6, 4, 1, 1, emptyBg);

  if (fillKind === 'empty') return;

  // Left half of heart (drawn for both 'half' and 'full')
  p(1, 1, 2, 3, fillCol);
  p(3, 2, 1, 4, fillCol);
  p(2, 4, 1, 1, fillCol);
  p(4, 3, 1, 4, shadeCol);
  p(2, 1, 1, 1, shineCol);
  p(1, 2, 1, 1, shineCol);

  if (fillKind === 'full') {
    p(6, 1, 2, 3, fillCol);
    p(5, 2, 1, 4, fillCol);
    p(6, 4, 1, 1, shadeCol);
    p(7, 2, 1, 2, shadeCol);
    p(4, 3, 1, 4, fillCol);
    p(4, 6, 1, 1, shadeCol);
  }
}

export function drawBreathBar(alpha = 1) {
  if (state.mode !== 'PLAY') return;
  const showBreath = player.breathHudAlpha > 0.01 && !player.dead;
  const showHealth = player.healthHudAlpha > 0.01 || player.dead;
  if (!showBreath && !showHealth) return;

  const total = player.maxBreath;
  const px = 1; // Crisp 9x9 pixel icons proportional directly above the player
  const iconW = 9 * px;
  const gap = 1;
  const barW = total * iconW + (total - 1) * gap;
  const padX = 4;
  const padY = 3;
  const plateW = barW + padX * 2;
  const plateH = iconW + padY * 2;

  // Interpolated player head screen anchor (accounts for 29x29 BODY height vs 19x19 wireframe)
  const pX = player.prevX + (player.x - player.prevX) * alpha;
  const pY = player.prevY + (player.y - player.prevY) * alpha;
  const footCx = pX + player.w * 0.5;
  const footY = pY + player.h;
  const bodySp = state.equippedBodyId ? getSpriteById(state.equippedBodyId) : null;
  const spriteH = (bodySp && !player.dead) ? Math.max(TILE, bodySp.size || TILE) : TILE;
  const headScr = worldToScreen(footCx, footY - spriteH);

  // Prepare revival banner metrics if dead so clamping accounts for full HUD stack
  let banText = '';
  let banW = plateW;
  const banH = 19;
  const rowGap = 4;

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  wCtx.imageSmoothingEnabled = false;

  if (player.dead) {
    const labelCause = player.deathCause === 'drown'
      ? 'DROWNED'
      : (player.deathFallRagdoll ? 'FELL' : 'KNOCKED OUT');
    const secs = Math.max(0.1, player.deathTimer).toFixed(1);
    banText = `${labelCause} · REVIVING IN ${secs}S`;
    wCtx.font = '11px "Perfect DOS VGA 437", "VT323", monospace';
    banW = Math.max(plateW, Math.ceil(wCtx.measureText(banText).width) + 14);
  }

  const maxBoxW = Math.max(plateW, player.dead ? banW : 0);
  const stackH = (showHealth ? plateH : 0)
    + (showBreath ? (plateH + (showHealth ? rowGap : 0)) : 0)
    + (player.dead ? (banH + rowGap) : 0);

  const leftBound = 10;
  const rightBound = Math.max(leftBound + maxBoxW, viewport.width - (state.menusHidden ? 10 : Math.round(camera.offsetX * 2 + 10)));
  const topBound = state.menusHidden ? 10 : 50;
  const bottomBound = viewport.height - 14;

  const anchorCx = Math.round(clamp(headScr.sx, leftBound + maxBoxW * 0.5, rightBound - maxBoxW * 0.5));
  const desiredBottom = Math.round(headScr.sy - 10);
  const stackBottom = clamp(desiredBottom, topBound + stackH, bottomBound);

  const startX = Math.round(anchorCx - barW * 0.5);
  let cursorBottom = stackBottom;

  let healthPlateY = 0;
  if (showHealth) {
    healthPlateY = cursorBottom - plateH;
    cursorBottom = healthPlateY - rowGap;
  }
  let breathPlateY = 0;
  if (showBreath) {
    breathPlateY = cursorBottom - plateH;
    cursorBottom = breathPlateY - rowGap;
  }
  const banY = cursorBottom - banH;

  // 1. Pixel Heart Health Bar (closest row above the player's head)
  if (showHealth) {
    const healthY = healthPlateY + padY;
    const hpPerHeart = player.maxHealth / total; // 10 HP per heart
    const lowHp = !player.dead && player.health <= 25;
    const flashing = player.damageFlashTimer > 0 && Math.floor(state.uiTime * 28) % 2 === 0;

    wCtx.save();
    wCtx.globalAlpha = clamp(player.dead ? 1 : player.healthHudAlpha, 0, 1);

    wCtx.fillStyle = 'rgba(13, 14, 17, 0.72)';
    wCtx.fillRect(startX - padX, healthPlateY, plateW, plateH);
    wCtx.strokeStyle = (lowHp || player.dead) ? 'rgba(207, 89, 89, 0.8)' : 'rgba(58, 64, 79, 0.75)';
    wCtx.lineWidth = 1;
    wCtx.strokeRect(startX - padX + 0.5, healthPlateY + 0.5, plateW - 1, plateH - 1);

    for (let i = 0; i < total; i++) {
      const hx = startX + i * (iconW + gap);
      let hy = healthY + 1;
      if (lowHp) {
        hy += Math.sin(state.uiTime * 42 + i * 1.9) > 0 ? -1 : 1;
      }
      const heartMin = i * hpPerHeart;
      const hpInHeart = player.health - heartMin;
      let kind = 'empty';
      if (hpInHeart >= hpPerHeart * 0.75) kind = 'full';
      else if (hpInHeart > 0.01) kind = 'half';
      drawPixelHeart(wCtx, hx, hy, px, kind, flashing);
    }

    // Smooth 3-second Revival Countdown Banner directly above the Health Bar
    if (player.dead) {
      const progress = clamp(1 - player.deathTimer / Math.max(0.1, player.deathMaxTimer), 0, 1);
      const banX = Math.round(anchorCx - banW * 0.5);

      wCtx.fillStyle = 'rgba(13, 14, 17, 0.86)';
      wCtx.fillRect(banX, banY, banW, banH);
      wCtx.strokeStyle = '#cf5959';
      wCtx.lineWidth = 1;
      wCtx.strokeRect(banX + 0.5, banY + 0.5, banW - 1, banH - 1);

      // Progress bar along bottom edge
      wCtx.fillStyle = '#f28c38';
      wCtx.fillRect(banX + 1, banY + banH - 3, Math.round((banW - 2) * progress), 2);

      wCtx.font = '11px "Perfect DOS VGA 437", "VT323", monospace';
      wCtx.fillStyle = '#f6e4d2';
      wCtx.textAlign = 'center';
      wCtx.textBaseline = 'middle';
      wCtx.fillText(banText, banX + banW * 0.5, banY + (banH - 2) * 0.5);
      wCtx.textAlign = 'start';
    }

    wCtx.restore();
  }

  // 2. Minecraft-Style Pixel Breath Bar (above player's head, stacked cleanly above Health Bar when both visible)
  if (showBreath) {
    const breathY = breathPlateY + padY;
    const fullBubbles = Math.floor(player.breath);
    const frac = player.breath - fullBubbles;
    const lowAir = player.submerged && player.breath <= 2.5;
    const criticalAir = player.submerged && player.breath <= 1.2;

    const popMap = new Map();
    for (let i = 0; i < player.breathPopFx.length; i++) {
      popMap.set(player.breathPopFx[i].slot, player.breathPopFx[i]);
    }

    wCtx.save();
    wCtx.globalAlpha = clamp(player.breathHudAlpha, 0, 1);

    wCtx.fillStyle = 'rgba(13, 14, 17, 0.68)';
    wCtx.fillRect(startX - padX, breathPlateY, plateW, plateH);
    wCtx.strokeStyle = criticalAir ? 'rgba(207, 89, 89, 0.78)' : 'rgba(58, 64, 79, 0.72)';
    wCtx.lineWidth = 1;
    wCtx.strokeRect(startX - padX + 0.5, breathPlateY + 0.5, plateW - 1, plateH - 1);

    for (let i = 0; i < total; i++) {
      const bx = startX + i * (iconW + gap);
      let by = breathY;
      if (lowAir && i <= fullBubbles) {
        const shake = Math.sin(state.uiTime * 38 + i * 2.1) > 0 ? -1 : 1;
        by += shake;
      }

      if (i < fullBubbles) {
        drawPixelBubble(wCtx, bx, by, px, 'full', criticalAir && i === 0);
      } else if (i === fullBubbles && frac > 0.001) {
        const isPopping = player.submerged && frac < 0.28;
        drawPixelBubble(wCtx, bx, by, px, isPopping ? 'pop' : 'full', criticalAir && i === 0);
      } else if (popMap.has(i)) {
        const fx = popMap.get(i);
        const p = clamp(fx.timer / fx.maxTimer, 0, 1);
        wCtx.save();
        wCtx.globalAlpha *= (1 - p);
        drawPixelBubble(wCtx, bx, by - Math.round(p * 3), px, 'pop', criticalAir);
        wCtx.restore();
      } else {
        drawPixelBubble(wCtx, bx, breathY, px, 'empty', false);
      }
    }

    wCtx.restore();
  }

  wCtx.restore();
}

export function drawLightsAndLabels(world, minTx, maxTx, minTy, maxTy) {
  const bgIdx = getBgEffectIndex(world);

  // 1a. Localized world-space radial illumination pools around placed standard LIGHT tiles
  const bgLights = bgIdx.bgLights;
  for (let i = 0; i < bgLights.length; i++) {
    const e = bgLights[i];
    if (!e.sp || e.sp.subType !== 'LIGHT') continue;
    if (e.tx < minTx - 5 || e.tx > maxTx + 5 || e.ty < minTy - 5 || e.ty > maxTy + 5) continue;
    const fade = getBgEffectFadeIn(e.key);
    if (fade <= 0.002) continue;
    const opts = e.sp.lightOpts || defaultLightOpts();
    const seed = e.tx * 0.7 + e.ty * 1.1;
    const pulse = opts.pulsating ? (0.64 + 0.36 * (0.5 + 0.5 * Math.sin(state.uiTime * 2.1 + seed))) : 1;
    const rgb = hexToRgb(e.sp.lightColor || (e.sp.palette && e.sp.palette[0]) || '#f28c38');
    const lx = e.tx * TILE + TILE * 0.5;
    const ly = e.ty * TILE + TILE * 0.5;
    const radius = TILE * (opts.thick ? 5.2 : 3.7) * (0.94 + pulse * 0.08);
    const coreA = clamp((opts.thick ? 0.30 : 0.22) * fade * pulse, 0, 0.45);
    const grad = wCtx.createRadialGradient(lx, ly, 2, lx, ly, radius);
    grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${coreA})`);
    grad.addColorStop(0.45, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${coreA * 0.38})`);
    grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    wCtx.save();
    wCtx.globalCompositeOperation = 'lighter';
    wCtx.fillStyle = grad;
    wCtx.fillRect(lx - radius, ly - radius, radius * 2, radius * 2);
    wCtx.restore();
  }

  // 1b. Placed 38x38 LIGHT GLOW overlays with dominant-color halo bloom
  const glows = bgIdx.lightGlows;
  for (let i = 0; i < glows.length; i++) {
    const e = glows[i];
    if (e.tx < minTx - 3 || e.tx > maxTx + 3 || e.ty < minTy - 3 || e.ty > maxTy + 3) continue;
    if (!e.sp._glowCanvas) continue;
    const fade = getBgEffectFadeIn(e.key);
    if (fade <= 0.002) continue;
    wCtx.save();
    wCtx.globalAlpha = fade;
    drawLightGlowOverlay(
      wCtx,
      e.sp._glowCanvas,
      e.tx * TILE + TILE * 0.5,
      e.ty * TILE + TILE * 0.5,
      LIGHT_GLOW_SIZE,
      e.sp.lightOpts,
      state.uiTime,
      e.tx * 0.7 + e.ty * 1.3,
      e.sp._glowHaloRgb || null
    );
    wCtx.restore();
  }

  // Fading-out LIGHT GLOW overlays
  for (let i = 0; i < worldFX.bgFadeOuts.length; i++) {
    const e = worldFX.bgFadeOuts[i];
    if (!e.sp || e.sp.type !== 'LIGHT' || e.sp.subType !== 'LIGHT GLOW' || !e.sp._glowCanvas) continue;
    const fade = getBgEffectFadeOut(e);
    if (fade <= 0.002) continue;
    wCtx.save();
    wCtx.globalAlpha = fade;
    drawLightGlowOverlay(
      wCtx,
      e.sp._glowCanvas,
      e.tx * TILE + TILE * 0.5,
      e.ty * TILE + TILE * 0.5,
      LIGHT_GLOW_SIZE,
      e.sp.lightOpts,
      state.uiTime,
      e.tx * 0.7 + e.ty * 1.3,
      e.sp._glowHaloRgb || null
    );
    wCtx.restore();
  }

  // 2. Equipped HOLDABLE (LIGHT) handheld lantern halo (colored from the holdable's actual pixels)
  if (state.equippedHoldableId && !player.dead) {
    const hSp = getSpriteById(state.equippedHoldableId);
    if (hSp && hSp.type === 'HOLDABLE' && hSp.subType === 'LIGHT') {
      const swingOff = runtime.holdSwingTimer > 0 ? Math.sin((runtime.holdSwingTimer / 0.22) * Math.PI) * 5 : 0;
      const lx = player.x + player.w * 0.5 + player.facing * (8 + swingOff);
      const ly = player.y + player.h * 0.44 - swingOff * 0.35;
      const flick = 0.94 + 0.06 * Math.sin(state.uiTime * 6.5) + 0.03 * Math.sin(state.uiTime * 17.2);
      const r = TILE * 4.2 * flick;
      const rgb = hSp._glowHaloRgb || { r: 255, g: 214, b: 146 };
      const mixCore = c => Math.min(255, Math.round(c + (255 - c) * 0.42));
      const grad = wCtx.createRadialGradient(lx, ly, 1.5, lx, ly, r);
      grad.addColorStop(0, `rgba(${mixCore(rgb.r)}, ${mixCore(rgb.g)}, ${mixCore(rgb.b)}, ${0.40 * flick})`);
      grad.addColorStop(0.38, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.20 * flick})`);
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
      wCtx.save();
      wCtx.globalCompositeOperation = 'lighter';
      wCtx.fillStyle = grad;
      wCtx.fillRect(lx - r, ly - r, r * 2, r * 2);
      wCtx.restore();
    }
  }

  // 3. PLACES proximity floating labels
  const places = bgIdx.places;
  if (places.length > 0) {
    const px = player.x + player.w * 0.5;
    const py = player.y + player.h * 0.5;
    for (let i = 0; i < places.length; i++) {
      const e = places[i];
      if (e.tx < minTx - 2 || e.tx > maxTx + 2 || e.ty < minTy - 2 || e.ty > maxTy + 2) continue;
      const text = (e.sp.customText || e.sp.name || '').trim();
      if (!text) continue;
      const wx = e.tx * TILE + TILE * 0.5;
      const wy = e.ty * TILE;
      const dist = Math.hypot(wx - px, wy - py);
      const alpha = state.mode === 'BUILD' ? 0.85 : clamp(1 - (dist - TILE * 3) / (TILE * 4), 0, 1);
      if (alpha <= 0.02) continue;

      const pos = worldToScreen(wx, wy - 6);
      wCtx.save();
      wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
      wCtx.globalAlpha = alpha * getBgEffectFadeIn(e.key);
      wCtx.font = '12px "Perfect DOS VGA 437", "VT323", monospace';
      const tw = wCtx.measureText(text).width;
      const bw = tw + 10;
      const bh = 18;
      const bx = Math.round(pos.sx - bw * 0.5);
      const by = Math.round(pos.sy - bh);
      wCtx.fillStyle = 'rgba(13, 14, 17, 0.88)';
      wCtx.fillRect(bx, by, bw, bh);
      wCtx.strokeStyle = '#3a404f';
      wCtx.lineWidth = 1;
      wCtx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      wCtx.fillStyle = '#f6e4d2';
      wCtx.textBaseline = 'middle';
      wCtx.fillText(text, bx + 5, by + bh * 0.5 + 1);
      wCtx.restore();
    }
  }
}

export function resolveTileFrameCanvas(sp, layer, key) {
  if (!sp || !sp._canvases || sp._canvases.length === 0) return null;
  if (sp._canvases.length === 1) return sp._canvases[0];

  if (sp.type === 'HARMFUL' && !isAnimatedHarmSubType(sp.subType)) {
    return sp._canvases[0];
  }

  if (sp.type === 'INTERACTING') {
    const idx = (runtime.interactFrames.get(key) || 0) % sp._canvases.length;
    return sp._canvases[idx];
  }

  const fps = sp.fps || 6;
  const len = sp._canvases.length;
  const t = state.mode === 'PLAY' ? state.simTime : state.uiTime;

  if (sp.animMode === 'TOUCH' || sp.animMode === 'INTERACT') {
    const trigKey = `${layer}:${key}`;
    const trig = worldFX.tileTriggers.get(trigKey);
    if (!trig) return sp._canvases[0];
    const frameIdx = Math.floor((state.simTime - trig.startTime) * fps);
    if (frameIdx >= len) {
      worldFX.tileTriggers.delete(trigKey);
      return sp._canvases[0];
    }
    return sp._canvases[clamp(frameIdx, 0, len - 1)];
  }

  if (sp.animMode === 'PING-PONG') {
    const span = len * 2 - 2;
    const step = Math.floor(t * fps) % span;
    return sp._canvases[step < len ? step : span - step];
  }

  return sp._canvases[Math.floor(t * fps) % len];
}

/* Shared-edge device-pixel snapping eliminates sub-pixel hairline gaps & double-alpha seams between adjacent tiles */
const LIQUID_PAD_TOP = 4;
const liquidScratchCanvas = document.createElement('canvas');
liquidScratchCanvas.width = TILE;
liquidScratchCanvas.height = TILE + LIQUID_PAD_TOP;
const liquidScratchCtx = liquidScratchCanvas.getContext('2d');
liquidScratchCtx.imageSmoothingEnabled = false;

function drawSnappedWorldImage(ctx, img, wx, wy, ww, wh, originX, originY, scale) {
  const px0 = Math.round(originX + wx * scale);
  const py0 = Math.round(originY + wy * scale);
  const px1 = Math.round(originX + (wx + ww) * scale);
  const py1 = Math.round(originY + (wy + wh) * scale);
  const pw = px1 - px0;
  const ph = py1 - py0;
  if (pw > 0 && ph > 0) {
    ctx.drawImage(img, px0, py0, pw, ph);
  }
}

/* Gently bobbing pixel water surface for exposed top-row LIQUID tiles */
export function drawLiquidSurfaceTile(ctx, canvas, tx, ty, sp, originX, originY, scale) {
  const baseX = tx * TILE;
  const baseY = ty * TILE;
  const srcW = canvas.width;
  const srcH = canvas.height;
  const t = state.mode === 'PLAY' ? state.simTime : state.uiTime;
  const cols = sp._liquidColors || {
    line: 'rgba(182, 226, 250, 0.86)',
    sheen: 'rgba(140, 204, 240, 0.30)',
    glint: 'rgba(232, 248, 255, 0.92)'
  };

  // Couple active splashes & swim wake ripples on the waterline
  let rippleEnergy = 0;
  for (let i = 0; i < worldFX.waterRipples.length; i++) {
    const r = worldFX.waterRipples[i];
    if (Math.abs(r.y - baseY) > TILE * 1.4) continue;
    const dx = Math.abs(r.x - (baseX + TILE * 0.5));
    if (dx < TILE * 3.2) {
      const p = clamp(r.timer / r.maxTimer, 0, 1);
      rippleEnergy += (1 - p) * (1 - dx / (TILE * 3.2)) * 1.6;
    }
  }

  // Composite all 19 bobbing pixel columns at 1:1 integer pixels first so no hairline gaps appear between columns
  liquidScratchCtx.clearRect(0, 0, TILE, TILE + LIQUID_PAD_TOP);
  liquidScratchCtx.imageSmoothingEnabled = false;

  const stepW = TILE / srcW;
  for (let cx = 0; cx < TILE; cx++) {
    const worldPx = baseX + cx;
    const wave1 = Math.sin(worldPx * 0.28 + t * 2.55);
    const wave2 = Math.sin(worldPx * 0.52 - t * 1.85 + 1.3);
    const splashWave = rippleEnergy > 0.02 ? Math.sin(worldPx * 0.72 - t * 12) * Math.min(1.6, rippleEnergy) : 0;
    const bob = Math.round((wave1 * 0.65 + wave2 * 0.45 + splashWave) * 1.15);
    const localTopY = clamp(LIQUID_PAD_TOP + 1 + bob, 0, LIQUID_PAD_TOP + TILE - 1);
    const drawH = (LIQUID_PAD_TOP + TILE) - localTopY;
    const sx = clamp(Math.floor(cx / stepW), 0, srcW - 1);

    liquidScratchCtx.drawImage(canvas, sx, 0, 1, srcH, cx, localTopY, 1, drawH);

    // Luminous 1px top waterline & subtle 1px subsurface sheen
    liquidScratchCtx.fillStyle = cols.line;
    liquidScratchCtx.fillRect(cx, localTopY, 1, 1);
    if (drawH > 2) {
      liquidScratchCtx.fillStyle = cols.sheen;
      liquidScratchCtx.fillRect(cx, localTopY + 1, 1, 1);
    }
    // Subtle drifting specular glint on wave crests
    if (wave1 > 0.82 && ((Math.floor(worldPx + t * 6)) % 7 === 0)) {
      liquidScratchCtx.fillStyle = cols.glint;
      liquidScratchCtx.fillRect(cx, localTopY, 1, 1);
    }
  }

  drawSnappedWorldImage(
    ctx,
    liquidScratchCanvas,
    baseX,
    baseY - LIQUID_PAD_TOP,
    TILE,
    TILE + LIQUID_PAD_TOP,
    originX,
    originY,
    scale
  );
}

export function drawLayerTiles(world, layer, minTx, maxTx, minTy, maxTy, originX, originY, scale) {
  const map = world.layers[layer];
  if (!map) return;

  wCtx.save();
  wCtx.setTransform(1, 0, 0, 1, 0, 0);
  wCtx.imageSmoothingEnabled = false;

  for (const key in map) {
    const id = map[key];
    if (!id) continue;
    const comma = key.indexOf(',');
    if (comma === -1) continue;
    const tx = parseInt(key.slice(0, comma), 10);
    const ty = parseInt(key.slice(comma + 1), 10);
    if (tx < minTx || tx > maxTx || ty < minTy || ty > maxTy) continue;

    if (id === STARTER_TILE_ID) {
      let sdx = tx * TILE;
      let sdy = ty * TILE;
      let sdw = TILE;
      let sdh = TILE;
      let sAlpha = 1;
      const sPopKey = `${layer}:${key}`;
      const sPop = worldFX.buildPops.get(sPopKey);
      if (sPop !== undefined) {
        const startT = typeof sPop === 'number' ? sPop : sPop.startUiTime;
        const dur = (typeof sPop === 'object' && sPop.duration) ? sPop.duration : 0.14;
        const p = (state.uiTime - startT) / dur;
        if (p < 0) continue;
        if (p >= 1) {
          worldFX.buildPops.delete(sPopKey);
        } else {
          const isHist = typeof sPop === 'object' && (sPop.kind === 'undo' || sPop.kind === 'redo');
          let sc;
          if (isHist) {
            const c1 = 1.70158;
            const c3 = c1 + 1;
            const easeBack = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
            sc = 0.34 + easeBack * 0.66;
            sAlpha = clamp(p * 2.2, 0, 1);
          } else {
            sc = 0.72 + (1 - Math.pow(1 - p, 3)) * 0.28;
          }
          sdw = TILE * sc;
          sdh = TILE * sc;
          sdx += (TILE - sdw) * 0.5;
          sdy += (TILE - sdh) * 0.5;
        }
      }
      if (sAlpha < 0.999) {
        wCtx.globalAlpha = sAlpha;
        drawSnappedWorldImage(wCtx, starterTileCanvas, sdx, sdy, sdw, sdh, originX, originY, scale);
        wCtx.globalAlpha = 1;
      } else {
        drawSnappedWorldImage(wCtx, starterTileCanvas, sdx, sdy, sdw, sdh, originX, originY, scale);
      }
      continue;
    }

    const sp = getSpriteById(id);
    if (!sp) continue;

    // Dynamic runtime entities are drawn by drawRuntimeEntities()
    if (layer === 'main' && (sp.type === 'MOVING' || sp.type === 'LIVING' || sp.type === 'DYNAMIC')) {
      continue;
    }
    if (layer === 'main' && sp.type === 'GATHERABLE' && runtime.collected.has(key)) {
      continue;
    }
    if (layer === 'main' && sp.type === 'MOUNTABLE' && runtime.mount && runtime.mount.tx === tx && runtime.mount.ty === ty) {
      continue;
    }

    const canvas = resolveTileFrameCanvas(sp, layer, key);
    if (!canvas) continue;

    // Exposed top-row LIQUID tiles get a gently bobbing water surface; stacked liquid underneath stays flush
    if (layer === 'main' && sp.type === 'LIQUID' && getMainTileType(world, tx, ty - 1) !== 'LIQUID' && !worldFX.buildPops.has(`${layer}:${key}`)) {
      drawLiquidSurfaceTile(wCtx, canvas, tx, ty, sp, originX, originY, scale);
      continue;
    }

    let dx = tx * TILE;
    let dy = ty * TILE;
    let dw = TILE;
    let dh = TILE;
    let alpha = 1;

    if (sp.type === 'BIG_THING') {
      const mult = sp.subType === '3X3 HUGE' ? 3 : 2;
      dw = TILE * mult;
      dh = TILE * mult;
      dx = tx * TILE - (dw - TILE) * 0.5;
      dy = ty * TILE - (dh - TILE);
    } else if (sp.type === 'BACK' && sp.subType === 'FAR BACK') {
      alpha = 0.55;
    } else if (layer === 'bg' && isBgEffectType(sp.type)) {
      const fadeIn = getBgEffectFadeIn(key);
      const lightVis = state.mode === 'BUILD' ? 0.78 : 0.58;
      alpha = (sp.type === 'LIGHT' && sp.subType !== 'LIGHT GLOW') ? (lightVis * fadeIn) : fadeIn;
    } else if (sp.type === 'CRUMBLING') {
      const c = runtime.crumbling.get(key);
      if (c && c.state === 'gone') continue;
      if (c && c.state === 'shake') {
        const urgency = clamp(1 - c.timer / 0.55, 0.2, 1);
        dx += Math.sin(state.simTime * (54 + urgency * 28) + tx * 2.1) * (0.6 + urgency * 0.9);
        dy += Math.cos(state.simTime * 42 + ty * 1.7) * (0.3 * urgency);
      }
    } else if (sp.type === 'ACTIVATOR' && sp.subType === 'DOOR') {
      const openP = runtime.doorAnim.get(key) || (runtime.doorsOpen.has(key) ? 1 : 0);
      if (openP > 0.002) {
        alpha = 1 - openP * 0.76;
        const lift = openP * 3.5;
        dy -= lift;
      }
    } else if (sp.type === 'HOLDER') {
      dy += Math.sin(state.uiTime * 2.6 + tx * 0.7) * 1.2;
    } else if (sp.type === 'GATHERABLE') {
      const bobT = state.mode === 'PLAY' ? state.simTime : state.uiTime;
      dy += Math.sin(bobT * 3.4 + tx * 0.9 + ty * 0.6) * 1.3;
    }

    // Bouncy spring squash animation
    const bounceRem = worldFX.bounceTimers.get(key);
    if (bounceRem > 0) {
      const sq = Math.sin((bounceRem / 0.24) * Math.PI);
      const hShrink = sq * 4.5;
      const wGrow = sq * 2.5;
      dx -= wGrow * 0.5;
      dw += wGrow;
      dy += hShrink;
      dh -= hShrink;
    }

    // Build placement & smooth Undo/Redo pop-in animation
    const popKey = `${layer}:${key}`;
    const popEntry = worldFX.buildPops.get(popKey);
    let popGlow = null;
    if (popEntry !== undefined) {
      const startT = typeof popEntry === 'number' ? popEntry : popEntry.startUiTime;
      const dur = (typeof popEntry === 'object' && popEntry.duration) ? popEntry.duration : 0.14;
      const p = (state.uiTime - startT) / dur;
      if (p < 0) continue; // Staggered wave delay before tile materializes
      if (p >= 1) {
        worldFX.buildPops.delete(popKey);
      } else {
        const isHist = typeof popEntry === 'object' && (popEntry.kind === 'undo' || popEntry.kind === 'redo');
        let sc;
        if (isHist) {
          // Smooth elastic ease-out-back settle + soft fade-in for viewport Undo/Redo
          const c1 = 1.65;
          const c3 = c1 + 1;
          const easeBack = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
          sc = 0.34 + easeBack * 0.66;
          alpha *= clamp(p * 2.2, 0, 1);
          popGlow = { color: popEntry.color || '#f28c38', alpha: (1 - p) * (1 - p) * 0.72 };
        } else {
          sc = 0.72 + (1 - Math.pow(1 - p, 3)) * 0.28;
        }
        const nw = dw * sc;
        const nh = dh * sc;
        dx += (dw - nw) * 0.5;
        dy += (dh - nh) * 0.5;
        dw = nw;
        dh = nh;
      }
    }

    if (alpha < 0.999) {
      wCtx.globalAlpha = alpha;
      drawSnappedWorldImage(wCtx, canvas, dx, dy, dw, dh, originX, originY, scale);
      wCtx.globalAlpha = 1;
    } else {
      drawSnappedWorldImage(wCtx, canvas, dx, dy, dw, dh, originX, originY, scale);
    }

    if (popGlow && popGlow.alpha > 0.02) {
      const px0 = Math.round(originX + dx * scale);
      const py0 = Math.round(originY + dy * scale);
      const px1 = Math.round(originX + (dx + dw) * scale);
      const py1 = Math.round(originY + (dy + dh) * scale);
      wCtx.globalAlpha = popGlow.alpha;
      wCtx.strokeStyle = popGlow.color;
      wCtx.lineWidth = Math.max(1, viewport.dpr);
      wCtx.strokeRect(px0 + 0.5, py0 + 0.5, Math.max(1, px1 - px0 - 1), Math.max(1, py1 - py0 - 1));
      wCtx.globalAlpha = 1;
    }
  }

  // Smooth fade-out sprites for recently erased background lights/effects
  if (layer === 'bg' && worldFX.bgFadeOuts.length > 0) {
    for (let i = 0; i < worldFX.bgFadeOuts.length; i++) {
      const e = worldFX.bgFadeOuts[i];
      if (e.tx < minTx || e.tx > maxTx || e.ty < minTy || e.ty > maxTy) continue;
      const fade = getBgEffectFadeOut(e);
      if (fade <= 0.002 || !e.sp || !e.sp._canvases || !e.sp._canvases[0]) continue;
      wCtx.globalAlpha = (e.sp.type === 'LIGHT' && e.sp.subType !== 'LIGHT GLOW') ? (0.5 * fade) : fade;
      drawSnappedWorldImage(wCtx, e.sp._canvases[0], e.tx * TILE, e.ty * TILE, TILE, TILE, originX, originY, scale);
    }
    wCtx.globalAlpha = 1;
  }

  wCtx.restore();
}

export function drawRuntimeEntities(world, alpha = 1) {
  // 1. MOVING platforms (smoothly interpolated between fixed physics steps)
  for (const m of runtime.moving.values()) {
    const sp = getSpriteById(m.id);
    if (!sp) continue;
    const c = resolveTileFrameCanvas(sp, 'main', m.key);
    if (!c) continue;
    const mx = (m.prevX !== undefined ? m.prevX : m.x) + (m.x - (m.prevX !== undefined ? m.prevX : m.x)) * alpha;
    const my = (m.prevY !== undefined ? m.prevY : m.y) + (m.y - (m.prevY !== undefined ? m.prevY : m.y)) * alpha;
    wCtx.drawImage(c, mx, my, TILE, TILE);
  }

  // 2. LIVING critters / NPCs (smoothly interpolated + gentle walk hop)
  for (const lv of runtime.living.values()) {
    const sp = getSpriteById(lv.id);
    if (!sp) continue;
    const c = resolveTileFrameCanvas(sp, 'main', lv.key);
    if (!c) continue;
    const lx = (lv.prevX !== undefined ? lv.prevX : lv.x) + (lv.x - (lv.prevX !== undefined ? lv.prevX : lv.x)) * alpha;
    const ly = (lv.prevY !== undefined ? lv.prevY : lv.y) + (lv.y - (lv.prevY !== undefined ? lv.prevY : lv.y)) * alpha;
    const isMoving = lv.subType === 'WANDER' && Math.abs(lv.vx) > 2 && Math.abs(lv.vy) < 4;
    const hopY = isMoving ? -Math.abs(Math.sin(state.simTime * 10 + (lv.hopPhase || 0))) * 1.15 : 0;
    wCtx.save();
    wCtx.translate(lx + TILE * 0.5, ly + TILE * 0.5 + hopY);
    if (lv.facing < 0) wCtx.scale(-1, 1);
    wCtx.drawImage(c, -TILE * 0.5, -TILE * 0.5, TILE, TILE);
    wCtx.restore();
  }

  // 3. DYNAMIC crates & bouncy balls (smoothly interpolated + rolling rotation & bounce squash)
  for (const dyn of runtime.dynamics.values()) {
    const sp = getSpriteById(dyn.id);
    if (!sp) continue;
    const c = resolveTileFrameCanvas(sp, 'main', dyn.key);
    if (!c) continue;
    const dx = (dyn.prevX !== undefined ? dyn.prevX : dyn.x) + (dyn.x - (dyn.prevX !== undefined ? dyn.prevX : dyn.x)) * alpha;
    const dy = (dyn.prevY !== undefined ? dyn.prevY : dyn.y) + (dyn.y - (dyn.prevY !== undefined ? dyn.prevY : dyn.y)) * alpha;
    const sx = dyn.scaleX || 1;
    const sy = dyn.scaleY || 1;
    const rot = (dyn.prevRot !== undefined ? dyn.prevRot : (dyn.rot || 0))
      + ((dyn.rot || 0) - (dyn.prevRot !== undefined ? dyn.prevRot : (dyn.rot || 0))) * alpha;
    if (Math.abs(rot) > 0.004 || Math.abs(sx - 1) > 0.004 || Math.abs(sy - 1) > 0.004) {
      wCtx.save();
      wCtx.translate(dx + TILE * 0.5, dy + TILE);
      wCtx.scale(sx, sy);
      wCtx.translate(0, -TILE * 0.5);
      if (Math.abs(rot) > 0.004) wCtx.rotate(rot);
      wCtx.drawImage(c, -TILE * 0.5, -TILE * 0.5, TILE, TILE);
      wCtx.restore();
    } else {
      wCtx.drawImage(c, dx, dy, TILE, TILE);
    }
  }

  // 4. HOLDABLE emitter projectiles
  if (runtime.projectiles.length > 0) {
    wCtx.save();
    for (let i = 0; i < runtime.projectiles.length; i++) {
      const pr = runtime.projectiles[i];
      wCtx.fillStyle = pr.color || '#f28c38';
      wCtx.fillRect(pr.x - 1.5, pr.y - 1.5, 3, 3);
      wCtx.fillStyle = '#ffffff';
      wCtx.fillRect(pr.x - 0.5, pr.y - 0.5, 1, 1);
    }
    wCtx.restore();
  }
}

/* Reusable scratch canvas for pixel-accurate sprite damage/drown tinting (zero floating square artifacts) */
const playerTintCanvas = document.createElement('canvas');
const playerTintCtx = playerTintCanvas.getContext('2d');
playerTintCtx.imageSmoothingEnabled = false;

function drawSpriteWithOptionalTint(ctx, srcCanvas, dx, dy, dw, dh, tintColor) {
  if (!tintColor) {
    ctx.drawImage(srcCanvas, dx, dy, dw, dh);
    return;
  }
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  if (playerTintCanvas.width !== sw || playerTintCanvas.height !== sh) {
    playerTintCanvas.width = sw;
    playerTintCanvas.height = sh;
  }
  playerTintCtx.save();
  playerTintCtx.setTransform(1, 0, 0, 1, 0, 0);
  playerTintCtx.imageSmoothingEnabled = false;
  playerTintCtx.clearRect(0, 0, sw, sh);
  playerTintCtx.globalCompositeOperation = 'source-over';
  playerTintCtx.drawImage(srcCanvas, 0, 0);
  playerTintCtx.globalCompositeOperation = 'source-atop';
  playerTintCtx.fillStyle = tintColor;
  playerTintCtx.fillRect(0, 0, sw, sh);
  playerTintCtx.restore();
  ctx.drawImage(playerTintCanvas, dx, dy, dw, dh);
}

export function resolveBodyPose(sp) {
  // Active MOTION sprite overrides Body poses until player moves
  if (state.activeMotionId) {
    const mSp = getSpriteById(state.activeMotionId);
    if (mSp && mSp._canvases && mSp._canvases.length > 0) {
      const idx = Math.floor(state.simTime * (mSp.fps || 6)) % mSp._canvases.length;
      return { canvas: mSp._canvases[idx], blinkOverlay: null, flipClimb: false, size: mSp.size };
    }
  }

  if (!sp || !sp._stateCanvases) return null;
  const sc = sp._stateCanvases;
  const standList = (sc.STAND && sc.STAND.length) ? sc.STAND : sp._canvases;

  let pose = 'STAND';
  if (player.dead || runtime.hurtFlash > 0) {
    pose = 'SIT';
  } else if (player.climbing) {
    pose = 'CLIMB';
  } else if (player.inLiquid) {
    // Only play WALK cycle in liquid while actively swimming; rest in STAND when floating idle
    pose = player.swimming ? 'WALK' : 'STAND';
  } else if (player.sitting) {
    pose = 'SIT';
  } else if (!player.grounded) {
    pose = player.vy < 0 ? 'JUMP' : 'FALL';
  } else if (Math.abs(player.vx) > 8) {
    pose = 'WALK';
  }

  const list = (sc[pose] && sc[pose].length) ? sc[pose] : standList;
  const fps = getSpriteStateFps(sp, pose);
  let canvas = list[0];
  let flipClimb = false;

  if (pose === 'WALK') {
    if (list.length > 1) {
      canvas = list[Math.floor(state.simTime * fps) % list.length];
    } else {
      canvas = (Math.floor(state.simTime * fps) % 2 === 0) ? list[0] : standList[0];
    }
  } else if (pose === 'CLIMB') {
    if (list.length > 1) {
      canvas = list[Math.floor(player.climbAnimAcc) % list.length];
    } else {
      canvas = list[0];
      flipClimb = (Math.floor(player.climbAnimAcc) % 2 === 1);
    }
  } else if (list.length > 1) {
    canvas = list[Math.floor(state.simTime * fps) % list.length];
  }

  // BLINK overlay is authored for STAND eye height — never stamp it onto SIT/FALL/WALK
  const shouldBlink = !player.dead && (pose === 'STAND') && (player.blinkDur > 0 || state.windowUnfocused);
  const blinkList = sc.BLINK;
  const blinkOverlay = (shouldBlink && blinkList && blinkList.length > 0)
    ? blinkList[Math.floor(state.uiTime * getSpriteStateFps(sp, 'BLINK')) % blinkList.length]
    : null;

  return { canvas, blinkOverlay, flipClimb, size: sp.size };
}

export function drawDefaultWireframe(ctx, w, h, facing, blinking, tintColor = null) {
  ctx.fillStyle = tintColor || 'rgba(230, 234, 242, 0.04)';
  ctx.fillRect(2, 2, w - 4, h - 4);

  ctx.strokeStyle = tintColor ? 'rgba(255, 255, 255, 0.62)' : 'rgba(230, 234, 242, 0.34)';
  ctx.lineWidth = 1;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);

  // Minimal translucent eyes for facing/blink readability
  const eyeY = Math.round(h * 0.36);
  const ex1 = facing >= 0 ? Math.round(w * 0.52) : Math.round(w * 0.28);
  const ex2 = ex1 + 3;
  ctx.fillStyle = tintColor ? 'rgba(255, 255, 255, 0.72)' : 'rgba(230, 234, 242, 0.32)';
  if (blinking) {
    ctx.fillRect(ex1, eyeY + 1, 2, 1);
    ctx.fillRect(ex2, eyeY + 1, 2, 1);
  } else {
    ctx.fillRect(ex1, eyeY, 1.5, 2);
    ctx.fillRect(ex2, eyeY, 1.5, 2);
  }
}

export function captureCurrentCharVisual() {
  const bodySp = state.equippedBodyId ? getSpriteById(state.equippedBodyId) : null;
  if (bodySp) {
    const resolved = resolveBodyPose(bodySp);
    if (resolved && resolved.canvas) {
      return { isWireframe: false, canvas: resolved.canvas, size: resolved.size };
    }
  }
  return { isWireframe: true, canvas: null, size: TILE };
}

export function triggerBodyAnim(kind, prevVis) {
  const sparks = [];
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.35;
    sparks.push({
      vx: Math.cos(ang) * (20 + Math.random() * 24),
      vy: Math.sin(ang) * (20 + Math.random() * 24) - 8
    });
  }
  worldFX.bodyAnim = {
    kind,
    startUiTime: state.uiTime,
    duration: 0.28,
    prev: prevVis || null,
    sparks
  };
  SFX.playBodyEquip(kind !== 'unequip');
}

export function drawPlayer(alpha) {
  const px = player.prevX + (player.x - player.prevX) * alpha;
  const py = player.prevY + (player.y - player.prevY) * alpha;
  const footCx = px + player.w * 0.5;
  const footY = py + player.h;

  const bodySp = state.equippedBodyId ? getSpriteById(state.equippedBodyId) : null;
  const wearSp = state.equippedWearableId ? getSpriteById(state.equippedWearableId) : null;
  const holdSp = state.equippedHoldableId ? getSpriteById(state.equippedHoldableId) : null;
  const resolved = bodySp || state.activeMotionId ? resolveBodyPose(bodySp) : null;
  const drawDim = resolved ? resolved.size : TILE;

  // Dedicated Death Animation rendering during the 3-second revival countdown (intact SIT cel, clean pixel-masked flash)
  if (player.dead) {
    const centerX = px + player.w * 0.5;
    const centerY = py + player.h * 0.5;
    const revivePulse = player.deathTimer < 0.45 ? (0.55 + 0.45 * Math.sin(state.uiTime * 22)) : 1;
    const baseAlpha = clamp(0.55 + (player.deathTimer / Math.max(0.1, player.deathMaxTimer)) * 0.45, 0.45, 1);
    const flashTint = player.damageFlashTimer > 0
      ? (player.damageFlashKind === 'drown' ? 'rgba(116, 204, 245, 0.42)' : 'rgba(225, 78, 78, 0.48)')
      : null;

    wCtx.save();
    wCtx.translate(centerX, centerY);
    wCtx.rotate(player.deathAngle);
    wCtx.scale(player.scaleX, player.scaleY);
    wCtx.globalAlpha = clamp(baseAlpha * revivePulse, 0.08, 1);

    if (resolved && resolved.canvas) {
      const flipH = player.facing < 0 ? -1 : 1;
      if (flipH < 0) wCtx.scale(-1, 1);
      // Feet-aligned local offset prevents 29x29 BODY sprites from popping down or burying into the floor on death
      const localY = -(drawDim - player.h * 0.5);
      drawSpriteWithOptionalTint(wCtx, resolved.canvas, -drawDim * 0.5, localY, drawDim, drawDim, flashTint);
    } else {
      wCtx.save();
      wCtx.translate(-TILE * 0.5, -TILE * 0.5);
      drawDefaultWireframe(wCtx, TILE, TILE, player.facing, true, flashTint);
      wCtx.restore();
    }

    wCtx.restore();
    return;
  }

  wCtx.save();
  wCtx.translate(footCx, footY);

  // Gentle swimming bob & stroke tilt (combined smoothly with hurt knockback tilt)
  if (player.inLiquid && player.swimming && runtime.hurtFlash <= 0) {
    wCtx.translate(0, Math.sin(player.swimCycle * 2) * 0.9);
  }
  const bodyTilt = player.swimTilt + player.hurtAngle;
  if (Math.abs(bodyTilt) > 0.004) {
    wCtx.translate(0, -player.h * 0.5);
    wCtx.rotate(bodyTilt);
    wCtx.translate(0, player.h * 0.5);
  }

  // Pixel-masked impact tint during damage flash, followed by a gentle invulnerability shimmer
  const aliveFlashTint = player.damageFlashTimer > 0
    ? (player.damageFlashKind === 'drown' ? 'rgba(116, 204, 245, 0.42)' : 'rgba(225, 78, 78, 0.48)')
    : null;
  if (runtime.hurtFlash > 0 && player.damageFlashTimer <= 0) {
    wCtx.globalAlpha = 0.78 + 0.16 * Math.sin(state.uiTime * 28);
  }

  // Draw ridden MOUNTABLE underneath player
  if (runtime.mount) {
    const mSp = getSpriteById(runtime.mount.id);
    if (mSp && mSp._canvases && mSp._canvases[0]) {
      const mIdx = Math.floor(state.simTime * (mSp.fps || 6)) % mSp._canvases.length;
      wCtx.save();
      if (player.facing < 0) wCtx.scale(-1, 1);
      wCtx.drawImage(mSp._canvases[mIdx], -TILE * 0.5, -TILE, TILE, TILE);
      wCtx.restore();
      wCtx.translate(0, -5);
    }
  }

  // Equip / Swap / Unequip quick elastic transition
  let animScaleX = player.scaleX;
  let animScaleY = player.scaleY;
  let animProg = 1;
  if (worldFX.bodyAnim) {
    animProg = clamp((state.uiTime - worldFX.bodyAnim.startUiTime) / worldFX.bodyAnim.duration, 0, 1);
    if (animProg >= 1) {
      worldFX.bodyAnim = null;
    } else {
      const pop = Math.sin(animProg * Math.PI);
      animScaleX *= 1 - pop * 0.16;
      animScaleY *= 1 + pop * 0.16;
    }
  }

  wCtx.scale(animScaleX, animScaleY);

  // BACK wearable renders behind character body
  if (wearSp && wearSp.subType === 'BACK' && wearSp._canvases && wearSp._canvases[0]) {
    const wIdx = Math.floor(state.uiTime * (wearSp.fps || 6)) % wearSp._canvases.length;
    wCtx.save();
    if (player.facing < 0) wCtx.scale(-1, 1);
    wCtx.drawImage(wearSp._canvases[wIdx], -wearSp.size * 0.5, -wearSp.size, wearSp.size, wearSp.size);
    wCtx.restore();
  }

  // Main Character Sprite or Bare Translucent Wireframe Fallback
  if (resolved && resolved.canvas) {
    wCtx.save();
    const flipH = resolved.flipClimb ? (player.facing > 0 ? -1 : 1) : (player.facing < 0 ? -1 : 1);
    if (flipH < 0) wCtx.scale(-1, 1);
    drawSpriteWithOptionalTint(wCtx, resolved.canvas, -drawDim * 0.5, -drawDim, drawDim, drawDim, aliveFlashTint);
    if (resolved.blinkOverlay) {
      drawSpriteWithOptionalTint(wCtx, resolved.blinkOverlay, -drawDim * 0.5, -drawDim, drawDim, drawDim, aliveFlashTint);
    }
    wCtx.restore();
  } else {
    wCtx.save();
    wCtx.translate(-TILE * 0.5, -TILE);
    drawDefaultWireframe(
      wCtx,
      TILE,
      TILE,
      player.facing,
      player.blinkDur > 0 || state.windowUnfocused || runtime.hurtFlash > 0,
      aliveFlashTint
    );
    wCtx.restore();
  }

  // HAT & BODY OVER wearables render over body
  if (wearSp && wearSp.subType !== 'BACK' && wearSp._canvases && wearSp._canvases[0]) {
    const wIdx = Math.floor(state.uiTime * (wearSp.fps || 6)) % wearSp._canvases.length;
    const wyOff = wearSp.subType === 'HAT' ? -(drawDim + wearSp.size * 0.25) : -wearSp.size;
    wCtx.save();
    if (player.facing < 0) wCtx.scale(-1, 1);
    wCtx.drawImage(wearSp._canvases[wIdx], -wearSp.size * 0.5, wyOff, wearSp.size, wearSp.size);
    wCtx.restore();
  }

  // Equipped HOLDABLE tool in front hand
  if (holdSp && holdSp._canvases && holdSp._canvases[0]) {
    const hIdx = Math.floor(state.uiTime * (holdSp.fps || 6)) % holdSp._canvases.length;
    const swing = runtime.holdSwingTimer > 0 ? Math.sin((runtime.holdSwingTimer / 0.22) * Math.PI) * 0.85 : 0;
    wCtx.save();
    if (player.facing < 0) wCtx.scale(-1, 1);
    wCtx.translate(drawDim * 0.34, -drawDim * 0.42);
    if (swing !== 0) wCtx.rotate(swing);
    wCtx.drawImage(holdSp._canvases[hIdx], -holdSp.size * 0.35, -holdSp.size * 0.65, holdSp.size, holdSp.size);
    wCtx.restore();
  }

  // Brief golden materialization shimmer on spawn / revival
  if (player.respawnTimer > 0) {
    const rp = clamp(1 - player.respawnTimer / 0.42, 0, 1);
    const ringH = 7 + (1 - Math.pow(1 - rp, 3)) * 12;
    wCtx.save();
    wCtx.globalAlpha = (1 - rp) * 0.72;
    wCtx.strokeStyle = '#ffd59a';
    wCtx.lineWidth = Math.max(0.8, 1.2 / camera.zoom);
    wCtx.strokeRect(-ringH * 0.5, -player.h * 0.5 - ringH * 0.5, ringH, ringH);
    wCtx.fillStyle = 'rgba(255, 224, 170, 0.28)';
    wCtx.fillRect(-drawDim * 0.45, -drawDim * (1 - rp), drawDim * 0.9, 1.4);
    wCtx.restore();
  }

  // Brief body equip/swap scanline & spark burst
  if (worldFX.bodyAnim) {
    const p = animProg;
    const scanY = -drawDim * (1 - p);
    wCtx.fillStyle = `rgba(242, 140, 56, ${(1 - p) * 0.75})`;
    wCtx.fillRect(-drawDim * 0.55, scanY, drawDim * 1.1, 1.5);
    for (let i = 0; i < worldFX.bodyAnim.sparks.length; i++) {
      const spk = worldFX.bodyAnim.sparks[i];
      wCtx.fillRect(spk.vx * p - 0.75, -drawDim * 0.5 + spk.vy * p - 0.75, 1.5, 1.5);
    }
  }

  wCtx.restore();
}

export function drawWorldFX() {
  const invZ = 1 / camera.zoom;

  // 1. Build dissolve & smooth Undo/Redo vanish tiles (renders actual shrinking sprite + soft ring)
  if (worldFX.buildDissolves.length > 0) {
    wCtx.save();
    wCtx.imageSmoothingEnabled = false;
    wCtx.lineWidth = 1.2 * invZ;
    for (let i = worldFX.buildDissolves.length - 1; i >= 0; i--) {
      const d = worldFX.buildDissolves[i];
      const dur = d.duration || 0.18;
      const p = (state.uiTime - d.startUiTime) / dur;
      if (p >= 1) {
        worldFX.buildDissolves.splice(i, 1);
        continue;
      }
      if (p < 0) {
        // Hold outgoing sprite smoothly until its staggered wave slice starts shrinking
        if (d.canvas) {
          wCtx.globalAlpha = 0.92;
          wCtx.drawImage(d.canvas, d.tx * TILE, d.ty * TILE, TILE, TILE);
        }
        continue;
      }
      const ease = 1 - Math.pow(1 - p, 3);
      const fade = (1 - p) * (1 - p);
      if (d.canvas) {
        const sc = Math.max(0.18, 1 - ease * 0.74);
        const sz = TILE * sc;
        const ox = d.tx * TILE + (TILE - sz) * 0.5;
        const oy = d.ty * TILE + (TILE - sz) * 0.5;
        wCtx.globalAlpha = fade * 0.92;
        wCtx.drawImage(d.canvas, ox, oy, sz, sz);
        wCtx.globalAlpha = fade * 0.65;
        wCtx.strokeStyle = d.color || '#cf5959';
        wCtx.strokeRect(ox, oy, sz, sz);
      } else {
        const shrink = ease * 5;
        wCtx.globalAlpha = fade * 0.8;
        wCtx.strokeStyle = d.color || '#cf5959';
        wCtx.strokeRect(d.tx * TILE + shrink, d.ty * TILE + shrink, Math.max(1, TILE - shrink * 2), Math.max(1, TILE - shrink * 2));
      }
    }
    wCtx.restore();
  }

  // 2. Water surface splash ripples & crowns (single batched save/restore)
  if (worldFX.waterRipples.length > 0) {
    wCtx.save();
    for (let i = 0; i < worldFX.waterRipples.length; i++) {
      const r = worldFX.waterRipples[i];
      const p = clamp(r.timer / r.maxTimer, 0, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const rx = Math.max(2, r.maxRx * ease);
      const alpha = (1 - p) * (1 - p);

      // Main crisp expanding waterline wave
      wCtx.globalAlpha = alpha * 0.9;
      wCtx.fillStyle = '#e4f7ff';
      wCtx.fillRect(r.x - rx, r.y - 0.5, rx * 2, 1.2);
      // Outer wave crests
      wCtx.fillStyle = r.color || '#7ec3e8';
      wCtx.fillRect(r.x - rx - 1.5, r.y - 1.2, 2, 1.2);
      wCtx.fillRect(r.x + rx - 0.5, r.y - 1.2, 2, 1.2);

      // Brief splash crown plume on impact
      if (p < 0.45 && r.crownH > 2) {
        const cp = p / 0.45;
        const ch = r.crownH * Math.sin(cp * Math.PI);
        const cw = 3 + ease * 5;
        wCtx.globalAlpha = (1 - cp) * 0.78;
        wCtx.fillStyle = '#d6f2ff';
        wCtx.fillRect(r.x - cw - 1, r.y - ch, 1.5, ch);
        wCtx.fillRect(r.x + cw - 0.5, r.y - ch, 1.5, ch);
        wCtx.fillRect(r.x - cw * 0.45, r.y - ch * 0.7, 1.5, ch * 0.7);
        wCtx.fillRect(r.x + cw * 0.45 - 1, r.y - ch * 0.7, 1.5, ch * 0.7);
      }
    }
    wCtx.restore();
  }

  // 3. Spacebar interact radial pulse rings (crisp double-ring ease-out)
  if (worldFX.interactRings.length > 0) {
    wCtx.save();
    wCtx.lineWidth = 1.2 * invZ;
    for (let i = 0; i < worldFX.interactRings.length; i++) {
      const r = worldFX.interactRings[i];
      const p = clamp(r.timer / r.maxTimer, 0, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const fade = (1 - p) * (1 - p);
      const half = 6 + ease * 18;
      wCtx.strokeStyle = '#f28c38';
      wCtx.globalAlpha = fade * 0.88;
      wCtx.strokeRect(r.x - half, r.y - half, half * 2, half * 2);
      if (p < 0.75) {
        const inner = Math.max(2, half - 3.5);
        wCtx.strokeStyle = '#ffdcb0';
        wCtx.globalAlpha = fade * 0.48;
        wCtx.strokeRect(r.x - inner, r.y - inner, inner * 2, inner * 2);
      }
    }
    wCtx.restore();
  }

  // 4. World pixel particles (dust, splashes, bubbles, bounce sparks — single batched save/restore)
  if (worldFX.particles.length > 0) {
    wCtx.save();
    for (let i = 0; i < worldFX.particles.length; i++) {
      const pt = worldFX.particles[i];
      wCtx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
      if (pt.bubble) {
        wCtx.fillStyle = 'rgba(126, 195, 232, 0.45)';
        wCtx.fillRect(pt.x - pt.size * 0.5, pt.y - pt.size * 0.5, pt.size, pt.size);
        wCtx.fillStyle = '#eef9ff';
        wCtx.fillRect(pt.x - pt.size * 0.5, pt.y - pt.size * 0.5, Math.max(0.8, pt.size * 0.5), Math.max(0.8, pt.size * 0.5));
      } else {
        wCtx.fillStyle = pt.color;
        if (pt.streak) {
          wCtx.fillRect(pt.x, pt.y, 1, 2);
          wCtx.fillRect(pt.x - 0.6, pt.y + 2, 1, 2);
        } else {
          wCtx.fillRect(pt.x - pt.size * 0.5, pt.y - pt.size * 0.5, pt.size, pt.size);
        }
      }
    }
    wCtx.restore();
  }
}

export function drawLocalizedBuildGrid() {
  const alpha = camera.gridAlpha * camera.gridCursorAlpha;
  if (alpha < 0.01) return;

  const radius = 5;
  const centerTx = pointer.tileX;
  const centerTy = pointer.tileY;

  wCtx.save();
  wCtx.lineWidth = 1 / camera.zoom;

  for (let ty = centerTy - radius; ty <= centerTy + radius; ty++) {
    for (let tx = centerTx - radius; tx <= centerTx + radius; tx++) {
      const dist = Math.hypot(tx - centerTx, ty - centerTy);
      if (dist > radius + 0.35) continue;
      const falloff = clamp(1 - dist / (radius + 0.45), 0, 1);
      const cellAlpha = falloff * falloff * 0.24 * alpha;
      if (cellAlpha < 0.01) continue;
      wCtx.strokeStyle = `rgba(230, 234, 242, ${cellAlpha})`;
      wCtx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  wCtx.restore();
}

export function drawBrushDimBadge(text, wx, wy, isErase = false) {
  const pos = worldToScreen(wx, wy);
  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  wCtx.font = '13px "Perfect DOS VGA 437", "VT323", monospace';
  const padX = 7;
  const tw = wCtx.measureText(text).width;
  const bw = tw + padX * 2;
  const bh = 20;
  const bx = clamp(Math.round(pos.sx + 10), 8, viewport.width - bw - 8);
  const by = clamp(Math.round(pos.sy - bh - 10), 46, viewport.height - bh - 8);

  wCtx.fillStyle = 'rgba(13, 14, 17, 0.94)';
  wCtx.fillRect(bx, by, bw, bh);
  wCtx.strokeStyle = isErase ? '#cf5959' : '#f28c38';
  wCtx.lineWidth = 1;
  wCtx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  wCtx.fillStyle = isErase ? '#f2a4a4' : '#f6e4d2';
  wCtx.textBaseline = 'middle';
  wCtx.fillText(text, bx + padX, by + bh * 0.5 + 1);
  wCtx.restore();
}

export function drawSpawnMarker(world) {
  if (camera.gridAlpha < 0.02) return;
  const sx = world.spawn.x * TILE;
  const sy = world.spawn.y * TILE;
  wCtx.save();
  wCtx.globalAlpha = 0.8 * camera.gridAlpha;
  wCtx.strokeStyle = '#f28c38';
  wCtx.lineWidth = 1 / camera.zoom;
  wCtx.strokeRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
  wCtx.beginPath();
  wCtx.moveTo(sx + TILE * 0.5, sy - 2);
  wCtx.lineTo(sx + TILE * 0.5, sy + TILE + 2);
  wCtx.moveTo(sx - 2, sy + TILE * 0.5);
  wCtx.lineTo(sx + TILE + 2, sy + TILE * 0.5);
  wCtx.stroke();
  wCtx.restore();
}

export function drawBrushPreview() {
  if (!pointer.inWorld || isAnyModalOpen()) return;
  if (state.mode !== 'BUILD') return;
  if (pointer.action === 'pan') return;

  const meta = getTileMeta(state.selectedSpriteId);

  // BUILD mode active drag previews (RECT, LINE, ERASE BOX)
  if (pointer.action === 'eraseBox') {
    const minX = Math.min(pointer.dragStartTx, pointer.tileX);
    const maxX = Math.max(pointer.dragStartTx, pointer.tileX);
    const minY = Math.min(pointer.dragStartTy, pointer.tileY);
    const maxY = Math.max(pointer.dragStartTy, pointer.tileY);
    const wTiles = maxX - minX + 1;
    const hTiles = maxY - minY + 1;

    wCtx.save();
    wCtx.fillStyle = 'rgba(207, 89, 89, 0.22)';
    wCtx.fillRect(minX * TILE, minY * TILE, wTiles * TILE, hTiles * TILE);
    wCtx.strokeStyle = '#cf5959';
    wCtx.lineWidth = 1.5 / camera.zoom;
    wCtx.strokeRect(minX * TILE, minY * TILE, wTiles * TILE, hTiles * TILE);
    wCtx.restore();

    drawBrushDimBadge(`ERASE ${wTiles}x${hTiles}`, (maxX + 1) * TILE, minY * TILE, true);
    return;
  }

  if (pointer.action === 'rect' && meta && meta.canvas) {
    const pts = getWorldRectTiles(pointer.dragStartTx, pointer.dragStartTy, pointer.tileX, pointer.tileY, pointer.shiftKey);
    const minX = Math.min(pointer.dragStartTx, pointer.tileX);
    const maxX = Math.max(pointer.dragStartTx, pointer.tileX);
    const minY = Math.min(pointer.dragStartTy, pointer.tileY);
    const maxY = Math.max(pointer.dragStartTy, pointer.tileY);
    const wTiles = maxX - minX + 1;
    const hTiles = maxY - minY + 1;

    wCtx.save();
    wCtx.globalAlpha = 0.55;
    for (const [tx, ty] of pts) {
      wCtx.drawImage(meta.canvas, tx * TILE, ty * TILE, TILE, TILE);
    }
    wCtx.globalAlpha = 0.9;
    wCtx.strokeStyle = '#f28c38';
    wCtx.lineWidth = 1.2 / camera.zoom;
    wCtx.strokeRect(minX * TILE, minY * TILE, wTiles * TILE, hTiles * TILE);
    wCtx.restore();

    drawBrushDimBadge(`${wTiles}x${hTiles}${pointer.shiftKey ? ' BOX' : ''}`, (maxX + 1) * TILE, minY * TILE, false);
    return;
  }

  if (pointer.action === 'line' && meta && meta.canvas) {
    const pts = getWorldLineTiles(pointer.dragStartTx, pointer.dragStartTy, pointer.tileX, pointer.tileY);
    wCtx.save();
    wCtx.globalAlpha = 0.55;
    for (const [tx, ty] of pts) {
      wCtx.drawImage(meta.canvas, tx * TILE, ty * TILE, TILE, TILE);
    }
    wCtx.globalAlpha = 0.85;
    wCtx.strokeStyle = '#f28c38';
    wCtx.lineWidth = 1 / camera.zoom;
    for (const [tx, ty] of pts) {
      wCtx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
    }
    wCtx.restore();

    drawBrushDimBadge(`LINE ${pts.length}`, (pointer.tileX + 1) * TILE, pointer.tileY * TILE, false);
    return;
  }

  // Idle hover preview in BUILD mode
  const tx = pointer.tileX;
  const ty = pointer.tileY;
  wCtx.save();
  if (state.buildTool === 'ERASE') {
    wCtx.fillStyle = 'rgba(207, 89, 89, 0.2)';
    wCtx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    wCtx.strokeStyle = '#cf5959';
    wCtx.lineWidth = 1.2 / camera.zoom;
    wCtx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
  } else if (state.buildTool === 'SPAWN') {
    wCtx.strokeStyle = '#f28c38';
    wCtx.lineWidth = 1.2 / camera.zoom;
    wCtx.strokeRect(tx * TILE + 2, ty * TILE + 2, TILE - 4, TILE - 4);
    wCtx.beginPath();
    wCtx.moveTo(tx * TILE + TILE * 0.5, ty * TILE);
    wCtx.lineTo(tx * TILE + TILE * 0.5, ty * TILE + TILE);
    wCtx.moveTo(tx * TILE, ty * TILE + TILE * 0.5);
    wCtx.lineTo(tx * TILE + TILE, ty * TILE + TILE * 0.5);
    wCtx.stroke();
  } else if (meta && meta.canvas) {
    // Scale-pop cursor preview right after double-click pickup
    let sc = 1;
    if (worldFX.cursorPickup) {
      const p = clamp((state.uiTime - worldFX.cursorPickup.startUiTime) / 0.2, 0, 1);
      sc = 1 + Math.sin(p * Math.PI) * 0.24;
    }
    const sz = TILE * sc;
    const ox = tx * TILE + (TILE - sz) * 0.5;
    const oy = ty * TILE + (TILE - sz) * 0.5;

    wCtx.globalAlpha = 0.62;
    wCtx.drawImage(meta.canvas, ox, oy, sz, sz);
    wCtx.globalAlpha = 0.9;
    wCtx.strokeStyle = '#f28c38';
    wCtx.lineWidth = 1 / camera.zoom;
    wCtx.strokeRect(ox, oy, sz, sz);
  } else {
    wCtx.strokeStyle = 'rgba(230, 234, 242, 0.45)';
    wCtx.lineWidth = 1 / camera.zoom;
    wCtx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
  }
  wCtx.restore();
}

export function renderWorld(alpha) {
  const world = getActiveWorld();
  pruneBgEffectFades();

  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  wCtx.imageSmoothingEnabled = false;

  // Infinite dark abyss backdrop
  wCtx.fillStyle = '#0d0e11';
  wCtx.fillRect(0, 0, viewport.width, viewport.height);

  // Manyland Background Lighting Pass (LIGHT, FILL LIGHT, TOP LIGHT)
  drawBackgroundLights(world);

  // Deep Sky Environmentals Backdrop (STARS, CLOUDS)
  envSys.drawBackdrop();

  const cx = viewport.width * 0.5 - camera.offsetX;
  const cy = viewport.height * 0.5 + camera.offsetY;
  const worldScale = viewport.dpr * camera.zoom;
  const worldOriginX = Math.round(cx * viewport.dpr - camera.x * worldScale);
  const worldOriginY = Math.round(cy * viewport.dpr - camera.y * worldScale);

  wCtx.save();
  wCtx.setTransform(worldScale, 0, 0, worldScale, worldOriginX, worldOriginY);
  wCtx.imageSmoothingEnabled = false;

  // Visible world bounds for sparse culling
  const topLeft = screenToWorld(0, 0);
  const botRight = screenToWorld(viewport.width, viewport.height);
  const minTx = Math.floor(topLeft.wx / TILE) - 2;
  const maxTx = Math.ceil(botRight.wx / TILE) + 2;
  const minTy = Math.floor(topLeft.wy / TILE) - 2;
  const maxTy = Math.ceil(botRight.wy / TILE) + 2;

  // Layer order: BG -> MAIN -> RUNTIME ENTITIES -> PLAYER -> FG -> FX -> ENV PARTICLES -> LIGHT GLOWS/LABELS -> BUILD GRID & PREVIEWS
  drawLayerTiles(world, 'bg', minTx, maxTx, minTy, maxTy, worldOriginX, worldOriginY, worldScale);
  drawLayerTiles(world, 'main', minTx, maxTx, minTy, maxTy, worldOriginX, worldOriginY, worldScale);
  drawRuntimeEntities(world, alpha);
  drawPlayer(alpha);
  drawLayerTiles(world, 'fg', minTx, maxTx, minTy, maxTy, worldOriginX, worldOriginY, worldScale);
  drawWorldFX();
  envSys.drawWorldParticles();
  drawLightsAndLabels(world, minTx, maxTx, minTy, maxTy);
  drawSpawnMarker(world);
  drawLocalizedBuildGrid();
  drawBrushPreview();
  drawCursorFX();

  wCtx.restore();

  // Low-lying MIST fog banks & SURROUND LIGHT screen-border vignette overlay
  envSys.drawMistOverlay();
  drawSurroundLights(world);
  drawBreathBar(alpha);

  // Guard zoom readout DOM write so it only mutates when formatted zoom changes
  const zoomText = `${camera.zoom.toFixed(1)}X`;
  if (zoomText !== camera.lastZoomText) {
    camera.lastZoomText = zoomText;
    zoomReadoutBtn.textContent = zoomText;
  }
}
