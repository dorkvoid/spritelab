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
   Runs smoothly in PLAY & BUILD modes with smooth multi-atmosphere crossfades.
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

  /* Deterministic 2x2 Bayer matrix for crisp pixel-art shading transitions */
  const BAYER2 = [0, 2, 3, 1];

  /* Pre-bake sculpted pixel-art cumulus & high-cirrus cloud sprites (zero overlap seams) */
  function bakeCloudSprite(spec) {
    const { w, h, lobes, wispy } = spec;
    const mask = new Uint8Array(w * h);

    // Paint merged elliptical cumulus lobes onto an integer pixel mask
    for (let li = 0; li < lobes.length; li++) {
      const [cx, cy, rx, ry] = lobes[li];
      const x0 = Math.max(0, Math.floor(cx - rx - 1));
      const x1 = Math.min(w - 1, Math.ceil(cx + rx + 1));
      const y0 = Math.max(0, Math.floor(cy - ry - 1));
      const y1 = Math.min(h - 1, Math.ceil(cy + ry + 1));
      for (let y = y0; y <= y1; y++) {
        const ny = (y + 0.5 - cy) / Math.max(0.5, ry);
        // Flatten underside slightly like real cumulus cloud bases
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

    // Soften horizontal base row slightly so the cloud sits on an organic flat-ish horizon
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

    // Precompute column top & bottom extents for volumetric top-lit shading
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
        const dither = BAYER2[((y & 1) << 1) | (x & 1)] / 4; // 0, 0.25, 0.5, 0.75

        // Check horizontal silhouette rim for delicate wispy tapering on edges
        const hasLeft = x > 0 && mask[y * w + (x - 1)];
        const hasRight = x < w - 1 && mask[y * w + (x + 1)];
        const isTip = !hasLeft || !hasRight;

        if (wispy && isTip && ((x + y) & 1) === 1) continue;

        let col;
        if (topDist === 0 || (topDist === 1 && vFrac < 0.22 + dither * 0.14 && !isTip)) {
          col = wispy ? '#e4eefc' : '#f4f8ff'; // Sunlit silver-white crest
        } else if (vFrac < 0.42 + dither * 0.16) {
          col = wispy ? '#c8d7ec' : '#d5e2f4'; // Upper sunlit body
        } else if (botDist <= 0 || vFrac > 0.74 + dither * 0.14) {
          col = wispy ? '#7c8ea8' : '#7a8da9'; // Cool shadowed cumulus belly
        } else {
          col = wispy ? '#9fb2cc' : '#a9bdd8'; // Mid volume tone
        }

        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const CLOUD_SPECS = [
    // Far high-altitude wispy stratus/cirrus clouds
    { w: 38, h: 11, wispy: true, lobes: [[9, 7, 7, 2.6], [19, 5.5, 11, 3.6], [29, 7, 7.5, 2.5]] },
    { w: 46, h: 12, wispy: true, lobes: [[10, 7.5, 8, 2.6], [21, 5.5, 10, 3.8], [32, 6.2, 9, 3.2], [39, 8, 5, 2]] },
    // Mid sculpted cumulus clouds
    { w: 48, h: 19, wispy: false, lobes: [[11, 13, 9, 4.5], [20, 9.5, 10, 6.8], [30, 10.5, 9.5, 6], [38, 13.5, 7.5, 4]] },
    { w: 56, h: 21, wispy: false, lobes: [[11, 15, 9.5, 4.5], [21, 11.5, 10.5, 6.5], [31, 9, 11, 7.8], [42, 12.5, 9, 5.5], [48, 15.5, 6, 3.5]] },
    { w: 42, h: 17, wispy: false, lobes: [[10, 12, 8, 4], [20, 8.5, 10, 6.5], [31, 11.5, 8.5, 4.5]] },
    // Near fuller hero cumulus clouds
    { w: 66, h: 25, wispy: false, lobes: [[12, 18, 10.5, 5], [23, 13.5, 12, 8], [35, 10.5, 13, 9.2], [47, 14, 11, 7.2], [56, 18.5, 8, 4.2]] },
    { w: 58, h: 23, wispy: false, lobes: [[11, 16.5, 9.5, 4.8], [22, 11.5, 11.5, 8], [34, 12.5, 11.5, 7.2], [45, 15.5, 9.5, 5.2], [51, 18, 5.5, 3.2]] }
  ];
  const cloudSprites = CLOUD_SPECS.map(bakeCloudSprite);

  const clouds = [];
  for (let i = 0; i < 15; i++) {
    const layer = i % 3; // 0 = far wispy, 1 = mid cumulus, 2 = near hero cumulus
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

  /* Pre-bake organic feathered pixel-art mist bank canvases (zero boxy rectangular seams) */
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
        // Smooth horizontal taper to zero at both left and right ends
        const horiz = Math.pow(Math.sin(u * Math.PI), 1.45);
        // Undulating multi-lobe mist top crest
        const crest = 0.24
          + 0.16 * Math.sin(u * Math.PI * 3 + seed)
          + 0.10 * Math.cos(u * Math.PI * 5 + seed * 1.7)
          + 0.06 * Math.sin(u * Math.PI * 7 + seed * 0.6);
        const topMask = clamp((v - crest) / Math.max(0.18, 0.56 - crest), 0, 1);
        // Softly fade the very bottom edge too so overlapping bands blend cleanly
        const botMask = v > 0.80 ? clamp((1 - v) / 0.20, 0, 1) : 1;
        // Internal wispy variation
        const wisp = 0.72 + 0.28 * Math.sin(u * 14 + v * 6 + seed * 2.1);
        const density = horiz * topMask * botMask * wisp;
        if (density < 0.06) continue;

        // Quantize alpha subtly with ordered 2x2 pixel dithering for tactile pixel-art atmosphere
        const dither = (BAYER2[((y & 1) << 1) | (x & 1)] - 1.5) * 0.035;
        const a = clamp(Math.round((density + dither) * 8) / 8, 0, 1);
        if (a <= 0.04) continue;

        // Slightly warmer pale-silver upper crest, cool misty slate deeper inside
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
  }

  function spawnEnvParticle(pt) {
    if (particles.length >= 540) particles.shift();
    particles.push(pt);
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

    // Normalize wind so multiple wind tiles blend gracefully without exploding velocity
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

    // Advance Clouds & Mist drift smoothly using active Wind
    const baseCloudSpeed = 9;
    cloudScroll += (baseCloudSpeed + windX * 0.65) * dt;
    mistScroll += (7 + windX * 0.55) * dt;

    // Helper for spawning multiple particles smoothly at any framerate
    const emitCount = rate => {
      const expected = rate * dt;
      const whole = Math.floor(expected);
      return whole + (Math.random() < (expected - whole) ? 1 : 0);
    };

    // 1. RAIN — 2-depth physics rain streaks with bright heads, wind slant & surface/water splash rings
    if (levels.RAIN > 0.01) {
      const n = emitCount(74 * levels.RAIN);
      const upwindPad = Math.abs(windX) * 0.95 + 42;
      for (let i = 0; i < n; i++) {
        const isFar = Math.random() < 0.38;
        const speedY = isFar ? (135 + Math.random() * 38) : (190 + Math.random() * 58);
        spawnEnvParticle({
          kind: 'RAIN',
          layer: isFar ? 0 : 1,
          x: topLeft.wx - upwindPad + Math.random() * (viewW + upwindPad * 2),
          y: topLeft.wy - 10 - Math.random() * 20,
          vx: windX * (isFar ? 0.92 : 1.18) - (isFar ? 7 : 12) + (Math.random() - 0.5) * 10,
          vy: speedY,
          life: 1.5,
          maxLife: 1.5,
          size: isFar ? 0.8 : 1.1,
          color: isFar ? '#6aa8d6' : (Math.random() > 0.4 ? '#86c8f2' : '#b2e1fc'),
          headColor: isFar ? '#b4dcf7' : '#e8f8ff',
          alpha: isFar ? (0.38 + Math.random() * 0.2) : (0.72 + Math.random() * 0.24),
          phase: Math.random() * 6.28
        });
      }
    }

    // 2. SNOW — 3-tier fluttering pixel flakes (distant dots, mid flakes, hero crystalline '+' flakes)
    if (levels.SNOW > 0.01) {
      const n = emitCount(38 * levels.SNOW);
      const upwindPad = Math.abs(windX) * 1.35 + 42;
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        const tier = r < 0.36 ? 0 : (r < 0.80 ? 1 : 2);
        const maxL = tier === 0 ? (5.2 + Math.random() * 2.2) : (4.4 + Math.random() * 2.0);
        spawnEnvParticle({
          kind: 'SNOW',
          tier,
          x: topLeft.wx - upwindPad + Math.random() * (viewW + upwindPad * 2),
          y: Math.random() < 0.78 ? (topLeft.wy - 8 - Math.random() * 14) : (topLeft.wy + Math.random() * viewH * 0.55),
          vx: windX * (0.62 + tier * 0.18) + (Math.random() - 0.5) * 14,
          vy: tier === 0 ? (10 + Math.random() * 7) : (tier === 1 ? (16 + Math.random() * 11) : (22 + Math.random() * 12)),
          life: maxL,
          maxLife: maxL,
          size: tier === 0 ? 1 : (tier === 1 ? 1.5 : 2.5),
          color: tier === 0 ? '#a9c7ea' : (tier === 1 ? '#e8f3ff' : '#ffffff'),
          tipColor: '#b9dafc',
          alpha: tier === 0 ? (0.45 + Math.random() * 0.2) : (tier === 1 ? (0.72 + Math.random() * 0.22) : (0.85 + Math.random() * 0.15)),
          phase: Math.random() * 6.28,
          freq: 1.5 + Math.random() * 1.4,
          stuck: false
        });
      }
    }

    // 3. VILLAGE DUST — sunlit floating pollen & warm dust motes
    if (levels['VILLAGE DUST'] > 0.01) {
      const n = emitCount(20 * levels['VILLAGE DUST']);
      for (let i = 0; i < n; i++) {
        const maxL = 3.2 + Math.random() * 2.4;
        spawnEnvParticle({
          kind: 'VILLAGE DUST',
          x: topLeft.wx - 16 + Math.random() * (viewW + 32),
          y: topLeft.wy - 8 + Math.random() * (viewH + 16),
          vx: windX * 0.55 + (Math.random() - 0.5) * 12,
          vy: (Math.random() - 0.5) * 8,
          life: maxL,
          maxLife: maxL,
          size: Math.random() > 0.65 ? 1.5 : 1,
          color: Math.random() > 0.45 ? '#f5e1be' : (Math.random() > 0.5 ? '#d9c49e' : '#b8a88c'),
          alpha: 0.65 + Math.random() * 0.3,
          phase: Math.random() * 6.28
        });
      }
    }

    // 4. RISING HEAT — buoyant shimmering heat wisps & warm ember sparks
    if (levels['RISING HEAT'] > 0.01) {
      const n = emitCount(26 * levels['RISING HEAT']);
      for (let i = 0; i < n; i++) {
        const fromTile = heatSources.length > 0 && Math.random() < 0.55;
        let sx, sy;
        if (fromTile) {
          const src = heatSources[Math.floor(Math.random() * heatSources.length)];
          sx = src.wx + (Math.random() - 0.5) * TILE * 2.6;
          sy = src.wy + (Math.random() - 0.5) * TILE * 0.8;
        } else {
          sx = topLeft.wx - 16 + Math.random() * (viewW + 32);
          sy = topLeft.wy + viewH * (0.48 + Math.random() * 0.58);
        }
        const isSpark = Math.random() < 0.34;
        const maxL = isSpark ? (1.1 + Math.random() * 0.9) : (1.5 + Math.random() * 1.1);
        spawnEnvParticle({
          kind: 'RISING HEAT',
          isSpark,
          x: sx,
          y: sy,
          vx: windX * 0.45 + (Math.random() - 0.5) * 12,
          vy: isSpark ? -(30 + Math.random() * 28) : -(18 + Math.random() * 18),
          life: maxL,
          maxLife: maxL,
          size: isSpark ? (Math.random() > 0.5 ? 1.5 : 1) : (2.2 + Math.random() * 2.0),
          color: isSpark
            ? (Math.random() > 0.4 ? '#f28c38' : '#ffd28a')
            : (Math.random() > 0.5 ? 'rgba(255, 168, 86, 0.24)' : 'rgba(255, 214, 158, 0.16)'),
          alpha: isSpark ? 0.92 : 0.65,
          phase: Math.random() * 6.28
        });
      }
    }

    // 5. STEAM — billowing rising vapor puffs from placed STEAM tiles + ambient zone wisps
    if (levels.STEAM > 0.01) {
      const n = emitCount(24 * levels.STEAM);
      for (let i = 0; i < n; i++) {
        let sx, sy;
        if (steamSources.length > 0 && Math.random() < 0.78) {
          const src = steamSources[Math.floor(Math.random() * steamSources.length)];
          sx = src.wx + (Math.random() - 0.5) * (TILE * 0.85);
          sy = src.wy + (Math.random() - 0.5) * 4;
        } else {
          sx = topLeft.wx + Math.random() * viewW;
          sy = topLeft.wy + viewH * (0.62 + Math.random() * 0.38);
        }
        const maxL = 1.6 + Math.random() * 1.2;
        spawnEnvParticle({
          kind: 'STEAM',
          x: sx,
          y: sy,
          vx: windX * 0.32 + (Math.random() - 0.5) * 9,
          vy: -(18 + Math.random() * 18),
          life: maxL,
          maxLife: maxL,
          size: 2.2 + Math.random() * 1.2,
          baseSize: 2.2 + Math.random() * 1.2,
          color: Math.random() > 0.4 ? '#e6edf6' : '#c6d0df',
          alpha: 0.42 + Math.random() * 0.18,
          phase: Math.random() * 6.28
        });
      }
    }

    // 6. WIND — sleek translucent breeze ribbons & tiny airborne motes
    if (levels.WIND > 0.01 && Math.abs(windX) > 6) {
      const n = emitCount(14 * levels.WIND * clamp(Math.abs(windX) / 65, 0.45, 1.8));
      const dir = windX >= 0 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const maxL = 0.65 + Math.random() * 0.55;
        const isRibbon = Math.random() < 0.72;
        spawnEnvParticle({
          kind: 'WIND',
          isRibbon,
          x: dir > 0 ? (topLeft.wx - 24 + Math.random() * viewW * 0.75) : (botRight.wx + 24 - Math.random() * viewW * 0.75),
          y: topLeft.wy + Math.random() * viewH,
          vx: windX * (1.35 + Math.random() * 0.55),
          vy: windY + (Math.random() - 0.5) * 14,
          life: maxL,
          maxLife: maxL,
          size: isRibbon ? (7 + Math.random() * 10) : 1.2,
          color: isRibbon ? '#d6e2f2' : '#f2d9b8',
          alpha: isRibbon ? (0.20 + Math.random() * 0.18) : 0.62,
          phase: Math.random() * 6.28
        });
      }
    }

    // 7. STARS — occasional soft shooting star when STARS active
    if (levels.STARS > 0.08 && Math.random() < dt * 0.28 * levels.STARS && shootingStars.length < 3) {
      const dir = Math.random() > 0.4 ? 1 : -1;
      shootingStars.push({
        x: Math.random() * viewport.width,
        y: Math.random() * viewport.height * 0.42,
        vx: dir * (220 + Math.random() * 140),
        vy: 55 + Math.random() * 65,
        life: 0.45 + Math.random() * 0.3,
        maxLife: 0.75
      });
    }

    // Step shooting stars
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
        sp.vy += 175 * dt;
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
        p.vx += (windX * (isFar ? 0.92 : 1.18) - (isFar ? 7 : 12) - p.vx) * (1 - Math.exp(-5 * dt));
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        const tx = Math.floor(nx / TILE);
        const ty = Math.floor(ny / TILE);
        const hitWater = !isFar && getMainTileType(world, tx, ty) === 'LIQUID' && getMainTileType(world, tx, ty - 1) !== 'LIQUID';
        const hitSurface = !isFar && (isFullSolidAt(world, tx, ty) || isOneWayAt(world, tx, ty));
        if (hitSurface || hitWater) {
          const hitY = Math.min(ny, ty * TILE + (hitWater ? 1.5 : 0));
          if (splashes.length < 210) {
            // Crisp expanding 1px surface splash ring
            splashes.push({
              kind: 'ring',
              x: nx,
              y: hitY,
              maxRx: hitWater ? (3.2 + Math.random() * 2.2) : (2.2 + Math.random() * 1.4),
              life: hitWater ? 0.22 : 0.16,
              maxLife: hitWater ? 0.22 : 0.16,
              color: hitWater ? '#e4f7ff' : '#bce6fc'
            });
            for (let s = 0; s < 2; s++) {
              splashes.push({
                kind: 'drop',
                x: nx,
                y: hitY - 0.5,
                vx: (s === 0 ? -1 : 1) * (10 + Math.random() * 17) + windX * 0.12,
                vy: -(18 + Math.random() * 24),
                life: 0.14 + Math.random() * 0.12,
                maxLife: 0.26,
                color: Math.random() > 0.35 ? '#9cd5f6' : '#e6f7ff'
              });
            }
          }
          particles.splice(i, 1);
          continue;
        }
        p.x = nx;
        p.y = ny;
        if (p.y > botRight.wy + 28) {
          particles.splice(i, 1);
        }
      } else if (p.kind === 'SNOW') {
        if (p.stuck) continue;
        const freq = p.freq || 2.1;
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
            p.life = Math.min(p.life, 1.2 + Math.random() * 1.1);
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
        const driftX = Math.sin(envTime * 1.2 + p.phase) * 10;
        const driftY = Math.cos(envTime * 1.5 + p.phase * 1.3) * 7;
        p.vx += (windX * 0.68 + driftX - p.vx) * windPull;
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
        const shimmerX = Math.sin(envTime * 5.2 + p.phase) * 13;
        p.vx += (windX * 0.65 + shimmerX - p.vx) * windPull;
        p.vy = Math.max(-72, p.vy - 10 * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.kind === 'STEAM') {
        const curlX = Math.sin(envTime * 2.2 + p.phase) * 8;
        p.vx += (windX * 0.78 + curlX - p.vx) * windPull;
        p.vy *= Math.exp(-0.55 * dt);
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        if (isFullSolidAt(world, Math.floor(nx / TILE), Math.floor(ny / TILE))) {
          // Deflect steam smoothly along solid ceilings
          p.vy = 0;
          p.vx += (windX !== 0 ? Math.sign(windX) : (p.phase > 3.14 ? 1 : -1)) * 24 * dt;
          p.x += p.vx * dt;
        } else {
          p.x = nx;
          p.y = ny;
        }
        const age = 1 - p.life / p.maxLife;
        p.size = (p.baseSize || 2.5) + age * 4.2;
      } else if (p.kind === 'WIND') {
        p.vy += Math.sin(envTime * 6 + p.phase) * 18 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
  }

  /* Screen-space deep sky backdrop: STARS & CLOUDS (behind tiles) */
  function drawBackdrop() {
    const starA = clamp(levels.STARS, 0, 1);
    const cloudA = clamp(levels.CLOUDS, 0, 1);
    if (starA <= 0.002 && cloudA <= 0.002) return;

    wCtx.save();
    wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

    // 1. STARS — twinkling deterministic parallax starfield + shooting stars
    if (starA > 0.002) {
      const cell = 64;
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
          if (f1 < 0.34) continue;
          const h2 = Math.sin(cx * 269.5 + cy * 183.3) * 43758.5453;
          const f2 = h2 - Math.floor(h2);
          const h3 = Math.sin(cx * 419.2 + cy * 73.1) * 43758.5453;
          const f3 = h3 - Math.floor(h3);

          const sx = Math.round(cx * cell + f1 * cell - parX);
          const sy = Math.round(cy * cell + f2 * cell - parY);
          if (sx < -4 || sx > viewport.width + 4 || sy < -4 || sy > viewport.height * 0.86) continue;

          const twinkle = 0.45 + 0.55 * Math.sin(envTime * (1.4 + f3 * 2.8) + f1 * 20);
          const alpha = clamp(starA * (0.35 + f2 * 0.65) * twinkle, 0, 1);
          const sz = f3 > 0.86 ? 2 : 1;
          wCtx.fillStyle = f3 > 0.72 ? `rgba(255, 236, 200, ${alpha})` : (f3 < 0.25 ? `rgba(182, 214, 255, ${alpha})` : `rgba(235, 240, 252, ${alpha})`);
          wCtx.fillRect(sx, sy, sz, sz);
          if (sz === 2 && twinkle > 0.88) {
            wCtx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.38})`;
            wCtx.fillRect(sx - 1, sy, 4, 1);
            wCtx.fillRect(sx, sy - 1, 1, 4);
          }
        }
      }

      // Shooting stars
      for (let i = 0; i < shootingStars.length; i++) {
        const ss = shootingStars[i];
        const p = clamp(ss.life / ss.maxLife, 0, 1);
        const a = Math.sin(p * Math.PI) * starA * 0.9;
        wCtx.strokeStyle = `rgba(246, 236, 214, ${a})`;
        wCtx.lineWidth = 1.5;
        wCtx.beginPath();
        wCtx.moveTo(ss.x, ss.y);
        wCtx.lineTo(ss.x - ss.vx * 0.08, ss.y - ss.vy * 0.08);
        wCtx.stroke();
        wCtx.fillStyle = `rgba(255, 255, 255, ${a})`;
        wCtx.fillRect(Math.round(ss.x), Math.round(ss.y), 2, 2);
      }
    }

    // 2. CLOUDS — 3-layer pre-baked sculpted pixel-art cumulus & cirrus clouds with wind parallax
    if (cloudA > 0.002) {
      wCtx.imageSmoothingEnabled = false;
      const spanW = Math.max(viewport.width + 380, 1480);
      // Render back-to-front by depth layer so near clouds cleanly pass in front of far wisps
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

    wCtx.restore();
  }

  /* Layered feathered pixel-art MIST fog banks & subtle rainstorm depth veil */
  function drawMistOverlay() {
    const mistA = clamp(levels.MIST, 0, 1);
    const rainA = clamp(levels.RAIN, 0, 1);
    if (mistA <= 0.002 && rainA <= 0.08) return;

    wCtx.save();
    wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    wCtx.imageSmoothingEnabled = false;

    // Subtle cool atmospheric rain depth haze when rain is active
    if (rainA > 0.08) {
      const rGrad = wCtx.createLinearGradient(0, 0, 0, viewport.height);
      rGrad.addColorStop(0, `rgba(110, 148, 186, ${rainA * 0.06})`);
      rGrad.addColorStop(0.65, `rgba(124, 162, 198, ${rainA * 0.03})`);
      rGrad.addColorStop(1, `rgba(140, 180, 214, ${rainA * 0.09})`);
      wCtx.fillStyle = rGrad;
      wCtx.fillRect(0, 0, viewport.width, viewport.height);
    }

    if (mistA > 0.002) {
      // Soft multi-stop lower ground-hugging atmospheric haze
      const baseGrad = wCtx.createLinearGradient(0, viewport.height * 0.28, 0, viewport.height);
      baseGrad.addColorStop(0, 'rgba(178, 198, 222, 0)');
      baseGrad.addColorStop(0.45, `rgba(182, 202, 226, ${mistA * 0.09})`);
      baseGrad.addColorStop(0.78, `rgba(194, 214, 236, ${mistA * 0.21})`);
      baseGrad.addColorStop(1, `rgba(206, 224, 244, ${mistA * 0.34})`);
      wCtx.fillStyle = baseGrad;
      wCtx.fillRect(0, viewport.height * 0.28, viewport.width, viewport.height * 0.72);

      // 3 layered organic feathered pixel-art mist banks drifting & stretching with Wind
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

  /* World-space physics particles (RAIN, SNOW, VILLAGE DUST, RISING HEAT, STEAM, WIND) */
  function drawWorldParticles() {
    // Rain impact splash rings & micro-droplets (single batched save/restore)
    if (splashes.length > 0) {
      wCtx.save();
      for (let i = 0; i < splashes.length; i++) {
        const s = splashes[i];
        const rem = clamp(s.life / s.maxLife, 0, 1);
        if (s.kind === 'ring') {
          const ease = 1 - Math.pow(rem, 2);
          const rx = Math.max(0.8, s.maxRx * ease);
          wCtx.globalAlpha = rem * 0.82;
          wCtx.fillStyle = s.color;
          wCtx.fillRect(s.x - rx, s.y - 0.5, rx * 2, 0.9);
          // Delicate upturned crest tips at the outer edges of the ring
          wCtx.fillRect(s.x - rx - 0.6, s.y - 1.2, 0.9, 0.8);
          wCtx.fillRect(s.x + rx - 0.3, s.y - 1.2, 0.9, 0.8);
        } else {
          wCtx.globalAlpha = rem * 0.88;
          wCtx.fillStyle = s.color;
          wCtx.fillRect(s.x - 0.5, s.y - 0.5, 1, 1);
        }
      }
      wCtx.restore();
    }

    if (particles.length === 0) return;
    const rainLineW = Math.max(0.75, 1.05 / camera.zoom);
    const farRainLineW = Math.max(0.55, 0.72 / camera.zoom);
    const windLineW = Math.max(0.8, 1.1 / camera.zoom);

    wCtx.save();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const age = 1 - clamp(p.life / p.maxLife, 0, 1);
      const fade = age < 0.15 ? (age / 0.15) : clamp(p.life / (p.maxLife * 0.35), 0, 1);

      if (p.kind === 'RAIN') {
        const isFar = p.layer === 0;
        const trailT = isFar ? 0.017 : 0.025;
        const dx = p.vx * trailT;
        const dy = p.vy * trailT;
        // Translucent tapered tail
        wCtx.globalAlpha = p.alpha * (isFar ? 0.72 : 0.62);
        wCtx.strokeStyle = p.color;
        wCtx.lineWidth = isFar ? farRainLineW : rainLineW;
        wCtx.beginPath();
        wCtx.moveTo(p.x, p.y);
        wCtx.lineTo(p.x - dx, p.y - dy);
        wCtx.stroke();
        // Crisp bright raindrop head
        if (!isFar) {
          wCtx.globalAlpha = p.alpha;
          wCtx.fillStyle = p.headColor || '#e8f8ff';
          wCtx.fillRect(p.x - 0.45, p.y - 0.45, 1, 1);
        }
      } else if (p.kind === 'SNOW') {
        const twinkle = p.tier === 2 && !p.stuck ? (0.82 + 0.18 * Math.sin(envTime * 5.2 + p.phase)) : 1;
        wCtx.globalAlpha = p.alpha * (p.stuck ? clamp(p.life / p.maxLife, 0, 1) : fade) * twinkle;
        if (p.stuck) {
          // Soft flattened settled snow fleck on ledge
          wCtx.fillStyle = '#e8f3ff';
          const fw = p.tier >= 2 ? 2.2 : 1.5;
          wCtx.fillRect(p.x - fw * 0.5, p.y - 0.5, fw, 1);
        } else if (p.tier === 2) {
          // Crisp 3x3 crystalline pixel '+' snowflake with bright white core and pale-ice tips
          const cx = p.x;
          const cy = p.y;
          wCtx.fillStyle = p.tipColor || '#b9dafc';
          wCtx.fillRect(cx - 1.5, cy - 0.5, 3, 1);
          wCtx.fillRect(cx - 0.5, cy - 1.5, 1, 3);
          wCtx.fillStyle = p.color;
          wCtx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
        } else {
          wCtx.fillStyle = p.color;
          wCtx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
        }
      } else if (p.kind === 'VILLAGE DUST') {
        const shimmer = 0.65 + 0.35 * Math.sin(envTime * 3.2 + p.phase);
        wCtx.globalAlpha = p.alpha * fade * shimmer;
        wCtx.fillStyle = p.color;
        wCtx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
      } else if (p.kind === 'RISING HEAT') {
        wCtx.globalAlpha = p.alpha * fade;
        wCtx.fillStyle = p.color;
        if (p.isSpark) {
          wCtx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
        } else {
          const w = p.size;
          const h = p.size * 2.4;
          wCtx.fillRect(p.x - w * 0.5, p.y - h * 0.5, w, h);
        }
      } else if (p.kind === 'STEAM') {
        wCtx.globalAlpha = p.alpha * fade;
        wCtx.fillStyle = p.color;
        const half = p.size * 0.5;
        // Crisp pixelated rounded puff
        wCtx.fillRect(p.x - half + 0.6, p.y - half, Math.max(1, p.size - 1.2), p.size);
        wCtx.fillRect(p.x - half, p.y - half + 0.6, p.size, Math.max(1, p.size - 1.2));
      } else if (p.kind === 'WIND') {
        wCtx.globalAlpha = p.alpha * Math.sin(age * Math.PI);
        if (p.isRibbon) {
          wCtx.strokeStyle = p.color;
          wCtx.lineWidth = windLineW;
          const dir = p.vx >= 0 ? 1 : -1;
          const len = p.size;
          wCtx.beginPath();
          wCtx.moveTo(p.x, p.y);
          wCtx.quadraticCurveTo(p.x - dir * len * 0.5, p.y - 1.4, p.x - dir * len, p.y + 0.6);
          wCtx.stroke();
        } else {
          wCtx.fillStyle = p.color;
          wCtx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
    }
    wCtx.restore();
  }

  function drawEditorPreview(ctx, dim, sub, opts, tNow) {
    const mult = intensityMult(opts);
    const countScale = Math.max(0.55, mult);
    ctx.save();

    if (sub === 'RAIN') {
      const n = Math.round(26 * countScale);
      for (let i = 0; i < n; i++) {
        const isFar = i % 3 === 0;
        const seed = i * 37.3;
        const spd = isFar ? 115 : 165;
        const x = ((seed * 19 + tNow * (isFar ? 24 : 38)) % (dim + 18)) - 9;
        const y = ((seed * 13 + tNow * spd) % (dim + 18)) - 9;
        ctx.globalAlpha = isFar ? 0.34 : (0.58 + (i % 3) * 0.14);
        ctx.strokeStyle = isFar ? '#6aa8d6' : '#86c8f2';
        ctx.lineWidth = isFar ? 0.8 : 1.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (isFar ? 1.4 : 2.2), y + (isFar ? 5.5 : 8.5));
        ctx.stroke();
        if (!isFar) {
          ctx.fillStyle = '#e8f8ff';
          ctx.fillRect(x + 1.8, y + 8, 1.5, 1.5);
        }
      }
      // Subtle splash rings along bottom edge
      for (let s = 0; s < 4; s++) {
        const p = (tNow * 2.2 + s * 0.27) % 1;
        const sx = 16 + ((s * 29 + Math.floor(tNow * 2.2 + s * 0.27) * 19) % (dim - 32));
        const rx = 1 + p * 5;
        ctx.globalAlpha = (1 - p) * 0.72;
        ctx.fillStyle = '#d4f1ff';
        ctx.fillRect(sx - rx, dim - 5, rx * 2, 1);
      }
    } else if (sub === 'SNOW') {
      const n = Math.round(24 * countScale);
      for (let i = 0; i < n; i++) {
        const tier = i % 5 === 0 ? 2 : (i % 3 === 0 ? 0 : 1);
        const x = ((i * 23 + Math.sin(tNow * (1.4 + tier * 0.3) + i) * (7 + tier * 3) + dim) % dim);
        const y = ((i * 19 + tNow * (14 + tier * 8 + (i % 3) * 4)) % dim);
        ctx.globalAlpha = tier === 0 ? 0.42 : (tier === 1 ? 0.74 : 0.92);
        if (tier === 2) {
          ctx.fillStyle = '#b9dafc';
          ctx.fillRect(Math.round(x) - 2, Math.round(y), 5, 1);
          ctx.fillRect(Math.round(x), Math.round(y) - 2, 1, 5);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
        } else {
          ctx.fillStyle = tier === 0 ? '#a9c7ea' : '#eef5ff';
          const sz = tier === 0 ? 1.5 : 2;
          ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
        }
      }
    } else if (sub === 'VILLAGE DUST') {
      const n = Math.round(18 * countScale);
      for (let i = 0; i < n; i++) {
        const x = ((i * 29 + tNow * 12 + Math.sin(tNow + i) * 8) % dim + dim) % dim;
        const y = ((i * 31 + Math.cos(tNow * 0.9 + i * 1.3) * 10) % dim + dim) % dim;
        ctx.globalAlpha = 0.38 + 0.32 * Math.sin(tNow * 2.5 + i);
        ctx.fillStyle = i % 2 === 0 ? '#f5e1be' : '#d2bc96';
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    } else if (sub === 'RISING HEAT') {
      const n = Math.round(18 * countScale);
      for (let i = 0; i < n; i++) {
        const x = ((i * 17 + Math.sin(tNow * 4 + i) * 6) % dim + dim) % dim;
        const y = dim - ((i * 21 + tNow * (36 + (i % 3) * 12)) % (dim + 12));
        ctx.globalAlpha = clamp((y / dim) * 0.85, 0.1, 0.85);
        ctx.fillStyle = i % 3 === 0 ? '#ffd28a' : '#f28c38';
        ctx.fillRect(x, y, i % 3 === 0 ? 1.5 : 2, i % 3 === 0 ? 1.5 : 4);
      }
    } else if (sub === 'MIST') {
      ctx.imageSmoothingEnabled = false;
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
      const n = Math.round(14 * countScale);
      for (let i = 0; i < n; i++) {
        const prog = ((tNow * 0.45 + i / n) % 1);
        const x = dim * 0.5 + Math.sin(tNow * 2.4 + i * 1.9) * (6 + prog * 14);
        const y = dim * 0.88 - prog * dim * 0.78;
        const sz = 4 + prog * 10;
        ctx.globalAlpha = Math.sin(prog * Math.PI) * 0.42;
        ctx.fillStyle = '#dce6f2';
        ctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz);
      }
    } else if (sub === 'CLOUDS') {
      ctx.imageSmoothingEnabled = false;
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
      const n = Math.round(22 * countScale);
      for (let i = 0; i < n; i++) {
        const x = (i * 29 + 11) % dim;
        const y = (i * 17 + 7) % Math.floor(dim * 0.82);
        ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tNow * (2 + (i % 4)) + i));
        ctx.fillStyle = i % 4 === 0 ? '#ffe8bd' : '#e6eefc';
        ctx.fillRect(x, y, i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1);
      }
    } else if (sub === 'WIND') {
      const dir = opts && opts.windDir === 'LEFT' ? -1 : (opts && opts.windDir === 'GUSTY' ? Math.sign(Math.sin(tNow * 1.4)) || 1 : 1);
      const spd = opts && opts.windStrength === 'GALE' ? 140 : (opts && opts.windStrength === 'BREEZE' ? 52 : 92);
      ctx.strokeStyle = '#d6e2f2';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) {
        const raw = (i * 23 + tNow * spd * dir) % (dim + 30);
        const x = ((raw + dim + 30) % (dim + 30)) - 15;
        const y = 12 + i * 13 + Math.sin(tNow * 4 + i) * 3;
        ctx.globalAlpha = 0.35 + (i % 3) * 0.14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - dir * 18, y);
        ctx.stroke();
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
    get windY() { return windY; }
  };
})();
