import { SFX } from '../audio.js';
import {
  appRoot,
  audioLiveDot,
  audioMenuBtn,
  audioMenuIco,
  audioPopover,
  audioStatusText,
  audioTrackList,
  blueprintBar,
  bpClearAllBtn,
  bpExitBtn,
  bpInvBtn,
  bpNormBtn,
  bpStatsEl,
  buildOnlyGroup,
  buildPauseCorner,
  buildPauseIco,
  centerCamBtn,
  hideUiBtn,
  modeBuildBtn,
  modePlayBtn,
  musicMuteBtn,
  musicPlayToggleBtn,
  musicVolSlider,
  musicVolVal,
  physGravGroup,
  physMenuBtn,
  physPopover,
  physResetBtn,
  physTimeGroup,
  physWiresToggleBtn,
  pixoPopover,
  sfxMuteBtn,
  sfxVolSlider,
  sfxVolVal,
  showToast,
  tabRestoreChip,
  toolEraseBtn,
  toolLineBtn,
  toolLinkBtn,
  toolRectBtn,
  toolSpawnBtn,
  toolStampBtn,
  toolWireBtn,
  topWorldName,
  wireframeResetBtn,
  worldStage,
  zoomReadoutBtn
} from '../dom.js';
import {
  camera,
  getActiveWorld,
  pointer,
  runtime,
  state,
  worldHistory
} from '../state.js';
import { savePrefsNow } from '../storage.js';
import { notifyPixoEvent, updatePixoUI } from './pixo.js';
import { clearAllWorldWires, countWireableNodes, deselectHeldBlock, hideDialogue, resetPhysicsRuntime, syncRuntimeEntities } from '../world.js';

/* =========================================================================
   TOPBAR, MODE SWITCHING, TRANSPORT EMBLEM, BUILD BRUSHES & TAB HIDE UI
   ========================================================================= */
const TRANSPORT_SVG = {
  pause: '<rect x="2" y="2" width="4" height="12"/><rect x="10" y="2" width="4" height="12"/><rect x="2" y="2" width="4" height="1" fill="#fff4df" opacity="0.55"/><rect x="10" y="2" width="4" height="1" fill="#fff4df" opacity="0.55"/>',
  play: '<rect x="3" y="2" width="2" height="12"/><rect x="5" y="3" width="2" height="10"/><rect x="7" y="4" width="2" height="8"/><rect x="9" y="5" width="2" height="6"/><rect x="11" y="6" width="2" height="4"/><rect x="13" y="7" width="1" height="2"/><rect x="3" y="2" width="2" height="1" fill="#fff4df" opacity="0.55"/><rect x="5" y="3" width="2" height="1" fill="#fff4df" opacity="0.45"/><rect x="7" y="4" width="2" height="1" fill="#fff4df" opacity="0.35"/>',
  undo: '<rect x="1" y="7" width="1" height="2"/><rect x="2" y="6" width="1" height="4"/><rect x="3" y="5" width="1" height="6"/><rect x="4" y="4" width="1" height="8"/><rect x="5" y="3" width="2" height="10"/><rect x="9" y="7" width="1" height="2"/><rect x="10" y="6" width="1" height="4"/><rect x="11" y="5" width="1" height="6"/><rect x="12" y="4" width="1" height="8"/><rect x="13" y="3" width="2" height="10"/><rect x="5" y="3" width="2" height="1" fill="#fff4df" opacity="0.55"/><rect x="13" y="3" width="2" height="1" fill="#fff4df" opacity="0.55"/>',
  redo: '<rect x="1" y="3" width="2" height="10"/><rect x="3" y="4" width="1" height="8"/><rect x="4" y="5" width="1" height="6"/><rect x="5" y="6" width="1" height="4"/><rect x="6" y="7" width="1" height="2"/><rect x="9" y="3" width="2" height="10"/><rect x="11" y="4" width="1" height="8"/><rect x="12" y="5" width="1" height="6"/><rect x="13" y="6" width="1" height="4"/><rect x="14" y="7" width="1" height="2"/><rect x="1" y="3" width="2" height="1" fill="#fff4df" opacity="0.55"/><rect x="9" y="3" width="2" height="1" fill="#fff4df" opacity="0.55"/>'
};

let transportTimer = null;

export function flashBuildTransportIcon(kind) {
  if (!buildPauseCorner || !buildPauseIco || state.mode !== 'BUILD') return;
  clearTimeout(transportTimer);
  const cls = kind === 'redo' ? 'mode-redo' : 'mode-undo';
  buildPauseCorner.classList.remove('mode-undo', 'mode-redo', 'mode-play', 'playing-fade');
  buildPauseIco.innerHTML = kind === 'redo' ? TRANSPORT_SVG.redo : TRANSPORT_SVG.undo;
  buildPauseCorner.dataset.transport = kind === 'redo' ? 'redo' : 'undo';
  // Force reflow so rapid consecutive Ctrl+Z / Ctrl+Y taps re-trigger the directional pulse
  void buildPauseCorner.offsetWidth;
  buildPauseCorner.classList.add('visible', cls);
  transportTimer = setTimeout(() => {
    transportTimer = null;
    if (state.mode === 'BUILD') {
      buildPauseCorner.classList.remove('mode-undo', 'mode-redo');
      buildPauseIco.innerHTML = TRANSPORT_SVG.pause;
      buildPauseCorner.dataset.transport = 'pause';
    }
  }, 480);
}

export function setMode(nextMode, persist = true) {
  if (nextMode !== 'PLAY' && nextMode !== 'BUILD') return;
  const prevMode = state.mode;
  state.mode = nextMode;
  pointer.action = null;
  pointer.ctrlKey = false;
  pointer.wireStartKey = null;
  pointer.jointStartKey = null;
  runtime.grabbedDyn = null;
  runtime.hoverDynKey = null;
  worldHistory.activeBatch = null;
  worldStage.classList.remove('panning', 'pan-ready', 'eyedrop-ready', 'ctrl-erase-ready', 'erasing', 'play-grab-ready', 'play-grabbing');
  worldStage.classList.toggle('build-mode', nextMode === 'BUILD');
  syncWorldToolCursorClass();

  modePlayBtn.classList.toggle('active', nextMode === 'PLAY');
  modeBuildBtn.classList.toggle('active', nextMode === 'BUILD');
  if (buildPauseCorner && buildPauseIco) {
    clearTimeout(transportTimer);
    transportTimer = null;
    buildPauseCorner.classList.remove('mode-undo', 'mode-redo', 'mode-play', 'playing-fade');
    if (nextMode === 'BUILD') {
      buildPauseIco.innerHTML = TRANSPORT_SVG.pause;
      buildPauseCorner.dataset.transport = 'pause';
      buildPauseCorner.classList.add('visible');
    } else if (prevMode === 'BUILD') {
      // Morph Pause -> Play and fade away smoothly in place without shrinking
      buildPauseCorner.classList.remove('visible');
      buildPauseIco.innerHTML = TRANSPORT_SVG.play;
      buildPauseCorner.dataset.transport = 'play';
      void buildPauseCorner.offsetWidth;
      buildPauseCorner.classList.add('mode-play', 'playing-fade');
      transportTimer = setTimeout(() => {
        transportTimer = null;
        if (state.mode === 'PLAY') {
          buildPauseCorner.classList.remove('mode-play', 'playing-fade');
          buildPauseCorner.dataset.transport = '';
        }
      }, 640);
    } else {
      buildPauseCorner.classList.remove('visible');
      buildPauseCorner.dataset.transport = '';
    }
  }
  buildOnlyGroup.classList.toggle('visible', nextMode === 'BUILD');

  syncWorldToolCursorClass();
  updateBlueprintUI();

  if (nextMode === 'BUILD') {
    hideDialogue();
    syncRuntimeEntities(getActiveWorld(), true);
    notifyPixoEvent('build');
  } else if (state.selectedSpriteId) {
    // Cleanly put away any held brush when entering PLAY mode
    deselectHeldBlock(pointer.inWorld);
  }

  if (persist) savePrefsNow();
}

export function syncWorldToolCursorClass() {
  worldStage.classList.remove('btool-stamp', 'btool-rect', 'btool-line', 'btool-erase', 'btool-spawn', 'btool-wire', 'btool-link', 'play-holding');
  const cls = {
    STAMP: 'btool-stamp',
    RECT: 'btool-rect',
    LINE: 'btool-line',
    ERASE: 'btool-erase',
    SPAWN: 'btool-spawn',
    WIRE: 'btool-wire',
    LINK: 'btool-link'
  }[state.buildTool] || 'btool-stamp';
  worldStage.classList.add(cls);
  if (state.mode === 'PLAY' && state.selectedSpriteId) {
    worldStage.classList.add('play-holding');
  }
}

export function updateBlueprintUI() {
  const inBp = state.mode === 'BUILD' && state.buildTool === 'WIRE';
  worldStage.classList.toggle('blueprint-mode', inBp);
  if (blueprintBar) blueprintBar.classList.toggle('open', inBp);
  if (bpNormBtn) bpNormBtn.classList.toggle('active', !state.wireInvertMode);
  if (bpInvBtn) bpInvBtn.classList.toggle('active', Boolean(state.wireInvertMode));
  if (!inBp && bpClearAllBtn && bpClearAllBtn.dataset.armed === '1') {
    bpClearAllBtn.dataset.armed = '';
    bpClearAllBtn.classList.remove('danger-confirm');
    bpClearAllBtn.textContent = 'CLEAR';
  }
  if (inBp && bpStatsEl) {
    const w = getActiveWorld();
    const wireCount = (w && Array.isArray(w.wires)) ? w.wires.length : 0;
    const nodeCount = countWireableNodes(w);
    bpStatsEl.textContent = `${wireCount} WIRE${wireCount === 1 ? '' : 'S'} | ${nodeCount} NODE${nodeCount === 1 ? '' : 'S'}`;
  }
}

export function setBuildTool(tool) {
  const prevTool = state.buildTool;
  state.buildTool = tool;
  pointer.wireStartKey = null;
  pointer.wirePickKey = null;
  pointer.hoverWireIdx = -1;
  pointer.jointStartKey = null;
  const map = {
    STAMP: toolStampBtn,
    RECT: toolRectBtn,
    LINE: toolLineBtn,
    ERASE: toolEraseBtn,
    SPAWN: toolSpawnBtn,
    WIRE: toolWireBtn,
    LINK: toolLinkBtn
  };
  for (const [k, btn] of Object.entries(map)) {
    if (btn) btn.classList.toggle('active', k === tool);
  }
  syncWorldToolCursorClass();
  updateBlueprintUI();
  if (tool === 'WIRE' && prevTool !== 'WIRE') {
    SFX.playMenuSwipe(false);
  } else if (prevTool === 'WIRE' && tool !== 'WIRE') {
    SFX.playMenuSwipe(true);
  }
}

export function toggleMenusHidden() {
  state.menusHidden = !state.menusHidden;
  appRoot.classList.toggle('menus-hidden', state.menusHidden);
  if (state.menusHidden) {
    audioPopover.classList.remove('open');
    if (physPopover) physPopover.classList.remove('open');
    if (physMenuBtn) physMenuBtn.classList.remove('active');
    if (pixoPopover) pixoPopover.classList.remove('open');
    updatePixoUI();
  }
  SFX.playMenuSwipe(state.menusHidden);
  notifyPixoEvent('tab');
  savePrefsNow();
}

export function updateAudioUI() {
  const c = SFX.cfg;
  const sfxPct = Math.round(c.sfxVol * 100);
  const musPct = Math.round(c.musicVol * 100);
  sfxVolSlider.value = String(sfxPct);
  sfxVolVal.textContent = c.sfxMuted ? 'OFF' : `${sfxPct}%`;
  musicVolSlider.value = String(musPct);
  musicVolVal.textContent = (c.musicMuted || !c.musicEnabled) ? 'OFF' : `${musPct}%`;

  sfxMuteBtn.classList.toggle('active', !c.sfxMuted && c.sfxVol > 0);
  musicMuteBtn.classList.toggle('active', c.musicEnabled && !c.musicMuted && c.musicVol > 0);
  musicPlayToggleBtn.textContent = c.musicEnabled ? 'PAUSE' : 'PLAY';
  musicPlayToggleBtn.classList.toggle('active', c.musicEnabled);

  audioTrackList.querySelectorAll('button[data-track]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.track === c.trackId);
  });

  const st = SFX.getStatus();
  audioLiveDot.classList.toggle('playing', st.playing);
  audioStatusText.textContent = st.text;

  const allMuted = (c.sfxMuted || c.sfxVol <= 0) && (!c.musicEnabled || c.musicMuted || c.musicVol <= 0);
  audioMenuBtn.classList.toggle('active', audioPopover.classList.contains('open'));
  audioMenuIco.innerHTML = allMuted
    ? '<rect x="1" y="4" width="2" height="4"/><rect x="3" y="3" width="2" height="6"/><rect x="5" y="2" width="1" height="8"/><rect x="8" y="4" width="1" height="1"/><rect x="10" y="4" width="1" height="1"/><rect x="9" y="5" width="1" height="2"/><rect x="8" y="7" width="1" height="1"/><rect x="10" y="7" width="1" height="1"/>'
    : '<rect x="1" y="4" width="2" height="4"/><rect x="3" y="3" width="2" height="6"/><rect x="5" y="2" width="1" height="8"/><rect x="8" y="4" width="1" height="4"/><rect x="10" y="3" width="1" height="6"/>';
}

export function initAudioUI() {
  audioMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    SFX.unlock();
    if (pixoPopover) {
      pixoPopover.classList.remove('open');
      updatePixoUI();
    }
    if (physPopover) {
      physPopover.classList.remove('open');
      if (physMenuBtn) physMenuBtn.classList.remove('active');
    }
    audioPopover.classList.toggle('open');
    updateAudioUI();
  });

  document.addEventListener('pointerdown', e => {
    SFX.unlock();
    if (audioPopover.classList.contains('open') && !audioPopover.contains(e.target) && !audioMenuBtn.contains(e.target)) {
      audioPopover.classList.remove('open');
      updateAudioUI();
    }
    if (physPopover && physPopover.classList.contains('open') && !physPopover.contains(e.target) && (!physMenuBtn || !physMenuBtn.contains(e.target))) {
      physPopover.classList.remove('open');
      if (physMenuBtn) physMenuBtn.classList.remove('active');
    }
  });

  // Global studio tactile click sound for UI buttons & interactive controls
  document.addEventListener('click', e => {
    const target = e.target && e.target.closest
      ? e.target.closest('button, .cel-item, .world-row')
      : null;
    if (!target) return;
    if (target.id === 'saveSpriteBtn' || target.id === 'saveCopySpriteBtn' || target.id === 'hideUiBtn' || target.id === 'tabRestoreChip' || target.id === 'pixoAvatarBtn') return;
    if (target.classList.contains('primary') || target.classList.contains('ed-save-btn')) {
      SFX.playButton('primary');
    } else if (target.classList.contains('pal-swatch') || target.classList.contains('cel-item') || target.classList.contains('ed-step-btn')) {
      SFX.playButton('soft');
    } else {
      SFX.playButton('default');
    }
  });

  sfxMuteBtn.addEventListener('click', () => {
    SFX.toggleSfxMute();
    savePrefsNow();
  });

  musicMuteBtn.addEventListener('click', () => {
    SFX.toggleMusicMute();
    savePrefsNow();
  });

  musicPlayToggleBtn.addEventListener('click', () => {
    SFX.toggleMusicEnabled();
    savePrefsNow();
  });

  sfxVolSlider.addEventListener('input', () => {
    SFX.setSfxVol(parseInt(sfxVolSlider.value, 10) / 100);
    savePrefsNow();
  });

  musicVolSlider.addEventListener('input', () => {
    SFX.setMusicVol(parseInt(musicVolSlider.value, 10) / 100);
    savePrefsNow();
  });

  audioTrackList.addEventListener('click', e => {
    const btn = e.target.closest('button[data-track]');
    if (!btn) return;
    SFX.setTrack(btn.dataset.track);
    savePrefsNow();
  });

  updateAudioUI();
}

export function updateTopUI() {
  const world = getActiveWorld();
  topWorldName.textContent = world.name;
  const hasGear = Boolean(state.equippedBodyId || state.activeMotionId || state.equippedWearableId || state.equippedHoldableId);
  wireframeResetBtn.classList.toggle('visible', hasGear);
}

export function updatePhysUI() {
  if (physTimeGroup) {
    physTimeGroup.querySelectorAll('button[data-timescale]').forEach(btn => {
      const v = parseFloat(btn.dataset.timescale);
      btn.classList.toggle('active', Math.abs(v - (state.timeScale || 1)) < 0.02);
    });
  }
  if (physGravGroup) {
    physGravGroup.querySelectorAll('button[data-grav]').forEach(btn => {
      const v = parseFloat(btn.dataset.grav);
      btn.classList.toggle('active', Math.abs(v - (Number.isFinite(state.gravityScale) ? state.gravityScale : 1)) < 0.02);
    });
  }
  if (physWiresToggleBtn) {
    physWiresToggleBtn.classList.toggle('active', Boolean(state.showWiresInPlay));
    physWiresToggleBtn.textContent = state.showWiresInPlay ? 'ON' : 'OFF';
  }
  if (physMenuBtn && physPopover) {
    const modActive = Math.abs((state.timeScale || 1) - 1) > 0.02 || Math.abs((state.gravityScale ?? 1) - 1) > 0.02;
    physMenuBtn.classList.toggle('active', physPopover.classList.contains('open') || modActive);
  }
}

export function initTopbarUI() {
  modePlayBtn.addEventListener('click', () => setMode('PLAY'));
  modeBuildBtn.addEventListener('click', () => setMode('BUILD'));
  toolStampBtn.addEventListener('click', () => setBuildTool('STAMP'));
  toolRectBtn.addEventListener('click', () => setBuildTool('RECT'));
  toolLineBtn.addEventListener('click', () => setBuildTool('LINE'));
  toolEraseBtn.addEventListener('click', () => setBuildTool('ERASE'));
  toolSpawnBtn.addEventListener('click', () => setBuildTool('SPAWN'));
  if (toolWireBtn) {
    toolWireBtn.addEventListener('click', () => {
      // Clicking WIRE again toggles cleanly back out of Blueprint mode!
      setBuildTool(state.buildTool === 'WIRE' ? 'STAMP' : 'WIRE');
    });
  }
  if (toolLinkBtn) toolLinkBtn.addEventListener('click', () => setBuildTool('LINK'));

  if (bpNormBtn) {
    bpNormBtn.addEventListener('click', () => {
      state.wireInvertMode = false;
      updateBlueprintUI();
    });
  }
  if (bpInvBtn) {
    bpInvBtn.addEventListener('click', () => {
      state.wireInvertMode = true;
      updateBlueprintUI();
    });
  }
  if (bpExitBtn) {
    bpExitBtn.addEventListener('click', () => setBuildTool('STAMP'));
  }
  if (bpClearAllBtn) {
    bpClearAllBtn.addEventListener('click', () => {
      const w = getActiveWorld();
      if (!w || !Array.isArray(w.wires) || w.wires.length === 0) {
        showToast('NO WIRES TO CLEAR');
        return;
      }
      if (bpClearAllBtn.dataset.armed === '1') {
        bpClearAllBtn.dataset.armed = '';
        bpClearAllBtn.classList.remove('danger-confirm');
        bpClearAllBtn.textContent = 'CLEAR';
        clearAllWorldWires(w);
        updateBlueprintUI();
      } else {
        bpClearAllBtn.dataset.armed = '1';
        bpClearAllBtn.classList.add('danger-confirm');
        bpClearAllBtn.textContent = 'CLEAR?';
        setTimeout(() => {
          if (bpClearAllBtn.isConnected && bpClearAllBtn.dataset.armed === '1') {
            bpClearAllBtn.dataset.armed = '';
            bpClearAllBtn.classList.remove('danger-confirm');
            bpClearAllBtn.textContent = 'CLEAR';
          }
        }, 2200);
      }
    });
  }

  if (physMenuBtn && physPopover) {
    physMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      audioPopover.classList.remove('open');
      if (pixoPopover) {
        pixoPopover.classList.remove('open');
        updatePixoUI();
      }
      physPopover.classList.toggle('open');
      updatePhysUI();
    });
  }

  if (physTimeGroup) {
    physTimeGroup.addEventListener('click', e => {
      const btn = e.target.closest('button[data-timescale]');
      if (!btn) return;
      state.timeScale = parseFloat(btn.dataset.timescale) || 1;
      updatePhysUI();
      showToast(state.timeScale < 0.99 ? `SLOW-MO ${state.timeScale}X` : 'NORMAL SPEED 1X');
    });
  }

  if (physGravGroup) {
    physGravGroup.addEventListener('click', e => {
      const btn = e.target.closest('button[data-grav]');
      if (!btn) return;
      state.gravityScale = parseFloat(btn.dataset.grav);
      if (!Number.isFinite(state.gravityScale)) state.gravityScale = 1;
      updatePhysUI();
      const lbl = state.gravityScale === 0 ? 'ZERO-G' : (state.gravityScale < 0.8 ? 'MOON GRAVITY' : (state.gravityScale > 1.2 ? 'HEAVY GRAVITY' : 'EARTH GRAVITY'));
      showToast(lbl);
    });
  }

  if (physWiresToggleBtn) {
    physWiresToggleBtn.addEventListener('click', () => {
      state.showWiresInPlay = !state.showWiresInPlay;
      savePrefsNow();
      updatePhysUI();
    });
  }

  if (physResetBtn) {
    physResetBtn.addEventListener('click', () => {
      resetPhysicsRuntime(getActiveWorld());
      if (physPopover) physPopover.classList.remove('open');
      updatePhysUI();
    });
  }

  centerCamBtn.addEventListener('click', () => {
    camera.buildRecenter = true;
  });

  zoomReadoutBtn.addEventListener('click', () => {
    camera.targetZoom = 3.0;
    notifyPixoEvent('zoom');
    savePrefsNow();
  });

  hideUiBtn.addEventListener('click', toggleMenusHidden);
  tabRestoreChip.addEventListener('click', toggleMenusHidden);
  syncWorldToolCursorClass();
  updatePhysUI();
}
