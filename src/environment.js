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
import { isFullSolidAt, isOneWayAt, screenToWorld } from './world.js';

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

  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const layer = i % 3; // 0 = far, 1 = mid, 2 = near
    const w = 52 + ((i * 29) % 74) + layer * 18;
    const h = 14 + ((i * 11) % 12) + layer * 4;
    const puffs = [];
    const puffCount = 3 + (i % 3);
    for (let p = 0; p < puffCount; p++) {
      const frac = puffCount === 1 ? 0.5 : p / (puffCount - 1);
      puffs.push({
        ox: frac * (w * 0.62),
        oy: (p === 0 || p === puffCount - 1) ? h * 0.34 : ((p % 2 === 0) ? h * 0.08 : 0),
        pw: w * (0.34 + ((i + p) % 3) * 0.06),
        ph: h * (0.64 + ((i + p * 2) % 2) * 0.24)
      });
    }
    clouds.push({
      x: (i * 157) % 1400,
      yFrac: 0.05 + layer * 0.095 + ((i * 37) % 100) * 0.0014,
      w,
      h,
      layer,
      puffs,
      speedMult: 0.45 + layer * 0.35 + ((i * 13) % 10) * 0.03
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

    // 1. RAIN — physics rain streaks that slant with Wind & splash on solid tiles
    if (levels.RAIN > 0.01) {
      const n = emitCount(68 * levels.RAIN);
      const upwindPad = Math.abs(windX) * 0.9 + 36;
      for (let i = 0; i < n; i++) {
        const speedY = 175 + Math.random() * 52;
        spawnEnvParticle({
          kind: 'RAIN',
          x: topLeft.wx - upwindPad + Math.random() * (viewW + upwindPad * 2),
          y: topLeft.wy - 10 - Math.random() * 18,
          vx: windX * 1.15 - 10 + (Math.random() - 0.5) * 10,
          vy: speedY,
          life: 1.4,
          maxLife: 1.4,
          size: 1,
          color: Math.random() > 0.35 ? '#7ec0e8' : '#bce2fa',
          alpha: 0.72 + Math.random() * 0.25,
          phase: Math.random() * 6.28
        });
      }
    }

    // 2. SNOW — fluttering flakes swept by Wind & settling softly on solid surfaces
    if (levels.SNOW > 0.01) {
      const n = emitCount(34 * levels.SNOW);
      const upwindPad = Math.abs(windX) * 1.3 + 36;
      for (let i = 0; i < n; i++) {
        spawnEnvParticle({
          kind: 'SNOW',
          x: topLeft.wx - upwindPad + Math.random() * (viewW + upwindPad * 2),
          y: Math.random() < 0.75 ? (topLeft.wy - 8 - Math.random() * 14) : (topLeft.wy + Math.random() * viewH * 0.55),
          vx: windX * 0.8 + (Math.random() - 0.5) * 14,
          vy: 16 + Math.random() * 15,
          life: 4.5 + Math.random() * 2.0,
          maxLife: 6.5,
          size: Math.random() > 0.45 ? 1.5 : 1,
          color: Math.random() > 0.3 ? '#eef4ff' : '#c6d8f2',
          alpha: 0.78 + Math.random() * 0.22,
          phase: Math.random() * 6.28,
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

    // Step rain splash droplets
    for (let i = splashes.length - 1; i >= 0; i--) {
      const sp = splashes[i];
      sp.life -= dt;
      if (sp.life <= 0) {
        splashes.splice(i, 1);
        continue;
      }
      sp.vy += 170 * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
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
        p.vx += (windX * 1.15 - 10 - p.vx) * (1 - Math.exp(-5 * dt));
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        const tx = Math.floor(nx / TILE);
        const ty = Math.floor(ny / TILE);
        if (isFullSolidAt(world, tx, ty) || isOneWayAt(world, tx, ty)) {
          const hitY = Math.min(ny, ty * TILE);
          if (splashes.length < 180) {
            for (let s = 0; s < 2; s++) {
              splashes.push({
                x: nx,
                y: hitY - 0.5,
                vx: (s === 0 ? -1 : 1) * (10 + Math.random() * 18) + windX * 0.14,
                vy: -(20 + Math.random() * 24),
                life: 0.14 + Math.random() * 0.12,
                maxLife: 0.26,
                color: Math.random() > 0.4 ? '#9ad2f5' : '#dff3ff'
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
        const sway = Math.sin(envTime * 2.4 + p.phase) * 14;
        p.vx += (windX * 0.85 + sway - p.vx) * windPull;
        const gustLift = Math.abs(windX) > 75 ? Math.sin(envTime * 3.8 + p.phase) * 9 : 0;
        const nx = p.x + p.vx * dt;
        const ny = p.y + (p.vy + gustLift) * dt;
        const tx = Math.floor(nx / TILE);
        const ty = Math.floor(ny / TILE);
        if (isFullSolidAt(world, tx, ty) || isOneWayAt(world, tx, ty)) {
          if (p.y <= ty * TILE + 2.5) {
            p.x = nx;
            p.y = ty * TILE - 0.6;
            p.vx = 0;
            p.vy = 0;
            p.stuck = true;
            p.life = Math.min(p.life, 0.45 + Math.random() * 0.55);
            p.maxLife = p.life;
          } else {
            p.life = Math.min(p.life, 0.12);
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

    // 2. CLOUDS — multi-layer pixel-art clouds scrolling smoothly with Wind
    if (cloudA > 0.002) {
      const spanW = Math.max(viewport.width + 320, 1280);
      for (let i = 0; i < clouds.length; i++) {
        const cl = clouds[i];
        const par = 0.12 + cl.layer * 0.11;
        const rawX = cl.x + cloudScroll * cl.speedMult - camera.x * par;
        const sx = (((rawX % spanW) + spanW) % spanW) - 160;
        const sy = Math.round(cl.yFrac * viewport.height - camera.y * (par * 0.35));
        if (sy < -cl.h - 20 || sy > viewport.height + 20) continue;

        const layerAlpha = cloudA * (0.14 + cl.layer * 0.075);
        const bodyCol = cl.layer === 2
          ? `rgba(186, 198, 218, ${layerAlpha})`
          : (cl.layer === 1 ? `rgba(154, 168, 192, ${layerAlpha})` : `rgba(124, 138, 162, ${layerAlpha})`);
        const topCol = `rgba(232, 240, 252, ${layerAlpha * 0.55})`;

        wCtx.fillStyle = bodyCol;
        for (let p = 0; p < cl.puffs.length; p++) {
          const pf = cl.puffs[p];
          wCtx.fillRect(Math.round(sx + pf.ox), Math.round(sy + pf.oy), Math.round(pf.pw), Math.round(pf.ph));
        }
        // Crisp 2px pixel cloud top highlight
        wCtx.fillStyle = topCol;
        for (let p = 0; p < cl.puffs.length; p++) {
          const pf = cl.puffs[p];
          wCtx.fillRect(Math.round(sx + pf.ox + 2), Math.round(sy + pf.oy), Math.max(2, Math.round(pf.pw - 4)), 2);
        }
      }
    }

    wCtx.restore();
  }

  /* Layered translucent MIST fog banks (screen-space veil pushed by Wind) */
  function drawMistOverlay() {
    const mistA = clamp(levels.MIST, 0, 1);
    if (mistA <= 0.002) return;

    wCtx.save();
    wCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

    // Soft lower atmospheric haze gradient
    const baseGrad = wCtx.createLinearGradient(0, viewport.height * 0.35, 0, viewport.height);
    baseGrad.addColorStop(0, 'rgba(182, 198, 218, 0)');
    baseGrad.addColorStop(0.55, `rgba(182, 198, 218, ${mistA * 0.12})`);
    baseGrad.addColorStop(1, `rgba(196, 212, 232, ${mistA * 0.28})`);
    wCtx.fillStyle = baseGrad;
    wCtx.fillRect(0, viewport.height * 0.35, viewport.width, viewport.height * 0.65);

    // 3 layered drifting pixel mist ribbons that speed up / reverse with Wind
    const stretch = 1 + clamp(Math.abs(windX) / 90, 0, 0.9);
    for (let band = 0; band < 3; band++) {
      const spanW = viewport.width + 420;
      const speed = 0.65 + band * 0.45;
      const bandY = viewport.height * (0.56 + band * 0.14);
      const bandH = 26 + band * 14;
      const count = 6;
      for (let j = 0; j < count; j++) {
        const rawX = j * (spanW / count) + mistScroll * speed - camera.x * (0.25 + band * 0.12);
        const x = (((rawX % spanW) + spanW) % spanW) - 210;
        const y = Math.round(bandY + Math.sin(envTime * 0.6 + j * 1.4 + band) * 8);
        const w = Math.round((130 + (j % 3) * 44) * stretch);
        const a = mistA * (0.065 + band * 0.028);
        wCtx.fillStyle = `rgba(202, 218, 236, ${a})`;
        wCtx.fillRect(Math.round(x), y, w, bandH);
        wCtx.fillRect(Math.round(x + w * 0.15), y - 6, Math.round(w * 0.7), 6);
      }
    }

    wCtx.restore();
  }

  /* World-space physics particles (RAIN, SNOW, VILLAGE DUST, RISING HEAT, STEAM, WIND) */
  function drawWorldParticles() {
    // Rain impact splashes (single batched save/restore)
    if (splashes.length > 0) {
      wCtx.save();
      for (let i = 0; i < splashes.length; i++) {
        const s = splashes[i];
        wCtx.globalAlpha = clamp(s.life / s.maxLife, 0, 1) * 0.85;
        wCtx.fillStyle = s.color;
        wCtx.fillRect(s.x - 0.5, s.y - 0.5, 1, 1);
      }
      wCtx.restore();
    }

    if (particles.length === 0) return;
    const rainLineW = Math.max(0.85, 1 / camera.zoom);
    const windLineW = Math.max(0.8, 1.1 / camera.zoom);

    wCtx.save();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const age = 1 - clamp(p.life / p.maxLife, 0, 1);
      const fade = age < 0.15 ? (age / 0.15) : clamp(p.life / (p.maxLife * 0.35), 0, 1);

      if (p.kind === 'RAIN') {
        wCtx.globalAlpha = p.alpha;
        wCtx.strokeStyle = p.color;
        wCtx.lineWidth = rainLineW;
        const dx = p.vx * 0.022;
        const dy = p.vy * 0.022;
        wCtx.beginPath();
        wCtx.moveTo(p.x, p.y);
        wCtx.lineTo(p.x - dx, p.y - dy);
        wCtx.stroke();
      } else if (p.kind === 'SNOW') {
        wCtx.globalAlpha = p.alpha * (p.stuck ? clamp(p.life / p.maxLife, 0, 1) : fade);
        wCtx.fillStyle = p.color;
        wCtx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
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
      const n = Math.round(24 * countScale);
      ctx.strokeStyle = '#92cdf2';
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const seed = i * 37.3;
        const x = ((seed * 19 + tNow * 36) % (dim + 18)) - 9;
        const y = ((seed * 13 + tNow * 155) % (dim + 18)) - 9;
        ctx.globalAlpha = 0.45 + (i % 3) * 0.18;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 2, y + 7);
        ctx.stroke();
      }
    } else if (sub === 'SNOW') {
      const n = Math.round(22 * countScale);
      ctx.fillStyle = '#eef4ff';
      for (let i = 0; i < n; i++) {
        const x = ((i * 23 + Math.sin(tNow * 1.8 + i) * 10 + dim) % dim);
        const y = ((i * 19 + tNow * (22 + (i % 4) * 6)) % dim);
        ctx.globalAlpha = 0.5 + (i % 3) * 0.16;
        const sz = i % 3 === 0 ? 2 : 1.5;
        ctx.fillRect(x, y, sz, sz);
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
      const grad = ctx.createLinearGradient(0, dim * 0.4, 0, dim);
      grad.addColorStop(0, 'rgba(192, 208, 228, 0)');
      grad.addColorStop(1, `rgba(202, 218, 236, ${clamp(0.32 * mult, 0.16, 0.48)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, dim * 0.4, dim, dim * 0.6);
      for (let i = 0; i < 4; i++) {
        const x = (((i * 38 + tNow * (14 + i * 4)) % (dim + 48)) - 48);
        ctx.fillStyle = `rgba(208, 224, 242, ${0.12 + i * 0.03})`;
        ctx.fillRect(x, dim * (0.56 + i * 0.1), 46, 10);
      }
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
      for (let i = 0; i < 4; i++) {
        const w = 34 + (i % 2) * 14;
        const x = (((i * 36 + tNow * (10 + i * 3)) % (dim + w)) - w);
        const y = 10 + i * 16;
        ctx.fillStyle = `rgba(176, 190, 212, ${0.24 + (i % 2) * 0.1})`;
        ctx.fillRect(x, y, w, 10);
        ctx.fillRect(x + 6, y - 4, w - 12, 4);
      }
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
