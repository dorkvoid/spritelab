import { SFX } from './audio.js';
import {
  getPhysicsSpec,
  getHarmDamage,
  isDeadlyHarmSubType,
  isDynamicCompanion,
  isEmergingHarmSubType,
  isGearType,
  isMovingHarmSubType,
  isSlideySlopeSubType,
  isUpLeftSlopeSubType,
  PHYS,
  resolveSurfaceSound,
  STARTER_TILE_ID,
  TILE
} from './constants.js';
import { dialogueBox } from './dom.js';
import { envSys } from './environment.js';
import {
  engageSeat,
  grantBigThingReward,
  releaseSeat,
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
  getSpriteById,
  keys,
  player,
  runtime,
  seedBgPlaceOrder,
  state,
  viewport,
  worldFX
} from './state.js';
import { clamp, evalEmergingHazard, getDeadlyMovingParams, getTileFxColors, orientToTransform, parseTileKey, transformOrientVec } from './utils.js';
import { emitWorldEvent } from './events.js';
import { compileDynamicProgram, evaluateDynamicFrame } from './dynamicEngine.js';
import { savePrefsNow } from './storage.js';
import { closeChatBar, pushSpeechBubble } from './ui/chat.js';
import { closeMotionBar, stepActiveMotion, stopActiveMotion } from './ui/motionBar.js';
import { notifyPixoEvent } from './ui/pixo.js';
import { renderSidebar } from './ui/sidebar.js';
import { updateTopUI } from './ui/topbar.js';
import {
  findNearbySeat,
  getAbyssKillY,
  getMainTileInfo,
  getMainTileType,
  hideDialogue,
  isClimbableBigThingAt,
  isFullSolidAt,
  isOneWayCeilingAt,
  isOneWaySupportAt,
  isOneWayWallLeftAt,
  isOneWayWallRightAt,
  isWalkableBackAt,
  resetRuntimeWorld,
  screenToWorld,
  syncRuntimeEntities,
  tileKey
} from './world.js';

function getBouncyLaunchVec(info) {
  let bx = 0;
  let by = -1;
  if (info.subType === 'LEFT') { bx = -0.62; by = -1; }
  else if (info.subType === 'RIGHT') { bx = 0.62; by = -1; }
  return transformOrientVec(bx, by, info.orient || 0);
}

function triggerBouncyContact(info, tx, ty, hitFace) {
  if (!info || info.type !== 'BOUNCY') return false;
  const vec = getBouncyLaunchVec(info);
  const absBounce = Math.abs(PHYS.bounceVel);
  const bFx = getTileFxColors(info, '#f28c38');

  if (hitFace === 'top') {
    if (vec.y >= -0.15) return false;
    player.grounded = false;
    player.vy = PHYS.bounceVel * Math.min(1, Math.abs(vec.y));
    if (Math.abs(vec.x) > 0.15) {
      player.vx = Math.sign(vec.x) * PHYS.walkMax * 1.45;
    }
    player.scaleX = 0.82;
    player.scaleY = 1.24;
    worldFX.bounceTimers.set(info.key, 0.24);
    SFX.playBounce();
    spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE, bFx.main, 7, 56, bFx.light);
    return true;
  }

  if (hitFace === 'bottom') {
    if (vec.y <= 0.15) return false;
    player.grounded = false;
    player.vy = absBounce * 0.88 * Math.min(1, Math.abs(vec.y));
    if (Math.abs(vec.x) > 0.15) {
      player.vx = Math.sign(vec.x) * PHYS.walkMax * 1.45;
    }
    player.scaleX = 1.24;
    player.scaleY = 0.78;
    worldFX.bounceTimers.set(info.key, 0.24);
    SFX.playBounce();
    spawnBurstParticles(tx * TILE + TILE * 0.5, (ty + 1) * TILE, bFx.main, 7, 56, bFx.light);
    return true;
  }

  if (hitFace === 'left') {
    if (vec.x >= -0.15) return false;
    player.grounded = false;
    player.vx = -absBounce * 0.86 * Math.min(1, Math.abs(vec.x));
    if (Math.abs(vec.y) > 0.15) {
      player.vy = Math.sign(vec.y) * absBounce * 0.72;
    } else {
      player.vy = Math.min(player.vy, -110);
    }
    player.scaleX = 0.76;
    player.scaleY = 1.22;
    worldFX.bounceTimers.set(info.key, 0.24);
    SFX.playBounce();
    spawnBurstParticles(tx * TILE, ty * TILE + TILE * 0.5, bFx.main, 7, 56, bFx.light);
    return true;
  }

  if (hitFace === 'right') {
    if (vec.x <= 0.15) return false;
    player.grounded = false;
    player.vx = absBounce * 0.86 * Math.min(1, Math.abs(vec.x));
    if (Math.abs(vec.y) > 0.15) {
      player.vy = Math.sign(vec.y) * absBounce * 0.72;
    } else {
      player.vy = Math.min(player.vy, -110);
    }
    player.scaleX = 0.76;
    player.scaleY = 1.22;
    worldFX.bounceTimers.set(info.key, 0.24);
    SFX.playBounce();
    spawnBurstParticles((tx + 1) * TILE, ty * TILE + TILE * 0.5, bFx.main, 7, 56, bFx.light);
    return true;
  }

  return false;
}

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
  player.onSticky = false;
  player.surfaceSound = 'DEFAULT';
  player.surfaceColor = null;
  player.climbing = false;
  player.inLiquid = false;
  player.inThickLiquid = false;
  player.swimming = false;
  player.swimCycle = 0;
  player.swimTilt = 0;
  player.swimBubbleTimer = 0;
  player.diveBubbleTimer = 0;
  player.liquidExitCd = 0;
  player.skipExitSplashTimer = 0;
  player.liquidHazardTickTimer = 0;
  player.lastLiquidSurfaceY = py + player.h;
  player.lastLiquidColors = null;
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
  player.laying = false;
  player.sleepZTimer = 0;
  player.blinkTimer = 2.8 + Math.random() * 2.2;
  player.blinkDur = 0;
  player.climbAnimAcc = 0;
  player.scaleX = 1;
  player.scaleY = 1;
  player.breath = player.maxBreath;
  player.health = player.maxHealth;
  player.healthTrail = player.maxHealth;
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
  player.damageFlashKind = 'hurt';
  player.hurtAngle = 0;
  player.hurtAngVel = 0;
  player.fallTimer = 0;
  player.dead = false;
  player.deathTimer = 0;
  player.deathCause = null;
  player.deathAngle = 0;
  player.deathAngVel = 0;
  player.deathFallRagdoll = false;
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
  player.onSlip = false;
  player.onSticky = false;
  player.surfaceSound = 'DEFAULT';
  player.surfaceColor = null;
  player.climbing = false;
  player.inLiquid = false;
  player.inThickLiquid = false;
  player.swimming = false;
  player.swimCycle = 0;
  player.swimTilt = 0;
  player.swimBubbleTimer = 0;
  player.diveBubbleTimer = 0;
  player.liquidExitCd = 0;
  player.skipExitSplashTimer = 0;
  player.liquidHazardTickTimer = 0;
  player.lastLiquidSurfaceY = sy + player.h;
  player.lastLiquidColors = null;
  player.coyoteTimer = 0;
  player.jumpBufTimer = 0;
  player.sitting = false;
  player.laying = false;
  player.sleepZTimer = 0;
  player.scaleX = 0.88;
  player.scaleY = 1.14;
  player.breath = player.maxBreath;
  player.health = player.maxHealth;
  player.healthTrail = player.maxHealth;
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
  player.damageFlashKind = 'hurt';
  player.hurtAngle = 0;
  player.hurtAngVel = 0;
  player.fallTimer = 0;
  player.dead = false;
  player.deathTimer = 0;
  player.deathCause = null;
  player.deathAngle = 0;
  player.deathAngVel = 0;
  player.deathFallRagdoll = false;
  player.lastSafePos = { x: sx, y: sy, valid: true };
  stopActiveMotion(true);
  closeMotionBar(true);
  closeChatBar(true);
  runtime.mount = null;
  runtime.seated = null;
  runtime.seatCd = 0;
  runtime.seatNeedsDownRelease = false;
  runtime.swingLine = null;
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

export function triggerPlayerDeath(cause, isRagdoll = false, knockDir = 0) {
  if (player.dead) return;
  player.dead = true;
  player.health = 0;
  player.deathCause = cause;
  player.deathMaxTimer = 3.0;
  player.deathTimer = 3.0;
  player.deathFallRagdoll = Boolean(isRagdoll);
  player.deathX = player.x;
  player.deathY = player.y;
  player.deathAngle = player.hurtAngle || 0;
  player.hurtAngle = 0;
  player.hurtAngVel = 0;
  player.damageFlashTimer = cause === 'drown' ? 0.30 : 0.35;
  player.damageFlashKind = cause === 'drown' ? 'drown' : 'hurt';
  player.healthHudAlpha = 1;
  player.climbing = false;
  player.sitting = false;
  player.laying = false;
  player.sleepZTimer = 0;
  player.swimming = false;
  player.swimTilt = 0;
  player.fallTimer = 0;
  stopActiveMotion(true);
  closeMotionBar(true);
  closeChatBar(true);
  emitWorldEvent('player:death', { cause });
  runtime.mount = null;
  runtime.seated = null;
  runtime.seatCd = 0;
  runtime.seatNeedsDownRelease = false;
  runtime.swingLine = null;
  hideDialogue();

  const cx = player.x + player.w * 0.5;
  const cy = player.y + player.h * 0.5;

  if (player.deathFallRagdoll) {
    const spinDir = Math.abs(player.vx) > 8 ? Math.sign(player.vx) : player.facing;
    player.vx = clamp(player.vx + spinDir * 24, -170, 170);
    player.vy = Math.max(player.vy, 95);
    player.deathAngVel = spinDir * (6.8 + Math.random() * 3.8);
    spawnBurstParticles(cx, cy, '#d8a557', 10, 72);
    SFX.playDeath('abyss');
  } else if (cause === 'drown') {
    // Gentle underwater slump (never pop upward out of shallow water)
    player.vx *= 0.22;
    player.vy = Math.max(4, Math.min(player.vy, 14));
    player.deathAngVel = 0;
    for (let i = 0; i < 8; i++) {
      spawnWaterBubble(cx + (Math.random() - 0.5) * 10, cy + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 20, -28);
    }
    spawnBurstParticles(cx, cy, '#a8dff8', 5, 28);
    SFX.playDeath('drown');
  } else {
    // Tumble-fall in sitting cel away from the HARMFUL / DEADLY hazard
    const knock = knockDir !== 0 ? Math.sign(knockDir) : -player.facing;
    player.vx = knock * (78 + Math.random() * 28);
    player.vy = -148;
    player.deathAngVel = knock * (8.2 + Math.random() * 3.0);
    player.scaleX = 0.86;
    player.scaleY = 1.16;
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
  player.onSticky = false;
  player.surfaceSound = 'DEFAULT';
  player.climbing = false;
  player.inLiquid = false;
  player.inThickLiquid = false;
  player.swimming = false;
  player.swimTilt = 0;
  player.liquidHazardTickTimer = 0;
  player.sitting = false;
  player.laying = false;
  player.sleepZTimer = 0;
  player.fallTimer = 0;
  player.dead = false;
  player.deathTimer = 0;
  player.deathCause = null;
  player.deathAngle = 0;
  player.deathAngVel = 0;
  player.deathFallRagdoll = false;
  player.hurtAngle = 0;
  player.hurtAngVel = 0;
  player.health = player.maxHealth;
  player.healthTrail = player.maxHealth;
  player.breath = player.maxBreath;
  player.submerged = false;
  player.inBreathableLiquid = false;
  player.breathHudAlpha = 0;
  player.breathFullDelay = 0;
  player.healthFullDelay = 0.9;
  player.healthRegenDelay = 0;
  player.drownTickTimer = 0;
  player.damageFlashTimer = 0;
  player.damageFlashKind = 'hurt';
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
  if (player.healthTrail > 0 && player.damageFlashTimer <= 0.14) {
    player.healthTrail = Math.max(0, player.healthTrail - Math.max(36, player.healthTrail * 4.2) * dt);
  }
  player.healthHudAlpha = 1;

  if (player.deathCause === 'drown') {
    // Calm underwater collapse: gently drifts & sinks in sitting cel with full wall/floor collision
    player.vx *= Math.exp(-5.0 * dt);
    player.vy += (18 - player.vy) * (1 - Math.exp(-3.4 * dt));

    // Horizontal move & solid wall stop
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

    // Vertical sink & full-width floor/one-way stop
    let restingOnFloor = false;
    const prevBot = player.y + player.h;
    player.y += player.vy * dt;
    const vLeft = Math.floor((player.x + 2) / TILE);
    const vRight = Math.floor((player.x + player.w - 3) / TILE);
    if (player.vy >= 0) {
      const footTy = Math.floor((player.y + player.h - 0.001) / TILE);
      for (let tx = vLeft; tx <= vRight; tx++) {
        const hitSolid = isFullSolidAt(world, tx, footTy);
        const hitOneWay = isOneWaySupportAt(world, tx, footTy) && prevBot <= footTy * TILE + 6;
        if (hitSolid || hitOneWay) {
          player.y = footTy * TILE - player.h;
          player.vy = 0;
          player.vx *= Math.exp(-10 * dt);
          restingOnFloor = true;
          break;
        }
      }
    }

    const baseAng = player.facing * (Math.PI * 0.5);
    const sway = restingOnFloor ? 0 : Math.sin(state.uiTime * 2.4) * 0.07;
    player.deathAngle += ((baseAng + sway) - player.deathAngle) * (1 - Math.exp(-4.8 * dt));
    if (Math.random() < dt * 2.6) {
      spawnWaterBubble(player.x + player.w * 0.5 + (Math.random() - 0.5) * 6, player.y + player.h * 0.35, 0, -22);
    }
  } else {
    // Unified sitting-cel tumble-fall physics for fall/abyss AND harmful/deadly deaths
    const gravScale = (player.deathFallRagdoll ? 1.05 : 1.0) * (Number.isFinite(state.gravityScale) ? state.gravityScale : 1.0);
    const maxSpd = player.deathFallRagdoll ? PHYS.maxFall * 1.45 : PHYS.maxFall * 1.15;
    player.vy = Math.min(maxSpd, player.vy + PHYS.gravity * gravScale * dt);
    player.vx *= Math.exp(-0.55 * dt);

    // Horizontal move & solid wall bounce
    player.x += player.vx * dt;
    const hTop = Math.floor((player.y + 2) / TILE);
    const hBot = Math.floor((player.y + player.h - 2) / TILE);
    if (player.vx > 0) {
      const rTx = Math.floor((player.x + player.w - 0.001) / TILE);
      for (let ty = hTop; ty <= hBot; ty++) {
        if (isFullSolidAt(world, rTx, ty)) {
          const wallImp = Math.abs(player.vx);
          player.x = rTx * TILE - player.w;
          player.vx = -player.vx * 0.48;
          if (wallImp > 35) {
            player.deathAngVel = -player.deathAngVel * 0.65 + (Math.random() - 0.5) * 3.5;
            player.scaleX = 0.84;
            player.scaleY = 1.16;
          }
          break;
        }
      }
    } else if (player.vx < 0) {
      const lTx = Math.floor(player.x / TILE);
      for (let ty = hTop; ty <= hBot; ty++) {
        if (isFullSolidAt(world, lTx, ty)) {
          const wallImp = Math.abs(player.vx);
          player.x = (lTx + 1) * TILE;
          player.vx = -player.vx * 0.48;
          if (wallImp > 35) {
            player.deathAngVel = -player.deathAngVel * 0.65 + (Math.random() - 0.5) * 3.5;
            player.scaleX = 0.84;
            player.scaleY = 1.16;
          }
          break;
        }
      }
    }

    // Vertical move, floor bounce (solid + one-way) & ceiling bounce
    let restingOnFloor = false;
    const prevBot = player.y + player.h;
    player.y += player.vy * dt;
    const vLeft = Math.floor((player.x + 2) / TILE);
    const vRight = Math.floor((player.x + player.w - 3) / TILE);
    if (player.vy >= 0) {
      const footTy = Math.floor((player.y + player.h - 0.001) / TILE);
      for (let tx = vLeft; tx <= vRight; tx++) {
        const hitSolid = isFullSolidAt(world, tx, footTy);
        const hitOneWay = isOneWaySupportAt(world, tx, footTy) && prevBot <= footTy * TILE + 6;
        if (hitSolid || hitOneWay) {
          const impSpd = Math.abs(player.vy);
          player.y = footTy * TILE - player.h;
          if (impSpd > 62) {
            player.vy = -impSpd * 0.38;
            player.vx *= 0.72;
            const spinSign = Math.abs(player.vx) > 6 ? Math.sign(player.vx) : (Math.sign(player.deathAngVel) || player.facing);
            player.deathAngVel = spinSign * clamp(impSpd * 0.042, 3.0, 10.5);
            player.scaleX = 1.22;
            player.scaleY = 0.78;
            const imp = clamp(impSpd / 240, 0.25, 1.0);
            const floorFx = getTileFxColors(getMainTileInfo(world, tx, footTy), '#9aa4b8');
            spawnLandingDust(player.x + player.w * 0.5, player.y + player.h, imp, false, floorFx.main);
            SFX.playLand(imp * 0.8, false);
          } else {
            player.vy = 0;
            player.vx *= Math.exp(-9.5 * dt);
            player.deathAngVel *= Math.exp(-8.5 * dt);
            restingOnFloor = true;
          }
          break;
        }
      }
    } else {
      const headTy = Math.floor(player.y / TILE);
      for (let tx = vLeft; tx <= vRight; tx++) {
        if (isFullSolidAt(world, tx, headTy)) {
          player.y = (headTy + 1) * TILE;
          player.vy = -player.vy * 0.32;
          player.deathAngVel *= 0.75;
          break;
        }
      }
    }

    player.deathAngle += player.deathAngVel * dt;
    if (restingOnFloor && Math.abs(player.deathAngVel) < 2.2) {
      // Flop gently onto nearest flat sideways angle (±π/2, ±3π/2, ...) once settled
      const restAngle = Math.floor(player.deathAngle / Math.PI) * Math.PI + Math.PI * 0.5;
      player.deathAngle += (restAngle - player.deathAngle) * (1 - Math.exp(-8.5 * dt));
    }

    if (player.deathFallRagdoll && Math.abs(player.vy) > 125 && Math.random() < dt * 12) {
      spawnParticle(
        player.x + player.w * 0.5 + (Math.random() - 0.5) * 10,
        player.y + player.h * 0.5 + (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 14,
        -22,
        0.24,
        '#9aa4b8',
        1.2,
        0
      );
    }
  }

  const scK = 1 - Math.exp(-12 * dt);
  player.scaleX += (1 - player.scaleX) * scK;
  player.scaleY += (1 - player.scaleY) * scK;

  if (player.deathTimer <= 0) {
    revivePlayerNearDeath();
  }
}

const CRUMBLE_GONE_SEC = 2.25;
const CRUMBLE_FADE_SEC = 0.50;

function spawnCrumbleDebris(tx, ty, info) {
  const crFx = getTileFxColors(info, '#8b94a6');
  const bx = tx * TILE;
  const by = ty * TILE;
  // Tumbling pixel chunks shed directly across the shattered 19x19 tile face
  for (let i = 0; i < 10; i++) {
    const px = bx + 2 + (i % 4) * 4.5 + (Math.random() - 0.5) * 2.5;
    const py = by + 2 + Math.floor(i / 4) * 5.5 + (Math.random() - 0.5) * 2.5;
    const vx = ((px - (bx + TILE * 0.5)) * 3.8) + (Math.random() - 0.5) * 24;
    const vy = -(10 + Math.random() * 28) + Math.floor(i / 4) * 9;
    const col = i % 3 === 0 ? crFx.main : (i % 3 === 1 ? crFx.secondary : crFx.dark);
    spawnParticle(
      px,
      py,
      vx,
      vy,
      0.34 + Math.random() * 0.24,
      col,
      i < 6 ? (2 + Math.random() * 1.2) : 1.4,
      250
    );
  }
  // Fine settling dust puff
  spawnBurstParticles(bx + TILE * 0.5, by + TILE * 0.5, crFx.light, 5, 36, crFx.main);
}

function shatterCrumblingTile(world, tx, ty, info, goneSec = CRUMBLE_GONE_SEC, playSound = true) {
  if (!info || info.type !== 'CRUMBLING' || info.subType === 'FLEXIBLE') return false;
  const cur = runtime.crumbling.get(info.key);
  if (cur && (cur.state === 'gone' || cur.state === 'fadein')) return false;
  runtime.crumbling.set(info.key, {
    state: 'gone',
    timer: goneSec,
    duration: goneSec,
    waitingClear: false
  });
  spawnCrumbleDebris(tx, ty, info);
  if (playSound) SFX.playCrumbleBreak();
  return true;
}

function triggerCrumblingStep(world, tx, ty, info, wasGrounded, preImpactVy) {
  if (!info || info.type !== 'CRUMBLING') return;
  if (info.subType === 'FLEXIBLE') {
    const fl = runtime.flexOffsets.get(info.key) || { y: 0, vy: 0 };
    if (!wasGrounded && preImpactVy > 35) {
      fl.vy += clamp(preImpactVy * 0.42, 22, 85);
    }
    fl.y = Math.max(fl.y, 1.8);
    runtime.flexOffsets.set(info.key, fl);
    return;
  }
  if (runtime.crumbling.has(info.key)) return;
  const delay = info.subType === 'INSTANT' ? 0.10 : (info.subType === 'FAST' ? 0.30 : 0.62);
  runtime.crumbling.set(info.key, {
    state: 'shake',
    timer: delay,
    duration: delay,
    waitingClear: false
  });
  SFX.playCrumbleShake();
  const crFx = getTileFxColors(info, '#8b94a6');
  for (let i = 0; i < 3; i++) {
    spawnParticle(
      tx * TILE + 3 + Math.random() * (TILE - 6),
      (ty + 1) * TILE - 1,
      (Math.random() - 0.5) * 18,
      8 + Math.random() * 14,
      0.22 + Math.random() * 0.14,
      i === 0 ? crFx.main : crFx.secondary,
      1.4,
      175
    );
  }
}

function isTileBlockedByActor(tx, ty) {
  const bx0 = tx * TILE + 1;
  const by0 = ty * TILE + 1;
  const bx1 = (tx + 1) * TILE - 1;
  const by1 = (ty + 1) * TILE - 1;
  if (!player.dead) {
    if (player.x + player.w > bx0 && player.x < bx1 && player.y + player.h > by0 && player.y < by1) {
      return true;
    }
  }
  if (runtime.dynamics.size > 0) {
    for (const dyn of runtime.dynamics.values()) {
      if (dyn.exploded) continue;
      if (dyn.x + TILE > bx0 && dyn.x < bx1 && dyn.y + TILE > by0 && dyn.y < by1) {
        return true;
      }
    }
  }
  return false;
}

export function detonateExplosive(world, dyn) {
  if (!dyn || dyn.exploded) return;
  dyn.exploded = true;
  dyn.vx = 0;
  dyn.vy = 0;
  runtime.exploded.add(dyn.key);
  runtime.explosiveFuses.delete(dyn.key);
  if (runtime.grabbedDyn && runtime.grabbedDyn.key === dyn.key) {
    runtime.grabbedDyn = null;
  }

  const cx = dyn.x + TILE * 0.5;
  const cy = dyn.y + TILE * 0.5;
  const sp = getSpriteById(dyn.id);
  const fx = getTileFxColors(sp, '#f28c38');
  const blastR = TILE * 4.8;

  SFX.playExplosion(1.0);
  runtime.screenShake = Math.min(0.45, (runtime.screenShake || 0) + 0.30);
  if (runtime.shockwaves.length >= 12) runtime.shockwaves.shift();
  runtime.shockwaves.push({
    x: cx,
    y: cy,
    r: 3,
    maxR: blastR,
    timer: 0,
    maxTimer: 0.34,
    color: fx.bright || '#ffd48c'
  });

  // Fiery flash core + smoke + colored debris particles
  spawnBurstParticles(cx, cy, '#fff4df', 8, 95, '#ffb44c');
  spawnBurstParticles(cx, cy, fx.main, 12, 130, '#e85a34');
  for (let i = 0; i < 8; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 25 + Math.random() * 55;
    spawnParticle(cx, cy, Math.cos(ang) * spd, Math.sin(ang) * spd - 22, 0.45 + Math.random() * 0.35, '#4c5261', 2.5, -24);
  }

  // Blast nearby DYNAMIC bodies radially & trigger chain explosions
  for (const other of runtime.dynamics.values()) {
    if (other === dyn || other.exploded) continue;
    const ox = other.x + TILE * 0.5;
    const oy = other.y + TILE * 0.5;
    const dx = ox - cx;
    const dy = oy - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > blastR) continue;
    const falloff = 1 - dist / blastR;
    const invD = dist > 0.5 ? 1 / dist : 1;
    const nx = dist > 0.5 ? dx * invD : (Math.random() - 0.5);
    const ny = dist > 0.5 ? dy * invD : -1;
    if (dist < TILE * 2.5) other.frozen = false;
    if (!other.frozen) {
      const imp = (340 * falloff) / Math.max(0.55, other.mass || 1);
      other.vx += nx * imp;
      other.vy += ny * imp - 95 * falloff;
      other.omega = (other.omega || 0) + nx * 12 * falloff;
      other.grounded = false;
      other.scaleX = 1.18;
      other.scaleY = 0.84;
    }
    if (other.subType === 'EXPLOSIVE' && dist < TILE * 3.6 && !runtime.explosiveFuses.has(other.key)) {
      runtime.explosiveFuses.set(other.key, 0.08 + (dist / (TILE * 3.6)) * 0.09);
    }
  }

  // Shatter CRUMBLING blocks within inner blast radius
  const crRad = 3;
  const cTx = Math.floor(cx / TILE);
  const cTy = Math.floor(cy / TILE);
  for (let dy = -crRad; dy <= crRad; dy++) {
    for (let dx = -crRad; dx <= crRad; dx++) {
      if (Math.hypot(dx, dy) > 3.2) continue;
      const info = getMainTileInfo(world, cTx + dx, cTy + dy);
      if (info && info.type === 'CRUMBLING' && info.subType !== 'FLEXIBLE') {
        shatterCrumblingTile(world, cTx + dx, cTy + dy, info, 2.5, false);
      }
    }
  }

  // Launch player with blast shockwave
  if (!player.dead) {
    const px = player.x + player.w * 0.5;
    const py = player.y + player.h * 0.5;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < blastR) {
      if (runtime.seated) releaseSeat(false);
      const falloff = 1 - dist / blastR;
      const nx = dist > 0.5 ? dx / dist : player.facing;
      const ny = dist > 0.5 ? dy / dist : -1;
      const imp = 290 * falloff;
      player.vx += nx * imp;
      player.vy = Math.min(player.vy, ny * imp - 125 * falloff);
      player.grounded = false;
      player.climbing = false;
      player.hurtAngVel = nx * 9 * falloff;
      player.scaleX = 0.84;
      player.scaleY = 1.18;
    }
  }
}

function resolveJointEndpoint(world, key) {
  const dyn = runtime.dynamics.get(key);
  if (dyn && !dyn.exploded) {
    return {
      isDyn: true,
      dyn,
      x: dyn.x + TILE * 0.5,
      y: dyn.y + TILE * 0.5,
      invMass: dyn.frozen ? 0 : (1 / Math.max(0.3, dyn.mass || 1))
    };
  }
  const sep = key.indexOf(',');
  if (sep <= 0) return null;
  const tx = parseInt(key.slice(0, sep), 10);
  const ty = parseInt(key.slice(sep + 1), 10);
  if (!world.layers.main[key] && !world.layers.bg[key] && !world.layers.fg[key]) return null;
  return {
    isDyn: false,
    dyn: null,
    x: tx * TILE + TILE * 0.5,
    y: ty * TILE + TILE * 0.5,
    invMass: 0
  };
}

/* Reusable scratch containers (eliminates 60Hz per-tick Set/Map GC churn) */
const _wiredTargets = new Set();
const _wiredSources = new Set();
const _incomingByTarget = new Map();
const _prevPlates = new Set();
const _liveLogicKeys = new Set();
const _gateState = new Map();
const _unwiredSources = [];
const _curSwitches = new Set();

/* =========================================================================
   MULTI-HOP MACHINE SIGNAL & LOGIC GATE EVALUATOR
   Supports SWITCH (Toggle/Timed/Pulse), PRESSURE PLATE, TIMER, PROXIMITY,
   NOT GATE, AND GATE, OR / RELAY (with optional delay), & inverted wires.
   Runs both at 60Hz in PLAY and live-preview in BUILD Blueprint Wire mode.
   ========================================================================= */
export function evaluateWireNetwork(world, dt = 0, blueprintPreview = false) {
  const wires = Array.isArray(world.wires) ? world.wires : [];
  _wiredTargets.clear();
  _wiredSources.clear();
  _incomingByTarget.clear();
  for (let i = 0; i < wires.length; i++) {
    const w = wires[i];
    _wiredSources.add(w.from);
    _wiredTargets.add(w.to);
    let list = _incomingByTarget.get(w.to);
    if (!list) {
      list = [];
      _incomingByTarget.set(w.to, list);
    }
    list.push(w);
  }

  // Decrement TIMED / PULSE switches
  if (dt > 0 && runtime.switchTimers.size > 0) {
    for (const [k, rem] of runtime.switchTimers.entries()) {
      const next = rem - dt;
      if (next <= 0) {
        runtime.switchTimers.delete(k);
        runtime.activators.set(k, false);
        if (!blueprintPreview) SFX.playSwitch(false);
      } else {
        runtime.switchTimers.set(k, next);
      }
    }
  }

  _prevPlates.clear();
  for (const pk of runtime.platePressed) _prevPlates.add(pk);
  runtime.platePressed.clear();
  runtime.timerOn.clear();
  runtime.proxActive.clear();
  _unwiredSources.length = 0;
  const clockT = blueprintPreview ? state.uiTime : state.simTime;

  // Iterate ONLY cached ACTIVATOR sources (O(sources) instead of O(world tiles)!)
  const sources = runtime.actSources;
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const sp = getSpriteById(src.id);
    if (!sp) continue;
    const key = src.key;
    const tx = src.tx;
    const ty = src.ty;
    const opts = sp.actOpts || {};

    if (src.subType === 'PRESSURE PLATE') {
      const cx = (tx + 0.5) * TILE;
      let pressed = false;
      if (!player.dead) {
        const px = player.x + player.w * 0.5;
        const py = player.y + player.h - 2;
        if (Math.abs(px - cx) <= TILE * 0.78 && py >= ty * TILE - 3 && player.y <= (ty + 1) * TILE) {
          pressed = true;
        }
      }
      if (!pressed) {
        for (const dyn of runtime.dynamics.values()) {
          if (dyn.exploded) continue;
          const dx = dyn.x + TILE * 0.5;
          const dy = dyn.y + TILE - 2;
          if (Math.abs(dx - cx) <= TILE * 0.8 && dy >= ty * TILE - 3 && dyn.y <= (ty + 1) * TILE) {
            pressed = true;
            break;
          }
        }
      }
      if (pressed) {
        runtime.platePressed.add(key);
        if (!_wiredSources.has(key)) _unwiredSources.push({ tx, ty, radius: 6 });
      }
      if (!blueprintPreview && pressed !== _prevPlates.has(key)) {
        SFX.playSwitch(pressed);
      }
    } else if (src.subType === 'TIMER') {
      const period = Math.max(0.4, Number(opts.interval) || 1.5);
      const phase = Math.floor((clockT + (tx * 0.17 + ty * 0.11)) / period) % 2 === 1;
      if (phase) {
        runtime.timerOn.add(key);
        if (!_wiredSources.has(key)) _unwiredSources.push({ tx, ty, radius: 6 });
      }
    } else if (src.subType === 'PROXIMITY') {
      const rngPx = (Number(opts.range) || 4) * TILE;
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      let detected = false;
      if (!player.dead) {
        if (Math.hypot((player.x + player.w * 0.5) - cx, (player.y + player.h * 0.5) - cy) <= rngPx) {
          detected = true;
        }
      }
      if (!detected) {
        for (const dyn of runtime.dynamics.values()) {
          if (dyn.exploded) continue;
          if (Math.hypot((dyn.x + TILE * 0.5) - cx, (dyn.y + TILE * 0.5) - cy) <= rngPx) {
            detected = true;
            break;
          }
        }
      }
      if (detected) {
        runtime.proxActive.add(key);
        if (!_wiredSources.has(key)) _unwiredSources.push({ tx, ty, radius: Number(opts.range) || 4 });
      }
    } else if (src.subType === 'SWITCH') {
      if (runtime.activators.get(key) && !_wiredSources.has(key)) {
        _unwiredSources.push({ tx, ty, radius: 14 });
      }
    }
  }

  // Prune stale gate outputs / relay timers for removed tiles
  const logicNodes = runtime.actLogic;
  _liveLogicKeys.clear();
  for (let i = 0; i < logicNodes.length; i++) _liveLogicKeys.add(logicNodes[i].key);
  if (runtime.gateOutputs.size > _liveLogicKeys.size) {
    for (const k of runtime.gateOutputs.keys()) if (!_liveLogicKeys.has(k)) runtime.gateOutputs.delete(k);
  }
  if (runtime.relayTimers.size > _liveLogicKeys.size) {
    for (const k of runtime.relayTimers.keys()) if (!_liveLogicKeys.has(k)) runtime.relayTimers.delete(k);
  }

  const isBaseSourceOn = key => Boolean(
    runtime.activators.get(key) ||
    runtime.platePressed.has(key) ||
    runtime.timerOn.has(key) ||
    runtime.proxActive.has(key) ||
    (runtime.interactFrames.get(key) || 0) > 0
  );

  // Iterative fixed-point propagation through chained logic gates (up to 6 hops)
  _gateState.clear();
  for (const [k, v] of runtime.gateOutputs.entries()) _gateState.set(k, v);

  if (logicNodes.length > 0) {
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (let i = 0; i < logicNodes.length; i++) {
        const node = logicNodes[i];
        const sp = getSpriteById(node.id);
        const delay = (sp && sp.actOpts && Number(sp.actOpts.delay)) || 0;
        const inc = _incomingByTarget.get(node.key);
        let anyOn = false;
        let allOn = Boolean(inc && inc.length > 0);
        if (inc) {
          for (let j = 0; j < inc.length; j++) {
            const w = inc[j];
            const rawSrc = isBaseSourceOn(w.from) || Boolean(_gateState.get(w.from));
            const sig = w.invert ? !rawSrc : rawSrc;
            if (sig) anyOn = true;
            else allOn = false;
          }
        }
        let outVal = false;
        if (node.subType === 'NOT GATE') {
          outVal = !anyOn;
        } else if (node.subType === 'AND GATE') {
          outVal = allOn;
        } else {
          if (delay > 0 && dt > 0) {
            let rSt = runtime.relayTimers.get(node.key);
            if (!rSt) {
              rSt = { target: anyOn, timer: 0, out: false, nextIn: anyOn };
              runtime.relayTimers.set(node.key, rSt);
            }
            rSt.nextIn = anyOn;
            outVal = rSt.out;
          } else {
            outVal = anyOn;
          }
        }
        if (Boolean(_gateState.get(node.key)) !== outVal) {
          _gateState.set(node.key, outVal);
          changed = true;
        }
      }
      if (!changed && pass >= 1) break;
    }

    // Advance delayed OR / RELAY timers exactly once per step
    if (dt > 0) {
      for (let i = 0; i < logicNodes.length; i++) {
        const node = logicNodes[i];
        if (node.subType !== 'OR / RELAY') continue;
        const sp = getSpriteById(node.id);
        const delay = (sp && sp.actOpts && Number(sp.actOpts.delay)) || 0;
        if (delay <= 0) continue;
        const rSt = runtime.relayTimers.get(node.key);
        if (!rSt) continue;
        const desired = Boolean(rSt.nextIn);
        if (desired !== rSt.target) {
          rSt.target = desired;
          rSt.timer = delay;
        }
        if (rSt.out !== rSt.target) {
          rSt.timer -= dt;
          if (rSt.timer <= 0) {
            rSt.out = rSt.target;
            rSt.timer = 0;
            _gateState.set(node.key, rSt.out);
          }
        }
      }
    }
  }

  runtime.gateOutputs.clear();
  for (const [k, v] of _gateState.entries()) runtime.gateOutputs.set(k, v);

  if (!blueprintPreview) {
    runtime.prevPoweredTargets.clear();
    for (const pk of runtime.poweredTargets) runtime.prevPoweredTargets.add(pk);
  }
  runtime.poweredTargets.clear();
  runtime.poweredWires.clear();

  for (let i = 0; i < wires.length; i++) {
    const w = wires[i];
    const srcOn = isBaseSourceOn(w.from) || Boolean(runtime.gateOutputs.get(w.from));
    const sig = w.invert ? !srcOn : srcOn;
    if (sig) {
      runtime.poweredWires.add(i);
      runtime.poweredTargets.add(w.to);
    }
  }

  // Unwired plates / timers / switches / proximity drive nearby unwired DOOR / PISTON / CHANGE / TNT
  if (_unwiredSources.length > 0 && runtime.actProxTargets.length > 0) {
    const proxTargets = runtime.actProxTargets;
    for (let ti = 0; ti < proxTargets.length; ti++) {
      const tgt = proxTargets[ti];
      if (_wiredTargets.has(tgt.key)) continue;
      for (let i = 0; i < _unwiredSources.length; i++) {
        const s = _unwiredSources[i];
        if (Math.hypot(tgt.tx - s.tx, tgt.ty - s.ty) <= s.radius) {
          runtime.poweredTargets.add(tgt.key);
          break;
        }
      }
    }
  }

  // Sync wired DOOR & CHANGE states cleanly with poweredTargets
  for (const k of _wiredTargets) {
    const pt = parseTileKey(k);
    if (!pt) continue;
    const info = getMainTileInfo(world, pt.tx, pt.ty);
    if (!info || info.type !== 'ACTIVATOR') continue;
    const isOn = runtime.poweredTargets.has(k);
    if (info.subType === 'DOOR') {
      if (isOn) runtime.doorsOpen.add(k);
      else runtime.doorsOpen.delete(k);
    } else if (info.subType === 'CHANGE') {
      if (isOn) runtime.activatedTiles.add(k);
      else runtime.activatedTiles.delete(k);
    }
  }

  return { wires, wiredTargets: _wiredTargets, wiredSources: _wiredSources, pistonEntries: runtime.actPistons };
}

export function updateRuntimeObjects(world, dt) {
  if (runtime.teleportCd > 0) runtime.teleportCd = Math.max(0, runtime.teleportCd - dt);
  if (runtime.hurtCd > 0) runtime.hurtCd = Math.max(0, runtime.hurtCd - dt);
  if (runtime.hurtFlash > 0) runtime.hurtFlash = Math.max(0, runtime.hurtFlash - dt);
  if (runtime.holdSwingTimer > 0) runtime.holdSwingTimer = Math.max(0, runtime.holdSwingTimer - dt);
  if (runtime.dropThruTimer > 0) runtime.dropThruTimer = Math.max(0, runtime.dropThruTimer - dt);
  if (runtime.consumeCd > 0) runtime.consumeCd = Math.max(0, runtime.consumeCd - dt);
  if (runtime.screenShake > 0) runtime.screenShake = Math.max(0, runtime.screenShake - dt * 1.4);

  for (let i = runtime.shockwaves.length - 1; i >= 0; i--) {
    const sw = runtime.shockwaves[i];
    sw.timer += dt;
    sw.r = 3 + (sw.maxR - 3) * (1 - Math.pow(1 - clamp(sw.timer / sw.maxTimer, 0, 1), 3));
    if (sw.timer >= sw.maxTimer) runtime.shockwaves.splice(i, 1);
  }

  // Step explosive chain-detonation fuses
  if (runtime.explosiveFuses.size > 0) {
    const toBlow = [];
    for (const [k, rem] of runtime.explosiveFuses.entries()) {
      const next = rem - dt;
      if (next <= 0) toBlow.push(k);
      else runtime.explosiveFuses.set(k, next);
    }
    for (let i = 0; i < toBlow.length; i++) {
      runtime.explosiveFuses.delete(toBlow[i]);
      const d = runtime.dynamics.get(toBlow[i]);
      if (d && !d.exploded) detonateExplosive(world, d);
    }
  }

  // Evaluate Signal Sources (SWITCH, PRESSURE PLATE, TIMER, PROXIMITY, INTERACTING), Logic Gates & Wire Network
  const { wiredTargets, pistonEntries } = evaluateWireNetwork(world, dt);

  // Step ACTIVATOR (PISTON) extension, retraction, and forceful launching of player & dynamic bodies
  for (let i = 0; i < pistonEntries.length; i++) {
    const p = pistonEntries[i];
    const isPow = runtime.poweredTargets.has(p.key);
    let st = runtime.pistons.get(p.key);
    if (!st) {
      st = { ext: 0, prevExt: 0, powered: false };
      runtime.pistons.set(p.key, st);
    }
    if (isPow !== st.powered) {
      st.powered = isPow;
      SFX.playPiston(isPow);
    }
    st.prevExt = st.ext;
    if (isPow) st.ext = Math.min(1, st.ext + dt * 10.5);
    else st.ext = Math.max(0, st.ext - dt * 5.8);

    const dir = transformOrientVec(0, -1, p.orient || 0);
    const extendingNow = st.ext > st.prevExt + 0.005;
    if (st.ext >= 0.20) {
      const headX = p.tx * TILE + dir.x * st.ext * TILE;
      const headY = p.ty * TILE + dir.y * st.ext * TILE;
      const headTx = p.tx + Math.round(dir.x);
      const headTy = p.ty + Math.round(dir.y);

      // Shatter crumbling blocks in piston's push cell
      if (extendingNow) {
        const crInfo = getMainTileInfo(world, headTx, headTy);
        if (crInfo && crInfo.type === 'CRUMBLING' && crInfo.subType !== 'FLEXIBLE') {
          shatterCrumblingTile(world, headTx, headTy, crInfo, 2.3, true);
        }
      }

      // Push / launch DYNAMIC bodies hit by piston head
      for (const dyn of runtime.dynamics.values()) {
        if (dyn.exploded || dyn.frozen) continue;
        if (
          dyn.x + TILE > headX + 1 && dyn.x < headX + TILE - 1 &&
          dyn.y + TILE > headY + 1 && dyn.y < headY + TILE - 1
        ) {
          if (extendingNow) {
            const pImp = 285 / Math.max(0.6, dyn.mass || 1);
            dyn.vx = dir.x !== 0 ? dir.x * pImp : dyn.vx;
            dyn.vy = dir.y !== 0 ? dir.y * pImp : Math.min(dyn.vy, -58);
            dyn.grounded = false;
            dyn.scaleX = dir.x !== 0 ? 0.82 : 1.18;
            dyn.scaleY = dir.y !== 0 ? 1.20 : 0.86;
          }
          if (dir.y < 0) dyn.y = Math.min(dyn.y, headY - TILE);
          else if (dir.y > 0) dyn.y = Math.max(dyn.y, headY + TILE);
          else if (dir.x > 0) dyn.x = Math.max(dyn.x, headX + TILE);
          else if (dir.x < 0) dyn.x = Math.min(dyn.x, headX - TILE);
        }
      }

      // Push / launch player hit by piston head
      if (
        !player.dead &&
        player.x + player.w > headX + 1 && player.x < headX + TILE - 1 &&
        player.y + player.h > headY + 1 && player.y < headY + TILE - 1
      ) {
        if (runtime.seated) releaseSeat(false);
        if (extendingNow) {
          if (dir.y < 0) {
            player.vy = -318;
            player.grounded = false;
            player.scaleX = 0.82;
            player.scaleY = 1.22;
          } else if (dir.y > 0) {
            player.vy = Math.max(player.vy, 210);
          } else {
            player.vx = dir.x * 268;
            player.vy = Math.min(player.vy, -95);
            player.grounded = false;
          }
        }
        if (dir.y < 0) player.y = Math.min(player.y, headY - player.h);
        else if (dir.y > 0) player.y = Math.max(player.y, headY + TILE);
        else if (dir.x > 0) player.x = Math.max(player.x, headX + TILE);
        else if (dir.x < 0) player.x = Math.min(player.x, headX - player.w);
      }
    }
  }

  // Spring-damper sag recovery for CRUMBLING (FLEXIBLE) tiles
  stepActiveMotion(dt);
  for (const [fKey, fl] of runtime.flexOffsets.entries()) {
    const acc = -140 * fl.y - 14 * fl.vy;
    fl.vy += acc * dt;
    fl.y = clamp(fl.y + fl.vy * dt, -2.5, 4.5);
    if (Math.abs(fl.y) < 0.02 && Math.abs(fl.vy) < 0.05) {
      runtime.flexOffsets.delete(fKey);
    }
  }

  if (runtime.dialogueSource && dialogueBox.classList.contains('show')) {
    const d = Math.hypot(
      (runtime.dialogueSource.tx + 0.5) * TILE - (player.x + player.w * 0.5),
      (runtime.dialogueSource.ty + 0.5) * TILE - (player.y + player.h * 0.5)
    );
    if (d > TILE * 4.5) hideDialogue();
  }

  // 1. CRUMBLING blocks (shake + crumbs -> destroy/fall-through -> fade smoothly back in after ~2.25s)
  for (const [key, c] of runtime.crumbling.entries()) {
    const comma = key.indexOf(',');
    const tx = parseInt(key.slice(0, comma), 10);
    const ty = parseInt(key.slice(comma + 1), 10);
    const info = getMainTileInfo(world, tx, ty);
    if (!info || info.type !== 'CRUMBLING' || info.subType === 'FLEXIBLE') {
      runtime.crumbling.delete(key);
      continue;
    }

    if (c.state === 'shake') {
      c.timer -= dt;
      const dur = Math.max(0.05, c.duration || 0.62);
      const progress = clamp(1 - c.timer / dur, 0, 1);
      // Accelerating dust & crumbling chips falling from beneath the shaking block
      if (Math.random() < dt * (9 + progress * 24)) {
        const crFx = getTileFxColors(info, '#8b94a6');
        spawnParticle(
          tx * TILE + 2 + Math.random() * (TILE - 4),
          (ty + 1) * TILE - 1,
          (Math.random() - 0.5) * (14 + progress * 22),
          10 + Math.random() * (14 + progress * 20),
          0.26 + Math.random() * 0.22,
          Math.random() > 0.35 ? crFx.main : crFx.secondary,
          progress > 0.55 && Math.random() > 0.5 ? 1.8 : 1.2,
          175
        );
      }
      if (c.timer <= 0) {
        c.state = 'gone';
        c.duration = CRUMBLE_GONE_SEC;
        c.timer = CRUMBLE_GONE_SEC;
        c.waitingClear = false;
        spawnCrumbleDebris(tx, ty, info);
        SFX.playCrumbleBreak();
      }
    } else if (c.state === 'gone') {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.state = 'fadein';
        c.duration = CRUMBLE_FADE_SEC;
        c.timer = CRUMBLE_FADE_SEC;
        c.waitingClear = false;
      }
    } else if (c.state === 'fadein') {
      const dur = Math.max(0.05, c.duration || CRUMBLE_FADE_SEC);
      const blocked = isTileBlockedByActor(tx, ty);
      c.waitingClear = blocked;
      if (blocked) {
        // Hold smoothly as a translucent non-solid ghost while player/crate occupies the tile
        const holdTimer = dur * 0.66;
        c.timer = Math.max(c.timer - dt * 0.5, holdTimer);
      } else {
        c.timer -= dt;
        if (c.timer <= 0) {
          runtime.crumbling.delete(key);
          const crFx = getTileFxColors(info, '#8b94a6');
          spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, crFx.light, 4, 24, crFx.main);
          SFX.playCrumbleReform();
        }
      }
    }
  }

  // Smooth ACTIVATOR (DOOR) open/close transition progress (0 closed -> 1 open)
  const doorK = 1 - Math.exp(-10 * dt);
  for (const key of runtime.doorsOpen) {
    const cur = runtime.doorAnim.get(key) || 0;
    const next = cur + (1 - cur) * doorK;
    runtime.doorAnim.set(key, next > 0.995 ? 1 : next);
  }
  for (const [key, val] of runtime.doorAnim.entries()) {
    if (runtime.doorsOpen.has(key)) continue;
    const next = val + (0 - val) * doorK;
    if (next < 0.005) runtime.doorAnim.delete(key);
    else runtime.doorAnim.set(key, next);
  }

  // 2. MOVING platforms (axis transforms with tile rotation & flip; wired MOVING platforms only run while powered!)
  const moveSpan = TILE * 2.5;
  for (const m of runtime.moving.values()) {
    m.prevX = m.x;
    m.prevY = m.y;
    const isWired = wiredTargets.has(m.key);
    const activeMov = !isWired || runtime.poweredTargets.has(m.key);
    if (m.phase === undefined) m.phase = m.tx * 0.7 + m.ty * 0.5;
    if (activeMov) m.phase += dt * 1.45;
    const wave = Math.sin(m.phase);
    const baseX = m.subType === 'VERT' ? 0 : 1;
    const baseY = m.subType === 'VERT' ? 1 : 0;
    const axis = transformOrientVec(baseX, baseY, m.orient || 0);
    m.x = m.tx * TILE + wave * moveSpan * axis.x;
    m.y = m.ty * TILE + wave * moveSpan * axis.y;
    m.dx = m.x - m.prevX;
    m.dy = m.y - m.prevY;
  }

  // 2b. DEADLY MOVING patrolling hazards (axis & speed respect harmOpts + tile rotation/flip)
  for (const dm of runtime.deadlyMoving.values()) {
    const sp = getSpriteById(dm.id);
    const opts = (sp && sp.harmOpts) || {};
    const mp = getDeadlyMovingParams(opts);
    dm.prevX = dm.x;
    dm.prevY = dm.y;
    const wave = Math.sin(state.simTime * mp.freq + (dm.tx * 0.7 + dm.ty * 0.5));
    const baseX = opts.moveAxis === 'VERT' ? 0 : 1;
    const baseY = opts.moveAxis === 'VERT' ? 1 : 0;
    const axis = transformOrientVec(baseX, baseY, dm.orient || 0);
    dm.x = dm.tx * TILE + wave * mp.span * axis.x;
    dm.y = dm.ty * TILE + wave * mp.span * axis.y;
    dm.dx = dm.x - dm.prevX;
    dm.dy = dm.y - dm.prevY;
  }

  // 3. LIVING critters / NPCs (WANDER patrols, FLIPPING glances/faces player, CHANGING shifts organically)
  const pCx = player.x + player.w * 0.5;
  const pCy = player.y + player.h * 0.5;
  for (const lv of runtime.living.values()) {
    lv.prevX = lv.x;
    lv.prevY = lv.y;
    if (lv.subType === 'FLIPPING') {
      const dist = Math.hypot((lv.x + TILE * 0.5) - pCx, (lv.y + TILE * 0.5) - pCy);
      if (dist <= TILE * 6) {
        lv.facing = pCx < lv.x + TILE * 0.5 ? -1 : 1;
      } else {
        lv.flipTimer = (lv.flipTimer !== undefined ? lv.flipTimer : 2.0) - dt;
        if (lv.flipTimer <= 0) {
          lv.facing = -lv.facing;
          lv.flipTimer = 1.6 + Math.random() * 2.6;
        }
      }
      continue;
    }
    if (lv.subType === 'CHANGING') {
      const sp = getSpriteById(lv.id);
      const count = sp && sp._canvases ? sp._canvases.length : 1;
      if (count > 1) {
        lv.changeTimer = (lv.changeTimer !== undefined ? lv.changeTimer : 1.2) - dt;
        if (lv.changeTimer <= 0) {
          lv.frameIdx = ((lv.frameIdx || 0) + 1 + Math.floor(Math.random() * (count - 1))) % count;
          lv.changeTimer = 0.85 + Math.random() * 1.45;
        }
      }
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

  // 4. DYNAMIC rigid-body physics (CRATE, BOUNCY BALL, HEAVY METAL, WHEEL, THRUSTER, EXPLOSIVE)
  // Full water buoyancy, slopes, conveyors, moving platforms, grab-hand fling, body stacking & physical joints!
  const dynScK = 1 - Math.exp(-14 * dt);
  const effGrav = PHYS.gravity * (Number.isFinite(state.gravityScale) ? state.gravityScale : 1.0);
  const activeDyns = [];

  for (const dyn of runtime.dynamics.values()) {
    if (dyn.exploded) continue;
    activeDyns.push(dyn);
    dyn.prevX = dyn.x;
    dyn.prevY = dyn.y;
    dyn.prevRot = dyn.rot || 0;

    const spec = getPhysicsSpec(dyn.subType);
    dyn.mass = spec.mass;
    const isBall = spec.isBall;
    const isGrabbed = Boolean(runtime.grabbedDyn && runtime.grabbedDyn.key === dyn.key);
    const isWired = wiredTargets.has(dyn.key);
    const isPowered = isWired ? runtime.poweredTargets.has(dyn.key) : true;
    const risingPower = isPowered && !runtime.prevPoweredTargets.has(dyn.key);
    dyn.powered = isPowered;

    // Wired EXPLOSIVE detonates immediately on rising signal edge!
    if (spec.isExplosive && isWired && risingPower) {
      detonateExplosive(world, dyn);
      continue;
    }

    // Frozen rigid body stays pinned in mid-air until unfrozen or dragged
    if (dyn.frozen && !isGrabbed) {
      dyn.vx = 0;
      dyn.vy = 0;
      dyn.omega = 0;
      dyn.scaleX = (dyn.scaleX || 1) + (1 - (dyn.scaleX || 1)) * dynScK;
      dyn.scaleY = (dyn.scaleY || 1) + (1 - (dyn.scaleY || 1)) * dynScK;
      continue;
    }

    if (isGrabbed) {
      const g = runtime.grabbedDyn;
      const targetX = g.wx - g.offX;
      const targetY = g.wy - g.offY;
      dyn.vx = clamp((targetX - dyn.x) * 18, -420, 420);
      dyn.vy = clamp((targetY - dyn.y) * 18, -420, 420);
      g.vx = g.vx * 0.55 + dyn.vx * 0.45;
      g.vy = g.vy * 0.55 + dyn.vy * 0.45;
      dyn.grounded = false;
    } else {
      // Atmospheric wind
      if (Math.abs(envSys.windX) > 14) {
        dyn.vx += (envSys.windX * (isBall ? 0.55 : 0.18) / spec.mass) * dt;
      }

      // Motorized THRUSTER jet propulsion along rotated orientation
      if (spec.isThruster && isPowered) {
        const tv = transformOrientVec(0, -1, dyn.orient || 0);
        const thrustAcc = 420 / spec.mass;
        dyn.vx += tv.x * thrustAcc * dt;
        dyn.vy += tv.y * thrustAcc * dt;
        dyn.flameTimer = (dyn.flameTimer || 0) - dt;
        if (dyn.flameTimer <= 0) {
          dyn.flameTimer = 0.035;
          const exX = dyn.x + TILE * 0.5 - tv.x * (TILE * 0.52);
          const exY = dyn.y + TILE * 0.5 - tv.y * (TILE * 0.52);
          spawnParticle(
            exX + (Math.random() - 0.5) * 3,
            exY + (Math.random() - 0.5) * 3,
            -tv.x * (95 + Math.random() * 50) + (Math.random() - 0.5) * 26,
            -tv.y * (95 + Math.random() * 50) + (Math.random() - 0.5) * 26,
            0.18 + Math.random() * 0.14,
            Math.random() > 0.35 ? '#ffb44c' : '#fff2de',
            Math.random() > 0.5 ? 2.2 : 1.5,
            -18
          );
        }
      }

      // Motorized WHEEL rotational drive
      if (spec.isWheel && isPowered) {
        const wDir = orientToTransform(dyn.orient || 0).flip ? -1 : 1;
        const targetVx = wDir * 124;
        if (dyn.grounded) {
          dyn.vx += (targetVx - dyn.vx) * (1 - Math.exp(-9.5 * dt));
        } else {
          dyn.omega = wDir * 11;
        }
      }

      // PUSHING directional currents (excluding solid CONVEYOR which applies on contact below)
      const dMidInfo = getMainTileInfo(world, Math.floor((dyn.x + TILE * 0.5) / TILE), Math.floor((dyn.y + TILE * 0.5) / TILE));
      if (dMidInfo && dMidInfo.type === 'PUSHING' && dMidInfo.subType !== 'CONVEYOR') {
        const isPushWired = wiredTargets.has(dMidInfo.key);
        if (!isPushWired || runtime.poweredTargets.has(dMidInfo.key)) {
          let pbx = 0;
          let pby = -1.15;
          if (dMidInfo.subType === 'RIGHT') { pbx = 1; pby = 0; }
          else if (dMidInfo.subType === 'LEFT') { pbx = -1; pby = 0; }
          else if (dMidInfo.subType === 'DOWN') { pbx = 0; pby = 1; }
          const dpv = transformOrientVec(pbx, pby, dMidInfo.orient || 0);
          dyn.vx += (dpv.x * 380 / spec.mass) * dt;
          dyn.vy += (dpv.y * 380 / spec.mass) * dt;
        }
      }

      // EXPLOSIVE contact with active HARMFUL / DEADLY tiles detonates immediately
      if (spec.isExplosive && dMidInfo && dMidInfo.type === 'HARMFUL') {
        const harmAct = !isEmergingHarmSubType(dMidInfo.subType)
          || evalEmergingHazard(Math.floor((dyn.x + TILE * 0.5) / TILE), Math.floor((dyn.y + TILE * 0.5) / TILE), dMidInfo.sp && dMidInfo.sp.harmOpts, dMidInfo.orient, state.simTime).active;
        if (harmAct) {
          detonateExplosive(world, dyn);
          continue;
        }
      }

      // LIQUID buoyancy, splashes & fluid drag for dynamic rigid bodies
      const wasLiq = Boolean(dyn.inLiquid);
      const inLiq = Boolean(dMidInfo && dMidInfo.type === 'LIQUID');
      dyn.inLiquid = inLiq;
      if (inLiq) {
        const lCols = getTileFxColors(dMidInfo, '#4fa4d8');
        if (!wasLiq && Math.hypot(dyn.vx, dyn.vy) > 32) {
          const imp = clamp(Math.hypot(dyn.vx * 0.35, dyn.vy) / 185, 0.3, 1.0);
          spawnLiquidSplash(dyn.x + TILE * 0.5, Math.floor((dyn.y + TILE * 0.5) / TILE) * TILE + 2, false, imp, 'surface', lCols);
          SFX.playSplash(false, imp * 0.72, Boolean(dMidInfo.sp && dMidInfo.sp.liquidOpts && dMidInfo.sp.liquidOpts.thick));
        }
        if (spec.isExplosive && dMidInfo.sp && dMidInfo.sp.liquidOpts && dMidInfo.sp.liquidOpts.hazard !== 'NONE') {
          detonateExplosive(world, dyn);
          continue;
        }
        dyn.vx *= Math.exp(-3.4 * dt);
        dyn.vy *= Math.exp(-2.8 * dt);
        if (spec.floats) {
          dyn.vy -= (PHYS.gravity * 1.18) * dt;
          dyn.vy = clamp(dyn.vy, -82, 95);
        } else {
          // HEAVY METAL sinks steadily in liquid with rising bubbles
          dyn.vy += (effGrav * 0.32 - dyn.vy * 1.8) * dt;
          if (Math.random() < dt * 3.5) {
            spawnWaterBubble(dyn.x + TILE * 0.5 + (Math.random() - 0.5) * 8, dyn.y + 3, 0, -24, 0.65, lCols);
          }
        }
      } else {
        const horizDrag = dyn.grounded ? spec.drag : (spec.drag * 0.14);
        dyn.vx *= Math.exp(-horizDrag * dt);
        if (Math.abs(dyn.vx) < 0.8 && dyn.grounded) dyn.vx = 0;
        dyn.vy = clamp(dyn.vy + effGrav * dt, -460, PHYS.maxFall * 1.45);
      }

      // Player pushing dynamic objects horizontally (mass-aware; standable crates don't fling sideways when walked on top)
      if (
        !player.dead &&
        player.x + player.w > dyn.x + 1 && player.x < dyn.x + TILE - 1 &&
        player.y + player.h > dyn.y + 5 && player.y < dyn.y + TILE - 2
      ) {
        const pushDir = (player.x + player.w * 0.5) < (dyn.x + TILE * 0.5) ? 1 : -1;
        const massScale = 1 / Math.max(0.65, spec.mass);
        const pushSpd = Math.max(Math.abs(player.vx) * (isBall ? 1.25 : 0.85), isBall ? 90 : 54) * clamp(massScale, 0.28, 1.45);
        dyn.vx = pushDir * pushSpd;
        if (isBall && !spec.isWheel && dyn.grounded) {
          dyn.vy = -86;
          dyn.scaleX = 0.86;
          dyn.scaleY = 1.16;
        }
      }
    }

    // Horizontal movement & solid wall bounce
    const preVx = dyn.vx;
    dyn.x += dyn.vx * dt;
    if (isBall) {
      dyn.rot = (dyn.rot || 0) + (dyn.vx / (TILE * 0.5)) * dt + (dyn.omega || 0) * dt;
      dyn.omega = (dyn.omega || 0) * Math.exp(-4.5 * dt);
    } else if (Math.abs(dyn.omega || 0) > 0.05) {
      dyn.rot = (dyn.rot || 0) + dyn.omega * dt;
      dyn.omega *= Math.exp((dyn.grounded ? -10 : -3.5) * dt);
      if (dyn.grounded) dyn.rot += (Math.round(dyn.rot / (Math.PI * 0.5)) * (Math.PI * 0.5) - dyn.rot) * (1 - Math.exp(-10 * dt));
    }

    const dMidTy = Math.floor((dyn.y + TILE * 0.5) / TILE);
    if (dyn.vx > 0) {
      const rTx = Math.floor((dyn.x + TILE - 0.001) / TILE);
      if (isFullSolidAt(world, rTx, dMidTy)) {
        dyn.x = rTx * TILE - TILE;
        if (spec.isExplosive && Math.abs(preVx) > 205) {
          detonateExplosive(world, dyn);
          continue;
        }
        if (Math.abs(preVx) > 35 && spec.restitution > 0.2) {
          dyn.scaleX = 0.84;
          dyn.scaleY = 1.16;
        }
        dyn.vx = -dyn.vx * spec.restitution;
      }
    } else if (dyn.vx < 0) {
      const lTx = Math.floor(dyn.x / TILE);
      if (isFullSolidAt(world, lTx, dMidTy)) {
        dyn.x = (lTx + 1) * TILE;
        if (spec.isExplosive && Math.abs(preVx) > 205) {
          detonateExplosive(world, dyn);
          continue;
        }
        if (Math.abs(preVx) > 35 && spec.restitution > 0.2) {
          dyn.scaleX = 0.84;
          dyn.scaleY = 1.16;
        }
        dyn.vx = -dyn.vx * spec.restitution;
      }
    }

    // Vertical movement, floors, BOUNCY pads, CONVEYOR belts, CRUMBLING smash & MOVING carry
    const preVy = dyn.vy;
    const prevDynBot = dyn.y + TILE;
    dyn.y += dyn.vy * dt;
    dyn.grounded = false;
    const dCenterTx = Math.floor((dyn.x + TILE * 0.5) / TILE);
    if (dyn.vy >= 0) {
      const dFootTy = Math.floor((dyn.y + TILE - 0.001) / TILE);
      if (isFullSolidAt(world, dCenterTx, dFootTy) || (isOneWaySupportAt(world, dCenterTx, dFootTy) && prevDynBot <= dFootTy * TILE + 5)) {
        dyn.y = dFootTy * TILE - TILE;
        const dFloorInfo = getMainTileInfo(world, dCenterTx, dFootTy);
        if (spec.isExplosive && preVy > 205) {
          detonateExplosive(world, dyn);
          continue;
        }
        if (spec.isHeavy && preVy > 145) {
          runtime.screenShake = Math.max(runtime.screenShake || 0, 0.14);
          SFX.playLand(0.95, 'METAL');
          spawnLandingDust(dyn.x + TILE * 0.5, dyn.y + TILE, 0.9, 'METAL');
          if (dFloorInfo && dFloorInfo.type === 'CRUMBLING' && dFloorInfo.subType !== 'FLEXIBLE') {
            shatterCrumblingTile(world, dCenterTx, dFootTy, dFloorInfo, 2.4, true);
          }
        }
        if (dFloorInfo && dFloorInfo.type === 'BOUNCY') {
          const bv = getBouncyLaunchVec(dFloorInfo);
          if (bv.y < -0.15) {
            dyn.vy = PHYS.bounceVel * (isBall ? 0.96 : 0.78) * Math.min(1, Math.abs(bv.y)) / Math.sqrt(spec.mass);
            if (Math.abs(bv.x) > 0.15) dyn.vx = Math.sign(bv.x) * 145;
            dyn.scaleX = 0.80;
            dyn.scaleY = 1.24;
            worldFX.bounceTimers.set(dFloorInfo.key, 0.24);
            SFX.playBounce();
            const dBFx = getTileFxColors(dFloorInfo, '#f28c38');
            spawnBurstParticles(dCenterTx * TILE + TILE * 0.5, dFootTy * TILE, dBFx.main, 5, 44, dBFx.light);
          } else {
            dyn.vy = 0;
            dyn.grounded = true;
          }
        } else if (spec.restitution >= 0.45 && preVy > 46) {
          const imp = clamp(preVy / 200, 0.25, 1);
          dyn.scaleX = 1 + imp * 0.22;
          dyn.scaleY = 1 - imp * 0.20;
          dyn.vy = -preVy * spec.restitution;
        } else {
          dyn.vy = 0;
          dyn.grounded = true;
          // Motorized CONVEYOR belt carries dynamic bodies cleanly!
          if (dFloorInfo && dFloorInfo.type === 'PUSHING' && dFloorInfo.subType === 'CONVEYOR') {
            const cWired = wiredTargets.has(dFloorInfo.key);
            if (!cWired || runtime.poweredTargets.has(dFloorInfo.key)) {
              const cv = transformOrientVec(1, 0, dFloorInfo.orient || 0);
              dyn.vx += (cv.x * 112 - dyn.vx) * (1 - Math.exp(-10 * dt));
            }
          }
        }
      } else if (runtime.moving.size > 0) {
        // Ride MOVING platforms cleanly
        for (const m of runtime.moving.values()) {
          if (
            dyn.x + TILE > m.x + 1 && dyn.x < m.x + TILE - 1 &&
            prevDynBot <= m.prevY + 5 && dyn.y + TILE >= m.y
          ) {
            dyn.y = m.y - TILE;
            dyn.x += m.dx;
            dyn.vy = 0;
            dyn.grounded = true;
            break;
          }
        }
      }
    } else {
      const dHeadTy = Math.floor(dyn.y / TILE);
      if (isFullSolidAt(world, dCenterTx, dHeadTy)) {
        dyn.y = (dHeadTy + 1) * TILE;
        if (spec.isExplosive && Math.abs(preVy) > 205) {
          detonateExplosive(world, dyn);
          continue;
        }
        dyn.vy = -dyn.vy * spec.restitution;
      }
    }

    // 45-degree SLOPE rolling & sliding for dynamic rigid bodies
    const dFootCx = dyn.x + TILE * 0.5;
    const dSlopeTx = Math.floor(dFootCx / TILE);
    const dSlopeTy = Math.floor((dyn.y + TILE - 1) / TILE);
    const dSlopeInfo = getMainTileInfo(world, dSlopeTx, dSlopeTy);
    if (dSlopeInfo && dSlopeInfo.type === 'SLOPE' && dyn.vy >= 0) {
      const baseNx = isUpLeftSlopeSubType(dSlopeInfo.subType) ? 1 : -1;
      const sn = transformOrientVec(baseNx, -1, dSlopeInfo.orient || 0);
      if (sn.y < 0) {
        const localX = clamp(dFootCx - dSlopeTx * TILE, 0, TILE);
        const surfOff = sn.x > 0 ? localX : (TILE - localX);
        const targetY = dSlopeTy * TILE + surfOff - TILE;
        if (dyn.y >= targetY - 5) {
          dyn.y = targetY;
          dyn.vy = 0;
          dyn.grounded = true;
          const slideAccel = (isBall || isSlideySlopeSubType(dSlopeInfo.subType)) ? 210 : 95;
          dyn.vx += Math.sign(sn.x) * slideAccel * dt;
        }
      }
    }

    dyn.scaleX = (dyn.scaleX || 1) + (1 - (dyn.scaleX || 1)) * dynScK;
    dyn.scaleY = (dyn.scaleY || 1) + (1 - (dyn.scaleY || 1)) * dynScK;

    // Reset fallen dynamic props back to their placed home tile
    if (dyn.y > getAbyssKillY(world)) {
      dyn.x = dyn.tx * TILE;
      dyn.y = dyn.ty * TILE;
      dyn.prevX = dyn.x;
      dyn.prevY = dyn.y;
      dyn.vx = 0;
      dyn.vy = 0;
      dyn.rot = 0;
      dyn.prevRot = 0;
      dyn.omega = 0;
      dyn.scaleX = 1;
      dyn.scaleY = 1;
    }
  }

  // 4b. Rigid-Body vs Rigid-Body Collisions & Stacking (3 solver iterations for rock-steady towers!)
  if (activeDyns.length > 1) {
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < activeDyns.length; i++) {
        const a = activeDyns[i];
        if (a.exploded) continue;
        const invA = a.frozen ? 0 : (1 / Math.max(0.3, a.mass || 1));
        for (let j = i + 1; j < activeDyns.length; j++) {
          const b = activeDyns[j];
          if (b.exploded) continue;
          const invB = b.frozen ? 0 : (1 / Math.max(0.3, b.mass || 1));
          const invSum = invA + invB;
          if (invSum <= 0) continue;

          const dx = (b.x + TILE * 0.5) - (a.x + TILE * 0.5);
          const dy = (b.y + TILE * 0.5) - (a.y + TILE * 0.5);
          const ox = TILE - Math.abs(dx);
          const oy = TILE - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;

          const specA = getPhysicsSpec(a.subType);
          const specB = getPhysicsSpec(b.subType);
          const e = Math.max(specA.restitution, specB.restitution);

          if (ox < oy) {
            const nx = dx >= 0 ? 1 : -1;
            const sep = ox * 0.88;
            a.x -= nx * sep * (invA / invSum);
            b.x += nx * sep * (invB / invSum);
            const rvx = b.vx - a.vx;
            const velAlongN = rvx * nx;
            if (velAlongN < 0) {
              const jImp = -(1 + e) * velAlongN / invSum;
              a.vx -= jImp * invA * nx;
              b.vx += jImp * invB * nx;
            }
          } else {
            const ny = dy >= 0 ? 1 : -1;
            const sep = oy * 0.95;
            a.y -= ny * sep * (invA / invSum);
            b.y += ny * sep * (invB / invSum);
            const rvy = b.vy - a.vy;
            const velAlongN = rvy * ny;
            if (velAlongN < 0) {
              const jImp = -(1 + e) * velAlongN / invSum;
              a.vy -= jImp * invA * ny;
              b.vy += jImp * invB * ny;
            }
            if (ny > 0) {
              // a is resting cleanly on top of b
              a.grounded = true;
              if (!a.frozen && !b.frozen) {
                a.vx += (b.vx - a.vx) * 0.14;
              }
            } else {
              // b is resting cleanly on top of a
              b.grounded = true;
              if (!a.frozen && !b.frozen) {
                b.vx += (a.vx - b.vx) * 0.14;
              }
            }
          }
        }
      }
    }
  }

  // 4c. Physical Joint Constraints Solver (ROPE, ROD, SPRING — pendulums, vehicles, catapults!)
  const joints = Array.isArray(world.joints) ? world.joints : [];
  if (joints.length > 0) {
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < joints.length; i++) {
        const jnt = joints[i];
        const ea = resolveJointEndpoint(world, jnt.a);
        const eb = resolveJointEndpoint(world, jnt.b);
        if (!ea || !eb) continue;
        const invSum = ea.invMass + eb.invMass;
        if (invSum <= 0) continue;

        const dx = eb.x - ea.x;
        const dy = eb.y - ea.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const nx = dx / dist;
        const ny = dy / dist;
        const targetLen = jnt.len || TILE * 2;

        if (jnt.kind === 'SPRING') {
          if (iter === 0) {
            const stretch = dist - targetLen;
            const rvx = (eb.isDyn ? eb.dyn.vx : 0) - (ea.isDyn ? ea.dyn.vx : 0);
            const rvy = (eb.isDyn ? eb.dyn.vy : 0) - (ea.isDyn ? ea.dyn.vy : 0);
            const relV = rvx * nx + rvy * ny;
            const force = stretch * 34 + relV * 3.4;
            if (ea.isDyn && ea.invMass > 0) {
              ea.dyn.vx += nx * force * ea.invMass * dt;
              ea.dyn.vy += ny * force * ea.invMass * dt;
            }
            if (eb.isDyn && eb.invMass > 0) {
              eb.dyn.vx -= nx * force * eb.invMass * dt;
              eb.dyn.vy -= ny * force * eb.invMass * dt;
            }
          }
          continue;
        }

        // ROPE pulls taut only when stretched; ROD enforces both stretch and compression!
        if (jnt.kind === 'ROPE' && dist <= targetLen) continue;
        const diff = dist - targetLen;
        const corr = diff * (jnt.kind === 'ROD' ? 0.85 : 0.92);
        if (ea.isDyn && ea.invMass > 0) {
          const shareA = ea.invMass / invSum;
          ea.dyn.x += nx * corr * shareA;
          ea.dyn.y += ny * corr * shareA;
        }
        if (eb.isDyn && eb.invMass > 0) {
          const shareB = eb.invMass / invSum;
          eb.dyn.x -= nx * corr * shareB;
          eb.dyn.y -= ny * corr * shareB;
        }
        // Remove separating velocity along joint axis so pendulums & rods conserve momentum cleanly
        const rvx = (eb.isDyn ? eb.dyn.vx : 0) - (ea.isDyn ? ea.dyn.vx : 0);
        const rvy = (eb.isDyn ? eb.dyn.vy : 0) - (ea.isDyn ? ea.dyn.vy : 0);
        const relN = rvx * nx + rvy * ny;
        if ((jnt.kind === 'ROD' && Math.abs(relN) > 0.1) || (jnt.kind === 'ROPE' && relN > 0)) {
          const damp = jnt.kind === 'ROD' ? 0.55 : 0.72;
          const jImp = (relN * damp) / invSum;
          if (ea.isDyn && ea.invMass > 0) {
            ea.dyn.vx += nx * jImp * ea.invMass;
            ea.dyn.vy += ny * jImp * ea.invMass;
          }
          if (eb.isDyn && eb.invMass > 0) {
            eb.dyn.vx -= nx * jImp * eb.invMass;
            eb.dyn.vy -= ny * jImp * eb.invMass;
          }
        }
      }
    }
  }

  // 5. HOLDABLE emitter projectiles (dissipate on LIQUID or active HARMFUL/DEADLY, disintegrate CRUMBLING blocks)
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
    const hitInfo = getMainTileInfo(world, pTx, pTy);

    // Disappear immediately on LIQUID contact
    if (hitInfo && hitInfo.type === 'LIQUID') {
      const lFx = getTileFxColors(hitInfo, '#8ec8f6');
      spawnBurstParticles(nx, ny, lFx.main, 5, 36, lFx.bright);
      runtime.projectiles.splice(i, 1);
      continue;
    }

    // Disappear immediately on active HARMFUL / DEADLY tile contact (solid or passable)
    if (hitInfo && hitInfo.type === 'HARMFUL' && !isMovingHarmSubType(hitInfo.subType)) {
      const harmActive = !isEmergingHarmSubType(hitInfo.subType)
        || evalEmergingHazard(pTx, pTy, hitInfo.sp && hitInfo.sp.harmOpts, hitInfo.orient, state.simTime).active;
      if (harmActive) {
        const hFx = getTileFxColors(hitInfo, '#cf5959');
        spawnBurstParticles(nx, ny, hFx.main, 6, 46, hFx.light);
        runtime.projectiles.splice(i, 1);
        continue;
      }
    }

    // Disappear immediately on live DEADLY MOVING hazard contact
    let hitMovingHazard = false;
    if (runtime.deadlyMoving.size > 0) {
      for (const dm of runtime.deadlyMoving.values()) {
        if (nx >= dm.x && nx <= dm.x + TILE && ny >= dm.y && ny <= dm.y + TILE) {
          const dmFx = getTileFxColors(getSpriteById(dm.id), '#cf5959');
          spawnBurstParticles(nx, ny, dmFx.main, 6, 46, dmFx.light);
          runtime.projectiles.splice(i, 1);
          hitMovingHazard = true;
          break;
        }
      }
    }
    if (hitMovingHazard) continue;

    // Knock live DYNAMIC rigid bodies & detonate EXPLOSIVEs on projectile impact!
    let hitDyn = false;
    for (const dyn of runtime.dynamics.values()) {
      if (dyn.exploded) continue;
      if (nx >= dyn.x && nx <= dyn.x + TILE && ny >= dyn.y && ny <= dyn.y + TILE) {
        if (dyn.subType === 'EXPLOSIVE') {
          detonateExplosive(world, dyn);
        } else if (!dyn.frozen) {
          const invM = 1 / Math.max(0.55, dyn.mass || 1);
          dyn.vx += pr.vx * 0.34 * invM;
          dyn.vy += pr.vy * 0.25 * invM - 28 * invM;
          dyn.scaleX = 1.12;
          dyn.scaleY = 0.90;
        }
        spawnBurstParticles(nx, ny, pr.color || '#f28c38', 5, 42);
        runtime.projectiles.splice(i, 1);
        hitDyn = true;
        break;
      }
    }
    if (hitDyn) continue;

    // Projectiles can flip ACTIVATOR (SWITCH) levers remotely!
    if (hitInfo && hitInfo.type === 'ACTIVATOR' && hitInfo.subType === 'SWITCH') {
      toggleActivatorSwitch(world, pTx, pTy);
      runtime.projectiles.splice(i, 1);
      continue;
    }

    // Disintegrate CRUMBLING blocks immediately on impact (FLEXIBLE bends & bounces instead)
    if (hitInfo && hitInfo.type === 'CRUMBLING') {
      if (hitInfo.subType === 'FLEXIBLE') {
        const fl = runtime.flexOffsets.get(hitInfo.key) || { y: 0, vy: 0 };
        fl.vy += 65;
        runtime.flexOffsets.set(hitInfo.key, fl);
      } else if (shatterCrumblingTile(world, pTx, pTy, hitInfo, CRUMBLE_GONE_SEC, true)) {
        runtime.projectiles.splice(i, 1);
        continue;
      }
    }

    // Super-bounce projectiles off BOUNCY blocks along the rotated launch vector
    if (hitInfo && hitInfo.type === 'BOUNCY') {
      const bv = getBouncyLaunchVec(hitInfo);
      const spd = Math.max(185, Math.hypot(pr.vx, pr.vy));
      const blen = Math.hypot(bv.x, bv.y) || 1;
      pr.vx = (bv.x / blen) * spd;
      pr.vy = (bv.y / blen) * spd;
      worldFX.bounceTimers.set(hitInfo.key, 0.24);
      SFX.playBounce();
      const bFx = getTileFxColors(hitInfo, '#f28c38');
      spawnBurstParticles(pr.x, pr.y, bFx.main, 5, 48, bFx.light);
      continue;
    }

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
      const skFx = getTileFxColors(getMainTileInfo(world, sk.tx, sk.ty), '#f5e2cf');
      spawnParticle(
        sk.tx * TILE + Math.random() * TILE,
        sk.ty * TILE + Math.random() * TILE,
        (Math.random() - 0.5) * 16,
        -18 - Math.random() * 14,
        0.45,
        Math.random() > 0.45 ? skFx.bright : skFx.light,
        1.5,
        0
      );
    }
  }

  // 6a. BIG_THING (FX: SPARKLE) decorative pixel sparkles across its 2x2 / 3x3 footprint
  if (runtime.bigSparklers.length > 0 && Math.random() < dt * 16) {
    const topLeft = screenToWorld(0, 0);
    const botRight = screenToWorld(viewport.width, viewport.height);
    const minTx = Math.floor(topLeft.wx / TILE) - 3;
    const maxTx = Math.ceil(botRight.wx / TILE) + 3;
    const minTy = Math.floor(topLeft.wy / TILE) - 3;
    const maxTy = Math.ceil(botRight.wy / TILE) + 3;

    for (let i = 0; i < runtime.bigSparklers.length; i++) {
      if (Math.random() > 0.34) continue;
      const bs = runtime.bigSparklers[i];
      if (bs.tx < minTx || bs.tx > maxTx || bs.ty < minTy || bs.ty > maxTy) continue;
      const bSp = getSpriteById(bs.id);
      const bFx = getTileFxColors(bSp, '#ffe6b3');
      const dw = TILE * (bs.mult || 2);
      const dh = TILE * (bs.mult || 2);
      const bx = bs.tx * TILE - (dw - TILE) * 0.5;
      const by = bs.ty * TILE - (dh - TILE);
      spawnParticle(
        bx + Math.random() * dw,
        by + Math.random() * dh,
        (Math.random() - 0.5) * 14,
        -16 - Math.random() * 14,
        0.52,
        Math.random() > 0.45 ? bFx.bright : bFx.light,
        1.5,
        0
      );
    }
  }

  // 6b. CHANGING (ITEM THROWER) fires on wired rising pulse OR periodically when unwired
  if (runtime.itemThrowers.length > 0 && runtime.projectiles.length < 48) {
    for (let i = 0; i < runtime.itemThrowers.length; i++) {
      const th = runtime.itemThrowers[i];
      const isWired = wiredTargets.has(th.key);
      let shouldFire = false;
      if (isWired) {
        shouldFire = runtime.poweredTargets.has(th.key) && !runtime.prevPoweredTargets.has(th.key);
      } else {
        th.timer -= dt;
        if (th.timer <= 0) {
          th.timer = 1.75;
          shouldFire = true;
        }
      }
      if (!shouldFire) continue;
      const wx = th.tx * TILE + TILE * 0.5;
      const wy = th.ty * TILE + TILE * 0.5;
      if (Math.hypot(wx - camera.x, wy - camera.y) > TILE * 28) continue;
      const dir = transformOrientVec(1, 0, th.orient || 0);
      const thFx = getTileFxColors(getSpriteById(th.id), '#ffd48c');
      runtime.projectiles.push({
        x: wx + dir.x * (TILE * 0.55),
        y: wy + dir.y * (TILE * 0.55),
        vx: dir.x * 165,
        vy: dir.y * 165 - (dir.y === 0 ? 22 : 0),
        life: 1.5,
        color: thFx.main,
        bounces: 1
      });
      spawnBurstParticles(wx + dir.x * (TILE * 0.5), wy + dir.y * (TILE * 0.5), thFx.light, 4, 34, thFx.main);
    }
  }

  // 7. Layered DYNAMIC objects (World STARTS ON TOUCH triggers + Companion ATTACHABLE / FOLLOWS / CLOSELY FOLLOWS)
  stepDynamicObjects(world, dt);
}

function stepDynamicObjects(world, dt) {
  const cx = player.x + player.w * 0.5;
  const footY = player.y + player.h;
  const ptx = Math.floor(cx / TILE);
  const pty = Math.floor((player.y + player.h * 0.5) / TILE);

  // 7a. World-placed DYNAMIC objects: check STARTS ON TOUCH activation & nearby say/sound side effects
  if (world && world.layers && world.layers.main) {
    const mainMap = world.layers.main;
    const areaName = world.name || 'WORLD';
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const tx = ptx + dx;
        const ty = pty + dy;
        const key = `${tx},${ty}`;
        const id = mainMap[key];
        if (!id || id === STARTER_TILE_ID) continue;
        const sp = getSpriteById(id);
        if (!sp || sp.type !== 'DYNAMIC' || isDynamicCompanion(sp)) continue;

        const opts = sp.dynamicOpts || {};
        const dSize = sp.size || 29;
        const bx = tx * TILE + TILE * 0.5 - dSize * 0.5;
        const by = (ty + 1) * TILE - dSize;

        if (opts.startsOnTouch && !player.dead) {
          const overlaps =
            player.x + player.w > bx && player.x < bx + dSize &&
            player.y + player.h > by && player.y < by + dSize;
          if (overlaps && !runtime.dynamicTriggers.has(key)) {
            runtime.dynamicTriggers.set(key, {
              startTime: state.simTime,
              active: true,
              lastSoundKey: null,
              lastSayKey: null
            });
            emitWorldEvent('dynamic:activate', { key, tx, ty, name: sp.name, id: sp.id });
          }
        }

        // Check active say/sound side effects for running world Dynamics
        const isWired = Array.isArray(world.wires) && world.wires.some(w => w.to === key);
        const powered = !isWired || runtime.poweredTargets.has(key);
        const trig = runtime.dynamicTriggers.get(key);
        const running = powered && (!opts.startsOnTouch || Boolean(trig && trig.active));
        if (!running) continue;

        const prog = sp._dynProgram || compileDynamicProgram(opts.script || '');
        const t = opts.startsOnTouch && trig ? Math.max(0, state.simTime - trig.startTime) : state.simTime;
        const res = evaluateDynamicFrame(prog, 'DEFAULT', t, (sp._canvases && sp._canvases.length) || 1, dSize, opts.pivots, {
          name: 'Player',
          area: areaName
        });

        if (res.activeSay || res.activeSoundKey) {
          let rec = trig;
          if (!rec) {
            rec = { startTime: 0, active: true, lastSoundKey: null, lastSayKey: null };
            runtime.dynamicTriggers.set(key, rec);
          }
          if (res.activeSay && res.activeSay.key !== rec.lastSayKey) {
            rec.lastSayKey = res.activeSay.key;
            pushSpeechBubble({
              target: 'world',
              key: 'dyn_' + key,
              wx: tx * TILE + TILE * 0.5,
              wy: by,
              text: res.activeSay.text
            });
          }
          if (res.activeSoundKey && res.activeSoundKey !== rec.lastSoundKey) {
            rec.lastSoundKey = res.activeSoundKey;
            SFX.playPickup();
          }
        }
      }
    }
  }

  // 7b. Equipped Companion DYNAMIC (ATTACHABLE / FOLLOWS / CLOSELY FOLLOWS)
  if (!state.equippedDynamicId) {
    runtime.companionDyn = null;
    return;
  }
  const compSp = getSpriteById(state.equippedDynamicId);
  if (!compSp || !isDynamicCompanion(compSp)) {
    state.equippedDynamicId = null;
    runtime.companionDyn = null;
    return;
  }

  const opts = compSp.dynamicOpts || {};
  const prog = compSp._dynProgram || compileDynamicProgram(opts.script || '');
  if (!runtime.companionDyn || runtime.companionDyn.id !== compSp.id) {
    const hasStart = Boolean(prog.markers && prog.markers.START);
    runtime.companionDyn = {
      id: compSp.id,
      x: cx,
      y: footY,
      prevX: cx,
      prevY: footY,
      facing: player.facing,
      marker: hasStart ? 'START' : 'DEFAULT',
      markerStart: state.simTime,
      startDone: !hasStart,
      actionTimer: 0,
      lastSoundKey: null,
      lastSayKey: null
    };
  }

  const comp = runtime.companionDyn;
  comp.prevX = comp.x;
  comp.prevY = comp.y;

  const mode = compSp.subType || 'ATTACHABLE';
  if (mode === 'ATTACHABLE') {
    comp.x = cx;
    comp.y = footY;
    comp.facing = player.facing;
  } else if (mode === 'FOLLOWS') {
    const targetX = cx - player.facing * 24;
    const targetY = player.y - 6 + Math.sin(state.simTime * 2.8) * 3.5;
    const k = 1 - Math.exp(-5.2 * dt);
    comp.x += (targetX - comp.x) * k;
    comp.y += (targetY - comp.y) * k;
    if (Math.abs(cx - comp.x) > 4) {
      comp.facing = cx >= comp.x ? 1 : -1;
    }
  } else {
    // CLOSELY FOLLOWS: ground buddy trotting right behind player's feet
    const targetX = cx - player.facing * 18;
    const targetY = footY;
    const k = 1 - Math.exp(-9.5 * dt);
    const oldX = comp.x;
    comp.x += (targetX - comp.x) * k;
    comp.y += (targetY - comp.y) * k;
    if (Math.abs(comp.x - oldX) > 0.14) {
      comp.facing = comp.x > oldX ? 1 : -1;
    } else {
      comp.facing = player.facing;
    }
  }

  if (comp.actionTimer > 0) comp.actionTimer = Math.max(0, comp.actionTimer - dt);

  let desiredMarker = 'DEFAULT';
  if (!comp.startDone && prog.markers.START) {
    const startDur = Math.max(0.5, prog.markers.START.restartAt || 1.2);
    if ((state.simTime - comp.markerStart) >= startDur) {
      comp.startDone = true;
    } else {
      desiredMarker = 'START';
    }
  }
  if (comp.startDone) {
    if (comp.actionTimer > 0 && prog.markers.ACTION) desiredMarker = 'ACTION';
    else if (player.climbing && prog.markers.CLIMB) desiredMarker = 'CLIMB';
    else if (player.inLiquid && prog.markers.SWIM) desiredMarker = 'SWIM';
    else if (player.laying && prog.markers.LIE) desiredMarker = 'LIE';
    else if (player.sitting && prog.markers.SIT) desiredMarker = 'SIT';
    else if (!player.grounded && player.vy < -15 && prog.markers.RISE) desiredMarker = 'RISE';
    else if (!player.grounded && player.vy > 15 && prog.markers.FALL) desiredMarker = 'FALL';
    else if (Math.abs(player.vx) > 10 && prog.markers.MOVE) desiredMarker = 'MOVE';
    else desiredMarker = 'DEFAULT';
  }

  if (desiredMarker !== comp.marker) {
    comp.marker = desiredMarker;
    comp.markerStart = state.simTime;
    comp.lastSoundKey = null;
    comp.lastSayKey = null;
  }

  const evalT = Math.max(0, state.simTime - comp.markerStart);
  const res = evaluateDynamicFrame(prog, comp.marker, evalT, (compSp._canvases && compSp._canvases.length) || 1, compSp.size || 29, opts.pivots, {
    name: 'Player',
    area: (world && world.name) || 'WORLD'
  });

  if (res.shouldRemove) {
    state.equippedDynamicId = null;
    runtime.companionDyn = null;
    savePrefsNow();
    updateTopUI();
    renderSidebar();
    return;
  }
  if (res.activeSay && res.activeSay.key !== comp.lastSayKey) {
    comp.lastSayKey = res.activeSay.key;
    pushSpeechBubble({
      target: 'world',
      key: 'comp_dyn',
      wx: comp.x,
      wy: comp.y - (compSp.size || 29),
      text: res.activeSay.text
    });
  }
  if (res.activeSoundKey && res.activeSoundKey !== comp.lastSoundKey) {
    comp.lastSoundKey = res.activeSoundKey;
    SFX.playPickup();
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
  if (player.splashCd > 0) player.splashCd = Math.max(0, player.splashCd - dt);
  if (player.damageFlashTimer > 0) player.damageFlashTimer = Math.max(0, player.damageFlashTimer - dt);
  if (runtime.seatCd > 0) runtime.seatCd = Math.max(0, runtime.seatCd - dt);
  if (!keys.down) runtime.seatNeedsDownRelease = false;

  // Smooth spring-damper tilt recovery after non-lethal hurt knockback
  if (Math.abs(player.hurtAngle) > 0.001 || Math.abs(player.hurtAngVel) > 0.001) {
    const stiff = player.grounded ? 68 : 34;
    const damp = player.grounded ? 12 : 6.2;
    const acc = -stiff * player.hurtAngle - damp * player.hurtAngVel;
    player.hurtAngVel += acc * dt;
    player.hurtAngle = clamp(player.hurtAngle + player.hurtAngVel * dt, -0.95, 0.95);
    if (Math.abs(player.hurtAngle) < 0.004 && Math.abs(player.hurtAngVel) < 0.02) {
      player.hurtAngle = 0;
      player.hurtAngVel = 0;
    }
  }

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

  // Ensure ridden mount still resolves to a valid MOUNTABLE sprite
  if (runtime.mount) {
    const mSp = getSpriteById(runtime.mount.id);
    if (!mSp || mSp.type !== 'MOUNTABLE') {
      runtime.mount = null;
    }
  }

  // Hands-free Sitting (Chair/Couch/Toilet) & Laying/Sleeping (Bed) posture loop
  if (runtime.seated) {
    const s = runtime.seated;
    const stillThere = world.layers[s.layer] && world.layers[s.layer][s.key] === s.id;
    const seatSp = s.id === STARTER_TILE_ID ? null : getSpriteById(s.id);
    const validSeat = Boolean(
      stillThere &&
      seatSp &&
      !isGearType(seatSp.type) &&
      (seatSp.poseAction === 'SIT' || seatSp.poseAction === 'LAY')
    );
    if (!validSeat) {
      releaseSeat(false);
    } else if (moveDir !== 0 || player.jumpBufTimer > 0) {
      const wantJump = player.jumpBufTimer > 0;
      releaseSeat(false);
      if (wantJump) {
        player.vy = PHYS.jumpVel * 0.92;
        player.grounded = false;
        player.jumpBufTimer = 0;
        player.jumpCutDone = false;
        SFX.playJump(false, player.surfaceSound);
      }
    } else {
      player.vx = 0;
      player.vy = 0;
      player.grounded = true;
      player.sitting = s.mode === 'SIT';
      player.laying = s.mode === 'LAY';
      player.facing = s.facing;
      // Soft drifting pixel Zzz motes when peacefully laying/sleeping
      if (player.laying) {
        player.sleepZTimer -= dt;
        if (player.sleepZTimer <= 0) {
          player.sleepZTimer = 1.15 + Math.random() * 0.55;
          const headOffX = player.facing >= 0 ? -4 : 4;
          spawnParticle(
            player.x + player.w * 0.5 + headOffX,
            player.y + player.h * 0.35,
            (Math.random() - 0.5) * 6,
            -14 - Math.random() * 6,
            1.25,
            '#c9e4ff',
            1.6,
            -4,
            { zzz: true, noDrag: true }
          );
        }
      }
      const scK = 1 - Math.exp(-14 * dt);
      player.scaleX += (1 - player.scaleX) * scK;
      player.scaleY += (1 - player.scaleY) * scK;
      return;
    }
  }

  if (moveDir !== 0) {
    player.facing = moveDir;
    stopActiveMotion(true);
  }

  // Check tile overlaps around player's body
  const pLeft = Math.floor((player.x + 2) / TILE);
  const pRight = Math.floor((player.x + player.w - 3) / TILE);
  const pTop = Math.floor((player.y + 2) / TILE);
  const pBot = Math.floor((player.y + player.h - 2) / TILE);
  const centerTx = Math.floor((player.x + player.w * 0.5) / TILE);
  const centerTy = Math.floor((player.y + player.h * 0.5) / TILE);

  let overlapLiquid = false;
  let overlapThickLiquid = false;
  let overlapLiquidColors = null;
  let liquidHazardLevel = 0; // 0 = NONE, 1 = HARMFUL, 2 = EXTRA HARMFUL
  let liquidTopTy = Infinity;
  let liquidBotTy = -Infinity;
  let liquidColTx = centerTx;
  let overlapClimb = false;
  let overlapHarmful = false;
  _curSwitches.clear();
  const curSwitches = _curSwitches;

  const applyHarmfulContact = (info, hazardCx) => {
    if (!info || info.type !== 'HARMFUL') return false;
    const away = (player.x + player.w * 0.5) < hazardCx ? -1 : 1;
    if (isDeadlyHarmSubType(info.subType)) {
      triggerPlayerDeath('deadly', false, away);
      return true;
    }
    overlapHarmful = true;
    player.healthRegenDelay = Math.max(player.healthRegenDelay, 1.8);
    if (runtime.hurtCd <= 0) {
      const dmg = getHarmDamage(info.sp);
      const hasKnockback = !(info.sp && info.sp.harmOpts && info.sp.harmOpts.knockback === false);
      runtime.hurtCd = 0.65;
      runtime.hurtFlash = hasKnockback ? 0.44 : 0.28;
      player.damageFlashTimer = 0.26;
      player.damageFlashKind = 'hurt';
      player.healthRegenDelay = 2.2;
      player.healthFullDelay = 0.9;
      player.health = Math.max(0, player.health - dmg);
      if (hasKnockback) {
        player.vx = away * 145;
        player.vy = -165;
        player.grounded = false;
        player.climbing = false;
        player.hurtAngle = 0;
        player.hurtAngVel = away * 10.5;
        player.scaleX = 0.86;
        player.scaleY = 1.16;
      } else {
        player.scaleX = 1.09;
        player.scaleY = 0.91;
      }
      if (player.health <= 0) {
        triggerPlayerDeath('harmful', false, away);
        return true;
      }
      SFX.playHurt();
      const harmFx = getTileFxColors(info, '#cf5959');
      spawnBurstParticles(player.x + player.w * 0.5, player.y + player.h * 0.5, harmFx.main, hasKnockback ? 8 : 5, hasKnockback ? 60 : 42, '#cf5959');
    }
    return false;
  };

  for (let ty = pTop; ty <= pBot; ty++) {
    for (let tx = pLeft; tx <= pRight; tx++) {
      const info = getMainTileInfo(world, tx, ty);
      if (info) {
        if (info.type === 'LIQUID') {
          overlapLiquid = true;
          const lOpts = info.sp && info.sp.liquidOpts;
          if (lOpts && lOpts.thick) overlapThickLiquid = true;
          if (lOpts && lOpts.hazard === 'EXTRA HARMFUL') liquidHazardLevel = Math.max(liquidHazardLevel, 2);
          else if (lOpts && lOpts.hazard === 'HARMFUL') liquidHazardLevel = Math.max(liquidHazardLevel, 1);
          if (ty < liquidTopTy || (ty === liquidTopTy && tx === centerTx)) {
            liquidTopTy = ty;
            liquidColTx = tx;
            overlapLiquidColors = getTileFxColors(info, '#4fa4d8');
          } else if (!overlapLiquidColors) {
            overlapLiquidColors = getTileFxColors(info, '#4fa4d8');
          }
          if (ty > liquidBotTy) liquidBotTy = ty;
        } else if (info.type === 'CLIMBABLE') {
          overlapClimb = true;
        } else if (info.type === 'PUSHING' && info.subType !== 'CONVEYOR') {
          const isPushWired = Array.isArray(world.wires) && world.wires.some(w => w.to === info.key);
          if (!isPushWired || runtime.poweredTargets.has(info.key)) {
            const force = 420;
            let bx = 0;
            let by = -1.15;
            if (info.subType === 'RIGHT') { bx = 1; by = 0; }
            else if (info.subType === 'LEFT') { bx = -1; by = 0; }
            else if (info.subType === 'DOWN') { bx = 0; by = 1; }
            const pv = transformOrientVec(bx, by, info.orient || 0);
            player.vx += pv.x * force * dt;
            player.vy += pv.y * force * dt;
          }
        } else if (info.type === 'GATHERABLE' && !runtime.collected.has(info.key)) {
          runtime.collected.add(info.key);
          SFX.playCollect();
          const gFx = getTileFxColors(info, '#f28c38');
          spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, gFx.main, 10, 62, gFx.bright);
        } else if (info.type === 'CHANGING' && info.subType === 'ON TOUCH') {
          triggerTileAnim('main', tx, ty, 'TOUCH');
        } else if (info.type === 'ACTIVATOR' && info.subType === 'SWITCH') {
          curSwitches.add(info.key);
          if (!runtime.switchOverlap.has(info.key)) {
            toggleActivatorSwitch(world, tx, ty);
          }
        } else if (info.type === 'TRANSPORTING' && (info.subType === 'ON TOUCH' || info.subType === 'DIRECTIONAL') && runtime.teleportCd <= 0) {
          teleportFromPortal(world, tx, ty, info.id, info.subType);
        } else if (info.type === 'HARMFUL' && !isMovingHarmSubType(info.subType)) {
          const harmActive = !isEmergingHarmSubType(info.subType)
            || evalEmergingHazard(tx, ty, info.sp && info.sp.harmOpts, info.orient, state.simTime).active;
          if (harmActive && applyHarmfulContact(info, tx * TILE + TILE * 0.5)) {
            return;
          }
        }
      }
      if (isWalkableBackAt(world, tx, ty)) {
        overlapClimb = true;
      }
    }
  }

  // Climbable BACK + FRONT Big Things (full 38x38 2x2 area)
  if (!overlapClimb && isClimbableBigThingAt(world, player.x, player.y, player.w, player.h)) {
    overlapClimb = true;
  }

  // Transforming Big Things: auto-grant optional attached item during sequence while player is inside it
  for (const layer of ['bg', 'fg']) {
    const map = world.layers[layer];
    if (!map) continue;
    for (let ty = pTop; ty <= pBot + 1; ty++) {
      for (let tx = pLeft - 1; tx <= pRight + 1; tx++) {
        const key = tileKey(tx, ty);
        const id = map[key];
        if (!id || id === STARTER_TILE_ID) continue;
        const bSp = getSpriteById(id);
        if (!bSp || bSp.type !== 'BIG_THING' || bSp.subType !== 'TRANSFORMING') continue;
        if (!(bSp.bigOpts && bSp.bigOpts.giveItemId)) continue;
        const dw = TILE * 2;
        const dh = TILE * 2;
        const bx = tx * TILE - (dw - TILE) * 0.5;
        const by = ty * TILE - (dh - TILE);
        if (player.x + player.w > bx && player.x < bx + dw && player.y + player.h > by && player.y < by + dh) {
          grantBigThingReward(bSp, layer, key, tx, ty, false);
        }
      }
    }
  }

  // Check live DEADLY MOVING patrolling hazards (instant kill on contact)
  if (runtime.deadlyMoving.size > 0) {
    for (const dm of runtime.deadlyMoving.values()) {
      if (
        player.x + player.w - 2 > dm.x + 1 &&
        player.x + 2 < dm.x + TILE - 1 &&
        player.y + player.h - 2 > dm.y + 1 &&
        player.y + 2 < dm.y + TILE - 1
      ) {
        const away = (player.x + player.w * 0.5) < (dm.x + TILE * 0.5) ? -1 : 1;
        triggerPlayerDeath('deadly', false, away);
        return;
      }
    }
  }

  // Track highest contiguous liquid surface column above the player
  let surfaceY = player.lastLiquidSurfaceY;
  if (overlapLiquid) {
    let topTy = liquidTopTy;
    let guard = 0;
    const probeTx = getMainTileType(world, centerTx, topTy) === 'LIQUID' ? centerTx : liquidColTx;
    while (guard++ < 32 && getMainTileType(world, probeTx, topTy - 1) === 'LIQUID') {
      topTy--;
    }
    surfaceY = topTy * TILE;
    player.lastLiquidSurfaceY = surfaceY;
  }

  // Sync ACTIVATOR (SWITCH) overlap set so stepping off & back on re-toggles cleanly
  runtime.switchOverlap.clear();
  for (const sk of curSwitches) runtime.switchOverlap.add(sk);

  // Liquid entry & exit transitions with position-accurate, velocity-scaled splashes tinted to the liquid's dominant color
  const wasInLiquid = player.inLiquid;
  const wasThickLiquid = player.inThickLiquid;
  if (overlapLiquid && overlapLiquidColors) {
    player.lastLiquidColors = overlapLiquidColors;
  }
  const activeLiquidCols = overlapLiquidColors || player.lastLiquidColors;
  player.inLiquid = overlapLiquid;
  player.inThickLiquid = overlapLiquid && overlapThickLiquid;
  if (!wasInLiquid && player.inLiquid) {
    const plungeImp = clamp(Math.hypot(player.vx * 0.35, player.vy) / 210, 0.35, 1.15);
    if (player.splashCd <= 0) {
      const bottomEdgeY = (liquidBotTy + 1) * TILE;
      const enteredAtTop = (player.y + player.h * 0.35) <= (surfaceY + TILE * 0.75) && player.vy >= -30;
      const enteredFromBottom = !enteredAtTop && player.vy < -15 && player.y >= (bottomEdgeY - TILE * 0.65);
      if (enteredAtTop) {
        spawnLiquidSplash(player.x + player.w * 0.5, surfaceY + 2, false, plungeImp, 'surface', activeLiquidCols);
      } else if (enteredFromBottom) {
        spawnLiquidSplash(player.x + player.w * 0.5, bottomEdgeY - 1, false, plungeImp * 0.78, 'bottom', activeLiquidCols);
      } else {
        spawnLiquidSplash(player.x + player.w * 0.5, player.y + player.h * 0.5, false, plungeImp * 0.72, 'side', activeLiquidCols);
      }
      SFX.playSplash(false, enteredAtTop ? plungeImp : plungeImp * 0.72, player.inThickLiquid);
      player.splashCd = 0.16;
    }
    // Soften impact velocity so the player plunges smoothly before floating back up (prevent skipping/hopping on surface)
    if (player.vy > 10) {
      player.liquidExitCd = Math.max(player.liquidExitCd, 0.24);
      player.jumpBufTimer = 0;
    }
    player.vy *= player.inThickLiquid ? 0.28 : 0.42;
    player.vx *= player.inThickLiquid ? 0.48 : 0.68;
    player.climbing = false;
    player.sitting = false;
    player.laying = false;
    player.sleepZTimer = 0;
    runtime.swingLine = null;
    player.scaleX = 1.14;
    player.scaleY = 0.88;
  } else if (wasInLiquid && !player.inLiquid) {
    if (player.skipExitSplashTimer <= 0 && player.splashCd <= 0) {
      const exitImp = clamp(Math.hypot(player.vx * 0.4, player.vy) / 185, 0.35, 1.05);
      const exitedAtTop = (player.y + player.h) <= (player.lastLiquidSurfaceY + TILE * 0.9);
      if (exitedAtTop) {
        spawnLiquidSplash(player.x + player.w * 0.5, player.lastLiquidSurfaceY + 2, true, exitImp, 'surface', activeLiquidCols);
      } else if (player.vy > 20) {
        spawnLiquidSplash(player.x + player.w * 0.5, player.y + 2, true, exitImp * 0.72, 'bottom', activeLiquidCols);
      } else {
        spawnLiquidSplash(player.x + player.w * 0.5, player.y + player.h * 0.5, true, exitImp * 0.68, 'side', activeLiquidCols);
      }
      SFX.playSplash(true, exitedAtTop ? exitImp : exitImp * 0.7, wasThickLiquid);
      player.splashCd = 0.16;
    }
    player.swimming = false;
    player.swimTilt = 0;
    player.liquidHazardTickTimer = 0;
  }

  // Harmful / Extra Harmful liquid contact damage (acid / lava)
  if (player.inLiquid && liquidHazardLevel > 0) {
    overlapHarmful = true;
    const dps = liquidHazardLevel === 2 ? 22 : 9;
    player.healthRegenDelay = 2.2;
    player.healthFullDelay = 0.9;
    player.health = Math.max(0, player.health - dps * dt);
    player.liquidHazardTickTimer -= dt;
    if (player.liquidHazardTickTimer <= 0 && player.health > 0) {
      player.liquidHazardTickTimer = liquidHazardLevel === 2 ? 0.55 : 0.85;
      player.damageFlashTimer = 0.24;
      player.damageFlashKind = 'hurt';
      runtime.hurtFlash = 0.24;
      SFX.playHurt();
      const hazCol = activeLiquidCols ? activeLiquidCols.main : (liquidHazardLevel === 2 ? '#ff6a33' : '#cf5959');
      const hazHi = activeLiquidCols ? activeLiquidCols.bright : '#ffd4a3';
      spawnBurstParticles(player.x + player.w * 0.5, player.y + player.h * 0.45, hazCol, 6, 46, hazHi);
    }
    if (player.health <= 0) {
      triggerPlayerDeath('harmful', false, -player.facing);
      return;
    }
  } else {
    player.liquidHazardTickTimer = 0;
  }

  // Climbing entry / exit (ladders & walkable backs)
  if (overlapClimb && !player.inLiquid && !runtime.mount) {
    if (keys.up || (keys.down && !player.grounded)) {
      player.climbing = true;
      player.grounded = false;
      player.sitting = false;
  player.laying = false;
  player.sleepZTimer = 0;
    }
  } else {
    player.climbing = false;
  }

  // Flying mount movement
  if (runtime.mount && runtime.mount.subType === 'FLYING') {
    runtime.swingLine = null;
    const flySpeed = 148;
    const vDir = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    player.vx += (moveDir * flySpeed - player.vx) * (1 - Math.exp(-8 * dt));
    player.vy += (vDir * flySpeed - player.vy) * (1 - Math.exp(-8 * dt));
    player.grounded = false;
    player.swimming = false;
  } else if (runtime.swingLine) {
    // Active HOLDABLE (SWING LINE) pendulum grapple physics
    const sw = runtime.swingLine;
    if (!isFullSolidAt(world, sw.tx, sw.ty) || player.inLiquid) {
      runtime.swingLine = null;
    } else {
      player.grounded = false;
      player.climbing = false;
      player.sitting = false;
  player.laying = false;
  player.sleepZTimer = 0;
      player.swimming = false;
      const reelDir = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (reelDir !== 0) {
        sw.len = clamp(sw.len + reelDir * 72 * dt, TILE * 1.2, TILE * 8.5);
      }
      player.vy = Math.min(PHYS.maxFall * 1.15, player.vy + PHYS.gravity * 0.92 * dt);
      if (moveDir !== 0) {
        player.vx += moveDir * 225 * dt;
      }
      const pcx = player.x + player.w * 0.5;
      const pcy = player.y + player.h * 0.5;
      const rdx = pcx - sw.ax;
      const rdy = pcy - sw.ay;
      const dist = Math.hypot(rdx, rdy) || 0.001;
      if (dist >= sw.len) {
        const nx = rdx / dist;
        const ny = rdy / dist;
        const corr = dist - sw.len;
        player.x -= nx * corr;
        player.y -= ny * corr;
        const radialVel = player.vx * nx + player.vy * ny;
        if (radialVel > 0) {
          player.vx -= radialVel * nx;
          player.vy -= radialVel * ny;
        }
        player.vx *= Math.exp(-0.22 * dt);
        player.vy *= Math.exp(-0.22 * dt);
      }
      if (player.jumpBufTimer > 0) {
        runtime.swingLine = null;
        player.vy = Math.min(player.vy, PHYS.jumpVel * 0.86);
        player.jumpBufTimer = 0;
        player.jumpCutDone = false;
        player.scaleX = 0.86;
        player.scaleY = 1.16;
        SFX.playJump(false);
      }
    }
  } else if (player.inLiquid) {
    // Liquid physics: automatic buoyancy floats player cleanly to the top surface (viscous THICK sinks deeper & slower)
    const thick = player.inThickLiquid;
    const targetFloatY = surfaceY - (thick ? player.h * 0.06 : player.h * 0.24);
    const depthBelowSurface = player.y - targetFloatY;
    const nearSurface = depthBelowSurface <= (thick ? 6.5 : 5.5);

    // Active swimming check: walk cycle ONLY plays when actively swimming
    const activelySwimming = (moveDir !== 0) || keys.down || (keys.up && !nearSurface);
    player.swimming = activelySwimming;

    // Horizontal fluid swimming with gentle stroke surges
    const swimSpeedMult = thick ? 0.58 : 1.0;
    if (moveDir !== 0) {
      player.swimCycle += dt * (thick ? 5.0 : 7.2);
      const strokeSurge = 1 + 0.16 * Math.sin(player.swimCycle * 2);
      const targetVx = moveDir * PHYS.liquidMaxX * swimSpeedMult * strokeSurge;
      const accel = PHYS.liquidSwimAccelX * (thick ? 0.65 : 1.0) * dt;
      if (player.vx < targetVx) player.vx = Math.min(targetVx, player.vx + accel);
      else player.vx = Math.max(targetVx, player.vx - accel);
    } else {
      const drag = PHYS.liquidDragX * (thick ? 1.55 : 1.0) * dt;
      if (Math.abs(player.vx) <= drag) player.vx = 0;
      else player.vx -= Math.sign(player.vx) * drag;
    }

    // Vertical buoyancy, diving, upward swimming & clean breach-out leap (no bob-spring yank & no auto-pogo on hold)
    const pushingIntoBank = moveDir !== 0 && (() => {
      const sideTx = moveDir > 0
        ? Math.floor((player.x + player.w + 2) / TILE)
        : Math.floor((player.x - 2) / TILE);
      const bankTy = Math.floor((surfaceY + 4) / TILE);
      return (isFullSolidAt(world, sideTx, bankTy) || isOneWaySupportAt(world, sideTx, bankTy))
        && !isFullSolidAt(world, sideTx, bankTy - 1);
    })();
    const wantsBreach = nearSurface && player.liquidExitCd <= 0 && (
      player.jumpBufTimer > 0 || (keys.up && pushingIntoBank)
    );

    if (player.liquidExitCd > 0 && player.vy < 0 && !keys.down) {
      // Mid-breach leap clearing the top water tile: let upward arc carry cleanly without bob-spring drag
      player.vy = Math.min(PHYS.maxFall, player.vy + PHYS.gravity * 0.55 * dt);
    } else if (keys.down) {
      player.swimCycle += dt * (thick ? 4.8 : 6.5);
      player.vy += (PHYS.liquidDiveSpeed * swimSpeedMult - player.vy) * (1 - Math.exp(-5.5 * dt));
    } else if (wantsBreach) {
      // Single deliberate leap out of the water surface (or smooth bank climb-out)
      player.vy = PHYS.liquidExitHop * (thick ? 0.78 : 1.0);
      player.jumpBufTimer = 0;
      player.jumpCutDone = true;
      player.liquidExitCd = 0.34;
      player.skipExitSplashTimer = 0.34;
      player.jumpTimer = 0.20;
      player.scaleX = 0.86;
      player.scaleY = 1.18;
      spawnLiquidSplash(player.x + player.w * 0.5, surfaceY + 2, true, 0.88, 'surface', activeLiquidCols);
      SFX.playLiquidJump();
    } else if (keys.up && !nearSurface) {
      player.swimCycle += dt * (thick ? 5.2 : 7.6);
      player.vy = Math.max(PHYS.liquidSwimVel * swimSpeedMult, player.vy - PHYS.liquidSwimAccel * (thick ? 0.62 : 1.0) * dt);
    } else {
      // Slow, gentle automatic float-to-top buoyancy + calm bobbing at the waterline
      const floatSpeed = PHYS.liquidFloatSpeed * (thick ? 0.55 : 1.0);
      if (depthBelowSurface > 1.5) {
        if (player.vy > floatSpeed) {
          player.vy = Math.max(floatSpeed, player.vy - PHYS.liquidBuoyancy * (thick ? 0.55 : 1.0) * dt);
        } else {
          // Smooth water drag decelerating fast upward entry down to calm float speed
          player.vy += (floatSpeed - player.vy) * (1 - Math.exp(-4.5 * dt));
        }
      } else {
        const bobTarget = targetFloatY + Math.sin(state.simTime * (thick ? 1.8 : 2.6)) * (thick ? 0.7 : 1.15);
        const springVy = (bobTarget - player.y) * (thick ? 3.8 : 5.5);
        player.vy += (springVy - player.vy) * (1 - Math.exp(-6.0 * dt));
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
          -22,
          0.72,
          activeLiquidCols
        );
        if (nearSurface && Math.abs(player.vx) > 20) {
          if (worldFX.waterRipples.length >= 16) worldFX.waterRipples.shift();
          worldFX.waterRipples.push({
            x: player.x + player.w * 0.5 - player.facing * 4,
            y: surfaceY + 1.5,
            timer: 0,
            maxTimer: 0.32,
            maxRx: 8.5,
            crownH: 0,
            color: activeLiquidCols ? activeLiquidCols.main : '#b2e1fa',
            waveColor: activeLiquidCols ? activeLiquidCols.light : '#e4f7ff',
            crownColor: activeLiquidCols ? activeLiquidCols.bright : '#d6f2ff'
          });
        }
      }
    } else {
      player.swimSoundTimer = 0;
      if (!nearSurface) {
        player.diveBubbleTimer -= dt;
        if (player.diveBubbleTimer <= 0) {
          player.diveBubbleTimer = 0.36 + Math.random() * 0.3;
          spawnWaterBubble(player.x + player.w * 0.5, player.y + 4, 0, -24, 0.72, activeLiquidCols);
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

    // Ground / Air horizontal motion (with MOUNTABLE boost, SLIDEY ice friction & Manyland STICKY drag)
    const stickySlow = player.onSticky ? 0.40 : 1.0;
    const maxSpd = ((runtime.mount && runtime.mount.subType === 'GROUND') ? PHYS.walkMax * 1.48 : PHYS.walkMax) * stickySlow;
    const accel = player.grounded
      ? (player.onSlip ? PHYS.slipAccel : (player.onSticky ? PHYS.groundAccel * 0.55 : PHYS.groundAccel))
      : PHYS.airAccel;
    const decel = player.grounded
      ? (player.onSlip ? PHYS.slipDecel : (player.onSticky ? PHYS.groundDecel * 1.35 : PHYS.groundDecel))
      : PHYS.airDecel;

    if (moveDir !== 0 && !player.sitting) {
      notifyPixoEvent('walk');
      const targetVx = moveDir * maxSpd;
      const step = accel * dt;
      if (player.vx < targetVx) player.vx = Math.min(targetVx, player.vx + step);
      else player.vx = Math.max(targetVx, player.vx - step);
    } else {
      const step = decel * dt;
      if (Math.abs(player.vx) <= step) player.vx = 0;
      else player.vx -= Math.sign(player.vx) * step;
    }

    // S/Down: drop through ONE-WAY platforms OR settle onto a SITTABLE / LAYABLE object (never sit on plain ground!)
    if (keys.down && player.grounded) {
      const footTy = Math.floor((player.y + player.h + 1) / TILE);
      const standingOneWay = isOneWaySupportAt(world, pLeft, footTy) || isOneWaySupportAt(world, pRight, footTy);
      const standingSolid = isFullSolidAt(world, pLeft, footTy) || isFullSolidAt(world, pRight, footTy);
      if (standingOneWay && !standingSolid) {
        runtime.dropThruTimer = 0.22;
        player.grounded = false;
        player.y += 2;
      } else if (moveDir === 0 && runtime.seatCd <= 0 && !runtime.seatNeedsDownRelease && Math.abs(player.vx) < 35) {
        const seat = findNearbySeat(world);
        if (seat) {
          engageSeat(seat);
          return;
        }
      }
    }
    player.sitting = false;
    player.laying = false;
    player.sleepZTimer = 0;

    // Coyote time & buffered jump (Manyland STICKY surfaces slow movement & block jumping while touching)
    if (player.grounded && !player.onSticky) {
      player.coyoteTimer = PHYS.coyoteMax;
      player.jumpCutDone = false;
    } else if (player.onSticky) {
      player.coyoteTimer = 0;
    }

    const touchStickyLeft = !player.grounded && getMainTileInfo(world, Math.floor((player.x - 1) / TILE), centerTy)?.subType === 'STICKY';
    const touchStickyRight = !player.grounded && getMainTileInfo(world, Math.floor((player.x + player.w + 1) / TILE), centerTy)?.subType === 'STICKY';

    if (player.jumpBufTimer > 0) {
      if (player.onSticky || touchStickyLeft || touchStickyRight) {
        // Sticky blocks hold onto the player and prevent jumping until they step away
        player.jumpBufTimer = 0;
        player.scaleX = 1.12;
        player.scaleY = 0.88;
      } else if (player.coyoteTimer > 0) {
        player.vy = PHYS.jumpVel;
        player.grounded = false;
        player.sitting = false;
  player.laying = false;
  player.sleepZTimer = 0;
        player.coyoteTimer = 0;
        player.jumpBufTimer = 0;
        player.jumpCutDone = false;
        player.jumpTimer = 0.16;
        player.scaleX = 0.86;
        player.scaleY = 1.16;
        stopActiveMotion(true);
        spawnRunDust(player.x + player.w * 0.5, player.y + player.h, player.facing, player.surfaceSound, true, player.surfaceColor);
        SFX.playJump(false, player.surfaceSound);
        notifyPixoEvent('jump');
        emitWorldEvent('player:jump', { x: player.x, y: player.y });
      }
    }

    // Variable jump height cut on early release
    if (!keys.up && player.vy < -60 && !player.jumpCutDone) {
      player.vy *= PHYS.jumpCutFactor;
      player.jumpCutDone = true;
    }

    // Gravity (respects sandbox gravityScale; heavily slowed adhesion slide on STICKY walls; ZERO-G lets W/S float!)
    const gScale = Number.isFinite(state.gravityScale) ? state.gravityScale : 1.0;
    if (gScale <= 0.01) {
      const vDir = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (vDir !== 0) {
        player.vy += (vDir * 118 - player.vy) * (1 - Math.exp(-5 * dt));
      } else {
        player.vy *= Math.exp(-1.4 * dt);
      }
      player.fallTimer = 0;
    } else {
      const baseGrav = PHYS.gravity * gScale;
      const grav = (touchStickyLeft || touchStickyRight) && player.vy > 0 ? baseGrav * 0.20 : baseGrav;
      player.vy = Math.min(PHYS.maxFall * Math.max(1, Math.sqrt(gScale)), player.vy + grav * dt);
    }
  }

  // Apply horizontal movement & solid / directional one-way wall / side-spring collisions
  const prevLeft = player.x;
  const prevRight = player.x + player.w;
  player.x += player.vx * dt;
  const hTop = Math.floor((player.y + 2) / TILE);
  const hBot = Math.floor((player.y + player.h - 2) / TILE);
  if (player.vx > 0) {
    const rTx = Math.floor((player.x + player.w - 0.001) / TILE);
    for (let ty = hTop; ty <= hBot; ty++) {
      const solid = isFullSolidAt(world, rTx, ty);
      const oneWayWall = !solid && isOneWayWallLeftAt(world, rTx, ty) && prevRight <= rTx * TILE + 3.5;
      if (solid || oneWayWall) {
        player.x = rTx * TILE - player.w;
        player.vx = 0;
        if (solid) {
          const hitInfo = getMainTileInfo(world, rTx, ty);
          if (hitInfo && hitInfo.type === 'BOUNCY') {
            triggerBouncyContact(hitInfo, rTx, ty, 'left');
          } else if (hitInfo && hitInfo.type === 'HARMFUL') {
            if (applyHarmfulContact(hitInfo, rTx * TILE + TILE * 0.5)) return;
          }
        }
        break;
      }
    }
  } else if (player.vx < 0) {
    const lTx = Math.floor(player.x / TILE);
    for (let ty = hTop; ty <= hBot; ty++) {
      const solid = isFullSolidAt(world, lTx, ty);
      const oneWayWall = !solid && isOneWayWallRightAt(world, lTx, ty) && prevLeft >= (lTx + 1) * TILE - 3.5;
      if (solid || oneWayWall) {
        player.x = (lTx + 1) * TILE;
        player.vx = 0;
        if (solid) {
          const hitInfo = getMainTileInfo(world, lTx, ty);
          if (hitInfo && hitInfo.type === 'BOUNCY') {
            triggerBouncyContact(hitInfo, lTx, ty, 'right');
          } else if (hitInfo && hitInfo.type === 'HARMFUL') {
            if (applyHarmfulContact(hitInfo, lTx * TILE + TILE * 0.5)) return;
          }
        }
        break;
      }
    }
  }

  // Apply vertical movement & solid / one-way / moving platform / slope collisions
  const wasGrounded = player.grounded;
  const preImpactVy = player.vy;
  const prevTop = player.y;
  const prevBottom = player.y + player.h;
  player.y += player.vy * dt;
  player.grounded = false;
  player.onSlip = false;
  player.onSticky = false;

  const vLeft = Math.floor((player.x + 2) / TILE);
  const vRight = Math.floor((player.x + player.w - 3) / TILE);

  if (player.vy >= 0) {
    const footTy = Math.floor((player.y + player.h - 0.001) / TILE);
    const centerFootTx = Math.floor((player.x + player.w * 0.5) / TILE);
    let landedTileInfo = null;
    let bouncyHit = null;
    let conveyorHit = null;
    for (let tx = vLeft; tx <= vRight; tx++) {
      const solid = isFullSolidAt(world, tx, footTy);
      const oneWay = runtime.dropThruTimer <= 0 && !player.climbing && isOneWaySupportAt(world, tx, footTy) && prevBottom <= footTy * TILE + 3.5;
      if (solid || oneWay) {
        if (!player.grounded) {
          player.y = footTy * TILE - player.h;
          player.vy = 0;
          player.grounded = true;
          if (player.climbing && keys.down) {
            player.climbing = false;
          }
        }
        const tileInfo = getMainTileInfo(world, tx, footTy);
        if (!landedTileInfo || tx === centerFootTx) {
          landedTileInfo = tileInfo;
        }
        if (tileInfo && tileInfo.type === 'SLIDEY') player.onSlip = true;
        if (tileInfo && tileInfo.type === 'SOLID' && tileInfo.subType === 'STICKY') player.onSticky = true;
        if (tileInfo && tileInfo.type === 'CRUMBLING') {
          triggerCrumblingStep(world, tx, footTy, tileInfo, wasGrounded, preImpactVy);
        }
        if (!bouncyHit && tileInfo && tileInfo.type === 'BOUNCY') {
          bouncyHit = { info: tileInfo, tx };
        }
        if (!conveyorHit && tileInfo && tileInfo.type === 'PUSHING' && tileInfo.subType === 'CONVEYOR') {
          conveyorHit = tileInfo;
        }
        if (solid && tileInfo && tileInfo.type === 'HARMFUL') {
          if (applyHarmfulContact(tileInfo, tx * TILE + TILE * 0.5)) return;
        }
      }
    }
    if (player.grounded) {
      player.surfaceSound = resolveSurfaceSound(landedTileInfo);
      player.surfaceColor = getTileFxColors(landedTileInfo, '#8a94a8').main;
      if (bouncyHit) {
        triggerBouncyContact(bouncyHit.info, bouncyHit.tx, footTy, 'top');
      } else if (conveyorHit) {
        const cWired = Array.isArray(world.wires) && world.wires.some(w => w.to === conveyorHit.key);
        if (!cWired || runtime.poweredTargets.has(conveyorHit.key)) {
          const cv = transformOrientVec(1, 0, conveyorHit.orient || 0);
          player.vx += cv.x * 320 * dt;
          player.vx = clamp(player.vx, -PHYS.walkMax * 1.45, PHYS.walkMax * 1.45);
        }
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
          const mSp = getSpriteById(m.id);
          player.surfaceSound = resolveSurfaceSound(mSp ? { type: mSp.type, subType: mSp.subType, sp: mSp } : null);
          player.surfaceColor = getTileFxColors(mSp, '#8a94a8').main;
          break;
        }
      }
    }

    // Stand & ride on top of standable DYNAMIC physics bodies (crates, heavy metal, wheels, thrusters, vehicles!)
    if (!player.grounded && runtime.dynamics.size > 0) {
      for (const dyn of runtime.dynamics.values()) {
        if (dyn.exploded) continue;
        const dSpec = getPhysicsSpec(dyn.subType);
        if (!dSpec.standable) continue;
        if (
          player.x + player.w > dyn.x + 2 &&
          player.x < dyn.x + TILE - 2 &&
          prevBottom <= dyn.prevY + 6 &&
          player.y + player.h >= dyn.y
        ) {
          player.y = dyn.y - player.h;
          player.x += (dyn.x - dyn.prevX);
          player.vy = 0;
          player.grounded = true;
          const dSp = getSpriteById(dyn.id);
          player.surfaceSound = dSpec.isHeavy ? 'METAL' : 'WOOD';
          player.surfaceColor = getTileFxColors(dSp, '#8a94a8').main;
          break;
        }
      }
    }
  } else {
    const headTy = Math.floor(player.y / TILE);
    for (let tx = vLeft; tx <= vRight; tx++) {
      const solid = isFullSolidAt(world, tx, headTy);
      const oneWayCeil = !solid && isOneWayCeilingAt(world, tx, headTy) && prevTop >= (headTy + 1) * TILE - 3.5;
      if (solid || oneWayCeil) {
        player.y = (headTy + 1) * TILE;
        player.vy = 0;
        if (solid) {
          const hitInfo = getMainTileInfo(world, tx, headTy);
          if (hitInfo && hitInfo.type === 'BOUNCY') {
            triggerBouncyContact(hitInfo, tx, headTy, 'bottom');
          } else if (hitInfo && hitInfo.type === 'CRUMBLING' && hitInfo.subType !== 'FLEXIBLE') {
            const upsideDown = transformOrientVec(0, -1, hitInfo.orient || 0).y > 0;
            if ((hitInfo.subType === 'INSTANT' || upsideDown) && !runtime.crumbling.has(hitInfo.key)) {
              const cDur = hitInfo.subType === 'INSTANT' ? 0.10 : 0.24;
              runtime.crumbling.set(hitInfo.key, {
                state: 'shake',
                timer: cDur,
                duration: cDur,
                waitingClear: false
              });
              SFX.playCrumbleShake();
            }
          } else if (hitInfo && hitInfo.type === 'HARMFUL') {
            if (applyHarmfulContact(hitInfo, tx * TILE + TILE * 0.5)) return;
          }
        }
        break;
      }
    }
  }

  // Stationary / continuous perimeter contact check for SOLID HARMFUL / SOLID DEADLY blocks on all 4 sides
  if (!player.dead) {
    const cLeft = Math.floor((player.x + 2) / TILE);
    const cRight = Math.floor((player.x + player.w - 3) / TILE);
    const cTop = Math.floor((player.y + 2) / TILE);
    const cBot = Math.floor((player.y + player.h - 3) / TILE);
    const edgeProbes = [
      [cLeft, Math.floor((player.y + player.h + 1) / TILE)],
      [cRight, Math.floor((player.y + player.h + 1) / TILE)],
      [cLeft, Math.floor((player.y - 1) / TILE)],
      [cRight, Math.floor((player.y - 1) / TILE)],
      [Math.floor((player.x - 1) / TILE), cTop],
      [Math.floor((player.x - 1) / TILE), cBot],
      [Math.floor((player.x + player.w + 1) / TILE), cTop],
      [Math.floor((player.x + player.w + 1) / TILE), cBot]
    ];
    for (let i = 0; i < edgeProbes.length; i++) {
      const [ptx, pty] = edgeProbes[i];
      if (!isFullSolidAt(world, ptx, pty)) continue;
      const pInfo = getMainTileInfo(world, ptx, pty);
      if (pInfo && pInfo.type === 'HARMFUL') {
        if (applyHarmfulContact(pInfo, ptx * TILE + TILE * 0.5)) return;
      }
    }
  }

  // 45-degree SLOPE & SLIDEY SLOPE collision (upright walkable ramps + rotated/inverted ceiling bevels)
  const footCx = player.x + player.w * 0.5;
  const slopeTx = Math.floor(footCx / TILE);
  const slopeTy = Math.floor((player.y + player.h - 1) / TILE);
  const slopeInfo = getMainTileInfo(world, slopeTx, slopeTy);
  if (slopeInfo && slopeInfo.type === 'SLOPE' && player.vy >= 0) {
    const baseNx = isUpLeftSlopeSubType(slopeInfo.subType) ? 1 : -1;
    const sn = transformOrientVec(baseNx, -1, slopeInfo.orient || 0);
    if (sn.y < 0) {
      const localX = clamp(footCx - slopeTx * TILE, 0, TILE);
      const surfaceOffset = sn.x > 0 ? localX : (TILE - localX);
      const targetY = slopeTy * TILE + surfaceOffset - player.h;
      if (player.y >= targetY - 4) {
        player.y = targetY;
        player.vy = 0;
        player.grounded = true;
        player.surfaceSound = resolveSurfaceSound(slopeInfo);
        player.surfaceColor = getTileFxColors(slopeInfo, '#8a94a8').main;
        if (isSlideySlopeSubType(slopeInfo.subType)) {
          player.onSlip = true;
          player.vx = clamp(player.vx + Math.sign(sn.x) * 195 * dt, -PHYS.walkMax * 1.45, PHYS.walkMax * 1.45);
        }
      }
    }
  }
  const headSlopeTy = Math.floor((player.y + 1) / TILE);
  const headSlopeInfo = getMainTileInfo(world, slopeTx, headSlopeTy);
  if (headSlopeInfo && headSlopeInfo.type === 'SLOPE' && player.vy <= 0) {
    const baseNx = isUpLeftSlopeSubType(headSlopeInfo.subType) ? 1 : -1;
    const hsn = transformOrientVec(baseNx, -1, headSlopeInfo.orient || 0);
    if (hsn.y > 0) {
      const localX = clamp(footCx - slopeTx * TILE, 0, TILE);
      const ceilY = headSlopeTy * TILE + (hsn.x > 0 ? (TILE - localX) : localX);
      if (player.y < ceilY && player.y + player.h > headSlopeTy * TILE) {
        player.y = ceilY;
        if (player.vy < 0) {
          player.vx += Math.sign(hsn.x) * Math.min(85, Math.abs(player.vy) * 0.28);
          player.vy = 0;
        }
      }
    }
  }

  // Landing impact foley, dust & squash
  if (!wasGrounded && player.grounded && !player.inLiquid && preImpactVy > 65) {
    const imp = clamp((preImpactVy - 55) / 210, 0.2, 1.0);
    player.landTimer = 0.12;
    player.scaleX = 1 + imp * 0.18;
    player.scaleY = 1 - imp * 0.16;
    spawnLandingDust(player.x + player.w * 0.5, player.y + player.h, imp, player.surfaceSound, player.surfaceColor);
    SFX.playLand(imp, player.surfaceSound);
  }

  // Running dust & material-aware footsteps
  if (player.grounded && !player.inLiquid && Math.abs(player.vx) > 22) {
    player.runDustTimer -= dt;
    if (player.runDustTimer <= 0) {
      player.runDustTimer = player.onSlip ? 0.12 : 0.18;
      spawnRunDust(player.x + player.w * 0.5, player.y + player.h, Math.sign(player.vx), player.surfaceSound, false, player.surfaceColor);
    }
    player.stepTimer -= dt;
    if (player.stepTimer <= 0) {
      SFX.playStep(player.surfaceSound);
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
  } else {
    if (wasSubmerged && player.breath < player.maxBreath - 1.0) {
      SFX.playGasp();
    }
    if (player.breath < player.maxBreath) {
      player.breath = Math.min(player.maxBreath, player.breath + 4.5 * dt);
      player.breathFullDelay = 0.6;
    } else if (player.breathFullDelay > 0) {
      player.breathFullDelay = Math.max(0, player.breathFullDelay - dt);
    }
  }

  // Health acts independently of breathing unless actively out of breath (drowning) or touching harmfuls
  const isDrowning = player.submerged && player.breath <= 0;
  if (isDrowning) {
    player.healthRegenDelay = 2.4;
    player.healthFullDelay = 0.9;
    // ~15 HP/sec (~6.7s from full health to zero)
    player.health = Math.max(0, player.health - 15 * dt);
    player.drownTickTimer -= dt;
    if (player.drownTickTimer <= 0 && player.health > 0) {
      player.drownTickTimer = 0.85;
      player.damageFlashTimer = 0.24;
      player.damageFlashKind = 'drown';
      runtime.hurtFlash = 0.22;
      player.hurtAngVel = player.facing * 4.2;
      SFX.playDrownHurt();
      const cx = player.x + player.w * 0.5;
      const cy = player.y + player.h * 0.35;
      for (let i = 0; i < 3; i++) {
        spawnWaterBubble(cx + (Math.random() - 0.5) * 8, cy, (Math.random() - 0.5) * 18, -26, 0.72, activeLiquidCols);
      }
    }

    if (player.health <= 0) {
      triggerPlayerDeath('drown', false);
      return;
    }
  } else {
    player.drownTickTimer = 0;
    // Regenerate health smoothly once safely away from harmfuls, even while underwater with air remaining
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
    player.healthTrail > player.health + 0.25 ||
    player.healthFullDelay > 0 ||
    (player.submerged && player.breath <= 0.5)
  );
  if (player.health >= player.healthTrail) {
    player.healthTrail = player.health;
  } else if (player.damageFlashTimer <= 0.08) {
    const diff = player.healthTrail - player.health;
    player.healthTrail = Math.max(player.health, player.healthTrail - Math.max(20, diff * 5.0) * dt);
  }
  const targetHealthAlpha = showHealthHud ? 1 : 0;
  player.healthHudAlpha += (targetHealthAlpha - player.healthHudAlpha) * (1 - Math.exp(-10 * dt));
  if (player.healthHudAlpha < 0.005 && targetHealthAlpha === 0) player.healthHudAlpha = 0;
}
