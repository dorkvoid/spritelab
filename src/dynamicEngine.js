import { clamp } from './utils.js';

/* =========================================================================
   SPRITELAB LAYERED DYNAMIC ENGINE (1-9 INDEPENDENT CELS + SCRIPT COMPILER)
   Supports visual action cards AND Manyland-compatible Dynamic scripting:
   timestamps/ranges (0s:, 2-5s:, +0.5s:), markers (MOVE, RISE, FALL,
   ACTION, SIT, LIE, CLIMB, SWIM, START), cell/cells targeting, move,
   position, rotate/rotation, pivot, scale, opacity/show/hide, flip,
   z-index, bright/unbright, light, accelerate, analog clock hands,
   text/font/align, say, play sound, restart, and remove.
   ========================================================================= */

export const DYNAMIC_MARKER_LIST = ['DEFAULT', 'MOVE', 'RISE', 'FALL', 'ACTION', 'SIT', 'LIE', 'CLIMB', 'SWIM', 'START'];

const MARKER_ALIASES = {
  DEFAULT: 'DEFAULT',
  IDLE: 'DEFAULT',
  MOVE: 'MOVE',
  MOVES: 'MOVE',
  WALK: 'MOVE',
  RISE: 'RISE',
  RISES: 'RISE',
  JUMP: 'RISE',
  FALL: 'FALL',
  FALLS: 'FALL',
  ACTION: 'ACTION',
  ACT: 'ACTION',
  SIT: 'SIT',
  SITS: 'SIT',
  LIE: 'LIE',
  LIES: 'LIE',
  LAY: 'LIE',
  CLIMB: 'CLIMB',
  CLIMBS: 'CLIMB',
  SWIM: 'SWIM',
  SWIMS: 'SWIM',
  START: 'START',
  STARTS: 'START'
};

export const DYNAMIC_RECIPES = [
  {
    id: 'floating',
    label: 'FLOATING HOVER',
    desc: 'Smoothly bobs up and down.',
    loopSec: 3,
    mode: 'WORLD',
    script: '0s: cells show\n0-1.5s: cell 1 up 5\n1.5-3s: cell 1 down 5\n3s: restart'
  },
  {
    id: 'spinning',
    label: 'SPINNING GEAR',
    desc: 'Spins 360 degrees smoothly.',
    loopSec: 3,
    mode: 'WORLD',
    script: '0s: cells show\n0-3s: cell 1 rotate 360\n3s: restart'
  },
  {
    id: 'chimney',
    label: 'SMOKING CHIMNEY',
    desc: 'Cel 1 stays put while Cel 2 rises and fades like smoke.',
    loopSec: 4,
    mode: 'WORLD',
    script: '0s: cells show, cell 1 z-index 2, cell 2 z-index 1\n0.5-3.5s: cell 2 up 26, right 5\n2.4-3.6s: cell 2 hide\n4s: restart'
  },
  {
    id: 'swinging',
    label: 'SWINGING ARM / PENDULUM',
    desc: 'Cel 1 base + Cel 2 rocks gently around its pivot.',
    loopSec: 2,
    mode: 'WORLD',
    script: '0s: cells show\n0-1s: cell 2 rotate -42\n1-2s: cell 2 rotate 42\n2s: restart'
  },
  {
    id: 'clock',
    label: 'REAL ANALOG CLOCK',
    desc: 'Cel 1 face, Cel 2 hour, Cel 3 minute, Cel 4 ticking second hand.',
    loopSec: 15,
    mode: 'WORLD',
    script: '0s: cells show, cell 2 hours angle, cell 3 minutes angle, cell 4 seconds angle in steps'
  },
  {
    id: 'flutter',
    label: 'FLUTTERING WINGS / FAIRY',
    desc: 'Floating sparkle pulse great for Follows companions.',
    loopSec: 1.6,
    mode: 'FOLLOWS',
    script: '0s: cells show, cell 2 bright\n0-0.8s: cell 1 up 3, cell 2 scale 1.18, opacity 0.95\n0.8-1.6s: cell 1 down 3, cell 2 scale 0.88, opacity 0.45\n1.6s: restart'
  },
  {
    id: 'glow_sign',
    label: 'GLOWING CLOCK SIGN',
    desc: 'Bright pulsing frame showing live [time].',
    loopSec: 3,
    mode: 'WORLD',
    script: '0s: cell 1 show, bright, font white, text [time]\n0-1.5s: cell 1 opacity 0.65\n1.5-3s: cell 1 opacity 1\n3s: restart'
  },
  {
    id: 'mech',
    label: 'GIANT MECH / ACTION SUIT',
    desc: 'Attachable suit with IDLE breath, MOVE stride, RISE jet, and ACTION swing.',
    loopSec: 2,
    mode: 'ATTACHABLE',
    actionable: true,
    script: [
      '0s: cells show',
      '0-1s: cell 1 up 1, cell 2 down 1',
      '1-2s: cell 1 down 1, cell 2 up 1',
      '2s: restart',
      '',
      'MOVE',
      '0s: cells show',
      '0-0.25s: cell 2 rotate 22, cell 3 rotate -22',
      '0.25-0.5s: cell 2 rotate -22, cell 3 rotate 22',
      '0.5s: restart',
      '',
      'RISE',
      '0s: cells show, cell 3 bright, light 242 140 56',
      '0-0.4s: cell 3 down 3, scale 1.15',
      '0.4s: restart',
      '',
      'ACTION',
      '0s: cells show, play sound',
      '0-0.25s: cell 2 rotate -75',
      '0.25-0.6s: cell 2 rotate 75'
    ].join('\n')
  }
];

export function legacyDynamicSubtypeToScript(legacySubType) {
  switch (legacySubType) {
    case 'SPIN':
      return '0s: cells show\n0-3.2s: cells rotate 360\n3.2s: restart';
    case 'FLOAT':
      return '0s: cells show\n0-1.4s: cells up 5\n1.4-2.8s: cells down 5\n2.8s: restart';
    case 'PULSE':
      return '0s: cells show\n0-1.1s: cells scale 1.16\n1.1-2.2s: cells scale 1\n2.2s: restart';
    case 'SWAY':
      return '0s: cells show\n0-0.7s: cells rotate 16\n0.7-2.1s: cells rotate -32\n2.1-2.8s: cells rotate 16\n2.8s: restart';
    case 'FADE':
      return '0s: cells show\n0-1.4s: cells opacity 0.25\n1.4-2.8s: cells opacity 1\n2.8s: restart';
    case 'ORBIT':
      return '0s: cells show\n0-0.8s: cells right 4, up 4\n0.8-1.6s: cells left 4, up 4\n1.6-2.4s: cells left 4, down 4\n2.4-3.2s: cells right 4, down 4\n3.2s: restart';
    default:
      return '0s: cells show\n0-2s: cell 1 up 4\n2-4s: cell 1 down 4\n4s: restart';
  }
}

function stripComments(raw) {
  let out = String(raw || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = out.split(/\r?\n/);
  return lines.map(line => {
    // Strip // comments except inside URLs (://)
    let idx = -1;
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] === '/' && line[i + 1] === '/' && (i === 0 || line[i - 1] !== ':')) {
        idx = i;
        break;
      }
    }
    return (idx >= 0 ? line.slice(0, idx) : line).trim();
  });
}

function splitUnescapedCommas(str) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\' && i + 1 < str.length && (str[i + 1] === ',' || str[i + 1] === ':')) {
      cur += str[i + 1];
      i++;
    } else if (str[i] === ',') {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else {
      cur += str[i];
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseTargetPrefix(rawCmd) {
  const s = rawCmd.trim();
  let m = s.match(/^cells\s+(\d+(?:\+\d+)*)\s+([\s\S]+)$/i);
  if (m) {
    const cels = m[1].split('+').map(n => clamp(parseInt(n, 10) || 1, 1, 9));
    return { target: { all: false, cels }, rest: m[2].trim() };
  }
  m = s.match(/^cell\s+(\d+(?:\+\d+)*)\s+([\s\S]+)$/i);
  if (m) {
    const cels = m[1].split('+').map(n => clamp(parseInt(n, 10) || 1, 1, 9));
    return { target: { all: false, cels }, rest: m[2].trim() };
  }
  m = s.match(/^cells\s+([\s\S]+)$/i);
  if (m) {
    return { target: { all: true, cels: null }, rest: m[1].trim() };
  }
  return { target: null, rest: s };
}

function parseTimeToken(token, lastTime) {
  const clean = token.trim().replace(/s$/i, '');
  if (!clean) return null;
  if (clean.startsWith('+')) {
    const v = parseFloat(clean.slice(1));
    return Number.isFinite(v) ? Math.max(0, lastTime + v) : null;
  }
  const v = parseFloat(clean);
  return Number.isFinite(v) ? Math.max(0, v) : null;
}

function parseSingleCommand(rawRest, target, start, end) {
  const rest = rawRest.trim();
  if (!rest) return null;
  const low = rest.toLowerCase();

  if (low === 'restart') return { start, end: start, target: null, op: 'restart' };
  if (low === 'remove') return { start, end: start, target: null, op: 'remove' };
  if (low === 'play sound' || low === 'sound') return { start, end: start, target: null, op: 'sound' };

  let m;
  if ((m = rest.match(/^say\s+([\s\S]+)$/i))) {
    return { start, end: start, target: null, op: 'say', text: m[1].trim() };
  }

  const tgt = target || { all: false, cels: [1] };

  if (low === 'show') return { start, end, target: tgt, op: 'opacity', val: 1 };
  if (low === 'hide') return { start, end, target: tgt, op: 'opacity', val: 0 };
  if (low === 'bright') return { start, end: start, target: tgt, op: 'bright', val: true };
  if (low === 'unbright') return { start, end: start, target: tgt, op: 'bright', val: false };

  if (low === 'flip horizontal' || low === 'flip h' || low === 'flip') {
    return { start, end: start, target: tgt, op: 'flipH' };
  }
  if (low === 'flip vertical' || low === 'flip v') {
    return { start, end: start, target: tgt, op: 'flipV' };
  }

  if (low === 'seconds angle') return { start, end: start, target: tgt, op: 'clock', unit: 'sec', stepped: false };
  if (low === 'seconds angle in steps') return { start, end: start, target: tgt, op: 'clock', unit: 'sec', stepped: true };
  if (low === 'minutes angle') return { start, end: start, target: tgt, op: 'clock', unit: 'min', stepped: false };
  if (low === 'minutes angle in steps') return { start, end: start, target: tgt, op: 'clock', unit: 'min', stepped: true };
  if (low === 'hours angle') return { start, end: start, target: tgt, op: 'clock', unit: 'hr', stepped: false };
  if (low === 'hours angle in steps') return { start, end: start, target: tgt, op: 'clock', unit: 'hr', stepped: true };

  if ((m = rest.match(/^up\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'moveRel', dx: 0, dy: -parseFloat(m[1]) };
  }
  if ((m = rest.match(/^down\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'moveRel', dx: 0, dy: parseFloat(m[1]) };
  }
  if ((m = rest.match(/^left\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'moveRel', dx: -parseFloat(m[1]), dy: 0 };
  }
  if ((m = rest.match(/^right\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'moveRel', dx: parseFloat(m[1]), dy: 0 };
  }
  if ((m = rest.match(/^position\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'posAbs', x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }
  if ((m = rest.match(/^opacity\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'opacity', val: clamp(parseFloat(m[1]), 0, 1) };
  }
  if ((m = rest.match(/^rotate\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'rotRel', deg: parseFloat(m[1]) };
  }
  if ((m = rest.match(/^rotation\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'rotAbs', deg: parseFloat(m[1]) };
  }
  if ((m = rest.match(/^scale\s+(-?\d*\.?\d+)$/i))) {
    return { start, end, target: tgt, op: 'scale', val: clamp(parseFloat(m[1]), 0.1, 4.0) };
  }
  if ((m = rest.match(/^pivot\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)$/i))) {
    return { start, end: start, target: tgt, op: 'pivot', x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }
  if ((m = rest.match(/^z-?index\s+(\d+)$/i))) {
    return { start, end: start, target: tgt, op: 'zIndex', val: clamp(parseInt(m[1], 10) || 1, 1, 9) };
  }
  if ((m = rest.match(/^light\s+(\d+)\s+(\d+)\s+(\d+)$/i))) {
    return {
      start,
      end,
      target: tgt,
      op: 'light',
      r: clamp(parseInt(m[1], 10), 0, 255),
      g: clamp(parseInt(m[2], 10), 0, 255),
      b: clamp(parseInt(m[3], 10), 0, 255)
    };
  }
  if ((m = rest.match(/^accelerate\s+(up|down|left|right)\s+(-?\d*\.?\d+)$/i))) {
    const dir = m[1].toLowerCase();
    // Scale Manyland-style tiny per-tick values (e.g. 0.02) smoothly into logical px/s^2
    const rawVal = parseFloat(m[2]);
    const accel = Math.abs(rawVal) <= 1 ? rawVal * 3200 : rawVal;
    return {
      start,
      end: start,
      target: tgt,
      op: 'accel',
      ax: dir === 'left' ? -accel : (dir === 'right' ? accel : 0),
      ay: dir === 'up' ? -accel : (dir === 'down' ? accel : 0)
    };
  }
  if ((m = rest.match(/^text\s+([\s\S]+)$/i))) {
    return { start, end: start, target: tgt, op: 'text', text: m[1].trim() };
  }
  if ((m = rest.match(/^font\s+([\s\S]+)$/i))) {
    return { start, end: start, target: tgt, op: 'font', font: m[1].trim().toLowerCase() };
  }
  if ((m = rest.match(/^align\s+(left|center|right)$/i))) {
    return { start, end: start, target: tgt, op: 'align', align: m[1].toLowerCase() };
  }
  return null;
}

const programCache = new Map();

export function compileDynamicProgram(rawScript) {
  const scriptStr = String(rawScript || '');
  const cached = programCache.get(scriptStr);
  if (cached) return cached;

  const lines = stripComments(scriptStr);
  const nonEmpty = lines.filter(Boolean);

  // Manyland Text-Only Dynamic shorthand: script without any colons becomes floating white text
  if (nonEmpty.length > 0 && !scriptStr.includes(':')) {
    const joined = nonEmpty.join('[break]');
    const prog = {
      markers: {
        DEFAULT: {
          commands: [
            { start: 0, end: 0, target: { all: false, cels: [1] }, op: 'opacity', val: 1 },
            { start: 0, end: 0, target: { all: false, cels: [1] }, op: 'font', font: 'white' },
            { start: 0, end: 0, target: { all: false, cels: [1] }, op: 'text', text: joined }
          ],
          restartAt: null,
          hasVisibilityCmd: true
        }
      },
      errors: [],
      stepCount: 1
    };
    if (programCache.size > 200) programCache.clear();
    programCache.set(scriptStr, prog);
    return prog;
  }

  const markers = {
    DEFAULT: { commands: [], restartAt: null, hasVisibilityCmd: false }
  };
  const errors = [];
  let curMarker = 'DEFAULT';
  let curStart = 0;
  let curEnd = 0;
  let lastTime = 0;
  let lastTarget = { all: false, cels: [1] };
  let stepCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Check standalone marker header (e.g. MOVE, RISE, FALL, ACTION, SIT, LIE, CLIMB, SWIM, START)
    const upperKey = line.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!line.includes(':') && MARKER_ALIASES[upperKey]) {
      curMarker = MARKER_ALIASES[upperKey];
      if (!markers[curMarker]) {
        markers[curMarker] = { commands: [], restartAt: null, hasVisibilityCmd: false };
      }
      curStart = 0;
      curEnd = 0;
      lastTime = 0;
      lastTarget = { all: false, cels: [1] };
      continue;
    }

    let body = line;
    // Match timestamp header at line start: `0s:`, `1.5:`, `2-5s:`, `+0.5-+2.5:`
    const timeMatch = line.match(/^(\+?\d*\.?\d+s?(?:\s*-\s*\+?\d*\.?\d+s?)?)\s*:\s*([\s\S]*)$/i);
    if (timeMatch) {
      const rangePart = timeMatch[1];
      body = timeMatch[2].trim();
      const dashIdx = rangePart.indexOf('-', 1);
      if (dashIdx > 0) {
        const sTok = rangePart.slice(0, dashIdx);
        const eTok = rangePart.slice(dashIdx + 1);
        const t0 = parseTimeToken(sTok, lastTime);
        const t1 = parseTimeToken(eTok, t0 !== null ? t0 : lastTime);
        if (t0 !== null && t1 !== null) {
          curStart = t0;
          curEnd = Math.max(t0, t1);
          lastTime = curEnd;
        } else {
          errors.push(`Line ${i + 1}: invalid time range "${rangePart}"`);
          continue;
        }
      } else {
        const t0 = parseTimeToken(rangePart, lastTime);
        if (t0 !== null) {
          curStart = t0;
          curEnd = t0;
          lastTime = t0;
        } else {
          errors.push(`Line ${i + 1}: invalid time "${rangePart}"`);
          continue;
        }
      }
      lastTarget = { all: false, cels: [1] };
      if (!body) continue;
    }

    const parts = splitUnescapedCommas(body);
    const sec = markers[curMarker];
    for (let p = 0; p < parts.length; p++) {
      const parsedTgt = parseTargetPrefix(parts[p]);
      if (parsedTgt.target) lastTarget = parsedTgt.target;
      const cmd = parseSingleCommand(parsedTgt.rest, lastTarget, curStart, curEnd);
      if (!cmd) {
        errors.push(`Line ${i + 1}: "${parts[p]}"`);
        continue;
      }
      stepCount++;
      if (cmd.op === 'restart') {
        if (sec.restartAt === null || cmd.start < sec.restartAt) {
          sec.restartAt = cmd.start;
        }
      } else {
        if (cmd.op === 'opacity') sec.hasVisibilityCmd = true;
        sec.commands.push(cmd);
      }
    }
  }

  for (const sec of Object.values(markers)) {
    sec.commands.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  }

  const prog = { markers, errors, stepCount };
  if (programCache.size > 200) programCache.clear();
  programCache.set(scriptStr, prog);
  return prog;
}

function expandPlaceholders(rawText, ctxInfo) {
  let s = String(rawText || '').replace(/\[break\]/gi, '\n').replace(/\[comma\]/gi, ',');
  if (!s.includes('[')) return s;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  s = s.replace(/\[time\]/gi, timeStr);
  s = s.replace(/\[date\]/gi, dateStr);
  s = s.replace(/\[name\]/gi, (ctxInfo && (ctxInfo.playerName || ctxInfo.name)) || 'YOU');
  s = s.replace(/\[area\]/gi, (ctxInfo && (ctxInfo.worldName || ctxInfo.area)) || 'WORLD');
  return s;
}

export function evaluateDynamicFrame(program, markerName, rawTime, celCount, size, pivots = null, ctxInfo = null) {
  const count = clamp(celCount || 1, 1, 9);
  const half = (size || 29) * 0.5;
  const sec = (program && program.markers && (program.markers[markerName] || program.markers.DEFAULT))
    || { commands: [], restartAt: null, hasVisibilityCmd: false };

  const loopLen = (sec.restartAt !== null && sec.restartAt > 0.02) ? sec.restartAt : null;
  const t = loopLen ? (((rawTime % loopLen) + loopLen) % loopLen) : Math.max(0, rawTime);
  const cycleNum = loopLen ? Math.floor(Math.max(0, rawTime) / loopLen) : 0;

  const cels = new Array(count);
  for (let i = 0; i < count; i++) {
    const pv = pivots && pivots[String(i + 1)];
    cels[i] = {
      idx: i,
      x: 0,
      y: 0,
      rot: 0,
      scale: 1,
      opacity: sec.hasVisibilityCmd ? 0 : 1,
      visible: true,
      pivotX: (pv && Number.isFinite(pv.x)) ? pv.x : half,
      pivotY: (pv && Number.isFinite(pv.y)) ? pv.y : half,
      flipH: false,
      flipV: false,
      z: i + 1,
      bright: false,
      light: null,
      text: null,
      font: 'small white',
      align: 'center'
    };
  }

  let shouldRemove = false;
  let activeSay = null;
  let activeSoundKey = null;
  let nowDate = null;

  const cmds = sec.commands;
  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    if (t + 1e-6 < cmd.start) continue;

    if (cmd.op === 'remove') {
      shouldRemove = true;
      continue;
    }
    if (cmd.op === 'say') {
      if (t - cmd.start < 0.35) {
        activeSay = { text: expandPlaceholders(cmd.text, ctxInfo), key: `${cycleNum}:${i}` };
      }
      continue;
    }
    if (cmd.op === 'sound') {
      if (t - cmd.start < 0.25) {
        activeSoundKey = `${cycleNum}:${i}`;
      }
      continue;
    }

    const p = cmd.end <= cmd.start ? 1 : clamp((t - cmd.start) / (cmd.end - cmd.start), 0, 1);
    const tgt = cmd.target;
    const indices = (tgt && !tgt.all && Array.isArray(tgt.cels))
      ? tgt.cels
      : null;

    const applyTo = cel => {
      switch (cmd.op) {
        case 'opacity':
          cel.opacity = cel.opacity + (cmd.val - cel.opacity) * p;
          break;
        case 'moveRel':
          cel.x += cmd.dx * p;
          cel.y += cmd.dy * p;
          break;
        case 'posAbs':
          cel.x = cel.x + (cmd.x - cel.x) * p;
          cel.y = cel.y + (cmd.y - cel.y) * p;
          break;
        case 'rotRel':
          cel.rot += cmd.deg * p;
          break;
        case 'rotAbs':
          cel.rot = cel.rot + (cmd.deg - cel.rot) * p;
          break;
        case 'scale':
          cel.scale = cel.scale + (cmd.val - cel.scale) * p;
          break;
        case 'pivot':
          cel.pivotX = cmd.x;
          cel.pivotY = cmd.y;
          break;
        case 'flipH':
          cel.flipH = !cel.flipH;
          break;
        case 'flipV':
          cel.flipV = !cel.flipV;
          break;
        case 'zIndex':
          cel.z = cmd.val;
          break;
        case 'bright':
          cel.bright = cmd.val;
          break;
        case 'light':
          cel.light = [cmd.r, cmd.g, cmd.b, p];
          break;
        case 'accel': {
          const dtAcc = Math.max(0, t - cmd.start);
          cel.x += 0.5 * cmd.ax * dtAcc * dtAcc;
          cel.y += 0.5 * cmd.ay * dtAcc * dtAcc;
          break;
        }
        case 'clock': {
          if (!nowDate) nowDate = new Date();
          const secVal = nowDate.getSeconds() + (cmd.stepped ? 0 : nowDate.getMilliseconds() / 1000);
          const minVal = nowDate.getMinutes() + (cmd.stepped ? 0 : secVal / 60);
          const hrVal = (nowDate.getHours() % 12) + (cmd.stepped ? 0 : minVal / 60);
          if (cmd.unit === 'sec') cel.rot = secVal * 6;
          else if (cmd.unit === 'min') cel.rot = minVal * 6;
          else cel.rot = hrVal * 30;
          break;
        }
        case 'text':
          cel.text = expandPlaceholders(cmd.text, ctxInfo);
          break;
        case 'font':
          cel.font = cmd.font;
          break;
        case 'align':
          cel.align = cmd.align;
          break;
      }
    };

    if (indices) {
      for (let j = 0; j < indices.length; j++) {
        const ci = indices[j] - 1;
        if (ci >= 0 && ci < count) applyTo(cels[ci]);
      }
    } else {
      for (let ci = 0; ci < count; ci++) applyTo(cels[ci]);
    }
  }

  // Sort visible cels cleanly by z-index (1..9, stable tie-breaker by cel index)
  const drawList = cels
    .filter(c => c.opacity > 0.004 || c.text || c.light)
    .sort((a, b) => (a.z - b.z) || (a.idx - b.idx));

  return { cels: drawList, shouldRemove, activeSay, activeSoundKey, loopLen, t };
}

/* =========================================================================
   VISUAL ACTION CARDS -> CLEAN MANYLAND SCRIPT COMPILER
   Lets beginners author layered cel animations via simple UI cards while
   automatically generating readable, learnable Dynamic script!
   ========================================================================= */
function fmtNum(n) {
  const r = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(r) ? String(r) : '0';
}

export function formatVisualActionLine(act) {
  const tgt = act.cel === 'ALL' ? 'cells' : `cell ${clamp(parseInt(act.cel, 10) || 1, 1, 9)}`;
  const t0 = Math.max(0, Number(act.start) || 0);
  const t1 = Math.max(t0, Number(act.end) || t0);
  const timeHead = t1 > t0 + 0.005 ? `${fmtNum(t0)}-${fmtNum(t1)}s` : `${fmtNum(t0)}s`;
  const v = Number(act.val);
  const safeVal = Number.isFinite(v) ? v : 0;

  switch (act.kind) {
    case 'show': return `${timeHead}: ${tgt} show`;
    case 'hide': return `${timeHead}: ${tgt} hide`;
    case 'up': return `${timeHead}: ${tgt} up ${fmtNum(safeVal || 6)}`;
    case 'down': return `${timeHead}: ${tgt} down ${fmtNum(safeVal || 6)}`;
    case 'left': return `${timeHead}: ${tgt} left ${fmtNum(safeVal || 6)}`;
    case 'right': return `${timeHead}: ${tgt} right ${fmtNum(safeVal || 6)}`;
    case 'rotate': return `${timeHead}: ${tgt} rotate ${fmtNum(safeVal || 90)}`;
    case 'scale': return `${timeHead}: ${tgt} scale ${fmtNum(clamp(safeVal || 1.2, 0.1, 4))}`;
    case 'opacity': return `${timeHead}: ${tgt} opacity ${fmtNum(clamp(safeVal, 0, 1))}`;
    case 'flipH': return `${timeHead}: ${tgt} flip horizontal`;
    case 'bright': return `${timeHead}: ${tgt} bright`;
    case 'clockSec': return `${timeHead}: ${tgt} seconds angle in steps`;
    case 'clockMin': return `${timeHead}: ${tgt} minutes angle`;
    case 'clockHr': return `${timeHead}: ${tgt} hours angle`;
    case 'text': return `${timeHead}: ${tgt} text ${String(act.text || 'HELLO').trim()}`;
    case 'say': return `${timeHead}: say ${String(act.text || 'HI!').trim()}`;
    case 'sound': return `${timeHead}: play sound`;
    default: return `${timeHead}: ${tgt} show`;
  }
}

export function appendActionToMarkerScript(rawScript, markerName, actionLine, loopSec = 4) {
  const marker = MARKER_ALIASES[String(markerName || 'DEFAULT').toUpperCase()] || 'DEFAULT';
  const lines = String(rawScript || '').split(/\r?\n/);

  if (marker === 'DEFAULT') {
    // Insert right before the first marker header or restart line in DEFAULT section
    let insertAt = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const tr = lines[i].trim();
      const up = tr.toUpperCase();
      if (!tr.includes(':') && MARKER_ALIASES[up]) {
        insertAt = i;
        break;
      }
      if (/^\+?\d*\.?\d+s?\s*:\s*restart$/i.test(tr)) {
        insertAt = i;
        break;
      }
    }
    lines.splice(insertAt, 0, actionLine);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Locate existing marker section or create one cleanly at the bottom
  let secStart = -1;
  let secEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const tr = lines[i].trim();
    const up = tr.toUpperCase();
    if (!tr.includes(':') && MARKER_ALIASES[up]) {
      if (secStart >= 0) {
        secEnd = i;
        break;
      }
      if (MARKER_ALIASES[up] === marker) {
        secStart = i;
      }
    }
  }

  if (secStart < 0) {
    const prefix = lines.join('\n').trim();
    const newSec = `${marker}\n0s: cells show\n${actionLine}\n${fmtNum(loopSec)}s: restart`;
    return prefix ? `${prefix}\n\n${newSec}` : newSec;
  }

  let insertAt = secEnd;
  for (let i = secStart + 1; i < secEnd; i++) {
    if (/^\+?\d*\.?\d+s?\s*:\s*restart$/i.test(lines[i].trim())) {
      insertAt = i;
      break;
    }
  }
  lines.splice(insertAt, 0, actionLine);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractMarkerTimelineItems(rawScript, markerName = 'DEFAULT') {
  const targetMarker = MARKER_ALIASES[String(markerName || 'DEFAULT').toUpperCase()] || 'DEFAULT';
  const rawLines = String(rawScript || '').split(/\r?\n/);
  const items = [];
  let curMarker = 'DEFAULT';
  for (let i = 0; i < rawLines.length; i++) {
    const tr = rawLines[i].trim();
    if (!tr || tr.startsWith('//')) continue;
    const up = tr.toUpperCase();
    if (!tr.includes(':') && MARKER_ALIASES[up]) {
      curMarker = MARKER_ALIASES[up];
      continue;
    }
    if (curMarker === targetMarker) {
      items.push({ lineIdx: i, text: tr });
    }
  }
  return items;
}

export function deleteScriptLine(rawScript, lineIdx) {
  const lines = String(rawScript || '').split(/\r?\n/);
  if (lineIdx >= 0 && lineIdx < lines.length) {
    lines.splice(lineIdx, 1);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function setMarkerRestartTime(rawScript, markerName, loopSec) {
  const targetMarker = MARKER_ALIASES[String(markerName || 'DEFAULT').toUpperCase()] || 'DEFAULT';
  const secVal = clamp(Number(loopSec) || 4, 0.2, 15);
  const lines = String(rawScript || '').split(/\r?\n/);
  let curMarker = 'DEFAULT';
  let foundRestart = -1;
  let secEnd = lines.length;
  let secSeen = targetMarker === 'DEFAULT';

  for (let i = 0; i < lines.length; i++) {
    const tr = lines[i].trim();
    const up = tr.toUpperCase();
    if (!tr.includes(':') && MARKER_ALIASES[up]) {
      if (curMarker === targetMarker && secSeen) {
        secEnd = i;
        break;
      }
      curMarker = MARKER_ALIASES[up];
      if (curMarker === targetMarker) secSeen = true;
      continue;
    }
    if (curMarker === targetMarker && /^\+?\d*\.?\d+s?\s*:\s*restart$/i.test(tr)) {
      foundRestart = i;
    }
  }

  const restartLine = `${fmtNum(secVal)}s: restart`;
  if (foundRestart >= 0) {
    lines[foundRestart] = restartLine;
  } else if (secSeen) {
    lines.splice(secEnd, 0, restartLine);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
