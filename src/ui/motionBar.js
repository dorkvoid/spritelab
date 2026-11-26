import { SFX } from '../audio.js';
import {
  defaultMotionOpts,
  isMotionBarEligible,
  MOTION_BAR_SLOTS,
  sanitizeMotionOpts,
  TILE
} from '../constants.js';
import {
  isAnyModalOpen,
  motionBar,
  motionBarBodyName,
  motionBarCloseBtn,
  motionBarSlots,
  motionPickerList,
  motionPickerPop,
  showToast
} from '../dom.js';
import { emitWorldEvent, onWorldEvent } from '../events.js';
import { spawnBurstParticles, spawnParticle } from '../fx.js';
import { captureCurrentCharVisual, triggerBodyAnim } from '../renderer.js';
import { getSpriteById, keys, player, runtime, state } from '../state.js';
import { savePrefsNow } from '../storage.js';
import { clamp, getTileFxColors } from '../utils.js';

let pickerSlotIdx = -1;

/* =========================================================================
   PER-BODY MOTION BAR & ENHANCED BODY MOTION PLAYBACK
   Press Down/S while idle on ground to open, Left/Right to pick slot,
   Space/Enter or 1-8 to trigger, Up/W/Esc to exit.
   Stores eligible Body Motions & Attachable/Follows Dynamics per Body.
   ========================================================================= */
export function getActiveBodyBarKey() {
  return state.equippedBodyId || '__wireframe__';
}

export function getBodyMotionSlots(bodyKey = getActiveBodyBarKey()) {
  if (!state.bodyMotionBars || typeof state.bodyMotionBars !== 'object') {
    state.bodyMotionBars = {};
  }
  const raw = state.bodyMotionBars[bodyKey];
  const slots = new Array(MOTION_BAR_SLOTS).fill(null);
  if (Array.isArray(raw)) {
    for (let i = 0; i < Math.min(MOTION_BAR_SLOTS, raw.length); i++) {
      const id = raw[i];
      if (!id) continue;
      const sp = getSpriteById(id);
      if (isMotionBarEligible(sp)) slots[i] = id;
    }
  }
  state.bodyMotionBars[bodyKey] = slots;
  return slots;
}

export function pruneMotionBars() {
  if (!state.bodyMotionBars || typeof state.bodyMotionBars !== 'object') return;
  let changed = false;
  for (const [bKey, arr] of Object.entries(state.bodyMotionBars)) {
    if (bKey !== '__wireframe__' && !getSpriteById(bKey)) {
      delete state.bodyMotionBars[bKey];
      changed = true;
      continue;
    }
    if (!Array.isArray(arr)) {
      delete state.bodyMotionBars[bKey];
      changed = true;
      continue;
    }
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && !isMotionBarEligible(getSpriteById(arr[i]))) {
        arr[i] = null;
        changed = true;
      }
    }
  }
  if (changed && state.motionBarOpen) {
    renderMotionBar();
  }
}

export function assignMotionSlot(slotIdx, spriteId) {
  const idx = clamp(Math.floor(slotIdx), 0, MOTION_BAR_SLOTS - 1);
  const slots = getBodyMotionSlots();
  if (!spriteId) {
    slots[idx] = null;
    savePrefsNow();
    renderMotionBar();
    return true;
  }
  const sp = getSpriteById(spriteId);
  if (!isMotionBarEligible(sp)) {
    SFX.playError();
    showToast('ONLY MOTIONS & ATTACHABLE DYNAMICS FIT HERE');
    return false;
  }
  // Move cleanly if already assigned to another slot on this body
  const prevIdx = slots.indexOf(spriteId);
  if (prevIdx >= 0 && prevIdx !== idx) slots[prevIdx] = null;
  slots[idx] = spriteId;
  state.motionBarSlot = idx;
  savePrefsNow();
  SFX.playPickup();
  renderMotionBar();
  return true;
}

function spawnMotionParticleBurst(kind, sp) {
  if (!kind || kind === 'NONE') return;
  const cx = player.x + player.w * 0.5;
  const topY = player.y - 4;
  const fxCols = getTileFxColors(sp, '#f28c38');

  if (kind === 'HEARTS') {
    for (let i = 0; i < 5; i++) {
      spawnParticle(
        cx + (Math.random() - 0.5) * 14,
        topY - Math.random() * 6,
        (Math.random() - 0.5) * 24,
        -(24 + Math.random() * 26),
        0.72 + Math.random() * 0.35,
        i % 2 === 0 ? '#ff6b8b' : '#ffb3c6',
        2.4,
        -12,
        { noDrag: true }
      );
    }
  } else if (kind === 'SPARKLES') {
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI * 2 * i) / 8 + Math.random() * 0.3;
      const spd = 24 + Math.random() * 34;
      spawnParticle(
        cx + Math.cos(ang) * 6,
        player.y + player.h * 0.4 + Math.sin(ang) * 6,
        Math.cos(ang) * spd,
        Math.sin(ang) * spd - 10,
        0.42 + Math.random() * 0.25,
        i % 2 === 0 ? '#fff2b2' : fxCols.bright,
        1.8,
        18
      );
    }
  } else if (kind === 'SWEAT') {
    for (let i = 0; i < 4; i++) {
      spawnParticle(
        cx + player.facing * (5 + Math.random() * 4),
        topY + Math.random() * 4,
        player.facing * (18 + Math.random() * 20),
        -(26 + Math.random() * 20),
        0.52 + Math.random() * 0.2,
        i % 2 === 0 ? '#8ec8f6' : '#dff2ff',
        1.8,
        220
      );
    }
  } else if (kind === 'NOTES') {
    const noteCols = ['#ffd48c', '#8ec8f6', '#b8f0a8', '#ff9ec2'];
    for (let i = 0; i < 5; i++) {
      spawnParticle(
        cx + (Math.random() - 0.5) * 14,
        topY - Math.random() * 4,
        (Math.random() - 0.5) * 26,
        -(22 + Math.random() * 24),
        0.78 + Math.random() * 0.32,
        noteCols[i % noteCols.length],
        2.2,
        -8,
        { noDrag: true }
      );
    }
  } else if (kind === 'POOF') {
    spawnBurstParticles(cx, player.y + player.h * 0.5, '#dfe6f2', 11, 56, '#9aa6bc');
  }
}

function spawnMotionLaunchProjectile(sp) {
  if (!sp || !sp._canvases || !sp._canvases[0]) return;
  if (runtime.motionFxProjectiles.length >= 12) runtime.motionFxProjectiles.shift();
  const cx = player.x + player.w * 0.5 + player.facing * 8;
  const cy = player.y + player.h * 0.42;
  runtime.motionFxProjectiles.push({
    x: cx,
    y: cy,
    vx: player.facing * 148,
    vy: -42,
    life: 0.95,
    maxLife: 0.95,
    canvas: sp._canvases[sp._canvases.length - 1] || sp._canvases[0],
    size: clamp(Math.round(sp.size * 0.55), 10, 18),
    rot: 0,
    omega: player.facing * 5.2
  });
}

export function stopActiveMotion(silent = false) {
  if (!state.activeMotionId && !runtime.activeMotion) return false;
  state.activeMotionId = null;
  runtime.activeMotion = null;
  if (state.motionBarOpen) renderMotionBar();
  if (!silent) SFX.playDeselect();
  return true;
}

export function triggerPlayerMotion(spriteId, opts = null) {
  const sp = getSpriteById(spriteId);
  if (!sp || sp.type !== 'BODY' || sp.subType !== 'MOTION') return false;

  const toggleOff = Boolean(opts && opts.toggleIfActive);
  if (toggleOff && state.activeMotionId === sp.id) {
    stopActiveMotion(true);
    triggerBodyAnim('unequip', captureCurrentCharVisual());
    showToast('MOTION STOPPED');
    return true;
  }

  const mOpts = sanitizeMotionOpts(sp.motionOpts);
  const forcedQuick = Boolean(opts && opts.forceQuick);
  const playMode = forcedQuick ? 'QUICK' : mOpts.playMode;
  const frameCount = Math.max(1, (sp._canvases && sp._canvases.length) || 1);
  const fps = clamp(sp.fps || 6, 1, 24);
  const duration = (playMode === 'QUICK' || playMode === 'SPOKEN')
    ? Math.max(frameCount <= 1 ? 0.85 : 0.55, (frameCount / fps) * (frameCount <= 2 ? 2 : 1))
    : Infinity;

  const prevVis = captureCurrentCharVisual();
  state.activeMotionId = sp.id;
  runtime.activeMotion = {
    id: sp.id,
    startTime: state.simTime,
    duration,
    playMode,
    renderMode: mOpts.renderMode,
    hideBody: mOpts.hideBody,
    particles: mOpts.particles,
    fxTick: 0
  };

  if (mOpts.renderMode !== 'OVERLAY') {
    triggerBodyAnim('equip', prevVis);
  }
  spawnMotionParticleBurst(mOpts.particles, sp);
  if (mOpts.launchFx) {
    spawnMotionLaunchProjectile(sp);
  }
  SFX.playBodyEquip('equip');
  emitWorldEvent('player:motion', { spriteId: sp.id, name: sp.name, sprite: sp });
  if (!(opts && opts.quietToast)) {
    showToast('MOTION: ' + sp.name);
  }
  if (state.motionBarOpen) renderMotionBar();
  return true;
}

export function stepActiveMotion(dt) {
  // Update decorative launched motion FX sprites
  if (runtime.motionFxProjectiles.length > 0) {
    for (let i = runtime.motionFxProjectiles.length - 1; i >= 0; i--) {
      const p = runtime.motionFxProjectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        runtime.motionFxProjectiles.splice(i, 1);
        continue;
      }
      p.vy += 120 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.omega * dt;
    }
  }

  // Expire finished floating speech bubbles
  if (runtime.speechBubbles.length > 0) {
    for (let i = runtime.speechBubbles.length - 1; i >= 0; i--) {
      const b = runtime.speechBubbles[i];
      if ((state.uiTime - b.createdAt) >= b.duration) {
        runtime.speechBubbles.splice(i, 1);
      }
    }
  }

  if (!state.activeMotionId) {
    runtime.activeMotion = null;
    return;
  }

  const sp = getSpriteById(state.activeMotionId);
  if (!sp || sp.type !== 'BODY' || sp.subType !== 'MOTION') {
    state.activeMotionId = null;
    runtime.activeMotion = null;
    return;
  }

  if (!runtime.activeMotion || runtime.activeMotion.id !== sp.id) {
    const mOpts = sanitizeMotionOpts(sp.motionOpts);
    runtime.activeMotion = {
      id: sp.id,
      startTime: state.simTime,
      duration: mOpts.playMode === 'QUICK' ? 0.85 : Infinity,
      playMode: mOpts.playMode,
      renderMode: mOpts.renderMode,
      hideBody: mOpts.hideBody,
      particles: mOpts.particles,
      fxTick: 0
    };
  }

  const am = runtime.activeMotion;
  const elapsed = state.simTime - am.startTime;
  if (Number.isFinite(am.duration) && elapsed >= am.duration) {
    state.activeMotionId = null;
    runtime.activeMotion = null;
    if (state.motionBarOpen) renderMotionBar();
    return;
  }

  // Periodic gentle ambient particle trickle during HOLD motions with particle FX
  if (am.particles && am.particles !== 'NONE' && am.particles !== 'POOF') {
    am.fxTick += dt;
    if (am.fxTick >= 0.72) {
      am.fxTick = 0;
      spawnMotionParticleBurst(am.particles, sp);
    }
  }
}

function closeMotionPicker() {
  pickerSlotIdx = -1;
  if (motionPickerPop) motionPickerPop.classList.remove('open');
}

function openMotionPickerForSlot(slotIdx) {
  if (!motionPickerPop || !motionPickerList) return;
  pickerSlotIdx = slotIdx;
  const eligible = state.sprites.filter(isMotionBarEligible);
  motionPickerList.innerHTML = '';

  if (eligible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'motion-picker-empty';
    empty.textContent = 'Create a BODY (MOTION) sprite first!';
    motionPickerList.appendChild(empty);
  } else {
    for (const sp of eligible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn motion-picker-item';
      const c = document.createElement('canvas');
      c.width = sp.size;
      c.height = sp.size;
      const cCtx = c.getContext('2d');
      cCtx.imageSmoothingEnabled = false;
      if (sp._canvases && sp._canvases[0]) cCtx.drawImage(sp._canvases[0], 0, 0);
      const lbl = document.createElement('span');
      lbl.textContent = sp.name;
      btn.appendChild(c);
      btn.appendChild(lbl);
      btn.addEventListener('click', e => {
        e.stopPropagation();
        assignMotionSlot(slotIdx, sp.id);
        closeMotionPicker();
      });
      motionPickerList.appendChild(btn);
    }
  }

  motionPickerPop.classList.add('open');
}

export function renderMotionBar() {
  if (!motionBar || !motionBarSlots) return;
  const bodySp = state.equippedBodyId ? getSpriteById(state.equippedBodyId) : null;
  if (motionBarBodyName) {
    motionBarBodyName.textContent = bodySp ? bodySp.name : 'WIREFRAME';
  }

  const slots = getBodyMotionSlots();
  motionBarSlots.innerHTML = '';

  for (let i = 0; i < MOTION_BAR_SLOTS; i++) {
    const sid = slots[i];
    const sp = sid ? getSpriteById(sid) : null;
    const isSel = state.motionBarSlot === i;
    const isActive = Boolean(sp && state.activeMotionId === sp.id);

    const slot = document.createElement('div');
    slot.className = 'motion-slot'
      + (isSel ? ' selected' : '')
      + (isActive ? ' active' : '')
      + (sp ? ' filled' : ' empty');
    slot.dataset.slot = String(i);
    slot.title = sp
      ? `${sp.name} (Click or Space to play)`
      : `Empty slot ${i + 1} (Click or drop a Motion here)`;

    const num = document.createElement('span');
    num.className = 'motion-slot-num';
    num.textContent = String(i + 1);
    slot.appendChild(num);

    if (sp) {
      const c = document.createElement('canvas');
      c.width = sp.size;
      c.height = sp.size;
      c.className = 'px-art';
      const cCtx = c.getContext('2d');
      cCtx.imageSmoothingEnabled = false;
      if (sp._canvases && sp._canvases[0]) cCtx.drawImage(sp._canvases[0], 0, 0);
      slot.appendChild(c);

      const clr = document.createElement('button');
      clr.type = 'button';
      clr.className = 'motion-slot-clear';
      clr.textContent = 'X';
      clr.title = 'Remove from slot';
      clr.addEventListener('click', e => {
        e.stopPropagation();
        assignMotionSlot(i, null);
      });
      slot.appendChild(clr);
    } else {
      const plus = document.createElement('span');
      plus.className = 'motion-slot-plus';
      plus.textContent = '+';
      slot.appendChild(plus);
    }

    slot.addEventListener('click', e => {
      e.stopPropagation();
      state.motionBarSlot = i;
      if (sp) {
        closeMotionPicker();
        triggerSlotSprite(sp);
      } else {
        renderMotionBar();
        openMotionPickerForSlot(i);
      }
    });

    slot.addEventListener('dragover', e => {
      e.preventDefault();
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => {
      slot.classList.remove('drag-over');
    });
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const droppedId = e.dataTransfer ? e.dataTransfer.getData('text/spritelab-id') : '';
      if (droppedId) {
        closeMotionPicker();
        assignMotionSlot(i, droppedId);
      }
    });

    motionBarSlots.appendChild(slot);
  }
}

function triggerSlotSprite(sp) {
  if (!sp) return false;
  if (sp.type === 'BODY' && sp.subType === 'MOTION') {
    const ok = triggerPlayerMotion(sp.id, { toggleIfActive: true });
    closeMotionBar();
    return ok;
  }
  return false;
}

export function openMotionBar() {
  if (!motionBar) return false;
  if (state.mode !== 'PLAY' || isAnyModalOpen() || player.dead) return false;
  state.motionBarOpen = true;
  closeMotionPicker();
  renderMotionBar();
  motionBar.classList.add('open');
  SFX.playMenuSwipe(false);
  return true;
}

export function closeMotionBar(silent = false) {
  closeMotionPicker();
  if (!motionBar) return false;
  const wasOpen = Boolean(state.motionBarOpen || motionBar.classList.contains('open'));
  state.motionBarOpen = false;
  motionBar.classList.remove('open');
  if (wasOpen && !silent) SFX.playMenuSwipe(true);
  return wasOpen;
}

export function navigateMotionBar(delta) {
  if (!state.motionBarOpen) return;
  closeMotionPicker();
  state.motionBarSlot = (state.motionBarSlot + delta + MOTION_BAR_SLOTS) % MOTION_BAR_SLOTS;
  SFX.playButton('soft');
  renderMotionBar();
}

export function triggerSelectedMotionSlot(explicitIdx = null) {
  const idx = explicitIdx !== null
    ? clamp(Math.floor(explicitIdx), 0, MOTION_BAR_SLOTS - 1)
    : clamp(state.motionBarSlot || 0, 0, MOTION_BAR_SLOTS - 1);
  state.motionBarSlot = idx;
  const slots = getBodyMotionSlots();
  const sid = slots[idx];
  const sp = sid ? getSpriteById(sid) : null;
  if (!sp) {
    renderMotionBar();
    openMotionPickerForSlot(idx);
    return false;
  }
  return triggerSlotSprite(sp);
}

function matchSpokenMotion(normalizedText) {
  if (!normalizedText) return null;
  const checkSprite = sp => {
    if (!sp || sp.type !== 'BODY' || sp.subType !== 'MOTION') return false;
    const mOpts = sanitizeMotionOpts(sp.motionOpts);
    if (mOpts.playMode !== 'SPOKEN' || !mOpts.keywords) return false;
    const words = mOpts.keywords.toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w) continue;
      if (normalizedText === w) return true;
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(normalizedText)) {
        return true;
      }
    }
    return false;
  };

  // Prioritize motions equipped on the active Body's Motion Bar
  const slots = getBodyMotionSlots();
  for (let i = 0; i < slots.length; i++) {
    const sp = slots[i] ? getSpriteById(slots[i]) : null;
    if (checkSprite(sp)) return sp;
  }
  // Fall back to any saved Spoken Motion
  for (let i = 0; i < state.sprites.length; i++) {
    if (checkSprite(state.sprites[i])) return state.sprites[i];
  }
  return null;
}

export function initMotionBarUI() {
  if (motionBarCloseBtn) {
    motionBarCloseBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeMotionBar();
    });
  }

  document.addEventListener('pointerdown', e => {
    if (pickerSlotIdx >= 0 && motionPickerPop && !motionPickerPop.contains(e.target) && !motionBar.contains(e.target)) {
      closeMotionPicker();
    }
  });

  // Automatically trigger Spoken Motions when player chats matching keywords
  onWorldEvent('player:say', payload => {
    if (!payload || !payload.normalized || state.mode !== 'PLAY' || player.dead) return;
    const hit = matchSpokenMotion(payload.normalized);
    if (hit) {
      triggerPlayerMotion(hit.id, { forceQuick: true, quietToast: true });
    }
  });
}
