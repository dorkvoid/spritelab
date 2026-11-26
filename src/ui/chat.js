import { SFX } from '../audio.js';
import { chatBar, chatInput, chatSendBtn, isAnyModalOpen } from '../dom.js';
import { emitWorldEvent } from '../events.js';
import { keys, player, runtime, state } from '../state.js';
import { clamp } from '../utils.js';

let bubbleSeq = 1;

/* =========================================================================
   FLOATING PIXEL SPEECH & THOUGHT BUBBLES + IN-WORLD PLAYER TEXTING
   Press Enter or T in PLAY mode to speak; emits `player:say` for Spoken
   Motions and Interactings (`hears ...`).
   ========================================================================= */
export function pushSpeechBubble(opts) {
  if (!opts || !opts.text) return null;
  const text = String(opts.text).replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!text) return null;

  const target = opts.target === 'world' ? 'world' : 'player';
  const key = opts.key || (target === 'player' ? '__player__' : null);
  const style = opts.style === 'thought' ? 'thought' : 'speech';
  const duration = Number.isFinite(opts.duration)
    ? clamp(opts.duration, 1.2, 10)
    : clamp(2.8 + text.length * 0.042, 3.0, 6.0);

  // Replace any active bubble from the same speaker so text never piles up awkwardly
  if (key) {
    for (let i = runtime.speechBubbles.length - 1; i >= 0; i--) {
      if (runtime.speechBubbles[i].key === key && runtime.speechBubbles[i].style === style) {
        runtime.speechBubbles.splice(i, 1);
      }
    }
  }
  if (runtime.speechBubbles.length >= 16) {
    runtime.speechBubbles.shift();
  }

  const bubble = {
    id: bubbleSeq++,
    target,
    key,
    wx: Number.isFinite(opts.wx) ? opts.wx : (player.x + player.w * 0.5),
    wy: Number.isFinite(opts.wy) ? opts.wy : player.y,
    text,
    style,
    createdAt: state.uiTime,
    duration
  };
  runtime.speechBubbles.push(bubble);
  return bubble;
}

export function speakPlayerMessage(rawText) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!text) return false;
  pushSpeechBubble({
    target: 'player',
    key: '__player__',
    text,
    style: 'speech'
  });
  SFX.playPixoVoice((text.length + Math.floor(state.uiTime * 10)) % 12);
  emitWorldEvent('player:say', {
    text,
    normalized: text.toLowerCase()
  });
  return true;
}

export function openChatBar(initialText = '') {
  if (!chatBar || !chatInput) return false;
  if (state.mode !== 'PLAY' || isAnyModalOpen() || player.dead) return false;
  state.chatOpen = true;
  keys.left = keys.right = keys.up = keys.down = keys.space = false;
  chatBar.classList.add('open');
  chatInput.value = initialText;
  requestAnimationFrame(() => {
    if (state.chatOpen && chatInput) {
      chatInput.focus();
      chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
    }
  });
  return true;
}

export function closeChatBar(clearInput = true) {
  if (!chatBar) return false;
  const wasOpen = Boolean(state.chatOpen || chatBar.classList.contains('open'));
  state.chatOpen = false;
  chatBar.classList.remove('open');
  if (chatInput) {
    if (clearInput) chatInput.value = '';
    if (document.activeElement === chatInput) chatInput.blur();
  }
  return wasOpen;
}

export function initChatUI() {
  if (!chatBar || !chatInput) return;

  const submit = () => {
    const val = chatInput.value;
    closeChatBar(true);
    if (val && val.trim()) {
      speakPlayerMessage(val);
    }
  };

  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', e => {
      e.stopPropagation();
      submit();
    });
  }

  chatInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeChatBar(true);
    }
  });

  document.addEventListener('pointerdown', e => {
    if (state.chatOpen && !chatBar.contains(e.target)) {
      closeChatBar(true);
    }
  });
}
