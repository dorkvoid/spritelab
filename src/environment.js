import { SFX } from './audio.js';
import { defaultEnvOpts, ENV_CORE_RADIUS, ENV_PROXIMITY_RADIUS, TILE } from './constants.js';
import { wCtx } from './dom.js';
import { getAtmosphereProximity, getLightRefPoint } from './renderer.js';
import {
  camera,
  getBgEffectFadeIn,
  getBgEffectFadeOut,
  getBgEffectIndex,
  viewport,
  worldFX
} from './state.js';
import { clamp } from './utils.js';
import { getMainTileType, isFullSolidAt, isOneWayAt, screenToWorld } from './world.js';

/* =========================================================================
   PHYSICS ENVIRONMENTALS SYSTEM (9 ATTRIBUTES + REAL-TIME WIND COUPLING)
   Rain, Snow, Village Dust, Rising Heat, Mist, Steam, Clouds, Stars, Wind.
   Handcrafted pre-baked pixel-art sprites, Bayer-dithered atmospheric depth,
   physics collisions, and live Create Editor preview parity.
   ========================================================================= */
export const envSys = (() => {
  const particles = [];
  const splashes = [];
  const shootingStars = [];
  const levels = {
    RAIN: 0,
    SNOW: 0,
    'VILLAGE DUST': 0,
    'RISING HEAT': 0,
    MIST: 0,
    STEAM: 0,
    CLOUDS: 0,
    STARS: 0,
    WIND: 0
  };

  /* Deterministic 2x2 Bayer matrix for crisp pixel-art shading & dithering */
  const BAYER2 = [0, 2, 3, 1];

  /* -----------------------------------------------------------------------
     PRE-BAKED PIXEL-ART ATMOSPHERE SPRITES (BUILT ONCE AT STARTUP)
     ----------------------------------------------------------------------- */

  /* 1. Sculpted volumetric pixel-art cumulus & high-cirrus cloud sprites */
  function bakeCloudSprite(spec) {
    const { w, h, lobes, wispy } = spec;
    const mask = new Uint8Array(w * h);

    for (let li = 0; li < lobes.length; li++) {
      const [cx, cy, rx, ry] = lobes[li];
      const x0 = Math.max(0, Math.floor(cx - rx - 1));
      const x1 = Math.min(w - 1, Math.ceil(cx + rx + 1));
      const y0 = Math.max(0, Math.floor(cy - ry - 1));
      const y1 = Math.min(h - 1, Math.ceil(cy + ry + 1));
      for (let y = y0; y <= y1; y++) {
        const ny = (y + 0.5 - cy) / Math.max(0.5, ry);
        const flatBoost = ny > 0.35 ? (ny - 0.35) * 0.55 : 0;
        const nyAdj = ny + flatBoost;
        for (let x = x0; x <= x1; x++) {
          const nx = (x + 0.5 - cx) / Math.max(0.5, rx);
          if (nx * nx + nyAdj * nyAdj <= 1.0) {
            mask[y * w + x] = 1;
          }
        }
      }
    }

    const baseY = h - 2;
    for (let x = 2; x < w - 2; x++) {
      if (mask[(baseY - 1) * w + x] && mask[(baseY - 1) * w + x - 1] && mask[(baseY - 1) * w + x + 1]) {
        if ((x * 7 + lobes.length) % 5 !== 0) mask[baseY * w + x] = 1;
      }
    }

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const colTop = new Int16Array(w).fill(h);
    const colBot = new Int16Array(w).fill(-1);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (mask[y * w + x]) {
          if (y < colTop[x]) colTop[x] = y;
          if (y > colBot[x]) colBot[x] = y;
        }
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const topY = colTop[x];
        const botY = colBot[x];
        const colH = Math.max(1, botY - topY + 1);
        const topDist = y - topY;
        const botDist = botY - y;
        const vFrac = topDist / colH;
        const dither = BAYER2[((y & 1) << 1) | (x & 1)] / 4;

        const hasLeft = x > 0 && mask[y * w + (x - 1)];
        const hasRight = x < w - 1 && mask[y * w + (x + 1)];
        const isTip = !hasLeft || !hasRight;

        if (wispy && isTip && ((x + y) & 1) === 1) continue;

        let col;
        if (topDist === 0 || (topDist === 1 && vFrac < 0.22 + dither * 0.14 && !isTip)) {
          col = wispy ? '#e4eefc' : '#f4f8ff';
        } else if (vFrac < 0.42 + dither * 0.16) {
          col = wispy ? '#c8d7ec' : '#d5e2f4';
        } else if (botDist <= 0 || vFrac > 0.74 + dither * 0.14) {
          col = wispy ? '#7c8ea8' : '#7a8da9';
        } else {
          col = wispy ? '#9fb2cc' : '#a9bdd8';
        }

        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const CLOUD_SPECS = [
    { w: 38, h: 11, wispy: true, lobes: [[9, 7, 7, 2.6], [19, 5.5, 11, 3.6], [29, 7, 7.5, 2.5]] },
    { w: 46, h: 12, wispy: true, lobes: [[10, 7.5, 8, 2.6], [21, 5.5, 10, 3.8], [32, 6.2, 9, 3.2], [39, 8, 5, 2]] },
    { w: 48, h: 19, wispy: false, lobes: [[11, 13, 9, 4.5], [20, 9.5, 10, 6.8], [30, 10.5, 9.5, 6], [38, 13.5, 7.5, 4]] },
    { w: 56, h: 21, wispy: false, lobes: [[11, 15, 9.5, 4.5], [21, 11.5, 10.5, 6.5], [31, 9, 11, 7.8], [42, 12.5, 9, 5.5], [48, 15.5, 6, 3.5]] },
    { w: 42, h: 17, wispy: false, lobes: [[10, 12, 8, 4], [20, 8.5, 10, 6.5], [31, 11.5, 8.5, 4.5]] },
    { w: 66, h: 25, wispy: false, lobes: [[12, 18, 10.5, 5], [23, 13.5, 12, 8], [35, 10.5, 13, 9.2], [47, 14, 11, 7.2], [56, 18.5, 8, 4.2]] },
    { w: 58, h: 23, wispy: false, lobes: [[11, 16.5, 9.5, 4.8], [22, 11.5, 11.5, 8], [34, 12.5, 11.5, 7.2], [45, 15.5, 9.5, 5.2], [51, 18, 5.5, 3.2]] }
  ];
  const cloudSprites = CLOUD_SPECS.map(bakeCloudSprite);

  /* 2. Pre-baked organic feathered pixel-art mist bank canvases */
  function bakeMistBank(seed, bw, bh) {
    const c = document.createElement('canvas');
    c.width = bw;
    c.height = bh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < bh; y++) {
      const v = y / Math.max(1, bh - 1);
      for (let x = 0; x < bw; x++) {
        const u = x / Math.max(1, bw - 1);
        const horiz = Math.pow(Math.sin(u * Math.PI), 1.45);
        const crest = 0.24
          + 0.16 * Math.sin(u * Math.PI * 3 + seed)
          + 0.10 * Math.cos(u * Math.PI * 5 + seed * 1.7)
          + 0.06 * Math.sin(u * Math.PI * 7 + seed * 0.6);
        const topMask = clamp((v - crest) / Math.max(0.18, 0.56 - crest), 0, 1);
        const botMask = v > 0.80 ? clamp((1 - v) / 0.20, 0, 1) : 1;
        const wisp = 0.72 + 0.28 * Math.sin(u * 14 + v * 6 + seed * 2.1);
        const density = horiz * topMask * botMask * wisp;
        if (density < 0.06) continue;

        const dither = (BAYER2[((y & 1) << 1) | (x & 1)] - 1.5) * 0.035;
        const a = clamp(Math.round((density + dither) * 8) / 8, 0, 1);
        if (a <= 0.04) continue;

        const r = Math.round(196 + (1 - v) * 24);
        const g = Math.round(212 + (1 - v) * 20);
        const b = Math.round(232 + (1 - v) * 16);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(a * 0.52).toFixed(3)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const mistSprites = [
    bakeMistBank(0.4, 96, 22),
    bakeMistBank(2.1, 112, 26),
    bakeMistBank(4.3, 128, 30)
  ];

  /* 3. Pre-baked volumetric Bayer-dithered pixel-art STEAM puff sprites */
  function bakeSteamPuff(spec) {
    const { w, h, lobes } = spec;
    const density = new Float32Array(w * h);

    for (let li = 0; li < lobes.length; li++) {
      const [cx, cy, r] = lobes[li];
      const x0 = Math.max(0, Math.floor(cx - r - 1));
      const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
      const y0 = Math.max(0, Math.floor(cy - r - 1));
      const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / Math.max(0.5, r);
          if (dist < 1) {
            const val = 1 - dist * dist;
            const idx = y * w + x;
            if (val > density[idx]) density[idx] = val;
          }
        }
      }
    }

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < h; y++) {
      const ny = y / Math.max(1, h - 1);
      for (let x = 0; x < w; x++) {
        const d = density[y * w + x];
        if (d < 0.08) continue;
        const bayer = BAYER2[((y & 1) << 1) | (x & 1)] / 4; // 0..0.75
        // Feathered Bayer-dithered outer vapor wisps
        if (d < 0.24 && d + bayer * 0.22 < 0.26) continue;

        let rCol, gCol, bCol, alpha;
        const topLight = (1 - ny) * 0.55 + d * 0.45;
        if (topLight > 0.72 + bayer * 0.14) {
          rCol = 244; gCol = 250; bCol = 255; alpha = 0.86; // Crisp silver-white upper billow
        } else if (topLight > 0.44 + bayer * 0.14) {
          rCol = 212; gCol = 225; bCol = 240; alpha = 0.70; // Soft mid vapor body
        } else if (d > 0.25) {
          rCol = 166; gCol = 184; bCol = 208; alpha = 0.52; // Cool shadowed underside
        } else {
          rCol = 196; gCol = 212; bCol = 232; alpha = 0.30; // Delicate feathered fringe
        }
        ctx.fillStyle = `rgba(${rCol}, ${gCol}, ${bCol}, ${alpha})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const steamSprites = [
    bakeSteamPuff({ w: 12, h: 12, lobes: [[6, 6.2, 4.5], [4.4, 5.2, 3.0], [7.8, 5.6, 3.1], [6, 4.0, 2.8]] }),
    bakeSteamPuff({ w: 14, h: 14, lobes: [[7, 7.5, 5.0], [4.8, 6.4, 3.4], [9.4, 6.6, 3.6], [6.8, 4.8, 3.4]] }),
    bakeSteamPuff({ w: 16, h: 14, lobes: [[5.2, 7.6, 4.0], [8.5, 6.2, 4.8], [11.2, 7.8, 3.5], [7.2, 4.8, 3.2]] }),
    bakeSteamPuff({ w: 14, h: 12, lobes: [[4.5, 6.2, 3.5], [7.5, 5.4, 4.2], [10.0, 6.6, 3.2]] })
  ];

  /* 4. Pre-baked delicate pixel-art SNOW crystal sprites (hero 5x5 & mid 3x3) */
  function bakeSnowSprite(kind) {
    const c = document.createElement('canvas');
    const sz = kind === 'hero' ? 5 : 3;
    c.width = sz;
    c.height = sz;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (kind === 'hero') {
      // Crisp 5x5 star snowflake with icy-blue tips and gleaming white crystal center
      ctx.fillStyle = 'rgba(154, 204, 250, 0.72)';
      ctx.fillRect(2, 0, 1, 5);
      ctx.fillRect(0, 2, 5, 1);
      ctx.fillStyle = 'rgba(186, 224, 255, 0.55)';
      ctx.fillRect(1, 1, 1, 1);
      ctx.fillRect(3, 1, 1, 1);
      ctx.fillRect(1, 3, 1, 1);
      ctx.fillRect(3, 3, 1, 1);
      ctx.fillStyle = '#e4f3ff';
      ctx.fillRect(2, 1, 1, 3);
      ctx.fillRect(1, 2, 3, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(2, 2, 1, 1);
    } else {
      // Crisp 3x3 '+' crystal flake
      ctx.fillStyle = 'rgba(176, 218, 252, 0.72)';
      ctx.fillRect(1, 0, 1, 3);
      ctx.fillRect(0, 1, 3, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(1, 1, 1, 1);
    }
    return c;
  }

  const snowHeroSprite = bakeSnowSprite('hero');
  const snowMidSprite = bakeSnowSprite('mid');

  /* 5. Pre-baked undulating translucent RISING HEAT shimmer ribbon sprites */
  function bakeHeatRibbon(phaseSeed, bw, bh) {
    const c = document.createElement('canvas');
    c.width = bw;
    c.height = bh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < bh; y++) {
      const v = y / Math.max(1, bh - 1);
      // Taper smoothly to zero at both top and bottom ends
      const env = Math.sin(v * Math.PI);
      const center = bw * 0.5 + Math.sin(v * Math.PI * 2.4 + phaseSeed) * (bw * 0.22);
      const halfW = Math.max(0.75, 1.35 * env);
      for (let x = 0; x < bw; x++) {
        const dist = Math.abs(x + 0.5 - center) / halfW;
        if (dist > 1.15) continue;
        const bayer = BAYER2[((y & 1) << 1) | (x & 1)] / 4;
        const core = clamp(1 - dist, 0, 1);
        const a = env * (0.16 + core * 0.34);
        if (a < 0.08 + bayer * 0.04) continue;
        // Warmer amber near lower base, shimmering pale peach-gold higher up
        const r = 255;
        const g = Math.round(146 + (1 - v) * 76);
        const b = Math.round(62 + (1 - v) * 96);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const heatRibbonSprites = [
    bakeHeatRibbon(0.0, 7, 16),
    bakeHeatRibbon(2.1, 7, 18),
    bakeHeatRibbon(4.2, 9, 20)
  ];

  /* 6. Pre-baked VILLAGE DUST glowing sunlit mote & dandelion fluff sprites */
  function bakeDustMoteSprite(warmGold) {
    const c = document.createElement('canvas');
    c.width = 3;
    c.height = 3;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = warmGold ? 'rgba(255, 214, 134, 0.30)' : 'rgba(245, 224, 178, 0.24)';
    ctx.fillRect(1, 0, 1, 3);
    ctx.fillRect(0, 1, 3, 1);
    ctx.fillStyle = warmGold ? '#fff5d6' : '#f5e4be';
    ctx.fillRect(1, 1, 1, 1);
    return c;
  }

  function bakeDandelionSprite() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // Delicate sunlit fluff crown + tiny trailing stem
    ctx.fillStyle = 'rgba(255, 245, 220, 0.65)';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(2, 0, 1, 1);
    ctx.fillRect(3, 1, 1, 1);
    ctx.fillStyle = '#fff8e3';
    ctx.fillRect(1, 0, 1, 2);
    ctx.fillRect(2, 1, 1, 1);
    ctx.fillStyle = 'rgba(224, 198, 148, 0.78)';
    ctx.fillRect(1, 2, 1, 1);
    ctx.fillRect(2, 3, 1, 1);
    return c;
  }

  const dustGoldSprite = bakeDustMoteSprite(true);
  const dustSoftSprite = bakeDustMoteSprite(false);
  const dandelionSprite = bakeDandelionSprite();

  /* 7. Pre-baked subtle Bayer-dithered pixel nebula band for STARS night sky */
  function bakeNebulaBand(seed, bw, bh, tintRgb) {
    const c = document.createElement('canvas');
    c.width = bw;
    c.height = bh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const [tr, tg, tb] = tintRgb;

    for (let y = 0; y < bh; y++) {
      const v = y / Math.max(1, bh - 1);
      for (let x = 0; x < bw; x++) {
        const u = x / Math.max(1, bw - 1);
        const dx = (u - 0.5) * 2;
        const dy = (v - 0.5) * 2;
        const wave = 0.22 * Math.sin(u * Math.PI * 3 + seed);
        const dist = Math.hypot(dx, (dy + wave) * 1.45);
        if (dist >= 1) continue;
        const density = Math.pow(1 - dist, 1.8) * (0.68 + 0.32 * Math.sin(u * 13 + v * 9 + seed));
        const bayer = BAYER2[((y & 1) << 1) | (x & 1)] / 4;
        if (density < 0.08 + bayer * 0.14) continue;
        const a = clamp(Math.round(density * 5) / 5, 0, 1) * 0.16;
        ctx.fillStyle = `rgba(${tr}, ${tg}, ${tb}, ${a.toFixed(3)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const nebulaSprites = [
    bakeNebulaBand(0.7, 96, 38, [104, 134, 214]),
    bakeNebulaBand(2.9, 88, 34, [154, 118, 206])
  ];

  /* 8. Pre-baked tiny tumbling pixel leaf frames for WIND */
  function bakeLeafFrame(pose, colMain, colHi) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 3;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = colMain;
    if (pose === 0) {
      ctx.fillRect(1, 0, 2, 1);
      ctx.fillRect(0, 1, 4, 1);
      ctx.fillRect(1, 2, 2, 1);
      ctx.fillStyle = colHi;
      ctx.fillRect(1, 0, 1, 1);
      ctx.fillRect(1, 1, 2, 1);
    } else {
      ctx.fillRect(0, 0, 2, 1);
      ctx.fillRect(1, 1, 2, 1);
      ctx.fillRect(2, 2, 2, 1);
      ctx.fillStyle = colHi;
      ctx.fillRect(1, 1, 1, 1);
    }
    return c;
  }

  const windLeaves = [
    [bakeLeafFrame(0, '#78a862', '#a8d688'), bakeLeafFrame(1, '#78a862', '#a8d688')],
    [bakeLeafFrame(0, '#c89248', '#f2c478'), bakeLeafFrame(1, '#c89248', '#f2c478')],
    [bakeLeafFrame(0, '#b8724c', '#e6a06e'), bakeLeafFrame(1, '#b8724c', '#e6a06e')]
  ];

  /* Cloud backdrop placement layout */
  const clouds = [];
  for (let i = 0; i < 15; i++) {
    const layer = i % 3;
    const spriteIdx = layer === 0
      ? (i % 2)
      : (layer === 1 ? (2 + (i % 3)) : (5 + (i % 2)));
    const sp = cloudSprites[spriteIdx];
    const pxScale = layer === 0 ? 2 : (layer === 1 ? 3 : (i % 2 === 0 ? 3 : 4));
    clouds.push({
      x: (i * 173 + layer * 61) % 1560,
      yFrac: 0.05 + layer * 0.105 + ((i * 37) % 100) * 0.0013,
      sprite: sp,
      drawW: sp.width * pxScale,
      drawH: sp.height * pxScale,
      layer,
      phase: i * 1.37,
      speedMult: 0.36 + layer * 0.34 + ((i * 13) % 10) * 0.025
    });
  }

  let windX = 0;
  let windY = 0;
  let mistScroll = 0;
  let cloudScroll = 0;
  let envTime = 0;

  function intensityMult(opts) {
    const m = opts && opts.intensity;
    if (m === 'SUBTLE') return 0.55;
    if (m === 'HEAVY') return 1.55;
    return 1.0;
  }

  function windStrengthForce(opts) {
    const s = opts && opts.windStrength;
    if (s === 'BREEZE') return 42;
    if (s === 'GALE') return 138;
    return 84;
  }

  function reset() {
    particles.length = 0;
    splashes.length = 0;
    shootingStars.length = 0;
    for (const k in levels) levels[k] = 0;
    windX = 0;
    windY = 0;
    SFX.stopEnvironmentAudio();
  }

  function spawnEnvParticle(pt) {
    if (particles.length >= 560) particles.shift();
    particles.push(pt);
  }

  /* Helper: crisp pixel-stepped line/ribbon segment (zero blurry vector hairlines) */
  function drawSteppedPixelStreak(ctx, x0, y0, x1, y1, stepPx, segSize) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.min(18, Math.ceil(dist / Math.max(0.4, stepPx))));
    const inv = 1 / steps;
    for (let s = 0; s <= steps; s++) {
      const t = s * inv;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      ctx.fillRect(px - segSize * 0.5, py - segSize * 0.5, segSize, segSize);
    }
  }

  function update(world, dt) {
    if (!world || dt <= 0) return;
    envTime += dt;

    const ref = getLightRefPoint();
    const target = {
      RAIN: 0,
      SNOW: 0,
      'VILLAGE DUST': 0,
      'RISING HEAT': 0,
      MIST: 0,
      STEAM: 0,
      CLOUDS: 0,
      STARS: 0,
      WIND: 0
    };
    let targetWindX = 0;
    let targetWindY = 0;
    let windWeightSum = 0;
    const steamSources = [];
    const heatSources = [];

    const topLeft = screenToWorld(0, 0);
    const botRight = screenToWorld(viewport.width, viewport.height);
    const viewW = Math.max(TILE * 6, botRight.wx - topLeft.wx);
    const viewH = Math.max(TILE * 6, botRight.wy - topLeft.wy);

    const processTile = (sp, tx, ty, fade) => {
      if (!sp || sp.type !== 'ENVIRONMENT' || fade <= 0.002) return;
      const prox = getAtmosphereProximity(tx, ty, ref.x, ref.y, ENV_CORE_RADIUS, ENV_PROXIMITY_RADIUS);
      if (prox <= 0.002) return;

      const sub = sp.subType || 'RAIN';
      const opts = sp.envOpts || defaultEnvOpts();
      const mult = intensityMult(opts);
      const w = prox * fade;

      if (sub === 'WIND') {
        const baseForce = windStrengthForce(opts);
        const dir = opts.windDir || 'RIGHT';
        let dirFactor = 1;
        if (dir === 'LEFT') {
          dirFactor = -(0.84 + 0.16 * Math.sin(envTime * 1.3 + tx * 0.4) + 0.10 * Math.sin(envTime * 2.9 + ty));
        } else if (dir === 'GUSTY') {
          dirFactor = Math.sin(envTime * 0.48 + tx * 0.2) * 0.85 + Math.sin(envTime * 1.45 + ty * 0.3) * 0.45;
        } else {
          dirFactor = 0.84 + 0.16 * Math.sin(envTime * 1.3 + tx * 0.4) + 0.10 * Math.sin(envTime * 2.9 + ty);
        }
        targetWindX += baseForce * dirFactor * w;
        targetWindY += Math.sin(envTime * 2.1 + tx * 0.5) * (baseForce * 0.08) * w;
        windWeightSum += w;
        if (w > target.WIND) target.WIND = w;
      } else {
        const val = Math.min(1.6, w * mult);
        if (val > (target[sub] || 0)) target[sub] = val;
        if (sub === 'STEAM') {
          steamSources.push({ wx: tx * TILE + TILE * 0.5, wy: ty * TILE + 4, w: w * mult });
        } else if (sub === 'RISING HEAT') {
          heatSources.push({ wx: tx * TILE + TILE * 0.5, wy: ty * TILE + TILE * 0.4, w: w * mult });
        }
      }
    };

    const bgIdx = getBgEffectIndex(world);
    const envEntries = bgIdx.envs;
    for (let i = 0; i < envEntries.length; i++) {
      const entry = envEntries[i];
      processTile(entry.sp, entry.tx, entry.ty, getBgEffectFadeIn(entry.key));
    }

    for (let i = 0; i < worldFX.bgFadeOuts.length; i++) {
      const entry = worldFX.bgFadeOuts[i];
      if (!entry.sp || entry.sp.type !== 'ENVIRONMENT') continue;
      processTile(entry.sp, entry.tx, entry.ty, getBgEffectFadeOut(entry));
    }

    if (windWeightSum > 1) {
      targetWindX /= Math.sqrt(windWeightSum);
      targetWindY /= Math.sqrt(windWeightSum);
    }

    const smoothK = 1 - Math.exp(-4.5 * dt);
    windX += (targetWindX - windX) * smoothK;
    windY += (targetWindY - windY) * smoothK;
    if (Math.abs(windX) < 0.05 && Math.abs(targetWindX) < 0.05) windX = 0;

    for (const k in levels) {
      levels[k] += (target[k] - levels[k]) * smoothK;
      if (levels[k] < 0.002 && target[k] === 0) levels[k] = 0;
    }

    const baseCloudSpeed = 9;
    cloudScroll += (baseCloudSpeed + windX * 0.65) * dt;
    mistScroll += (7 + windX * 0.55) * dt;

    const emitCount = rate => {
      const expected = rate * dt;
      const whole = Math.floor(expected);
      return whole + (Math.random() < (expected - whole) ? 1 : 0);
    };

    // 1. RAIN — 3-depth crisp pixel-stepped rain shafts with bright droplet heads & surface splash crowns
    if (levels.RAIN > 0.01) {
      const n = emitCount(78 * levels.RAIN);
      const upwindPad = Math.abs(windX) * 0.95 + 44;
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        const layer = r < 0.34 ? 0 : (r < 0.80 ? 1 : 2); // 0=far drizzle, 1=mid, 2=foreground hero raindrop
        const speedY = layer === 0
          ? (128 + Math.random() * 34)
          : (layer === 1 ? (184 + Math.random() * 48) : (225 + Math.random() * 52));
        spawnEnvParticle({
          kind: 'RAIN',
          layer,
          x: topLeft.wx - upwindPad + Math.random() * (viewW + upwindPad * 2),
          y: topLeft.wy - 10 - Math.random() * 20,
          vx: windX * (0.88 + layer * 0.16) - (6 + layer * 4) + (Math.random() - 0.5) * 10,
          vy: speedY,
          life: 1.5,
          maxLife: 1.5,
          color: layer === 0 ? '#5c93c4' : (layer === 1 ? '#82c5f2' : '#b2e2ff'),
          headColor: layer === 0 ? '#a4d3f5' : '#eefaff',
          alpha: layer === 0 ? (0.34 + Math.random() * 0.18) : (layer === 1 ? (0.64 + Math.random() * 0.22) : (0.84 + Math.random() * 0.16)),
          phase: Math.random() * 6.28
        });
      }
    }

    // 2. SNOW — 3-tier crisp pixel crystal flakes (distant specks, 3x3 '+' crystals, 5x5 star hero flakes)
    if (levels.SNOW > 0.01) {
      const n = emitCount(40 * levels.SNOW);
      const upwindPad = Math.abs(windX) * 1.35 + 42;
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        const tier = r < 0.36 ? 0 : (r < 0.78 ? 1 : 2);
        const maxL = tier === 0 ? (5.2 + Math.random() * 2.2) : (4.5 + Math.random() * 2.0);
        spawnEnvParticle({
          kind: 'SNOW',
          tier,
          x: topLeft.wx - upwindPad + Math.random() * (viewW + upwindPad * 2),
          y: Math.random() < 0.78 ? (topLeft.wy - 8 - Math.random() * 14) : (topLeft.wy + Math.random() * viewH * 0.55),
          vx: windX * (0.62 + tier * 0.18) + (Math.random() - 0.5) * 14,
          vy: tier === 0 ? (10 + Math.random() * 7) : (tier === 1 ? (16 + Math.random() * 10) : (21 + Math.random() * 11)),
          life: maxL,
          maxLife: maxL,
          size: tier === 0 ? 0.9 : (tier === 1 ? 2.1 : 3.2),
          color: tier === 0 ? '#9dc2ea' : '#eef6ff',
          alpha: tier === 0 ? (0.44 + Math.random() * 0.22) : (tier === 1 ? (0.76 + Math.random() * 0.2) : (0.88 + Math.random() * 0.12)),
          phase: Math.random() * 6.28,
          freq: 1.45 + Math.random() * 1.35,
          stuck: false
        });
      }
    }

    // 3. VILLAGE DUST — warm sunlit glowing pollen motes & drifting dandelion fluff wisps
    if (levels['VILLAGE DUST'] > 0.01) {
      const n = emitCount(22 * levels['VILLAGE DUST']);
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        const variant = r < 0.16 ? 'fluff' : (r < 0.58 ? 'gold' : 'soft');
        const maxL = variant === 'fluff' ? (4.2 + Math.random() * 2.6) : (3.0 + Math.random() * 2.4);
        spawnEnvParticle({
          kind: 'VILLAGE DUST',
          variant,
          x: topLeft.wx - 18 + Math.random() * (viewW + 36),
          y: topLeft.wy - 8 + Math.random() * (viewH + 16),
          vx: windX * (variant === 'fluff' ? 0.72 : 0.52) + (Math.random() - 0.5) * 10,
          vy: (variant === 'fluff' ? -2.5 : 0) + (Math.random() - 0.5) * 7,
          life: maxL,
          maxLife: maxL,
          size: variant === 'fluff' ? 3.2 : (variant === 'gold' ? 2.1 : 1.5),
          alpha: variant === 'gold' ? (0.72 + Math.random() * 0.24) : (0.58 + Math.random() * 0.28),
          phase: Math.random() * 6.28
        });
      }
    }

    // 4. RISING HEAT — undulating translucent heat-shimmer ribbons + white-hot/amber ember cinders
    if (levels['RISING HEAT'] > 0.01) {
      const n = emitCount(28 * levels['RISING HEAT']);
      for (let i = 0; i < n; i++) {
        const fromTile = heatSources.length > 0 && Math.random() < 0.58;
        let sx, sy;
        if (fromTile) {
          const src = heatSources[Math.floor(Math.random() * heatSources.length)];
          sx = src.wx + (Math.random() - 0.5) * TILE * 2.4;
          sy = src.wy + (Math.random() - 0.5) * TILE * 0.7;
        } else {
          sx = topLeft.wx - 16 + Math.random() * (viewW + 32);
          sy = topLeft.wy + viewH * (0.48 + Math.random() * 0.58);
        }
        const isSpark = Math.random() < 0.56;
        const maxL = isSpark ? (1.15 + Math.random() * 1.05) : (1.35 + Math.random() * 0.95);
        spawnEnvParticle({
          kind: 'RISING HEAT',
          isSpark,
          spriteIdx: Math.floor(Math.random() * heatRibbonSprites.length),
          x: sx,
          y: sy,
          vx: windX * 0.45 + (Math.random() - 0.5) * 14,
          vy: isSpark ? -(28 + Math.random() * 30) : -(16 + Math.random() * 14),
          life: maxL,
          maxLife: maxL,
          size: isSpark ? (Math.random() < 0.35 ? 1.35 : 0.95) : (3.6 + Math.random() * 2.2),
          alpha: isSpark ? 0.95 : (0.56 + Math.random() * 0.26),
          phase: Math.random() * 6.28
        });
      }
    }

    // 5. STEAM — sculpted volumetric Bayer-dithered billowing vapor puffs
    if (levels.STEAM > 0.01) {
      const n = emitCount(22 * levels.STEAM);
      for (let i = 0; i < n; i++) {
        let sx, sy;
        if (steamSources.length > 0 && Math.random() < 0.80) {
          const src = steamSources[Math.floor(Math.random() * steamSources.length)];
          sx = src.wx + (Math.random() - 0.5) * (TILE * 0.75);
          sy = src.wy + (Math.random() - 0.5) * 3;
        } else {
          sx = topLeft.wx + Math.random() * viewW;
          sy = topLeft.wy + viewH * (0.64 + Math.random() * 0.36);
        }
        const maxL = 1.7 + Math.random() * 1.25;
        const baseSize = 4.2 + Math.random() * 2.2;
        spawnEnvParticle({
          kind: 'STEAM',
          spriteIdx: Math.floor(Math.random() * steamSprites.length),
          flipX: Math.random() < 0.5 ? -1 : 1,
          x: sx,
          y: sy,
          vx: windX * 0.34 + (Math.random() - 0.5) * 10,
          vy: -(18 + Math.random() * 16),
          life: maxL,
          maxLife: maxL,
          size: baseSize,
          baseSize,
          alpha: 0.48 + Math.random() * 0.22,
          phase: Math.random() * 6.28
        });
      }
    }

    // 6. MIST — subtle world-space drifting vapor wisps weaving around terrain & player
    if (levels.MIST > 0.08) {
      const n = emitCount(7 * levels.MIST);
      for (let i = 0; i < n; i++) {
        const maxL = 3.2 + Math.random() * 2.2;
        spawnEnvParticle({
          kind: 'MIST_WISP',
          spriteIdx: Math.floor(Math.random() * steamSprites.length),
          x: topLeft.wx - 16 + Math.random() * (viewW + 32),
          y: topLeft.wy + viewH * (0.45 + Math.random() * 0.55),
          vx: 8 + windX * 0.45 + (Math.random() - 0.5) * 6,
          vy: (Math.random() - 0.5) * 2.5,
          life: maxL,
          maxLife: maxL,
          w: 14 + Math.random() * 12,
          h: 5.5 + Math.random() * 4.5,
          alpha: 0.16 + Math.random() * 0.12,
          phase: Math.random() * 6.28
        });
      }
    }

    // 7. WIND — crisp pixel-stepped curling breeze ribbons + tumbling pixel leaves & air flecks
    if (levels.WIND > 0.01 && Math.abs(windX) > 6) {
      const n = emitCount(16 * levels.WIND * clamp(Math.abs(windX) / 65, 0.45, 1.8));
      const dir = windX >= 0 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const maxL = 0.72 + Math.random() * 0.58;
        const r = Math.random();
        const subKind = r < 0.62 ? 'ribbon' : (r < 0.84 ? 'leaf' : 'speck');
        spawnEnvParticle({
          kind: 'WIND',
          subKind,
          curls: subKind === 'ribbon' && Math.random() < 0.34,
          leafIdx: Math.floor(Math.random() * windLeaves.length),
          x: dir > 0 ? (topLeft.wx - 24 + Math.random() * viewW * 0.72) : (botRight.wx + 24 - Math.random() * viewW * 0.72),
          y: topLeft.wy + Math.random() * viewH,
          vx: windX * (subKind === 'ribbon' ? (1.35 + Math.random() * 0.5) : (0.95 + Math.random() * 0.4)),
          vy: windY + (Math.random() - 0.5) * 16,
          life: maxL,
          maxLife: maxL,
          size: subKind === 'ribbon' ? (9 + Math.random() * 11) : (subKind === 'leaf' ? 3.2 : 1.0),
          color: subKind === 'ribbon' ? (Math.random() < 0.45 ? '#eef6ff' : '#bfd8f2') : '#f6e1be',
          alpha: subKind === 'ribbon' ? (0.34 + Math.random() * 0.24) : (subKind === 'leaf' ? 0.88 : 0.65),
          phase: Math.random() * 6.28
        });
      }
    }

    // 8. STARS — occasional crisp pixel shooting stars with glowing dust trails
    if (levels.STARS > 0.08 && Math.random() < dt * 0.32 * levels.STARS && shootingStars.length < 3) {
      const dir = Math.random() > 0.4 ? 1 : -1;
      shootingStars.push({
        x: Math.random() * viewport.width,
        y: Math.random() * viewport.height * 0.42,
        vx: dir * (220 + Math.random() * 140),
        vy: 55 + Math.random() * 65,
        life: 0.48 + Math.random() * 0.32,
        maxLife: 0.8,
        tint: Math.random() < 0.4 ? '#ffe9be' : '#d6ebff'
      });
    }

    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const ss = shootingStars[i];
      ss.life -= dt;
      if (ss.life <= 0) {
        shootingStars.splice(i, 1);
        continue;
      }
      ss.x += ss.vx * dt;
      ss.y += ss.vy * dt;
    }

    // Step rain impact splashes & expanding micro-ripples
    for (let i = splashes.length - 1; i >= 0; i--) {
      const sp = splashes[i];
      sp.life -= dt;
      if (sp.life <= 0) {
        splashes.splice(i, 1);
        continue;
      }
      if (sp.kind !== 'ring') {
        sp.vy += 180 * dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
      }
    }

    // Step all physics environmental particles
    const windPull = 1 - Math.exp(-3.4 * dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      if (p.kind === 'RAIN') {
        const isFar = p.layer === 0;
        p.vx += (windX * (0.88 + p.layer * 0.16) - (6 + p.layer * 4) - p.vx) * (1 - Math.exp(-5 * dt));
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        const tx = Math.floor(nx / TILE);
        const ty = Math.floor(ny / TILE);
        const hitWater = !isFar && getMainTileType(world, tx, ty) === 'LIQUID' && getMainTileType(world, tx, ty - 1) !== 'LIQUID';
        const hitSurface = !isFar && (isFullSolidAt(world, tx, ty) || isOneWayAt(world, tx, ty));
        if (hitSurface || hitWater) {
          const hitY = Math.min(ny, ty * TILE + (hitWater ? 1.5 : 0));
          if (splashes.length < 220) {
            splashes.push({
              kind: 'ring',
              x: nx,
              y: hitY,
              maxRx: hitWater ? (3.5 + Math.random() * 2.2) : (2.4 + Math.random() * 1.4),
              life: hitWater ? 0.24 : 0.17,
              maxLife: hitWater ? 0.24 : 0.17,
              color: hitWater ? '#e8f9ff' : '#bce6fc'
            });
            const dropCount = p.layer === 2 ? 3 : 2;
            for (let s = 0; s < dropCount; s++) {
              const dir = s === 0 ? -1 : (s === 1 ? 1 : (Math.random() < 0.5 ? -0.45 : 0.45));
              splashes.push({
                kind: 'drop',
                x: nx,
                y: hitY - 0.5,
                vx: dir * (10 + Math.random() * 17) + windX * 0.12,
                vy: -(18 + Math.random() * 26),
                life: 0.14 + Math.random() * 0.12,
                maxLife: 0.26,
                color: Math.random() > 0.35 ? '#9cd5f6' : '#effaff'
              });
            }
          }
          particles.splice(i, 1);
          continue;
        }
        p.x = nx;
        p.y = ny;
        if (p.y > botRight.wy + 28) particles.splice(i, 1);
      } else if (p.kind === 'SNOW') {
        if (p.stuck) continue;
        const freq = p.freq || 2.0;
        const sway = Math.sin(envTime * freq + p.phase) * (10 + p.tier * 4.5)
          + Math.cos(envTime * freq * 0.58 + p.phase * 1.7) * 5.5;
        p.vx += (windX * (0.68 + p.tier * 0.16) + sway - p.vx) * windPull;
        const gustLift = Math.abs(windX) > 65 ? Math.sin(envTime * 3.6 + p.phase) * 9.5 : 0;
        const nx = p.x + p.vx * dt;
        const ny = p.y + (p.vy + gustLift) * dt;
        const tx = Math.floor(nx / TILE);
        const ty = Math.floor(ny / TILE);
        if (p.tier > 0 && (isFullSolidAt(world, tx, ty) || isOneWayAt(world, tx, ty))) {
          if (p.y <= ty * TILE + 2.8) {
            p.x = nx;
            p.y = ty * TILE - 0.6;
            p.vx = 0;
            p.vy = 0;
            p.stuck = true;
            p.life = Math.min(p.life, 1.3 + Math.random() * 1.1);
            p.maxLife = p.life;
          } else {
            p.life = Math.min(p.life, 0.14);
          }
          continue;
        }
        p.x = nx;
        p.y = ny;
        if (p.y > botRight.wy + 24) particles.splice(i, 1);
      } else if (p.kind === 'VILLAGE DUST') {
        const amp = p.variant === 'fluff' ? 14 : 9.5;
        const driftX = Math.sin(envTime * 1.15 + p.phase) * amp;
        const driftY = Math.cos(envTime * 1.45 + p.phase * 1.3) * (p.variant === 'fluff' ? 6 : 7);
        p.vx += (windX * (p.variant === 'fluff' ? 0.78 : 0.62) + driftX - p.vx) * windPull;
        p.vy += (driftY + windY * 0.35 - p.vy) * windPull;
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        if (!isFullSolidAt(world, Math.floor(nx / TILE), Math.floor(ny / TILE))) {
          p.x = nx;
          p.y = ny;
        } else {
          p.vx = -p.vx * 0.5;
          p.vy = -p.vy * 0.5;
        }
      } else if (p.kind === 'RISING HEAT') {
        const shimmerX = Math.sin(envTime * (p.isSpark ? 5.6 : 4.2) + p.phase) * (p.isSpark ? 15 : 9);
        p.vx += (windX * 0.62 + shimmerX - p.vx) * windPull;
        p.vy = Math.max(p.isSpark ? -76 : -40, p.vy - (p.isSpark ? 12 : 6) * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.kind === 'STEAM') {
        const curlX = Math.sin(envTime * 2.1 + p.phase) * 9.5;
        p.vx += (windX * 0.78 + curlX - p.vx) * windPull;
        p.vy *= Math.exp(-0.52 * dt);
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        if (isFullSolidAt(world, Math.floor(nx / TILE), Math.floor(ny / TILE))) {
          p.vy = 0;
          p.vx += (windX !== 0 ? Math.sign(windX) : (p.phase > 3.14 ? 1 : -1)) * 24 * dt;
          p.x += p.vx * dt;
        } else {
          p.x = nx;
          p.y = ny;
        }
        const age = 1 - p.life / p.maxLife;
        p.size = (p.baseSize || 4.5) + age * 6.8;
      } else if (p.kind === 'MIST_WISP') {
        p.vx += (8 + windX * 0.55 - p.vx) * (1 - Math.exp(-2.2 * dt));
        p.x += p.vx * dt;
        p.y += (p.vy + Math.sin(envTime * 0.9 + p.phase) * 2.2) * dt;
      } else if (p.kind === 'WIND') {
        const waveAmp = p.subKind === 'leaf' ? 28 : 16;
        p.vy += Math.sin(envTime * (p.subKind === 'leaf' ? 7.5 : 5.8) + p.phase) * waveAmp * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
  }

  /* Screen-space deep sky backdrop: STARS, CLOUDS & warm VILLAGE DUST sunbeams (behind tiles) */
  function drawBackdrop() {
    const starA = clamp(levels.STARS, 0, 1);
    const cloudA = clamp(levels.CLOUDS, 0, 1);
    const dustA = clamp(levels['VILLAGE DUST'], 0, 1);
    if (starA <= 0.002 && cloudA <= 0.002 && dustA <= 0.002) return;

    wCtx.save();
    wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    wCtx.imageSmoothingEnabled = false;

    // 1. STARS — subtle pixel nebula bands + 3-tier twinkling parallax starfield + pixel shooting stars
    if (starA > 0.002) {
      // Soft Bayer-dithered distant nebula clouds
      const nebSpan = Math.max(viewport.width + 420, 1500);
      for (let i = 0; i < 4; i++) {
        const sp = nebulaSprites[i % nebulaSprites.length];
        const drawW = sp.width * 4;
        const drawH = sp.height * 4;
        const rawX = i * 370 - camera.x * 0.05;
        const nx = Math.round((((rawX % nebSpan) + nebSpan) % nebSpan) - drawW);
        const ny = Math.round(viewport.height * (0.08 + (i % 2) * 0.19) - camera.y * 0.03);
        wCtx.globalAlpha = clamp(starA * 0.72, 0, 0.75);
        wCtx.drawImage(sp, nx, ny, drawW, drawH);
      }
      wCtx.globalAlpha = 1;

      const cell = 60;
      const parX = camera.x * 0.12;
      const parY = camera.y * 0.08;
      const startCx = Math.floor((parX - cell) / cell);
      const endCx = Math.ceil((parX + viewport.width + cell) / cell);
      const startCy = Math.floor((parY - cell) / cell);
      const endCy = Math.ceil((parY + viewport.height * 0.85 + cell) / cell);

      for (let cy = startCy; cy <= endCy; cy++) {
        for (let cx = startCx; cx <= endCx; cx++) {
          const h1 = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453;
          const f1 = h1 - Math.floor(h1);
          if (f1 < 0.30) continue;
          const h2 = Math.sin(cx * 269.5 + cy * 183.3) * 43758.5453;
          const f2 = h2 - Math.floor(h2);
          const h3 = Math.sin(cx * 419.2 + cy * 73.1) * 43758.5453;
          const f3 = h3 - Math.floor(h3);

          const sx = Math.round(cx * cell + f1 * cell - parX);
          const sy = Math.round(cy * cell + f2 * cell - parY);
          if (sx < -6 || sx > viewport.width + 6 || sy < -6 || sy > viewport.height * 0.86) continue;

          const twinkle = 0.42 + 0.58 * Math.sin(envTime * (1.3 + f3 * 2.8) + f1 * 20);
          const alpha = clamp(starA * (0.36 + f2 * 0.64) * twinkle, 0, 1);
          const isHero = f3 > 0.86;
          const sz = isHero ? 2 : 1;
          const tint = f3 > 0.72
            ? [255, 232, 188]
            : (f3 < 0.28 ? [174, 212, 255] : [238, 243, 255]);
          wCtx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha.toFixed(3)})`;
          wCtx.fillRect(sx, sy, sz, sz);
          // Hero 4-point pixel diamond twinkle flare
          if (isHero && twinkle > 0.68) {
            const flare = clamp((twinkle - 0.68) / 0.32, 0, 1);
            const arm = flare > 0.6 ? 3 : 2;
            wCtx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${(alpha * 0.46 * flare).toFixed(3)})`;
            wCtx.fillRect(sx - arm, sy, sz + arm * 2, 1);
            wCtx.fillRect(sx, sy - arm, 1, sz + arm * 2);
            wCtx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.85).toFixed(3)})`;
            wCtx.fillRect(sx, sy, 2, 2);
          }
        }
      }

      // Crisp pixel-stepped shooting stars with stardust tail
      for (let i = 0; i < shootingStars.length; i++) {
        const ss = shootingStars[i];
        const p = clamp(ss.life / ss.maxLife, 0, 1);
        const a = Math.sin(p * Math.PI) * starA * 0.95;
        const tailX = ss.x - ss.vx * 0.11;
        const tailY = ss.y - ss.vy * 0.11;
        for (let seg = 0; seg < 10; seg++) {
          const frac = seg / 10;
          const px = Math.round(ss.x + (tailX - ss.x) * frac);
          const py = Math.round(ss.y + (tailY - ss.y) * frac);
          const segA = a * (1 - frac) * (1 - frac);
          wCtx.globalAlpha = segA;
          wCtx.fillStyle = seg < 2 ? '#ffffff' : ss.tint;
          const sSz = seg < 2 ? 2 : 1;
          wCtx.fillRect(px, py, sSz, sSz);
        }
        // Subtle 4-point spark on shooting star head
        wCtx.globalAlpha = a;
        wCtx.fillStyle = '#ffffff';
        wCtx.fillRect(Math.round(ss.x) - 1, Math.round(ss.y), 4, 2);
        wCtx.fillRect(Math.round(ss.x), Math.round(ss.y) - 1, 2, 4);
      }
      wCtx.globalAlpha = 1;
    }

    // 2. CLOUDS — 3-layer pre-baked sculpted pixel-art cumulus & cirrus clouds with wind parallax
    if (cloudA > 0.002) {
      const spanW = Math.max(viewport.width + 380, 1480);
      for (let depth = 0; depth < 3; depth++) {
        const layerAlpha = clamp(cloudA * (depth === 0 ? 0.24 : (depth === 1 ? 0.36 : 0.48)), 0, 0.82);
        wCtx.globalAlpha = layerAlpha;
        for (let i = 0; i < clouds.length; i++) {
          const cl = clouds[i];
          if (cl.layer !== depth) continue;
          const par = 0.09 + cl.layer * 0.11;
          const rawX = cl.x + cloudScroll * cl.speedMult - camera.x * par;
          const sx = Math.round((((rawX % spanW) + spanW) % spanW) - cl.drawW - 20);
          const bob = Math.sin(envTime * (0.32 + cl.layer * 0.08) + cl.phase) * (1.8 + cl.layer * 1.1);
          const sy = Math.round(cl.yFrac * viewport.height - camera.y * (par * 0.32) + bob);
          if (sy < -cl.drawH - 20 || sy > viewport.height + 20) continue;
          wCtx.drawImage(cl.sprite, sx, sy, cl.drawW, cl.drawH);
        }
      }
      wCtx.globalAlpha = 1;
    }

    // 3. VILLAGE DUST — gentle warm diagonal golden sunbeams behind the world
    if (dustA > 0.04) {
      const beamSpan = viewport.width + 320;
      for (let b = 0; b < 4; b++) {
        const baseX = ((b * 340 - camera.x * 0.14 + Math.sin(envTime * 0.25 + b * 1.7) * 28) % beamSpan + beamSpan) % beamSpan - 120;
        const bw = 64 + (b % 2) * 42;
        const pulse = 0.65 + 0.35 * Math.sin(envTime * 0.7 + b * 2.1);
        const beamGrad = wCtx.createLinearGradient(baseX, 0, baseX + 120, viewport.height * 0.85);
        beamGrad.addColorStop(0, `rgba(255, 224, 156, ${(dustA * 0.075 * pulse).toFixed(4)})`);
        beamGrad.addColorStop(0.55, `rgba(255, 212, 134, ${(dustA * 0.042 * pulse).toFixed(4)})`);
        beamGrad.addColorStop(1, 'rgba(255, 200, 118, 0)');
        wCtx.fillStyle = beamGrad;
        wCtx.beginPath();
        wCtx.moveTo(baseX, 0);
        wCtx.lineTo(baseX + bw, 0);
        wCtx.lineTo(baseX + bw + 170, viewport.height * 0.92);
        wCtx.lineTo(baseX + 130, viewport.height * 0.92);
        wCtx.closePath();
        wCtx.fill();
      }
    }

    wCtx.restore();
  }

  /* Screen-space atmospheric veils: MIST fog banks, RAIN haze, SNOW chill, RISING HEAT underglow */
  function drawMistOverlay() {
    const mistA = clamp(levels.MIST, 0, 1);
    const rainA = clamp(levels.RAIN, 0, 1);
    const heatA = clamp(levels['RISING HEAT'], 0, 1);
    const snowA = clamp(levels.SNOW, 0, 1);
    if (mistA <= 0.002 && rainA <= 0.08 && heatA <= 0.06 && snowA <= 0.08) return;

    wCtx.save();
    wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    wCtx.imageSmoothingEnabled = false;

    // Subtle cool atmospheric rain depth haze
    if (rainA > 0.08) {
      const rGrad = wCtx.createLinearGradient(0, 0, 0, viewport.height);
      rGrad.addColorStop(0, `rgba(96, 136, 178, ${rainA * 0.07})`);
      rGrad.addColorStop(0.65, `rgba(118, 158, 196, ${rainA * 0.035})`);
      rGrad.addColorStop(1, `rgba(134, 176, 214, ${rainA * 0.10})`);
      wCtx.fillStyle = rGrad;
      wCtx.fillRect(0, 0, viewport.width, viewport.height);
    }

    // Subtle crisp pale-ice winter chill wash when snowing
    if (snowA > 0.08) {
      const sGrad = wCtx.createLinearGradient(0, 0, 0, viewport.height);
      sGrad.addColorStop(0, `rgba(190, 220, 250, ${snowA * 0.055})`);
      sGrad.addColorStop(0.55, 'rgba(190, 220, 250, 0)');
      sGrad.addColorStop(1, `rgba(176, 210, 245, ${snowA * 0.07})`);
      wCtx.fillStyle = sGrad;
      wCtx.fillRect(0, 0, viewport.width, viewport.height);
    }

    // Warm pulsing furnace/mirage lower underglow when RISING HEAT is active
    if (heatA > 0.06) {
      const pulse = 0.85 + 0.15 * Math.sin(envTime * 2.8);
      const hGrad = wCtx.createLinearGradient(0, viewport.height * 0.56, 0, viewport.height);
      hGrad.addColorStop(0, 'rgba(242, 118, 42, 0)');
      hGrad.addColorStop(0.6, `rgba(242, 118, 42, ${(heatA * 0.065 * pulse).toFixed(4)})`);
      hGrad.addColorStop(1, `rgba(255, 146, 58, ${(heatA * 0.16 * pulse).toFixed(4)})`);
      wCtx.fillStyle = hGrad;
      wCtx.fillRect(0, viewport.height * 0.56, viewport.width, viewport.height * 0.44);
    }

    // Layered organic feathered pixel-art MIST banks
    if (mistA > 0.002) {
      const baseGrad = wCtx.createLinearGradient(0, viewport.height * 0.28, 0, viewport.height);
      baseGrad.addColorStop(0, 'rgba(178, 198, 222, 0)');
      baseGrad.addColorStop(0.45, `rgba(182, 202, 226, ${mistA * 0.09})`);
      baseGrad.addColorStop(0.78, `rgba(194, 214, 236, ${mistA * 0.21})`);
      baseGrad.addColorStop(1, `rgba(206, 224, 244, ${mistA * 0.34})`);
      wCtx.fillStyle = baseGrad;
      wCtx.fillRect(0, viewport.height * 0.28, viewport.width, viewport.height * 0.72);

      const stretch = 1 + clamp(Math.abs(windX) / 95, 0, 0.75);
      for (let band = 0; band < 3; band++) {
        const sprite = mistSprites[band];
        const scaleX = (2.4 + band * 0.65) * stretch;
        const scaleY = 2.0 + band * 0.55;
        const bankW = Math.round(sprite.width * scaleX);
        const bankH = Math.round(sprite.height * scaleY);
        const spanW = viewport.width + bankW * 1.4;
        const speed = 0.55 + band * 0.42;
        const bandY = viewport.height * (0.50 + band * 0.145);
        const count = 4 + (band === 0 ? 1 : 0);
        wCtx.globalAlpha = clamp(mistA * (0.34 + band * 0.18), 0, 0.85);

        for (let j = 0; j < count; j++) {
          const spacing = spanW / count;
          const rawX = j * spacing + mistScroll * speed - camera.x * (0.18 + band * 0.12) + band * 95;
          const x = Math.round((((rawX % spanW) + spanW) % spanW) - bankW);
          const y = Math.round(bandY + Math.sin(envTime * (0.48 + band * 0.14) + j * 1.65 + band * 1.2) * (7 + band * 3));
          wCtx.drawImage(sprite, x, y, bankW, bankH);
        }
      }
      wCtx.globalAlpha = 1;
    }

    wCtx.restore();
  }

  /* World-space physics particles (RAIN, SNOW, VILLAGE DUST, RISING HEAT, STEAM, MIST_WISP, WIND) */
  function drawWorldParticles() {
    wCtx.save();
    wCtx.imageSmoothingEnabled = false;

    // Rain impact splash rings & micro-droplet crowns
    if (splashes.length > 0) {
      for (let i = 0; i < splashes.length; i++) {
        const s = splashes[i];
        const rem = clamp(s.life / s.maxLife, 0, 1);
        if (s.kind === 'ring') {
          const ease = 1 - rem * rem;
          const rx = Math.max(0.8, s.maxRx * ease);
          wCtx.globalAlpha = rem * 0.85;
          wCtx.fillStyle = s.color;
          wCtx.fillRect(s.x - rx, s.y - 0.5, rx * 2, 0.9);
          wCtx.fillRect(s.x - rx - 0.6, s.y - 1.3, 0.9, 0.9);
          wCtx.fillRect(s.x + rx - 0.3, s.y - 1.3, 0.9, 0.9);
        } else {
          wCtx.globalAlpha = rem * 0.9;
          wCtx.fillStyle = s.color;
          wCtx.fillRect(s.x - 0.45, s.y - 0.45, 0.9, 0.9);
        }
      }
    }

    if (particles.length === 0) {
      wCtx.restore();
      return;
    }

    const pxUnit = Math.max(0.5, 1 / Math.max(1, camera.zoom));

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const age = 1 - clamp(p.life / p.maxLife, 0, 1);
      const fade = age < 0.15 ? (age / 0.15) : clamp(p.life / (p.maxLife * 0.35), 0, 1);

      if (p.kind === 'RAIN') {
        const isFar = p.layer === 0;
        const trailT = p.layer === 0 ? 0.017 : (p.layer === 1 ? 0.025 : 0.032);
        const dx = p.vx * trailT;
        const dy = p.vy * trailT;
        const segSz = isFar ? Math.max(0.55, pxUnit * 0.85) : (p.layer === 2 ? Math.max(0.95, pxUnit * 1.15) : Math.max(0.75, pxUnit));
        // Stepped crisp pixel rain shaft (tapered upper tail + brighter lower shaft)
        wCtx.globalAlpha = p.alpha * (isFar ? 0.48 : 0.40);
        wCtx.fillStyle = p.color;
        drawSteppedPixelStreak(wCtx, p.x - dx * 0.45, p.y - dy * 0.45, p.x - dx, p.y - dy, segSz * 1.15, segSz * 0.85);
        wCtx.globalAlpha = p.alpha * (isFar ? 0.72 : 0.78);
        drawSteppedPixelStreak(wCtx, p.x, p.y, p.x - dx * 0.5, p.y - dy * 0.5, segSz * 1.05, segSz);
        if (!isFar) {
          wCtx.globalAlpha = p.alpha;
          wCtx.fillStyle = p.headColor || '#eefaff';
          wCtx.fillRect(p.x - segSz * 0.55, p.y - segSz * 0.55, segSz * 1.15, segSz * 1.15);
        }
      } else if (p.kind === 'SNOW') {
        const twinkle = p.tier === 2 && !p.stuck ? (0.80 + 0.20 * Math.sin(envTime * 5.4 + p.phase)) : 1;
        wCtx.globalAlpha = p.alpha * (p.stuck ? clamp(p.life / p.maxLife, 0, 1) : fade) * twinkle;
        if (p.stuck) {
          wCtx.fillStyle = '#e8f4ff';
          const fw = p.tier >= 2 ? 2.4 : 1.6;
          wCtx.fillRect(p.x - fw * 0.5, p.y - 0.5, fw, 0.95);
        } else if (p.tier === 2) {
          const s = p.size;
          wCtx.drawImage(snowHeroSprite, p.x - s * 0.5, p.y - s * 0.5, s, s);
        } else if (p.tier === 1) {
          const s = p.size;
          wCtx.drawImage(snowMidSprite, p.x - s * 0.5, p.y - s * 0.5, s, s);
        } else {
          wCtx.fillStyle = p.color;
          wCtx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
        }
      } else if (p.kind === 'VILLAGE DUST') {
        const shimmer = 0.55 + 0.45 * Math.sin(envTime * 3.1 + p.phase);
        wCtx.globalAlpha = p.alpha * fade * shimmer;
        if (p.variant === 'fluff') {
          const s = p.size;
          wCtx.drawImage(dandelionSprite, p.x - s * 0.5, p.y - s * 0.5, s, s);
        } else {
          const sp = p.variant === 'gold' ? dustGoldSprite : dustSoftSprite;
          const s = p.size;
          wCtx.drawImage(sp, p.x - s * 0.5, p.y - s * 0.5, s, s);
        }
      } else if (p.kind === 'RISING HEAT') {
        if (p.isSpark) {
          // Glowing ember cinder: white-hot core -> amber glow -> cooling crimson tail
          const flicker = 0.72 + 0.28 * Math.sin(envTime * 14 + p.phase);
          const s = p.size;
          // Trailing cooling ember tail
          wCtx.globalAlpha = p.alpha * fade * 0.42;
          wCtx.fillStyle = age > 0.55 ? '#b83c18' : '#e86822';
          wCtx.fillRect(p.x - p.vx * 0.025 - s * 0.4, p.y - p.vy * 0.028 - s * 0.4, s * 0.85, s * 0.85);
          // Warm amber halo
          wCtx.globalAlpha = p.alpha * fade * flicker * 0.45;
          wCtx.fillStyle = age > 0.6 ? '#d94d1e' : '#ff9a36';
          wCtx.fillRect(p.x - s * 1.1, p.y - s * 0.45, s * 2.2, s * 0.9);
          wCtx.fillRect(p.x - s * 0.45, p.y - s * 1.1, s * 0.9, s * 2.2);
          // Hot core
          wCtx.globalAlpha = p.alpha * fade * flicker;
          wCtx.fillStyle = age < 0.35 ? '#fff4cf' : (age < 0.7 ? '#ffc462' : '#e85b24');
          wCtx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
        } else {
          // Pre-baked undulating translucent thermal shimmer ribbon
          const sp = heatRibbonSprites[p.spriteIdx % heatRibbonSprites.length];
          const rw = p.size;
          const rh = rw * (sp.height / sp.width);
          const sway = Math.sin(envTime * 6.5 + p.phase) * 0.7;
          wCtx.globalAlpha = p.alpha * Math.sin(age * Math.PI) * 0.75;
          wCtx.drawImage(sp, p.x - rw * 0.5 + sway, p.y - rh * 0.5, rw, rh);
        }
      } else if (p.kind === 'STEAM') {
        const sp = steamSprites[p.spriteIdx % steamSprites.length];
        const envFade = age < 0.16 ? (age / 0.16) : Math.pow(1 - (age - 0.16) / 0.84, 1.35);
        wCtx.globalAlpha = p.alpha * clamp(envFade, 0, 1);
        const s = p.size;
        const sh = s * (sp.height / sp.width);
        if (p.flipX < 0) {
          wCtx.save();
          wCtx.translate(p.x, p.y);
          wCtx.scale(-1, 1);
          wCtx.drawImage(sp, -s * 0.5, -sh * 0.5, s, sh);
          wCtx.restore();
        } else {
          wCtx.drawImage(sp, p.x - s * 0.5, p.y - sh * 0.5, s, sh);
        }
      } else if (p.kind === 'MIST_WISP') {
        const sp = steamSprites[p.spriteIdx % steamSprites.length];
        wCtx.globalAlpha = p.alpha * Math.sin(age * Math.PI);
        wCtx.drawImage(sp, p.x - p.w * 0.5, p.y - p.h * 0.5, p.w, p.h);
      } else if (p.kind === 'WIND') {
        const envAlpha = p.alpha * Math.sin(age * Math.PI);
        if (p.subKind === 'ribbon') {
          // Crisp pixel-stepped wind gust ribbon with tapered brightness & occasional curl loop
          const dir = p.vx >= 0 ? 1 : -1;
          const len = p.size;
          const segCount = 10;
          const segSz = Math.max(0.75, pxUnit);
          for (let s = 0; s < segCount; s++) {
            const frac = s / (segCount - 1); // 0 = head, 1 = tail
            let rx = p.x - dir * len * frac;
            let ry = p.y + Math.sin(frac * Math.PI * 1.4 + p.phase) * 1.35;
            if (p.curls && frac > 0.58) {
              // Graceful iconic pixel wind-curl tail loop
              const ct = (frac - 0.58) / 0.42;
              const ang = ct * Math.PI * 1.55;
              rx += dir * Math.sin(ang) * 2.1;
              ry -= (1 - Math.cos(ang)) * 1.85;
            }
            const taper = Math.sin((1 - frac * 0.85) * Math.PI * 0.85);
            wCtx.globalAlpha = envAlpha * clamp(taper, 0.12, 1);
            wCtx.fillStyle = s < 2 ? '#f4f9ff' : p.color;
            wCtx.fillRect(rx - segSz * 0.5, ry - segSz * 0.5, segSz, segSz);
          }
        } else if (p.subKind === 'leaf') {
          const pair = windLeaves[p.leafIdx % windLeaves.length];
          const pose = Math.floor(envTime * 8 + p.phase) & 1;
          const sp = pair[pose];
          wCtx.globalAlpha = envAlpha;
          wCtx.drawImage(sp, p.x - p.size * 0.5, p.y - p.size * 0.375, p.size, p.size * 0.75);
        } else {
          wCtx.globalAlpha = envAlpha;
          wCtx.fillStyle = p.color;
          wCtx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
        }
      }
    }
    wCtx.restore();
  }

  /* Dedicated live Create Editor preview showcasing all 9 upgraded effects */
  function drawEditorPreview(ctx, dim, sub, opts, tNow) {
    const mult = intensityMult(opts);
    const countScale = Math.max(0.55, mult);
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    if (sub === 'RAIN') {
      const rGrad = ctx.createLinearGradient(0, 0, 0, dim);
      rGrad.addColorStop(0, 'rgba(96, 136, 178, 0.10)');
      rGrad.addColorStop(1, 'rgba(134, 176, 214, 0.16)');
      ctx.fillStyle = rGrad;
      ctx.fillRect(0, 0, dim, dim);

      const n = Math.round(26 * countScale);
      for (let i = 0; i < n; i++) {
        const layer = i % 5 === 0 ? 2 : (i % 3 === 0 ? 0 : 1);
        const seed = i * 37.3;
        const spd = layer === 0 ? 110 : (layer === 1 ? 158 : 196);
        const x = ((seed * 19 + tNow * (22 + layer * 14)) % (dim + 18)) - 9;
        const y = ((seed * 13 + tNow * spd) % (dim + 18)) - 9;
        const dx = 1.4 + layer * 0.75;
        const dy = 5.5 + layer * 2.6;
        ctx.globalAlpha = layer === 0 ? 0.34 : (layer === 1 ? 0.68 : 0.90);
        ctx.fillStyle = layer === 0 ? '#5c93c4' : (layer === 1 ? '#82c5f2' : '#b2e2ff');
        drawSteppedPixelStreak(ctx, x, y, x - dx, y - dy, 1.2, layer === 0 ? 1 : 1.3);
        if (layer > 0) {
          ctx.fillStyle = '#eefaff';
          ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
        }
      }
      for (let s = 0; s < 4; s++) {
        const p = (tNow * 2.2 + s * 0.27) % 1;
        const sx = 16 + ((s * 29 + Math.floor(tNow * 2.2 + s * 0.27) * 19) % (dim - 32));
        const rx = 1 + p * 5.5;
        ctx.globalAlpha = (1 - p) * 0.82;
        ctx.fillStyle = '#dcf5ff';
        ctx.fillRect(Math.round(sx - rx), dim - 5, Math.round(rx * 2), 1);
        ctx.fillRect(Math.round(sx - rx) - 1, dim - 6, 1, 1);
        ctx.fillRect(Math.round(sx + rx), dim - 6, 1, 1);
      }
    } else if (sub === 'SNOW') {
      const sGrad = ctx.createLinearGradient(0, 0, 0, dim);
      sGrad.addColorStop(0, 'rgba(182, 214, 248, 0.10)');
      sGrad.addColorStop(1, 'rgba(182, 214, 248, 0.04)');
      ctx.fillStyle = sGrad;
      ctx.fillRect(0, 0, dim, dim);

      const n = Math.round(24 * countScale);
      for (let i = 0; i < n; i++) {
        const tier = i % 5 === 0 ? 2 : (i % 3 === 0 ? 0 : 1);
        const x = ((i * 23 + Math.sin(tNow * (1.4 + tier * 0.3) + i) * (7 + tier * 3) + dim) % dim);
        const y = ((i * 19 + tNow * (14 + tier * 8 + (i % 3) * 4)) % dim);
        ctx.globalAlpha = tier === 0 ? 0.44 : (tier === 1 ? 0.78 : 0.94);
        if (tier === 2) {
          ctx.drawImage(snowHeroSprite, Math.round(x) - 3, Math.round(y) - 3, 7, 7);
        } else if (tier === 1) {
          ctx.drawImage(snowMidSprite, Math.round(x) - 2, Math.round(y) - 2, 4, 4);
        } else {
          ctx.fillStyle = '#9dc2ea';
          ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
        }
      }
    } else if (sub === 'VILLAGE DUST') {
      // Warm diagonal sunbeam across preview
      const bGrad = ctx.createLinearGradient(12, 0, dim * 0.75, dim);
      bGrad.addColorStop(0, 'rgba(255, 224, 152, 0.16)');
      bGrad.addColorStop(1, 'rgba(255, 200, 118, 0)');
      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.moveTo(dim * 0.15, 0);
      ctx.lineTo(dim * 0.56, 0);
      ctx.lineTo(dim * 0.92, dim);
      ctx.lineTo(dim * 0.42, dim);
      ctx.closePath();
      ctx.fill();

      const n = Math.round(20 * countScale);
      for (let i = 0; i < n; i++) {
        const x = ((i * 29 + tNow * 11 + Math.sin(tNow + i) * 8) % dim + dim) % dim;
        const y = ((i * 31 + Math.cos(tNow * 0.9 + i * 1.3) * 9) % dim + dim) % dim;
        ctx.globalAlpha = 0.46 + 0.42 * Math.sin(tNow * 2.5 + i);
        if (i % 6 === 0) {
          ctx.drawImage(dandelionSprite, Math.round(x) - 3, Math.round(y) - 3, 6, 6);
        } else {
          const sp = i % 2 === 0 ? dustGoldSprite : dustSoftSprite;
          const sz = i % 2 === 0 ? 4 : 3;
          ctx.drawImage(sp, Math.round(x) - sz * 0.5, Math.round(y) - sz * 0.5, sz, sz);
        }
      }
    } else if (sub === 'RISING HEAT') {
      const hGrad = ctx.createLinearGradient(0, dim * 0.45, 0, dim);
      hGrad.addColorStop(0, 'rgba(242, 118, 42, 0)');
      hGrad.addColorStop(1, 'rgba(255, 146, 58, 0.24)');
      ctx.fillStyle = hGrad;
      ctx.fillRect(0, dim * 0.45, dim, dim * 0.55);

      // Shimmering heat ribbons
      for (let r = 0; r < 5; r++) {
        const sp = heatRibbonSprites[r % heatRibbonSprites.length];
        const prog = ((tNow * 0.42 + r * 0.21) % 1);
        const x = 14 + ((r * 23) % (dim - 28)) + Math.sin(tNow * 5 + r * 2) * 3;
        const y = dim * 0.92 - prog * dim * 0.78;
        ctx.globalAlpha = Math.sin(prog * Math.PI) * 0.65;
        ctx.drawImage(sp, Math.round(x - 5), Math.round(y - 12), 10, 24);
      }
      // Rising glowing ember sparks
      const n = Math.round(14 * countScale);
      for (let i = 0; i < n; i++) {
        const prog = ((tNow * (0.55 + (i % 3) * 0.14) + i / n) % 1);
        const x = ((i * 19 + Math.sin(tNow * 4.5 + i) * 6) % dim + dim) % dim;
        const y = dim - prog * (dim + 8);
        ctx.globalAlpha = Math.sin(prog * Math.PI) * 0.92;
        ctx.fillStyle = prog < 0.4 ? '#ff9a36' : '#d94d1e';
        ctx.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
        ctx.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
        ctx.fillStyle = prog < 0.35 ? '#fff4cf' : (prog < 0.7 ? '#ffc462' : '#e85b24');
        ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
      }
    } else if (sub === 'MIST') {
      const grad = ctx.createLinearGradient(0, dim * 0.34, 0, dim);
      grad.addColorStop(0, 'rgba(186, 206, 228, 0)');
      grad.addColorStop(0.6, `rgba(194, 214, 236, ${clamp(0.18 * mult, 0.1, 0.32)})`);
      grad.addColorStop(1, `rgba(206, 224, 244, ${clamp(0.36 * mult, 0.2, 0.52)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, dim * 0.34, dim, dim * 0.66);
      for (let i = 0; i < 3; i++) {
        const sp = mistSprites[i];
        const mw = Math.round(sp.width * 0.72);
        const mh = Math.round(sp.height * 0.85);
        const span = dim + mw;
        const x = Math.round((((i * 44 + tNow * (10 + i * 5)) % span) + span) % span - mw);
        const y = Math.round(dim * (0.48 + i * 0.14) + Math.sin(tNow * 1.1 + i * 1.7) * 3);
        ctx.globalAlpha = clamp((0.42 + i * 0.16) * mult, 0.25, 0.88);
        ctx.drawImage(sp, x, y, mw, mh);
      }
      ctx.globalAlpha = 1;
    } else if (sub === 'STEAM') {
      const n = Math.round(12 * countScale);
      for (let i = 0; i < n; i++) {
        const sp = steamSprites[i % steamSprites.length];
        const prog = ((tNow * 0.42 + i / n) % 1);
        const x = dim * 0.5 + Math.sin(tNow * 2.2 + i * 1.9) * (5 + prog * 14);
        const y = dim * 0.88 - prog * dim * 0.74;
        const sz = 10 + prog * 18;
        ctx.globalAlpha = Math.sin(prog * Math.PI) * 0.68;
        ctx.drawImage(sp, Math.round(x - sz * 0.5), Math.round(y - sz * 0.5), Math.round(sz), Math.round(sz * (sp.height / sp.width)));
      }
    } else if (sub === 'CLOUDS') {
      const previewClouds = [
        { sp: cloudSprites[0], y: 12, spd: 8, a: 0.36, sc: 1 },
        { sp: cloudSprites[2], y: 28, spd: 13, a: 0.56, sc: 1 },
        { sp: cloudSprites[5], y: 48, spd: 18, a: 0.72, sc: 1 }
      ];
      for (let i = 0; i < previewClouds.length; i++) {
        const pc = previewClouds[i];
        const cw = pc.sp.width * pc.sc;
        const ch = pc.sp.height * pc.sc;
        const span = dim + cw + 14;
        const x = Math.round((((i * 46 + tNow * pc.spd) % span) + span) % span - cw);
        ctx.globalAlpha = clamp(pc.a * mult, 0.22, 0.9);
        ctx.drawImage(pc.sp, x, pc.y, cw, ch);
      }
      ctx.globalAlpha = 1;
    } else if (sub === 'STARS') {
      ctx.globalAlpha = 0.68;
      ctx.drawImage(nebulaSprites[0], -10, 6, dim + 20, 44);
      const n = Math.round(24 * countScale);
      for (let i = 0; i < n; i++) {
        const x = (i * 29 + 11) % dim;
        const y = (i * 17 + 7) % Math.floor(dim * 0.84);
        const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tNow * (2 + (i % 4)) + i));
        ctx.globalAlpha = tw;
        const isHero = i % 6 === 0;
        ctx.fillStyle = i % 4 === 0 ? '#ffe8bd' : (i % 3 === 0 ? '#b2d6ff' : '#eef3ff');
        ctx.fillRect(x, y, isHero ? 2 : 1, isHero ? 2 : 1);
        if (isHero && tw > 0.7) {
          ctx.globalAlpha = tw * 0.45;
          ctx.fillRect(x - 2, y, 6, 1);
          ctx.fillRect(x, y - 2, 1, 6);
        }
      }
      // Periodic preview shooting star
      const spProg = (tNow * 0.55) % 2.4;
      if (spProg < 0.75) {
        const p = spProg / 0.75;
        const sx = 14 + p * (dim - 24);
        const sy = 14 + p * 22;
        ctx.globalAlpha = Math.sin(p * Math.PI);
        ctx.fillStyle = '#ffe9be';
        drawSteppedPixelStreak(ctx, sx, sy, sx - 16, sy - 6, 1.5, 1.2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
      }
    } else if (sub === 'WIND') {
      const dir = opts && opts.windDir === 'LEFT' ? -1 : (opts && opts.windDir === 'GUSTY' ? Math.sign(Math.sin(tNow * 1.4)) || 1 : 1);
      const spd = opts && opts.windStrength === 'GALE' ? 140 : (opts && opts.windStrength === 'BREEZE' ? 52 : 92);
      for (let i = 0; i < 6; i++) {
        const raw = (i * 27 + tNow * spd * dir) % (dim + 36);
        const x = ((raw + dim + 36) % (dim + 36)) - 18;
        const y = 12 + i * 16 + Math.sin(tNow * 4 + i) * 3;
        const curls = i % 2 === 0;
        const baseA = 0.42 + (i % 3) * 0.14;
        for (let s = 0; s < 10; s++) {
          const frac = s / 9;
          let rx = x - dir * 24 * frac;
          let ry = y + Math.sin(frac * Math.PI * 1.4 + i) * 2.5;
          if (curls && frac > 0.6) {
            const ct = (frac - 0.6) / 0.4;
            const ang = ct * Math.PI * 1.5;
            rx += dir * Math.sin(ang) * 4;
            ry -= (1 - Math.cos(ang)) * 3.5;
          }
          ctx.globalAlpha = baseA * (1 - frac * 0.75);
          ctx.fillStyle = s < 2 ? '#f4f9ff' : '#bfd8f2';
          ctx.fillRect(Math.round(rx), Math.round(ry), 1.5, 1.5);
        }
      }
      // Tumbling leaves riding the wind
      for (let l = 0; l < 3; l++) {
        const raw = (l * 41 + tNow * spd * 0.72 * dir) % (dim + 20);
        const lx = ((raw + dim + 20) % (dim + 20)) - 10;
        const ly = 22 + l * 28 + Math.sin(tNow * 6 + l * 2) * 5;
        const sp = windLeaves[l % windLeaves.length][Math.floor(tNow * 7 + l) & 1];
        ctx.globalAlpha = 0.88;
        ctx.drawImage(sp, Math.round(lx), Math.round(ly), 6, 4.5);
      }
    }

    ctx.restore();
  }

  return {
    reset,
    update,
    drawBackdrop,
    drawMistOverlay,
    drawWorldParticles,
    drawEditorPreview,
    get windX() { return windX; },
    get windY() { return windY; },
    get levels() { return levels; }
  };
})();
