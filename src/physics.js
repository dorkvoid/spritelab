import { SFX } from './audio.js';
import { getHarmDamage, isDeadlyHarmSubType, PHYS, TILE } from './constants.js';
import { dialogueBox } from './dom.js';
import { envSys } from './environment.js';
import {
  spawnBurstParticles,
  spawnLandingDust,
  spawnLiquidSplash,
  spawnParticle,
  spawnRunDust,
  spawnWaterBubble,
  teleportFromPortal,
  toggleActivatorSwitch,
  triggerTileAnim,
  updateWorldFX
} from './fx.js';
import {
  camera,
  getActiveWorld,
  keys,
  player,
  runtime,
  seedBgPlaceOrder,
  state,
  viewport,
  worldFX
} from './state.js';
import { clamp } from './utils.js';
import {
  getAbyssKillY,
  getMainTileInfo,
  getMainTileType,
  hideDialogue,
  isFullSolidAt,
  isOneWaySupportAt,
  isWalkableBackAt,
  resetRuntimeWorld,
  screenToWorld,
  syncRuntimeEntities
} from './world.js';

export function loadWorldPlayerPos(world) {
  const px = world.playerPos && Number.isFinite(world.playerPos.x) ? world.playerPos.x : world.spawn.x * TILE;
  const py = world.playerPos && Number.isFinite(world.playerPos.y) ? world.playerPos.y : world.spawn.y * TILE;
  player.x = px;
  player.y = py;
  player.prevX = px;
  player.prevY = py;
  player.vx = 0;
  player.vy = 0;
  player.grounded = false;
  player.onSlip = false;
  player.climbing = false;
  player.inLiquid = false;
  player.swimming = false;
  player.swimCycle = 0;
  player.swimTilt = 0;
  player.swimBubbleTimer = 0;
  player.diveBubbleTimer = 0;
  player.liquidExitCd = 0;
  player.skipExitSplashTimer = 0;
  player.lastLiquidSurfaceY = py + player.h;
  player.coyoteTimer = 0;
  player.jumpBufTimer = 0;
  player.jumpCutDone = false;
  player.landTimer = 0;
  player.jumpTimer = 0;
  player.actTimer = 0;
  player.respawnTimer = 0;
  player.runDustTimer = 0;
  player.stepTimer = 0;
  player.climbSoundTimer = 0;
  player.swimSoundTimer = 0;
  player.sitting = false;
  player.blinkTimer = 2.8 + Math.random() * 2.2;
  player.blinkDur = 0;
  player.climbAnimAcc = 0;
  player.scaleX = 1;
  player.scaleY = 1;
  player.breath = player.maxBreath;
  player.health = player.maxHealth;
  player.submerged = false;
  player.inBreathableLiquid = false;
  player.breathHudAlpha = 0;
  player.breathFullDelay = 0;
  player.breathPopFx.length = 0;
  player.healthHudAlpha = 0;
  player.healthFullDelay = 0;
  player.healthRegenDelay = 0;
  player.drownTickTimer = 0;
  player.damageFlashTimer = 0;
  player.fallTimer = 0;
  player.dead = false;
  player.deathTimer = 0;
  player.deathCause = null;
  player.deathAngle = 0;
  player.deathAngVel = 0;
  player.deathFallRagdoll = false;
  player.ragdollLimbs = [];
  player.lastSafePos = { x: px, y: py, valid: true };

  camera.x = px + player.w * 0.5;
  camera.y = py + player.h * 0.5;
  camera.lookAheadX = 0;
  camera.initialized = true;
  camera.buildRecenter = false;
  worldFX.bgFadeIns.clear();
  worldFX.bgFadeOuts.length = 0;
  worldFX.waterRipples.length = 0;
  seedBgPlaceOrder(world);
  envSys.reset();
  resetRuntimeWorld(world);
}

export function respawnPlayer(withFx = true, playRespawnSfx = false) {
  const world = getActiveWorld();
  const sx = world.spawn.x * TILE;
  const sy = world.spawn.y * TILE;
  player.x = sx;
  player.y = sy;
  player.prevX = sx;
  player.prevY = sy;
  player.vx = 0;
  player.vy = 0;
  player.grounded = false;
  player.climbing = false;
  player.inLiquid = false;
  player.swimming = false;
  player.swimCycle = 0;
  player.swimTilt = 0;
  player.swimBubbleTimer = 0;
  player.diveBubbleTimer = 0;
  player.liquidExitCd = 0;
  player.skipExitSplashTimer = 0;
  player.lastLiquidSurfaceY = sy + player.h;
  player.coyoteTimer = 0;
  player.jumpBufTimer = 0;
  player.sitting = false;
  player.scaleX = 0.88;
  player.scaleY = 1.14;
  player.breath = player.maxBreath;
  player.health = player.maxHealth;
  player.submerged = false;
  player.inBreathableLiquid = false;
  player.breathHudAlpha = 0;
  player.breathFullDelay = 0;
  player.breathPopFx.length = 0;
  player.healthHudAlpha = 0;
  player.healthFullDelay = 0;
  player.healthRegenDelay = 0;
  player.drownTickTimer = 0;
  player.damageFlashTimer = 0;
  player.fallTimer = 0;
  player.dead = false;
  player.deathTimer = 0;
  player.deathCause = null;
  player.deathAngle = 0;
  player.deathAngVel = 0;
  player.deathFallRagdoll = false;
  player.ragdollLimbs = [];
  player.lastSafePos = { x: sx, y: sy, valid: true };
  state.activeMotionId = null;
  runtime.mount = null;
  runtime.collected.clear();
  runtime.crumbling.clear();
  syncRuntimeEntities(world, true);
  hideDialogue();
  if (withFx) {
    player.respawnTimer = 0.34;
    spawnBurstParticles(sx + player.w * 0.5, sy + player.h * 0.5, '#f28c38', 10, 65);
    if (playRespawnSfx) SFX.playRespawn();
  }
}

/* Find the safest dry ground location closest to where the player died */
export function findSafestRevivePos(world, refX, refY) {
  const refCx = refX + player.w * 0.5;
  const refCy = refY + player.h * 0.5;
  let best = null;
  let bestScore = Infinity;

  const main = world.layers && world.layers.main;
  if (main) {
    for (const key in main) {
      const comma = key.indexOf(',');
      if (comma === -1) continue;
      const tx = parseInt(key.slice(0, comma), 10);
      const ty = parseInt(key.slice(comma + 1), 10);
      const sup = getMainTileInfo(world, tx, ty);
      if (!sup) continue;

      // Valid stable support: starter block, solid, one-way platform, slope, or slidey ice
      const isSafeSupport = (
        sup.type === 'SOLID' ||
        sup.type === 'SLIDEY' ||
        sup.type === 'SLOPE'
      );
      if (!isSafeSupport) continue;

      // Space directly above support must be dry open air (not solid, liquid, harmful, or crumbling)
      const standTx = tx;
      const standTy = ty - 1;
      if (isFullSolidAt(world, standTx, standTy)) continue;
      const standInfo = getMainTileInfo(world, standTx, standTy);
      if (standInfo) {
        if (
          standInfo.type === 'HARMFUL' ||
          standInfo.type === 'LIQUID' ||
          standInfo.type === 'CRUMBLING' ||
          standInfo.type === 'BOUNCY'
        ) continue;
      }

      // Compute safety penalty so truly safe ledges beat tight/hazardous spots
      let penalty = 0;
      const headInfo = getMainTileInfo(world, standTx, standTy - 1);
      if (isFullSolidAt(world, standTx, standTy - 1)) penalty += 4.5;
      else if (headInfo && (headInfo.type === 'HARMFUL' || headInfo.type === 'LIQUID')) penalty += 12;

      // Check immediate neighbors for nearby hazards or water
      for (let dx = -1; dx <= 1; dx += 2) {
        const adj = getMainTileInfo(world, standTx + dx, standTy);
        const adjFloor = getMainTileInfo(world, standTx + dx, ty);
        if (adj && adj.type === 'HARMFUL') penalty += 5.5;
        if (adjFloor && adjFloor.type === 'HARMFUL') penalty += 3.0;
        if (adj && adj.type === 'LIQUID') penalty += 0.6;
        if (!adjFloor || adjFloor.type === 'LIQUID' || adjFloor.type === 'HARMFUL') {
          penalty += 0.35; // Slight preference for inland footing over cliff/pool lip
        }
      }
      if (sup.type === 'SLIDEY') penalty += 1.4;
      else if (sup.type === 'SOLID' && sup.subType === 'ONE-WAY') penalty += 0.35;

      const candCx = (standTx + 0.5) * TILE;
      const candCy = (standTy + 0.5) * TILE;
      const distTiles = Math.hypot(candCx - refCx, candCy - refCy) / TILE;
      const score = distTiles + penalty;

      if (score < bestScore) {
        bestScore = score;
        best = { x: standTx * TILE, y: standTy * TILE };
      }
    }
  }

  if (best) return best;
  if (player.lastSafePos && player.lastSafePos.valid) {
    return { x: player.lastSafePos.x, y: player.lastSafePos.y };
  }
  return { x: world.spawn.x * TILE, y: world.spawn.y * TILE };
}

export function triggerPlayerDeath(cause, isRagdoll = false) {
  if (player.dead) return;
  player.dead = true;
  player.health = 0;
  player.deathCause = cause;
  player.deathMaxTimer = 3.0;
  player.deathTimer = 3.0;
  player.deathFallRagdoll = Boolean(isRagdoll);
  player.deathX = player.x;
  player.deathY = player.y;
  player.deathAngle = 0;
  player.damageFlashTimer = 0.35;
  player.healthHudAlpha = 1;
  player.climbing = false;
  player.sitting = false;
  player.swimming = false;
  player.fallTimer = 0;
  state.activeMotionId = null;
  runtime.mount = null;
  hideDialogue();

  const cx = player.x + player.w * 0.5;
  const cy = player.y + player.h * 0.5;

  if (player.deathFallRagdoll) {
    const spinDir = Math.abs(player.vx) > 8 ? Math.sign(player.vx) : player.facing;
    player.vx = clamp(player.vx + spinDir * 24, -170, 170);
    player.vy = Math.max(player.vy, 95);
    player.deathAngVel = spinDir * (7.2 + Math.random() * 4.2);
    // 5 floppy ragdoll joint oscillators (head, left arm, right arm, left leg, right leg)
    player.ragdollLimbs = [
      { a: 0, v: spinDir * 5 },
      { a: -0.6, v: -8 },
      { a: 0.6, v: 9 },
      { a: -0.4, v: 7 },
      { a: 0.4, v: -7 }
    ];
    spawnBurstParticles(cx, cy, '#d8a557', 10, 72);
    SFX.playDeath('abyss');
  } else if (cause === 'drown') {
    player.vx *= 0.28;
    player.vy = -22;
    player.deathAngVel = player.facing * 2.4;
    player.ragdollLimbs = [];
    for (let i = 0; i < 10; i++) {
      spawnWaterBubble(cx + (Math.random() - 0.5) * 10, cy + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 30, -32);
    }
    spawnBurstParticles(cx, cy, '#cf5959', 8, 52);
    SFX.playDeath('drown');
  } else {
    const knock = -player.facing;
    player.vx = knock * (46 + Math.random() * 24);
    player.vy = -128;
    player.deathAngVel = knock * 7.8;
    player.ragdollLimbs = [];
    spawnBurstParticles(cx, cy, '#cf5959', 12, 74);
    SFX.playDeath('deadly');
  }
}

export function revivePlayerNearDeath() {
  const world = getActiveWorld();
  // Restore any crumbled blocks first so nearby safe ledges are solid
  runtime.crumbling.clear();

  // For abyss fall deaths, anchor search to where they fell off; otherwise nearest safe spot to body
  const refX = player.deathCause === 'abyss' ? player.deathX : player.x;
  const refY = player.deathCause === 'abyss' ? player.deathY : player.y;
  const safe = findSafestRevivePos(world, refX, refY);

  player.x = safe.x;
  player.y = safe.y;
  player.prevX = safe.x;
  player.prevY = safe.y;
  player.vx = 0;
  player.vy = 0;
  player.grounded = false;
  player.onSlip = false;
  player.climbing = false;
  player.inLiquid = false;
  player.swimming = false;
  player.swimTilt = 0;
  player.sitting = false;
  player.fallTimer = 0;
  player.dead = false;
  player.deathTimer = 0;
  player.deathCause = null;
  player.deathAngle = 0;
  player.deathAngVel = 0;
  player.deathFallRagdoll = false;
  player.ragdollLimbs = [];
  player.health = player.maxHealth;
  player.breath = player.maxBreath;
  player.submerged = false;
  player.inBreathableLiquid = false;
  player.breathFullDelay = 0.5;
  player.healthFullDelay = 0.9;
  player.healthRegenDelay = 0;
  player.drownTickTimer = 0;
  player.damageFlashTimer = 0;
  player.breathPopFx.length = 0;
  player.respawnTimer = 0.42;
  player.scaleX = 0.86;
  player.scaleY = 1.18;
  runtime.hurtCd = 1.1;
  runtime.hurtFlash = 0;

  // If camera drifted very far down into the abyss during ragdoll, ease it near the revive spot
  const camDist = Math.hypot((safe.x + player.w * 0.5) - camera.x, (safe.y + player.h * 0.5) - camera.y);
  if (camDist > 220) {
    const pull = 1 - 150 / camDist;
    camera.x += ((safe.x + player.w * 0.5) - camera.x) * pull;
    camera.y += ((safe.y + player.h * 0.5) - camera.y) * pull;
  }

  const rcx = safe.x + player.w * 0.5;
  const rcy = safe.y + player.h * 0.5;
  worldFX.interactRings.push({ x: rcx, y: rcy, timer: 0, maxTimer: 0.34 });
  spawnBurstParticles(rcx, rcy, '#f28c38', 12, 68);
  SFX.playRespawn();
}

export function stepDeathAnimation(world, dt) {
  player.deathTimer = Math.max(0, player.deathTimer - dt);
  if (player.damageFlashTimer > 0) player.damageFlashTimer = Math.max(0, player.damageFlashTimer - dt);
  player.healthHudAlpha = 1;

  if (player.deathFallRagdoll) {
    // Full ragdoll fall physics: tumbling, bouncing off solid blocks, flailing limbs
    const prevVx = player.vx;
    const prevVy = player.vy;
    player.vy = Math.min(PHYS.maxFall * 1.45, player.vy + PHYS.gravity * 1.05 * dt);
    player.vx *= Math.exp(-0.45 * dt);

    // Horizontal move & wall bounce
    player.x += player.vx * dt;
    const hTop = Math.floor((player.y + 2) / TILE);
    const hBot = Math.floor((player.y + player.h - 2) / TILE);
    if (player.vx > 0) {
      const rTx = Math.floor((player.x + player.w - 0.001) / TILE);
      for (let ty = hTop; ty <= hBot; ty++) {
        if (isFullSolidAt(world, rTx, ty)) {
          player.x = rTx * TILE - player.w;
          player.vx = -player.vx * 0.52;
          player.deathAngVel = -player.deathAngVel * 0.7 + (Math.random() - 0.5) * 4;
          break;
        }
      }
    } else if (player.vx < 0) {
      const lTx = Math.floor(player.x / TILE);
      for (let ty = hTop; ty <= hBot; ty++) {
        if (isFullSolidAt(world, lTx, ty)) {
          player.x = (lTx + 1) * TILE;
          player.vx = -player.vx * 0.52;
          player.deathAngVel = -player.deathAngVel * 0.7 + (Math.random() - 0.5) * 4;
          break;
        }
      }
    }

    // Vertical move & floor bounce
    const prevBot = player.y + player.h;
    player.y += player.vy * dt;
    const vLeft = Math.floor((player.x + 2) / TILE);
    const vRight = Math.floor((player.x + player.w - 3) / TILE);
    if (player.vy >= 0) {
      const footTy = Math.floor((player.y + player.h - 0.001) / TILE);
      for (let tx = vLeft; tx <= vRight; tx++) {
        const hitSolid = isFullSolidAt(world, tx, footTy);
        const hitOneWay = isOneWaySupportAt(world, tx, footTy) && prevBot <= footTy * TILE + 5;
        if (hitSolid || hitOneWay) {
          const impSpd = Math.abs(player.vy);
          player.y = footTy * TILE - player.h;
          if (impSpd > 58) {
            player.vy = -impSpd * 0.42;
            player.vx *= 0.74;
            player.deathAngVel = (player.vx >= 0 ? 1 : -1) * Math.min(11, impSpd * 0.045);
            player.scaleX = 1.24;
            player.scaleY = 0.76;
            const imp = clamp(impSpd / 240, 0.25, 1.0);
            spawnLandingDust(player.x + player.w * 0.5, player.y + player.h, imp, false);
            SFX.playLand(imp * 0.85, false);
          } else {
            player.vy = 0;
            player.vx *= Math.exp(-8 * dt);
            player.deathAngVel *= Math.exp(-7 * dt);
          }
          break;
        }
      }
    }

    player.deathAngle += player.deathAngVel * dt;
    // Step spring-damper floppy limb angles reacting to acceleration & tumbling spin
    const accKick = clamp((player.vy - prevVy) * 0.06 + (player.vx - prevVx) * 0.05, -24, 24);
    for (let i = 0; i < player.ragdollLimbs.length; i++) {
      const lb = player.ragdollLimbs[i];
      const phaseDir = (i % 2 === 0 ? 1 : -1);
      const spring = -26 * lb.a - 4.2 * lb.v + phaseDir * (player.deathAngVel * 2.1 + accKick);
      lb.v += spring * dt;
      lb.a = clamp(lb.a + lb.v * dt, -1.65, 1.65);
    }
    if (Math.abs(player.vy) > 120 && Math.random() < dt * 14) {
      spawnParticle(
        player.x + player.w * 0.5 + (Math.random() - 0.5) * 10,
        player.y + player.h * 0.5 + (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 14,
        -22,
        0.26,
        '#9aa4b8',
        1.2,
        0
      );
    }
  } else if (player.deathCause === 'drown') {
    // Gentle underwater collapse: tilts sideways & slowly drifts/sinks
    player.vx *= Math.exp(-4.5 * dt);
    player.vy += (16 - player.vy) * (1 - Math.exp(-3.2 * dt));
    player.x += player.vx * dt;
    const ny = player.y + player.vy * dt;
    const footTy = Math.floor((ny + player.h - 0.001) / TILE);
    const cTx = Math.floor((player.x + player.w * 0.5) / TILE);
    if (isFullSolidAt(world, cTx, footTy)) {
      player.y = footTy * TILE - player.h;
      player.vy = 0;
    } else {
      player.y = ny;
    }
    const targetAng = player.facing * (Math.PI * 0.5);
    player.deathAngle += (targetAng - player.deathAngle) * (1 - Math.exp(-5.5 * dt));
    if (Math.random() < dt * 3.5) {
      spawnWaterBubble(player.x + player.w * 0.5, player.y + player.h * 0.4, 0, -24);
    }
  } else {
    // Standard hazard/deadly collapse onto the ground & topple sideways
    player.vy = Math.min(PHYS.maxFall, player.vy + PHYS.gravity * dt);
    player.x += player.vx * dt;
    const ny = player.y + player.vy * dt;
    const footTy = Math.floor((ny + player.h - 0.001) / TILE);
    const cTx = Math.floor((player.x + player.w * 0.5) / TILE);
    if (player.vy >= 0 && (isFullSolidAt(world, cTx, footTy) || isOneWaySupportAt(world, cTx, footTy))) {
      if (player.vy > 75) {
        player.vy = -player.vy * 0.26;
        player.vx *= 0.55;
        spawnLandingDust(player.x + player.w * 0.5, footTy * TILE, 0.45, false);
      } else {
        player.vy = 0;
        player.vx *= Math.exp(-10 * dt);
      }
      player.y = footTy * TILE - player.h;
    } else {
      player.y = ny;
    }
    const targetAng = -player.facing * (Math.PI * 0.5);
    player.deathAngle += (targetAng - player.deathAngle) * (1 - Math.exp(-8.5 * dt));
  }

  const scK = 1 - Math.exp(-12 * dt);
  player.scaleX += (1 - player.scaleX) * scK;
  player.scaleY += (1 - player.scaleY) * scK;

  if (player.deathTimer <= 0) {
    revivePlayerNearDeath();
  }
}

export function updateRuntimeObjects(world, dt) {
  if (runtime.teleportCd > 0) runtime.teleportCd = Math.max(0, runtime.teleportCd - dt);
  if (runtime.hurtCd > 0) runtime.hurtCd = Math.max(0, runtime.hurtCd - dt);
  if (runtime.hurtFlash > 0) runtime.hurtFlash = Math.max(0, runtime.hurtFlash - dt);
  if (runtime.holdSwingTimer > 0) runtime.holdSwingTimer = Math.max(0, runtime.holdSwingTimer - dt);
  if (runtime.dropThruTimer > 0) runtime.dropThruTimer = Math.max(0, runtime.dropThruTimer - dt);

  if (runtime.dialogueSource && dialogueBox.classList.contains('show')) {
    const d = Math.hypot(
      (runtime.dialogueSource.tx + 0.5) * TILE - (player.x + player.w * 0.5),
      (runtime.dialogueSource.ty + 0.5) * TILE - (player.y + player.h * 0.5)
    );
    if (d > TILE * 4.5) hideDialogue();
  }

  // 1. CRUMBLING blocks
  for (const [key, c] of runtime.crumbling.entries()) {
    c.timer -= dt;
    if (c.timer <= 0) {
      if (c.state === 'shake') {
        c.state = 'gone';
        c.timer = 2.8;
        const comma = key.indexOf(',');
        const tx = parseInt(key.slice(0, comma), 10);
        const ty = parseInt(key.slice(comma + 1), 10);
        spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, '#8b94a6', 8, 52);
      } else {
        runtime.crumbling.delete(key);
      }
    }
  }

  // 2. MOVING platforms
  const moveSpan = TILE * 2.5;
  for (const m of runtime.moving.values()) {
    m.prevX = m.x;
    m.prevY = m.y;
    const wave = Math.sin(state.simTime * 1.45 + (m.tx * 0.7 + m.ty * 0.5));
    if (m.subType === 'VERT') {
      m.x = m.tx * TILE;
      m.y = m.ty * TILE + wave * moveSpan;
    } else {
      m.x = m.tx * TILE + wave * moveSpan;
      m.y = m.ty * TILE;
    }
    m.dx = m.x - m.prevX;
    m.dy = m.y - m.prevY;
  }

  // 3. LIVING critters / NPCs
  const pCx = player.x + player.w * 0.5;
  for (const lv of runtime.living.values()) {
    if (lv.subType === 'FLIPPING') {
      lv.facing = pCx < lv.x + TILE * 0.5 ? -1 : 1;
      continue;
    }
    if (lv.subType === 'STILL') continue;

    if (lv.turnCd > 0) lv.turnCd = Math.max(0, lv.turnCd - dt);
    lv.vx = lv.dir * 34;
    lv.facing = lv.dir;
    const nextX = lv.x + lv.vx * dt;
    const probeTx = lv.dir > 0 ? Math.floor((nextX + TILE) / TILE) : Math.floor(nextX / TILE);
    const midTy = Math.floor((lv.y + TILE * 0.5) / TILE);
    const belowTy = Math.floor((lv.y + TILE + 2) / TILE);

    const wallAhead = isFullSolidAt(world, probeTx, midTy);
    const floorAhead = isFullSolidAt(world, probeTx, belowTy) || isOneWaySupportAt(world, probeTx, belowTy);
    const tooFar = Math.abs(nextX - lv.tx * TILE) > TILE * 5;

    if ((wallAhead || !floorAhead || tooFar) && lv.turnCd <= 0) {
      lv.dir = -lv.dir;
      lv.facing = lv.dir;
      lv.turnCd = 0.25;
    } else if (!wallAhead) {
      lv.x = nextX;
    }

    lv.vy = Math.min(PHYS.maxFall, lv.vy + PHYS.gravity * dt);
    lv.y += lv.vy * dt;
    const footTy = Math.floor((lv.y + TILE - 0.001) / TILE);
    const cTx = Math.floor((lv.x + TILE * 0.5) / TILE);
    if (isFullSolidAt(world, cTx, footTy) || isOneWaySupportAt(world, cTx, footTy)) {
      lv.y = footTy * TILE - TILE;
      lv.vy = 0;
    }
  }

  // 4. DYNAMIC crates & bouncy balls
  for (const dyn of runtime.dynamics.values()) {
    const isBall = dyn.subType === 'BOUNCY BALL';
    if (Math.abs(envSys.windX) > 14) {
      dyn.vx += envSys.windX * (isBall ? 0.55 : 0.16) * dt;
    }
    dyn.vx *= Math.exp((isBall ? -1.4 : -7.5) * dt);
    if (Math.abs(dyn.vx) < 1) dyn.vx = 0;

    // Player pushing dynamic objects horizontally
    if (
      player.x + player.w > dyn.x && player.x < dyn.x + TILE &&
      player.y + player.h > dyn.y + 2 && player.y < dyn.y + TILE - 2
    ) {
      const pushDir = (player.x + player.w * 0.5) < (dyn.x + TILE * 0.5) ? 1 : -1;
      dyn.vx = pushDir * Math.max(Math.abs(player.vx) * (isBall ? 1.25 : 0.9), isBall ? 88 : 58);
      if (isBall && dyn.grounded) dyn.vy = -84;
    }

    // Horizontal movement & solid collision
    dyn.x += dyn.vx * dt;
    const dMidTy = Math.floor((dyn.y + TILE * 0.5) / TILE);
    if (dyn.vx > 0) {
      const rTx = Math.floor((dyn.x + TILE - 0.001) / TILE);
      if (isFullSolidAt(world, rTx, dMidTy)) {
        dyn.x = rTx * TILE - TILE;
        dyn.vx = isBall ? -dyn.vx * 0.72 : 0;
      }
    } else if (dyn.vx < 0) {
      const lTx = Math.floor(dyn.x / TILE);
      if (isFullSolidAt(world, lTx, dMidTy)) {
        dyn.x = (lTx + 1) * TILE;
        dyn.vx = isBall ? -dyn.vx * 0.72 : 0;
      }
    }

    // Gravity & vertical collision
    dyn.vy = Math.min(PHYS.maxFall, dyn.vy + PHYS.gravity * dt);
    dyn.y += dyn.vy * dt;
    dyn.grounded = false;
    const dCenterTx = Math.floor((dyn.x + TILE * 0.5) / TILE);
    if (dyn.vy >= 0) {
      const dFootTy = Math.floor((dyn.y + TILE - 0.001) / TILE);
      if (isFullSolidAt(world, dCenterTx, dFootTy) || isOneWaySupportAt(world, dCenterTx, dFootTy)) {
        dyn.y = dFootTy * TILE - TILE;
        if (isBall && dyn.vy > 48) {
          dyn.vy = -dyn.vy * 0.62;
        } else {
          dyn.vy = 0;
          dyn.grounded = true;
        }
      }
    } else {
      const dHeadTy = Math.floor(dyn.y / TILE);
      if (isFullSolidAt(world, dCenterTx, dHeadTy)) {
        dyn.y = (dHeadTy + 1) * TILE;
        dyn.vy = 0;
      }
    }

    // Reset fallen dynamic props back to their placed home tile
    if (dyn.y > getAbyssKillY(world)) {
      dyn.x = dyn.tx * TILE;
      dyn.y = dyn.ty * TILE;
      dyn.vx = 0;
      dyn.vy = 0;
    }
  }

  // 5. HOLDABLE emitter projectiles
  for (let i = runtime.projectiles.length - 1; i >= 0; i--) {
    const pr = runtime.projectiles[i];
    pr.life -= dt;
    if (pr.life <= 0) {
      runtime.projectiles.splice(i, 1);
      continue;
    }
    pr.vy += PHYS.gravity * 0.25 * dt;
    const nx = pr.x + pr.vx * dt;
    const ny = pr.y + pr.vy * dt;
    const pTx = Math.floor(nx / TILE);
    const pTy = Math.floor(ny / TILE);
    if (isFullSolidAt(world, pTx, pTy)) {
      if (pr.bounces > 0) {
        pr.bounces--;
        pr.vx = -pr.vx * 0.65;
        pr.vy = -Math.abs(pr.vy) * 0.5 - 40;
        spawnBurstParticles(pr.x, pr.y, pr.color || '#f28c38', 4, 40);
      } else {
        spawnBurstParticles(pr.x, pr.y, pr.color || '#f28c38', 6, 48);
        runtime.projectiles.splice(i, 1);
      }
    } else {
      pr.x = nx;
      pr.y = ny;
    }
  }

  // 6. CHANGING (SPARKLING) decorative tile sparkles (skipped completely when none are placed)
  if (runtime.sparkling.length > 0 && Math.random() < dt * 18) {
    const topLeft = screenToWorld(0, 0);
    const botRight = screenToWorld(viewport.width, viewport.height);
    const minTx = Math.floor(topLeft.wx / TILE) - 1;
    const maxTx = Math.ceil(botRight.wx / TILE) + 1;
    const minTy = Math.floor(topLeft.wy / TILE) - 1;
    const maxTy = Math.ceil(botRight.wy / TILE) + 1;

    for (let i = 0; i < runtime.sparkling.length; i++) {
      if (Math.random() > 0.25) continue;
      const sk = runtime.sparkling[i];
      if (sk.tx < minTx || sk.tx > maxTx || sk.ty < minTy || sk.ty > maxTy) continue;
      spawnParticle(
        sk.tx * TILE + Math.random() * TILE,
        sk.ty * TILE + Math.random() * TILE,
        (Math.random() - 0.5) * 16,
        -18 - Math.random() * 14,
        0.45,
        '#f5e2cf',
        1.5,
        0
      );
    }
  }
}

/* =========================================================================
   60 HZ FIXED-TIMESTEP PLAYER PHYSICS (LIQUID BUOYANCY, SWIMMING, SLOPES,
   CLIMBING, BOUNCY, CRUMBLING, MOVING PLATFORMS, MOUNTS & HAZARDS)
   ========================================================================= */
export function stepPhysics(dt) {
  const world = getActiveWorld();
  state.simTime += dt;
  player.prevX = player.x;
  player.prevY = player.y;

  updateRuntimeObjects(world, dt);
  updateWorldFX(dt);

  // During the 3-second death/ragdoll animation, step death physics and wait to revive
  if (player.dead) {
    stepDeathAnimation(world, dt);
    return;
  }

  if (player.coyoteTimer > 0) player.coyoteTimer = Math.max(0, player.coyoteTimer - dt);
  if (player.jumpBufTimer > 0) player.jumpBufTimer = Math.max(0, player.jumpBufTimer - dt);
  if (player.landTimer > 0) player.landTimer = Math.max(0, player.landTimer - dt);
  if (player.jumpTimer > 0) player.jumpTimer = Math.max(0, player.jumpTimer - dt);
  if (player.actTimer > 0) player.actTimer = Math.max(0, player.actTimer - dt);
  if (player.respawnTimer > 0) player.respawnTimer = Math.max(0, player.respawnTimer - dt);
  if (player.liquidExitCd > 0) player.liquidExitCd = Math.max(0, player.liquidExitCd - dt);
  if (player.skipExitSplashTimer > 0) player.skipExitSplashTimer = Math.max(0, player.skipExitSplashTimer - dt);
  if (player.damageFlashTimer > 0) player.damageFlashTimer = Math.max(0, player.damageFlashTimer - dt);

  // Periodic blink timer
  if (player.blinkDur > 0) {
    player.blinkDur = Math.max(0, player.blinkDur - dt);
  } else {
    player.blinkTimer -= dt;
    if (player.blinkTimer <= 0) {
      player.blinkDur = 0.14;
      player.blinkTimer = 2.6 + Math.random() * 3.4;
    }
  }

  const moveDir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (moveDir !== 0) {
    player.facing = moveDir;
    state.activeMotionId = null;
  }

  // Check tile overlaps around player's body
  const pLeft = Math.floor((player.x + 2) / TILE);
  const pRight = Math.floor((player.x + player.w - 3) / TILE);
  const pTop = Math.floor((player.y + 2) / TILE);
  const pBot = Math.floor((player.y + player.h - 2) / TILE);
  const centerTx = Math.floor((player.x + player.w * 0.5) / TILE);
  const centerTy = Math.floor((player.y + player.h * 0.5) / TILE);

  let overlapLiquid = false;
  let liquidTopTy = Infinity;
  let overlapClimb = false;
  let overlapHarmful = false;

  for (let ty = pTop; ty <= pBot; ty++) {
    for (let tx = pLeft; tx <= pRight; tx++) {
      const info = getMainTileInfo(world, tx, ty);
      if (info) {
        if (info.type === 'LIQUID') {
          overlapLiquid = true;
          if (ty < liquidTopTy) liquidTopTy = ty;
        } else if (info.type === 'CLIMBABLE') {
          overlapClimb = true;
        } else if (info.type === 'PUSHING') {
          const force = 420;
          if (info.subType === 'RIGHT') player.vx += force * dt;
          else if (info.subType === 'LEFT') player.vx -= force * dt;
          else if (info.subType === 'DOWN') player.vy += force * dt;
          else player.vy -= force * 1.15 * dt;
        } else if (info.type === 'GATHERABLE' && !runtime.collected.has(info.key)) {
          runtime.collected.add(info.key);
          SFX.playCollect();
          spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, '#f28c38', 10, 62);
        } else if (info.type === 'CHANGING' && info.subType === 'ON TOUCH') {
          triggerTileAnim('main', tx, ty, 'TOUCH');
        } else if (info.type === 'ACTIVATOR' && info.subType === 'SWITCH') {
          if (!runtime.activators.get(info.key)) {
            toggleActivatorSwitch(world, tx, ty);
          }
        } else if (info.type === 'TRANSPORTING' && info.subType === 'ON TOUCH' && runtime.teleportCd <= 0) {
          teleportFromPortal(world, tx, ty, info.id);
        } else if (info.type === 'HARMFUL') {
          if (isDeadlyHarmSubType(info.subType)) {
            triggerPlayerDeath('deadly', false);
            return;
          }
          overlapHarmful = true;
          player.healthRegenDelay = Math.max(player.healthRegenDelay, 1.8);
          if (runtime.hurtCd <= 0) {
            const dmg = getHarmDamage(info.sp);
            runtime.hurtCd = 0.65;
            runtime.hurtFlash = 0.35;
            player.damageFlashTimer = 0.25;
            player.healthRegenDelay = 2.2;
            player.healthFullDelay = 0.9;
            player.health = Math.max(0, player.health - dmg);
            const away = (player.x + player.w * 0.5) < (tx * TILE + TILE * 0.5) ? -1 : 1;
            player.vx = away * 145;
            player.vy = -165;
            player.grounded = false;
            if (player.health <= 0) {
              triggerPlayerDeath('harmful', false);
              return;
            }
            SFX.playHurt();
            spawnBurstParticles(player.x + player.w * 0.5, player.y + player.h * 0.5, '#cf5959', 8, 60);
          }
        }
      }
      if (isWalkableBackAt(world, tx, ty)) {
        overlapClimb = true;
      }
    }
  }

  // Track highest contiguous liquid surface column above the player
  let surfaceY = player.lastLiquidSurfaceY;
  if (overlapLiquid) {
    let topTy = liquidTopTy;
    let guard = 0;
    while (guard++ < 32 && getMainTileType(world, centerTx, topTy - 1) === 'LIQUID') {
      topTy--;
    }
    surfaceY = topTy * TILE;
    player.lastLiquidSurfaceY = surfaceY;
  }

  // Liquid entry & exit transitions with velocity-scaled splashes
  const wasInLiquid = player.inLiquid;
  player.inLiquid = overlapLiquid;
  if (!wasInLiquid && player.inLiquid) {
    const plungeImp = clamp(Math.hypot(player.vx * 0.35, player.vy) / 210, 0.35, 1.15);
    spawnLiquidSplash(player.x + player.w * 0.5, surfaceY + 2, false, plungeImp);
    SFX.playSplash(false, plungeImp);
    // Soften impact velocity so the player plunges smoothly before floating back up
    player.vy *= 0.42;
    player.vx *= 0.68;
    player.climbing = false;
    player.sitting = false;
    player.scaleX = 1.14;
    player.scaleY = 0.88;
  } else if (wasInLiquid && !player.inLiquid) {
    if (player.skipExitSplashTimer <= 0) {
      const exitImp = clamp(Math.hypot(player.vx * 0.4, player.vy) / 185, 0.35, 1.05);
      spawnLiquidSplash(player.x + player.w * 0.5, player.lastLiquidSurfaceY + 2, true, exitImp);
      SFX.playSplash(true, exitImp);
    }
    player.swimming = false;
    player.swimTilt = 0;
  }

  // Climbing entry / exit (ladders & walkable backs)
  if (overlapClimb && !player.inLiquid && !runtime.mount) {
    if (keys.up || (keys.down && !player.grounded)) {
      player.climbing = true;
      player.grounded = false;
      player.sitting = false;
    }
  } else {
    player.climbing = false;
  }

  // Flying mount movement
  if (runtime.mount && runtime.mount.subType === 'FLYING') {
    const flySpeed = 148;
    const vDir = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    player.vx += (moveDir * flySpeed - player.vx) * (1 - Math.exp(-8 * dt));
    player.vy += (vDir * flySpeed - player.vy) * (1 - Math.exp(-8 * dt));
    player.grounded = false;
    player.swimming = false;
  } else if (player.inLiquid) {
    // Liquid physics: automatic buoyancy floats player cleanly to the top surface
    const targetFloatY = surfaceY - player.h * 0.24;
    const depthBelowSurface = player.y - targetFloatY;
    const nearSurface = depthBelowSurface <= 5.5;

    // Active swimming check: walk cycle ONLY plays when actively swimming
    const activelySwimming = (moveDir !== 0) || keys.down || (keys.up && !nearSurface);
    player.swimming = activelySwimming;

    // Horizontal fluid swimming with gentle stroke surges
    if (moveDir !== 0) {
      player.swimCycle += dt * 7.2;
      const strokeSurge = 1 + 0.16 * Math.sin(player.swimCycle * 2);
      const targetVx = moveDir * PHYS.liquidMaxX * strokeSurge;
      const accel = PHYS.liquidSwimAccelX * dt;
      if (player.vx < targetVx) player.vx = Math.min(targetVx, player.vx + accel);
      else player.vx = Math.max(targetVx, player.vx - accel);
    } else {
      const drag = PHYS.liquidDragX * dt;
      if (Math.abs(player.vx) <= drag) player.vx = 0;
      else player.vx -= Math.sign(player.vx) * drag;
    }

    // Vertical buoyancy, diving, upward swimming & clean breach-out leap
    if (keys.down) {
      player.swimCycle += dt * 6.5;
      player.vy += (PHYS.liquidDiveSpeed - player.vy) * (1 - Math.exp(-5.5 * dt));
    } else if (keys.up && nearSurface && player.liquidExitCd <= 0) {
      // Breach cleanly out of the water surface
      player.vy = PHYS.liquidExitHop;
      player.liquidExitCd = 0.24;
      player.skipExitSplashTimer = 0.24;
      player.jumpTimer = 0.18;
      player.scaleX = 0.86;
      player.scaleY = 1.18;
      spawnLiquidSplash(player.x + player.w * 0.5, surfaceY + 2, true, 0.88);
      SFX.playLiquidJump();
    } else if (keys.up && !nearSurface) {
      player.swimCycle += dt * 7.6;
      player.vy = Math.max(PHYS.liquidSwimVel, player.vy - PHYS.liquidSwimAccel * dt);
    } else {
      // Automatic float-to-top buoyancy + calm bobbing at the waterline
      if (depthBelowSurface > 1.5) {
        player.vy = Math.max(PHYS.liquidFloatSpeed, player.vy - PHYS.liquidBuoyancy * dt);
      } else {
        const bobTarget = targetFloatY + Math.sin(state.simTime * 3.1) * 1.15;
        const springVy = (bobTarget - player.y) * 9.5;
        player.vy += (springVy - player.vy) * (1 - Math.exp(-8.5 * dt));
      }
    }

    // Smooth swimming body tilt
    let targetTilt = 0;
    if (activelySwimming) {
      if (keys.down) targetTilt = player.facing * 0.24;
      else if (keys.up && !nearSurface) targetTilt = -player.facing * 0.14;
      else if (moveDir !== 0) targetTilt = moveDir * 0.16;
    }
    player.swimTilt += (targetTilt - player.swimTilt) * (1 - Math.exp(-8 * dt));

    // Swimming sound strokes, underwater air bubbles & surface wake ripples
    if (activelySwimming) {
      player.swimSoundTimer -= dt;
      if (player.swimSoundTimer <= 0) {
        SFX.playSwimStroke(Boolean(keys.up && !nearSurface));
        player.swimSoundTimer = 0.34;
      }
      player.swimBubbleTimer -= dt;
      if (player.swimBubbleTimer <= 0) {
        player.swimBubbleTimer = 0.16 + Math.random() * 0.14;
        spawnWaterBubble(
          player.x + player.w * 0.5 - player.facing * 5,
          player.y + player.h * 0.55,
          -player.vx * 0.22,
          -22
        );
        if (nearSurface && Math.abs(player.vx) > 20) {
          if (worldFX.waterRipples.length > 36) worldFX.waterRipples.shift();
          worldFX.waterRipples.push({
            x: player.x + player.w * 0.5 - player.facing * 4,
            y: surfaceY + 1.5,
            timer: 0,
            maxTimer: 0.32,
            maxRx: 8.5,
            crownH: 0,
            color: '#b2e1fa'
          });
        }
      }
    } else {
      player.swimSoundTimer = 0;
      if (!nearSurface) {
        player.diveBubbleTimer -= dt;
        if (player.diveBubbleTimer <= 0) {
          player.diveBubbleTimer = 0.36 + Math.random() * 0.3;
          spawnWaterBubble(player.x + player.w * 0.5, player.y + 4, 0, -24);
        }
      }
    }
  } else if (player.climbing) {
    player.swimming = false;
    player.swimTilt = 0;
    const vDir = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    player.vx = moveDir * PHYS.climbSpeed * 0.85;
    player.vy = vDir * PHYS.climbSpeed;
    if (vDir !== 0 || moveDir !== 0) {
      player.climbAnimAcc += dt * 6;
      player.climbSoundTimer -= dt;
      if (player.climbSoundTimer <= 0) {
        SFX.playClimbStep();
        player.climbSoundTimer = 0.24;
      }
    }
    if (player.jumpBufTimer > 0 && !keys.up) {
      player.climbing = false;
      player.vy = PHYS.jumpVel * 0.9;
      player.jumpBufTimer = 0;
      SFX.playJump(false);
    }
  } else {
    player.swimming = false;
    player.swimTilt += (0 - player.swimTilt) * (1 - Math.exp(-12 * dt));

    // Ground / Air horizontal motion (with MOUNTABLE ground boost & SLIDEY ice friction)
    const maxSpd = (runtime.mount && runtime.mount.subType === 'GROUND') ? PHYS.walkMax * 1.48 : PHYS.walkMax;
    const accel = player.grounded
      ? (player.onSlip ? PHYS.slipAccel : PHYS.groundAccel)
      : PHYS.airAccel;
    const decel = player.grounded
      ? (player.onSlip ? PHYS.slipDecel : PHYS.groundDecel)
      : PHYS.airDecel;

    if (moveDir !== 0 && !player.sitting) {
      const targetVx = moveDir * maxSpd;
      const step = accel * dt;
      if (player.vx < targetVx) player.vx = Math.min(targetVx, player.vx + step);
      else player.vx = Math.max(targetVx, player.vx - step);
    } else {
      const step = decel * dt;
      if (Math.abs(player.vx) <= step) player.vx = 0;
      else player.vx -= Math.sign(player.vx) * step;
    }

    // Drop through ONE-WAY platforms when holding S/Down
    if (keys.down && player.grounded) {
      const footTy = Math.floor((player.y + player.h + 1) / TILE);
      const standingOneWay = isOneWaySupportAt(world, pLeft, footTy) || isOneWaySupportAt(world, pRight, footTy);
      const standingSolid = isFullSolidAt(world, pLeft, footTy) || isFullSolidAt(world, pRight, footTy);
      if (standingOneWay && !standingSolid) {
        runtime.dropThruTimer = 0.22;
        player.grounded = false;
        player.y += 2;
      } else {
        player.sitting = true;
      }
    } else {
      player.sitting = false;
    }

    // Coyote time & buffered jump + Sticky Wall Jump
    if (player.grounded) {
      player.coyoteTimer = PHYS.coyoteMax;
      player.jumpCutDone = false;
    }

    const touchStickyLeft = !player.grounded && getMainTileInfo(world, Math.floor((player.x - 1) / TILE), centerTy)?.subType === 'STICKY';
    const touchStickyRight = !player.grounded && getMainTileInfo(world, Math.floor((player.x + player.w + 1) / TILE), centerTy)?.subType === 'STICKY';

    if (player.jumpBufTimer > 0) {
      if (player.coyoteTimer > 0) {
        player.vy = PHYS.jumpVel;
        player.grounded = false;
        player.sitting = false;
        player.coyoteTimer = 0;
        player.jumpBufTimer = 0;
        player.jumpCutDone = false;
        player.jumpTimer = 0.16;
        player.scaleX = 0.86;
        player.scaleY = 1.16;
        spawnRunDust(player.x + player.w * 0.5, player.y + player.h, player.facing, player.onSlip, true);
        SFX.playJump(false);
      } else if (touchStickyLeft || touchStickyRight) {
        player.vy = PHYS.jumpVel * 0.94;
        player.vx = touchStickyLeft ? PHYS.walkMax * 1.15 : -PHYS.walkMax * 1.15;
        player.facing = touchStickyLeft ? 1 : -1;
        player.jumpBufTimer = 0;
        player.jumpCutDone = false;
        player.jumpTimer = 0.16;
        player.scaleX = 0.86;
        player.scaleY = 1.16;
        SFX.playJump(true);
      }
    }

    // Variable jump height cut on early release
    if (!keys.up && player.vy < -60 && !player.jumpCutDone) {
      player.vy *= PHYS.jumpCutFactor;
      player.jumpCutDone = true;
    }

    // Gravity (slowed slide on STICKY walls)
    const grav = (touchStickyLeft || touchStickyRight) && player.vy > 0 ? PHYS.gravity * 0.25 : PHYS.gravity;
    player.vy = Math.min(PHYS.maxFall, player.vy + grav * dt);
  }

  // Apply horizontal movement & solid collisions
  player.x += player.vx * dt;
  const hTop = Math.floor((player.y + 2) / TILE);
  const hBot = Math.floor((player.y + player.h - 2) / TILE);
  if (player.vx > 0) {
    const rTx = Math.floor((player.x + player.w - 0.001) / TILE);
    for (let ty = hTop; ty <= hBot; ty++) {
      if (isFullSolidAt(world, rTx, ty)) {
        player.x = rTx * TILE - player.w;
        player.vx = 0;
        break;
      }
    }
  } else if (player.vx < 0) {
    const lTx = Math.floor(player.x / TILE);
    for (let ty = hTop; ty <= hBot; ty++) {
      if (isFullSolidAt(world, lTx, ty)) {
        player.x = (lTx + 1) * TILE;
        player.vx = 0;
        break;
      }
    }
  }

  // Apply vertical movement & solid / one-way / moving platform / slope collisions
  const wasGrounded = player.grounded;
  const preImpactVy = player.vy;
  const prevBottom = player.y + player.h;
  player.y += player.vy * dt;
  player.grounded = false;
  player.onSlip = false;

  const vLeft = Math.floor((player.x + 2) / TILE);
  const vRight = Math.floor((player.x + player.w - 3) / TILE);

  if (player.vy >= 0) {
    const footTy = Math.floor((player.y + player.h - 0.001) / TILE);
    let landedTileInfo = null;
    for (let tx = vLeft; tx <= vRight; tx++) {
      const solid = isFullSolidAt(world, tx, footTy);
      const oneWay = runtime.dropThruTimer <= 0 && !player.climbing && isOneWaySupportAt(world, tx, footTy) && prevBottom <= footTy * TILE + 3.5;
      if (solid || oneWay) {
        player.y = footTy * TILE - player.h;
        player.vy = 0;
        player.grounded = true;
        landedTileInfo = getMainTileInfo(world, tx, footTy);
        if (landedTileInfo && landedTileInfo.type === 'SLIDEY') player.onSlip = true;
        if (landedTileInfo && landedTileInfo.type === 'CRUMBLING' && !runtime.crumbling.has(landedTileInfo.key)) {
          runtime.crumbling.set(landedTileInfo.key, {
            state: 'shake',
            timer: landedTileInfo.subType === 'FAST' ? 0.32 : 0.68
          });
        }
        if (landedTileInfo && landedTileInfo.type === 'BOUNCY') {
          player.grounded = false;
          player.vy = PHYS.bounceVel;
          if (landedTileInfo.subType === 'LEFT') player.vx = -PHYS.walkMax * 1.45;
          else if (landedTileInfo.subType === 'RIGHT') player.vx = PHYS.walkMax * 1.45;
          worldFX.bounceTimers.set(landedTileInfo.key, 0.24);
          player.scaleX = 0.82;
          player.scaleY = 1.24;
          SFX.playBounce();
          spawnBurstParticles(tx * TILE + TILE * 0.5, footTy * TILE, '#f28c38', 7, 56);
        }
        break;
      }
    }

    // Check MOVING platforms
    if (!player.grounded && runtime.moving.size > 0) {
      for (const m of runtime.moving.values()) {
        if (
          player.x + player.w > m.x + 1 &&
          player.x < m.x + TILE - 1 &&
          prevBottom <= m.prevY + 5 &&
          player.y + player.h >= m.y
        ) {
          player.y = m.y - player.h;
          player.x += m.dx;
          player.vy = 0;
          player.grounded = true;
          break;
        }
      }
    }
  } else {
    const headTy = Math.floor(player.y / TILE);
    for (let tx = vLeft; tx <= vRight; tx++) {
      if (isFullSolidAt(world, tx, headTy)) {
        player.y = (headTy + 1) * TILE;
        player.vy = 0;
        break;
      }
    }
  }

  // 45-degree walkable SLOPE collision
  const footCx = player.x + player.w * 0.5;
  const slopeTx = Math.floor(footCx / TILE);
  const slopeTy = Math.floor((player.y + player.h - 1) / TILE);
  const slopeInfo = getMainTileInfo(world, slopeTx, slopeTy);
  if (slopeInfo && slopeInfo.type === 'SLOPE' && player.vy >= 0) {
    const localX = clamp(footCx - slopeTx * TILE, 0, TILE);
    const surfaceOffset = slopeInfo.subType === 'UP-LEFT \\' ? localX : (TILE - localX);
    const targetY = slopeTy * TILE + surfaceOffset - player.h;
    if (player.y >= targetY - 4) {
      player.y = targetY;
      player.vy = 0;
      player.grounded = true;
    }
  }

  // Landing impact foley, dust & squash
  if (!wasGrounded && player.grounded && !player.inLiquid && preImpactVy > 65) {
    const imp = clamp((preImpactVy - 55) / 210, 0.2, 1.0);
    player.landTimer = 0.12;
    player.scaleX = 1 + imp * 0.18;
    player.scaleY = 1 - imp * 0.16;
    spawnLandingDust(player.x + player.w * 0.5, player.y + player.h, imp, player.onSlip);
    SFX.playLand(imp, player.onSlip);
  }

  // Running dust & footsteps
  if (player.grounded && !player.inLiquid && Math.abs(player.vx) > 22) {
    player.runDustTimer -= dt;
    if (player.runDustTimer <= 0) {
      player.runDustTimer = player.onSlip ? 0.12 : 0.18;
      spawnRunDust(player.x + player.w * 0.5, player.y + player.h, Math.sign(player.vx), player.onSlip, false);
    }
    player.stepTimer -= dt;
    if (player.stepTimer <= 0) {
      SFX.playStep(player.onSlip);
      player.stepTimer = player.onSlip ? 0.24 : 0.28;
    }
  } else {
    player.stepTimer = Math.min(player.stepTimer, 0.06);
  }

  // Smooth squash/stretch recovery
  const scK = 1 - Math.exp(-14 * dt);
  player.scaleX += (1 - player.scaleX) * scK;
  player.scaleY += (1 - player.scaleY) * scK;

  // Track last safe dry standing position as a fallback anchor
  if (player.grounded && !player.inLiquid && !player.onSlip && runtime.hurtCd <= 0) {
    const standFloorTy = Math.floor((player.y + player.h + 1) / TILE);
    const standFloorTx = Math.floor((player.x + player.w * 0.5) / TILE);
    const fInfo = getMainTileInfo(world, standFloorTx, standFloorTy);
    if (fInfo && (fInfo.type === 'SOLID' || fInfo.type === 'SLOPE')) {
      player.lastSafePos = { x: player.x, y: player.y, valid: true };
    }
  }

  // Track continuous airborne fall duration (> 4 seconds triggers ragdoll fall death)
  const isFallingInAir = (
    !player.grounded &&
    !player.climbing &&
    !player.inLiquid &&
    !(runtime.mount && runtime.mount.subType === 'FLYING') &&
    player.vy > 20
  );
  if (isFallingInAir) {
    player.fallTimer += dt;
    if (player.fallTimer >= 4.0) {
      triggerPlayerDeath('fall', true);
      return;
    }
  } else {
    player.fallTimer = 0;
  }

  // Falling off the map triggers ragdoll fall death (3s animation -> revive at safest nearby spot)
  if (player.y > getAbyssKillY(world)) {
    triggerPlayerDeath('abyss', true);
    return;
  }

  // Minecraft-style Breath Bar & Slow Drowning Health Depletion
  const headTx = Math.floor((player.x + player.w * 0.5) / TILE);
  const headTy = Math.floor((player.y + 3) / TILE);
  const headInfo = getMainTileInfo(world, headTx, headTy);
  const headInLiquid = Boolean(headInfo && headInfo.type === 'LIQUID');
  const headLiquidBreathable = Boolean(
    headInLiquid &&
    headInfo.sp &&
    ((headInfo.sp.liquidOpts && headInfo.sp.liquidOpts.breathable) || headInfo.sp.subType === 'BREATHABLE')
  );

  const wasSubmerged = player.submerged;
  player.inBreathableLiquid = headInLiquid && headLiquidBreathable;
  player.submerged = headInLiquid && !headLiquidBreathable;

  if (player.submerged) {
    const prevBubbles = Math.ceil(player.breath);
    // Slow Minecraft-paced depletion: 10 bubbles over ~15 seconds
    player.breath = Math.max(0, player.breath - (player.maxBreath / 15) * dt);
    const nextBubbles = Math.ceil(player.breath);
    if (nextBubbles < prevBubbles) {
      for (let b = prevBubbles - 1; b >= Math.max(0, nextBubbles); b--) {
        player.breathPopFx.push({ slot: b, timer: 0, maxTimer: 0.22 });
      }
      if (nextBubbles > 0) {
        SFX.playBreathPop(nextBubbles);
      }
    }
    player.breathFullDelay = 0.65;

    // Once out of air, slowly drain player health instead of killing immediately
    if (player.breath <= 0) {
      player.healthRegenDelay = 2.4;
      player.healthFullDelay = 0.9;
      // ~15 HP/sec (~6.7s from full health to zero)
      player.health = Math.max(0, player.health - 15 * dt);
      player.drownTickTimer -= dt;
      if (player.drownTickTimer <= 0 && player.health > 0) {
        player.drownTickTimer = 0.85;
        player.damageFlashTimer = 0.22;
        runtime.hurtFlash = 0.18;
        SFX.playDrownHurt();
        const cx = player.x + player.w * 0.5;
        const cy = player.y + player.h * 0.35;
        for (let i = 0; i < 3; i++) {
          spawnWaterBubble(cx + (Math.random() - 0.5) * 8, cy, (Math.random() - 0.5) * 18, -26);
        }
      }

      if (player.health <= 0) {
        triggerPlayerDeath('drown', false);
        return;
      }
    } else {
      player.drownTickTimer = 0;
    }
  } else {
    player.drownTickTimer = 0;
    if (wasSubmerged && player.breath < player.maxBreath - 1.0) {
      SFX.playGasp();
    }
    if (player.breath < player.maxBreath) {
      player.breath = Math.min(player.maxBreath, player.breath + 4.5 * dt);
      player.breathFullDelay = 0.6;
    } else if (player.breathFullDelay > 0) {
      player.breathFullDelay = Math.max(0, player.breathFullDelay - dt);
    }
    // Gently regenerate health once safely out of danger (after leaving harmfuls & water)
    if (player.health < player.maxHealth) {
      if (overlapHarmful) {
        player.healthRegenDelay = Math.max(player.healthRegenDelay, 1.8);
      } else if (player.healthRegenDelay > 0) {
        player.healthRegenDelay = Math.max(0, player.healthRegenDelay - dt);
      } else {
        player.health = Math.min(player.maxHealth, player.health + 14 * dt);
      }
      player.healthFullDelay = 0.85;
    } else if (player.healthFullDelay > 0) {
      player.healthFullDelay = Math.max(0, player.healthFullDelay - dt);
    }
  }

  for (let i = player.breathPopFx.length - 1; i >= 0; i--) {
    const fx = player.breathPopFx[i];
    fx.timer += dt;
    if (fx.timer >= fx.maxTimer) player.breathPopFx.splice(i, 1);
  }

  const showBreathHud = player.submerged || player.breath < player.maxBreath - 0.01 || player.breathFullDelay > 0;
  const targetHudAlpha = showBreathHud ? 1 : 0;
  player.breathHudAlpha += (targetHudAlpha - player.breathHudAlpha) * (1 - Math.exp(-10 * dt));
  if (player.breathHudAlpha < 0.005 && targetHudAlpha === 0) player.breathHudAlpha = 0;

  const showHealthHud = (
    player.health < player.maxHealth - 0.01 ||
    player.healthFullDelay > 0 ||
    (player.submerged && player.breath <= 0.5)
  );
  const targetHealthAlpha = showHealthHud ? 1 : 0;
  player.healthHudAlpha += (targetHealthAlpha - player.healthHudAlpha) * (1 - Math.exp(-10 * dt));
  if (player.healthHudAlpha < 0.005 && targetHealthAlpha === 0) player.healthHudAlpha = 0;
}
