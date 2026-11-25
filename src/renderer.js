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

export function drawLightGlowOverlay(ctx, glowCanvas, cx, cy, drawSize, opts, tNow, seed = 0) {
  if (!glowCanvas) return;
  const behavior = (opts && opts.glowBehavior) || 'PULSATING';
  const style = (opts && opts.glowStyle) || 'TRANSLUCENT';

  let alpha = style === 'SOFT HAZE' ? 0.42 : (style === 'ADDITIVE GLOW' ? 0.72 : 0.56);
  let scale = 1;
  let rot = 0;

  if (behavior === 'PULSATING') {
    const wave = 0.5 + 0.5 * Math.sin(tNow * 2.4 + seed);
    alpha *= 0.62 + wave * 0.45;
    scale = 0.94 + wave * 0.12;
  } else if (behavior === 'FLICKERING') {
    const flick = 0.68 + 0.22 * Math.sin(tNow * 19.3 + seed * 3) + 0.14 * Math.sin(tNow * 31.7 + seed);
    alpha *= clamp(flick, 0.35, 1.1);
  } else if (behavior === 'SPINNING') {
    rot = tNow * 0.85 + seed;
  }

  ctx.save();
  ctx.translate(cx, cy);
  if (rot !== 0) ctx.rotate(rot);
  if (style === 'ADDITIVE GLOW') ctx.globalCompositeOperation = 'lighter';
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
  let bestTop = null;
  let bestFill = null;
  const stdLights = [];

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
      if (!bestTop || w > bestTop.w) bestTop = { rgb, w };
    } else if (sub === 'FILL LIGHT') {
      if (!bestFill || order > bestFill.order || (order === bestFill.order && w > bestFill.w)) {
        bestFill = { rgb, w, fillMode: opts.fillMode || 'FULL SCREEN', order };
      }
    } else {
      stdLights.push({ rgb, w, opts, seed: tx * 0.7 + ty * 1.1 });
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

  if (stdLights.length === 0 && !bestTop && !bestFill) return;

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

  // 1. Standard LIGHT ambient tints
  for (let i = 0; i < stdLights.length; i++) {
    const l = stdLights[i];
    const pulse = l.opts.pulsating ? (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(state.uiTime * 2.2 + l.seed))) : 1;
    const baseA = l.opts.thick ? 0.62 : 0.34;
    const alpha = clamp(baseA * l.w * pulse, 0, 0.85);
    wCtx.fillStyle = `rgba(${l.rgb.r}, ${l.rgb.g}, ${l.rgb.b}, ${alpha})`;
    wCtx.fillRect(0, 0, viewport.width, viewport.height);
  }

  // 2. FILL LIGHT (most recently placed wins overlap)
  if (bestFill) {
    wCtx.fillStyle = `rgba(${bestFill.rgb.r}, ${bestFill.rgb.g}, ${bestFill.rgb.b}, ${clamp(bestFill.w * 0.82, 0, 0.9)})`;
    const m = bestFill.fillMode;
    if (m === 'TOP HALF') wCtx.fillRect(0, 0, viewport.width, Math.ceil(viewport.height * 0.5));
    else if (m === 'BOTTOM HALF') wCtx.fillRect(0, Math.floor(viewport.height * 0.5), viewport.width, Math.ceil(viewport.height * 0.5));
    else if (m === 'LEFT HALF') wCtx.fillRect(0, 0, Math.ceil(viewport.width * 0.5), viewport.height);
    else if (m === 'RIGHT HALF') wCtx.fillRect(Math.floor(viewport.width * 0.5), 0, Math.ceil(viewport.width * 0.5), viewport.height);
    else if (m === 'CENTER BAND') wCtx.fillRect(0, Math.floor(viewport.height * 0.25), viewport.width, Math.ceil(viewport.height * 0.5));
    else wCtx.fillRect(0, 0, viewport.width, viewport.height);
  }

  // 3. TOP LIGHT sky gradient (multiple top lights do not stack saturation)
  if (bestTop) {
    const grad = wCtx.createLinearGradient(0, 0, 0, viewport.height * 0.72);
    grad.addColorStop(0, `rgba(${bestTop.rgb.r}, ${bestTop.rgb.g}, ${bestTop.rgb.b}, ${clamp(bestTop.w * 0.72, 0, 0.82)})`);
    grad.addColorStop(0.55, `rgba(${bestTop.rgb.r}, ${bestTop.rgb.g}, ${bestTop.rgb.b}, ${clamp(bestTop.w * 0.28, 0, 0.4)})`);
    grad.addColorStop(1, `rgba(${bestTop.rgb.r}, ${bestTop.rgb.g}, ${bestTop.rgb.b}, 0)`);
    wCtx.fillStyle = grad;
    wCtx.fillRect(0, 0, viewport.width, viewport.height * 0.75);
  }

  wCtx.restore();
}

export function drawSurroundLights(world) {
  const bgIdx = getBgEffectIndex(world);
  const entries = bgIdx.surroundLights;
  const hasFadeOuts = worldFX.bgFadeOuts.length > 0;
  if (entries.length === 0 && !hasFadeOuts) return;

  const ref = getLightRefPoint();
  let best = null;

  const consider = (sp, tx, ty, fade) => {
    if (!sp || sp.type !== 'LIGHT' || sp.subType !== 'SURROUND LIGHT' || fade <= 0.002) return;
    const prox = getAtmosphereProximity(tx, ty, ref.x, ref.y, LIGHT_CORE_RADIUS, LIGHT_PROXIMITY_RADIUS);
    if (prox <= 0.002) return;
    const w = prox * fade;
    if (!best || w > best.w) {
      best = {
        rgb: hexToRgb(sp.lightColor || (sp.palette && sp.palette[0]) || '#f28c38'),
        thick: (sp.lightOpts && sp.lightOpts.surroundThick) || 'NORMAL',
        w
      };
    }
  };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    consider(e.sp, e.tx, e.ty, getBgEffectFadeIn(e.key));
  }
  for (let i = 0; i < worldFX.bgFadeOuts.length; i++) {
    const e = worldFX.bgFadeOuts[i];
    consider(e.sp, e.tx, e.ty, getBgEffectFadeOut(e));
  }
  if (!best) return;

  const innerFrac = best.thick === 'VERY THICK' ? 0.16 : (best.thick === 'THICK' ? 0.30 : 0.46);
  const edgeA = (best.thick === 'VERY THICK' ? 0.82 : (best.thick === 'THICK' ? 0.68 : 0.54)) * best.w;
  const cx = viewport.width * 0.5;
  const cy = viewport.height * 0.5;
  const outerR = Math.hypot(cx, cy);

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  const grad = wCtx.createRadialGradient(cx, cy, outerR * innerFrac, cx, cy, outerR);
  grad.addColorStop(0, `rgba(${best.rgb.r}, ${best.rgb.g}, ${best.rgb.b}, 0)`);
  grad.addColorStop(0.62, `rgba(${best.rgb.r}, ${best.rgb.g}, ${best.rgb.b}, ${edgeA * 0.42})`);
  grad.addColorStop(1, `rgba(${best.rgb.r}, ${best.rgb.g}, ${best.rgb.b}, ${edgeA})`);
  wCtx.fillStyle = grad;
  wCtx.fillRect(0, 0, viewport.width, viewport.height);
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

export function drawBreathBar() {
  if (state.mode !== 'PLAY') return;
  const showBreath = player.breathHudAlpha > 0.01 && !player.dead;
  const showHealth = player.healthHudAlpha > 0.01 || player.dead;
  if (!showBreath && !showHealth) return;

  const total = player.maxBreath;
  const px = 2; // 9*2 = 18px crisp pixel icons
  const iconW = 9 * px;
  const gap = 3;
  const barW = total * iconW + (total - 1) * gap;
  const centerX = viewport.width * 0.5 - camera.offsetX;
  const startX = Math.round(centerX - barW * 0.5);

  const healthY = Math.round(viewport.height - 36);
  const breathY = showHealth ? (healthY - (iconW + 14)) : healthY;

  wCtx.save();
  wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

  // 1. Pixel Heart Health Bar (bottom row)
  if (showHealth) {
    const hpPerHeart = player.maxHealth / total; // 10 HP per heart
    const lowHp = !player.dead && player.health <= 25;
    const flashing = player.damageFlashTimer > 0 && Math.floor(state.uiTime * 28) % 2 === 0;

    wCtx.save();
    wCtx.globalAlpha = clamp(player.dead ? 1 : player.healthHudAlpha, 0, 1);

    wCtx.fillStyle = 'rgba(13, 14, 17, 0.56)';
    wCtx.fillRect(startX - 7, healthY - 5, barW + 14, iconW + 10);
    wCtx.strokeStyle = (lowHp || player.dead) ? 'rgba(207, 89, 89, 0.75)' : 'rgba(58, 64, 79, 0.65)';
    wCtx.lineWidth = 1;
    wCtx.strokeRect(startX - 6.5, healthY - 4.5, barW + 13, iconW + 9);

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

    // Smooth 3-second Revival Countdown Banner while dead
    if (player.dead) {
      const labelCause = player.deathCause === 'drown'
        ? 'DROWNED'
        : (player.deathFallRagdoll ? 'FELL' : 'KNOCKED OUT');
      const secs = Math.max(0.1, player.deathTimer).toFixed(1);
      const text = `${labelCause} · REVIVING IN ${secs}S`;
      const progress = clamp(1 - player.deathTimer / Math.max(0.1, player.deathMaxTimer), 0, 1);
      const banW = barW + 14;
      const banH = 22;
      const banX = startX - 7;
      const banY = healthY - banH - 10;

      wCtx.fillStyle = 'rgba(13, 14, 17, 0.82)';
      wCtx.fillRect(banX, banY, banW, banH);
      wCtx.strokeStyle = '#cf5959';
      wCtx.lineWidth = 1;
      wCtx.strokeRect(banX + 0.5, banY + 0.5, banW - 1, banH - 1);

      // Progress bar along bottom edge
      wCtx.fillStyle = '#f28c38';
      wCtx.fillRect(banX + 1, banY + banH - 3, Math.round((banW - 2) * progress), 2);

      wCtx.font = '12px "Perfect DOS VGA 437", "VT323", monospace';
      wCtx.fillStyle = '#f6e4d2';
      wCtx.textAlign = 'center';
      wCtx.textBaseline = 'middle';
      wCtx.fillText(text, banX + banW * 0.5, banY + (banH - 2) * 0.5);
      wCtx.textAlign = 'start';
    }

    wCtx.restore();
  }

  // 2. Minecraft-Style Pixel Breath Bar (stacked directly above Health Bar when both visible)
  if (showBreath) {
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

    // Subtle dark pill plate behind bubbles for crisp workstation readability
    wCtx.fillStyle = 'rgba(13, 14, 17, 0.52)';
    wCtx.fillRect(startX - 7, breathY - 5, barW + 14, iconW + 10);
    wCtx.strokeStyle = criticalAir ? 'rgba(207, 89, 89, 0.65)' : 'rgba(58, 64, 79, 0.65)';
    wCtx.lineWidth = 1;
    wCtx.strokeRect(startX - 6.5, breathY - 4.5, barW + 13, iconW + 9);

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
        // Show Minecraft popping frame right before this bubble vanishes
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

  // 1. Placed 38x38 LIGHT GLOW overlays
  const glows = bgIdx.lightGlows;
  for (let i = 0; i < glows.length; i++) {
    const e = glows[i];
    if (e.tx < minTx - 2 || e.tx > maxTx + 2 || e.ty < minTy - 2 || e.ty > maxTy + 2) continue;
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
      e.tx * 0.7 + e.ty * 1.3
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
      e.tx * 0.7 + e.ty * 1.3
    );
    wCtx.restore();
  }

  // 2. Equipped HOLDABLE (LIGHT) warm handheld lantern halo
  if (state.equippedHoldableId) {
    const hSp = getSpriteById(state.equippedHoldableId);
    if (hSp && hSp.type === 'HOLDABLE' && hSp.subType === 'LIGHT') {
      const lx = player.x + player.w * 0.5 + player.facing * 8;
      const ly = player.y + player.h * 0.45;
      const r = TILE * 3.8 + Math.sin(state.uiTime * 4) * 2;
      const grad = wCtx.createRadialGradient(lx, ly, 2, lx, ly, r);
      grad.addColorStop(0, 'rgba(255, 224, 160, 0.34)');
      grad.addColorStop(0.5, 'rgba(242, 140, 56, 0.14)');
      grad.addColorStop(1, 'rgba(242, 140, 56, 0)');
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

/* Gently bobbing pixel water surface for exposed top-row LIQUID tiles */
export function drawLiquidSurfaceTile(ctx, canvas, tx, ty, sp) {
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

  const stepW = TILE / srcW;
  for (let cx = 0; cx < TILE; cx++) {
    const worldPx = baseX + cx;
    const wave1 = Math.sin(worldPx * 0.28 + t * 2.55);
    const wave2 = Math.sin(worldPx * 0.52 - t * 1.85 + 1.3);
    const splashWave = rippleEnergy > 0.02 ? Math.sin(worldPx * 0.72 - t * 12) * Math.min(1.6, rippleEnergy) : 0;
    const bob = Math.round((wave1 * 0.65 + wave2 * 0.45 + splashWave) * 1.15);
    const topY = baseY + 1 + bob;
    const drawH = Math.max(1, (baseY + TILE) - topY);
    const sx = clamp(Math.floor(cx / stepW), 0, srcW - 1);

    ctx.drawImage(canvas, sx, 0, 1, srcH, worldPx, topY, 1, drawH);

    // Luminous 1px top waterline & subtle 1px subsurface sheen
    ctx.fillStyle = cols.line;
    ctx.fillRect(worldPx, topY, 1, 1);
    if (drawH > 2) {
      ctx.fillStyle = cols.sheen;
      ctx.fillRect(worldPx, topY + 1, 1, 1);
    }
    // Subtle drifting specular glint on wave crests
    if (wave1 > 0.82 && ((Math.floor(worldPx + t * 6)) % 7 === 0)) {
      ctx.fillStyle = cols.glint;
      ctx.fillRect(worldPx, topY, 1, 1);
    }
  }
}

export function drawLayerTiles(world, layer, minTx, maxTx, minTy, maxTy) {
  const map = world.layers[layer];
  if (!map) return;

  for (const key in map) {
    const id = map[key];
    if (!id) continue;
    const comma = key.indexOf(',');
    if (comma === -1) continue;
    const tx = parseInt(key.slice(0, comma), 10);
    const ty = parseInt(key.slice(comma + 1), 10);
    if (tx < minTx || tx > maxTx || ty < minTy || ty > maxTy) continue;

    if (id === STARTER_TILE_ID) {
      wCtx.drawImage(starterTileCanvas, tx * TILE, ty * TILE, TILE, TILE);
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
    if (layer === 'main' && sp.type === 'LIQUID' && getMainTileType(world, tx, ty - 1) !== 'LIQUID') {
      drawLiquidSurfaceTile(wCtx, canvas, tx, ty, sp);
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
      alpha = (sp.type === 'LIGHT' && sp.subType !== 'LIGHT GLOW') ? (0.5 * fadeIn) : fadeIn;
    } else if (sp.type === 'CRUMBLING') {
      const c = runtime.crumbling.get(key);
      if (c && c.state === 'gone') continue;
      if (c && c.state === 'shake') {
        dx += (Math.sin(state.simTime * 68 + tx) > 0 ? 1 : -1) * 0.85;
      }
    } else if (sp.type === 'ACTIVATOR' && sp.subType === 'DOOR' && runtime.doorsOpen.has(key)) {
      alpha = 0.24;
    } else if (sp.type === 'HOLDER') {
      dy += Math.sin(state.uiTime * 2.6 + tx * 0.7) * 1.2;
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

    // Build placement pop-in micro-scale
    const popKey = `${layer}:${key}`;
    const popStart = worldFX.buildPops.get(popKey);
    if (popStart !== undefined) {
      const p = (state.uiTime - popStart) / 0.14;
      if (p >= 1) {
        worldFX.buildPops.delete(popKey);
      } else {
        const sc = 0.72 + (1 - Math.pow(1 - p, 3)) * 0.28;
        const nw = dw * sc;
        const nh = dh * sc;
        dx += (dw - nw) * 0.5;
        dy += (dh - nh) * 0.5;
        dw = nw;
        dh = nh;
      }
    }

    if (alpha < 0.999) {
      wCtx.save();
      wCtx.globalAlpha = alpha;
      wCtx.drawImage(canvas, dx, dy, dw, dh);
      wCtx.restore();
    } else {
      wCtx.drawImage(canvas, dx, dy, dw, dh);
    }
  }

  // Smooth fade-out sprites for recently erased background lights/effects
  if (layer === 'bg' && worldFX.bgFadeOuts.length > 0) {
    wCtx.save();
    for (let i = 0; i < worldFX.bgFadeOuts.length; i++) {
      const e = worldFX.bgFadeOuts[i];
      if (e.tx < minTx || e.tx > maxTx || e.ty < minTy || e.ty > maxTy) continue;
      const fade = getBgEffectFadeOut(e);
      if (fade <= 0.002 || !e.sp || !e.sp._canvases || !e.sp._canvases[0]) continue;
      wCtx.globalAlpha = (e.sp.type === 'LIGHT' && e.sp.subType !== 'LIGHT GLOW') ? (0.5 * fade) : fade;
      wCtx.drawImage(e.sp._canvases[0], e.tx * TILE, e.ty * TILE, TILE, TILE);
    }
    wCtx.restore();
  }
}

export function drawRuntimeEntities(world) {
  // 1. MOVING platforms
  for (const m of runtime.moving.values()) {
    const sp = getSpriteById(m.id);
    if (!sp) continue;
    const c = resolveTileFrameCanvas(sp, 'main', m.key);
    if (c) wCtx.drawImage(c, m.x, m.y, TILE, TILE);
  }

  // 2. LIVING critters / NPCs
  for (const lv of runtime.living.values()) {
    const sp = getSpriteById(lv.id);
    if (!sp) continue;
    const c = resolveTileFrameCanvas(sp, 'main', lv.key);
    if (!c) continue;
    wCtx.save();
    wCtx.translate(lv.x + TILE * 0.5, lv.y + TILE * 0.5);
    if (lv.facing < 0) wCtx.scale(-1, 1);
    wCtx.drawImage(c, -TILE * 0.5, -TILE * 0.5, TILE, TILE);
    wCtx.restore();
  }

  // 3. DYNAMIC crates & bouncy balls
  for (const dyn of runtime.dynamics.values()) {
    const sp = getSpriteById(dyn.id);
    if (!sp) continue;
    const c = resolveTileFrameCanvas(sp, 'main', dyn.key);
    if (c) wCtx.drawImage(c, dyn.x, dyn.y, TILE, TILE);
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
  if (player.dead) {
    pose = player.deathFallRagdoll ? 'FALL' : 'SIT';
  } else if (player.climbing) {
    pose = 'CLIMB';
  } else if (player.inLiquid) {
    // Only play WALK cycle in liquid while actively swimming; rest in STAND when floating idle
    pose = player.swimming ? 'WALK' : 'STAND';
  } else if (runtime.hurtFlash > 0 || player.sitting) {
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

  const shouldBlink = player.dead || ((pose === 'STAND') && (player.blinkDur > 0 || state.windowUnfocused));
  const blinkList = sc.BLINK;
  const blinkOverlay = (shouldBlink && blinkList && blinkList.length > 0)
    ? blinkList[Math.floor(state.uiTime * getSpriteStateFps(sp, 'BLINK')) % blinkList.length]
    : null;

  return { canvas, blinkOverlay, flipClimb, size: sp.size };
}

export function drawDefaultWireframe(ctx, w, h, facing, blinking) {
  ctx.fillStyle = 'rgba(230, 234, 242, 0.04)';
  ctx.fillRect(1, 1, w - 2, h - 2);

  ctx.strokeStyle = 'rgba(230, 234, 242, 0.34)';
  ctx.lineWidth = 1;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);

  // Minimal translucent eyes for facing/blink readability
  const eyeY = Math.round(h * 0.36);
  const ex1 = facing >= 0 ? Math.round(w * 0.52) : Math.round(w * 0.28);
  const ex2 = ex1 + 3;
  ctx.fillStyle = 'rgba(230, 234, 242, 0.32)';
  if (blinking) {
    ctx.fillRect(ex1, eyeY + 1, 2, 1);
    ctx.fillRect(ex2, eyeY + 1, 2, 1);
  } else {
    ctx.fillRect(ex1, eyeY, 1.5, 2);
    ctx.fillRect(ex2, eyeY, 1.5, 2);
  }
}

/* Floppy articulated wireframe ragdoll drawn during fall/abyss ragdoll deaths */
export function drawRagdollWireframe(ctx, limbs) {
  const aHead = limbs[0] ? limbs[0].a * 0.45 : 0;
  const aArmL = limbs[1] ? limbs[1].a : -0.6;
  const aArmR = limbs[2] ? limbs[2].a : 0.6;
  const aLegL = limbs[3] ? limbs[3].a : -0.4;
  const aLegR = limbs[4] ? limbs[4].a : 0.4;

  const fill = 'rgba(230, 234, 242, 0.08)';
  const stroke = 'rgba(230, 234, 242, 0.48)';

  // Torso centered at (0, 0)
  ctx.fillStyle = fill;
  ctx.fillRect(-3.5, -3.5, 7, 7);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(-3, -3, 6, 6);

  // Floppy Head
  ctx.save();
  ctx.translate(0, -3.5);
  ctx.rotate(aHead);
  ctx.fillStyle = fill;
  ctx.fillRect(-3, -5.5, 6, 5.5);
  ctx.strokeStyle = stroke;
  ctx.strokeRect(-2.5, -5, 5, 4.5);
  // Tiny X knocked-out eyes
  ctx.fillStyle = 'rgba(230, 234, 242, 0.45)';
  ctx.fillRect(-1.5, -3.5, 1.5, 1);
  ctx.fillRect(0.8, -3.5, 1.5, 1);
  ctx.restore();

  // Flailing Arms & Legs
  const drawLimb = (ox, oy, ang, len) => {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(ang);
    ctx.fillStyle = fill;
    ctx.fillRect(-1, 0, 2, len);
    ctx.strokeStyle = stroke;
    ctx.strokeRect(-0.8, 0.2, 1.6, len - 0.4);
    ctx.restore();
  };
  drawLimb(-3.5, -2, -1.1 + aArmL, 5.5);
  drawLimb(3.5, -2, 1.1 + aArmR, 5.5);
  drawLimb(-2, 3.5, -0.3 + aLegL, 6);
  drawLimb(2, 3.5, 0.3 + aLegR, 6);
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

  // Dedicated Death & Ragdoll Animation rendering during the 3-second revival countdown
  if (player.dead) {
    const centerX = px + player.w * 0.5;
    const centerY = py + player.h * 0.5;
    const revivePulse = player.deathTimer < 0.45 ? (0.45 + 0.55 * Math.sin(state.uiTime * 28)) : 1;
    const baseAlpha = clamp(0.45 + (player.deathTimer / Math.max(0.1, player.deathMaxTimer)) * 0.55, 0.35, 1);

    wCtx.save();
    wCtx.translate(centerX, centerY);
    wCtx.rotate(player.deathAngle);
    wCtx.scale(player.scaleX, player.scaleY);
    wCtx.globalAlpha = baseAlpha * revivePulse;

    if (resolved && resolved.canvas) {
      const flipH = player.facing < 0 ? -1 : 1;
      if (flipH < 0) wCtx.scale(-1, 1);

      if (player.deathFallRagdoll && player.ragdollLimbs.length >= 4) {
        // Split sprite into floppy upper & lower halves for lively pixel ragdoll tumble
        const halfSrc = Math.floor(resolved.canvas.height * 0.55);
        const botSrc = resolved.canvas.height - halfSrc;
        const halfDraw = drawDim * 0.55;
        const botDraw = drawDim - halfDraw;
        const upperBend = player.ragdollLimbs[0].a * 0.28;
        const lowerBend = player.ragdollLimbs[3].a * 0.34;

        wCtx.save();
        wCtx.rotate(upperBend);
        wCtx.drawImage(resolved.canvas, 0, 0, resolved.canvas.width, halfSrc, -drawDim * 0.5, -drawDim * 0.5, drawDim, halfDraw);
        if (resolved.blinkOverlay) {
          wCtx.drawImage(resolved.blinkOverlay, 0, 0, resolved.blinkOverlay.width, halfSrc, -drawDim * 0.5, -drawDim * 0.5, drawDim, halfDraw);
        }
        wCtx.restore();

        wCtx.save();
        wCtx.translate(0, halfDraw - drawDim * 0.5);
        wCtx.rotate(lowerBend);
        wCtx.drawImage(resolved.canvas, 0, halfSrc, resolved.canvas.width, botSrc, -drawDim * 0.5, 0, drawDim, botDraw);
        wCtx.restore();
      } else {
        wCtx.drawImage(resolved.canvas, -drawDim * 0.5, -drawDim * 0.5, drawDim, drawDim);
        if (resolved.blinkOverlay) {
          wCtx.drawImage(resolved.blinkOverlay, -drawDim * 0.5, -drawDim * 0.5, drawDim, drawDim);
        }
      }
    } else if (player.deathFallRagdoll) {
      drawRagdollWireframe(wCtx, player.ragdollLimbs);
    } else {
      wCtx.translate(-TILE * 0.5, -TILE * 0.5);
      drawDefaultWireframe(wCtx, TILE, TILE, player.facing, true);
    }

    // Subtle hurt/drown tint wash right on impact
    if (player.damageFlashTimer > 0) {
      wCtx.fillStyle = player.deathCause === 'drown'
        ? 'rgba(110, 195, 240, 0.35)'
        : 'rgba(207, 89, 89, 0.42)';
      wCtx.fillRect(-drawDim * 0.45, -drawDim * 0.45, drawDim * 0.9, drawDim * 0.9);
    }

    wCtx.restore();
    return;
  }

  wCtx.save();
  wCtx.translate(footCx, footY);

  // Gentle swimming bob & stroke tilt
  if (player.inLiquid && player.swimming) {
    wCtx.translate(0, Math.sin(player.swimCycle * 2) * 0.9);
  }
  if (Math.abs(player.swimTilt) > 0.004) {
    wCtx.translate(0, -player.h * 0.5);
    wCtx.rotate(player.swimTilt);
    wCtx.translate(0, player.h * 0.5);
  }

  // Hurt / respawn subtle alpha blink
  if (runtime.hurtFlash > 0 && Math.floor(state.uiTime * 24) % 2 === 0) {
    wCtx.globalAlpha = 0.55;
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
    wCtx.drawImage(resolved.canvas, -drawDim * 0.5, -drawDim, drawDim, drawDim);
    if (resolved.blinkOverlay) {
      wCtx.drawImage(resolved.blinkOverlay, -drawDim * 0.5, -drawDim, drawDim, drawDim);
    }
    wCtx.restore();
  } else {
    wCtx.save();
    wCtx.translate(-TILE * 0.5, -TILE);
    drawDefaultWireframe(wCtx, TILE, TILE, player.facing, player.blinkDur > 0 || state.windowUnfocused);
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

  // 1. Build dissolve tiles (single batched save/restore)
  if (worldFX.buildDissolves.length > 0) {
    wCtx.save();
    wCtx.lineWidth = 1.2 * invZ;
    for (let i = worldFX.buildDissolves.length - 1; i >= 0; i--) {
      const d = worldFX.buildDissolves[i];
      const p = (state.uiTime - d.startUiTime) / 0.18;
      if (p >= 1) {
        worldFX.buildDissolves.splice(i, 1);
        continue;
      }
      const shrink = p * 5;
      wCtx.globalAlpha = (1 - p) * 0.8;
      wCtx.strokeStyle = d.color || '#cf5959';
      wCtx.strokeRect(d.tx * TILE + shrink, d.ty * TILE + shrink, Math.max(1, TILE - shrink * 2), Math.max(1, TILE - shrink * 2));
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

  // 3. Spacebar interact radial pulse rings (single batched save/restore)
  if (worldFX.interactRings.length > 0) {
    wCtx.save();
    wCtx.strokeStyle = '#f28c38';
    wCtx.lineWidth = 1.2 * invZ;
    for (let i = 0; i < worldFX.interactRings.length; i++) {
      const r = worldFX.interactRings[i];
      const p = clamp(r.timer / r.maxTimer, 0, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const half = 6 + ease * 18;
      wCtx.globalAlpha = (1 - p) * 0.85;
      wCtx.strokeRect(r.x - half, r.y - half, half * 2, half * 2);
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

  wCtx.save();
  wCtx.translate(Math.round(cx), Math.round(cy));
  wCtx.scale(camera.zoom, camera.zoom);
  wCtx.translate(-camera.x, -camera.y);

  // Visible world bounds for sparse culling
  const topLeft = screenToWorld(0, 0);
  const botRight = screenToWorld(viewport.width, viewport.height);
  const minTx = Math.floor(topLeft.wx / TILE) - 2;
  const maxTx = Math.ceil(botRight.wx / TILE) + 2;
  const minTy = Math.floor(topLeft.wy / TILE) - 2;
  const maxTy = Math.ceil(botRight.wy / TILE) + 2;

  // Layer order: BG -> MAIN -> RUNTIME ENTITIES -> PLAYER -> FG -> FX -> ENV PARTICLES -> LIGHT GLOWS/LABELS -> BUILD GRID & PREVIEWS
  drawLayerTiles(world, 'bg', minTx, maxTx, minTy, maxTy);
  drawLayerTiles(world, 'main', minTx, maxTx, minTy, maxTy);
  drawRuntimeEntities(world);
  drawPlayer(alpha);
  drawLayerTiles(world, 'fg', minTx, maxTx, minTy, maxTy);
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
  drawBreathBar();

  // Guard zoom readout DOM write so it only mutates when formatted zoom changes
  const zoomText = `${camera.zoom.toFixed(1)}X`;
  if (zoomText !== camera.lastZoomText) {
    camera.lastZoomText = zoomText;
    zoomReadoutBtn.textContent = zoomText;
  }
}
