import { SFX } from './audio.js';
import { STARTER_TILE_ID, SURFACE_PARTICLE_COLORS, TILE } from './constants.js';
import { dialogueBox, showToast } from './dom.js';
import { emitWorldEvent } from './events.js';
import { triggerBodyAnim } from './renderer.js';
import {
  getActiveWorld,
  getSpriteById,
  keys,
  player,
  pointer,
  runtime,
  state,
  worldFX
} from './state.js';
import { savePrefsNow } from './storage.js';
import { renderSidebar } from './ui/sidebar.js';
import { updateTopUI } from './ui/topbar.js';
import { clamp, getTileFxColors, orientToTransform, transformOrientVec } from './utils.js';
import {
  findNearbySeat,
  getMainTileInfo,
  getMainTileType,
  getTileOrient,
  hideDialogue,
  isFullSolidAt,
  openViewable,
  resolveTransformingBigCell,
  screenToWorld,
  showDialogue,
  tileKey
} from './world.js';

function surfaceDustColor(matOrSlip, blockColor = null, fallback = '#8a94a8') {
  if (blockColor) return blockColor;
  if (typeof matOrSlip === 'boolean') return matOrSlip ? '#b4d6f5' : fallback;
  return (matOrSlip && SURFACE_PARTICLE_COLORS[matOrSlip]) || fallback;
}

/* =========================================================================
   PARTICLE & TILE ANIMATION FX HELPERS
   ========================================================================= */
export function spawnParticle(x, y, vx, vy, maxLife, color, size = 1.5, gravity = 180, opts = null) {
  if (worldFX.particles.length > 420) {
    worldFX.particles.shift();
  }
  worldFX.particles.push({
    x,
    y,
    vx,
    vy,
    life: maxLife,
    maxLife,
    color,
    highlight: (opts && opts.highlight) || null,
    size,
    gravity,
    noDrag: Boolean(opts && opts.noDrag),
    streak: Boolean(opts && opts.streak),
    bubble: Boolean(opts && opts.bubble),
    zzz: Boolean(opts && opts.zzz),
    phase: (opts && Number.isFinite(opts.phase)) ? opts.phase : (Math.random() * Math.PI * 2)
  });
}

export function spawnBurstParticles(x, y, color, count = 8, speed = 60, secondaryColor = null) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
    const spd = speed * (0.45 + Math.random() * 0.65);
    const col = (secondaryColor && (i % 3 === 1)) ? secondaryColor : color;
    spawnParticle(
      x + (Math.random() - 0.5) * 3,
      y + (Math.random() - 0.5) * 3,
      Math.cos(angle) * spd,
      Math.sin(angle) * spd - 14,
      0.22 + Math.random() * 0.22,
      col,
      Math.random() > 0.5 ? 2 : 1.5,
      150
    );
  }
}

export function spawnRunDust(x, y, moveDir, surfaceSound = 'DEFAULT', isKick = false, blockColor = null) {
  const count = isKick ? 4 : 2;
  const color = surfaceDustColor(surfaceSound, blockColor, '#8a94a8');
  const dir = moveDir || 1;
  for (let i = 0; i < count; i++) {
    spawnParticle(
      x + (Math.random() - 0.5) * 4,
      y - 1 - Math.random() * 2,
      -dir * (14 + Math.random() * (isKick ? 32 : 20)) + (Math.random() - 0.5) * 10,
      -(12 + Math.random() * (isKick ? 26 : 16)),
      0.18 + Math.random() * 0.16,
      color,
      Math.random() > 0.45 ? 2 : 1,
      85
    );
  }
}

export function spawnLandingDust(x, y, impact = 0.5, surfaceSound = 'DEFAULT', blockColor = null) {
  const count = Math.round(4 + impact * 6);
  const color = surfaceDustColor(surfaceSound, blockColor, '#9aa4b8');
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = 18 + Math.random() * (34 + impact * 28);
    spawnParticle(
      x + side * (2 + Math.random() * 4),
      y - 1,
      side * spread,
      -(14 + Math.random() * (26 + impact * 18)),
      0.22 + Math.random() * 0.2,
      color,
      Math.random() > 0.4 ? 2 : 1.5,
      140
    );
  }
}

/* Grant an item attached to a TRANSFORMING Big Thing (HOLDABLE or WEARABLE) */
export function grantBigThingReward(sp, layer, key, tx, ty, fromInteract = false) {
  if (!sp || sp.type !== 'BIG_THING' || sp.subType !== 'TRANSFORMING') return false;
  const giveId = sp.bigOpts && sp.bigOpts.giveItemId;
  if (!giveId) return false;
  const rewardSp = getSpriteById(giveId);
  if (!rewardSp || (rewardSp.type !== 'HOLDABLE' && rewardSp.type !== 'WEARABLE')) return false;

  const info = resolveTransformingBigCell(sp, layer, key);
  const len = (sp._canvases && sp._canvases.length) || 1;
  const isRewardCell = len <= 1 || info.cellIdx === len - 1;
  if (!fromInteract && !isRewardCell) return false;
  if (!fromInteract && info.entry && info.entry.grantedCycle === info.cycleNum) return false;

  const alreadyEquipped = rewardSp.type === 'HOLDABLE'
    ? state.equippedHoldableId === rewardSp.id
    : state.equippedWearableId === rewardSp.id;
  if (!fromInteract && alreadyEquipped) {
    if (info.entry) info.entry.grantedCycle = info.cycleNum;
    return false;
  }

  if (rewardSp.type === 'HOLDABLE') {
    state.equippedHoldableId = rewardSp.id;
    triggerBodyAnim('equip', null, 'hold');
  } else {
    state.equippedWearableId = rewardSp.id;
    triggerBodyAnim('equip', null, 'wear');
  }
  if (info.entry) info.entry.grantedCycle = info.cycleNum;

  const fxCols = getTileFxColors(rewardSp, '#f28c38');
  spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE, fxCols.bright, 10, 58, fxCols.main);
  SFX.playCollect();
  savePrefsNow();
  updateTopUI();
  renderSidebar();
  showToast('RECEIVED ' + rewardSp.name);
  return true;
}

export function unequipHeldItem() {
  if (!state.equippedHoldableId) return false;
  const holdSp = getSpriteById(state.equippedHoldableId);
  state.equippedHoldableId = null;
  runtime.swingLine = null;
  runtime.holdSwingTimer = 0;
  triggerBodyAnim('unequip', null, 'hold');
  savePrefsNow();
  updateTopUI();
  renderSidebar();
  showToast(holdSp ? ('STOWED ' + holdSp.name) : 'STOWED ITEM');
  return true;
}

export function engageSeat(seat) {
  if (!seat) return false;
  const flipSeat = orientToTransform(seat.orient || 0).flip;
  const seatFacing = seat.orient ? (flipSeat ? -1 : 1) : player.facing;
  const seatSp = seat.id && seat.id !== STARTER_TILE_ID ? getSpriteById(seat.id) : null;
  const seatFx = getTileFxColors(seatSp || seat.id, '#f6e4d2');
  runtime.seated = {
    tx: seat.tx,
    ty: seat.ty,
    layer: seat.layer,
    key: seat.key,
    id: seat.id,
    mode: seat.mode,
    facing: seatFacing,
    solidTop: seat.solidTop
  };
  runtime.swingLine = null;
  runtime.mount = null;
  player.x = seat.seatX;
  player.y = seat.seatY;
  player.prevX = player.x;
  player.prevY = player.y;
  player.vx = 0;
  player.vy = 0;
  player.facing = seatFacing;
  player.grounded = true;
  player.climbing = false;
  player.sitting = seat.mode === 'SIT';
  player.laying = seat.mode === 'LAY';
  player.sleepZTimer = 0.6;
  player.scaleX = 1.14;
  player.scaleY = 0.86;
  SFX.playSit(seat.mode === 'LAY');
  spawnBurstParticles(player.x + player.w * 0.5, player.y + player.h * 0.75, seatFx.light, 5, 34, seatFx.main);
  return true;
}

export function releaseSeat(withHop = false) {
  if (!runtime.seated) return false;
  runtime.seated = null;
  runtime.seatCd = 0.35;
  runtime.seatNeedsDownRelease = Boolean(keys.down);
  player.sitting = false;
  player.laying = false;
  player.scaleX = 0.90;
  player.scaleY = 1.12;
  if (withHop) {
    player.vy = -85;
    player.grounded = false;
  }
  return true;
}

export function triggerTileAnim(layer, tx, ty, expectedMode) {
  const world = getActiveWorld();
  const key = tileKey(tx, ty);
  const id = world.layers[layer] && world.layers[layer][key];
  if (!id || id === STARTER_TILE_ID) return false;
  const sp = getSpriteById(id);
  if (!sp || !sp._canvases || sp._canvases.length <= 1) return false;
  if (sp.animMode !== expectedMode) return false;
  const trigKey = `${layer}:${key}`;
  if (!worldFX.tileTriggers.has(trigKey)) {
    worldFX.tileTriggers.set(trigKey, { startTime: state.simTime });
  }
  return true;
}

export function toggleActivatorSwitch(world, tx, ty) {
  const key = tileKey(tx, ty);
  const swInfo = getMainTileInfo(world, tx, ty);
  const actOpts = swInfo && swInfo.sp && swInfo.sp.actOpts;
  const mode = (actOpts && actOpts.switchMode) || 'TOGGLE';
  let nextOn;
  if (mode === 'TIMED') {
    nextOn = true;
    runtime.activators.set(key, true);
    runtime.switchTimers.set(key, Math.max(0.5, Number(actOpts.duration) || 3));
  } else if (mode === 'PULSE') {
    nextOn = true;
    runtime.activators.set(key, true);
    runtime.switchTimers.set(key, 0.35);
  } else {
    nextOn = !Boolean(runtime.activators.get(key));
    runtime.activators.set(key, nextOn);
    runtime.switchTimers.delete(key);
  }
  SFX.playSwitch(nextOn);
  const swFx = getTileFxColors(swInfo, nextOn ? '#f28c38' : '#8b94a6');
  spawnBurstParticles(
    tx * TILE + TILE * 0.5,
    ty * TILE + TILE * 0.5,
    nextOn ? swFx.light : swFx.main,
    7,
    50,
    swFx.secondary
  );

  // If this switch has explicit wires in world.wires, let the wire network drive ONLY its wired targets
  const hasExplicitWires = Array.isArray(world.wires) && world.wires.some(w => w.from === key);
  if (hasExplicitWires) return;

  const wiredTargets = new Set();
  if (Array.isArray(world.wires)) {
    for (let i = 0; i < world.wires.length; i++) wiredTargets.add(world.wires[i].to);
  }

  // Legacy unwired switch fallback: toggle nearby unwired DOOR & CHANGE tiles within 14 tiles
  for (const k in world.layers.main) {
    if (wiredTargets.has(k)) continue;
    const id = world.layers.main[k];
    if (!id || id === STARTER_TILE_ID) continue;
    const sp = getSpriteById(id);
    if (!sp || sp.type !== 'ACTIVATOR') continue;
    if (sp.subType !== 'DOOR' && sp.subType !== 'CHANGE') continue;
    const comma = k.indexOf(',');
    if (comma === -1) continue;
    const dtx = parseInt(k.slice(0, comma), 10);
    const dty = parseInt(k.slice(comma + 1), 10);
    if (Math.hypot(dtx - tx, dty - ty) <= 14) {
      if (sp.subType === 'DOOR') {
        if (nextOn) runtime.doorsOpen.add(k);
        else runtime.doorsOpen.delete(k);
      } else {
        if (nextOn) runtime.activatedTiles.add(k);
        else runtime.activatedTiles.delete(k);
      }
      const dFx = getTileFxColors(sp, nextOn ? '#f6e4d2' : '#5d6575');
      spawnBurstParticles(
        dtx * TILE + TILE * 0.5,
        dty * TILE + TILE * 0.5,
        nextOn ? dFx.light : dFx.main,
        5,
        38,
        dFx.secondary
      );
    }
  }
}

export function spawnWaterBubble(x, y, vx = 0, vy = -26, maxLife = 0.72, liquidCols = null) {
  const baseCol = liquidCols ? liquidCols.main : '#7ec3e8';
  const lightCol = liquidCols ? liquidCols.light : '#8ed2f5';
  const hiCol = liquidCols ? liquidCols.bright : '#eef9ff';
  spawnParticle(
    x,
    y,
    vx + (Math.random() - 0.5) * 10,
    vy - Math.random() * 14,
    maxLife * (0.75 + Math.random() * 0.5),
    Math.random() > 0.4 ? lightCol : baseCol,
    Math.random() > 0.45 ? 2 : 1.5,
    -34,
    { bubble: true, noDrag: false, highlight: hiCol }
  );
}

export function spawnLiquidSplash(x, y, exiting = false, impact = 0.65, mode = 'surface', liquidCols = null) {
  const imp = clamp(impact, 0.3, 1.2);
  const baseCol = liquidCols ? liquidCols.main : '#7ec3e8';
  const lightCol = liquidCols ? liquidCols.light : '#b2e1fa';
  const brightCol = liquidCols ? liquidCols.bright : '#eef9ff';

  // Only emit top waterline wave ripples & splash crowns when actually breaking the top surface
  if (mode === 'surface') {
    if (worldFX.waterRipples.length >= 16) worldFX.waterRipples.shift();
    worldFX.waterRipples.push({
      x,
      y,
      timer: 0,
      maxTimer: exiting ? (0.30 + imp * 0.12) : (0.36 + imp * 0.16),
      maxRx: exiting ? (9 + imp * 8) : (11 + imp * 11),
      crownH: exiting ? (4 + imp * 3.5) : (6 + imp * 5.5),
      color: baseCol,
      waveColor: lightCol,
      crownColor: brightCol
    });
  }

  // Lightweight crisp pixel splash droplets oriented to the actual entry/exit surface
  const isBottom = mode === 'bottom';
  const isSide = mode === 'side';
  const dropCount = isBottom || isSide
    ? Math.round(4 + imp * 3)
    : Math.round((exiting ? 6 : 8) + imp * (exiting ? 3 : 4));

  for (let i = 0; i < dropCount; i++) {
    const side = (i / Math.max(1, dropCount - 1)) * 2 - 1;
    const isFoam = i % 3 === 0;
    let spreadX;
    let launchY;
    let spawnY = y;

    if (isBottom) {
      spreadX = side * (22 + imp * 26) + (Math.random() - 0.5) * 12;
      launchY = (exiting ? 18 : 6) + Math.random() * (24 + imp * 18);
      spawnY = y + Math.random() * 2;
    } else if (isSide) {
      spreadX = side * (16 + imp * 22) + (Math.random() - 0.5) * 10;
      launchY = -(12 + Math.random() * 24);
      spawnY = y + (Math.random() - 0.5) * 6;
    } else {
      spreadX = side * (20 + imp * 36) + (Math.random() - 0.5) * 14;
      const centerLift = 1 - Math.abs(side) * 0.38;
      launchY = -((exiting ? 42 : 50) + imp * (exiting ? 38 : 50)) * centerLift * (0.72 + Math.random() * 0.4);
      spawnY = y - Math.random() * 2;
    }

    spawnParticle(
      x + side * (3 + Math.random() * 3),
      spawnY,
      spreadX,
      launchY,
      0.24 + Math.random() * (0.18 + imp * 0.1),
      isFoam ? brightCol : (i % 2 === 0 ? baseCol : lightCol),
      isFoam ? 1.5 : (Math.random() > 0.5 ? 2 : 1.5),
      235,
      { noDrag: true }
    );
  }

  // On plunge/underwater entry, pull a few light bubbles inside the liquid to drift upward
  if (!exiting) {
    const bCount = Math.round(2 + imp * 2);
    const bubbleBaseY = isBottom ? (y - 5) : (y + 3);
    for (let i = 0; i < bCount; i++) {
      spawnWaterBubble(
        x + (Math.random() - 0.5) * 9,
        bubbleBaseY + (isBottom ? -Math.random() * 5 : Math.random() * (5 + imp * 4)),
        (Math.random() - 0.5) * 14,
        -(12 + Math.random() * 14),
        0.48 + Math.random() * 0.35,
        liquidCols
      );
    }
  }
}

export function teleportFromPortal(world, srcTx, srcTy, portalId, subType = 'PORTAL') {
  const portals = [];
  for (const k in world.layers.main) {
    if (world.layers.main[k] === portalId) {
      const comma = k.indexOf(',');
      portals.push({
        key: k,
        tx: parseInt(k.slice(0, comma), 10),
        ty: parseInt(k.slice(comma + 1), 10)
      });
    }
  }
  if (portals.length < 2) {
    SFX.playError();
    showToast('PLACE 2+ PORTALS TO LINK');
    return false;
  }

  // Manyland canonical rule: prefer the nearest linked portal within 25 tiles; fall back to cycling all linked portals
  const others = portals.filter(p => !(p.tx === srcTx && p.ty === srcTy));
  let dest = null;
  let bestDist = Infinity;
  for (let i = 0; i < others.length; i++) {
    const d = Math.hypot(others[i].tx - srcTx, others[i].ty - srcTy);
    if (d <= 25 && d < bestDist) {
      bestDist = d;
      dest = others[i];
    }
  }
  if (!dest) {
    portals.sort((a, b) => (a.tx - b.tx) || (a.ty - b.ty));
    const idx = portals.findIndex(p => p.tx === srcTx && p.ty === srcTy);
    dest = portals[(idx + 1) % portals.length];
  }

  const portalSp = getSpriteById(portalId);
  const pFx = getTileFxColors(portalSp, '#f28c38');
  spawnBurstParticles(player.x + player.w * 0.5, player.y + player.h * 0.5, pFx.main, 10, 62, pFx.light);
  player.x = dest.tx * TILE;
  player.y = dest.ty * TILE;
  player.prevX = player.x;
  player.prevY = player.y;
  runtime.swingLine = null;

  if (subType === 'DIRECTIONAL') {
    const destOrient = getTileOrient(world, 'main', dest.key);
    const launch = transformOrientVec(0, -1, destOrient);
    player.vx = launch.x * 245;
    player.vy = launch.y !== 0 ? launch.y * 245 : -68;
    player.grounded = false;
    player.scaleX = launch.y !== 0 ? 0.82 : 1.22;
    player.scaleY = launch.y !== 0 ? 1.22 : 0.82;
  } else {
    player.vx *= 0.35;
    player.vy = 0;
  }

  runtime.teleportCd = 0.65;
  SFX.playPortal();
  spawnBurstParticles(player.x + player.w * 0.5, player.y + player.h * 0.5, pFx.light, 12, 74, pFx.main);
  worldFX.interactRings.push({ x: player.x + player.w * 0.5, y: player.y + player.h * 0.5, timer: 0, maxTimer: 0.3 });
  return true;
}

function getHoldableAimUnit(cx, cy) {
  if (pointer.inWorld) {
    const wp = screenToWorld(pointer.screenX, pointer.screenY);
    const dx = wp.wx - cx;
    const dy = wp.wy - cy;
    const len = Math.hypot(dx, dy);
    if (len > 2) return { x: dx / len, y: dy / len };
  }
  return { x: player.facing, y: -0.1 };
}

function tryLatchSwingLine(world, cx, cy) {
  let aim = getHoldableAimUnit(cx, cy);
  if (!pointer.inWorld || aim.y > 0.25) {
    aim = { x: player.facing * 0.64, y: -0.77 };
    const norm = Math.hypot(aim.x, aim.y);
    aim.x /= norm;
    aim.y /= norm;
  }
  const maxDist = TILE * 8.5;
  const step = 3.5;
  for (let d = TILE * 0.8; d <= maxDist; d += step) {
    const rx = cx + aim.x * d;
    const ry = cy + aim.y * d;
    const tx = Math.floor(rx / TILE);
    const ty = Math.floor(ry / TILE);
    if (isFullSolidAt(world, tx, ty)) {
      const hitFx = getTileFxColors(getMainTileInfo(world, tx, ty), '#f5e2cf');
      runtime.swingLine = {
        ax: rx,
        ay: ry,
        tx,
        ty,
        len: clamp(d, TILE * 1.4, maxDist)
      };
      player.grounded = false;
      player.climbing = false;
      player.sitting = false;
      player.laying = false;
      SFX.playEmit();
      spawnBurstParticles(rx, ry, hitFx.light, 7, 48, hitFx.main);
      return true;
    }
  }
  return false;
}

export function interactNearby() {
  // If dialogue box is open, Space dismisses it cleanly
  if (dialogueBox.classList.contains('show')) {
    hideDialogue();
    return;
  }

  const world = getActiveWorld();
  const cx = player.x + player.w * 0.5;
  const cy = player.y + player.h * 0.5;
  const emitInteractPulse = () => {
    player.actTimer = 0.26;
    worldFX.interactRings.push({ x: cx, y: cy, timer: 0, maxTimer: 0.28 });
  };

  // Stand up cleanly if currently sitting or laying on furniture
  if (runtime.seated) {
    releaseSeat(false);
    return;
  }

  // Release active SWING LINE grapple on Space
  if (runtime.swingLine) {
    const swFx = getTileFxColors(getMainTileInfo(world, runtime.swingLine.tx, runtime.swingLine.ty), '#f28c38');
    spawnBurstParticles(runtime.swingLine.ax, runtime.swingLine.ay, swFx.light, 6, 40, swFx.main);
    runtime.swingLine = null;
    player.vy = Math.min(player.vy, -125);
    SFX.playJump(false);
    return;
  }

  // Dismount if currently riding a MOUNTABLE
  if (runtime.mount) {
    const mSp = getSpriteById(runtime.mount.id);
    const mFx = getTileFxColors(mSp, '#f5e2cf');
    spawnBurstParticles(cx, cy, mFx.light, 6, 42, mFx.main);
    runtime.mount = null;
    player.vy = -110;
    showToast('DISMOUNTED');
    return;
  }

  // Active equipped HOLDABLE actions (EMITTER, AIMABLE, CONSUMABLE, SWING LINE)
  let swingMissed = false;
  const holdSp = state.equippedHoldableId ? getSpriteById(state.equippedHoldableId) : null;
  if (holdSp && holdSp.type === 'HOLDABLE') {
    const hFx = getTileFxColors(holdSp, '#f28c38');
    if (holdSp.subType === 'EMITTER') {
      runtime.holdSwingTimer = 0.22;
      player.actTimer = 0.22;
      SFX.playEmit();
      runtime.projectiles.push({
        x: cx + player.facing * 10,
        y: cy - 1,
        vx: player.facing * 210,
        vy: -24,
        life: 1.4,
        color: hFx.main,
        bounces: 2
      });
      return;
    }
    if (holdSp.subType === 'AIMABLE') {
      const aim = getHoldableAimUnit(cx, cy);
      if (Math.abs(aim.x) > 0.15) player.facing = aim.x >= 0 ? 1 : -1;
      runtime.holdSwingTimer = 0.22;
      player.actTimer = 0.22;
      SFX.playEmit();
      runtime.projectiles.push({
        x: cx + aim.x * 11,
        y: cy + aim.y * 11,
        vx: aim.x * 240,
        vy: aim.y * 240,
        life: 1.5,
        color: hFx.main,
        bounces: 1
      });
      return;
    }
    if (holdSp.subType === 'CONSUMABLE') {
      if (runtime.consumeCd <= 0) {
        runtime.holdSwingTimer = 0.22;
        player.actTimer = 0.22;
        runtime.consumeCd = 0.55;
        const prevHp = player.health;
        const prevBr = player.breath;
        player.health = Math.min(player.maxHealth, player.health + 30);
        player.breath = Math.min(player.maxBreath, player.breath + 4);
        if (player.health > prevHp) player.healthFullDelay = 0.9;
        if (player.breath > prevBr) player.breathFullDelay = 0.7;
        player.scaleX = 1.15;
        player.scaleY = 0.88;
        SFX.playCollect();
        spawnBurstParticles(cx + player.facing * 4, cy - 3, hFx.main, 9, 52, hFx.light);
        showToast('CONSUMED ' + holdSp.name);
      }
      return;
    }
    if (holdSp.subType === 'SWING LINE') {
      if (tryLatchSwingLine(world, cx, cy)) {
        runtime.holdSwingTimer = 0.22;
        player.actTimer = 0.22;
        return;
      }
      swingMissed = true;
    }
  }

  const ptx = Math.floor(cx / TILE);
  const pty = Math.floor(cy / TILE);

  // Trigger INTERACT animation tiles around player (track whether any tile actually reacted)
  let triggeredAnim = false;
  for (const layer of ['bg', 'main', 'fg']) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (triggerTileAnim(layer, ptx + dx, pty + dy, 'INTERACT')) {
          triggeredAnim = true;
        }
      }
    }
  }

  // Check nearby SITTABLE / LAYABLE furniture (chairs, couches, toilets, beds) before generic props
  const nearSeat = findNearbySeat(world);
  if (nearSeat) {
    emitInteractPulse();
    engageSeat(nearSeat);
    return;
  }

  // Check overlapping TRANSFORMING Big Things that grant a Holdable or Wearable item
  for (const layer of ['bg', 'fg']) {
    const map = world.layers[layer];
    if (!map) continue;
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = ptx + dx;
        const ty = pty + dy;
        const key = tileKey(tx, ty);
        const id = map[key];
        if (!id || id === STARTER_TILE_ID) continue;
        const sp = getSpriteById(id);
        if (!sp || sp.type !== 'BIG_THING' || sp.subType !== 'TRANSFORMING') continue;
        if (!(sp.bigOpts && sp.bigOpts.giveItemId)) continue;
        const dw = TILE * 2;
        const dh = TILE * 2;
        const bx = tx * TILE - (dw - TILE) * 0.5;
        const by = ty * TILE - (dh - TILE);
        if (player.x + player.w > bx && player.x < bx + dw && player.y + player.h > by && player.y < by + dh) {
          if (grantBigThingReward(sp, layer, key, tx, ty, true)) {
            emitInteractPulse();
            return;
          }
        }
      }
    }
  }

  // Search nearby interactive Manyland objects (closest first)
  const candidates = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = ptx + dx;
      const ty = pty + dy;
      const info = getMainTileInfo(world, tx, ty);
      if (!info || !info.sp) continue;
      const dist = Math.hypot((tx + 0.5) * TILE - cx, (ty + 0.5) * TILE - cy);
      candidates.push({ tx, ty, info, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  for (const c of candidates) {
    const { tx, ty, info } = c;
    const sp = info.sp;

    if (sp.type === 'TRANSPORTING') {
      if (runtime.teleportCd <= 0 && teleportFromPortal(world, tx, ty, sp.id, sp.subType)) {
        player.actTimer = 0.26;
        return;
      }
    } else if (sp.type === 'ACTIVATOR' && sp.subType === 'SWITCH') {
      emitInteractPulse();
      toggleActivatorSwitch(world, tx, ty);
      return;
    } else if (sp.type === 'MOUNTABLE') {
      const mFx = getTileFxColors(sp, '#f28c38');
      emitInteractPulse();
      runtime.mount = { tx, ty, id: sp.id, subType: sp.subType || 'GROUND' };
      player.x = tx * TILE;
      player.y = ty * TILE;
      player.vy = 0;
      spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, mFx.main, 8, 52, mFx.light);
      showToast('MOUNTED ' + sp.name);
      return;
    } else if (sp.type === 'TEXTUAL') {
      emitInteractPulse();
      showDialogue(sp.name, sp.customText || sp.name, tx, ty);
      return;
    } else if (sp.type === 'VIEWABLE') {
      emitInteractPulse();
      openViewable(sp);
      return;
    } else if (sp.type === 'INTERACTING') {
      const iFx = getTileFxColors(sp, '#f28c38');
      emitInteractPulse();
      const count = Math.max(2, sp._canvases.length);
      const cur = runtime.interactFrames.get(info.key) || 0;
      const next = sp.subType === 'CYCLE' ? ((cur + 1) % count) : (cur === 0 ? 1 : 0);
      runtime.interactFrames.set(info.key, next);
      spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, iFx.main, 5, 40, iFx.light);
      return;
    }
  }

  if (triggeredAnim) {
    emitInteractPulse();
    return;
  }

  // Trigger ACTION state marker on an equipped ACTIONABLE companion Dynamic
  if (state.equippedDynamicId && runtime.companionDyn) {
    const dynSp = getSpriteById(state.equippedDynamicId);
    if (dynSp && dynSp.type === 'DYNAMIC' && dynSp.dynamicOpts && dynSp.dynamicOpts.actionable) {
      runtime.companionDyn.actionTimer = 1.1;
      runtime.companionDyn.marker = 'ACTION';
      runtime.companionDyn.markerStart = state.simTime;
      runtime.companionDyn.lastSoundKey = null;
      runtime.companionDyn.lastSayKey = null;
      emitInteractPulse();
      SFX.playEmit();
      emitWorldEvent('player:dynamic-action', { spriteId: dynSp.id, name: dynSp.name });
      return;
    }
  }

  // Passive equipped HOLDABLE (ITEM / LIGHT): gentle hand swing when used in open space
  if (holdSp && holdSp.type === 'HOLDABLE' && (holdSp.subType === 'ITEM' || holdSp.subType === 'LIGHT')) {
    runtime.holdSwingTimer = 0.22;
    player.actTimer = 0.22;
  } else if (swingMissed) {
    SFX.playError();
  }
  // Otherwise: nothing equipped & no interactive object nearby -> do nothing at all
}

export function updateWorldFX(dt) {
  const world = getActiveWorld();
  for (let i = worldFX.particles.length - 1; i >= 0; i--) {
    const p = worldFX.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      worldFX.particles.splice(i, 1);
      continue;
    }
    if (p.bubble) {
      p.vy = Math.max(-52, p.vy + p.gravity * dt);
      p.vx *= Math.exp(-3.2 * dt);
      p.x += (p.vx + Math.sin(state.simTime * 10 + p.phase) * 10) * dt;
      p.y += p.vy * dt;
      // Pop underwater bubbles cleanly when they reach open air above the liquid
      const bTx = Math.floor(p.x / TILE);
      const bTy = Math.floor(p.y / TILE);
      if (getMainTileType(world, bTx, bTy) !== 'LIQUID') {
        worldFX.particles.splice(i, 1);
        continue;
      }
    } else {
      p.vy += p.gravity * dt;
      if (!p.noDrag) p.vx *= Math.exp(-3.5 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  for (let i = worldFX.waterRipples.length - 1; i >= 0; i--) {
    const r = worldFX.waterRipples[i];
    r.timer += dt;
    if (r.timer >= r.maxTimer) {
      worldFX.waterRipples.splice(i, 1);
    }
  }

  for (let i = worldFX.interactRings.length - 1; i >= 0; i--) {
    const r = worldFX.interactRings[i];
    r.timer += dt;
    if (r.timer >= r.maxTimer) {
      worldFX.interactRings.splice(i, 1);
    }
  }

  for (const [k, rem] of worldFX.bounceTimers.entries()) {
    const next = rem - dt;
    if (next <= 0) worldFX.bounceTimers.delete(k);
    else worldFX.bounceTimers.set(k, next);
  }
}
