import { SFX } from '../audio.js';
import {
  pixoAvatarBtn,
  pixoBubbleTipsBtn,
  pixoBuddy,
  pixoDots,
  pixoIdeaBtn,
  pixoMenuBtn,
  pixoNextBtn,
  pixoPopover,
  pixoReplayBtn,
  pixoSkipBtn,
  pixoSparks,
  pixoSpriteImg,
  pixoStepBadge,
  pixoTasks,
  pixoText,
  pixoTooltipsToggleBtn,
  showToast
} from '../dom.js';
import { state } from '../state.js';
import { savePrefsNow } from '../storage.js';
import { closeTopbarPopovers } from './topbar.js';
import { hideUiTooltip } from './tooltips.js';

const PIXO_IDLE_SRC = 'assets/pixo_idle.png';
const PIXO_TALK_SRC = 'assets/pixo_talk.png';

/* =========================================================================
   PIXO LIGHTWEIGHT WELCOME & OPTIONAL CREATIVE TIP DECK
   Respects player agency: short 3-step open invitation (never pushy or
   blocking), any-order discovery, instant free-roam dismiss, and an updated
   optional tip deck covering SPRITELAB's newest features.
   ========================================================================= */
const TOUR_STEPS = [
  {
    id: 'explore',
    text: "HI, I'M PIXO! ROAM FREE WITH A/D/W, SCROLL TO ZOOM, OR HIT TAB FOR FULL SCREEN. EXPLORE AT YOUR OWN PACE!",
    tasks: [
      { id: 'move', label: 'MOVE OR JUMP (A/D/W)' }
    ]
  },
  {
    id: 'create_build',
    text: 'OPEN + CREATE TO DRAW BLOCKS, BODIES, FARBACKS, OR REACTIVE PROPS. HIT B TO BUILD, OR DOUBLE-CLICK ANY BLOCK TO PICK IT UP!',
    tasks: [
      { id: 'createOrBuild', label: 'TRY + CREATE OR BUILD (B)' }
    ]
  },
  {
    id: 'free_sandbox',
    text: "YOU'RE FREE TO MAKE WHATEVER YOU WANT! CLICK ? UP TOP ANYTIME FOR TIPS OR TO TOGGLE HOVER HINTS.",
    tasks: []
  }
];

const PIXO_TIPS = [
  'DOUBLE-CLICK ANY BLOCK IN PLAY OR BUILD MODE TO PICK IT UP! PRESS Q TO PUT IT AWAY.',
  'MAKE ALIVE PROPS WITH THING SUBTYPES: FURRY BENDS & SHEDS PARTICLES ON LAND, DRIFTY FLOATS & GETS PUSHED AROUND, AND CLOTHY BILLOWS!',
  'CHANGING THING MAKES 2-CELL PROPS: LOOP, TRIGGER WITH SOUND ON TOUCH, LIVELY, CAMERA-GLIMMERING SPARKLING, OR AN ITEM THROWER!',
  'PAINT CUSTOM PARALLAX WORLDS WITH FARBACK! ZOOM THE CANVAS, HOLD ALT TO FILL, SHIFT TO PICK, CTRL TO MOVE, OR STAMP SAVED SPRITES.',
  'WEATHER OBJECTS LIKE RAIN, WIND, SNOW, AND STARS RENDER IN FRONT OF FARBACKS AND PLAY LIVE AMBIENT SOUNDS NEARBY!',
  'WIRE SWITCHES TO DOORS OR PISTONS! IN BUILD MODE, OPEN MORE -> WIRES (6) AND DRAG FROM SWITCH TO DOOR.',
  'TURN ANY BLOCK OR PROP INTO A CHAIR OR BED! PICK SIT OR LAY UNDER SEAT IN THE DRAWING EDITOR.',
  'MAKE YOUR OWN CHARACTER WITH THE BODY TYPE, THEN DRAW FUN POSES (MOTIONS) AND PRESS S TO USE THEM!',
  'TOSS CRATES, BOUNCY BALLS, AND BOMBS! USE PHYSICS PROP, AND TIE THEM TOGETHER WITH ROPES (7).',
  'TRY DYNAMIC OBJECTS FOR SPINNING SIGNS, SWAYING TREES, OR FLOATING PETS - JUST CLICK A 1-CLICK RECIPE!',
  'WHILE BUILDING: RIGHT-CLICK TURNS OR FLIPS BLOCKS, AND CTRL+CLICK ERASES WITHOUT SWITCHING TOOLS!',
  'WANT ZERO GRAVITY OR SLOW MOTION? OPEN THE MENU ICON AT THE TOP RIGHT TO PLAY WITH WORLD RULES!',
  'PRESS ENTER IN PLAY MODE TO SAY SOMETHING IN A SPEECH BUBBLE - YOU CAN EVEN TRIGGER POSES BY WORDS!',
  'PREFER A QUIET SCREEN? CLICK ? AT THE TOP RIGHT TO TOGGLE HOVER TIPS OFF OR ON ANYTIME!'
];

const pixoState = {
  open: false,
  mode: 'tour', // 'tour' | 'tip'
  stepIdx: 0,
  tipIdx: 0,
  completedTasks: new Set(),
  stepCleared: false,
  fullText: '',
  typedCount: 0,
  typing: false,
  mouthOpen: false,
  mouthTick: 0,
  typeTimer: null,
  autoAdvanceTimer: null,
  cheerTimer: null,
  pokeTimer: null
};

function preloadPixoSprites() {
  const imgIdle = new Image();
  imgIdle.src = PIXO_IDLE_SRC;
  const imgTalk = new Image();
  imgTalk.src = PIXO_TALK_SRC;
}

function setAvatarSprite(talkingMouth) {
  if (!pixoSpriteImg) return;
  const target = talkingMouth ? PIXO_TALK_SRC : PIXO_IDLE_SRC;
  if (pixoSpriteImg.dataset.frame !== (talkingMouth ? 'talk' : 'idle')) {
    pixoSpriteImg.dataset.frame = talkingMouth ? 'talk' : 'idle';
    pixoSpriteImg.src = target;
  }
}

function setAvatarPose(pose) {
  if (!pixoAvatarBtn) return;
  pixoAvatarBtn.classList.remove('idle', 'talking', 'cheering', 'poked');
  // Force reflow when re-triggering one-shot animation classes
  if (pose === 'cheering' || pose === 'poked') {
    void pixoAvatarBtn.offsetWidth;
  }
  pixoAvatarBtn.classList.add(pose);
}

function clearTimers() {
  clearTimeout(pixoState.typeTimer);
  pixoState.typeTimer = null;
  clearTimeout(pixoState.autoAdvanceTimer);
  pixoState.autoAdvanceTimer = null;
}

function spawnCheerSparkles() {
  if (!pixoSparks) return;
  pixoSparks.innerHTML = '';
  const count = 10;
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.32;
    const dist = 24 + Math.random() * 18;
    const sx = Math.round(Math.cos(ang) * dist);
    const sy = Math.round(Math.sin(ang) * dist - 8);
    const sp = document.createElement('span');
    sp.className = 'pixo-spark' + (i % 3 === 1 ? ' gold' : (i % 3 === 2 ? ' white' : ''));
    sp.style.setProperty('--sx', `${sx}px`);
    sp.style.setProperty('--sy', `${sy}px`);
    sp.style.animationDelay = `${(i % 3) * 24}ms`;
    pixoSparks.appendChild(sp);
  }
  setTimeout(() => {
    if (pixoSparks) pixoSparks.innerHTML = '';
  }, 660);
}

export function triggerPixoCheer(withSound = true) {
  clearTimeout(pixoState.cheerTimer);
  setAvatarSprite(false);
  setAvatarPose('cheering');
  spawnCheerSparkles();
  if (withSound) SFX.playPixoCheer();
  pixoState.cheerTimer = setTimeout(() => {
    pixoState.cheerTimer = null;
    if (pixoState.open) {
      setAvatarPose(pixoState.typing ? 'talking' : 'idle');
    }
  }, 560);
}

function finishTypingNow() {
  clearTimeout(pixoState.typeTimer);
  pixoState.typeTimer = null;
  pixoState.typing = false;
  pixoState.typedCount = pixoState.fullText.length;
  pixoState.mouthOpen = false;
  if (pixoText) pixoText.textContent = pixoState.fullText;
  setAvatarSprite(false);
  if (!pixoState.cheerTimer) setAvatarPose('idle');
}

function startTypewriter(text) {
  clearTimeout(pixoState.typeTimer);
  pixoState.fullText = String(text || '');
  pixoState.typedCount = 0;
  pixoState.typing = true;
  pixoState.mouthOpen = false;
  pixoState.mouthTick = 0;
  if (pixoText) pixoText.textContent = '';
  if (!pixoState.cheerTimer) setAvatarPose('talking');

  const tick = () => {
    if (!pixoState.open || !pixoState.typing) return;
    if (pixoState.typedCount >= pixoState.fullText.length) {
      finishTypingNow();
      return;
    }

    const ch = pixoState.fullText[pixoState.typedCount];
    pixoState.typedCount++;
    if (pixoText) pixoText.textContent = pixoState.fullText.slice(0, pixoState.typedCount);

    const isWordChar = /[A-Z0-9]/i.test(ch);
    if (isWordChar) {
      pixoState.mouthTick++;
      // Swap between pixo_talk.png and pixo_idle.png cleanly every 2 characters while typing
      if (pixoState.mouthTick % 2 === 1) {
        pixoState.mouthOpen = !pixoState.mouthOpen;
        setAvatarSprite(pixoState.mouthOpen);
      }
      if (pixoState.typedCount % 2 === 1) {
        SFX.playPixoVoice(pixoState.typedCount);
      }
    } else {
      // Rest briefly with mouth closed on spaces & punctuation
      pixoState.mouthOpen = false;
      setAvatarSprite(false);
    }

    const delay = (ch === '!' || ch === '.' || ch === '?') ? 95 : (ch === ',' ? 62 : 22);
    pixoState.typeTimer = setTimeout(tick, delay);
  };

  pixoState.typeTimer = setTimeout(tick, 40);
}

function renderTipChrome() {
  if (pixoStepBadge) {
    pixoStepBadge.textContent = `TIP ${pixoState.tipIdx + 1}/${PIXO_TIPS.length}`;
  }
  if (pixoTasks) pixoTasks.innerHTML = '';
  if (pixoDots) {
    pixoDots.innerHTML = '';
    const dotCount = Math.min(6, PIXO_TIPS.length);
    const activeDot = pixoState.tipIdx % dotCount;
    for (let i = 0; i < dotCount; i++) {
      const dot = document.createElement('span');
      dot.className = 'pixo-dot' + (i === activeDot ? ' active' : '');
      pixoDots.appendChild(dot);
    }
  }
  if (pixoSkipBtn) pixoSkipBtn.textContent = 'CLOSE';
  if (pixoNextBtn) pixoNextBtn.textContent = 'NEXT TIP';
}

function renderStepChrome() {
  if (pixoState.mode === 'tip') {
    renderTipChrome();
    return;
  }
  const step = TOUR_STEPS[pixoState.stepIdx] || TOUR_STEPS[0];
  if (pixoStepBadge) {
    pixoStepBadge.textContent = `${pixoState.stepIdx + 1}/${TOUR_STEPS.length}`;
  }

  if (pixoTasks) {
    pixoTasks.innerHTML = '';
    for (let i = 0; i < step.tasks.length; i++) {
      const task = step.tasks[i];
      const done = pixoState.completedTasks.has(task.id);
      const chip = document.createElement('span');
      chip.className = 'pixo-task-chip' + (done ? ' done' : '');
      const box = document.createElement('span');
      box.className = 'pixo-task-box';
      const lbl = document.createElement('span');
      lbl.textContent = task.label;
      chip.appendChild(box);
      chip.appendChild(lbl);
      pixoTasks.appendChild(chip);
    }
  }

  if (pixoDots) {
    pixoDots.innerHTML = '';
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const dot = document.createElement('span');
      dot.className = 'pixo-dot' + (i < pixoState.stepIdx ? ' done' : (i === pixoState.stepIdx ? ' active' : ''));
      pixoDots.appendChild(dot);
    }
  }

  if (pixoSkipBtn) pixoSkipBtn.textContent = "I'M GOOD";
  if (pixoNextBtn) {
    const isLast = pixoState.stepIdx >= TOUR_STEPS.length - 1;
    pixoNextBtn.textContent = isLast ? 'PLAY FREE!' : 'NEXT';
  }
}

function goToStep(idx) {
  clearTimers();
  if (idx >= TOUR_STEPS.length) {
    completeTour(true);
    return;
  }
  pixoState.mode = 'tour';
  pixoState.stepIdx = Math.max(0, idx);
  pixoState.completedTasks.clear();
  pixoState.stepCleared = false;

  const step = TOUR_STEPS[pixoState.stepIdx];
  renderStepChrome();
  startTypewriter(step.text);

  // If the player is already exploring BUILD mode when arriving at step 2, acknowledge cleanly without forcing a detour
  if (step.id === 'create_build' && state.mode === 'BUILD') {
    markStepTaskDone('createOrBuild');
  }
}

function showPixoTipAt(idx) {
  clearTimers();
  pixoState.mode = 'tip';
  pixoState.tipIdx = ((idx % PIXO_TIPS.length) + PIXO_TIPS.length) % PIXO_TIPS.length;
  renderTipChrome();
  startTypewriter(PIXO_TIPS[pixoState.tipIdx]);
}

export function openPixoTips(advance = false) {
  if (!pixoBuddy) return;
  if (pixoPopover) pixoPopover.classList.remove('open');
  const nextIdx = (pixoState.open && pixoState.mode === 'tip' && advance)
    ? pixoState.tipIdx + 1
    : (advance ? pixoState.tipIdx + 1 : pixoState.tipIdx);
  pixoState.open = true;
  pixoState.mode = 'tip';
  pixoBuddy.classList.add('open');
  document.body.classList.add('pixo-open');
  setAvatarSprite(false);
  updatePixoUI();
  showPixoTipAt(nextIdx);
}

function markStepTaskDone(taskId) {
  if (!pixoState.open || pixoState.mode !== 'tour' || pixoState.stepCleared) return;
  const step = TOUR_STEPS[pixoState.stepIdx];
  if (!step || step.tasks.length === 0) return;
  if (!step.tasks.some(t => t.id === taskId)) return;
  if (pixoState.completedTasks.has(taskId)) return;

  pixoState.completedTasks.add(taskId);
  renderStepChrome();

  const allDone = step.tasks.every(t => pixoState.completedTasks.has(t.id));
  if (allDone) {
    pixoState.stepCleared = true;
    finishTypingNow();
    triggerPixoCheer(true);
    clearTimeout(pixoState.autoAdvanceTimer);
    pixoState.autoAdvanceTimer = setTimeout(() => {
      pixoState.autoAdvanceTimer = null;
      if (pixoState.open && pixoState.mode === 'tour' && pixoState.stepCleared) {
        goToStep(pixoState.stepIdx + 1);
      }
    }, 1050);
  }
}

export function updatePixoUI() {
  const tipsOn = Boolean(state.pixoTooltips);
  if (pixoMenuBtn) {
    pixoMenuBtn.classList.toggle('tips-off', !tipsOn);
    pixoMenuBtn.classList.toggle('active', Boolean(pixoPopover && pixoPopover.classList.contains('open')));
  }
  if (pixoTooltipsToggleBtn) {
    pixoTooltipsToggleBtn.textContent = tipsOn ? 'ON' : 'OFF';
    pixoTooltipsToggleBtn.classList.toggle('active', tipsOn);
  }
  if (pixoBubbleTipsBtn) {
    pixoBubbleTipsBtn.textContent = tipsOn ? 'TIPS: ON' : 'TIPS: OFF';
    pixoBubbleTipsBtn.classList.toggle('off', !tipsOn);
  }
  if (pixoReplayBtn) {
    if (pixoState.open && pixoState.mode === 'tour') {
      pixoReplayBtn.textContent = 'HIDE PIXO';
    } else {
      pixoReplayBtn.textContent = 'QUICK TOUR';
    }
  }
  if (pixoIdeaBtn) {
    pixoIdeaBtn.classList.toggle('active', pixoState.open && pixoState.mode === 'tip');
    pixoIdeaBtn.textContent = (pixoState.open && pixoState.mode === 'tip') ? 'NEXT TIP' : 'PIXO TIP';
  }
}

export function setPixoTooltipsEnabled(enabled, persist = true, toast = true) {
  state.pixoTooltips = Boolean(enabled);
  if (!state.pixoTooltips) {
    hideUiTooltip();
  }
  updatePixoUI();
  if (persist) savePrefsNow();
  if (toast) {
    showToast(state.pixoTooltips ? 'HOVER TIPS ON' : 'HOVER TIPS OFF');
  }
}

export function startPixoTour(fromReplay = false) {
  if (!pixoBuddy) return;
  if (pixoPopover) pixoPopover.classList.remove('open');
  pixoState.open = true;
  pixoState.mode = 'tour';
  pixoBuddy.classList.add('open');
  document.body.classList.add('pixo-open');
  setAvatarSprite(false);
  updatePixoUI();
  goToStep(0);
}

export function closePixoTour(markDone = true, showHint = false) {
  clearTimers();
  const wasTour = pixoState.mode === 'tour';
  pixoState.open = false;
  pixoState.typing = false;
  setAvatarSprite(false);
  setAvatarPose('idle');
  if (pixoBuddy) pixoBuddy.classList.remove('open');
  document.body.classList.remove('pixo-open');
  if (wasTour && markDone && !state.tutorialDone) {
    state.tutorialDone = true;
    savePrefsNow();
  }
  updatePixoUI();
  if (showHint && wasTour) {
    showToast('CLICK ? ANYTIME FOR PIXO');
  }
}

function completeTour(withCheer = true) {
  state.tutorialDone = true;
  savePrefsNow();
  if (withCheer && pixoState.open) {
    finishTypingNow();
    triggerPixoCheer(true);
    clearTimeout(pixoState.autoAdvanceTimer);
    pixoState.autoAdvanceTimer = setTimeout(() => {
      closePixoTour(true, false);
      showToast('TOUR COMPLETE! CLICK ? ANYTIME');
    }, 640);
  } else {
    closePixoTour(true, false);
  }
}

export function notifyPixoEvent(eventName) {
  if (!pixoState.open || pixoState.mode !== 'tour') return;
  const step = TOUR_STEPS[pixoState.stepIdx];
  if (!step) return;

  if (step.id === 'explore') {
    if (eventName === 'walk' || eventName === 'jump' || eventName === 'zoom' || eventName === 'tab') {
      markStepTaskDone('move');
    } else if (eventName === 'build' || eventName === 'editorOpen' || eventName === 'editorSave' || eventName === 'placeTile') {
      // Respect player agency: if they jump straight into creating or building, skip ahead smoothly to the free-roam wrap-up!
      goToStep(TOUR_STEPS.length - 1);
    }
  } else if (step.id === 'create_build') {
    if (eventName === 'build' || eventName === 'editorOpen' || eventName === 'editorSave' || eventName === 'placeTile') {
      markStepTaskDone('createOrBuild');
    }
  }
}

export function initPixoUI(ownsSession = true) {
  preloadPixoSprites();
  updatePixoUI();

  if (pixoMenuBtn && pixoPopover) {
    pixoMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      SFX.unlock();
      hideUiTooltip();
      const wasOpen = pixoPopover.classList.contains('open');
      closeTopbarPopovers();
      if (!wasOpen) {
        pixoPopover.classList.add('open');
        updatePixoUI();
      }
    });

    document.addEventListener('pointerdown', e => {
      if (
        pixoPopover.classList.contains('open') &&
        !pixoPopover.contains(e.target) &&
        !pixoMenuBtn.contains(e.target)
      ) {
        pixoPopover.classList.remove('open');
        updatePixoUI();
      }
    });
  }

  if (pixoTooltipsToggleBtn) {
    pixoTooltipsToggleBtn.addEventListener('click', () => {
      setPixoTooltipsEnabled(!state.pixoTooltips, true, true);
    });
  }

  if (pixoBubbleTipsBtn) {
    pixoBubbleTipsBtn.addEventListener('click', () => {
      setPixoTooltipsEnabled(!state.pixoTooltips, true, true);
    });
  }

  if (pixoReplayBtn) {
    pixoReplayBtn.addEventListener('click', () => {
      if (pixoState.open && pixoState.mode === 'tour') {
        closePixoTour(true, false);
        if (pixoPopover) pixoPopover.classList.remove('open');
        updatePixoUI();
      } else {
        startPixoTour(true);
      }
    });
  }

  if (pixoIdeaBtn) {
    pixoIdeaBtn.addEventListener('click', () => {
      SFX.unlock();
      openPixoTips(pixoState.open && pixoState.mode === 'tip');
    });
  }

  if (pixoSkipBtn) {
    pixoSkipBtn.addEventListener('click', () => {
      closePixoTour(pixoState.mode === 'tour', pixoState.mode === 'tour');
    });
  }

  if (pixoNextBtn) {
    pixoNextBtn.addEventListener('click', () => {
      if (pixoState.typing) {
        finishTypingNow();
        return;
      }
      if (pixoState.mode === 'tip') {
        showPixoTipAt(pixoState.tipIdx + 1);
      } else {
        goToStep(pixoState.stepIdx + 1);
      }
    });
  }

  if (pixoAvatarBtn) {
    pixoAvatarBtn.addEventListener('click', () => {
      SFX.unlock();
      clearTimeout(pixoState.pokeTimer);
      setAvatarSprite(true);
      setAvatarPose('poked');
      SFX.playPixoVoice(Math.floor(Math.random() * 8));
      if (pixoState.open && pixoState.mode === 'tip' && !pixoState.typing) {
        showPixoTipAt(pixoState.tipIdx + 1);
      }
      pixoState.pokeTimer = setTimeout(() => {
        pixoState.pokeTimer = null;
        if (pixoState.open) {
          setAvatarSprite(pixoState.typing ? pixoState.mouthOpen : false);
          if (!pixoState.cheerTimer) setAvatarPose(pixoState.typing ? 'talking' : 'idle');
        }
      }, 320);
    });
  }

  // First-time visitors meet Pixo immediately after finishing the one-time Start Screen PLAY intro
}
