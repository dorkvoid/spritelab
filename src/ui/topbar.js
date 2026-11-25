import { SFX } from '../audio.js';
import {
  appRoot,
  audioLiveDot,
  audioMenuBtn,
  audioMenuIco,
  audioPopover,
  audioStatusText,
  audioTrackList,
  buildOnlyGroup,
  buildPauseCorner,
  centerCamBtn,
  hideUiBtn,
  modeBuildBtn,
  modePlayBtn,
  musicMuteBtn,
  musicPlayToggleBtn,
  musicVolSlider,
  musicVolVal,
  sfxMuteBtn,
  sfxVolSlider,
  sfxVolVal,
  tabRestoreChip,
  toolEraseBtn,
  toolLineBtn,
  toolRectBtn,
  toolSpawnBtn,
  toolStampBtn,
  topWorldName,
  wireframeResetBtn,
  worldStage,
  zoomReadoutBtn
} from '../dom.js';
import {
  camera,
  getActiveWorld,
  pointer,
  state,
  worldHistory
} from '../state.js';
import { savePrefsNow } from '../storage.js';
import { deselectHeldBlock, hideDialogue, syncRuntimeEntities } from '../world.js';

/* =========================================================================
   TOPBAR, MODE SWITCHING, BUILD BRUSHES & TAB HIDE UI
   ========================================================================= */
export function setMode(nextMode, persist = true) {
  if (nextMode !== 'PLAY' && nextMode !== 'BUILD') return;
  state.mode = nextMode;
  pointer.action = null;
  worldHistory.activeBatch = null;
  worldStage.classList.remove('panning', 'pan-ready');
  worldStage.classList.toggle('build-mode', nextMode === 'BUILD');

  modePlayBtn.classList.toggle('active', nextMode === 'PLAY');
  modeBuildBtn.classList.toggle('active', nextMode === 'BUILD');
  if (buildPauseCorner) buildPauseCorner.classList.toggle('visible', nextMode === 'BUILD');
  buildOnlyGroup.classList.toggle('visible', nextMode === 'BUILD');

  if (nextMode === 'BUILD') {
    hideDialogue();
    syncRuntimeEntities(getActiveWorld(), true);
  } else if (state.selectedSpriteId) {
    // Cleanly put away any held brush when entering PLAY mode
    deselectHeldBlock(pointer.inWorld);
  }

  if (persist) savePrefsNow();
}

export function setBuildTool(tool) {
  state.buildTool = tool;
  const map = {
    STAMP: toolStampBtn,
    RECT: toolRectBtn,
    LINE: toolLineBtn,
    ERASE: toolEraseBtn,
    SPAWN: toolSpawnBtn
  };
  for (const [k, btn] of Object.entries(map)) {
    btn.classList.toggle('active', k === tool);
  }
}

export function toggleMenusHidden() {
  state.menusHidden = !state.menusHidden;
  appRoot.classList.toggle('menus-hidden', state.menusHidden);
  if (state.menusHidden) audioPopover.classList.remove('open');
  SFX.playMenuSwipe(state.menusHidden);
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
    audioPopover.classList.toggle('open');
    updateAudioUI();
  });

  document.addEventListener('pointerdown', e => {
    SFX.unlock();
    if (audioPopover.classList.contains('open') && !audioPopover.contains(e.target) && !audioMenuBtn.contains(e.target)) {
      audioPopover.classList.remove('open');
      updateAudioUI();
    }
  });

  // Global studio tactile click sound for UI buttons & interactive controls
  document.addEventListener('click', e => {
    const target = e.target && e.target.closest
      ? e.target.closest('button, .cel-item, .world-row')
      : null;
    if (!target) return;
    if (target.id === 'saveSpriteBtn' || target.id === 'saveCopySpriteBtn' || target.id === 'hideUiBtn' || target.id === 'tabRestoreChip') return;
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

export function initTopbarUI() {
  modePlayBtn.addEventListener('click', () => setMode('PLAY'));
  modeBuildBtn.addEventListener('click', () => setMode('BUILD'));
  toolStampBtn.addEventListener('click', () => setBuildTool('STAMP'));
  toolRectBtn.addEventListener('click', () => setBuildTool('RECT'));
  toolLineBtn.addEventListener('click', () => setBuildTool('LINE'));
  toolEraseBtn.addEventListener('click', () => setBuildTool('ERASE'));
  toolSpawnBtn.addEventListener('click', () => setBuildTool('SPAWN'));

  centerCamBtn.addEventListener('click', () => {
    camera.buildRecenter = true;
  });

  zoomReadoutBtn.addEventListener('click', () => {
    camera.targetZoom = 3.0;
    savePrefsNow();
  });

  hideUiBtn.addEventListener('click', toggleMenusHidden);
  tabRestoreChip.addEventListener('click', toggleMenusHidden);
}
