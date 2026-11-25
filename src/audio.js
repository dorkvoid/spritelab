import { sessionGuard } from './storage.js';
import { updateAudioUI } from './ui/topbar.js';
import { clamp } from './utils.js';

/* =========================================================================
   IMMERSIVE SOUND ENGINE (TACTILE ACOUSTIC/FOLEY WEB AUDIO + AMBIENT MUSIC)
   Dual-bus stereo studio & hall reverbs, warm tape echo, wooden-marimba &
   felt-key synthesis, expressive foley SFX, and curated YouTube ambient
   music with a lush voice-led "TOYBOX DRIFT" generative ambient soundtrack.
   ========================================================================= */
export const AMBIENT_TRACKS = {
  yt_astroneer: { id: 'yt_astroneer', ytId: 'JLQsLNOHcxw', label: 'ASTRONEER AMBIENT' },
  synth: { id: 'synth', ytId: null, label: 'TOYBOX DRIFT (SYNTH)' }
};

export const SFX = (() => {
  let ctx = null;
  let masterComp = null;
  let masterTone = null;
  let sfxGain = null;
  let musicGain = null;
  let sfxReverb = null;
  let sfxReverbGain = null;
  let musicReverb = null;
  let musicReverbGain = null;
  let musicDelayL = null;
  let musicDelayR = null;
  let musicDelayIn = null;
  let whiteBuf = null;
  let pinkBuf = null;
  let unlocked = false;
  let hasStereoPanner = false;

  const cfg = {
    sfxVol: 0.85,
    musicVol: 0.28,
    sfxMuted: false,
    musicMuted: false,
    musicEnabled: true,
    trackId: 'yt_astroneer'
  };

  const throttle = {
    crunch: 0,
    place: 0,
    step: 0,
    btn: 0,
    swim: 0,
    splash: 0
  };

  let stepFootToggle = 0;

  // Built-in Lush Generative Ambient Soundtrack ("TOYBOX DRIFT")
  // Voice-led D-Lydian felt Rhodes + breathing analog pad + kalimba/celesta motifs
  const synthState = {
    active: false,
    timer: null,
    barIdx: 0,
    motifIdx: 0,
    padOscs: [],
    padGain: null,
    padFilter: null,
    padLfo: null,
    padLfoGain: null
  };

  // Curated YouTube IFrame Ambient Music controller with automatic fallback
  const ytState = {
    apiLoading: false,
    apiReady: false,
    player: null,
    ready: false,
    playing: false,
    failed: false,
    fallbackTimer: null,
    currentVideoId: null
  };

  function notifyUI() {
    if (typeof updateAudioUI === 'function') updateAudioUI();
  }

  function buildImpulseResponse(durationSec, decayPow, darkStart, darkEnd, preDelaySec = 0) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const preSamples = Math.floor(sr * preDelaySec);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      let lp2 = 0;
      for (let i = 0; i < len; i++) {
        if (i < preSamples) {
          data[i] = 0;
          continue;
        }
        const t = (i - preSamples) / Math.max(1, len - preSamples);
        const fadeIn = i - preSamples < 320 ? (i - preSamples) / 320 : 1;
        const env = Math.pow(1 - t, decayPow) * fadeIn;
        const n = Math.random() * 2 - 1;
        const alpha = darkEnd + (1 - t) * (darkStart - darkEnd);
        lp += (n - lp) * alpha;
        lp2 += (lp - lp2) * (alpha * 0.85);
        data[i] = lp2 * env * 0.55;
      }
    }
    return buf;
  }

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      return ctx;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    hasStereoPanner = typeof ctx.createStereoPanner === 'function';

    // Gentle warm studio high-shelf tame + transparent dynamics compressor
    masterTone = ctx.createBiquadFilter();
    masterTone.type = 'highshelf';
    masterTone.frequency.value = 5400;
    masterTone.gain.value = -2.8;

    masterComp = ctx.createDynamicsCompressor();
    masterComp.threshold.value = -15;
    masterComp.knee.value = 20;
    masterComp.ratio.value = 3.5;
    masterComp.attack.value = 0.005;
    masterComp.release.value = 0.18;

    masterTone.connect(masterComp);
    masterComp.connect(ctx.destination);

    // Separate SFX & Music buses so muting SFX never kills Music reverb/echo
    sfxGain = ctx.createGain();
    sfxGain.gain.value = cfg.sfxMuted ? 0 : cfg.sfxVol;
    sfxGain.connect(masterTone);

    musicGain = ctx.createGain();
    musicGain.gain.value = (cfg.musicMuted || !cfg.musicEnabled) ? 0 : cfg.musicVol;
    musicGain.connect(masterTone);

    // Tight warm wooden-room reverb for tactile SFX foley (0.68s)
    sfxReverb = ctx.createConvolver();
    sfxReverb.buffer = buildImpulseResponse(0.68, 2.7, 0.34, 0.12, 0.006);
    sfxReverbGain = ctx.createGain();
    sfxReverbGain.gain.value = 0.28;
    sfxReverb.connect(sfxReverbGain);
    sfxReverbGain.connect(sfxGain);

    // Lush 2.5s warm stereo hall reverb dedicated to TOYBOX DRIFT music
    musicReverb = ctx.createConvolver();
    musicReverb.buffer = buildImpulseResponse(2.5, 2.35, 0.26, 0.07, 0.018);
    musicReverbGain = ctx.createGain();
    musicReverbGain.gain.value = 0.46;
    musicReverb.connect(musicReverbGain);
    musicReverbGain.connect(musicGain);

    // Subtle stereo ping-pong tape echo for Toybox Drift celesta/Rhodes tails
    musicDelayIn = ctx.createGain();
    musicDelayIn.gain.value = 0.26;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 1850;
    musicDelayL = ctx.createDelay(1.0);
    musicDelayR = ctx.createDelay(1.0);
    musicDelayL.delayTime.value = 0.42;
    musicDelayR.delayTime.value = 0.63;
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = 0.34;
    fbR.gain.value = 0.32;
    const outL = hasStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const outR = hasStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (hasStereoPanner) {
      outL.pan.value = -0.52;
      outR.pan.value = 0.52;
    }

    musicDelayIn.connect(delayTone);
    delayTone.connect(musicDelayL);
    delayTone.connect(musicDelayR);
    musicDelayL.connect(fbL);
    fbL.connect(musicDelayR);
    musicDelayR.connect(fbR);
    fbR.connect(musicDelayL);
    musicDelayL.connect(outL);
    musicDelayR.connect(outR);
    outL.connect(musicGain);
    outR.connect(musicGain);
    outL.connect(musicReverb);
    outR.connect(musicReverb);

    // Pre-build 2-second White and Pink noise buffers for organic foley
    const bufLen = ctx.sampleRate * 2;
    whiteBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    pinkBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const wd = whiteBuf.getChannelData(0);
    const pd = pinkBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufLen; i++) {
      const w = Math.random() * 2 - 1;
      wd[i] = w;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return ctx;
  }

  function rand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  function makeNoise(pink = true) {
    const src = ctx.createBufferSource();
    src.buffer = pink ? pinkBuf : whiteBuf;
    src.loop = true;
    return src;
  }

  function routeOut(node, targetBus, wetBus, wet = 0.15, pan = 0) {
    let out = node;
    if (hasStereoPanner && Math.abs(pan) > 0.01) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -0.95, 0.95);
      node.connect(p);
      out = p;
    }
    out.connect(targetBus);
    if (wet > 0 && wetBus) {
      const g = ctx.createGain();
      g.gain.value = wet;
      out.connect(g);
      g.connect(wetBus);
    }
  }

  function sendOut(node, wet = 0.15, pan = 0) {
    routeOut(node, sfxGain, sfxReverb, wet, pan);
  }

  /* =====================================================================
     SHARED ACOUSTIC SYNTHESIS PRIMITIVES
     Physical-inspired wooden marimba, crystal bell, and shaped noise foley.
     ===================================================================== */
  function playFilteredNoise(pink, startT, dur, f0, f1, Q, vol, wet = 0.14, type = 'bandpass', pan = 0, attack = 0.008) {
    const src = makeNoise(pink);
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = Q;
    filt.frequency.setValueAtTime(Math.max(40, f0), startT);
    if (Math.abs(f1 - f0) > 1) {
      filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), startT + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + Math.min(attack, dur * 0.45));
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur);
    src.connect(filt);
    filt.connect(g);
    sendOut(g, wet, pan);
    src.start(startT, rand(0, 1.4), dur + 0.02);
  }

  /* Warm tactile wooden marimba / kalimba bar (fundamental + 2.756x woody overtone) */
  function playWoodBar(freq, startT, vol = 0.14, dur = 0.14, wet = 0.18, pan = 0, pitchDrop = 0.97) {
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, startT);
    if (pitchDrop !== 1) {
      o1.frequency.exponentialRampToValueAtTime(Math.max(40, freq * pitchDrop), startT + Math.min(0.06, dur));
    }

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, startT);
    g1.gain.linearRampToValueAtTime(vol, startT + 0.003);
    g1.gain.exponentialRampToValueAtTime(0.0001, startT + dur);
    o1.connect(g1);
    sendOut(g1, wet, pan);
    o1.start(startT);
    o1.stop(startT + dur + 0.02);

    // Classic marimba/woodblock 2.756x overtone strike (decays rapidly into warm wood body)
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(Math.min(7200, freq * 2.756), startT);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, startT);
    g2.gain.linearRampToValueAtTime(vol * 0.24, startT + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0001, startT + Math.min(0.036, dur * 0.35));
    o2.connect(g2);
    sendOut(g2, wet * 0.5, pan);
    o2.start(startT);
    o2.stop(startT + Math.min(0.045, dur * 0.4) + 0.01);
  }

  /* Soft crystalline music-box / celesta pluck with silky harmonic bloom */
  function playCrystalBell(freq, startT, vol = 0.11, dur = 0.42, wet = 0.42, pan = 0) {
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, startT);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 2.0, startT);
    o2.detune.setValueAtTime(rand(-3, 3), startT);

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, startT);
    g1.gain.linearRampToValueAtTime(vol, startT + 0.007);
    g1.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, startT);
    g2.gain.linearRampToValueAtTime(vol * 0.28, startT + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0001, startT + Math.min(0.14, dur * 0.42));

    o1.connect(g1);
    o2.connect(g2);
    g2.connect(g1);
    sendOut(g1, wet, pan);
    o1.start(startT);
    o2.start(startT);
    o1.stop(startT + dur + 0.03);
    o2.stop(startT + Math.min(0.16, dur * 0.45) + 0.02);
  }

  function syncGains() {
    const now = ctx ? ctx.currentTime : 0;
    if (sfxGain && ctx) {
      sfxGain.gain.setTargetAtTime(cfg.sfxMuted ? 0 : cfg.sfxVol, now, 0.02);
    }
    if (musicGain && ctx) {
      const mTarget = (cfg.musicMuted || !cfg.musicEnabled) ? 0 : cfg.musicVol;
      musicGain.gain.setTargetAtTime(mTarget, now, 0.08);
    }
    if (ytState.player && ytState.ready) {
      try {
        if (cfg.musicMuted || !cfg.musicEnabled) {
          ytState.player.mute();
        } else {
          ytState.player.unMute();
          ytState.player.setVolume(Math.round(cfg.musicVol * 100));
        }
      } catch (_) {}
    }
  }

  /* =====================================================================
     BUILT-IN GENERATIVE AMBIENT SOUNDTRACK ("TOYBOX DRIFT")
     Warm D-Lydian / D-Major evolving 8-bar progression inspired by C418 &
     Astroneer: voice-led analog pad, felt Rhodes piano with gentle tine
     attack, soft round bass anchor, and drifting kalimba/celesta motifs.
     ===================================================================== */
  const TOYBOX_PROGRESSION = [
    // { bass, pad: [3 chord tones], keys: [rolled felt Rhodes voicing] }
    { bass: 73.42,  pad: [146.83, 220.00, 329.63], keys: [146.83, 220.00, 277.18, 329.63, 369.99] }, // Dmaj9
    { bass: 98.00,  pad: [196.00, 246.94, 369.99], keys: [196.00, 246.94, 293.66, 369.99, 440.00] }, // Gmaj9
    { bass: 123.47, pad: [185.00, 246.94, 329.63], keys: [123.47, 220.00, 293.66, 329.63, 369.99] }, // Bm11
    { bass: 110.00, pad: [164.81, 220.00, 329.63], keys: [110.00, 196.00, 246.94, 329.63, 369.99] }, // A13sus4
    { bass: 92.50,  pad: [185.00, 220.00, 329.63], keys: [185.00, 220.00, 277.18, 329.63, 440.00] }, // F#m11
    { bass: 98.00,  pad: [196.00, 246.94, 369.99], keys: [196.00, 246.94, 329.63, 369.99, 440.00] }, // Gmaj13
    { bass: 82.41,  pad: [164.81, 246.94, 369.99], keys: [164.81, 246.94, 293.66, 369.99, 440.00] }, // Em9
    { bass: 110.00, pad: [164.81, 220.00, 293.66], keys: [110.00, 185.00, 220.00, 293.66, 329.63] }  // A6/9sus
  ];

  // Expressive composed pentatonic / Lydian music-box motifs [beatOffsetSec, freq, dur, vol]
  const TOYBOX_MOTIFS = [
    [[0.85, 587.33, 2.6, 0.052], [1.75, 739.99, 2.4, 0.048], [2.55, 880.00, 3.2, 0.055], [4.10, 659.25, 2.8, 0.042]],
    [[1.10, 659.25, 2.4, 0.048], [2.25, 587.33, 2.5, 0.045], [3.35, 493.88, 3.0, 0.050], [4.65, 587.33, 2.6, 0.042]],
    [[0.70, 880.00, 2.8, 0.046], [1.90, 739.99, 2.2, 0.045], [2.65, 659.25, 2.6, 0.050], [3.85, 739.99, 3.2, 0.048]],
    [[1.30, 554.37, 2.4, 0.044], [2.30, 587.33, 2.6, 0.050], [3.45, 880.00, 3.0, 0.048], [4.75, 739.99, 2.9, 0.042]]
  ];

  function playRhodesKey(freq, startT, dur, peakGain, pan = 0) {
    if (!ctx || !musicGain) return;
    // Warm fundamental sine body
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(freq, startT);
    body.detune.setValueAtTime(rand(-3, 3), startT);

    // Gentle Rhodes tine bell overtone (softly decays into warm velvet sustain)
    const tine = ctx.createOscillator();
    tine.type = 'triangle';
    tine.frequency.setValueAtTime(freq * 2.0, startT);
    tine.detune.setValueAtTime(rand(-4, 4), startT);

    const tineGain = ctx.createGain();
    tineGain.gain.setValueAtTime(0.0001, startT);
    tineGain.gain.linearRampToValueAtTime(0.18, startT + 0.018);
    tineGain.gain.exponentialRampToValueAtTime(0.0001, startT + Math.min(1.1, dur * 0.35));

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1450, startT);
    filt.frequency.exponentialRampToValueAtTime(360, startT + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startT);
    env.gain.linearRampToValueAtTime(peakGain, startT + 0.055);
    env.gain.exponentialRampToValueAtTime(peakGain * 0.45, startT + dur * 0.38);
    env.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

    body.connect(filt);
    tine.connect(tineGain);
    tineGain.connect(filt);
    filt.connect(env);

    routeOut(env, musicGain, musicReverb, 0.52, pan);
    if (musicDelayIn) {
      const dSend = ctx.createGain();
      dSend.gain.value = 0.22;
      env.connect(dSend);
      dSend.connect(musicDelayIn);
    }

    body.start(startT);
    tine.start(startT);
    body.stop(startT + dur + 0.08);
    tine.stop(startT + Math.min(1.2, dur * 0.4) + 0.06);
  }

  function playToyboxKalimba(freq, startT, dur, peakGain, pan = 0) {
    if (!ctx || !musicGain) return;
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, startT);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 3.0, startT);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startT);
    env.gain.linearRampToValueAtTime(peakGain, startT + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

    const chimeG = ctx.createGain();
    chimeG.gain.setValueAtTime(0.0001, startT);
    chimeG.gain.linearRampToValueAtTime(peakGain * 0.22, startT + 0.006);
    chimeG.gain.exponentialRampToValueAtTime(0.0001, startT + 0.26);

    o1.connect(env);
    o2.connect(chimeG);
    chimeG.connect(env);

    routeOut(env, musicGain, musicReverb, 0.65, pan);
    if (musicDelayIn) {
      const dSend = ctx.createGain();
      dSend.gain.value = 0.48;
      env.connect(dSend);
      dSend.connect(musicDelayIn);
    }

    o1.start(startT);
    o2.start(startT);
    o1.stop(startT + dur + 0.06);
    o2.stop(startT + 0.30);
  }

  function playWarmBass(freq, startT, dur, peakGain) {
    if (!ctx || !musicGain) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, startT);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(freq * 2, startT);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, startT);
    const g2 = ctx.createGain();
    g2.gain.value = 0.14;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startT);
    env.gain.linearRampToValueAtTime(peakGain, startT + 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, startT + dur);
    o.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(env);
    routeOut(env, musicGain, musicReverb, 0.18, 0);
    o.start(startT);
    o2.start(startT);
    o.stop(startT + dur + 0.08);
    o2.stop(startT + dur + 0.08);
  }

  function scheduleAmbientPhrase() {
    if (!synthState.active || !ctx) return;
    const now = ctx.currentTime + 0.06;
    const step = TOYBOX_PROGRESSION[synthState.barIdx % TOYBOX_PROGRESSION.length];
    const barNum = synthState.barIdx;
    synthState.barIdx++;

    // Glide the breathing analog pad smoothly to match the current bar's chord tones
    if (synthState.padOscs.length === 3) {
      step.pad.forEach((f, idx) => {
        try {
          synthState.padOscs[idx].frequency.setTargetAtTime(f, now, 0.55);
        } catch (_) {}
      });
    }

    // Deep warm bass anchor on each chord change
    playWarmBass(step.bass, now, 5.8, 0.135);

    // Rolled felt Rhodes chord spread smoothly across stereo
    step.keys.forEach((f, idx) => {
      const pan = -0.38 + (idx / Math.max(1, step.keys.length - 1)) * 0.76;
      playRhodesKey(f, now + idx * 0.115 + rand(0, 0.025), 5.6, 0.082 - idx * 0.006, pan);
    });

    // Gentle mid-bar Rhodes echo touch on odd bars for organic human motion
    if (barNum % 2 === 1) {
      const midNote = step.keys[step.keys.length - 2];
      playRhodesKey(midNote * 2, now + 3.05, 3.2, 0.036, rand(-0.45, 0.45));
    }

    // Play a floating kalimba/music-box motif on 3 of every 4 bars (leaving calm breathing bars)
    if (barNum % 4 !== 3) {
      const motif = TOYBOX_MOTIFS[synthState.motifIdx % TOYBOX_MOTIFS.length];
      synthState.motifIdx++;
      motif.forEach(([off, freq, dur, vol], idx) => {
        const pan = (idx % 2 === 0 ? -1 : 1) * rand(0.18, 0.52);
        const octShift = (barNum >= 8 && idx === 2 && Math.random() > 0.55) ? 2 : 1;
        playToyboxKalimba(freq * octShift, now + off + rand(-0.04, 0.05), dur, vol, pan);
      });
    }

    synthState.timer = setTimeout(scheduleAmbientPhrase, 5800);
  }

  function startAmbientSynth() {
    if (synthState.active) return;
    if (!ensureContext()) return;
    synthState.active = true;
    const now = ctx.currentTime;
    const first = TOYBOX_PROGRESSION[synthState.barIdx % TOYBOX_PROGRESSION.length];

    // Breathing warm low-passed analog pad with subtle filter swell LFO
    const padFilt = ctx.createBiquadFilter();
    padFilt.type = 'lowpass';
    padFilt.frequency.value = 390;
    padFilt.Q.value = 0.8;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.095;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 145;
    lfo.connect(lfoG);
    lfoG.connect(padFilt.frequency);
    lfo.start(now);

    const padG = ctx.createGain();
    padG.gain.setValueAtTime(0.0001, now);
    padG.gain.linearRampToValueAtTime(0.095, now + 2.4);
    padFilt.connect(padG);
    padG.connect(musicGain);
    if (musicReverb) {
      const rv = ctx.createGain();
      rv.gain.value = 0.42;
      padG.connect(rv);
      rv.connect(musicReverb);
    }

    synthState.padOscs = first.pad.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 6;
      o.connect(padFilt);
      o.start(now);
      return o;
    });
    synthState.padGain = padG;
    synthState.padFilter = padFilt;
    synthState.padLfo = lfo;
    synthState.padLfoGain = lfoG;

    scheduleAmbientPhrase();
    notifyUI();
  }

  function stopAmbientSynth() {
    if (!synthState.active) return;
    synthState.active = false;
    clearTimeout(synthState.timer);
    synthState.timer = null;
    if (ctx && synthState.padGain) {
      const now = ctx.currentTime;
      const oldGain = synthState.padGain;
      const oldFilter = synthState.padFilter;
      const oldOscs = synthState.padOscs.slice();
      const oldLfo = synthState.padLfo;
      const oldLfoG = synthState.padLfoGain;
      try {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setTargetAtTime(0.0001, now, 0.25);
      } catch (_) {}
      setTimeout(() => {
        oldOscs.forEach(o => { try { o.stop(); o.disconnect(); } catch (_) {} });
        if (oldLfo) { try { oldLfo.stop(); oldLfo.disconnect(); } catch (_) {} }
        if (oldLfoG) { try { oldLfoG.disconnect(); } catch (_) {} }
        if (oldFilter) { try { oldFilter.disconnect(); } catch (_) {} }
        if (oldGain) { try { oldGain.disconnect(); } catch (_) {} }
      }, 950);
    }
    synthState.padOscs = [];
    synthState.padGain = null;
    synthState.padFilter = null;
    synthState.padLfo = null;
    synthState.padLfoGain = null;
    notifyUI();
  }

  /* ---------------------------------------------------------------------
     SOFT YOUTUBE AMBIENT MUSIC PLAYER (WITH AUTOMATIC SYNTH FALLBACK)
     --------------------------------------------------------------------- */
  function loadYouTubeAPI() {
    if (ytState.apiReady || ytState.apiLoading) return;
    if (window.YT && window.YT.Player) {
      ytState.apiReady = true;
      initYouTubePlayer();
      return;
    }
    ytState.apiLoading = true;
    const prevCb = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevCb === 'function') prevCb();
      ytState.apiReady = true;
      ytState.apiLoading = false;
      initYouTubePlayer();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => {
      ytState.apiLoading = false;
      ytState.failed = true;
      if (cfg.musicEnabled) startAmbientSynth();
      notifyUI();
    };
    document.head.appendChild(tag);
  }

  function initYouTubePlayer() {
    if (ytState.player || !window.YT || !window.YT.Player) return;
    const track = AMBIENT_TRACKS[cfg.trackId] || AMBIENT_TRACKS.yt_astroneer;
    const vid = track.ytId || AMBIENT_TRACKS.yt_astroneer.ytId;
    ytState.currentVideoId = vid;
    try {
      ytState.player = new window.YT.Player('ytMusicPlayer', {
        width: '200',
        height: '200',
        videoId: vid,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          loop: 1,
          playlist: vid,
          modestbranding: 1,
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: () => {
            ytState.ready = true;
            ytState.failed = false;
            syncGains();
            if (unlocked && cfg.musicEnabled && cfg.trackId !== 'synth') {
              playCurrentYouTubeTrack();
            }
            notifyUI();
          },
          onStateChange: e => {
            const YT = window.YT;
            if (!YT) return;
            if (e.data === YT.PlayerState.PLAYING) {
              ytState.playing = true;
              ytState.failed = false;
              clearTimeout(ytState.fallbackTimer);
              stopAmbientSynth();
              syncGains();
              notifyUI();
            } else if (e.data === YT.PlayerState.ENDED) {
              try { ytState.player.playVideo(); } catch (_) {}
            } else if (e.data === YT.PlayerState.PAUSED) {
              ytState.playing = false;
              notifyUI();
            }
          },
          onError: () => {
            ytState.playing = false;
            ytState.failed = true;
            if (cfg.musicEnabled) startAmbientSynth();
            notifyUI();
          }
        }
      });
    } catch (_) {
      ytState.failed = true;
      if (cfg.musicEnabled) startAmbientSynth();
      notifyUI();
    }
  }

  function playCurrentYouTubeTrack() {
    const track = AMBIENT_TRACKS[cfg.trackId];
    if (!track || !track.ytId) return;
    clearTimeout(ytState.fallbackTimer);

    // Graceful fallback to built-in ambient synth if YouTube is blocked or offline
    ytState.fallbackTimer = setTimeout(() => {
      if (cfg.musicEnabled && cfg.trackId !== 'synth' && !ytState.playing) {
        startAmbientSynth();
        notifyUI();
      }
    }, 6500);

    if (!ytState.apiReady) {
      loadYouTubeAPI();
      return;
    }
    if (!ytState.player) {
      initYouTubePlayer();
      return;
    }
    if (!ytState.ready) return;
    try {
      if (ytState.currentVideoId !== track.ytId) {
        ytState.currentVideoId = track.ytId;
        ytState.player.loadVideoById({ videoId: track.ytId });
      } else {
        ytState.player.playVideo();
      }
      syncGains();
    } catch (_) {
      ytState.failed = true;
      startAmbientSynth();
    }
  }

  function preloadYouTube() {
    if (cfg.musicEnabled && cfg.trackId !== 'synth') {
      loadYouTubeAPI();
    }
  }

  function stopYouTube() {
    clearTimeout(ytState.fallbackTimer);
    ytState.playing = false;
    if (ytState.player && ytState.ready) {
      try { ytState.player.pauseVideo(); } catch (_) {}
    }
  }

  function startMusic() {
    if (!cfg.musicEnabled) return;
    ensureContext();
    if (cfg.trackId === 'synth') {
      stopYouTube();
      startAmbientSynth();
    } else {
      playCurrentYouTubeTrack();
    }
    notifyUI();
  }

  function unlock() {
    if (typeof sessionGuard !== 'undefined' && sessionGuard.isLocked()) return;
    if (unlocked) {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    unlocked = true;
    ensureContext();
    syncGains();
    if (cfg.musicEnabled) startMusic();
    notifyUI();
  }

  function suspendForLock() {
    stopYouTube();
    stopAmbientSynth();
    notifyUI();
  }

  function resumeFromLock() {
    if (unlocked && cfg.musicEnabled && !cfg.musicMuted) {
      startMusic();
    }
    notifyUI();
  }

  /* =====================================================================
     EXPRESSIVE TACTILE FOLEY & ACOUSTIC SOUND EFFECTS
     Warm wooden toybox impacts, realistic water foley, crystalline chimes,
     and silky studio UI clicks with subtle stereo spread.
     ===================================================================== */

  // 1. Walking Footsteps (subtle stereo-panned warm shoe tap + grit scuff; glassy glide on ice)
  function playStep(onSlip = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.step < 115) return;
    throttle.step = nowMs;

    const t = ctx.currentTime;
    stepFootToggle = 1 - stepFootToggle;
    const footPitch = stepFootToggle === 0 ? 1.0 : 1.09;
    const pan = stepFootToggle === 0 ? -0.14 : 0.14;

    if (onSlip) {
      playFilteredNoise(true, t, 0.09, 2800 * footPitch, 4100 * footPitch, 3.6, 0.065, 0.22, 'bandpass', pan, 0.015);
      return;
    }

    // Soft padded sole thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(rand(112, 128) * footPitch, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.045);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.115, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.052);
    osc.connect(og);
    sendOut(og, 0.08, pan);
    osc.start(t);
    osc.stop(t + 0.058);

    // Subtle soft surface brush
    playFilteredNoise(true, t, 0.036, rand(920, 1280) * footPitch, 620, 1.5, 0.055, 0.1, 'bandpass', pan, 0.004);
  }

  // 1b. Climbing ladder / vine rung tap (crisp hollow wooden rung knock)
  function playClimbStep() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    stepFootToggle = 1 - stepFootToggle;
    const base = stepFootToggle ? 330 : 392;
    const pan = stepFootToggle ? -0.15 : 0.15;
    playWoodBar(base * rand(0.96, 1.04), t, 0.11, 0.075, 0.16, pan, 0.88);
    playFilteredNoise(true, t, 0.025, 1400, 900, 1.8, 0.03, 0.06, 'bandpass', pan, 0.003);
  }

  // 2. Jumping Sound (tactile organic spring-pop + velvety air lift — never beepy)
  function playJump(isWallJump = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const p = rand(0.96, 1.05) * (isWallJump ? 1.14 : 1.0);

    // Warm resonant upward wooden-pop lift
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(148 * p, t);
    osc.frequency.exponentialRampToValueAtTime(340 * p, t + 0.095);
    osc.frequency.exponentialRampToValueAtTime(295 * p, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.155, t + 0.009);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.145);
    osc.connect(og);
    sendOut(og, 0.22);
    osc.start(t);
    osc.stop(t + 0.16);

    // Subtle crisp takeoff wood-tap / wall kick transient
    playWoodBar((isWallJump ? 440 : 293.66) * p, t, isWallJump ? 0.085 : 0.055, 0.055, 0.14, 0, 1.12);

    // Silky cloth & air whoosh
    playFilteredNoise(true, t, 0.115, 480, 1750, 1.35, 0.075, 0.18, 'bandpass', 0, 0.014);
  }

  // 2b. Bouncy Spring Block launch (juicy elastic rubber-drum boing + harmonic chime)
  function playBounce() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(128, t);
    osc.frequency.exponentialRampToValueAtTime(430, t + 0.16);
    osc.frequency.exponentialRampToValueAtTime(329.63, t + 0.30);
    lfo.frequency.value = 22;
    lfoG.gain.setValueAtTime(28, t);
    lfoG.gain.exponentialRampToValueAtTime(1.5, t + 0.28);
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.21, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.33);
    osc.connect(g);
    sendOut(g, 0.32);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.35);
    lfo.stop(t + 0.35);

    playWoodBar(587.33, t + 0.018, 0.075, 0.15, 0.28, 0, 1.04);
  }

  // 3. Fall Impact / Landing Sound (warm earthy weight + soft grit settle)
  function playLand(impact = 0.5, onSlip = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const imp = clamp(impact, 0.15, 1.0);

    // Deep padded floor thump
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(98 + imp * 26, t);
    sub.frequency.exponentialRampToValueAtTime(34 + (1 - imp) * 12, t + 0.085 + imp * 0.07);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.14 + imp * 0.24, t + 0.005);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.10 + imp * 0.085);
    sub.connect(sg);
    sendOut(sg, 0.14);
    sub.start(t);
    sub.stop(t + 0.21);

    // Settling dust / gravel brush (or icy skate slide)
    playFilteredNoise(
      true,
      t,
      0.085 + imp * 0.065,
      onSlip ? 3100 : (580 + imp * 750),
      onSlip ? 1500 : 190,
      onSlip ? 2.4 : 0.9,
      0.085 + imp * 0.13,
      0.16,
      onSlip ? 'bandpass' : 'lowpass',
      0,
      0.005
    );

    // Subtle secondary heel settle on weighty landings
    if (imp > 0.52) {
      playWoodBar(138, t + 0.048, 0.065 * imp, 0.055, 0.1, rand(-0.15, 0.15), 0.72);
    }
  }

  // 4. Death Sound (expressive wooden-marionette collapse or deep underwater drown)
  function playDeath(reason = 'deadly') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    if (reason === 'drown') {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(185, t);
      sub.frequency.exponentialRampToValueAtTime(48, t + 0.42);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.22, t + 0.02);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      sub.connect(sg);
      sendOut(sg, 0.42);
      sub.start(t);
      sub.stop(t + 0.48);

      playFilteredNoise(true, t, 0.38, 680, 140, 0.9, 0.17, 0.35, 'lowpass', 0, 0.02);
      for (let i = 0; i < 4; i++) {
        const f0 = rand(250, 480) - i * 25;
        spawnBubblePop(t + 0.03 + i * 0.065, f0, f0 * 1.85, 0.075 - i * 0.01, 0.055, (i % 2 === 0 ? -0.25 : 0.25));
      }
      return;
    }

    // Warm hollow descending wood-flute / toy tumble (no harsh buzzy sawtooth)
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    const startF = reason === 'abyss' ? 293.66 : 349.23;
    osc1.frequency.setValueAtTime(startF, t);
    osc1.frequency.exponentialRampToValueAtTime(73.42, t + 0.38);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1050, t);
    filt.frequency.exponentialRampToValueAtTime(160, t + 0.40);
    filt.Q.value = 1.6;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.20, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc1.connect(filt);
    filt.connect(g);
    sendOut(g, 0.32);
    osc1.start(t);
    osc1.stop(t + 0.44);

    // 4 stereo-scattered hollow wooden toy clacks
    const clacks = [
      [0.02, 523.25, -0.35],
      [0.085, 440.00, 0.30],
      [0.16, 349.23, -0.20],
      [0.245, 261.63, 0.18]
    ];
    clacks.forEach(([off, freq, pan], idx) => {
      playWoodBar(freq * rand(0.95, 1.05), t + off, 0.105 - idx * 0.016, 0.085, 0.22, pan, 0.82);
    });

    // Soft dusty poof
    playFilteredNoise(true, t, 0.22, 760, 140, 0.85, 0.14, 0.2, 'lowpass', 0, 0.01);
  }

  function playHurt() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    // Punchy muted wooden knock + warm low impact thump
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(215, t);
    osc.frequency.exponentialRampToValueAtTime(78, t + 0.13);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(760, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.21, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(lp);
    lp.connect(g);
    sendOut(g, 0.2);
    osc.start(t);
    osc.stop(t + 0.18);

    playWoodBar(310 * rand(0.94, 1.06), t, 0.09, 0.06, 0.14, 0, 0.78);
    playFilteredNoise(true, t, 0.075, 1100, 320, 1.2, 0.095, 0.12, 'bandpass', 0, 0.004);
  }

  function playRespawn() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    // Warm comforting D-major ascending revival bloom
    const notes = [293.66, 440.00, 587.33, 739.99];
    notes.forEach((f, i) => {
      const pan = -0.24 + i * 0.16;
      playCrystalBell(f, t + i * 0.055, 0.085, 0.34, 0.44, pan);
    });
    playFilteredNoise(true, t, 0.24, 420, 1650, 1.2, 0.05, 0.28, 'bandpass', 0, 0.04);
  }

  // 5. Liquid Sounds: Splash Entry / Exit, Liquid Jump, Swim Strokes, Breath & Gasp
  function spawnBubblePop(startT, startFreq, endFreq, vol = 0.075, dur = 0.058, pan = 0) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(startFreq, startT);
    o.frequency.exponentialRampToValueAtTime(endFreq, startT + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur + 0.014);
    o.connect(g);
    sendOut(g, 0.36, pan);
    o.start(startT);
    o.stop(startT + dur + 0.022);
  }

  function spawnDropletPlink(startT, freq, vol = 0.055, pan = 0) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, startT);
    o.frequency.exponentialRampToValueAtTime(freq * 1.56, startT + 0.026);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + 0.036);
    o.connect(g);
    sendOut(g, 0.40, pan);
    o.start(startT);
    o.stop(startT + 0.044);
  }

  function playSplash(exiting = false, impact = 0.65) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.splash < 140) return;
    throttle.splash = nowMs;

    const t = ctx.currentTime;
    const imp = clamp(impact, 0.25, 1.2);

    if (exiting) {
      // Smooth upward surface-tension glug
      const breakOsc = ctx.createOscillator();
      breakOsc.type = 'sine';
      breakOsc.frequency.setValueAtTime(165, t);
      breakOsc.frequency.exponentialRampToValueAtTime(420, t + 0.10);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.13 * imp, t + 0.012);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      breakOsc.connect(bg);
      sendOut(bg, 0.26);
      breakOsc.start(t);
      breakOsc.stop(t + 0.17);

      // Lightweight frothy shedding wash
      playFilteredNoise(true, t, 0.25, 680, 2100, 1.0, 0.18 * imp, 0.30, 'bandpass', 0, 0.018);

      // 2 stereo settling drips
      spawnDropletPlink(t + 0.065, rand(720, 1080), 0.05 * imp, -0.25);
      spawnDropletPlink(t + 0.125, rand(900, 1340), 0.04 * imp, 0.25);
      return;
    }

    // Entry Splash: 1. Warm water-cavity plunge bloop
    const gulp = ctx.createOscillator();
    gulp.type = 'sine';
    gulp.frequency.setValueAtTime(178 + imp * 48, t);
    gulp.frequency.exponentialRampToValueAtTime(58, t + 0.085);
    gulp.frequency.exponentialRampToValueAtTime(172, t + 0.19);
    const gulpG = ctx.createGain();
    gulpG.gain.setValueAtTime(0.0001, t);
    gulpG.gain.linearRampToValueAtTime(0.22 * imp, t + 0.01);
    gulpG.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    gulp.connect(gulpG);
    sendOut(gulpG, 0.28);
    gulp.start(t);
    gulp.stop(t + 0.24);

    // 2. Velvety water-curtain wash (single lightweight bandpass graph)
    playFilteredNoise(true, t, 0.30, 1180, 460, 0.95, 0.24 * imp, 0.32, 'bandpass', 0, 0.016);

    // 3. 2-3 stereo underwater bubbles + 1 crisp droplet plink
    const bubbleCount = imp > 0.75 ? 3 : 2;
    for (let i = 0; i < bubbleCount; i++) {
      const f0 = rand(320, 620);
      spawnBubblePop(
        t + 0.03 + i * rand(0.042, 0.064),
        f0,
        f0 * rand(1.85, 2.2),
        rand(0.045, 0.078) * Math.min(1.05, imp + 0.1),
        rand(0.048, 0.068),
        (i % 2 === 0 ? -0.28 : 0.28)
      );
    }
    spawnDropletPlink(t + 0.15, rand(820, 1220), 0.042 * imp, rand(-0.2, 0.2));
  }

  function playLiquidJump() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(195, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    sendOut(g, 0.32);
    o.start(t);
    o.stop(t + 0.18);

    playFilteredNoise(true, t, 0.24, 780, 2600, 1.1, 0.18, 0.34, 'bandpass', 0, 0.016);
    spawnBubblePop(t + 0.02, 440, 980, 0.07, 0.055, -0.2);
    spawnDropletPlink(t + 0.10, rand(860, 1220), 0.05, 0.24);
  }

  function playSwimStroke(upward = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.swim < 270) return;
    throttle.swim = nowMs;

    const t = ctx.currentTime;
    const pan = rand(-0.22, 0.22);
    // Soft cupped-hand underwater displacement pulse
    const push = ctx.createOscillator();
    push.type = 'sine';
    push.frequency.setValueAtTime(upward ? 108 : 90, t);
    push.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.0001, t);
    pg.gain.linearRampToValueAtTime(0.09, t + 0.026);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    push.connect(pg);
    sendOut(pg, 0.24, pan);
    push.start(t);
    push.stop(t + 0.15);

    playFilteredNoise(true, t, 0.22, upward ? 320 : 250, upward ? 840 : 620, 1.6, 0.135, 0.34, 'bandpass', pan, 0.04);
    const b0 = rand(280, 440);
    spawnBubblePop(t + 0.035, b0, b0 * 1.95, 0.052, 0.055, -pan);
  }

  function playBreathPop(remaining = 5) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const urgent = remaining <= 2;
    const baseF = urgent ? rand(540, 680) : rand(390, 510);
    spawnBubblePop(t, baseF, baseF * (urgent ? 2.2 : 1.92), urgent ? 0.095 : 0.068, 0.048, rand(-0.15, 0.15));
  }

  function playGasp() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(true, t, 0.17, 780, 2150, 1.4, 0.095, 0.22, 'bandpass', 0, 0.035);
    playCrystalBell(587.33, t + 0.02, 0.032, 0.18, 0.32, 0);
  }

  function playDrownHurt() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(132, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.17, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(lp);
    lp.connect(g);
    sendOut(g, 0.30);
    osc.start(t);
    osc.stop(t + 0.20);

    const f0 = rand(270, 410);
    spawnBubblePop(t + 0.02, f0, f0 * 1.88, 0.065, 0.055, rand(-0.2, 0.2));
  }

  // 6. Creation Success Sound (warm wooden anchor + sparkling Dmaj9 celesta bloom)
  function playCreateSuccess() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    // Warm marimba root anchor (D4)
    playWoodBar(293.66, t, 0.14, 0.45, 0.34, -0.15, 1.0);

    // Sparkling ascending Dmaj9 music-box cascade spread across stereo
    const notes = [587.33, 739.99, 880.00, 1108.73, 1318.51];
    notes.forEach((freq, i) => {
      const st = t + i * 0.048;
      const pan = -0.36 + (i / (notes.length - 1)) * 0.72;
      const dur = i === notes.length - 1 ? 0.75 : 0.40;
      playCrystalBell(freq, st, i === notes.length - 1 ? 0.135 : 0.10, dur, 0.48, pan);
    });
  }

  // 7. Cookie Crunch Sound on Block Delete (crisp, organic dry biscuit snap & wooden crumble)
  function playCookieCrunch() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.crunch < 48) return;
    throttle.crunch = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.91, 1.11);

    // Warm dry wooden bite weight
    playWoodBar(195 * p, t, 0.115, 0.045, 0.08, rand(-0.15, 0.15), 0.58);

    // 3 tight stereo-spread crispy biscuit fracture grains (organic & ultra-lightweight)
    const grains = [
      { off: 0.000, freq: 2350, q: 1.7, dur: 0.026, amp: 0.24, pan: -0.22 },
      { off: 0.022, freq: 1480, q: 2.0, dur: 0.030, amp: 0.21, pan: 0.24 },
      { off: 0.048, freq: 3150, q: 1.9, dur: 0.024, amp: 0.18, pan: -0.10 }
    ];
    for (let i = 0; i < grains.length; i++) {
      const gr = grains[i];
      const gt = t + gr.off + rand(0, 0.006);
      playFilteredNoise(false, gt, gr.dur, gr.freq * p, gr.freq * p * 0.78, gr.q, gr.amp, 0.08, 'bandpass', gr.pan, 0.0025);
    }
  }

  // 7b. Place Block / Background Effect Placement (addictive tactile woodblock snap or airy shimmer)
  function playPlaceBlock(isBgEffect = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.place < 36) return;
    throttle.place = nowMs;

    const t = ctx.currentTime;
    if (isBgEffect) {
      // Soft atmospheric shimmer bloom (D5 + A5)
      playCrystalBell(587.33 * rand(0.99, 1.01), t, 0.068, 0.42, 0.52, -0.2);
      playCrystalBell(880.00 * rand(0.99, 1.01), t + 0.045, 0.056, 0.46, 0.55, 0.2);
      playFilteredNoise(true, t, 0.22, 900, 1800, 1.2, 0.03, 0.35, 'bandpass', 0, 0.05);
      return;
    }

    // Tactile Nintendo/wooden-toy block snap
    const p = rand(0.93, 1.09);
    playWoodBar(355 * p, t, 0.135, 0.058, 0.14, rand(-0.12, 0.12), 0.76);
    playFilteredNoise(false, t, 0.014, 2400 * p, 1400 * p, 1.8, 0.042, 0.05, 'bandpass', 0, 0.002);
  }

  // 7c. Block Pickup / Redo (crisp bouncy two-note wooden pop)
  function playPickup() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const p = rand(0.97, 1.03);
    playWoodBar(440 * p, t, 0.105, 0.065, 0.18, -0.1, 1.15);
    playWoodBar(659.25 * p, t + 0.028, 0.095, 0.09, 0.24, 0.12, 1.04);
  }

  // 8. Deselect / Undo Sound (soft downward wooden tuck + velvety air flick)
  function playDeselect() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const p = rand(0.97, 1.03);
    playWoodBar(587.33 * p, t, 0.095, 0.075, 0.20, 0.1, 0.9);
    playWoodBar(392.00 * p, t + 0.034, 0.088, 0.095, 0.22, -0.12, 0.86);
    playFilteredNoise(true, t, 0.085, 1650, 520, 1.25, 0.048, 0.18, 'bandpass', 0, 0.01);
  }

  // 9. Tactile Button Sounds (precision dark-studio mechanical switch click)
  function playButton(variant = 'default') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.btn < 28) return;
    throttle.btn = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.96, 1.05);
    const baseF = variant === 'primary' ? 680 : (variant === 'soft' ? 490 : 580);
    const amp = variant === 'soft' ? 0.055 : 0.082;

    playWoodBar(baseF * p, t, amp, 0.032, 0.07, 0, 0.62);
    playFilteredNoise(false, t, 0.011, 3100 * p, 2200 * p, 2.2, 0.036, 0.04, 'bandpass', 0, 0.0015);
  }

  // 10. Menu Swipe Away / Restore Sound (velvety air swoosh + subtle wooden dock snap)
  function playMenuSwipe(hiding = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(
      true,
      t,
      0.18,
      hiding ? 1850 : 360,
      hiding ? 320 : 1750,
      1.25,
      0.125,
      0.22,
      'bandpass',
      hiding ? 0.2 : -0.2,
      0.04
    );
    const st = hiding ? t + 0.025 : t + 0.085;
    playWoodBar(hiding ? 440 : 523.25, st, 0.062, 0.075, 0.18, 0, hiding ? 0.72 : 1.18);
  }

  // Extra tactile toybox foley for Body Equip, Gatherables, Switches, Portals, Emitters
  function playBodyEquip(equipping = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(true, t, 0.09, 800, equipping ? 1900 : 550, 1.2, 0.055, 0.16, 'bandpass', 0, 0.015);
    const seq = equipping ? [392.00, 587.33, 739.99] : [587.33, 392.00];
    seq.forEach((f, i) => {
      playWoodBar(f, t + i * 0.042, 0.095, 0.17, 0.28, (i - 1) * 0.18, 1.0);
    });
  }

  function playCollect() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const seq = [739.99, 1108.73, 1479.98];
    seq.forEach((f, i) => {
      playCrystalBell(f, t + i * 0.038, 0.095, 0.28, 0.42, (i - 1) * 0.25);
    });
  }

  function playSwitch(on = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    // Two-stage tactile lever click
    playFilteredNoise(false, t, 0.014, 2800, 1800, 2.0, 0.06, 0.06, 'bandpass', 0, 0.002);
    playWoodBar(on ? 392.00 : 523.25, t, 0.11, 0.048, 0.14, 0, on ? 1.24 : 0.74);
    playWoodBar(on ? 587.33 : 349.23, t + 0.026, 0.095, 0.075, 0.18, 0, 1.0);
  }

  function playPortal() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(true, t, 0.28, 420, 2200, 1.4, 0.085, 0.42, 'bandpass', 0, 0.04);
    const freqs = [293.66, 440.00, 587.33, 880.00];
    freqs.forEach((f, i) => {
      const st = t + i * 0.036;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * 1.38, st + 0.24);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.078, st + 0.022);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.28);
      o.connect(g);
      sendOut(g, 0.48, -0.35 + i * 0.23);
      o.start(st);
      o.stop(st + 0.30);
    });
  }

  function playEmit() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playWoodBar(520 * rand(0.95, 1.05), t, 0.105, 0.07, 0.16, 0, 0.56);
    playFilteredNoise(true, t, 0.065, 1800, 620, 1.5, 0.055, 0.14, 'bandpass', 0, 0.004);
  }

  return {
    cfg,
    unlock,
    preloadYouTube,
    suspendForLock,
    resumeFromLock,
    getStatus() {
      if (!unlocked) return { playing: false, text: 'CLICK ANYWHERE TO START' };
      if (!cfg.musicEnabled || cfg.musicMuted) return { playing: false, text: 'AMBIENT PAUSED' };
      const tr = AMBIENT_TRACKS[cfg.trackId] || AMBIENT_TRACKS.yt_astroneer;
      if (cfg.trackId === 'synth') return { playing: synthState.active, text: 'PLAYING: TOYBOX DRIFT' };
      if (ytState.playing) return { playing: true, text: 'YT: ' + tr.label };
      if (synthState.active) return { playing: true, text: 'SYNTH FALLBACK ACTIVE' };
      return { playing: false, text: 'LOADING YT AMBIENT...' };
    },
    setSfxVol(v) {
      cfg.sfxVol = clamp(v, 0, 1);
      if (cfg.sfxVol > 0) cfg.sfxMuted = false;
      syncGains();
      notifyUI();
    },
    setMusicVol(v) {
      cfg.musicVol = clamp(v, 0, 1);
      if (cfg.musicVol > 0) cfg.musicMuted = false;
      syncGains();
      notifyUI();
    },
    toggleSfxMute() {
      cfg.sfxMuted = !cfg.sfxMuted;
      syncGains();
      notifyUI();
    },
    toggleMusicMute() {
      cfg.musicMuted = !cfg.musicMuted;
      syncGains();
      notifyUI();
    },
    toggleMusicEnabled() {
      unlock();
      cfg.musicEnabled = !cfg.musicEnabled;
      if (cfg.musicEnabled) {
        cfg.musicMuted = false;
        startMusic();
      } else {
        stopYouTube();
        stopAmbientSynth();
      }
      syncGains();
      notifyUI();
    },
    setTrack(trackId) {
      if (!AMBIENT_TRACKS[trackId]) return;
      unlock();
      cfg.trackId = trackId;
      cfg.musicEnabled = true;
      cfg.musicMuted = false;
      if (trackId === 'synth') {
        stopYouTube();
        startAmbientSynth();
      } else {
        stopAmbientSynth();
        playCurrentYouTubeTrack();
      }
      syncGains();
      notifyUI();
    },
    applySavedPrefs(p) {
      if (!p || typeof p !== 'object') return;
      if (Number.isFinite(p.sfxVol)) cfg.sfxVol = clamp(p.sfxVol, 0, 1);
      if (Number.isFinite(p.musicVol)) cfg.musicVol = clamp(p.musicVol, 0, 1);
      if (typeof p.sfxMuted === 'boolean') cfg.sfxMuted = p.sfxMuted;
      if (typeof p.musicMuted === 'boolean') cfg.musicMuted = p.musicMuted;
      if (typeof p.musicEnabled === 'boolean') cfg.musicEnabled = p.musicEnabled;
      if (p.musicTrack && AMBIENT_TRACKS[p.musicTrack]) cfg.trackId = p.musicTrack;
      syncGains();
    },
    playStep,
    playClimbStep,
    playJump,
    playBounce,
    playLand,
    playDeath,
    playHurt,
    playRespawn,
    playSplash,
    playLiquidJump,
    playSwimStroke,
    playBreathPop,
    playGasp,
    playDrownHurt,
    playCreateSuccess,
    playCookieCrunch,
    playPlaceBlock,
    playPickup,
    playDeselect,
    playButton,
    playMenuSwipe,
    playBodyEquip,
    playCollect,
    playSwitch,
    playPortal,
    playEmit
  };
})();
