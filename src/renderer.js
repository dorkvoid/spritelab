import { SFX } from './audio.js';
import {
  defaultLightOpts,
  findLayMotionSprite,
  getBigThingTileMult,
  getWireNodeMeta,
  isEmergingHarmSubType,
  isGearType,
  isMovingHarmSubType,
  isSingleCelType,
  isWireSourceInfo,
  isWireTargetInfo,
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
import { clamp, evalEmergingHazard, getSpriteStateFps, getTileFxColors, hexToRgb, orientToTransform, parseTileKey, starterTileCanvas, transformOrientVec } from './utils.js';
import {
  findNearbySeat,
  getMainTileInfo,
  getMainTileType,
  getTileMeta,
  getTileOrient,
  getWireCurvePoints,
  getWireEndpointWorldCenter,
  getWorldLineTiles,
  getWorldRectTiles,
  resolveTransformingBigCell,
  screenToWorld,
  worldToScreen
} from './world.js';

const _breathPopMap = new Map();

function drawOrientedCanvas(ctx, img, cx, cy, w, h, orient) {
  if (!orient) {
    ctx.drawImage(img, cx - w * 0.5, cy - h * 0.5, w, h);
    return;
  }
  const { flip, rot } = orientToTransform(orient);
  const drawW = (rot & 1) ? h : w;
  const drawH = (rot & 1) ? w : h;
  ctx.save();
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot * Math.PI * 0.5);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  ctx.restore();
}

function drawAnimatedBrushSprite(ctx, img, cx, cy, sz, angle, scaleX, scaleY = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  if (Math.abs(angle) > 0.001) ctx.rotate(angle);
  const sx = Math.abs(scaleX) < 0.04 ? (scaleX < 0 ? -0.04 : 0.04) : scaleX;
  if (Math.abs(sx - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
    ctx.scale(sx, scaleY);
  }
  ctx.drawImage(img, -sz * 0.5, -sz * 0.5, sz, sz);
  ctx.restore();
}

function drawPixelBrackets(ctx, x, y, w, h, armLen) {
  const a = Math.min(armLen, w * 0.45, h * 0.45);
  ctx.beginPath();
  ctx.moveTo(x, y + a);
  ctx.lineTo(x, y);
  ctx.lineTo(x + a, y);
  ctx.moveTo(x + w - a, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + a);
  ctx.moveTo(x + w, y + h - a);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - a, y + h);
  ctx.moveTo(x + a, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - a);
  ctx.stroke();
}

export function drawCursorFX() {
  const invZ = 1 / camera.zoom;

  // 1. Crisp 4-corner lock-on brackets + corner glints on Alt-click / double-click tile pickup
  if (worldFX.cursorPickup) {
    const p = (state.uiTime - worldFX.cursorPickup.startUiTime) / 0.28;
    if (p >= 1) {
      worldFX.cursorPickup = null;
    } else {
      const ease = 1 - Math.pow(1 - p, 3);
      const pad = (1 - ease) * 6.5 - Math.sin(p * Math.PI) * 0.8;
      const bx = worldFX.cursorPickup.tx * TILE - pad;
      const by = worldFX.cursorPickup.ty * TILE - pad;
      const bw = TILE + pad * 2;
      const bh = TILE + pad * 2;
      wCtx.save();
      wCtx.globalAlpha = (1 - p * p) * 0.92;
      wCtx.strokeStyle = p < 0.35 ? '#fff2de' : (worldFX.cursorPickup.color || '#f28c38');
      wCtx.lineWidth = (1.5 - p * 0.35) * invZ;
      drawPixelBrackets(wCtx, bx, by, bw, bh, 4.5);

      // Subtle corner pixel glints radiating outward as the block snaps to cursor
      const cx = worldFX.cursorPickup.tx * TILE + TILE * 0.5;
      const cy = worldFX.cursorPickup.ty * TILE + TILE * 0.5;
      const glintR = TILE * 0.54 + ease * 5.5;
      wCtx.globalAlpha = (1 - p) * (1 - p) * 0.9;
      wCtx.fillStyle = '#ffd48c';
      for (let c = 0; c < 4; c++) {
        const ang = Math.PI * 0.25 + c * Math.PI * 0.5;
        const gx = cx + Math.cos(ang) * glintR;
        const gy = cy + Math.sin(ang) * glintR;
        wCtx.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5);
      }
      wCtx.restore();
    }
  }

  // 2. Smooth middle-mouse / Esc block deselect ("tuck-away pop" with bracket pulse & eased dust motes)
  if (worldFX.cursorDeselects.length > 0) {
    wCtx.save();
    wCtx.imageSmoothingEnabled = false;
    for (let i = worldFX.cursorDeselects.length - 1; i >= 0; i--) {
      const fx = worldFX.cursorDeselects[i];
      const dur = fx.duration || 0.28;
      const p = (state.uiTime - fx.startUiTime) / dur;
      if (p >= 1) {
        worldFX.cursorDeselects.splice(i, 1);
        continue;
      }

      // Phase 1 (0..0.24): crisp anticipation pop; Phase 2 (0.24..1): smooth tuck-away shrink + arc drop
      let sc;
      let alpha;
      let tuckSpin;
      if (p < 0.24) {
        const q = p / 0.24;
        const easeOut = 1 - Math.pow(1 - q, 2);
        sc = 1 + easeOut * 0.14;
        alpha = 0.82;
        tuckSpin = -0.07 * easeOut;
      } else {
        const q = (p - 0.24) / 0.76;
        const easeIn = q * q * q;
        sc = Math.max(0.08, 1.14 * (1 - easeIn * 0.92));
        alpha = 0.82 * Math.pow(1 - q, 1.35);
        tuckSpin = -0.07 + easeIn * 0.42;
      }
      const arcY = -Math.sin(p * Math.PI) * 2.8 + p * p * 4.2;
      const cx = fx.wx;
      const cy = fx.wy + arcY;
      const sz = TILE * sc;

      // Expanding soft corner brackets fading away cleanly from the dismissed tile
      const brEase = 1 - Math.pow(1 - p, 3);
      const brPad = 1 + brEase * 6.5;
      const brFade = (1 - p) * (1 - p);
      if (brFade > 0.02) {
        wCtx.globalAlpha = brFade * 0.72;
        wCtx.strokeStyle = p < 0.25 ? '#ffd48c' : (fx.color || '#f28c38');
        wCtx.lineWidth = 1.2 * invZ;
        drawPixelBrackets(
          wCtx,
          fx.wx - TILE * 0.5 - brPad,
          fx.wy - TILE * 0.5 - brPad,
          TILE + brPad * 2,
          TILE + brPad * 2,
          3.8
        );
      }

      if (fx.canvas && alpha > 0.01) {
        wCtx.globalAlpha = alpha;
        const baseAngle = Number.isFinite(fx.angle) ? fx.angle : 0;
        const baseScaleX = Number.isFinite(fx.scaleX) ? fx.scaleX : 1;
        drawAnimatedBrushSprite(wCtx, fx.canvas, cx, cy, sz, baseAngle + tuckSpin, baseScaleX, 1);
      }

      // Eased pixel dust motes decelerating outward with gentle drift
      for (let j = 0; j < fx.sparks.length; j++) {
        const spk = fx.sparks[j];
        const spP = clamp((p - (spk.delay || 0)) / Math.max(0.1, 1 - (spk.delay || 0)), 0, 1);
        if (spP <= 0 || spP >= 1) continue;
        const ease = 1 - Math.pow(1 - spP, 3);
        const fade = (1 - spP) * (1 - spP);
        const mx = fx.wx + Math.cos(spk.ang) * spk.dist * ease;
        const my = fx.wy + Math.sin(spk.ang) * spk.dist * ease + spP * spP * 3.8 + (spk.rise || 0) * ease;
        const mSz = (spk.size || 1.5) * (1 - spP * 0.35);
        wCtx.globalAlpha = fade * 0.92;
        wCtx.fillStyle = spk.color || fx.color || '#f28c38';
        wCtx.fillRect(mx - mSz * 0.5, my - mSz * 0.5, mSz, mSz);
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

export function drawLightGlowOverlay(ctx, glowCanvas, cx, cy, drawSize, opts, tNow, seed = 0, haloRgb = null, orient = 0) {
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

  const oTr = orient ? orientToTransform(orient) : null;
  const totalRot = rot + (oTr ? oTr.rot * Math.PI * 0.5 : 0);
  if (totalRot !== 0) ctx.rotate(totalRot);
  if (oTr && oTr.flip) ctx.scale(-1, 1);
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

/* Crisp chamfered pixel-art bar frame (notched corners + pixel drop shadow at integer scale s) */
function drawChamferedPixelFrame(ctx, x, y, w, h, s, borderCol, topRimCol, bgCol) {
  const px = (dx, dy, rw, rh, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x + dx * s, y + dy * s, rw * s, rh * s);
  };

  // Soft pixel drop shadow for crisp legibility over bright skies, lights & water
  px(1, h, w - 2, 1, 'rgba(7, 9, 14, 0.56)');
  px(2, h + 1, w - 4, 1, 'rgba(7, 9, 14, 0.28)');

  // Outer chamfered silhouette (1 logical px cut off all 4 corners)
  px(1, 0, w - 2, 1, borderCol);
  px(1, h - 1, w - 2, 1, borderCol);
  px(0, 1, 1, h - 2, borderCol);
  px(w - 1, 1, 1, h - 2, borderCol);

  // Inner recessed dark trough
  px(1, 1, w - 2, h - 2, bgCol);

  // Subtle recessed inner top shadow + crisp top edge rim highlight
  px(1, 1, w - 2, 1, 'rgba(0, 0, 0, 0.34)');
  if (topRimCol) {
    px(2, 0, w - 4, 1, topRimCol);
  }
}

/* Glossy 11x10 pixel-art Heart emblem anchored to the left end of the overhead Health Bar */
function drawHudHeartBadge(ctx, x, y, s, flash, lowHp, empty) {
  const p = (dx, dy, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x + dx * s, y + dy * s, w * s, h * s);
  };

  // Subtle pixel drop shadow
  const sh = 'rgba(6, 8, 13, 0.52)';
  p(2, 6, 7, 1, sh);
  p(3, 7, 5, 2, sh);
  p(4, 9, 3, 1, sh);
  p(5, 10, 1, 1, sh);

  const outline = flash ? '#ffffff' : (lowHp ? '#59121f' : '#1b0b10');
  const fill = empty ? '#2c222b' : (flash ? '#ff9ea8' : '#e6394e');
  const bright = empty ? '#3d303c' : (flash ? '#ffd6dc' : '#ff6b7d');
  const shade = empty ? '#1d161d' : (flash ? '#e05868' : '#9c192d');
  const shine = empty ? '#524452' : '#fff0f3';

  // Crisp 11x10 outer silhouette
  p(2, 0, 2, 1, outline);
  p(7, 0, 2, 1, outline);
  p(1, 1, 1, 1, outline);
  p(4, 1, 1, 1, outline);
  p(6, 1, 1, 1, outline);
  p(9, 1, 1, 1, outline);
  p(0, 2, 1, 3, outline);
  p(5, 2, 1, 1, outline);
  p(10, 2, 1, 3, outline);
  p(1, 5, 1, 1, outline);
  p(9, 5, 1, 1, outline);
  p(2, 6, 1, 1, outline);
  p(8, 6, 1, 1, outline);
  p(3, 7, 1, 1, outline);
  p(7, 7, 1, 1, outline);
  p(4, 8, 1, 1, outline);
  p(6, 8, 1, 1, outline);
  p(5, 9, 1, 1, outline);

  // Sculpted ruby interior
  p(2, 1, 2, 1, bright);
  p(7, 1, 2, 1, bright);
  p(1, 2, 4, 3, fill);
  p(6, 2, 4, 3, fill);
  p(5, 3, 1, 4, fill);
  p(2, 5, 7, 1, fill);
  p(3, 6, 5, 1, fill);
  p(4, 7, 3, 1, shade);
  p(5, 8, 1, 1, shade);

  // Lower-right bevel shadow
  p(9, 3, 1, 2, shade);
  p(8, 5, 1, 1, shade);
  p(7, 6, 1, 1, shade);
  p(6, 7, 1, 1, shade);

  // Glossy top-left highlight
  p(2, 2, 2, 1, shine);
  p(2, 3, 1, 1, shine);
  p(7, 2, 1, 1, bright);
}

/* Glossy 10x10 pixel-art Aqua Bubble emblem anchored to the left end of the overhead Breath Bar */
function drawHudBubbleBadge(ctx, x, y, s, urgent, empty) {
  const p = (dx, dy, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x + dx * s, y + dy * s, w * s, h * s);
  };

  // Drop shadow
  const sh = 'rgba(6, 10, 18, 0.50)';
  p(2, 9, 6, 1, sh);
  p(3, 10, 4, 1, sh);

  const outline = urgent ? '#6b1a28' : '#0f3357';
  const body = empty ? '#1b2736' : (urgent ? '#cf485c' : '#2684cc');
  const mid = empty ? '#253549' : (urgent ? '#f07586' : '#56c2f7');
  const rimGlow = empty ? '#364a63' : (urgent ? '#ffb3be' : '#b2ebff');
  const shine = empty ? '#4e6785' : '#ffffff';

  // Crisp 10x10 circle outline
  p(3, 0, 4, 1, outline);
  p(3, 9, 4, 1, outline);
  p(0, 3, 1, 4, outline);
  p(9, 3, 1, 4, outline);
  p(1, 1, 2, 1, outline);
  p(7, 1, 2, 1, outline);
  p(1, 2, 1, 1, outline);
  p(8, 2, 1, 1, outline);
  p(1, 7, 1, 1, outline);
  p(8, 7, 1, 1, outline);
  p(1, 8, 2, 1, outline);
  p(7, 8, 2, 1, outline);

  // Translucent glass sphere shading
  p(3, 1, 4, 8, body);
  p(1, 3, 8, 4, body);
  p(2, 2, 6, 6, body);

  p(2, 2, 5, 4, mid);
  p(3, 6, 4, 1, mid);
  p(3, 1, 3, 1, rimGlow);

  // Crisp curved top-left white specular shine + subtle bottom-right caustic
  p(2, 2, 2, 1, shine);
  p(2, 3, 1, 1, shine);
  p(3, 3, 1, 1, rimGlow);
  p(6, 6, 1, 1, rimGlow);
}

export function drawBreathBar(alpha = 1) {
  if (state.mode !== 'PLAY') return;
  const showBreath = player.breathHudAlpha > 0.01 && !player.dead;
  const showHealth = player.healthHudAlpha > 0.01 || player.dead;
  if (!showBreath && !showHealth) return;

  const s = 2; // Crisp 2x integer pixel scale for effortless overhead readability
  const total = player.maxBreath; // 10 segments
  const segW = 4;                 // 8px per bubble/HP segment
  const segGap = 1;               // 2px crisp gap
  const innerLogW = total * segW + (total - 1) * segGap; // 49 logical px -> 98px
  const innerLogH = 5;            // 10px tall fill track
  const frameLogW = innerLogW + 2; // 51 logical px -> 102px
  const frameLogH = innerLogH + 2; // 7 logical px -> 14px
  const badgeOverhang = 8 * s;    // 16px left emblem overhang
  const innerW = innerLogW * s;
  const innerH = innerLogH * s;
  const frameW = frameLogW * s;
  const rowW = frameW + badgeOverhang; // 118px total readable bar width
  const rowH = 10 * s;            // 20px badge height
  const rowGap = 5;

  // Interpolated player head screen anchor (accounts for 29x29 BODY height vs 19x19 wireframe)
  const pX = player.prevX + (player.x - player.prevX) * alpha;
  const pY = player.prevY + (player.y - player.prevY) * alpha;
  const footCx = pX + player.w * 0.5;
  const footY = pY + player.h;
  const bodySp = state.equippedBodyId ? getSpriteById(state.equippedBodyId) : null;
  const spriteH = (bodySp && !player.dead) ? Math.max(TILE, bodySp.size || TILE) : TILE;
  const headScr = worldToScreen(footCx, footY - spriteH);

  let banText = '';
  let banW = rowW + 16;
  const banH = 22;

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  wCtx.imageSmoothingEnabled = false;

  if (player.dead) {
    const labelCause = player.deathCause === 'drown'
      ? 'DROWNED'
      : (player.deathFallRagdoll ? 'FELL' : 'KO');
    const secs = Math.max(0.1, player.deathTimer).toFixed(1);
    banText = `${labelCause} - ${secs}S`;
    wCtx.font = '13px "Perfect DOS VGA 437", "VT323", monospace';
    banW = Math.max(rowW + 14, Math.ceil(wCtx.measureText(banText).width) + 20);
  }

  const maxBoxW = Math.max(rowW, player.dead ? banW : 0);
  const stackH = (showHealth ? rowH : 0)
    + (showBreath ? (rowH + (showHealth ? rowGap : 0)) : 0)
    + (player.dead ? (banH + rowGap + 2) : 0);

  const leftBound = 10;
  const rightBound = Math.max(leftBound + maxBoxW, viewport.width - (state.menusHidden ? 10 : Math.round(camera.offsetX * 2 + 10)));
  const topBound = state.menusHidden ? 10 : 50;
  const bottomBound = viewport.height - 16;

  const anchorCx = Math.round(clamp(headScr.sx, leftBound + maxBoxW * 0.5, rightBound - maxBoxW * 0.5));
  const desiredBottom = Math.round(headScr.sy - 14);
  const stackBottom = clamp(desiredBottom, topBound + stackH, bottomBound);

  const rowLeft = Math.round(anchorCx - rowW * 0.5);
  const frameX = rowLeft + badgeOverhang;
  let cursorBottom = stackBottom;

  let healthRowY = 0;
  if (showHealth) {
    healthRowY = cursorBottom - rowH;
    cursorBottom = healthRowY - rowGap;
  }
  let breathRowY = 0;
  if (showBreath) {
    breathRowY = cursorBottom - rowH;
    cursorBottom = breathRowY - rowGap;
  }
  const banY = cursorBottom - banH - 2;

  // 1. Sleek Beveled 2x Pixel Health Bar + Heart Emblem (closest above player head)
  if (showHealth) {
    const lowHp = !player.dead && player.health <= 25;
    const flashing = player.damageFlashTimer > 0 && Math.floor(state.uiTime * 28) % 2 === 0;
    const isRegening = !player.dead && player.health < player.maxHealth - 0.1 && player.healthRegenDelay <= 0 && !(player.submerged && player.breath <= 0);
    const hpFrac = clamp(player.health / Math.max(1, player.maxHealth), 0, 1);
    const trailFrac = clamp((Number.isFinite(player.healthTrail) ? player.healthTrail : player.health) / Math.max(1, player.maxHealth), hpFrac, 1);

    const shakeY = lowHp ? (Math.sin(state.uiTime * 38) > 0.65 ? -s : 0) : 0;
    const frameY = healthRowY + 2 * s + shakeY;
    const innerX = frameX + s;
    const innerY = frameY + s;

    wCtx.save();
    wCtx.globalAlpha = clamp(player.dead ? 1 : player.healthHudAlpha, 0, 1);

    const borderCol = flashing ? '#ffe0e5' : ((lowHp || player.dead) ? '#6e202d' : '#12151e');
    const topRimCol = (lowHp || player.dead) ? 'rgba(255, 118, 134, 0.45)' : 'rgba(255, 255, 255, 0.14)';
    drawChamferedPixelFrame(wCtx, frameX, frameY, frameLogW, frameLogH, s, borderCol, topRimCol, '#19141d');

    // Delayed damage-drain trail (warm pale-gold sweep right behind lost HP, snapped to integer s)
    const trailPx = Math.round(innerLogW * trailFrac) * s;
    const fillPx = Math.round(innerLogW * hpFrac) * s;
    if (trailPx > fillPx) {
      wCtx.fillStyle = '#ffe5b0';
      wCtx.fillRect(innerX + fillPx, innerY, trailPx - fillPx, s);
      wCtx.fillStyle = '#f2a14a';
      wCtx.fillRect(innerX + fillPx, innerY + s, trailPx - fillPx, innerH - 2 * s);
      wCtx.fillStyle = '#b86322';
      wCtx.fillRect(innerX + fillPx, innerY + innerH - s, trailPx - fillPx, s);
    }

    // Vibrant 3-tone beveled ruby health fill
    if (fillPx > 0) {
      const topCol = flashing ? '#ffffff' : (lowHp ? '#ff8f7a' : '#ff7b8e');
      const midCol = flashing ? '#ff9ea8' : (lowHp ? '#eb4444' : '#e0364c');
      const botCol = flashing ? '#e05868' : (lowHp ? '#9c1b22' : '#96192c');
      wCtx.fillStyle = topCol;
      wCtx.fillRect(innerX, innerY, fillPx, s);
      wCtx.fillStyle = midCol;
      wCtx.fillRect(innerX, innerY + s, fillPx, innerH - 2 * s);
      wCtx.fillStyle = botCol;
      wCtx.fillRect(innerX, innerY + innerH - s, fillPx, s);

      // Crisp bright leading cap on the active fill edge
      if (fillPx >= 2 * s && fillPx < innerW) {
        wCtx.fillStyle = '#ffd9df';
        wCtx.fillRect(innerX + fillPx - s, innerY, s, innerH - s);
      }

      // Subtle traveling healing sheen when regenerating
      if (isRegening && fillPx > 6 * s) {
        const fillLog = fillPx / s;
        const glintX = Math.floor(((state.uiTime * 38) % (fillLog + 12)) - 6);
        for (let gx = Math.max(0, glintX); gx < Math.min(fillLog, glintX + 3); gx++) {
          wCtx.fillStyle = 'rgba(255, 240, 244, 0.42)';
          wCtx.fillRect(innerX + gx * s, innerY, s, innerH - s);
        }
      }
    }

    // Crisp subtle 10-segment tick marks for clean 10-HP readability
    wCtx.fillStyle = 'rgba(13, 14, 17, 0.30)';
    for (let i = 1; i < total; i++) {
      const tx = innerX + (i * (segW + segGap) - 1) * s;
      wCtx.fillRect(tx, innerY, s, innerH);
    }

    // Iconic 22x20 pixel ruby Heart badge anchored on left end
    const heartBounce = lowHp && Math.sin(state.uiTime * 10) > 0.65 ? -s : 0;
    drawHudHeartBadge(wCtx, rowLeft, healthRowY + heartBounce, s, flashing, lowHp, player.health <= 0);

    // Sleek chamfered Revival Countdown Pill above the Health Bar when dead
    if (player.dead) {
      const progress = clamp(1 - player.deathTimer / Math.max(0.1, player.deathMaxTimer), 0, 1);
      const banX = Math.round(anchorCx - banW * 0.5);

      // 1px crisp chamfered dark glass pill
      drawChamferedPixelFrame(wCtx, banX, banY, banW, banH, 1, '#8c313d', 'rgba(255, 168, 176, 0.38)', 'rgba(15, 16, 22, 0.92)');

      // Smooth glowing amber progress strip along bottom interior edge
      const progW = Math.round((banW - 4) * progress);
      if (progW > 0) {
        wCtx.fillStyle = '#f28c38';
        wCtx.fillRect(banX + 2, banY + banH - 4, progW, 3);
        wCtx.fillStyle = '#ffd7a3';
        wCtx.fillRect(banX + 2, banY + banH - 4, progW, 1);
      }

      wCtx.font = '13px "Perfect DOS VGA 437", "VT323", monospace';
      wCtx.fillStyle = '#f7e9dc';
      wCtx.textAlign = 'center';
      wCtx.textBaseline = 'middle';
      wCtx.fillText(banText, banX + banW * 0.5, banY + (banH - 4) * 0.5 + 1);
      wCtx.textAlign = 'start';
    }

    wCtx.restore();
  }

  // 2. Sleek Segmented 2x Aqua Breath Bar + Glossy Bubble Emblem (stacked above Health Bar)
  if (showBreath) {
    const fullBubbles = Math.floor(player.breath);
    const frac = player.breath - fullBubbles;
    const lowAir = player.submerged && player.breath <= 2.5;
    const criticalAir = player.submerged && player.breath <= 1.2;

    _breathPopMap.clear();
    const popMap = _breathPopMap;
    for (let i = 0; i < player.breathPopFx.length; i++) {
      popMap.set(player.breathPopFx[i].slot, player.breathPopFx[i]);
    }

    const shakeY = criticalAir ? (Math.sin(state.uiTime * 42) > 0.5 ? -s : 0) : 0;
    const frameY = breathRowY + 2 * s + shakeY;
    const innerX = frameX + s;
    const innerY = frameY + s;

    wCtx.save();
    wCtx.globalAlpha = clamp(player.breathHudAlpha, 0, 1);

    const bBorder = criticalAir ? '#7a2230' : '#0f2740';
    const bTopRim = criticalAir ? 'rgba(255, 132, 146, 0.42)' : 'rgba(166, 228, 255, 0.30)';
    drawChamferedPixelFrame(wCtx, frameX, frameY, frameLogW, frameLogH, s, bBorder, bTopRim, '#0f1824');

    // 10 crisp glowing aqua bubble cells with live depletion & popping micro-bursts
    for (let i = 0; i < total; i++) {
      const cx = innerX + i * (segW + segGap) * s;
      const cellW = segW * s;
      const isUrgentCell = criticalAir && i === 0;
      const cellShake = lowAir && i <= fullBubbles && Math.sin(state.uiTime * 36 + i * 2.1) > 0.6 ? -s : 0;
      const cy = innerY + cellShake;

      if (i < fullBubbles) {
        wCtx.fillStyle = isUrgentCell ? '#ffd0d6' : '#c9f5ff';
        wCtx.fillRect(cx, cy, cellW, s);
        wCtx.fillStyle = isUrgentCell ? '#eb5a6c' : '#42b8f5';
        wCtx.fillRect(cx, cy + s, cellW, innerH - 2 * s);
        wCtx.fillStyle = isUrgentCell ? '#9e2334' : '#1b65a6';
        wCtx.fillRect(cx, cy + innerH - s, cellW, s);
        // Tiny crisp white bubble pearl glint
        wCtx.fillStyle = '#ffffff';
        wCtx.fillRect(cx + s, cy + s, s, s);
      } else if (i === fullBubbles && frac > 0.001) {
        const isPopping = player.submerged && frac < 0.28;
        if (isPopping) {
          wCtx.fillStyle = isUrgentCell ? '#ff9ea8' : '#b8eeff';
          wCtx.fillRect(cx, cy, cellW, s);
          wCtx.fillRect(cx, cy + innerH - s, cellW, s);
          wCtx.fillStyle = '#ffffff';
          wCtx.fillRect(cx + s, cy + 2 * s, 2 * s, s);
        } else {
          const fillLogH = Math.max(2, Math.round(innerLogH * (0.4 + frac * 0.6)));
          const offY = (innerLogH - fillLogH) * s;
          wCtx.fillStyle = isUrgentCell ? '#ffd0d6' : '#c9f5ff';
          wCtx.fillRect(cx, cy + offY, cellW, s);
          wCtx.fillStyle = isUrgentCell ? '#eb5a6c' : '#42b8f5';
          wCtx.fillRect(cx, cy + offY + s, cellW, Math.max(s, (fillLogH - 1) * s));
        }
      } else {
        // Subtle recessed empty pearl slot
        wCtx.fillStyle = 'rgba(116, 178, 224, 0.14)';
        wCtx.fillRect(cx, innerY + s, cellW, innerH - 2 * s);
      }

      // Rising pixel bubble-pop sparkle right above the segment when a bubble pops
      if (popMap.has(i)) {
        const fx = popMap.get(i);
        const p = clamp(fx.timer / fx.maxTimer, 0, 1);
        const rise = Math.round(p * 6) * s;
        const spread = Math.round(1 + p * 2.5) * s;
        const popCx = cx + Math.floor(segW * 0.5) * s;
        const popCy = frameY - 2 * s - rise;
        wCtx.save();
        wCtx.globalAlpha *= (1 - p);
        wCtx.fillStyle = criticalAir ? '#ffd6dc' : '#e6faff';
        wCtx.fillRect(popCx - spread, popCy, s, s);
        wCtx.fillRect(popCx + spread, popCy, s, s);
        wCtx.fillStyle = criticalAir ? '#f08a96' : '#7fd3fc';
        wCtx.fillRect(popCx, popCy - s, s, s);
        wCtx.restore();
      }
    }

    // Glossy 20x20 pixel Bubble badge anchored on left end with calm gentle underwater float
    const bubbleBob = player.submerged ? Math.round(Math.sin(state.uiTime * 3.6) * 0.7) * s : 0;
    drawHudBubbleBadge(wCtx, rowLeft, breathRowY + bubbleBob, s, criticalAir, player.breath <= 0.01);

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
      e.sp._glowHaloRgb || null,
      getTileOrient(world, 'bg', e.key)
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
      e.sp._glowHaloRgb || null,
      getTileOrient(world, 'bg', e.key)
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
      let displayText = text;
      if (e.sp.subType === 'POINTER') {
        const pv = transformOrientVec(1, 0, getTileOrient(world, 'bg', e.key));
        const arrow = pv.y < 0 ? '^ ' : (pv.y > 0 ? 'v ' : (pv.x < 0 ? '< ' : '> '));
        displayText = pv.x > 0 ? `${text} >` : `${arrow}${text}`;
      }
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
      const tw = wCtx.measureText(displayText).width;
      const bw = tw + 10;
      const bh = 18;
      const bx = Math.round(pos.sx - bw * 0.5);
      const by = Math.round(pos.sy - bh);
      wCtx.fillStyle = 'rgba(13, 14, 17, 0.88)';
      wCtx.fillRect(bx, by, bw, bh);
      wCtx.strokeStyle = e.sp.subType === 'POINTER' ? '#f28c38' : '#3a404f';
      wCtx.lineWidth = 1;
      wCtx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      wCtx.fillStyle = '#f6e4d2';
      wCtx.textBaseline = 'middle';
      wCtx.fillText(displayText, bx + 5, by + bh * 0.5 + 1);
      wCtx.restore();
    }
  }

  // 4. Manyland-style overhead miniature preview when standing right in front of a VIEWABLE tile
  if (state.mode === 'PLAY' && !player.dead && !isAnyModalOpen()) {
    const pCx = player.x + player.w * 0.5;
    const pCy = player.y + player.h * 0.5;
    const ptx = Math.floor(pCx / TILE);
    const pty = Math.floor(pCy / TILE);
    let bestView = null;
    let bestDist = TILE * 2.1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const info = getMainTileInfo(world, ptx + dx, pty + dy);
        if (!info || info.type !== 'VIEWABLE' || !info.sp || !info.sp._canvases || !info.sp._canvases.length) continue;
        const d = Math.hypot((ptx + dx + 0.5) * TILE - pCx, (pty + dy + 0.5) * TILE - pCy);
        if (d < bestDist) {
          bestDist = d;
          bestView = { tx: ptx + dx, ty: pty + dy, sp: info.sp };
        }
      }
    }
    if (bestView) {
      const sp = bestView.sp;
      const frames = sp._canvases;
      const fIdx = frames.length > 1 ? (Math.floor(state.uiTime * (sp.fps || 6)) % frames.length) : 0;
      const img = frames[fIdx] || frames[0];
      const pos = worldToScreen(bestView.tx * TILE + TILE * 0.5, bestView.ty * TILE - 4);
      const artSz = 56;
      const pad = 5;
      const cardW = artSz + pad * 2;
      const cardH = artSz + pad * 2 + 13;
      const bx = clamp(Math.round(pos.sx - cardW * 0.5), 8, viewport.width - cardW - 8);
      const by = clamp(Math.round(pos.sy - cardH - 6), 46, viewport.height - cardH - 8);
      wCtx.save();
      wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
      wCtx.imageSmoothingEnabled = false;
      wCtx.fillStyle = 'rgba(13, 14, 17, 0.94)';
      wCtx.fillRect(bx, by, cardW, cardH);
      wCtx.strokeStyle = '#f28c38';
      wCtx.lineWidth = 1;
      wCtx.strokeRect(bx + 0.5, by + 0.5, cardW - 1, cardH - 1);
      wCtx.fillStyle = '#1a1d24';
      wCtx.fillRect(bx + pad, by + pad, artSz, artSz);
      wCtx.drawImage(img, bx + pad, by + pad, artSz, artSz);
      wCtx.font = '10px "Perfect DOS VGA 437", "VT323", monospace';
      wCtx.fillStyle = '#f6e4d2';
      wCtx.textAlign = 'center';
      wCtx.textBaseline = 'middle';
      wCtx.fillText('SPACE VIEW', bx + cardW * 0.5, by + cardH - 7);
      wCtx.textAlign = 'start';
      wCtx.restore();
    }
  }

  // 5. Crisp compact prompt chip when standing next to a SITTABLE / LAYABLE object
  if (state.mode === 'PLAY' && !player.dead && !runtime.seated && !runtime.mount && !isAnyModalOpen()) {
    const nearSeat = findNearbySeat(world);
    if (nearSeat) {
      const label = nearSeat.mode === 'LAY' ? 'SPACE / S : LAY' : 'SPACE / S : SIT';
      const anchorY = nearSeat.solidTop ? ((nearSeat.ty - 1) * TILE - 4) : (nearSeat.ty * TILE - 4);
      const pos = worldToScreen(nearSeat.tx * TILE + TILE * 0.5, anchorY);
      wCtx.save();
      wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
      wCtx.font = '11px "Perfect DOS VGA 437", "VT323", monospace';
      const tw = wCtx.measureText(label).width;
      const bw = tw + 10;
      const bh = 17;
      const bx = clamp(Math.round(pos.sx - bw * 0.5), 8, viewport.width - bw - 8);
      const by = clamp(Math.round(pos.sy - bh), 46, viewport.height - bh - 8);
      wCtx.fillStyle = 'rgba(13, 14, 17, 0.90)';
      wCtx.fillRect(bx, by, bw, bh);
      wCtx.strokeStyle = '#f28c38';
      wCtx.lineWidth = 1;
      wCtx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      wCtx.fillStyle = '#f6e4d2';
      wCtx.textBaseline = 'middle';
      wCtx.fillText(label, bx + 5, by + bh * 0.5 + 1);
      wCtx.restore();
    }
  }
}

export function resolveTileFrameCanvas(sp, layer, key) {
  if (!sp || !sp._canvases || sp._canvases.length === 0) return null;
  if (sp._canvases.length === 1 || isSingleCelType(sp.type, sp.subType)) return sp._canvases[0];

  if (sp.type === 'INTERACTING') {
    const idx = (runtime.interactFrames.get(key) || 0) % sp._canvases.length;
    return sp._canvases[idx];
  }

  if (sp.type === 'ACTIVATOR' && sp.subType === 'CHANGE') {
    if (!runtime.activatedTiles.has(key)) return sp._canvases[0];
    if (sp._canvases.length === 2) return sp._canvases[1];
    const tAct = state.mode === 'PLAY' ? state.simTime : state.uiTime;
    return sp._canvases[1 + (Math.floor(tAct * (sp.fps || 6)) % (sp._canvases.length - 1))];
  }

  if (sp.type === 'BIG_THING' && sp.subType === 'TRANSFORMING') {
    const tr = resolveTransformingBigCell(sp, layer, key);
    return sp._canvases[tr.cellIdx % sp._canvases.length];
  }

  if (sp.type === 'CHANGING' && sp.subType === 'LIVELY') {
    const tLiv = state.mode === 'PLAY' ? state.simTime : state.uiTime;
    const seed = key ? (key.charCodeAt(0) * 0.37 + key.length * 1.1) : 0;
    const step = Math.floor(tLiv * ((sp.fps || 6) * 0.55) + seed);
    const hash = Math.abs(Math.floor(Math.sin(step * 12.9898 + seed) * 43758.5453));
    return sp._canvases[hash % sp._canvases.length];
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

const liquidOrientCanvas = document.createElement('canvas');
liquidOrientCanvas.width = TILE;
liquidOrientCanvas.height = TILE;
const liquidOrientCtx = liquidOrientCanvas.getContext('2d');
liquidOrientCtx.imageSmoothingEnabled = false;

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

function drawSnappedOrientedWorldImage(ctx, img, wx, wy, ww, wh, orient, originX, originY, scale) {
  if (!orient) {
    drawSnappedWorldImage(ctx, img, wx, wy, ww, wh, originX, originY, scale);
    return;
  }
  const px0 = Math.round(originX + wx * scale);
  const py0 = Math.round(originY + wy * scale);
  const px1 = Math.round(originX + (wx + ww) * scale);
  const py1 = Math.round(originY + (wy + wh) * scale);
  const pw = px1 - px0;
  const ph = py1 - py0;
  if (pw <= 0 || ph <= 0) return;
  const { flip, rot } = orientToTransform(orient);
  const drawW = (rot & 1) ? ph : pw;
  const drawH = (rot & 1) ? pw : ph;
  ctx.save();
  ctx.translate((px0 + px1) * 0.5, (py0 + py1) * 0.5);
  if (rot) ctx.rotate(rot * Math.PI * 0.5);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  ctx.restore();
}

/* Gently bobbing pixel water surface for exposed top-row LIQUID tiles */
export function drawLiquidSurfaceTile(ctx, canvas, tx, ty, sp, originX, originY, scale, orient = 0) {
  let srcCanvas = canvas;
  if (orient) {
    const sw = canvas.width;
    const sh = canvas.height;
    if (liquidOrientCanvas.width !== sw || liquidOrientCanvas.height !== sh) {
      liquidOrientCanvas.width = sw;
      liquidOrientCanvas.height = sh;
    }
    liquidOrientCtx.setTransform(1, 0, 0, 1, 0, 0);
    liquidOrientCtx.imageSmoothingEnabled = false;
    liquidOrientCtx.clearRect(0, 0, sw, sh);
    drawOrientedCanvas(liquidOrientCtx, canvas, sw * 0.5, sh * 0.5, sw, sh, orient);
    srcCanvas = liquidOrientCanvas;
  }
  const baseX = tx * TILE;
  const baseY = ty * TILE;
  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;
  const t = state.mode === 'PLAY' ? state.simTime : state.uiTime;
  const cols = sp._liquidColors || {
    crest: 'rgba(148, 204, 236, 0.44)',
    edge: 'rgba(116, 184, 224, 0.24)',
    veil: 'rgba(130, 194, 230, 0.16)',
    sub: 'rgba(104, 174, 218, 0.15)',
    glint: 'rgba(196, 232, 250, 0.52)'
  };

  // Couple active splashes & swim wake ripples on the waterline
  let rippleEnergy = 0;
  for (let i = 0; i < worldFX.waterRipples.length; i++) {
    const r = worldFX.waterRipples[i];
    if (Math.abs(r.y - baseY) > TILE * 1.4) continue;
    const dx = Math.abs(r.x - (baseX + TILE * 0.5));
    if (dx < TILE * 3.2) {
      const p = clamp(r.timer / r.maxTimer, 0, 1);
      rippleEnergy += (1 - p) * (1 - dx / (TILE * 3.2)) * 1.45;
    }
  }

  // Composite all 19 softly rolling pixel columns at 1:1 integer pixels without vertical stretching or harsh top crust
  liquidScratchCtx.clearRect(0, 0, TILE, TILE + LIQUID_PAD_TOP);
  liquidScratchCtx.imageSmoothingEnabled = false;

  const totalH = LIQUID_PAD_TOP + TILE;
  const stepW = TILE / srcW;
  for (let cx = 0; cx < TILE; cx++) {
    const worldPx = baseX + cx;
    const wave1 = Math.sin(worldPx * 0.13 + t * 1.65);
    const wave2 = Math.sin(worldPx * 0.24 - t * 1.15 + 1.3);
    const splashWave = rippleEnergy > 0.02 ? Math.sin(worldPx * 0.52 - t * 10.5) * Math.min(1.45, rippleEnergy) : 0;
    // Positive crestAmt lifts the waterline UPWARD (smaller Y) for natural rolling wave crests
    const crestAmt = wave1 * 0.56 + wave2 * 0.32 + splashWave;
    const bob = -Math.round(clamp(crestAmt, -1.5, 1.5));
    const localTopY = clamp(LIQUID_PAD_TOP + 1 + bob, 1, totalH - 1);
    const remainH = totalH - localTopY;
    const visibleH = Math.min(TILE, remainH);
    const sx = clamp(Math.floor(cx / stepW), 0, srcW - 1);
    const srcSliceH = clamp(Math.round((visibleH / TILE) * srcH), 1, srcH);

    // 1:1 non-stretched body draw + seamless bottom fill when wave lifts above base top edge
    liquidScratchCtx.drawImage(srcCanvas, sx, 0, 1, srcSliceH, cx, localTopY, 1, visibleH);
    if (remainH > visibleH) {
      liquidScratchCtx.drawImage(srcCanvas, sx, srcH - 1, 1, 1, cx, localTopY + visibleH, 1, remainH - visibleH);
    }

    // Soft translucent waterline meniscus directly on the crisp surface edge (brighter on crests, delicate in troughs)
    liquidScratchCtx.fillStyle = crestAmt > 0.15 ? cols.crest : cols.edge;
    liquidScratchCtx.fillRect(cx, localTopY, 1, 1);
    if (remainH > 2 && crestAmt > 0.05) {
      liquidScratchCtx.fillStyle = cols.sub;
      liquidScratchCtx.fillRect(cx, localTopY + 1, 1, 1);
    }
    // Gentle slow-drifting specular highlight on broad wave peaks
    if (crestAmt > 0.64 && ((Math.floor(worldPx * 0.5 + t * 2.2)) % 9 === 0)) {
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

function drawEmergingHazardTile(ctx, sp, tx, ty, orient, originX, originY, scale) {
  const isBuild = state.mode === 'BUILD';
  const tNow = isBuild ? state.uiTime : state.simTime;
  const em = evalEmergingHazard(tx, ty, sp.harmOpts, orient, tNow, true);
  const canvases = sp._canvases;
  if (!canvases || canvases.length === 0) return;

  if (canvases.length > 1) {
    // Multi-frame DEADLY EMERGING: frame 0 retracted/shaking -> intermediate -> last frame emerged
    const maxIdx = canvases.length - 1;
    const fIdx = (em.phase === 'hidden' || em.phase === 'shake')
      ? 0
      : clamp(Math.round(em.amount * maxIdx), 0, maxIdx);
    const frameC = canvases[fIdx] || canvases[0];
    drawSnappedOrientedWorldImage(
      ctx,
      frameC,
      tx * TILE + em.shakeX,
      ty * TILE + em.shakeY,
      TILE,
      TILE,
      orient,
      originX,
      originY,
      scale
    );
    return;
  }

  // Single-frame DEADLY EMERGING: clipped slide out from base edge (ghosted in BUILD when hidden so editable)
  const px0 = Math.round(originX + tx * TILE * scale);
  const py0 = Math.round(originY + ty * TILE * scale);
  const px1 = Math.round(originX + (tx + 1) * TILE * scale);
  const py1 = Math.round(originY + (ty + 1) * TILE * scale);
  const pw = px1 - px0;
  const ph = py1 - py0;
  if (pw <= 0 || ph <= 0) return;

  if (em.amount <= 0.01) {
    if (isBuild) {
      ctx.save();
      ctx.globalAlpha = 0.34;
      drawSnappedOrientedWorldImage(ctx, canvases[0], tx * TILE, ty * TILE, TILE, TILE, orient, originX, originY, scale);
      ctx.restore();
    }
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(px0, py0, pw, ph);
  ctx.clip();
  const slideOff = (1 - em.amount) * TILE;
  const dx = tx * TILE - em.dirX * slideOff + em.shakeX;
  const dy = ty * TILE - em.dirY * slideOff + em.shakeY;
  drawSnappedOrientedWorldImage(ctx, canvases[0], dx, dy, TILE, TILE, orient, originX, originY, scale);
  if (em.phase === 'shake') {
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = '#f28c38';
    const edgePx = Math.max(1, Math.round(scale));
    if (em.dirY < 0) ctx.fillRect(px0, py1 - edgePx, pw, edgePx);
    else if (em.dirY > 0) ctx.fillRect(px0, py0, pw, edgePx);
    else if (em.dirX < 0) ctx.fillRect(px1 - edgePx, py0, edgePx, ph);
    else ctx.fillRect(px0, py0, edgePx, ph);
  }
  ctx.restore();
}

export function drawLayerTiles(world, layer, minTx, maxTx, minTy, maxTy, originX, originY, scale, inFrontPass = false) {
  const map = world.layers[layer];
  if (!map) return false;

  let hasInFront = false;
  wCtx.save();
  wCtx.setTransform(1, 0, 0, 1, 0, 0);
  wCtx.imageSmoothingEnabled = false;

  for (const key in map) {
    const id = map[key];
    if (!id) continue;
    const pt = parseTileKey(key);
    if (!pt) continue;
    const tx = pt.tx;
    const ty = pt.ty;
    if (tx < minTx || tx > maxTx || ty < minTy || ty > maxTy) continue;
    const orient = getTileOrient(world, layer, key);

    if (id === STARTER_TILE_ID) {
      if (inFrontPass) continue;
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
        drawSnappedOrientedWorldImage(wCtx, starterTileCanvas, sdx, sdy, sdw, sdh, orient, originX, originY, scale);
        wCtx.globalAlpha = 1;
      } else {
        drawSnappedOrientedWorldImage(wCtx, starterTileCanvas, sdx, sdy, sdw, sdh, orient, originX, originY, scale);
      }
      continue;
    }

    const sp = getSpriteById(id);
    if (!sp || isGearType(sp.type)) continue;

    // Dynamic runtime entities are drawn by drawRuntimeEntities()
    if (layer === 'main' && (sp.type === 'MOVING' || sp.type === 'LIVING' || sp.type === 'DYNAMIC' || (sp.type === 'HARMFUL' && isMovingHarmSubType(sp.subType)))) {
      continue;
    }
    if (layer === 'bg') {
      const isBackFront = sp.type === 'BIG_THING' && sp.subType === 'BACK + FRONT';
      if (isBackFront) hasInFront = true;
      if (inFrontPass && !isBackFront) continue;
    }
    if (layer === 'main') {
      const isFrontHarm = sp.type === 'HARMFUL' && Boolean(sp.harmOpts && sp.harmOpts.inFront);
      if (isFrontHarm) hasInFront = true;
      if (inFrontPass !== isFrontHarm) continue;
    }
    if (layer === 'main' && sp.type === 'GATHERABLE' && runtime.collected.has(key)) {
      continue;
    }
    if (layer === 'main' && sp.type === 'MOUNTABLE' && runtime.mount && runtime.mount.tx === tx && runtime.mount.ty === ty) {
      continue;
    }

    // Rhythmic DEADLY EMERGING traps (single-frame clipped slide or multi-frame retracted/emerged cels)
    if (layer === 'main' && sp.type === 'HARMFUL' && isEmergingHarmSubType(sp.subType) && !worldFX.buildPops.has(`${layer}:${key}`)) {
      drawEmergingHazardTile(wCtx, sp, tx, ty, orient, originX, originY, scale);
      continue;
    }

    let canvas = resolveTileFrameCanvas(sp, layer, key);
    if (layer === 'bg' && sp.type === 'BIG_THING' && sp.subType === 'BACK + FRONT') {
      canvas = inFrontPass ? (sp._canvases[1] || null) : (sp._canvases[0] || null);
    }
    if (!canvas) continue;

    // Exposed top-row LIQUID tiles get a gently bobbing water surface; stacked liquid underneath stays flush
    if (layer === 'main' && sp.type === 'LIQUID' && getMainTileType(world, tx, ty - 1) !== 'LIQUID' && !worldFX.buildPops.has(`${layer}:${key}`)) {
      drawLiquidSurfaceTile(wCtx, canvas, tx, ty, sp, originX, originY, scale, orient);
      continue;
    }

    let dx = tx * TILE;
    let dy = ty * TILE;
    let dw = TILE;
    let dh = TILE;
    let alpha = 1;

    if (sp.type === 'BIG_THING') {
      const mult = getBigThingTileMult(sp);
      dw = TILE * mult;
      dh = TILE * mult;
      dx = tx * TILE - (dw - TILE) * 0.5;
      dy = ty * TILE - (dh - TILE);
      const bFx = (sp.bigOpts && sp.bigOpts.fx) || 'NONE';
      const tBig = state.mode === 'PLAY' ? state.simTime : state.uiTime;
      if (bFx === 'SWAY') {
        const windBias = clamp((envSys.wind || 0) * 0.014, -1.6, 1.6);
        dx += Math.sin(tBig * 2.1 + tx * 0.8 + ty * 0.5) * 1.15 + windBias;
      } else if (bFx === 'FADE') {
        if (sp.subType === 'TRANSFORMING') {
          alpha = resolveTransformingBigCell(sp, layer, key).fadeAlpha;
        } else {
          alpha = 0.72 + Math.sin(tBig * 2.0 + tx * 0.6 + ty * 0.4) * 0.24;
        }
      } else if (bFx === 'GLOW' && !inFrontPass) {
        const gCols = getTileFxColors(sp, '#f28c38');
        const gRgb = hexToRgb(gCols.bright || gCols.main);
        const cxScr = Math.round(originX + (dx + dw * 0.5) * scale);
        const cyScr = Math.round(originY + (dy + dh * 0.5) * scale);
        const radScr = Math.max(4, Math.round(dw * 0.62 * scale));
        const pulse = 0.16 + Math.sin(tBig * 2.6 + tx * 0.7) * 0.06;
        const grad = wCtx.createRadialGradient(cxScr, cyScr, 1, cxScr, cyScr, radScr);
        grad.addColorStop(0, `rgba(${gRgb.r},${gRgb.g},${gRgb.b},${pulse})`);
        grad.addColorStop(1, `rgba(${gRgb.r},${gRgb.g},${gRgb.b},0)`);
        wCtx.fillStyle = grad;
        wCtx.fillRect(cxScr - radScr, cyScr - radScr, radScr * 2, radScr * 2);
      }
    } else if (sp.type === 'BACK' && sp.subType === 'FAR BACK') {
      alpha = 0.55;
    } else if (layer === 'bg' && isBgEffectType(sp.type)) {
      const fadeIn = getBgEffectFadeIn(key);
      const lightVis = state.mode === 'BUILD' ? 0.78 : 0.58;
      alpha = (sp.type === 'LIGHT' && sp.subType !== 'LIGHT GLOW') ? (lightVis * fadeIn) : fadeIn;
    } else if (sp.type === 'CRUMBLING') {
      if (sp.subType === 'FLEXIBLE') {
        const fl = runtime.flexOffsets.get(key);
        if (fl) dy += fl.y;
      } else {
        const c = runtime.crumbling.get(key);
        if (c && c.state === 'gone') continue;
        if (c && c.state === 'shake') {
          const urgency = clamp(1 - c.timer / 0.55, 0.2, 1);
          dx += Math.sin(state.simTime * (54 + urgency * 28) + tx * 2.1) * (0.6 + urgency * 0.9);
          dy += Math.cos(state.simTime * 42 + ty * 1.7) * (0.3 * urgency);
        }
      }
    } else if (sp.type === 'CHANGING' && sp.subType === 'LIVELY') {
      const lt = state.mode === 'PLAY' ? state.simTime : state.uiTime;
      const sway = Math.sin(lt * 4.2 + tx * 1.1 + ty * 0.7);
      dy += sway * 0.55;
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

    // Bouncy spring squash animation (aligned with spring's rotated base axis)
    const bounceRem = worldFX.bounceTimers.get(key);
    if (bounceRem > 0) {
      const sq = Math.sin((bounceRem / 0.24) * Math.PI);
      const hShrink = sq * 4.5;
      const wGrow = sq * 2.5;
      const upVec = transformOrientVec(0, -1, orient);
      if (upVec.y > 0) {
        // Upside-down ceiling spring: anchored to top edge, squashes up into ceiling
        dx -= wGrow * 0.5;
        dw += wGrow;
        dh -= hShrink;
      } else if (upVec.x > 0) {
        // Right-facing wall spring: anchored to left edge, squashes left into wall
        dy -= wGrow * 0.5;
        dh += wGrow;
        dw -= hShrink;
      } else if (upVec.x < 0) {
        // Left-facing wall spring: anchored to right edge, squashes right into wall
        dy -= wGrow * 0.5;
        dh += wGrow;
        dx += hShrink;
        dw -= hShrink;
      } else {
        // Upright floor spring: anchored to bottom edge, squashes down into floor
        dx -= wGrow * 0.5;
        dw += wGrow;
        dy += hShrink;
        dh -= hShrink;
      }
    }

    // Build placement & smooth Undo/Redo pop-in animation
    const popKey = `${layer}:${key}`;
    const popEntry = worldFX.buildPops.get(popKey);
    let popGlow = null;
    if (popEntry !== undefined) {
      const startT = typeof popEntry === 'number' ? popEntry : popEntry.startUiTime;
      const dur = (typeof popEntry === 'object' && popEntry.duration) ? popEntry.duration : 0.17;
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
          // Crisp tactile elastic snap-in overshoot on tile stamp
          const c1 = 1.35;
          const c3 = c1 + 1;
          const easeBack = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
          sc = 0.74 + easeBack * 0.26;
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
      drawSnappedOrientedWorldImage(wCtx, canvas, dx, dy, dw, dh, orient, originX, originY, scale);
      wCtx.globalAlpha = 1;
    } else {
      drawSnappedOrientedWorldImage(wCtx, canvas, dx, dy, dw, dh, orient, originX, originY, scale);
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
  return hasInFront;
}

export function drawRuntimeEntities(world, alpha = 1, inFrontPass = false) {
  let hasInFront = false;
  // Patrolling DEADLY MOVING hazards (supports IN FRONT rendering order + orientation)
  for (const dm of runtime.deadlyMoving.values()) {
    const sp = getSpriteById(dm.id);
    if (!sp) continue;
    const isFront = Boolean(sp.harmOpts && sp.harmOpts.inFront);
    if (isFront) hasInFront = true;
    if (isFront !== inFrontPass) continue;
    const c = resolveTileFrameCanvas(sp, 'main', dm.key);
    if (!c) continue;
    const dmx = (dm.prevX !== undefined ? dm.prevX : dm.x) + (dm.x - (dm.prevX !== undefined ? dm.prevX : dm.x)) * alpha;
    const dmy = (dm.prevY !== undefined ? dm.prevY : dm.y) + (dm.y - (dm.prevY !== undefined ? dm.prevY : dm.y)) * alpha;
    drawOrientedCanvas(wCtx, c, dmx + TILE * 0.5, dmy + TILE * 0.5, TILE, TILE, dm.orient || 0);
  }
  if (inFrontPass) return hasInFront;

  // 1. MOVING platforms (smoothly interpolated between fixed physics steps)
  for (const m of runtime.moving.values()) {
    const sp = getSpriteById(m.id);
    if (!sp) continue;
    const c = resolveTileFrameCanvas(sp, 'main', m.key);
    if (!c) continue;
    const mx = (m.prevX !== undefined ? m.prevX : m.x) + (m.x - (m.prevX !== undefined ? m.prevX : m.x)) * alpha;
    const my = (m.prevY !== undefined ? m.prevY : m.y) + (m.y - (m.prevY !== undefined ? m.prevY : m.y)) * alpha;
    drawOrientedCanvas(wCtx, c, mx + TILE * 0.5, my + TILE * 0.5, TILE, TILE, m.orient || 0);
  }

  // 2. LIVING critters / NPCs (smoothly interpolated + gentle walk hop + organic CHANGING frames)
  for (const lv of runtime.living.values()) {
    const sp = getSpriteById(lv.id);
    if (!sp) continue;
    const c = (lv.subType === 'CHANGING' && sp._canvases && sp._canvases.length > 0)
      ? sp._canvases[(lv.frameIdx || 0) % sp._canvases.length]
      : resolveTileFrameCanvas(sp, 'main', lv.key);
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

  // 3. DYNAMIC crates, balls, heavy metal, wheels, thrusters & explosives
  for (const dyn of runtime.dynamics.values()) {
    if (dyn.exploded) continue;
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
    const dynTr = dyn.orient ? orientToTransform(dyn.orient) : null;
    const totalRot = rot + (dynTr ? dynTr.rot * Math.PI * 0.5 : 0);
    if (Math.abs(totalRot) > 0.004 || Math.abs(sx - 1) > 0.004 || Math.abs(sy - 1) > 0.004 || (dynTr && dynTr.flip)) {
      wCtx.save();
      wCtx.translate(dx + TILE * 0.5, dy + TILE);
      wCtx.scale(sx, sy);
      wCtx.translate(0, -TILE * 0.5);
      if (Math.abs(totalRot) > 0.004) wCtx.rotate(totalRot);
      if (dynTr && dynTr.flip) wCtx.scale(-1, 1);
      wCtx.drawImage(c, -TILE * 0.5, -TILE * 0.5, TILE, TILE);
      wCtx.restore();
    } else {
      wCtx.drawImage(c, dx, dy, TILE, TILE);
    }

    // Cyan pin corners on frozen mid-air DYNAMIC rigid bodies (People Playground style)
    if (dyn.frozen) {
      wCtx.save();
      wCtx.fillStyle = '#6fe6ff';
      wCtx.fillRect(dx, dy, 3, 1); wCtx.fillRect(dx, dy, 1, 3);
      wCtx.fillRect(dx + TILE - 3, dy, 3, 1); wCtx.fillRect(dx + TILE - 1, dy, 1, 3);
      wCtx.fillRect(dx, dy + TILE - 1, 3, 1); wCtx.fillRect(dx, dy + TILE - 3, 1, 3);
      wCtx.fillRect(dx + TILE - 3, dy + TILE - 1, 3, 1); wCtx.fillRect(dx + TILE - 1, dy + TILE - 3, 1, 3);
      wCtx.restore();
    }

    // Subtle grab-hand corner highlight when hovering or dragging a DYNAMIC object in PLAY mode
    const isGrabbed = Boolean(runtime.grabbedDyn && runtime.grabbedDyn.key === dyn.key);
    const isHovered = state.mode === 'PLAY' && runtime.hoverDynKey === dyn.key && !state.selectedSpriteId;
    if (isGrabbed || isHovered) {
      wCtx.save();
      wCtx.strokeStyle = isGrabbed ? '#ffb86b' : 'rgba(242, 140, 56, 0.78)';
      wCtx.lineWidth = (isGrabbed ? 1.5 : 1.0) / camera.zoom;
      wCtx.strokeRect(dx - 0.5, dy - 0.5, TILE + 1, TILE + 1);
      wCtx.restore();
    }
  }

  // 4. HOLDABLE emitter / aimable / thrower projectiles
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

  // 5. Active HOLDABLE (SWING LINE) grapple rope + anchor pin
  if (runtime.swingLine && !player.dead) {
    const sw = runtime.swingLine;
    const px = player.prevX + (player.x - player.prevX) * alpha + player.w * 0.5;
    const py = player.prevY + (player.y - player.prevY) * alpha + player.h * 0.42;
    wCtx.save();
    wCtx.strokeStyle = '#0d0e11';
    wCtx.lineWidth = 2.4 / camera.zoom;
    wCtx.beginPath();
    wCtx.moveTo(sw.ax, sw.ay);
    wCtx.lineTo(px, py);
    wCtx.stroke();
    wCtx.strokeStyle = '#f5e2cf';
    wCtx.lineWidth = 1.15 / camera.zoom;
    wCtx.beginPath();
    wCtx.moveTo(sw.ax, sw.ay);
    wCtx.lineTo(px, py);
    wCtx.stroke();
    wCtx.fillStyle = '#f28c38';
    wCtx.fillRect(sw.ax - 2, sw.ay - 2, 4, 4);
    wCtx.fillStyle = '#fff2de';
    wCtx.fillRect(sw.ax - 1, sw.ay - 1, 2, 2);
    wCtx.restore();
  }
  return hasInFront;
}

export function drawMachinesAndLinks(world, alpha, minTx, maxTx, minTy, maxTy) {
  const tAnim = state.mode === 'PLAY' ? state.simTime : state.uiTime;

  // 1. Extended ACTIVATOR (PISTON) hydraulic rods + CONVEYOR chevrons + live signal LEDs (O(machines) cached list!)
  const overlays = runtime.machineOverlays;
  if (overlays.length > 0) {
    wCtx.save();
    for (let i = 0; i < overlays.length; i++) {
      const m = overlays[i];
      const tx = m.tx;
      const ty = m.ty;
      if (tx < minTx - 2 || tx > maxTx + 2 || ty < minTy - 2 || ty > maxTy + 2) continue;
      const key = m.key;
      const orient = m.orient || 0;

      if (m.type === 'PUSHING' && m.subType === 'CONVEYOR') {
        const cv = transformOrientVec(1, 0, orient);
        const scroll = ((tAnim * 24) % 6 + 6) % 6;
        wCtx.fillStyle = 'rgba(242, 140, 56, 0.72)';
        const dir = cv.x >= 0 ? 1 : -1;
        for (let k = 0; k < 3; k++) {
          const px = tx * TILE + ((k * 6 + (dir > 0 ? scroll : (6 - scroll))) % (TILE - 3)) + 1;
          wCtx.fillRect(px, ty * TILE + 1, 2, 1.5);
        }
      } else if (m.type === 'ACTIVATOR') {
        if (m.subType === 'PISTON') {
          const pst = runtime.pistons.get(key);
          const ext = pst ? ((pst.prevExt || 0) + ((pst.ext || 0) - (pst.prevExt || 0)) * alpha) : 0;
          if (ext > 0.015) {
            const dir = transformOrientVec(0, -1, orient);
            const baseCx = tx * TILE + TILE * 0.5;
            const baseCy = ty * TILE + TILE * 0.5;
            const reach = ext * TILE;
            const headCx = baseCx + dir.x * reach;
            const headCy = baseCy + dir.y * reach;
            // Mechanical shaft
            wCtx.strokeStyle = '#0d0e11';
            wCtx.lineWidth = 5;
            wCtx.beginPath();
            wCtx.moveTo(baseCx, baseCy);
            wCtx.lineTo(headCx, headCy);
            wCtx.stroke();
            wCtx.strokeStyle = '#a5b0c4';
            wCtx.lineWidth = 3;
            wCtx.beginPath();
            wCtx.moveTo(baseCx, baseCy);
            wCtx.lineTo(headCx, headCy);
            wCtx.stroke();
            // Crisp pusher plate cap
            const horiz = Math.abs(dir.x) > 0.5;
            const pw = horiz ? 5 : TILE - 2;
            const ph = horiz ? TILE - 2 : 5;
            const px = headCx - pw * 0.5 + dir.x * (TILE * 0.5 - 2.5);
            const py = headCy - ph * 0.5 + dir.y * (TILE * 0.5 - 2.5);
            wCtx.fillStyle = '#0d0e11';
            wCtx.fillRect(px - 1, py - 1, pw + 2, ph + 2);
            wCtx.fillStyle = '#f28c38';
            wCtx.fillRect(px, py, pw, ph);
            wCtx.fillStyle = '#ffe1be';
            if (horiz) wCtx.fillRect(px + (dir.x > 0 ? pw - 1.5 : 0), py + 1, 1.5, ph - 2);
            else wCtx.fillRect(px + 1, py + (dir.y < 0 ? 0 : ph - 1.5), pw - 2, 1.5);
          }
        } else {
          const isOn = Boolean(
            runtime.activators.get(key) ||
            runtime.platePressed.has(key) ||
            runtime.timerOn.has(key) ||
            runtime.proxActive.has(key) ||
            runtime.gateOutputs.get(key)
          );
          wCtx.fillStyle = isOn ? '#f28c38' : '#3f4759';
          wCtx.fillRect(tx * TILE + TILE - 4, ty * TILE + 2, 2.5, 2.5);
          if (isOn) {
            wCtx.fillStyle = '#fff2de';
            wCtx.fillRect(tx * TILE + TILE - 3.5, ty * TILE + 2.5, 1.2, 1.2);
          }
        }
      }
    }
    wCtx.restore();
  }

  // 2. Physical Joints (ROPE, ROD, SPRING) - always visible in PLAY and BUILD!
  const joints = Array.isArray(world.joints) ? world.joints : [];
  if (joints.length > 0) {
    wCtx.save();
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i];
      const pa = getWireEndpointWorldCenter(world, j.a, alpha);
      const pb = getWireEndpointWorldCenter(world, j.b, alpha);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy) || 0.001;

      if (j.kind === 'ROD') {
        wCtx.strokeStyle = '#0d0e11';
        wCtx.lineWidth = 3.2 / camera.zoom;
        wCtx.beginPath(); wCtx.moveTo(pa.x, pa.y); wCtx.lineTo(pb.x, pb.y); wCtx.stroke();
        wCtx.strokeStyle = '#aeb9cc';
        wCtx.lineWidth = 1.6 / camera.zoom;
        wCtx.beginPath(); wCtx.moveTo(pa.x, pa.y); wCtx.lineTo(pb.x, pb.y); wCtx.stroke();
      } else if (j.kind === 'SPRING') {
        const coils = Math.max(5, Math.min(14, Math.round(j.len / 6)));
        const nx = -dy / dist;
        const ny = dx / dist;
        const amp = 2.6;
        wCtx.strokeStyle = '#8ec8f6';
        wCtx.lineWidth = 1.3 / camera.zoom;
        wCtx.beginPath();
        wCtx.moveTo(pa.x, pa.y);
        for (let k = 1; k < coils; k++) {
          const frac = k / coils;
          const side = (k % 2 === 0 ? 1 : -1) * amp;
          wCtx.lineTo(pa.x + dx * frac + nx * side, pa.y + dy * frac + ny * side);
        }
        wCtx.lineTo(pb.x, pb.y);
        wCtx.stroke();
      } else {
        // ROPE: slightly bowed sag when slack, crisp taut cable when pulled
        const slack = Math.max(0, (j.len || dist) - dist);
        const sag = Math.min(14, slack * 0.45);
        const mx = (pa.x + pb.x) * 0.5;
        const my = (pa.y + pb.y) * 0.5 + sag;
        wCtx.strokeStyle = '#0d0e11';
        wCtx.lineWidth = 2.4 / camera.zoom;
        wCtx.beginPath(); wCtx.moveTo(pa.x, pa.y); wCtx.quadraticCurveTo(mx, my, pb.x, pb.y); wCtx.stroke();
        wCtx.strokeStyle = '#dfc398';
        wCtx.lineWidth = 1.2 / camera.zoom;
        wCtx.beginPath(); wCtx.moveTo(pa.x, pa.y); wCtx.quadraticCurveTo(mx, my, pb.x, pb.y); wCtx.stroke();
      }

      // Rivet / anchor caps
      wCtx.fillStyle = j.kind === 'SPRING' ? '#8ec8f6' : (j.kind === 'ROD' ? '#e6eaf2' : '#f28c38');
      wCtx.fillRect(pa.x - 1.5, pa.y - 1.5, 3, 3);
      wCtx.fillRect(pb.x - 1.5, pb.y - 1.5, 3, 3);
    }
    wCtx.restore();
  }

  // 3. Signal Wires (hidden in normal BUILD & PLAY by default; shown ONLY in Blueprint WIRE mode or when Show Wires in PLAY is ON)
  const wires = Array.isArray(world.wires) ? world.wires : [];
  const bp = camera.blueprintAlpha || 0;
  const showPlayWires = state.mode === 'PLAY' && state.showWiresInPlay;
  if (wires.length > 0 && showPlayWires && bp <= 0.01) {
    wCtx.save();
    for (let i = 0; i < wires.length; i++) {
      const w = wires[i];
      const pa = getWireEndpointWorldCenter(world, w.from, alpha);
      const pb = getWireEndpointWorldCenter(world, w.to, alpha);
      if (!pa || !pb) continue;
      const curve = getWireCurvePoints(pa, pb);
      const active = runtime.poweredWires.has(i);
      const isInv = Boolean(w.invert);
      wCtx.globalAlpha = 0.56;
      wCtx.strokeStyle = '#0d0e11';
      wCtx.lineWidth = 2.4 / camera.zoom;
      wCtx.beginPath(); wCtx.moveTo(pa.x, pa.y); wCtx.quadraticCurveTo(curve.cx, curve.cy, pb.x, pb.y); wCtx.stroke();

      wCtx.strokeStyle = active ? (isInv ? '#ff6ea8' : '#f28c38') : '#4e607a';
      wCtx.lineWidth = (active ? 1.4 : 1.0) / camera.zoom;
      wCtx.beginPath(); wCtx.moveTo(pa.x, pa.y); wCtx.quadraticCurveTo(curve.cx, curve.cy, pb.x, pb.y); wCtx.stroke();

      if (active) {
        const pFrac = ((tAnim * 1.9 + i * 0.27) % 1 + 1) % 1;
        const omt = 1 - pFrac;
        const bx = omt * omt * pa.x + 2 * omt * pFrac * curve.cx + pFrac * pFrac * pb.x;
        const by = omt * omt * pa.y + 2 * omt * pFrac * curve.cy + pFrac * pFrac * pb.y;
        wCtx.globalAlpha = 0.95;
        wCtx.fillStyle = isInv ? '#ffe0ee' : '#fff4df';
        wCtx.fillRect(bx - 1.3, by - 1.3, 2.6, 2.6);
      }
    }
    wCtx.restore();
  }

  // 4. PLAY-mode Physics Grab Hand elastic tether line
  if (runtime.grabbedDyn && state.mode === 'PLAY') {
    const g = runtime.grabbedDyn;
    const dyn = runtime.dynamics.get(g.key);
    if (dyn && !dyn.exploded) {
      const dx = (dyn.prevX !== undefined ? dyn.prevX : dyn.x) + (dyn.x - (dyn.prevX !== undefined ? dyn.prevX : dyn.x)) * alpha;
      const dy = (dyn.prevY !== undefined ? dyn.prevY : dyn.y) + (dyn.y - (dyn.prevY !== undefined ? dyn.prevY : dyn.y)) * alpha;
      const gx = dx + g.offX;
      const gy = dy + g.offY;
      wCtx.save();
      wCtx.strokeStyle = 'rgba(242, 140, 56, 0.85)';
      wCtx.lineWidth = 1.4 / camera.zoom;
      wCtx.setLineDash([3 / camera.zoom, 2 / camera.zoom]);
      wCtx.beginPath();
      wCtx.moveTo(gx, gy);
      wCtx.lineTo(g.wx, g.wy);
      wCtx.stroke();
      wCtx.setLineDash([]);
      wCtx.fillStyle = '#fff4df';
      wCtx.fillRect(gx - 1.3, gy - 1.3, 2.6, 2.6);
      wCtx.fillStyle = '#f28c38';
      wCtx.fillRect(g.wx - 1.5, g.wy - 1.5, 3, 3);
      wCtx.restore();
    }
  }

  // 5. Expanding explosion / heavy-slam pixel shockwave rings
  if (runtime.shockwaves.length > 0) {
    wCtx.save();
    for (let i = 0; i < runtime.shockwaves.length; i++) {
      const sw = runtime.shockwaves[i];
      const rem = 1 - clamp(sw.timer / sw.maxTimer, 0, 1);
      wCtx.globalAlpha = rem * 0.85;
      wCtx.strokeStyle = sw.color || '#ffb86b';
      wCtx.lineWidth = Math.max(1, rem * 3.2) / camera.zoom;
      wCtx.beginPath();
      wCtx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
      wCtx.stroke();
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
  // When laying on a LAYABLE bed/object, automatically play a SLEEP/LAY motion if one exists
  if (player.laying) {
    const layMotion = findLayMotionSprite(state.sprites);
    if (layMotion && layMotion._canvases && layMotion._canvases.length > 0) {
      const idx = Math.floor(state.simTime * (layMotion.fps || 6)) % layMotion._canvases.length;
      return {
        canvas: layMotion._canvases[idx],
        blinkOverlay: null,
        flipClimb: false,
        size: layMotion.size,
        customLayMotion: true
      };
    }
  }

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
  } else if (player.laying) {
    // Fallback when no SLEEP/LAY motion exists: idle STAND sprite rotated 90 deg horizontally
    pose = 'STAND';
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

  // BLINK overlay is authored for STAND eye height (and closes eyes peacefully while laying/sleeping!)
  const shouldBlink = !player.dead && (pose === 'STAND') && (player.laying || player.blinkDur > 0 || state.windowUnfocused);
  const blinkList = sc.BLINK;
  const blinkOverlay = (shouldBlink && blinkList && blinkList.length > 0)
    ? blinkList[Math.floor(state.uiTime * getSpriteStateFps(sp, 'BLINK')) % blinkList.length]
    : null;

  return { canvas, blinkOverlay, flipClimb, size: sp.size, customLayMotion: false };
}

export function drawDefaultWireframe(ctx, w, h, facing, blinking, tintColor = null, sitting = false) {
  const topOff = sitting ? 3 : 0;
  const boxH = h - topOff;
  ctx.fillStyle = tintColor || 'rgba(230, 234, 242, 0.04)';
  ctx.fillRect(2, topOff + 2, w - 4, boxH - 4);

  ctx.strokeStyle = tintColor ? 'rgba(255, 255, 255, 0.62)' : 'rgba(230, 234, 242, 0.34)';
  ctx.lineWidth = 1;
  ctx.strokeRect(1.5, topOff + 1.5, w - 3, boxH - 3);

  // Minimal translucent eyes for facing/blink readability
  const eyeY = topOff + Math.round(boxH * 0.36);
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

export function triggerBodyAnim(kind, prevVis, slot = 'body') {
  const isGear = slot === 'wear' || slot === 'hold';
  const count = isGear ? 8 : 14;
  const palettes = {
    equip: ['#fff2de', '#ffd48c', '#f28c38'],
    swap: ['#fff2de', '#f28c38', '#8ec8f6'],
    unequip: ['#e2e9f5', '#a9c7e6', '#7a879e']
  };
  const cols = palettes[kind] || palettes.equip;
  const sparks = [];
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.32;
    const dist = (isGear ? 9 : 13) + Math.random() * (isGear ? 7 : 12);
    sparks.push({
      ang,
      dist,
      rise: kind === 'unequip' ? -(10 + Math.random() * 10) : -(4 + Math.random() * 8),
      size: i % 3 === 0 ? 1.8 : 1.3,
      delay: (i % 4) * 0.045,
      color: cols[i % cols.length]
    });
  }
  worldFX.bodyAnim = {
    kind,
    slot,
    startUiTime: state.uiTime,
    duration: isGear ? 0.28 : (kind === 'equip' ? 0.42 : 0.38),
    prev: prevVis || null,
    sparks
  };
  if (isGear) {
    if (kind === 'unequip') SFX.playDeselect();
    else SFX.playPickup();
  } else {
    SFX.playBodyEquip(kind !== 'unequip');
  }
}

export function drawPlayer(alpha) {
  const px = player.prevX + (player.x - player.prevX) * alpha;
  const py = player.prevY + (player.y - player.prevY) * alpha;
  const footCx = px + player.w * 0.5;
  const footY = py + player.h;

  const bodySp = state.equippedBodyId ? getSpriteById(state.equippedBodyId) : null;
  const wearSp = state.equippedWearableId ? getSpriteById(state.equippedWearableId) : null;
  const holdSp = state.equippedHoldableId ? getSpriteById(state.equippedHoldableId) : null;
  const resolved = (bodySp || state.activeMotionId || player.laying) ? resolveBodyPose(bodySp) : null;
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

  // Gentle swimming bob & stroke tilt (combined smoothly with hurt knockback tilt & laying/sleeping 90 deg rotation)
  if (player.inLiquid && player.swimming && runtime.hurtFlash <= 0) {
    wCtx.translate(0, Math.sin(player.swimCycle * 2) * 0.9);
  }
  const rotatedLay = player.laying && !(resolved && resolved.customLayMotion);
  if (rotatedLay) {
    // Rotate idle sprite horizontally 90 deg so character lies snugly on the bed / sleeping surface
    const breath = 1 + Math.sin(state.simTime * 2.2) * 0.018;
    wCtx.translate(0, -player.h * 0.34);
    wCtx.rotate(player.facing >= 0 ? -Math.PI * 0.5 : Math.PI * 0.5);
    wCtx.scale(breath, 1 / breath);
    wCtx.translate(0, drawDim * 0.5);
  } else {
    const bodyTilt = player.swimTilt + player.hurtAngle;
    if (Math.abs(bodyTilt) > 0.004) {
      wCtx.translate(0, -player.h * 0.5);
      wCtx.rotate(bodyTilt);
      wCtx.translate(0, player.h * 0.5);
    }
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

  // Body Equip / Swap / Unequip & Gear transformation choreography (real outgoing -> incoming transitions)
  let animScaleX = player.scaleX;
  let animScaleY = player.scaleY;
  let animLiftY = 0;
  let animAlpha = 1;
  let animTint = null;
  let showPrevBody = false;
  let prevBodyAlpha = 0;
  let prevBodyLiftY = 0;
  let prevBodyScaleX = 1;
  let prevBodyScaleY = 1;
  let prevBodyTint = null;
  let animProg = 1;
  let ba = worldFX.bodyAnim;

  if (ba) {
    animProg = clamp((state.uiTime - ba.startUiTime) / ba.duration, 0, 1);
    if (animProg >= 1) {
      worldFX.bodyAnim = null;
      ba = null;
    } else if (ba.slot === 'wear' || ba.slot === 'hold') {
      const pop = Math.sin(animProg * Math.PI);
      animScaleX *= 1 + pop * (ba.kind === 'unequip' ? 0.08 : -0.07);
      animScaleY *= 1 + pop * (ba.kind === 'unequip' ? -0.07 : 0.09);
      animLiftY = -pop * 1.4;
    } else if (ba.kind === 'swap' && ba.prev) {
      // Crisp 3D horizontal card-flip swap: old body spins edge-on (0..0.38), new body spins out with overshoot (0.38..1)
      if (animProg < 0.38) {
        const q = animProg / 0.38;
        showPrevBody = true;
        prevBodyScaleX = Math.max(0.05, Math.cos(q * Math.PI * 0.5));
        prevBodyScaleY = 1 + Math.sin(q * Math.PI) * 0.10;
        prevBodyLiftY = -Math.sin(q * Math.PI * 0.5) * 2.8;
        prevBodyAlpha = 1;
        prevBodyTint = q > 0.3 ? `rgba(255, 232, 185, ${clamp((q - 0.3) * 1.1, 0, 0.72)})` : null;
        animAlpha = 0;
      } else {
        const q = (animProg - 0.38) / 0.62;
        const c1 = 1.65;
        const c3 = c1 + 1;
        const easeBack = 1 + c3 * Math.pow(q - 1, 3) + c1 * Math.pow(q - 1, 2);
        animScaleX *= Math.max(0.06, easeBack);
        animScaleY *= 1 + Math.sin(q * Math.PI) * 0.12;
        animLiftY = -(1 - q) * (1 - q) * 2.8;
        if (q < 0.55) {
          animTint = `rgba(255, 224, 168, ${Math.pow(1 - q / 0.55, 2) * 0.68})`;
        }
      }
    } else if (ba.kind === 'equip') {
      // Wireframe contracts into golden light (0..0.30), then new Body materializes with joyful elastic hop (0.30..1)
      if (animProg < 0.30 && ba.prev) {
        const q = animProg / 0.30;
        showPrevBody = true;
        prevBodyScaleX = 1 - q * 0.34;
        prevBodyScaleY = 1 + q * 0.22;
        prevBodyLiftY = -q * 1.8;
        prevBodyAlpha = 1 - q * 0.25;
        prevBodyTint = `rgba(255, 218, 148, ${0.25 + q * 0.55})`;
        animAlpha = 0;
      } else {
        const q = ba.prev ? (animProg - 0.30) / 0.70 : animProg;
        const c1 = 1.85;
        const c3 = c1 + 1;
        const easeBack = 1 + c3 * Math.pow(q - 1, 3) + c1 * Math.pow(q - 1, 2);
        const bounce = Math.sin(q * Math.PI);
        animScaleX *= clamp(0.68 + easeBack * 0.32 + (q < 0.38 ? bounce * 0.14 : 0), 0.5, 1.32);
        animScaleY *= clamp(1.22 - easeBack * 0.22 - (q < 0.38 ? bounce * 0.12 : 0), 0.74, 1.32);
        animLiftY = -Math.sin(q * Math.PI) * 3.4;
        if (q < 0.62) {
          animTint = `rgba(255, 232, 185, ${Math.pow(1 - q / 0.62, 2) * 0.74})`;
        }
      }
    } else if (ba.kind === 'unequip') {
      // Outgoing Body dissolves cleanly upward into cool silvery pixel mist (0..0.46) while wireframe fades gently in
      if (animProg < 0.46 && ba.prev) {
        const q = animProg / 0.46;
        const ease = 1 - Math.pow(1 - q, 2);
        showPrevBody = true;
        prevBodyScaleX = 1 - ease * 0.24;
        prevBodyScaleY = 1 + ease * 0.16;
        prevBodyLiftY = -ease * 6.0;
        prevBodyAlpha = Math.pow(1 - q, 1.35);
        prevBodyTint = `rgba(176, 212, 245, ${0.18 + q * 0.64})`;
        animAlpha = clamp(q * 0.75, 0, 0.75);
        animScaleX *= 0.90 + q * 0.10;
        animScaleY *= 0.90 + q * 0.10;
      } else {
        const q = ba.prev ? (animProg - 0.46) / 0.54 : animProg;
        const pop = Math.sin(q * Math.PI);
        animAlpha = 0.75 + q * 0.25;
        animScaleX *= 1 + pop * 0.08;
        animScaleY *= 1 - pop * 0.07;
      }
    }
  }

  // Pixel-masked golden respawn shimmer blended cleanly onto sprite pixels (zero square artifacts)
  let respawnTint = null;
  if (player.respawnTimer > 0) {
    const rp = clamp(1 - player.respawnTimer / 0.42, 0, 1);
    respawnTint = `rgba(255, 226, 168, ${Math.pow(1 - rp, 2) * 0.64})`;
  }
  const effectiveCharTint = aliveFlashTint || animTint || respawnTint;

  // Draw current player body / wireframe (when visible during transform)
  if (animAlpha > 0.01) {
    wCtx.save();
    if (animLiftY !== 0) wCtx.translate(0, animLiftY);
    wCtx.scale(animScaleX, animScaleY);
    if (animAlpha < 0.999) wCtx.globalAlpha *= animAlpha;

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
      drawSpriteWithOptionalTint(wCtx, resolved.canvas, -drawDim * 0.5, -drawDim, drawDim, drawDim, effectiveCharTint);
      if (resolved.blinkOverlay) {
        drawSpriteWithOptionalTint(wCtx, resolved.blinkOverlay, -drawDim * 0.5, -drawDim, drawDim, drawDim, effectiveCharTint);
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
        player.laying || player.blinkDur > 0 || state.windowUnfocused || runtime.hurtFlash > 0,
        effectiveCharTint,
        player.sitting
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

    // Equipped HOLDABLE tool in front hand (AIMABLE smoothly tracks mouse cursor!)
    if (holdSp && holdSp._canvases && holdSp._canvases[0]) {
      const hIdx = Math.floor(state.uiTime * (holdSp.fps || 6)) % holdSp._canvases.length;
      const swing = runtime.holdSwingTimer > 0 ? Math.sin((runtime.holdSwingTimer / 0.22) * Math.PI) * 0.85 : 0;
      wCtx.save();
      if (holdSp.subType === 'AIMABLE' && state.mode === 'PLAY' && pointer.inWorld) {
        const wp = screenToWorld(pointer.screenX, pointer.screenY);
        const aimX = wp.wx - (player.x + player.w * 0.5);
        const aimY = wp.wy - (player.y + player.h * 0.5);
        const aimFlip = aimX < 0 ? -1 : 1;
        const localAng = Math.atan2(aimY, Math.abs(aimX));
        if (aimFlip < 0) wCtx.scale(-1, 1);
        wCtx.translate(drawDim * 0.34, -drawDim * 0.42);
        wCtx.rotate(localAng - swing * 0.35);
        wCtx.drawImage(holdSp._canvases[hIdx], -holdSp.size * 0.35, -holdSp.size * 0.5, holdSp.size, holdSp.size);
      } else {
        if (player.facing < 0) wCtx.scale(-1, 1);
        wCtx.translate(drawDim * 0.34, -drawDim * 0.42);
        if (swing !== 0) wCtx.rotate(swing);
        wCtx.drawImage(holdSp._canvases[hIdx], -holdSp.size * 0.35, -holdSp.size * 0.65, holdSp.size, holdSp.size);
      }
      wCtx.restore();
    }

    wCtx.restore();
  }

  // Draw outgoing previous body / wireframe cleanly during Phase 1 of equip / swap / unequip
  if (showPrevBody && ba && ba.prev && prevBodyAlpha > 0.01) {
    const pv = ba.prev;
    const pDim = pv.size || TILE;
    wCtx.save();
    wCtx.globalAlpha *= prevBodyAlpha;
    if (prevBodyLiftY !== 0) wCtx.translate(0, prevBodyLiftY);
    wCtx.scale(prevBodyScaleX, prevBodyScaleY);
    if (!pv.isWireframe && pv.canvas) {
      if (player.facing < 0) wCtx.scale(-1, 1);
      drawSpriteWithOptionalTint(wCtx, pv.canvas, -pDim * 0.5, -pDim, pDim, pDim, prevBodyTint);
    } else {
      wCtx.translate(-TILE * 0.5, -TILE);
      drawDefaultWireframe(wCtx, TILE, TILE, player.facing, false, prevBodyTint);
    }
    wCtx.restore();
  }

  // Crisp foot-level respawn ring + rising golden pixel motes on spawn / revival
  if (player.respawnTimer > 0) {
    const rp = clamp(1 - player.respawnTimer / 0.42, 0, 1);
    const ease = 1 - Math.pow(1 - rp, 3);
    const fade = (1 - rp) * (1 - rp);
    wCtx.save();
    const ringW = 6 + ease * (drawDim * 1.15);
    wCtx.globalAlpha = fade * 0.82;
    wCtx.fillStyle = '#ffd59a';
    wCtx.fillRect(-ringW * 0.5, -1.2, ringW, 1.4);
    wCtx.fillStyle = '#fff6e4';
    wCtx.fillRect(-ringW * 0.28, -1.2, ringW * 0.56, 1.0);
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI * 2 * i) / 6 + rp * 0.8;
      const rad = (drawDim * 0.22) + ease * 7;
      const mx = Math.cos(ang) * rad;
      const my = -2 - ease * (drawDim * 0.85 + (i % 3) * 3.5);
      wCtx.globalAlpha = fade * 0.9;
      wCtx.fillStyle = i % 2 === 0 ? '#ffd59a' : '#ffffff';
      wCtx.fillRect(mx - 0.7, my - 0.7, 1.4, 1.4);
    }
    wCtx.restore();
  }

  // Crisp ground ring & eased pixel motes for Body / Gear equip, swap, and unequip
  if (ba) {
    const p = animProg;
    const isUnequip = ba.kind === 'unequip';
    const isGear = ba.slot === 'wear' || ba.slot === 'hold';
    const originY = ba.slot === 'hold'
      ? -drawDim * 0.44
      : (ba.slot === 'wear' && wearSp && wearSp.subType === 'HAT' ? -drawDim * 0.92 : -drawDim * 0.48);
    const originX = ba.slot === 'hold' ? player.facing * drawDim * 0.34 : 0;

    wCtx.save();
    // Subtle ground aura pulse at the character's feet (body transitions only — zero harsh floating scanbar!)
    if (!isGear) {
      const ringP = ba.kind === 'equip' ? clamp((p - 0.24) / 0.76, 0, 1) : p;
      if (ringP > 0 && ringP < 1) {
        const rEase = 1 - Math.pow(1 - ringP, 3);
        const rFade = (1 - ringP) * (1 - ringP);
        const rw = 5 + rEase * (drawDim * 1.08);
        wCtx.globalAlpha = rFade * 0.78;
        wCtx.fillStyle = isUnequip ? '#a9c7e6' : '#f28c38';
        wCtx.fillRect(-rw * 0.5, -1.2, rw, 1.4);
        wCtx.fillStyle = isUnequip ? '#e2e9f5' : '#fff2de';
        wCtx.fillRect(-rw * 0.25, -1.2, rw * 0.5, 1.0);
      }
    }

    // Eased pixel motes blossoming cleanly around the character silhouette
    const moteStart = (ba.kind === 'equip' && ba.prev) ? 0.26 : (ba.kind === 'swap' ? 0.34 : 0.04);
    for (let i = 0; i < ba.sparks.length; i++) {
      const spk = ba.sparks[i];
      const spP = clamp((p - moteStart - (spk.delay || 0)) / Math.max(0.18, 1 - moteStart - (spk.delay || 0)), 0, 1);
      if (spP <= 0 || spP >= 1) continue;
      const ease = 1 - Math.pow(1 - spP, 3);
      const fade = (1 - spP) * (1 - spP);
      const swirl = (ba.kind === 'swap' ? 0.45 : 0.18) * ease;
      const mx = originX + Math.cos(spk.ang + swirl) * spk.dist * ease;
      const my = originY + Math.sin(spk.ang + swirl) * spk.dist * 0.72 * ease + spk.rise * ease;
      const sz = spk.size * (1 - spP * 0.35);
      wCtx.globalAlpha = fade * 0.94;
      wCtx.fillStyle = spk.color;
      wCtx.fillRect(mx - sz * 0.5, my - sz * 0.5, sz, sz);
    }
    wCtx.restore();
  }

  wCtx.restore();
}

export function drawWorldFX() {
  const invZ = 1 / camera.zoom;

  // 1. Build dissolve & smooth Undo/Redo vanish tiles (crisp micro-tilt crumble + corner brackets, zero harsh border box)
  if (worldFX.buildDissolves.length > 0) {
    wCtx.save();
    wCtx.imageSmoothingEnabled = false;
    wCtx.lineWidth = 1.2 * invZ;
    for (let i = worldFX.buildDissolves.length - 1; i >= 0; i--) {
      const d = worldFX.buildDissolves[i];
      const dur = d.duration || 0.21;
      const p = (state.uiTime - d.startUiTime) / dur;
      if (p >= 1) {
        worldFX.buildDissolves.splice(i, 1);
        continue;
      }
      const cx = d.tx * TILE + TILE * 0.5;
      const cy = d.ty * TILE + TILE * 0.5;
      if (p < 0) {
        // Hold outgoing sprite smoothly until its staggered wave slice starts shrinking
        if (d.canvas) {
          wCtx.globalAlpha = 0.92;
          drawOrientedCanvas(wCtx, d.canvas, cx, cy, TILE, TILE, d.orient || 0);
        }
        continue;
      }
      const easeOut = 1 - Math.pow(1 - p, 3);
      const easeIn = p * p * p;
      const fade = Math.pow(1 - p, 1.5);
      const isErase = d.kind === 'erase';
      if (d.canvas) {
        const popBump = p < 0.2 ? Math.sin((p / 0.2) * Math.PI * 0.5) * 0.08 : 0;
        const sc = Math.max(0.12, (1 + popBump) * (1 - easeIn * 0.84));
        const sz = TILE * sc;
        const tilt = isErase ? ((((d.tx * 7 + d.ty * 13) & 1) ? 1 : -1) * easeIn * 0.22) : 0;
        const dropY = isErase ? easeIn * 2.5 : 0;
        wCtx.globalAlpha = fade * 0.94;
        if (Math.abs(tilt) > 0.002) {
          const oTr = orientToTransform(d.orient || 0);
          drawAnimatedBrushSprite(wCtx, d.canvas, cx, cy + dropY, sz, oTr.rot * Math.PI * 0.5 + tilt, oTr.flip ? -1 : 1, 1);
        } else {
          drawOrientedCanvas(wCtx, d.canvas, cx, cy + dropY, sz, sz, d.orient || 0);
        }
        if (isErase) {
          // 4 tiny crisp pixel crumbs popping outward in the erased block's dominant colors
          wCtx.globalAlpha = fade * 0.88;
          const colA = d.color || '#d8a557';
          const colB = d.secondaryColor || colA;
          for (let c = 0; c < 4; c++) {
            const ang = Math.PI * 0.25 + c * Math.PI * 0.5 + ((d.tx + d.ty) & 3) * 0.18;
            const dist = 3.5 + easeOut * 6.5;
            const px = cx + Math.cos(ang) * dist;
            const py = cy + Math.sin(ang) * dist + p * p * 3.2;
            wCtx.fillStyle = (c & 1) === 0 ? colA : colB;
            wCtx.fillRect(px - 0.75, py - 0.75, 1.5, 1.5);
          }
        } else {
          // Clean corner brackets for Undo/Redo dissolve
          wCtx.globalAlpha = fade * 0.65;
          wCtx.strokeStyle = d.color || '#8ec8f6';
          drawPixelBrackets(wCtx, cx - sz * 0.5, cy - sz * 0.5, sz, sz, Math.max(2, sz * 0.24));
        }
      } else {
        const pad = easeOut * 4;
        wCtx.globalAlpha = fade * 0.8;
        wCtx.strokeStyle = d.color || '#cf5959';
        drawPixelBrackets(wCtx, d.tx * TILE + pad, d.ty * TILE + pad, Math.max(2, TILE - pad * 2), Math.max(2, TILE - pad * 2), 3.5);
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

      // Main crisp expanding waterline wave (tinted to the liquid's dominant color)
      wCtx.globalAlpha = alpha * 0.9;
      wCtx.fillStyle = r.waveColor || '#e4f7ff';
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
        wCtx.fillStyle = r.crownColor || '#d6f2ff';
        wCtx.fillRect(r.x - cw - 1, r.y - ch, 1.5, ch);
        wCtx.fillRect(r.x + cw - 0.5, r.y - ch, 1.5, ch);
        wCtx.fillRect(r.x - cw * 0.45, r.y - ch * 0.7, 1.5, ch * 0.7);
        wCtx.fillRect(r.x + cw * 0.45 - 1, r.y - ch * 0.7, 1.5, ch * 0.7);
      }
    }
    wCtx.restore();
  }

  // 3. Spacebar interact radial pulse (crisp expanding pixel corner brackets + cardinal glints)
  if (worldFX.interactRings.length > 0) {
    wCtx.save();
    wCtx.lineWidth = 1.25 * invZ;
    for (let i = 0; i < worldFX.interactRings.length; i++) {
      const r = worldFX.interactRings[i];
      const p = clamp(r.timer / r.maxTimer, 0, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const fade = (1 - p) * (1 - p);
      const half = 6 + ease * 17;
      wCtx.strokeStyle = '#f28c38';
      wCtx.globalAlpha = fade * 0.9;
      drawPixelBrackets(wCtx, r.x - half, r.y - half, half * 2, half * 2, 4.5 + ease * 2);
      // 4 crisp cardinal pixel glints
      wCtx.fillStyle = '#ffdcb0';
      wCtx.globalAlpha = fade * 0.85;
      const gr = half + 1.5;
      wCtx.fillRect(r.x - 0.75, r.y - gr - 0.75, 1.5, 1.5);
      wCtx.fillRect(r.x - 0.75, r.y + gr - 0.75, 1.5, 1.5);
      wCtx.fillRect(r.x - gr - 0.75, r.y - 0.75, 1.5, 1.5);
      wCtx.fillRect(r.x + gr - 0.75, r.y - 0.75, 1.5, 1.5);
    }
    wCtx.restore();
  }

  // 4. World pixel particles (dust, splashes, bubbles, bounce sparks — single batched save/restore)
  if (worldFX.particles.length > 0) {
    wCtx.save();
    for (let i = 0; i < worldFX.particles.length; i++) {
      const pt = worldFX.particles[i];
      wCtx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
      if (pt.zzz) {
        // Tiny crisp 3x4 pixel 'Z' sleep mote floating up from sleeping characters
        const zx = Math.round(pt.x);
        const zy = Math.round(pt.y);
        wCtx.fillStyle = pt.color || '#c9e4ff';
        wCtx.fillRect(zx - 1.5, zy - 2, 3, 0.9);
        wCtx.fillRect(zx + 0.3, zy - 1.1, 1.1, 0.9);
        wCtx.fillRect(zx - 0.8, zy - 0.2, 1.2, 0.9);
        wCtx.fillRect(zx - 1.5, zy + 0.7, 3, 0.9);
      } else if (pt.bubble) {
        const baseA = clamp(pt.life / pt.maxLife, 0, 1);
        wCtx.globalAlpha = baseA * 0.55;
        wCtx.fillStyle = pt.color || '#7ec3e8';
        wCtx.fillRect(pt.x - pt.size * 0.5, pt.y - pt.size * 0.5, pt.size, pt.size);
        wCtx.globalAlpha = baseA;
        wCtx.fillStyle = pt.highlight || '#eef9ff';
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
  if (camera.blueprintAlpha > 0.5) return;
  const alpha = camera.gridAlpha * camera.gridCursorAlpha * (1 - camera.blueprintAlpha);
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
  if (state.mode !== 'BUILD' || camera.gridAlpha < 0.02) return;
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

/* =========================================================================
   ARCHITECTURAL BLUEPRINT SCHEMATIC OVERLAY (ACTIVE ONLY IN WIRE TOOL)
   Transforms the viewport into a crisp blueprint table displaying drafting
   grids, machine/logic IN & OUT connector pins, sensor rings, and live
   interactive wires. Smoothly fades out & hides everything when off WIRE.
   ========================================================================= */
function drawBlueprintOverlay(world, alpha, minTx, maxTx, minTy, maxTy) {
  const bp = camera.blueprintAlpha || 0;
  if (bp <= 0.004) return;

  const invZ = 1 / Math.max(0.5, camera.zoom);
  const tAnim = state.uiTime;
  const topLeft = screenToWorld(0, 0);
  const botRight = screenToWorld(viewport.width, viewport.height);

  wCtx.save();

  // 1. Deep architectural blueprint wash over the world canvas
  wCtx.fillStyle = `rgba(6, 23, 47, ${0.74 * bp})`;
  wCtx.fillRect(topLeft.wx - TILE, topLeft.wy - TILE, (botRight.wx - topLeft.wx) + TILE * 2, (botRight.wy - topLeft.wy) + TILE * 2);

  // 2. Full-viewport Blueprint Drafting Grid (1-tile fine + 4-tile major + crosshairs)
  const gMinX = Math.floor(topLeft.wx / TILE) - 1;
  const gMaxX = Math.ceil(botRight.wx / TILE) + 1;
  const gMinY = Math.floor(topLeft.wy / TILE) - 1;
  const gMaxY = Math.ceil(botRight.wy / TILE) + 1;

  wCtx.strokeStyle = `rgba(88, 194, 255, ${0.15 * bp})`;
  wCtx.lineWidth = invZ;
  wCtx.beginPath();
  for (let gx = gMinX; gx <= gMaxX; gx++) {
    if (gx % 4 === 0) continue;
    const wx = gx * TILE;
    wCtx.moveTo(wx, gMinY * TILE);
    wCtx.lineTo(wx, gMaxY * TILE);
  }
  for (let gy = gMinY; gy <= gMaxY; gy++) {
    if (gy % 4 === 0) continue;
    const wy = gy * TILE;
    wCtx.moveTo(gMinX * TILE, wy);
    wCtx.lineTo(gMaxX * TILE, wy);
  }
  wCtx.stroke();

  wCtx.strokeStyle = `rgba(126, 218, 255, ${0.32 * bp})`;
  wCtx.lineWidth = 1.15 * invZ;
  wCtx.beginPath();
  for (let gx = gMinX; gx <= gMaxX; gx++) {
    if (gx % 4 !== 0) continue;
    const wx = gx * TILE;
    wCtx.moveTo(wx, gMinY * TILE);
    wCtx.lineTo(wx, gMaxY * TILE);
  }
  for (let gy = gMinY; gy <= gMaxY; gy++) {
    if (gy % 4 !== 0) continue;
    const wy = gy * TILE;
    wCtx.moveTo(gMinX * TILE, wy);
    wCtx.lineTo(gMaxX * TILE, wy);
  }
  wCtx.stroke();

  // 3. Highlight every wireable node with Blueprint frame, IN/OUT sockets, sensor rings & badges
  const dragKey = pointer.wireStartKey || pointer.wirePickKey;
  let dragInfo = null;
  if (dragKey) {
    const dSep = dragKey.indexOf(',');
    if (dSep > 0) {
      dragInfo = getMainTileInfo(world, parseInt(dragKey.slice(0, dSep), 10), parseInt(dragKey.slice(dSep + 1), 10));
    }
  }
  const dragCanOut = isWireSourceInfo(dragInfo);
  const dragCanIn = isWireTargetInfo(dragInfo);

  const hoverWire = (pointer.hoverWireIdx >= 0 && Array.isArray(world.wires))
    ? world.wires[pointer.hoverWireIdx]
    : null;

  const mainMap = (world.layers && world.layers.main) || {};
  const visibleNodes = [];

  for (const key in mainMap) {
    const id = mainMap[key];
    if (!id || id === STARTER_TILE_ID) continue;
    const pt = parseTileKey(key);
    if (!pt) continue;
    const tx = pt.tx;
    const ty = pt.ty;
    if (tx < minTx - 2 || tx > maxTx + 2 || ty < minTy - 2 || ty > maxTy + 2) continue;
    const info = getMainTileInfo(world, tx, ty);
    const meta = getWireNodeMeta(info);
    if (!meta) continue;

    const dyn = runtime.dynamics.get(key);
    const nx = (dyn && !dyn.exploded) ? dyn.x : (tx * TILE);
    const ny = (dyn && !dyn.exploded) ? dyn.y : (ty * TILE);
    const outOn = Boolean(
      runtime.activators.get(key) ||
      runtime.platePressed.has(key) ||
      runtime.timerOn.has(key) ||
      runtime.proxActive.has(key) ||
      (runtime.interactFrames.get(key) || 0) > 0 ||
      runtime.gateOutputs.get(key)
    );
    const inOn = runtime.poweredTargets.has(key);
    const isLit = outOn || inOn;
    const isDragStart = key === dragKey;
    const isCompatTarget = Boolean(
      dragKey && key !== dragKey &&
      ((dragCanOut && meta.canIn) || (dragCanIn && meta.canOut))
    );
    const isHoverWireEnd = Boolean(hoverWire && (hoverWire.from === key || hoverWire.to === key));

    visibleNodes.push({ key, tx, ty, nx, ny, info, meta, outOn, inOn, isLit, isDragStart, isCompatTarget, isHoverWireEnd });
  }

  // Pass 3a: PROXIMITY sensor rings beneath nodes
  for (let i = 0; i < visibleNodes.length; i++) {
    const n = visibleNodes[i];
    if (n.info.type === 'ACTIVATOR' && n.info.subType === 'PROXIMITY') {
      const rng = ((n.info.sp && n.info.sp.actOpts && n.info.sp.actOpts.range) || 4) * TILE;
      const cx = n.nx + TILE * 0.5;
      const cy = n.ny + TILE * 0.5;
      wCtx.save();
      wCtx.globalAlpha = bp * (n.outOn ? 0.85 : 0.48);
      wCtx.strokeStyle = n.outOn ? '#ffb85c' : '#56c7ff';
      wCtx.lineWidth = 1.15 * invZ;
      wCtx.setLineDash([4 * invZ, 3 * invZ]);
      wCtx.beginPath();
      wCtx.arc(cx, cy, rng, 0, Math.PI * 2);
      wCtx.stroke();
      wCtx.fillStyle = n.outOn ? 'rgba(255, 184, 92, 0.08)' : 'rgba(86, 199, 255, 0.05)';
      wCtx.fill();
      wCtx.restore();
    }
  }

  // Pass 3b: Node blueprint frames, subtle highlight fills & IN / OUT connector sockets
  for (let i = 0; i < visibleNodes.length; i++) {
    const n = visibleNodes[i];
    const roleCol = n.meta.role === 'SRC' ? '#ffba5a' : (n.meta.role === 'GATE' ? '#c59bff' : '#58d4ff');
    const borderCol = n.isDragStart
      ? '#ffffff'
      : (n.isHoverWireEnd ? '#ffe6a3' : (n.isLit ? '#66f2a8' : roleCol));

    wCtx.globalAlpha = bp * (n.isLit ? 0.24 : 0.14);
    wCtx.fillStyle = borderCol;
    wCtx.fillRect(n.nx, n.ny, TILE, TILE);

    wCtx.globalAlpha = bp * (n.isCompatTarget ? (0.72 + Math.sin(tAnim * 9) * 0.24) : 0.94);
    wCtx.strokeStyle = n.isCompatTarget ? '#7ef2ff' : borderCol;
    wCtx.lineWidth = ((n.isDragStart || n.isCompatTarget || n.isHoverWireEnd) ? 1.8 : 1.25) * invZ;
    wCtx.strokeRect(n.nx + 0.5, n.ny + 0.5, TILE - 1, TILE - 1);

    // Left IN connector socket
    if (n.meta.canIn) {
      const px = n.nx;
      const py = n.ny + TILE * 0.5;
      wCtx.globalAlpha = bp;
      wCtx.fillStyle = '#07172d';
      wCtx.fillRect(px - 2.6, py - 2.6, 5.2, 5.2);
      wCtx.fillStyle = n.inOn ? '#66f2a8' : '#58d4ff';
      wCtx.fillRect(px - 1.7, py - 1.7, 3.4, 3.4);
    }

    // Right OUT connector socket
    if (n.meta.canOut) {
      const px = n.nx + TILE;
      const py = n.ny + TILE * 0.5;
      wCtx.globalAlpha = bp;
      wCtx.fillStyle = '#07172d';
      wCtx.fillRect(px - 2.6, py - 2.6, 5.2, 5.2);
      wCtx.fillStyle = n.outOn ? '#ffdf85' : '#ff9d42';
      wCtx.fillRect(px - 1.7, py - 1.7, 3.4, 3.4);
    }
  }

  // 4. Crisp Blueprint Circuit Wires (curved traces, directional chevrons, pulse beads & clickable midpoint badges)
  const wires = Array.isArray(world.wires) ? world.wires : [];
  for (let i = 0; i < wires.length; i++) {
    const w = wires[i];
    const pa = getWireEndpointWorldCenter(world, w.from, alpha);
    const pb = getWireEndpointWorldCenter(world, w.to, alpha);
    if (!pa || !pb) continue;
    const curve = getWireCurvePoints(pa, pb);
    const isHov = pointer.hoverWireIdx === i;
    const isInv = Boolean(w.invert);
    const active = runtime.poweredWires.has(i);

    const strokeCol = isHov
      ? '#ffffff'
      : (active ? (isInv ? '#ff70b0' : '#ffba52') : (isInv ? '#b85086' : '#52b8f2'));

    // Dark blueprint casing for razor contrast over bright sprites
    wCtx.globalAlpha = bp * (isHov ? 0.96 : 0.86);
    wCtx.strokeStyle = '#061529';
    wCtx.lineWidth = (isHov ? 4.4 : 3.2) * invZ;
    wCtx.beginPath();
    wCtx.moveTo(pa.x, pa.y);
    wCtx.quadraticCurveTo(curve.cx, curve.cy, pb.x, pb.y);
    wCtx.stroke();

    // Main blueprint signal trace
    wCtx.globalAlpha = bp * (isHov || active ? 1 : 0.85);
    wCtx.strokeStyle = strokeCol;
    wCtx.lineWidth = (isHov ? 2.2 : (active ? 1.85 : 1.35)) * invZ;
    if (isInv) wCtx.setLineDash([4.5 * invZ, 2.5 * invZ]);
    wCtx.beginPath();
    wCtx.moveTo(pa.x, pa.y);
    wCtx.quadraticCurveTo(curve.cx, curve.cy, pb.x, pb.y);
    wCtx.stroke();
    wCtx.setLineDash([]);

    // Traveling luminous pulse beads when live signal flows
    if (active) {
      for (let b = 0; b < 2; b++) {
        const pFrac = ((tAnim * 1.35 + i * 0.23 + b * 0.5) % 1 + 1) % 1;
        const omt = 1 - pFrac;
        const bx = omt * omt * pa.x + 2 * omt * pFrac * curve.cx + pFrac * pFrac * pb.x;
        const by = omt * omt * pa.y + 2 * omt * pFrac * curve.cy + pFrac * pFrac * pb.y;
        wCtx.globalAlpha = bp;
        wCtx.fillStyle = isInv ? '#ffe3f1' : '#fff8e2';
        wCtx.fillRect(bx - 1.5, by - 1.5, 3, 3);
      }
    }

    // Directional arrowhead at t = 0.68 along curve
    const tArr = 0.68;
    const omtA = 1 - tArr;
    const ax = omtA * omtA * pa.x + 2 * omtA * tArr * curve.cx + tArr * tArr * pb.x;
    const ay = omtA * omtA * pa.y + 2 * omtA * tArr * curve.cy + tArr * tArr * pb.y;
    const txDir = 2 * omtA * (curve.cx - pa.x) + 2 * tArr * (pb.x - curve.cx);
    const tyDir = 2 * omtA * (curve.cy - pa.y) + 2 * tArr * (pb.y - curve.cy);
    const ang = Math.atan2(tyDir, txDir);
    const aSz = 3.2;
    wCtx.globalAlpha = bp;
    wCtx.fillStyle = strokeCol;
    wCtx.beginPath();
    wCtx.moveTo(ax + Math.cos(ang) * aSz, ay + Math.sin(ang) * aSz);
    wCtx.lineTo(ax + Math.cos(ang + 2.45) * aSz, ay + Math.sin(ang + 2.45) * aSz);
    wCtx.lineTo(ax + Math.cos(ang - 2.45) * aSz, ay + Math.sin(ang - 2.45) * aSz);
    wCtx.closePath();
    wCtx.fill();

    // Midpoint interactive node chip (shows '!' when inverted or glowing dot on hover)
    if (isInv || isHov) {
      wCtx.globalAlpha = bp;
      const chipR = isInv ? 3.8 : 2.8;
      wCtx.fillStyle = isInv ? '#4e1939' : '#0b294c';
      wCtx.fillRect(curve.mx - chipR, curve.my - chipR, chipR * 2, chipR * 2);
      wCtx.strokeStyle = isInv ? '#ff70b0' : '#ffffff';
      wCtx.lineWidth = invZ;
      wCtx.strokeRect(curve.mx - chipR, curve.my - chipR, chipR * 2, chipR * 2);
      if (isInv) {
        wCtx.fillStyle = '#ffe5f2';
        wCtx.fillRect(curve.mx - 0.6, curve.my - 2.4, 1.2, 2.8);
        wCtx.fillRect(curve.mx - 0.6, curve.my + 1.2, 1.2, 1.2);
      }
    }
  }

  // Pass 3c: Crisp miniature uppercase node tags above each wireable block
  if (camera.zoom >= 1.6) {
    wCtx.textAlign = 'center';
    wCtx.textBaseline = 'middle';
    const fontPx = Math.max(4.5, Math.min(6.2, 10.5 * invZ));
    wCtx.font = `bold ${fontPx.toFixed(1)}px "Perfect DOS VGA 437", monospace`;
    for (let i = 0; i < visibleNodes.length; i++) {
      const n = visibleNodes[i];
      let label = n.meta.tag;
      if (n.info.type === 'ACTIVATOR' && n.info.subType === 'OR / RELAY') {
        const dly = n.info.sp && n.info.sp.actOpts && n.info.sp.actOpts.delay;
        if (dly > 0) label = `DLY ${dly}S`;
      }
      const tw = wCtx.measureText(label).width + 4;
      const th = fontPx + 2.5;
      const bx = n.nx + TILE * 0.5;
      const by = n.ny - th * 0.5 - 1.5;
      wCtx.globalAlpha = bp * 0.92;
      wCtx.fillStyle = '#071b36';
      wCtx.fillRect(bx - tw * 0.5, by - th * 0.5, tw, th);
      wCtx.strokeStyle = n.isLit ? '#66f2a8' : '#4fb7f2';
      wCtx.lineWidth = 0.85 * invZ;
      wCtx.strokeRect(bx - tw * 0.5, by - th * 0.5, tw, th);
      wCtx.fillStyle = n.isLit ? '#baffd8' : '#d6f1ff';
      wCtx.fillText(label, bx, by + 0.3);
    }
  }

  wCtx.restore();
}

function drawBlueprintScreenFrame() {
  const bp = camera.blueprintAlpha || 0;
  if (bp <= 0.004) return;
  const pad = 10;
  const len = 18;
  const sideW = state.menusHidden ? 0 : (window.innerWidth <= 760 ? 206 : 264);
  const topH = state.menusHidden ? 0 : 40;
  const x0 = pad;
  const y0 = topH + pad;
  const x1 = Math.max(x0 + 40, viewport.width - sideW - pad);
  const y1 = Math.max(y0 + 40, viewport.height - pad);

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  wCtx.globalAlpha = bp * 0.65;
  wCtx.strokeStyle = '#56c7ff';
  wCtx.lineWidth = 1.5;
  wCtx.beginPath();
  // Top-left
  wCtx.moveTo(x0, y0 + len); wCtx.lineTo(x0, y0); wCtx.lineTo(x0 + len, y0);
  // Top-right
  wCtx.moveTo(x1 - len, y0); wCtx.lineTo(x1, y0); wCtx.lineTo(x1, y0 + len);
  // Bottom-left
  wCtx.moveTo(x0, y1 - len); wCtx.lineTo(x0, y1); wCtx.lineTo(x0 + len, y1);
  // Bottom-right
  wCtx.moveTo(x1 - len, y1); wCtx.lineTo(x1, y1); wCtx.lineTo(x1, y1 - len);
  wCtx.stroke();
  wCtx.restore();
}

export function drawBrushPreview() {
  if (!pointer.inWorld || isAnyModalOpen()) return;
  const playQuickEdit = state.mode === 'PLAY' && (Boolean(state.selectedSpriteId) || pointer.ctrlKey || pointer.action === 'erase');
  if (state.mode !== 'BUILD' && !playQuickEdit) return;
  if (pointer.action === 'pan') return;

  // Smoothly animate held brush rotation & horizontal card flip
  const anim = state.brushAnim;
  const dtUi = clamp(state.uiTime - (anim.lastUiTime || state.uiTime), 0, 0.05);
  anim.lastUiTime = state.uiTime;
  const rotK = 1 - Math.exp(-22 * dtUi);
  anim.angle += (anim.targetAngle - anim.angle) * rotK;
  if (Math.abs(anim.targetAngle - anim.angle) < 0.002) anim.angle = anim.targetAngle;
  const flipK = 1 - Math.exp(-20 * dtUi);
  anim.scaleX += (anim.targetScaleX - anim.scaleX) * flipK;
  if (Math.abs(anim.targetScaleX - anim.scaleX) < 0.004) anim.scaleX = anim.targetScaleX;

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
      drawAnimatedBrushSprite(wCtx, meta.canvas, tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, TILE, anim.angle, anim.scaleX);
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
      drawAnimatedBrushSprite(wCtx, meta.canvas, tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, TILE, anim.angle, anim.scaleX);
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

  // Idle hover preview in BUILD or live PLAY quick-place mode
  const tx = pointer.tileX;
  const ty = pointer.tileY;
  const effectiveTool = state.mode === 'BUILD' ? state.buildTool : 'STAMP';
  wCtx.save();
  if (effectiveTool === 'ERASE' || pointer.ctrlKey || pointer.action === 'erase') {
    wCtx.fillStyle = 'rgba(207, 89, 89, 0.22)';
    wCtx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    wCtx.strokeStyle = '#cf5959';
    wCtx.lineWidth = 1.25 / camera.zoom;
    wCtx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
    if (pointer.ctrlKey && state.selectedSpriteId && effectiveTool !== 'ERASE') {
      // Tiny diagonal delete mark so Ctrl+LeftClick erase is unmistakable while holding a block
      wCtx.globalAlpha = 0.72;
      wCtx.beginPath();
      wCtx.moveTo(tx * TILE + 4, ty * TILE + 4);
      wCtx.lineTo(tx * TILE + TILE - 4, ty * TILE + TILE - 4);
      wCtx.moveTo(tx * TILE + TILE - 4, ty * TILE + 4);
      wCtx.lineTo(tx * TILE + 4, ty * TILE + TILE - 4);
      wCtx.stroke();
    }
  } else if (effectiveTool === 'SPAWN') {
    wCtx.strokeStyle = '#f28c38';
    wCtx.lineWidth = 1.2 / camera.zoom;
    wCtx.strokeRect(tx * TILE + 2, ty * TILE + 2, TILE - 4, TILE - 4);
    wCtx.beginPath();
    wCtx.moveTo(tx * TILE + TILE * 0.5, ty * TILE);
    wCtx.lineTo(tx * TILE + TILE * 0.5, ty * TILE + TILE);
    wCtx.moveTo(tx * TILE, ty * TILE + TILE * 0.5);
    wCtx.lineTo(tx * TILE + TILE, ty * TILE + TILE * 0.5);
    wCtx.stroke();
  } else if (effectiveTool === 'WIRE' || effectiveTool === 'LINK') {
    const isWire = effectiveTool === 'WIRE';
    const isInvWire = isWire && Boolean(state.wireInvertMode);
    const accentCol = isWire ? (isInvWire ? '#ff70b0' : '#58d4ff') : '#8ec8f6';
    const startKey = isWire ? (pointer.wireStartKey || pointer.wirePickKey) : pointer.jointStartKey;
    if (startKey) {
      const sep = startKey.indexOf(',');
      const stx = parseInt(startKey.slice(0, sep), 10);
      const sty = parseInt(startKey.slice(sep + 1), 10);
      const sx = stx * TILE + TILE * 0.5;
      const sy = sty * TILE + TILE * 0.5;
      const ex = tx * TILE + TILE * 0.5;
      const ey = ty * TILE + TILE * 0.5;
      wCtx.strokeStyle = accentCol;
      wCtx.lineWidth = 1.8 / camera.zoom;
      wCtx.setLineDash([4 / camera.zoom, 2 / camera.zoom]);
      wCtx.beginPath();
      if (isWire) {
        const crv = getWireCurvePoints({ x: sx, y: sy }, { x: ex, y: ey });
        wCtx.moveTo(sx, sy);
        wCtx.quadraticCurveTo(crv.cx, crv.cy, ex, ey);
      } else {
        wCtx.moveTo(sx, sy);
        wCtx.lineTo(ex, ey);
      }
      wCtx.stroke();
      wCtx.setLineDash([]);
      wCtx.strokeRect(stx * TILE + 1, sty * TILE + 1, TILE - 2, TILE - 2);
    }
    wCtx.strokeStyle = accentCol;
    wCtx.lineWidth = 1.3 / camera.zoom;
    wCtx.strokeRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
    wCtx.restore();
    let badgeTxt = isWire ? (isInvWire ? 'WIRE !' : 'WIRE') : `LINK: ${state.jointKind}`;
    if (isWire && !startKey && pointer.hoverWireIdx >= 0) {
      badgeTxt = 'LMB: INVERT | RMB: CUT';
    }
    drawBrushDimBadge(badgeTxt, (tx + 1) * TILE, ty * TILE, isInvWire);
    return;
  } else if (meta && meta.canvas) {
    // Scale-pop cursor preview right after pickup or rotate/flip
    let sc = 1;
    if (worldFX.cursorPickup) {
      const p = clamp((state.uiTime - worldFX.cursorPickup.startUiTime) / 0.2, 0, 1);
      sc += Math.sin(p * Math.PI) * 0.24;
    }
    const rotPopP = clamp((state.uiTime - anim.popStart) / 0.19, 0, 1);
    const rotPop = rotPopP < 1 ? Math.sin(rotPopP * Math.PI) : 0;
    sc += rotPop * 0.16;

    // Subtle mid-flip depth lift while card-flipping horizontally
    const flipMid = 1 - Math.min(1, Math.abs(anim.scaleX));
    const scaleY = 1 + flipMid * 0.10;
    const isBigBrush = meta.type === 'BIG_THING';
    const bigMult = isBigBrush ? getBigThingTileMult(meta) : 1;
    const baseSz = TILE * bigMult;
    const sz = baseSz * sc;
    const baseDx = isBigBrush ? (tx * TILE - (baseSz - TILE) * 0.5) : (tx * TILE);
    const baseDy = isBigBrush ? (ty * TILE - (baseSz - TILE)) : (ty * TILE);
    const cx = baseDx + baseSz * 0.5;
    const cy = baseDy + baseSz * 0.5;
    const ox = cx - sz * 0.5;
    const oy = cy - sz * 0.5;
    const drawAngle = isBigBrush ? 0 : anim.angle;

    wCtx.globalAlpha = 0.68;
    drawAnimatedBrushSprite(wCtx, meta.canvas, cx, cy, sz, drawAngle, anim.scaleX, scaleY);
    if (isBigBrush && meta.subType === 'BACK + FRONT' && meta.sprite && meta.sprite._canvases && meta.sprite._canvases[1]) {
      drawAnimatedBrushSprite(wCtx, meta.sprite._canvases[1], cx, cy, sz, drawAngle, anim.scaleX, scaleY);
    }

    wCtx.globalAlpha = 0.9;
    const isFlippedSide = state.brushOrient >= 4;
    wCtx.strokeStyle = (rotPop > 0.05 && isFlippedSide) ? '#7fd3fc' : '#f28c38';
    wCtx.lineWidth = (1 + rotPop * 0.5) / camera.zoom;
    wCtx.strokeRect(ox, oy, sz, sz);
    if (isBigBrush) {
      wCtx.globalAlpha = 0.55;
      wCtx.strokeStyle = '#ffffff';
      wCtx.lineWidth = 0.9 / camera.zoom;
      wCtx.strokeRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
    }

    // Crisp micro-sparks radiating around the block on each rotate / flip click
    if (anim.sparks && anim.sparks.length > 0) {
      let alive = 0;
      for (let i = 0; i < anim.sparks.length; i++) {
        const spk = anim.sparks[i];
        const spP = (state.uiTime - spk.startUiTime) / 0.22;
        if (spP >= 1 || spP < 0) continue;
        alive++;
        const ease = 1 - Math.pow(1 - spP, 3);
        const rad = TILE * 0.45 + spk.dist * ease;
        const sx = cx + Math.cos(spk.ang + ease * 0.7) * rad;
        const sy = cy + Math.sin(spk.ang + ease * 0.7) * rad;
        wCtx.globalAlpha = (1 - spP) * 0.92;
        wCtx.fillStyle = spk.color || '#f28c38';
        wCtx.fillRect(sx - 0.8, sy - 0.8, 1.6, 1.6);
      }
      if (alive === 0) anim.sparks.length = 0;
    }

    wCtx.restore();

    // Floating orientation pill right above cursor while rotating / flipping
    if (state.uiTime < anim.labelUntil && anim.labelText) {
      drawBrushDimBadge(anim.labelText, (tx + 1) * TILE, ty * TILE, false);
    }
    return;
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
  let shakeX = 0;
  let shakeY = 0;
  if (runtime.screenShake > 0.005) {
    const mag = runtime.screenShake * 10 * viewport.dpr;
    shakeX = (Math.sin(state.uiTime * 88) * 0.7 + (Math.random() - 0.5) * 0.6) * mag;
    shakeY = (Math.cos(state.uiTime * 74) * 0.7 + (Math.random() - 0.5) * 0.6) * mag;
  }
  const worldOriginX = Math.round(cx * viewport.dpr - camera.x * worldScale + shakeX);
  const worldOriginY = Math.round(cy * viewport.dpr - camera.y * worldScale + shakeY);

  wCtx.save();
  wCtx.setTransform(worldScale, 0, 0, worldScale, worldOriginX, worldOriginY);
  wCtx.imageSmoothingEnabled = false;

  // Visible world bounds for sparse culling
  const topLeft = screenToWorld(0, 0);
  const botRight = screenToWorld(viewport.width, viewport.height);
  const minTx = Math.floor(topLeft.wx / TILE) - 3;
  const maxTx = Math.ceil(botRight.wx / TILE) + 3;
  const minTy = Math.floor(topLeft.wy / TILE) - 3;
  const maxTy = Math.ceil(botRight.wy / TILE) + 3;

  // Layer order: skip 2nd in-front passes completely when Pass 1 saw zero front-layered objects!
  const hasBgFront = drawLayerTiles(world, 'bg', minTx, maxTx, minTy, maxTy, worldOriginX, worldOriginY, worldScale, false);
  const hasMainFront = drawLayerTiles(world, 'main', minTx, maxTx, minTy, maxTy, worldOriginX, worldOriginY, worldScale, false);
  const hasRtFront = drawRuntimeEntities(world, alpha, false);
  drawPlayer(alpha);
  if (hasBgFront) drawLayerTiles(world, 'bg', minTx, maxTx, minTy, maxTy, worldOriginX, worldOriginY, worldScale, true);
  if (hasMainFront) drawLayerTiles(world, 'main', minTx, maxTx, minTy, maxTy, worldOriginX, worldOriginY, worldScale, true);
  if (hasRtFront) drawRuntimeEntities(world, alpha, true);
  drawLayerTiles(world, 'fg', minTx, maxTx, minTy, maxTy, worldOriginX, worldOriginY, worldScale, false);
  drawMachinesAndLinks(world, alpha, minTx, maxTx, minTy, maxTy);
  drawWorldFX();
  envSys.drawWorldParticles();
  drawLightsAndLabels(world, minTx, maxTx, minTy, maxTy);
  drawSpawnMarker(world);
  drawBlueprintOverlay(world, alpha, minTx, maxTx, minTy, maxTy);
  drawLocalizedBuildGrid();
  drawBrushPreview();
  drawCursorFX();

  wCtx.restore();

  // Low-lying MIST fog banks, Blueprint CAD corner brackets & SURROUND LIGHT vignette
  envSys.drawMistOverlay();
  drawSurroundLights(world);
  drawBlueprintScreenFrame();
  drawBreathBar(alpha);

  // Guard zoom readout DOM write so it only mutates when formatted zoom changes
  const zoomText = `${camera.zoom.toFixed(1)}X`;
  if (zoomText !== camera.lastZoomText) {
    camera.lastZoomText = zoomText;
    zoomReadoutBtn.textContent = zoomText;
  }
}
