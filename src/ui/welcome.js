import { SFX } from '../audio.js';
import {
  appRoot,
  pixoPopover,
  welcomeCubeCanvas,
  welcomeCubeWrap,
  welcomeOverlay,
  welcomePlayBtn,
  welcomePlayFlood
} from '../dom.js';
import { state } from '../state.js';
import { savePrefsNow } from '../storage.js';
import { startPixoTour } from './pixo.js';
import { updateAudioUI, updateTopUI } from './topbar.js';

/* =========================================================================
   SPRITELAB MINIMAL START SCREEN + INTERACTIVE 3D FAVICON CUBE
   - Pixel-perfect 64x64 software-rasterized 3D translucent orange glass cube
     matching spritelab_favicon.png's exact 5-color palette & internal back edges.
   - Playful Mario 64-inspired tactile physics: drag to spin/fling in 3D,
     elastic rubber-band tug, click/poke squash-hop + crystal pixel sparks,
     double-click barrel roll, wheel flick, subtle hover lean.
   - Switch-2-inspired boot-out choreography & full-screen PLAY button expansion
     flood fading smoothly into the live viewport + building out UI chrome.
   - Zero music on Start Screen; quiet TOYBOX DRIFT starts only on PLAY.
   ========================================================================= */

// Exact spritelab_favicon.png 5-color translucent orange palette (RGB)
const PAL_TIERS = [
  [251, 157, 94],  // 0: #FB9D5E (luminous peach-orange top face)
  [223, 113, 38],  // 1: #DF7126 (vibrant SPRITELAB orange front face)
  [162, 69, 5],    // 2: #A24505 (deep burnt-amber right face)
  [119, 49, 0]     // 3: #773100 (deep shadow amber)
];

// Exact one-shade-darker internal refraction colors seen through translucent front faces
const INNER_EDGE_TIERS = [
  [223, 113, 38],  // behind Tier 0 (#FB9D5E) -> #DF7126
  [162, 69, 5],    // behind Tier 1 (#DF7126) -> #A24505
  [119, 49, 0],    // behind Tier 2 (#A24505) -> #773100
  [77, 30, 0]      // behind Tier 3 (#773100) -> #4D1E00
];

const SPEC_GLINT = [255, 212, 174]; // Crisp top-left translucent crystal glint

// Unit cube [-1, 1]^3 geometry (right-handed: +X right, +Y up, +Z toward viewer)
const CUBE_VERTS = [
  [-1, -1, -1], // 0: back-bottom-left
  [ 1, -1, -1], // 1: back-bottom-right
  [ 1,  1, -1], // 2: back-top-right
  [-1,  1, -1], // 3: back-top-left
  [-1, -1,  1], // 4: front-bottom-left
  [ 1, -1,  1], // 5: front-bottom-right
  [ 1,  1,  1], // 6: front-top-right
  [-1,  1,  1]  // 7: front-top-left
];

// 6 quad faces with CCW outward winding
const CUBE_FACES = [
  { v: [4, 5, 6, 7], n: [ 0,  0,  1] }, // 0: Front (+Z)
  { v: [1, 0, 3, 2], n: [ 0,  0, -1] }, // 1: Back (-Z)
  { v: [7, 6, 2, 3], n: [ 0,  1,  0] }, // 2: Top (+Y)
  { v: [0, 1, 5, 4], n: [ 0, -1,  0] }, // 3: Bottom (-Y)
  { v: [5, 1, 2, 6], n: [ 1,  0,  0] }, // 4: Right (+X)
  { v: [0, 4, 7, 3], n: [-1,  0,  0] }  // 5: Left (-X)
];

// 12 edges with their 2 adjacent face indices [vA, vB, faceA, faceB]
const CUBE_EDGES = [
  [4, 5, 0, 3], [5, 6, 0, 4], [6, 7, 0, 2], [7, 4, 0, 5],
  [0, 1, 1, 3], [1, 2, 1, 4], [2, 3, 1, 2], [3, 0, 1, 5],
  [0, 4, 3, 5], [1, 5, 3, 4], [2, 6, 2, 4], [3, 7, 2, 5]
];

// Top-front-left studio key light matching spritelab_favicon.png face luminance
const LIGHT_DIR = (() => {
  const x = -0.46;
  const y = 0.74;
  const z = 0.49;
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
})();

// --- Fast Unit Quaternion Math (Zero Gimbal Lock) ---
function qFromAxisAngle(ax, ay, az, rad) {
  const half = rad * 0.5;
  const s = Math.sin(half);
  return [Math.cos(half), ax * s, ay * s, az * s];
}

function qMul(a, b) {
  const aw = a[0], ax = a[1], ay = a[2], az = a[3];
  const bw = b[0], bx = b[1], by = b[2], bz = b[3];
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw
  ];
}

function qNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= len;
  q[1] /= len;
  q[2] /= len;
  q[3] /= len;
  return q;
}

function qSlerpStep(from, to, t) {
  let dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + from[3] * to[3];
  let tw = to[0], tx = to[1], ty = to[2], tz = to[3];
  if (dot < 0) {
    dot = -dot;
    tw = -tw; tx = -tx; ty = -ty; tz = -tz;
  }
  const out = [
    from[0] + (tw - from[0]) * t,
    from[1] + (tx - from[1]) * t,
    from[2] + (ty - from[2]) * t,
    from[3] + (tz - from[3]) * t
  ];
  return qNormalize(out);
}

function qRotateVec(q, v) {
  const w = q[0], qx = q[1], qy = q[2], qz = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + w * tx + (qy * tz - qz * ty),
    vy + w * ty + (qz * tx - qx * tz),
    vz + w * tz + (qx * ty - qy * tx)
  ];
}

// Iconic spritelab_favicon.png resting orientation (Top #FB9D5E, Front #DF7126, Right #A24505)
const HOME_Q = qNormalize(
  qMul(
    qFromAxisAngle(1, 0, 0, 0.36),
    qFromAxisAngle(0, 1, 0, -0.38)
  )
);

// --- 64x64 Pixel-Art Rasterizer State ---
const CW = 64;
const CH = 64;
const frontTierBuf = new Uint8Array(CW * CH);
const projPts = Array.from({ length: 8 }, () => [0, 0, 0]);
const faceFront = new Uint8Array(6);
const faceTier = new Uint8Array(6);
const scanXs = new Float32Array(8);

let cubeCtx = null;
let cubeImgData = null;
let cubeBuf = null;
let cubeRafId = 0;
let lastCubeTime = 0;
let isLaunching = false;
const bootTimers = [];

const cube = {
  q: HOME_Q.slice(),
  angVelX: 0,
  angVelY: 0,
  angVelZ: 0,
  // Interactive drag & elastic tug
  dragging: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  dragDist: 0,
  pullX: 0,
  pullY: 0,
  pullVelX: 0,
  pullVelY: 0,
  // Tactile squash-and-stretch + hop springs
  squash: 0,
  squashVel: 0,
  hop: 0,
  hopVel: 0,
  // Arrival settle into iconic favicon pose
  arrivalT: 0,
  // Subtle hover lean toward mouse cursor across the start screen
  cursorNx: 0,
  cursorNy: 0,
  leanX: 0,
  leanY: 0,
  // Toy combo & sound pacing
  pokeCombo: 0,
  lastPokeTime: 0,
  lastClickTime: 0,
  spinSoundAccum: 0,
  time: 0,
  // Crisp pixel sparks
  sparks: []
};

function clearBootTimers() {
  while (bootTimers.length) clearTimeout(bootTimers.pop());
}

function spawnSparks(count, speedMult = 1, burstY = 0) {
  const sparkColors = [
    [255, 226, 196],
    [251, 157, 94],
    [223, 113, 38]
  ];
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.55;
    const spd = (18 + Math.random() * 24) * speedMult;
    cube.sparks.push({
      x: 32 + cube.pullX + Math.cos(ang) * (8 + Math.random() * 6),
      y: 31 + cube.pullY - cube.hop + burstY + Math.sin(ang) * (8 + Math.random() * 6),
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 10 * speedMult,
      life: 0.28 + Math.random() * 0.24,
      maxLife: 0.52,
      size: Math.random() < 0.35 ? 2 : 1,
      col: sparkColors[Math.floor(Math.random() * sparkColors.length)]
    });
  }
  if (cube.sparks.length > 42) {
    cube.sparks.splice(0, cube.sparks.length - 42);
  }
}

function blendPixel(x, y, r, g, b, alpha) {
  if (x < 0 || x >= CW || y < 0 || y >= CH) return;
  const idx = (y * CW + x) << 2;
  const dstA = cubeBuf[idx + 3] / 255;
  if (alpha >= 0.999 || dstA <= 0.001) {
    cubeBuf[idx] = r;
    cubeBuf[idx + 1] = g;
    cubeBuf[idx + 2] = b;
    cubeBuf[idx + 3] = Math.round(alpha * 255);
    return;
  }
  const outA = alpha + dstA * (1 - alpha);
  const invOut = 1 / outA;
  cubeBuf[idx] = Math.round((r * alpha + cubeBuf[idx] * dstA * (1 - alpha)) * invOut);
  cubeBuf[idx + 1] = Math.round((g * alpha + cubeBuf[idx + 1] * dstA * (1 - alpha)) * invOut);
  cubeBuf[idx + 2] = Math.round((b * alpha + cubeBuf[idx + 2] * dstA * (1 - alpha)) * invOut);
  cubeBuf[idx + 3] = Math.round(outA * 255);
}

function drawGroundShadow(cx, cy, rx, ry) {
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(CH - 1, Math.ceil(cy + ry));
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(CW - 1, Math.ceil(cx + rx));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    const dy2 = dy * dy;
    if (dy2 > 1) continue;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const d2 = dx * dx + dy2;
      if (d2 > 1) continue;
      const alpha = d2 < 0.42 ? 0.34 : (d2 < 0.76 ? 0.22 : 0.11);
      blendPixel(x, y, 4, 5, 8, alpha);
    }
  }
}

function fillQuad(vIndices, r, g, b, alpha, recordTier) {
  let minY = CH;
  let maxY = -1;
  for (let i = 0; i < 4; i++) {
    const py = projPts[vIndices[i]][1];
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const yStart = Math.max(0, Math.ceil(minY - 0.5));
  const yEnd = Math.min(CH - 1, Math.floor(maxY - 0.5));
  for (let y = yStart; y <= yEnd; y++) {
    const sy = y + 0.5;
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const a = projPts[vIndices[i]];
      const bPt = projPts[vIndices[(i + 1) & 3]];
      const ay = a[1], by = bPt[1];
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
        const t = (sy - ay) / (by - ay);
        scanXs[count++] = a[0] + t * (bPt[0] - a[0]);
      }
    }
    if (count < 2) continue;
    let xMin = scanXs[0];
    let xMax = scanXs[1];
    if (count > 2) {
      for (let i = 0; i < count; i++) {
        if (scanXs[i] < xMin) xMin = scanXs[i];
        if (scanXs[i] > xMax) xMax = scanXs[i];
      }
    } else if (xMin > xMax) {
      const tmp = xMin;
      xMin = xMax;
      xMax = tmp;
    }
    const xStart = Math.max(0, Math.ceil(xMin - 0.5));
    const xEnd = Math.min(CW - 1, Math.floor(xMax - 0.5));
    const rowOff = y * CW;
    for (let x = xStart; x <= xEnd; x++) {
      blendPixel(x, y, r, g, b, alpha);
      if (recordTier >= 0) {
        frontTierBuf[rowOff + x] = recordTier;
      }
    }
  }
}

function drawLineBresenham(x0, y0, x1, y1, pixelFn) {
  let ix0 = Math.floor(x0);
  let iy0 = Math.floor(y0);
  const ix1 = Math.floor(x1);
  const iy1 = Math.floor(y1);
  const dx = Math.abs(ix1 - ix0);
  const dy = Math.abs(iy1 - iy0);
  const sx = ix0 < ix1 ? 1 : -1;
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx - dy;

  for (let guard = 0; guard < 256; guard++) {
    pixelFn(ix0, iy0);
    if (ix0 === ix1 && iy0 === iy1) break;
    const e2 = err << 1;
    if (e2 > -dy) {
      err -= dy;
      ix0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      iy0 += sy;
    }
  }
}

function dotToTier(d) {
  if (d >= 0.55) return 0;   // #FB9D5E
  if (d >= 0.04) return 1;   // #DF7126
  if (d >= -0.45) return 2;  // #A24505
  return 3;                  // #773100
}

function renderCubeFrame() {
  if (!cubeCtx || !cubeImgData || !cubeBuf) return;

  cubeBuf.fill(0);
  frontTierBuf.fill(255);

  // Subtle idle float + bounded hop + elastic drag pull (stays cleanly inside 64x64 bounds)
  const idleBob = cube.dragging ? 0 : Math.sin(cube.time * 2.15) * 1.25;
  const centerX = 32 + cube.pullX;
  const centerY = 32 + cube.pullY - cube.hop + idleBob;

  // Grounding pixel shadow responds dynamically to hop/bob height
  const heightNorm = Math.max(0, (cube.hop - idleBob) * 0.06);
  const shadowScale = Math.max(0.65, 1 - heightNorm * 0.42);
  drawGroundShadow(32 + cube.pullX * 0.42, 57.5, 14.5 * shadowScale, 2.8 * shadowScale);

  // Combine interactive orientation with subtle hover lean
  let renderQ = cube.q;
  if (Math.abs(cube.leanX) > 0.0005 || Math.abs(cube.leanY) > 0.0005) {
    const qLean = qMul(
      qFromAxisAngle(1, 0, 0, cube.leanX),
      qFromAxisAngle(0, 1, 0, cube.leanY)
    );
    renderQ = qNormalize(qMul(qLean, cube.q));
  }

  // Volume-preserving squash & stretch (clamped so corners never clip canvas edges)
  const sY = Math.max(0.82, Math.min(1.18, 1 + cube.squash));
  const sXZ = 1 / Math.sqrt(sY);

  // Project 8 vertices with gentle crisp perspective (preserves iconic favicon proportions)
  const focal = 7.4;
  const camDist = 7.4;
  const scalePx = 14.2;
  for (let i = 0; i < 8; i++) {
    const rv = qRotateVec(renderQ, CUBE_VERTS[i]);
    const vx = rv[0] * sXZ;
    const vy = rv[1] * sY;
    const vz = rv[2] * sXZ;
    const persp = focal / (camDist - vz);
    // Snap projected vertices to exact pixel centers so quad fills & Bresenham outlines align 100% cleanly
    projPts[i][0] = Math.round(centerX + vx * scalePx * persp) + 0.5;
    projPts[i][1] = Math.round(centerY - vy * scalePx * persp) + 0.5;
    projPts[i][2] = vz;
  }

  // Classify front vs back faces using exact projected 2D winding + compute lighting tiers
  for (let f = 0; f < 6; f++) {
    const face = CUBE_FACES[f];
    const p0 = projPts[face.v[0]];
    const p1 = projPts[face.v[1]];
    const p2 = projPts[face.v[2]];
    const cross2d = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    faceFront[f] = cross2d < 0 ? 1 : 0;

    const rn = qRotateVec(renderQ, face.n);
    const d = rn[0] * LIGHT_DIR[0] + rn[1] * LIGHT_DIR[1] + rn[2] * LIGHT_DIR[2];
    faceTier[f] = dotToTier(d);
  }

  // Pass 1: Translucent back-face glass interior shell
  for (let f = 0; f < 6; f++) {
    if (faceFront[f]) continue;
    const tier = Math.min(3, faceTier[f] + 1);
    const c = PAL_TIERS[tier];
    fillQuad(CUBE_FACES[f].v, c[0], c[1], c[2], 0.34, -1);
  }

  // Pass 2: Luminous translucent front faces (exact favicon palette)
  for (let f = 0; f < 6; f++) {
    if (!faceFront[f]) continue;
    const tier = faceTier[f];
    const c = PAL_TIERS[tier];
    fillQuad(CUBE_FACES[f].v, c[0], c[1], c[2], 0.86, tier);
  }

  // Pass 3: Interior back edges seen THROUGH the translucent orange glass!
  // Shaded dynamically one palette step darker than whichever front face they pass behind.
  for (let e = 0; e < 12; e++) {
    const edge = CUBE_EDGES[e];
    if (faceFront[edge[2]] || faceFront[edge[3]]) continue;
    const a = projPts[edge[0]];
    const b = projPts[edge[1]];
    drawLineBresenham(a[0], a[1], b[0], b[1], (px, py) => {
      if (px < 0 || px >= CW || py < 0 || py >= CH) return;
      const ft = frontTierBuf[py * CW + px];
      if (ft > 3) return;
      const ic = INNER_EDGE_TIERS[ft];
      blendPixel(px, py, ic[0], ic[1], ic[2], 0.94);
    });
  }

  // Pass 4: Subtle 1px crystal glint along bright top-front crease
  for (let e = 0; e < 12; e++) {
    const edge = CUBE_EDGES[e];
    const fA = edge[2];
    const fB = edge[3];
    if (!(faceFront[fA] && faceFront[fB])) continue;
    if (faceTier[fA] !== 0 && faceTier[fB] !== 0) continue;
    const a = projPts[edge[0]];
    const b = projPts[edge[1]];
    drawLineBresenham(a[0], a[1] - 1, b[0], b[1] - 1, (px, py) => {
      if (px < 0 || px >= CW || py < 0 || py >= CH) return;
      if (frontTierBuf[py * CW + px] === 0) {
        blendPixel(px, py, SPEC_GLINT[0], SPEC_GLINT[1], SPEC_GLINT[2], 0.52);
      }
    });
  }

  // Pass 5: Razor-sharp 1px #000000 exterior silhouette & front edges (matches favicon)
  for (let e = 0; e < 12; e++) {
    const edge = CUBE_EDGES[e];
    if (!faceFront[edge[2]] && !faceFront[edge[3]]) continue;
    const a = projPts[edge[0]];
    const b = projPts[edge[1]];
    drawLineBresenham(a[0], a[1], b[0], b[1], (px, py) => {
      blendPixel(px, py, 0, 0, 0, 1);
    });
  }

  // Pass 6: Crisp playful pixel sparks when poked/spun
  for (let i = 0; i < cube.sparks.length; i++) {
    const sp = cube.sparks[i];
    const alpha = Math.max(0, Math.min(1, sp.life / (sp.maxLife * 0.55)));
    const sx = Math.round(sp.x);
    const sy = Math.round(sp.y);
    for (let oy = 0; oy < sp.size; oy++) {
      for (let ox = 0; ox < sp.size; ox++) {
        blendPixel(sx + ox, sy + oy, sp.col[0], sp.col[1], sp.col[2], alpha);
      }
    }
  }

  cubeCtx.putImageData(cubeImgData, 0, 0);
}

function stepCubePhysics(dt) {
  cube.time += dt;

  // Smooth boot arrival settle into the iconic favicon pose (yields immediately on touch)
  if (cube.arrivalT > 0 && !cube.dragging) {
    cube.arrivalT = Math.max(0, cube.arrivalT - dt);
    const settle = 1 - Math.exp(-8.5 * dt);
    cube.q = qSlerpStep(cube.q, HOME_Q, settle);
    if (cube.arrivalT <= 0.001) {
      cube.q = HOME_Q.slice();
    }
  } else if (!cube.dragging) {
    // Free 3D inertial spin & gentle damping
    const speed = Math.hypot(cube.angVelX, cube.angVelY, cube.angVelZ);
    if (speed > 0.002) {
      const dqX = qFromAxisAngle(1, 0, 0, cube.angVelX * dt);
      const dqY = qFromAxisAngle(0, 1, 0, cube.angVelY * dt);
      const dqZ = qFromAxisAngle(0, 0, 1, cube.angVelZ * dt);
      cube.q = qNormalize(qMul(dqZ, qMul(dqX, qMul(dqY, cube.q))));
      const damp = Math.exp(-2.85 * dt);
      cube.angVelX *= damp;
      cube.angVelY *= damp;
      cube.angVelZ *= damp;
    } else {
      cube.angVelX = cube.angVelY = cube.angVelZ = 0;
    }
  }

  // Elastic rubber-band tug return spring
  if (!cube.dragging) {
    const kPull = 175;
    const dPull = 14;
    cube.pullVelX += (-kPull * cube.pullX - dPull * cube.pullVelX) * dt;
    cube.pullVelY += (-kPull * cube.pullY - dPull * cube.pullVelY) * dt;
    cube.pullX += cube.pullVelX * dt;
    cube.pullY += cube.pullVelY * dt;
  }

  // Squishy squash-and-stretch spring (bounded so spam clicks stay crisp in place)
  const targetSquash = cube.dragging ? -0.055 : 0;
  cube.squashVel += (220 * (targetSquash - cube.squash) - 14 * cube.squashVel) * dt;
  cube.squashVel = Math.max(-5.5, Math.min(5.5, cube.squashVel));
  cube.squash = Math.max(-0.18, Math.min(0.18, cube.squash + cube.squashVel * dt));

  // Snappy bounded micro-hop spring (never climbs out of canvas on rapid click spam)
  const MAX_HOP = 4.2;
  if (cube.hop > 0 || cube.hopVel > 0) {
    cube.hopVel -= 185 * dt;
    cube.hop += cube.hopVel * dt;
    if (cube.hop > MAX_HOP) {
      cube.hop = MAX_HOP;
      if (cube.hopVel > 0) cube.hopVel = 0;
    }
    if (cube.hop <= 0) {
      cube.hop = 0;
      if (cube.hopVel < -14) {
        cube.squashVel = Math.max(-5.2, cube.squashVel - 1.8);
        cube.hopVel = -cube.hopVel * 0.2;
      } else {
        cube.hopVel = 0;
      }
    }
  }

  // Subtle hover lean toward cursor across start screen
  const targetLeanX = cube.dragging ? 0 : cube.cursorNy * 0.14;
  const targetLeanY = cube.dragging ? 0 : cube.cursorNx * 0.16;
  const leanLerp = 1 - Math.exp(-7 * dt);
  cube.leanX += (targetLeanX - cube.leanX) * leanLerp;
  cube.leanY += (targetLeanY - cube.leanY) * leanLerp;

  // Update pixel sparks
  for (let i = cube.sparks.length - 1; i >= 0; i--) {
    const sp = cube.sparks[i];
    sp.life -= dt;
    if (sp.life <= 0) {
      cube.sparks.splice(i, 1);
      continue;
    }
    sp.vy += 42 * dt;
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
  }
}

function tickCubeLoop(now) {
  if (!welcomeOverlay || !welcomeOverlay.classList.contains('open')) {
    cubeRafId = 0;
    return;
  }
  const dt = Math.min(0.05, Math.max(0.001, (now - lastCubeTime) / 1000));
  lastCubeTime = now;
  stepCubePhysics(dt);
  renderCubeFrame();
  cubeRafId = requestAnimationFrame(tickCubeLoop);
}

function startCubeLoop() {
  if (cubeRafId || !welcomeCubeCanvas) return;
  if (!cubeCtx) {
    cubeCtx = welcomeCubeCanvas.getContext('2d');
    if (cubeCtx) {
      cubeCtx.imageSmoothingEnabled = false;
      cubeImgData = cubeCtx.createImageData(CW, CH);
      cubeBuf = cubeImgData.data;
    }
  }
  lastCubeTime = performance.now();
  renderCubeFrame();
  cubeRafId = requestAnimationFrame(tickCubeLoop);
}

function stopCubeLoop() {
  if (cubeRafId) {
    cancelAnimationFrame(cubeRafId);
    cubeRafId = 0;
  }
}

function pokeCube(isDouble = false) {
  cube.arrivalT = 0;
  const now = performance.now();
  if (now - cube.lastPokeTime < 850) {
    cube.pokeCombo = Math.min(8, cube.pokeCombo + 1);
  } else {
    cube.pokeCombo = 0;
  }
  cube.lastPokeTime = now;

  // Scale hop lift down when already mid-hop so spam-clicking squishes & spins in place without climbing
  const MAX_HOP = 4.2;
  const headroom = Math.max(0, 1 - cube.hop / MAX_HOP);

  if (isDouble) {
    // Celebratory barrel-roll spin + subtle bounded pop + sparkle burst
    cube.squashVel = Math.min(4.2, cube.squashVel + 3.2);
    cube.hopVel = Math.max(cube.hopVel, 22 * headroom);
    cube.angVelY = Math.max(-18, Math.min(18, cube.angVelY + (Math.random() < 0.5 ? 1 : -1) * 10.5));
    cube.angVelX = Math.max(-14, Math.min(14, cube.angVelX + (Math.random() - 0.5) * 6.5));
    spawnSparks(12, 1.15, -1);
    SFX.playCubePoke(1.32 + cube.pokeCombo * 0.04);
  } else {
    // Playful in-place squishy poke bounce
    cube.squashVel = Math.max(-4.2, cube.squashVel - 3.2);
    cube.hopVel = Math.max(cube.hopVel, 14 * headroom);
    const dir = (cube.pokeCombo % 2 === 0) ? 1 : -1;
    cube.angVelY = Math.max(-18, Math.min(18, cube.angVelY + dir * (3.2 + Math.random() * 2.2)));
    cube.angVelX = Math.max(-14, Math.min(14, cube.angVelX + (Math.random() - 0.5) * 3.0));
    spawnSparks(7, 0.85, 0);
    SFX.playCubePoke(0.95 + cube.pokeCombo * 0.065);
  }
}

function bindCubeToyInteractions() {
  if (!welcomeCubeCanvas) return;

  welcomeCubeCanvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || isLaunching) return;
    e.preventDefault();
    cube.dragging = true;
    cube.arrivalT = 0;
    cube.pointerId = e.pointerId;
    cube.startX = cube.lastX = e.clientX;
    cube.startY = cube.lastY = e.clientY;
    cube.dragDist = 0;
    cube.angVelX = 0;
    cube.angVelY = 0;
    cube.angVelZ = 0;
    cube.spinSoundAccum = 0;
    welcomeCubeCanvas.classList.add('grabbing');
    if (welcomeCubeWrap) welcomeCubeWrap.classList.add('active-toy');
    if (welcomeCubeCanvas.setPointerCapture) {
      try { welcomeCubeCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
    SFX.unlock();
  });

  welcomeCubeCanvas.addEventListener('pointermove', e => {
    if (!cube.dragging || e.pointerId !== cube.pointerId) return;
    const dx = e.clientX - cube.lastX;
    const dy = e.clientY - cube.lastY;
    cube.lastX = e.clientX;
    cube.lastY = e.clientY;
    cube.dragDist += Math.hypot(dx, dy);

    // Trackball 3D spin in screen axes
    const rotY = dx * 0.017;
    const rotX = dy * 0.017;
    const dq = qMul(
      qFromAxisAngle(1, 0, 0, rotX),
      qFromAxisAngle(0, 1, 0, rotY)
    );
    cube.q = qNormalize(qMul(dq, cube.q));

    // Smooth angular velocity estimate for tossing/flinging
    cube.angVelY = cube.angVelY * 0.45 + (rotY * 58) * 0.55;
    cube.angVelX = cube.angVelX * 0.45 + (rotX * 58) * 0.55;

    // Soft elastic tug toward pointer (clamped cleanly within 64x64 canvas padding)
    const offX = (e.clientX - cube.startX) * 0.085;
    const offY = (e.clientY - cube.startY) * 0.085;
    cube.pullX = Math.max(-5.5, Math.min(5.5, offX));
    cube.pullY = Math.max(-4.5, Math.min(4.5, offY));

    // Gentle tactile click when spinning briskly
    cube.spinSoundAccum += Math.hypot(dx, dy);
    if (cube.spinSoundAccum > 88) {
      cube.spinSoundAccum = 0;
      SFX.playCubePoke(0.78 + Math.random() * 0.14);
    }
  });

  const releaseCube = e => {
    if (!cube.dragging) return;
    if (e && e.pointerId != null && cube.pointerId !== e.pointerId) return;
    cube.dragging = false;
    if (welcomeCubeCanvas.releasePointerCapture && cube.pointerId != null) {
      try { welcomeCubeCanvas.releasePointerCapture(cube.pointerId); } catch (_) {}
    }
    cube.pointerId = null;
    welcomeCubeCanvas.classList.remove('grabbing');
    if (welcomeCubeWrap) welcomeCubeWrap.classList.remove('active-toy');

    if (cube.dragDist < 7) {
      // Quick tap / poke!
      const now = performance.now();
      const isDouble = (now - cube.lastClickTime) < 310;
      cube.lastClickTime = isDouble ? 0 : now;
      pokeCube(isDouble);
    } else {
      // Elastic fling!
      cube.angVelX = Math.max(-16, Math.min(16, cube.angVelX));
      cube.angVelY = Math.max(-16, Math.min(16, cube.angVelY));
      const flingSpeed = Math.hypot(cube.angVelX, cube.angVelY);
      if (flingSpeed > 5.5) {
        cube.squashVel += 1.9;
        spawnSparks(6, 0.85, 0);
        SFX.playCubePoke(1.06 + Math.min(0.35, flingSpeed * 0.02));
      }
    }
  };

  welcomeCubeCanvas.addEventListener('pointerup', releaseCube);
  welcomeCubeCanvas.addEventListener('pointercancel', releaseCube);

  welcomeCubeCanvas.addEventListener('wheel', e => {
    if (!welcomeOverlay || !welcomeOverlay.classList.contains('open') || isLaunching) return;
    e.preventDefault();
    cube.arrivalT = 0;
    const dir = e.deltaY >= 0 ? 1 : -1;
    cube.angVelY += dir * 4.8;
    cube.angVelX += (e.deltaX || 0) * 0.03;
    cube.squashVel -= 1.2;
    SFX.unlock();
    SFX.playCubePoke(1.02);
  }, { passive: false });

  if (welcomeOverlay) {
    welcomeOverlay.addEventListener('pointermove', e => {
      if (!welcomeOverlay.classList.contains('open')) return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      cube.cursorNx = ((e.clientX / w) - 0.5) * 2;
      cube.cursorNy = ((e.clientY / h) - 0.5) * 2;
    });
  }
}

/* =========================================================================
   ONE-TIME FIRST-LAUNCH START SCREEN & SWITCH-2 UI BUILD-OUT REVEAL
   Only ever shown to absolutely first-time visitors (!state.welcomeDone).
   Players cannot return to this screen once entered.
   ========================================================================= */
export function openFirstTimeStartScreen() {
  if (!welcomeOverlay || state.welcomeDone) return;
  clearBootTimers();
  isLaunching = false;
  if (pixoPopover) pixoPopover.classList.remove('open');

  if (welcomePlayFlood) {
    welcomePlayFlood.classList.remove('active', 'expanding', 'fading');
    welcomePlayFlood.removeAttribute('style');
  }

  // Tuck workspace UI behind the one-time start screen for the Switch-2 build-out reveal
  if (appRoot) {
    appRoot.classList.remove('ui-build-reveal');
    appRoot.classList.add('ui-building');
  }

  // Arrival settle into iconic spritelab_favicon.png resting pose
  cube.q = qNormalize(
    qMul(
      qFromAxisAngle(1, 0, 0, 0.68),
      qFromAxisAngle(0, 1, 0, -1.25)
    )
  );
  cube.angVelX = 0;
  cube.angVelY = 0;
  cube.angVelZ = 0;
  cube.pullX = cube.pullY = cube.pullVelX = cube.pullVelY = 0;
  cube.hop = 4.5;
  cube.hopVel = 8;
  cube.squash = 0.14;
  cube.squashVel = -1.2;
  cube.arrivalT = 0.58;
  cube.sparks.length = 0;

  welcomeOverlay.classList.remove('boot-cube', 'boot-logo', 'boot-play');
  welcomeOverlay.classList.add('open');
  startCubeLoop();

  // Staged Switch-2-style build-in: 3D Cube -> SPRITELAB Logo -> PLAY Button
  bootTimers.push(setTimeout(() => {
    welcomeOverlay.classList.add('boot-cube');
    spawnSparks(8, 0.75, 0);
  }, 45));
  bootTimers.push(setTimeout(() => {
    welcomeOverlay.classList.add('boot-logo');
  }, 240));
  bootTimers.push(setTimeout(() => {
    welcomeOverlay.classList.add('boot-play');
  }, 410));
}

function launchGame() {
  if (!welcomeOverlay || !welcomeOverlay.classList.contains('open') || isLaunching) return;
  isLaunching = true;
  clearBootTimers();

  SFX.unlock();
  SFX.playSwitchSnap();

  // Give the 3D cube a joyful bounded send-off spin & sparkle
  cube.arrivalT = 0;
  cube.hopVel = Math.max(cube.hopVel, 18);
  cube.squashVel = 2.8;
  cube.angVelY = Math.max(-18, Math.min(18, cube.angVelY + 9.5));
  spawnSparks(12, 1.1, -1);

  state.welcomeDone = true;
  savePrefsNow();
  updateTopUI();

  const startViewportBuildReveal = () => {
    welcomeOverlay.classList.remove('open', 'boot-cube', 'boot-logo', 'boot-play');
    stopCubeLoop();

    // Start quiet TOYBOX DRIFT background music ONLY once the player starts!
    SFX.startGameMusic();
    updateAudioUI();

    if (appRoot) {
      appRoot.classList.add('ui-building', 'ui-build-reveal');
      void appRoot.offsetWidth;
    }

    if (welcomePlayFlood) {
      welcomePlayFlood.classList.add('fading');
    }

    // One-time Switch-2-style viewport & chrome build-out reveal
    bootTimers.push(setTimeout(() => {
      if (appRoot) appRoot.classList.remove('ui-building');
    }, 85));

    bootTimers.push(setTimeout(() => {
      if (welcomePlayFlood) {
        welcomePlayFlood.classList.remove('active', 'expanding', 'fading');
        welcomePlayFlood.removeAttribute('style');
      }
      if (appRoot) appRoot.classList.remove('ui-build-reveal');
      isLaunching = false;

      // Pixo follows up right after the one-time first-launch reveal!
      if (!state.tutorialDone) {
        bootTimers.push(setTimeout(() => {
          if (!state.tutorialDone) startPixoTour(false);
        }, 380));
      }
    }, 560));
  };

  // Expand the PLAY button seamlessly to fill the entire screen, then fade into live viewport!
  if (welcomePlayBtn && welcomePlayFlood) {
    const rect = welcomePlayBtn.getBoundingClientRect();
    welcomePlayFlood.classList.remove('expanding', 'fading');
    welcomePlayFlood.style.left = `${rect.left}px`;
    welcomePlayFlood.style.top = `${rect.top}px`;
    welcomePlayFlood.style.width = `${rect.width}px`;
    welcomePlayFlood.style.height = `${rect.height}px`;
    welcomePlayFlood.classList.add('active');

    void welcomePlayFlood.offsetWidth;

    welcomePlayFlood.classList.add('expanding');
    welcomePlayFlood.style.left = '0px';
    welcomePlayFlood.style.top = '0px';
    welcomePlayFlood.style.width = '100vw';
    welcomePlayFlood.style.height = '100vh';

    bootTimers.push(setTimeout(startViewportBuildReveal, 390));
  } else {
    startViewportBuildReveal();
  }
}

export function initWelcomeUI() {
  if (!welcomeOverlay) return;

  bindCubeToyInteractions();

  if (welcomePlayBtn) {
    welcomePlayBtn.addEventListener('click', () => launchGame());
  }

  window.addEventListener('keydown', e => {
    if (!welcomeOverlay.classList.contains('open') || isLaunching) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      launchGame();
    }
  });
}
