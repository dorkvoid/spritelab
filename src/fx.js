import { SFX } from './audio.js';
import { STARTER_TILE_ID, TILE } from './constants.js';
import { dialogueBox, showToast } from './dom.js';
import { captureCurrentCharVisual, triggerBodyAnim } from './renderer.js';
import {
  getActiveWorld,
  getSpriteById,
  player,
  runtime,
  state,
  worldFX
} from './state.js';
import { savePrefsNow } from './storage.js';
import { renderSidebar } from './ui/sidebar.js';
import { updateTopUI } from './ui/topbar.js';
import { clamp } from './utils.js';
import {
  getMainTileInfo,
  getMainTileType,
  hideDialogue,
  openViewable,
  showDialogue,
  tileKey
} from './world.js';

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
    size,
    gravity,
    noDrag: Boolean(opts && opts.noDrag),
    streak: Boolean(opts && opts.streak),
    bubble: Boolean(opts && opts.bubble),
    phase: (opts && Number.isFinite(opts.phase)) ? opts.phase : (Math.random() * Math.PI * 2)
  });
}

export function spawnBurstParticles(x, y, color, count = 8, speed = 60) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
    const spd = speed * (0.45 + Math.random() * 0.65);
    spawnParticle(
      x + (Math.random() - 0.5) * 3,
      y + (Math.random() - 0.5) * 3,
      Math.cos(angle) * spd,
      Math.sin(angle) * spd - 14,
      0.22 + Math.random() * 0.22,
      color,
      Math.random() > 0.5 ? 2 : 1.5,
      150
    );
  }
}

export function spawnRunDust(x, y, moveDir, onSlip = false, isKick = false) {
  const count = isKick ? 4 : 2;
  const color = onSlip ? '#a9c8e8' : '#8a94a8';
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

export function spawnLandingDust(x, y, impact = 0.5, onSlip = false) {
  const count = Math.round(4 + impact * 6);
  const color = onSlip ? '#b4d6f5' : '#9aa4b8';
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

export function triggerTileAnim(layer, tx, ty, expectedMode) {
  const world = getActiveWorld();
  const key = tileKey(tx, ty);
  const id = world.layers[layer] && world.layers[layer][key];
  if (!id || id === STARTER_TILE_ID) return;
  const sp = getSpriteById(id);
  if (!sp || !sp._canvases || sp._canvases.length <= 1) return;
  if (sp.animMode !== expectedMode) return;
  const trigKey = `${layer}:${key}`;
  if (!worldFX.tileTriggers.has(trigKey)) {
    worldFX.tileTriggers.set(trigKey, { startTime: state.simTime });
  }
}

export function toggleActivatorSwitch(world, tx, ty) {
  const key = tileKey(tx, ty);
  const nextOn = !Boolean(runtime.activators.get(key));
  runtime.activators.set(key, nextOn);
  SFX.playSwitch(nextOn);
  spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, nextOn ? '#f28c38' : '#8b94a6', 7, 50);

  // Toggle all nearby ACTIVATOR (DOOR) tiles within a 12-tile radius
  for (const k in world.layers.main) {
    const id = world.layers.main[k];
    if (!id || id === STARTER_TILE_ID) continue;
    const sp = getSpriteById(id);
    if (!sp || sp.type !== 'ACTIVATOR' || sp.subType !== 'DOOR') continue;
    const comma = k.indexOf(',');
    if (comma === -1) continue;
    const dtx = parseInt(k.slice(0, comma), 10);
    const dty = parseInt(k.slice(comma + 1), 10);
    if (Math.hypot(dtx - tx, dty - ty) <= 12) {
      if (nextOn) runtime.doorsOpen.add(k);
      else runtime.doorsOpen.delete(k);
      spawnBurstParticles(dtx * TILE + TILE * 0.5, dty * TILE + TILE * 0.5, nextOn ? '#f6e4d2' : '#5d6575', 5, 38);
    }
  }
}

export function spawnWaterBubble(x, y, vx = 0, vy = -26, maxLife = 0.72) {
  spawnParticle(
    x,
    y,
    vx + (Math.random() - 0.5) * 10,
    vy - Math.random() * 14,
    maxLife * (0.75 + Math.random() * 0.5),
    Math.random() > 0.35 ? '#dff5ff' : '#8ed2f5',
    Math.random() > 0.45 ? 2 : 1.5,
    -34,
    { bubble: true, noDrag: false }
  );
}

export function spawnLiquidSplash(x, y, exiting = false, impact = 0.65, mode = 'surface') {
  const imp = clamp(impact, 0.3, 1.2);

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
      color: '#a8dcf8'
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
      isFoam ? '#eef9ff' : (i % 2 === 0 ? '#7ec3e8' : '#b2e1fa'),
      isFoam ? 1.5 : (Math.random() > 0.5 ? 2 : 1.5),
      235,
      { noDrag: true }
    );
  }

  // On plunge/underwater entry, pull a few light bubbles inside the water to drift upward
  if (!exiting) {
    const bCount = Math.round(2 + imp * 2);
    const bubbleBaseY = isBottom ? (y - 5) : (y + 3);
    for (let i = 0; i < bCount; i++) {
      spawnWaterBubble(
        x + (Math.random() - 0.5) * 9,
        bubbleBaseY + (isBottom ? -Math.random() * 5 : Math.random() * (5 + imp * 4)),
        (Math.random() - 0.5) * 14,
        -(12 + Math.random() * 14),
        0.48 + Math.random() * 0.35
      );
    }
  }
}

export function teleportFromPortal(world, srcTx, srcTy, portalId) {
  const portals = [];
  for (const k in world.layers.main) {
    if (world.layers.main[k] === portalId) {
      const comma = k.indexOf(',');
      portals.push({ tx: parseInt(k.slice(0, comma), 10), ty: parseInt(k.slice(comma + 1), 10) });
    }
  }
  if (portals.length < 2) {
    showToast('PLACE 2+ PORTALS TO LINK');
    return false;
  }
  portals.sort((a, b) => (a.tx - b.tx) || (a.ty - b.ty));
  const idx = portals.findIndex(p => p.tx === srcTx && p.ty === srcTy);
  const dest = portals[(idx + 1) % portals.length];
  spawnBurstParticles(player.x + player.w * 0.5, player.y + player.h * 0.5, '#f28c38', 10, 62);
  player.x = dest.tx * TILE;
  player.y = dest.ty * TILE;
  player.prevX = player.x;
  player.prevY = player.y;
  player.vx *= 0.35;
  player.vy = 0;
  runtime.teleportCd = 0.65;
  SFX.playPortal();
  spawnBurstParticles(player.x + player.w * 0.5, player.y + player.h * 0.5, '#f5e2cf', 12, 74);
  worldFX.interactRings.push({ x: player.x + player.w * 0.5, y: player.y + player.h * 0.5, timer: 0, maxTimer: 0.3 });
  return true;
}

export function interactNearby() {
  // If dialogue box is open, Space dismisses it cleanly
  if (dialogueBox.classList.contains('show')) {
    hideDialogue();
    return;
  }

  const world = getActiveWorld();
  player.actTimer = 0.26;
  const cx = player.x + player.w * 0.5;
  const cy = player.y + player.h * 0.5;
  worldFX.interactRings.push({ x: cx, y: cy, timer: 0, maxTimer: 0.28 });

  // Dismount if currently riding a MOUNTABLE
  if (runtime.mount) {
    spawnBurstParticles(cx, cy, '#f5e2cf', 6, 42);
    runtime.mount = null;
    player.vy = -110;
    showToast('DISMOUNTED');
    return;
  }

  // Use equipped HOLDABLE
  if (state.equippedHoldableId) {
    const holdSp = getSpriteById(state.equippedHoldableId);
    if (holdSp && holdSp.type === 'HOLDABLE') {
      runtime.holdSwingTimer = 0.22;
      if (holdSp.subType === 'EMITTER') {
        SFX.playEmit();
        runtime.projectiles.push({
          x: cx + player.facing * 10,
          y: cy - 1,
          vx: player.facing * 210,
          vy: -24,
          life: 1.4,
          color: '#f28c38',
          bounces: 2
        });
      }
    }
  }

  const ptx = Math.floor(cx / TILE);
  const pty = Math.floor(cy / TILE);

  // Trigger INTERACT animation tiles around player
  for (const layer of ['bg', 'main', 'fg']) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        triggerTileAnim(layer, ptx + dx, pty + dy, 'INTERACT');
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
      if (runtime.teleportCd <= 0 && teleportFromPortal(world, tx, ty, sp.id)) return;
    } else if (sp.type === 'ACTIVATOR' && sp.subType === 'SWITCH') {
      toggleActivatorSwitch(world, tx, ty);
      return;
    } else if (sp.type === 'MOUNTABLE') {
      runtime.mount = { tx, ty, id: sp.id, subType: sp.subType || 'GROUND' };
      player.x = tx * TILE;
      player.y = ty * TILE;
      player.vy = 0;
      spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, '#f28c38', 8, 52);
      showToast('MOUNTED ' + sp.name);
      return;
    } else if (sp.type === 'TEXTUAL') {
      showDialogue(sp.name, sp.customText || sp.name, tx, ty);
      return;
    } else if (sp.type === 'VIEWABLE') {
      openViewable(sp);
      return;
    } else if (sp.type === 'INTERACTING') {
      const count = Math.max(2, sp._canvases.length);
      const cur = runtime.interactFrames.get(info.key) || 0;
      const next = sp.subType === 'CYCLE' ? ((cur + 1) % count) : (cur === 0 ? 1 : 0);
      runtime.interactFrames.set(info.key, next);
      spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, '#f28c38', 5, 40);
      return;
    } else if (sp.type === 'BODY') {
      const prevVis = captureCurrentCharVisual();
      if (sp.subType === 'MOTION') {
        const turningOn = state.activeMotionId !== sp.id;
        state.activeMotionId = turningOn ? sp.id : null;
        triggerBodyAnim(turningOn ? 'equip' : 'unequip', prevVis);
        showToast(state.activeMotionId ? 'MOTION: ' + sp.name : 'MOTION STOPPED');
      } else {
        const kind = state.equippedBodyId ? 'swap' : 'equip';
        state.equippedBodyId = sp.id;
        state.activeMotionId = null;
        triggerBodyAnim(kind, prevVis);
        savePrefsNow();
        showToast('EQUIPPED ' + sp.name);
      }
      spawnBurstParticles(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, '#f28c38', 8, 52);
      updateTopUI();
      renderSidebar();
      return;
    }
  }
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
