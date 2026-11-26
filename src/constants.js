/* =========================================================================
   CONSTANTS & TUNED 60 HZ FIXED-TIMESTEP PHYSICS
   Infinite 2D sparse grid (19x19 logical pixels per tile).
   Calm, weighted Manyland-style movement.
   ========================================================================= */
export const TILE = 19;
export const STARTER_TILE_ID = '__starter__';
export const FIXED_DT = 1 / 60;
export const MAX_FRAME_DT = 0.05;

export const KEY_SPRITES = 'sprite_engine_sprites_v3';
export const KEY_WORLDS = 'sprite_engine_worlds_v3';
export const KEY_PREFS = 'sprite_engine_prefs_v3';
export const KEY_EDITOR_DRAFT = 'sprite_engine_editor_draft_v3';
export const KEY_SESSION_LOCK = 'sprite_engine_session_lock_v3';
export const KEY_SESSION_HANDOFF = 'sprite_engine_session_handoff_v3';

export const TILE_ANIM_MODES = ['LOOP', 'PING-PONG', 'TOUCH', 'INTERACT'];
export const BODY_STATES = ['STAND', 'WALK', 'JUMP', 'FALL', 'CLIMB', 'SIT', 'BLINK'];
export const BODY_STATE_COLORS = {
  STAND: '#3e6fc9',
  WALK: '#3d9460',
  JUMP: '#d4822e',
  FALL: '#c25240',
  CLIMB: '#8252bd',
  SIT: '#4d60ad',
  BLINK: '#bd4673'
};

/* =========================================================================
   MANYLAND-INSPIRED CREATION OBJECT TYPES (31 TYPES, 2-COLUMN GRID)
   Excludes MIFT, AUTOMATION, INSTRUMENT, and MUSIC.
   ========================================================================= */
export const PHYSICS_SUBTYPES = ['CRATE', 'BOUNCY BALL', 'HEAVY METAL', 'WHEEL', 'THRUSTER', 'EXPLOSIVE'];
export const DYNAMIC_SUBTYPES = ['SPIN', 'FLOAT', 'PULSE', 'SWAY', 'FADE', 'ORBIT'];

export const TYPE_DEFS = [
  // Left Column (15) | Right Column (15) interleaved for 2-column grid layout
  // All icons authored on a 16x16 integer pixel grid with true transparent cutouts (no hardcoded bg fills)
  {
    id: 'SOLID', label: 'SOLID', layer: 'main',
    subTypes: ['SOLID', 'ONE-WAY', 'STICKY'],
    desc: 'Solid blocks, jump-through ledges, or sticky surfaces.',
    icon: '<rect x="2" y="2" width="5" height="3"/><rect x="8" y="2" width="6" height="3"/><rect x="2" y="6" width="2" height="4"/><rect x="5" y="6" width="6" height="4"/><rect x="12" y="6" width="2" height="4"/><rect x="2" y="11" width="6" height="3"/><rect x="9" y="11" width="5" height="3"/>'
  },
  {
    id: 'BODY', label: 'BODY', layer: 'gear', gear: true,
    subTypes: ['BODY', 'MOTION'],
    desc: 'Draw your own playable character or pose!',
    icon: '<path fill-rule="evenodd" d="M5 1h6v5H5zM6 3h1v1H6zM9 3h1v1H9z"/><rect x="7" y="6" width="2" height="1"/><rect x="4" y="7" width="8" height="1"/><rect x="3" y="8" width="1" height="3"/><rect x="5" y="8" width="6" height="3"/><rect x="12" y="8" width="1" height="3"/><rect x="5" y="11" width="2" height="4"/><rect x="9" y="11" width="2" height="4"/>'
  },
  {
    id: 'BACK', label: 'BACK', layer: 'bg',
    subTypes: ['BACK', 'FAR BACK', 'WALKABLE'],
    desc: 'Background walls, climbable walls, or parallax scenery.',
    icon: '<path fill-rule="evenodd" opacity="0.5" d="M2 2h12v12H2zM3 3h10v10H3z"/><rect x="4" y="4" width="2" height="2"/><rect x="8" y="4" width="2" height="2"/><rect x="6" y="6" width="2" height="2"/><rect x="10" y="6" width="2" height="2"/><rect x="4" y="8" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/><rect x="6" y="10" width="2" height="2"/><rect x="10" y="10" width="2" height="2"/>'
  },
  {
    id: 'WEARABLE', label: 'WEARABLE', layer: 'gear', gear: true,
    subTypes: ['HAT', 'BODY OVER', 'BACK'],
    desc: 'Hats, outfits, or capes your character can wear.',
    icon: '<rect x="3" y="2" width="3" height="1"/><rect x="10" y="2" width="3" height="1"/><rect x="2" y="3" width="5" height="1"/><rect x="9" y="3" width="5" height="1"/><rect x="1" y="4" width="14" height="3"/><rect x="4" y="7" width="8" height="7"/>'
  },
  {
    id: 'THING', label: 'THING', layer: 'bg',
    subTypes: ['BEHIND', 'IN FRONT'],
    desc: 'Decorative prop placed behind or in front of you.',
    icon: '<rect x="5" y="2" width="6" height="1"/><rect x="6" y="3" width="4" height="2"/><rect x="3" y="4" width="2" height="1"/><rect x="3" y="5" width="1" height="3"/><rect x="11" y="4" width="2" height="1"/><rect x="12" y="5" width="1" height="3"/><rect x="5" y="5" width="6" height="1"/><rect x="4" y="6" width="8" height="5"/><rect x="5" y="11" width="6" height="1"/><rect x="6" y="12" width="4" height="1"/><rect x="4" y="13" width="8" height="1"/>'
  },
  {
    id: 'LIGHT', label: 'LIGHT', layer: 'bg',
    subTypes: ['LIGHT', 'TOP LIGHT', 'FILL LIGHT', 'SURROUND LIGHT', 'LIGHT GLOW'],
    desc: 'Tints the sky or adds a glowing light.',
    icon: '<path fill-rule="evenodd" d="M6 2h4v1h1v1h1v4h-1v2H5V8H4V4h1V3h1zM6 4h2v1H7v1H6z"/><rect x="6" y="11" width="4" height="1"/><rect x="6" y="13" width="4" height="1"/><rect x="7" y="14" width="2" height="1"/><rect x="1" y="5" width="2" height="1"/><rect x="13" y="5" width="2" height="1"/><rect x="2" y="2" width="1" height="1"/><rect x="13" y="2" width="1" height="1"/><rect x="2" y="9" width="1" height="1"/><rect x="13" y="9" width="1" height="1"/>'
  },
  {
    id: 'CHANGING', label: 'CHANGING THING', layer: 'main',
    subTypes: ['LOOP', 'ON TOUCH', 'PING-PONG', 'SPARKLING', 'LIVELY', 'ITEM THROWER'],
    desc: 'Animated prop that loops, sparkles, or reacts.',
    icon: '<g opacity="0.5"><rect x="2" y="2" width="8" height="1"/><rect x="2" y="3" width="1" height="7"/><rect x="9" y="3" width="1" height="1"/><rect x="3" y="9" width="1" height="1"/></g><path fill-rule="evenodd" d="M5 5h9v9H5zM6 6h7v7H6z"/><rect x="9" y="7" width="1" height="5"/><rect x="7" y="9" width="5" height="1"/>'
  },
  {
    id: 'ENVIRONMENT', label: 'ENVIRONMENT', layer: 'bg',
    subTypes: ['RAIN', 'SNOW', 'VILLAGE DUST', 'RISING HEAT', 'MIST', 'STEAM', 'CLOUDS', 'STARS', 'WIND'],
    desc: 'Adds rain, snow, clouds, mist, stars, or wind.',
    icon: '<rect x="6" y="2" width="4" height="1"/><rect x="4" y="3" width="7" height="1"/><rect x="3" y="4" width="10" height="1"/><rect x="2" y="5" width="12" height="3"/><rect x="3" y="8" width="10" height="1"/><rect x="4" y="10" width="1" height="2"/><rect x="3" y="12" width="1" height="2"/><rect x="8" y="10" width="1" height="2"/><rect x="7" y="12" width="1" height="2"/><rect x="12" y="10" width="1" height="2"/><rect x="11" y="12" width="1" height="2"/>'
  },
  {
    id: 'BIG_THING', label: 'BIG THING', layer: 'bg',
    subTypes: ['BIG THING', 'BACK + FRONT', 'TRANSFORMING', 'VERY BIG THING'],
    desc: 'Large 2x2 or 3x3 prop like trees, doors, or arches.',
    icon: '<rect x="1" y="1" width="4" height="1"/><rect x="1" y="1" width="1" height="4"/><rect x="2" y="2" width="1" height="1"/><rect x="11" y="1" width="4" height="1"/><rect x="14" y="1" width="1" height="4"/><rect x="13" y="2" width="1" height="1"/><rect x="1" y="14" width="4" height="1"/><rect x="1" y="11" width="1" height="4"/><rect x="2" y="13" width="1" height="1"/><rect x="11" y="14" width="4" height="1"/><rect x="14" y="11" width="1" height="4"/><rect x="13" y="13" width="1" height="1"/><rect x="5" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="5" y="9" width="2" height="2"/><rect x="9" y="9" width="2" height="2"/>'
  },
  {
    id: 'MOUNTABLE', label: 'MOUNTABLE', layer: 'main',
    subTypes: ['GROUND', 'FLYING'],
    desc: 'Rideable creature or vehicle. Press Space to hop on!',
    icon: '<rect x="11" y="2" width="1" height="1"/><rect x="13" y="2" width="1" height="1"/><path fill-rule="evenodd" d="M10 3h4v1h1v2h-5zM12 4h1v1h-1z"/><rect x="9" y="5" width="3" height="3"/><rect x="6" y="6" width="3" height="1"/><rect x="3" y="7" width="8" height="4"/><rect x="1" y="7" width="2" height="2"/><rect x="1" y="9" width="1" height="2"/><rect x="3" y="11" width="1" height="3"/><rect x="5" y="11" width="1" height="3"/><rect x="8" y="11" width="1" height="3"/><rect x="10" y="11" width="1" height="3"/>'
  },
  {
    id: 'LIVING', label: 'LIVING', layer: 'main',
    subTypes: ['WANDER', 'FLIPPING', 'CHANGING', 'STILL'],
    desc: 'Cute critter or NPC that wanders around.',
    icon: '<rect x="4" y="2" width="2" height="1"/><rect x="10" y="2" width="2" height="1"/><path fill-rule="evenodd" d="M4 3h8v1h1v7h-1v1H4v-1H3V4h1zM5 6h2v2H5zM9 6h2v2H9zM7 9h2v1H7z"/><rect x="4" y="12" width="2" height="2"/><rect x="10" y="12" width="2" height="2"/>'
  },
  {
    id: 'GATHERABLE', label: 'GATHERABLE', layer: 'main',
    subTypes: ['COLLECT'],
    desc: 'Collectible item that pops when you touch it.',
    icon: '<path fill-rule="evenodd" d="M4 3h8v1h1v1h1v2h-1v1h-1v1h-1v1h-1v1H9v2H7v-2H6v-1H5V9H4V8H3V7H2V5h1V4h1zM5 5h2v1H6v1H5z"/><rect x="13" y="1" width="1" height="3"/><rect x="12" y="2" width="3" height="1"/>'
  },
  {
    id: 'HOLDABLE', label: 'HOLDABLE', layer: 'gear', gear: true,
    subTypes: ['ITEM', 'EMITTER', 'LIGHT', 'CONSUMABLE', 'AIMABLE', 'SWING LINE'],
    desc: 'Handheld item, torch, potion, or grapple line.',
    icon: '<rect x="12" y="2" width="2" height="2"/><rect x="11" y="3" width="2" height="2"/><rect x="10" y="4" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="8" y="6" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="6" y="8" width="2" height="2"/><rect x="3" y="7" width="2" height="1"/><rect x="4" y="8" width="2" height="2"/><rect x="5" y="9" width="2" height="2"/><rect x="6" y="10" width="2" height="2"/><rect x="7" y="11" width="1" height="2"/><rect x="3" y="11" width="2" height="2"/><rect x="2" y="12" width="2" height="2"/><rect x="1" y="13" width="2" height="2"/>'
  },
  {
    id: 'PLACES', label: 'PLACES', layer: 'bg', hasText: true, textLabel: 'PLACE NAME',
    subTypes: ['LABEL', 'POINTER'],
    desc: 'Location sign that pops up when you walk by.',
    icon: '<rect x="7" y="1" width="2" height="2"/><rect x="3" y="3" width="9" height="1"/><rect x="3" y="4" width="11" height="1"/><rect x="3" y="5" width="9" height="1"/><rect x="7" y="6" width="2" height="2"/><rect x="4" y="8" width="9" height="1"/><rect x="2" y="9" width="11" height="1"/><rect x="4" y="10" width="9" height="1"/><rect x="7" y="11" width="2" height="3"/><rect x="5" y="14" width="6" height="1"/>'
  },
  {
    id: 'CLIMBABLE', label: 'CLIMBABLE', layer: 'main',
    subTypes: ['LADDER'],
    desc: 'Ladder, vine, or rope you can climb up and down.',
    icon: '<rect x="3" y="1" width="2" height="14"/><rect x="11" y="1" width="2" height="14"/><rect x="5" y="3" width="6" height="1"/><rect x="5" y="6" width="6" height="1"/><rect x="5" y="9" width="6" height="1"/><rect x="5" y="12" width="6" height="1"/>'
  },
  {
    id: 'HARMFUL', label: 'HARMFUL', layer: 'main',
    subTypes: ['HARMFUL', 'CHANGING HARMFUL', 'DEADLY', 'CHANGING DEADLY', 'DEADLY EMERGING', 'DEADLY MOVING'],
    desc: 'Spikes, fire, or traps that hurt on touch.',
    icon: '<path fill-rule="evenodd" d="M4 2h8v1h1v1h1v5h-1v2H3V9H2V4h1V3h1zM4 5h3v3H4zM9 5h3v3H9zM7 8h2v2H7z"/><rect x="4" y="11" width="2" height="3"/><rect x="7" y="11" width="2" height="3"/><rect x="10" y="11" width="2" height="3"/>'
  },
  {
    id: 'CRUMBLING', label: 'CRUMBLING', layer: 'main',
    subTypes: ['CRUMBLE', 'FAST', 'INSTANT', 'FLEXIBLE'],
    desc: 'Blocks that crumble under your feet, or bendy planks.',
    icon: '<rect x="2" y="2" width="5" height="3"/><rect x="2" y="5" width="4" height="3"/><rect x="2" y="8" width="5" height="2"/><rect x="8" y="2" width="6" height="2"/><rect x="7" y="4" width="7" height="3"/><rect x="8" y="7" width="6" height="2"/><rect x="3" y="12" width="2" height="2"/><rect x="7" y="11" width="2" height="2"/><rect x="11" y="10" width="2" height="2"/><rect x="10" y="13" width="2" height="2"/>'
  },
  {
    id: 'VIEWABLE', label: 'VIEWABLE', layer: 'main', hasText: true, textLabel: 'CAPTION',
    subTypes: ['INSPECT'],
    desc: 'Artwork or picture you can zoom in to view.',
    icon: '<path fill-rule="evenodd" d="M1 2h14v12H1zM2 3h12v10H2z"/><rect x="4" y="4" width="2" height="2"/><rect x="5" y="8" width="2" height="1"/><rect x="4" y="9" width="4" height="1"/><rect x="3" y="10" width="6" height="2"/><rect x="10" y="6" width="2" height="1"/><rect x="9" y="7" width="3" height="1"/><rect x="8" y="8" width="5" height="1"/><rect x="7" y="9" width="6" height="3"/>'
  },
  {
    id: 'PUSHING', label: 'PUSHING', layer: 'main',
    subTypes: ['UP', 'RIGHT', 'LEFT', 'DOWN', 'CONVEYOR'],
    desc: 'Wind gusts or conveyor belts that push you along.',
    icon: '<rect x="7" y="2" width="2" height="2"/><rect x="5" y="3" width="2" height="2"/><rect x="9" y="3" width="2" height="2"/><rect x="3" y="5" width="2" height="2"/><rect x="11" y="5" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="5" y="8" width="2" height="2"/><rect x="9" y="8" width="2" height="2"/><rect x="3" y="10" width="2" height="2"/><rect x="11" y="10" width="2" height="2"/><rect x="4" y="13" width="1" height="2"/><rect x="7" y="12" width="2" height="2"/><rect x="11" y="13" width="1" height="2"/>'
  },
  {
    id: 'TEXTUAL', label: 'TEXTUAL', layer: 'main', hasText: true, textLabel: 'READABLE TEXT',
    subTypes: ['READABLE'],
    desc: 'Readable sign or note. Press Space to read!',
    icon: '<rect x="3" y="2" width="10" height="1"/><rect x="2" y="3" width="1" height="7"/><rect x="13" y="3" width="1" height="7"/><rect x="3" y="10" width="2" height="1"/><rect x="8" y="10" width="5" height="1"/><rect x="4" y="11" width="1" height="3"/><rect x="5" y="12" width="1" height="1"/><rect x="6" y="11" width="2" height="1"/><rect x="4" y="5" width="8" height="1"/><rect x="4" y="7" width="6" height="1"/>'
  },
  {
    id: 'BOUNCY', label: 'BOUNCY', layer: 'main',
    subTypes: ['UP', 'LEFT', 'RIGHT'],
    desc: 'Spring block that launches you into the air.',
    icon: '<rect x="2" y="2" width="12" height="2"/><rect x="5" y="4" width="2" height="1"/><rect x="7" y="5" width="2" height="1"/><rect x="9" y="6" width="2" height="1"/><rect x="7" y="7" width="2" height="1"/><rect x="5" y="8" width="2" height="1"/><rect x="7" y="9" width="2" height="1"/><rect x="9" y="10" width="2" height="1"/><rect x="7" y="11" width="2" height="1"/><rect x="3" y="12" width="10" height="2"/>'
  },
  {
    id: 'HOLDER', label: 'HOLDER', layer: 'main',
    subTypes: ['DISPLAY'],
    desc: 'Floating pedestal for displaying your pixel art.',
    icon: '<rect x="7" y="2" width="2" height="1"/><rect x="6" y="3" width="4" height="2"/><rect x="7" y="5" width="2" height="1"/><rect x="3" y="8" width="10" height="2"/><rect x="6" y="10" width="4" height="2"/><rect x="3" y="12" width="10" height="2"/>'
  },
  {
    id: 'MOVING', label: 'MOVING', layer: 'main',
    subTypes: ['HORIZ', 'VERT'],
    desc: 'Solid platform that glides back and forth.',
    icon: '<path fill-rule="evenodd" d="M5 4h6v6H5zM6 5h4v4H6z"/><rect x="7" y="6" width="2" height="2"/><rect x="3" y="4" width="1" height="6"/><rect x="2" y="5" width="1" height="4"/><rect x="1" y="6" width="1" height="2"/><rect x="12" y="4" width="1" height="6"/><rect x="13" y="5" width="1" height="4"/><rect x="14" y="6" width="1" height="2"/><rect x="2" y="12" width="12" height="1" opacity="0.55"/>'
  },
  {
    id: 'INTERACTING', label: 'INTERACTING', layer: 'main',
    subTypes: ['TOGGLE', 'CYCLE'],
    desc: 'Interactive prop that changes frames on Space.',
    icon: '<rect x="6" y="1" width="2" height="1"/><rect x="3" y="3" width="2" height="1"/><rect x="9" y="3" width="2" height="1"/><rect x="6" y="4" width="2" height="6"/><rect x="8" y="7" width="2" height="3"/><rect x="10" y="8" width="2" height="3"/><rect x="4" y="9" width="2" height="2"/><rect x="5" y="10" width="7" height="4"/>'
  },
  {
    id: 'SLIDEY', label: 'SLIDEY', layer: 'main',
    subTypes: ['ICE'],
    desc: 'Slippery ice block that lets you slide.',
    icon: '<path fill-rule="evenodd" d="M2 2h12v12H2zM4 4h8v8H4z"/><rect x="5" y="9" width="1" height="1"/><rect x="6" y="8" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/><rect x="8" y="6" width="1" height="1"/><rect x="9" y="5" width="1" height="1"/><rect x="8" y="10" width="1" height="1"/><rect x="9" y="9" width="1" height="1"/><rect x="10" y="8" width="1" height="1"/>'
  },
  {
    id: 'PHYSICS', label: 'PHYSICS', layer: 'main',
    subTypes: PHYSICS_SUBTYPES.slice(),
    desc: 'Physics blocks you can push, grab, and toss!',
    icon: '<path fill-rule="evenodd" d="M9 3h4v1h1v4h-1v1H9V8H8V4h1zM9 4h2v1h-1v1H9z"/><rect x="2" y="7" width="1" height="2" opacity="0.6"/><rect x="3" y="9" width="2" height="2" opacity="0.75"/><rect x="5" y="10" width="2" height="1" opacity="0.75"/><rect x="7" y="8" width="1" height="2" opacity="0.6"/><rect x="1" y="13" width="14" height="1"/>'
  },
  {
    id: 'DYNAMIC', label: 'DYNAMIC', layer: 'main',
    subTypes: DYNAMIC_SUBTYPES.slice(),
    desc: 'Animated prop that spins, floats, pulses, or fades.',
    icon: '<rect x="7" y="1" width="2" height="3"/><rect x="7" y="12" width="2" height="3"/><rect x="1" y="7" width="3" height="2"/><rect x="12" y="7" width="3" height="2"/><path fill-rule="evenodd" d="M5 5h6v6H5zM7 7h2v2H7z"/><rect x="3" y="3" width="2" height="2" opacity="0.65"/><rect x="11" y="11" width="2" height="2" opacity="0.65"/><rect x="11" y="3" width="2" height="2" opacity="0.45"/><rect x="3" y="11" width="2" height="2" opacity="0.45"/>'
  },
  {
    id: 'SLOPE', label: 'SLOPE', layer: 'main',
    subTypes: ['UP-RIGHT /', 'UP-LEFT \\', 'SLIDEY /', 'SLIDEY \\'],
    desc: 'Smooth ramp or icy slide you can walk up.',
    icon: '<rect x="12" y="2" width="2" height="12"/><rect x="10" y="4" width="2" height="10"/><rect x="8" y="6" width="2" height="8"/><rect x="6" y="8" width="2" height="6"/><rect x="4" y="10" width="2" height="4"/><rect x="2" y="12" width="2" height="2"/>'
  },
  {
    id: 'TRANSPORTING', label: 'TRANSPORTING', layer: 'main',
    subTypes: ['PORTAL', 'ON TOUCH', 'DIRECTIONAL'],
    desc: 'Portal that teleports you to another portal.',
    icon: '<rect x="2" y="3" width="2" height="1"/><rect x="1" y="4" width="1" height="8"/><rect x="4" y="4" width="1" height="8"/><rect x="2" y="12" width="2" height="1"/><rect x="12" y="3" width="2" height="1"/><rect x="11" y="4" width="1" height="8"/><rect x="14" y="4" width="1" height="8"/><rect x="12" y="12" width="2" height="1"/><rect x="6" y="7" width="2" height="2"/><rect x="8" y="6" width="1" height="4"/><rect x="9" y="7" width="1" height="2"/>'
  },
  {
    id: 'LIQUID', label: 'LIQUID', layer: 'main',
    subTypes: ['WATER'],
    desc: 'Water, lava, or goo you can swim through.',
    icon: '<path fill-rule="evenodd" d="M7 1h2v2h1v2h1v3h-1v1H6V8H5V5h1V3h1zM6 5h1v2H6z"/><rect x="1" y="11" width="3" height="1"/><rect x="4" y="10" width="3" height="1"/><rect x="7" y="11" width="3" height="1"/><rect x="10" y="10" width="3" height="1"/><rect x="13" y="11" width="2" height="1"/><rect x="2" y="13" width="4" height="1" opacity="0.55"/><rect x="9" y="13" width="5" height="1" opacity="0.55"/>'
  },
  {
    id: 'ACTIVATOR', label: 'ACTIVATOR', layer: 'main',
    subTypes: ['SWITCH', 'PRESSURE PLATE', 'TIMER', 'PROXIMITY', 'NOT GATE', 'AND GATE', 'OR / RELAY', 'DOOR', 'PISTON', 'CHANGE'],
    desc: 'Switches, doors, and pistons you can wire together.',
    icon: '<path fill-rule="evenodd" d="M5 9h6v2h3v3H2v-3h3zM4 12h2v1H4z"/><rect x="8" y="7" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="10" y="3" width="2" height="2"/><rect x="11" y="2" width="3" height="3"/>'
  }
];

export const TYPE_MAP = new Map(TYPE_DEFS.map(t => [t.id, t]));

export const LIGHT_FILL_MODES = ['FULL SCREEN', 'TOP HALF', 'BOTTOM HALF', 'LEFT HALF', 'RIGHT HALF', 'CENTER BAND'];
export const LIGHT_SURROUND_THICKS = ['NORMAL', 'THICK', 'VERY THICK'];
export const LIGHT_GLOW_BEHAVIORS = ['STATIC', 'PULSATING', 'FLICKERING', 'SPINNING'];
export const LIGHT_GLOW_STYLES = ['TRANSLUCENT', 'ADDITIVE GLOW', 'SOFT HAZE'];
export const LIGHT_GLOW_SIZE = 38;
export const BIG_THING_SIZE = 38;
export const VERY_BIG_THING_SIZE = 57;
export const BIG_THING_SUBTYPES = ['BIG THING', 'BACK + FRONT', 'TRANSFORMING', 'VERY BIG THING'];
export const BIG_THING_PLACEMENTS = ['BEHIND', 'IN FRONT'];
export const BIG_THING_FX = ['NONE', 'FADE', 'SPARKLE', 'SWAY', 'GLOW'];
export const BIG_THING_TIME_UNITS = ['SEC', 'MIN', 'HR'];
export const BIG_THING_START_POINTS = ['CELL 1', 'RANDOM', 'SYNCED'];
export const BIG_THING_MAX_HOURS = 8544;
export const BIG_THING_MAX_TRANSFORM_CELLS = 4;

export function defaultBigOpts() {
  return {
    placement: 'BEHIND',
    fx: 'NONE',
    climbable: false,
    intervalVal: 3,
    intervalUnit: 'SEC',
    startPoint: 'CELL 1',
    repeat: true,
    giveItemId: ''
  };
}

export function sanitizeBigOpts(raw) {
  const base = defaultBigOpts();
  if (!raw || typeof raw !== 'object') return base;
  const unit = BIG_THING_TIME_UNITS.includes(raw.intervalUnit) ? raw.intervalUnit : base.intervalUnit;
  const maxVal = unit === 'HR'
    ? BIG_THING_MAX_HOURS
    : (unit === 'MIN' ? BIG_THING_MAX_HOURS * 60 : BIG_THING_MAX_HOURS * 3600);
  const parsedVal = Math.round(Number(raw.intervalVal));
  const intervalVal = Number.isFinite(parsedVal) && parsedVal >= 1
    ? Math.min(maxVal, parsedVal)
    : base.intervalVal;
  return {
    placement: BIG_THING_PLACEMENTS.includes(raw.placement) ? raw.placement : base.placement,
    fx: BIG_THING_FX.includes(raw.fx) ? raw.fx : base.fx,
    climbable: Boolean(raw.climbable),
    intervalVal,
    intervalUnit: unit,
    startPoint: BIG_THING_START_POINTS.includes(raw.startPoint) ? raw.startPoint : base.startPoint,
    repeat: typeof raw.repeat === 'boolean' ? raw.repeat : base.repeat,
    giveItemId: typeof raw.giveItemId === 'string' ? raw.giveItemId.trim() : ''
  };
}

export function getBigThingIntervalSec(bigOpts) {
  const o = bigOpts || defaultBigOpts();
  const unitMult = o.intervalUnit === 'HR' ? 3600 : (o.intervalUnit === 'MIN' ? 60 : 1);
  const rawSec = (Number(o.intervalVal) || 3) * unitMult;
  return Math.max(1, Math.min(BIG_THING_MAX_HOURS * 3600, rawSec));
}

export function isVeryBigThingSubType(subType) {
  return subType === 'VERY BIG THING' || subType === '3X3 HUGE';
}

export function getBigThingTileMult(spOrSubType) {
  const sub = typeof spOrSubType === 'string' ? spOrSubType : (spOrSubType && spOrSubType.subType);
  return isVeryBigThingSubType(sub) ? 3 : 2;
}

export function maxSizeForType(type, subType) {
  if (type === 'BIG_THING') {
    return isVeryBigThingSubType(subType) ? VERY_BIG_THING_SIZE : BIG_THING_SIZE;
  }
  return 32;
}
export const LIGHT_CORE_RADIUS = TILE * 11;
export const LIGHT_PROXIMITY_RADIUS = TILE * 28;
export const ENV_CORE_RADIUS = TILE * 11;
export const ENV_PROXIMITY_RADIUS = TILE * 28;

export const ENV_INTENSITIES = ['SUBTLE', 'NORMAL', 'HEAVY'];
export const WIND_DIRECTIONS = ['RIGHT', 'LEFT', 'GUSTY'];
export const WIND_STRENGTHS = ['BREEZE', 'STRONG', 'GALE'];
export const ENV_ATTR_DESC = {
  RAIN: 'Falling rain that splashes on blocks.',
  SNOW: 'Soft snow that drifts and settles.',
  'VILLAGE DUST': 'Floating sunlit dust motes.',
  'RISING HEAT': 'Warm rising shimmer and embers.',
  MIST: 'Soft low fog across the ground.',
  STEAM: 'Rising puffs of steam.',
  CLOUDS: 'Drifting sky clouds.',
  STARS: 'Twinkling night sky stars.',
  WIND: 'Blows clouds, rain, snow, and dust.'
};

export function defaultEnvOpts() {
  return {
    intensity: 'NORMAL',
    windDir: 'RIGHT',
    windStrength: 'STRONG'
  };
}

export function sanitizeEnvOpts(raw) {
  const base = defaultEnvOpts();
  if (!raw || typeof raw !== 'object') return base;
  return {
    intensity: ENV_INTENSITIES.includes(raw.intensity) ? raw.intensity : base.intensity,
    windDir: WIND_DIRECTIONS.includes(raw.windDir) ? raw.windDir : base.windDir,
    windStrength: WIND_STRENGTHS.includes(raw.windStrength) ? raw.windStrength : base.windStrength
  };
}

export const LIQUID_HAZARDS = ['NONE', 'HARMFUL', 'EXTRA HARMFUL'];

export function defaultLiquidOpts() {
  return {
    breathable: false,
    thick: false,
    hazard: 'NONE'
  };
}

export function sanitizeLiquidOpts(raw) {
  const base = defaultLiquidOpts();
  if (!raw || typeof raw !== 'object') return base;
  return {
    breathable: Boolean(raw.breathable),
    thick: Boolean(raw.thick),
    hazard: LIQUID_HAZARDS.includes(raw.hazard) ? raw.hazard : base.hazard
  };
}

export function isSlideySlopeSubType(subType) {
  return subType === 'SLIDEY /' || subType === 'SLIDEY \\';
}

export function isUpLeftSlopeSubType(subType) {
  return subType === 'UP-LEFT \\' || subType === 'SLIDEY \\';
}

export const SURFACE_SOUNDS = [
  'DEFAULT',
  'STONE',
  'WOOD',
  'GRASS',
  'DIRT',
  'SAND',
  'SNOW',
  'MUD',
  'METAL',
  'GLASS',
  'ICE',
  'CARPET',
  'SLIME'
];

export const SURFACE_PARTICLE_COLORS = {
  DEFAULT: '#9aa4b8',
  STONE: '#9aa4b8',
  WOOD: '#b88d63',
  GRASS: '#7ec472',
  DIRT: '#9c7b5c',
  SAND: '#dfc188',
  SNOW: '#eef5ff',
  MUD: '#6e5844',
  METAL: '#c6d2e4',
  GLASS: '#dff6ff',
  ICE: '#b4d6f5',
  CARPET: '#c49db2',
  SLIME: '#7de38b'
};

export const POSE_ACTIONS = ['NONE', 'SIT', 'LAY'];

export function supportsSurfaceSound(typeId) {
  return (
    typeId === 'SOLID' ||
    typeId === 'SLOPE' ||
    typeId === 'SLIDEY' ||
    typeId === 'CRUMBLING' ||
    typeId === 'MOVING' ||
    typeId === 'BOUNCY' ||
    typeId === 'ACTIVATOR' ||
    typeId === 'HARMFUL'
  );
}

export function supportsPoseAction(typeId) {
  return (
    typeId === 'SOLID' ||
    typeId === 'THING' ||
    typeId === 'BIG_THING' ||
    typeId === 'CHANGING' ||
    typeId === 'INTERACTING' ||
    typeId === 'HOLDER'
  );
}

export function sanitizeSurfaceSound(raw) {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : 'DEFAULT';
  return SURFACE_SOUNDS.includes(s) ? s : 'DEFAULT';
}

export function sanitizePoseAction(raw) {
  const p = typeof raw === 'string' ? raw.trim().toUpperCase() : 'NONE';
  return POSE_ACTIONS.includes(p) ? p : 'NONE';
}

export function resolveSurfaceSound(info) {
  if (!info) return 'DEFAULT';
  if (info.sp && info.sp.surfaceSound && info.sp.surfaceSound !== 'DEFAULT') {
    return info.sp.surfaceSound;
  }
  if (info.type === 'SLIDEY' || (info.type === 'SLOPE' && isSlideySlopeSubType(info.subType))) {
    return 'ICE';
  }
  if (info.type === 'SOLID' && info.subType === 'STICKY') {
    return 'SLIME';
  }
  return 'DEFAULT';
}

export function inferSurfaceSoundFromName(rawName) {
  const n = String(rawName || '').toUpperCase();
  if (!n.trim()) return null;
  if (/\b(GRASS|LAWN|MOSS|TURF|LEAF|LEAVES|BUSH|HEDGE|FOLIAGE)\b/.test(n)) return 'GRASS';
  if (/\b(METAL|IRON|STEEL|PIPE|GRATE|TIN|COPPER|ALUMINUM|CHAIN|ANVIL)\b/.test(n)) return 'METAL';
  if (/\b(GLASS|CRYSTAL|WINDOW|MIRROR|GEM|DIAMOND|QUARTZ)\b/.test(n)) return 'GLASS';
  if (/\b(MUD|SWAMP|BOG|CLAY|MIRE|MARSH|SLUDGE)\b/.test(n)) return 'MUD';
  if (/\b(SNOW|SNOWY|FROST|SLUSH|POWDER)\b/.test(n)) return 'SNOW';
  if (/\b(SAND|SANDY|BEACH|DUNE|GRAVEL|DESERT)\b/.test(n)) return 'SAND';
  if (/\b(WOOD|WOODEN|PLANK|PLANKS|LOG|BARK|BOARD|DECK|FLOORBOARD|OAK|PINE|TIMBER)\b/.test(n)) return 'WOOD';
  if (/\b(STONE|ROCK|BRICK|COBBLE|MARBLE|GRANITE|CONCRETE|SLATE|PAVEMENT)\b/.test(n)) return 'STONE';
  if (/\b(DIRT|SOIL|EARTH|GROUND|LOAM|PATH)\b/.test(n)) return 'DIRT';
  if (/\b(ICE|ICY|GLACIER|FROZEN)\b/.test(n)) return 'ICE';
  if (/\b(CARPET|RUG|WOOL|CLOTH|FABRIC|CUSHION|VELVET|MAT)\b/.test(n)) return 'CARPET';
  if (/\b(SLIME|GOO|JELLY|HONEY|GEL|OOZE|GUM)\b/.test(n)) return 'SLIME';
  return null;
}

export function inferPoseActionFromName(rawName) {
  const n = String(rawName || '').toUpperCase();
  if (!n.trim()) return null;
  if (/\b(BED|HAMMOCK|FUTON|COT|MATTRESS|CRIB|BUNK|SLEEPING)\b/.test(n)) return 'LAY';
  if (/\b(CHAIR|COUCH|SOFA|STOOL|BENCH|THRONE|TOILET|SEAT|ARMCHAIR|RECLINER)\b/.test(n)) return 'SIT';
  return null;
}

export function findLayMotionSprite(sprites) {
  if (!Array.isArray(sprites)) return null;
  let fallback = null;
  for (let i = 0; i < sprites.length; i++) {
    const sp = sprites[i];
    if (!sp || sp.type !== 'BODY' || sp.subType !== 'MOTION') continue;
    const n = String(sp.name || '').trim().toUpperCase();
    if (n === 'SLEEP' || n === 'LAY' || n === 'LAYING' || n === 'SLEEPING') return sp;
    if (!fallback && /\b(SLEEP|SLEEPING|LAY|LAYING|LIE|LYING|NAP|REST)\b/.test(n)) {
      fallback = sp;
    }
  }
  return fallback;
}

export const HARM_STRENGTHS = ['LOW', 'NORMAL', 'HIGH'];
export const HARM_DAMAGE_MAP = { LOW: 10, NORMAL: 20, HIGH: 35 };
export const HARM_EMERGE_DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
export const HARM_MOVE_AXES = ['HORIZ', 'VERT'];
export const HARM_SPEEDS = ['SLOW', 'NORMAL', 'FAST'];
export const HARM_SUBTYPES = ['HARMFUL', 'CHANGING HARMFUL', 'DEADLY', 'CHANGING DEADLY', 'DEADLY EMERGING', 'DEADLY MOVING'];

export function defaultHarmOpts() {
  return {
    strength: 'NORMAL',
    solid: false,
    inFront: false,
    knockback: true,
    emergeDir: 'UP',
    moveAxis: 'HORIZ',
    speed: 'NORMAL'
  };
}

export function sanitizeHarmOpts(raw) {
  const base = defaultHarmOpts();
  if (!raw || typeof raw !== 'object') return base;
  return {
    strength: HARM_STRENGTHS.includes(raw.strength) ? raw.strength : base.strength,
    solid: Boolean(raw.solid),
    inFront: Boolean(raw.inFront),
    knockback: typeof raw.knockback === 'boolean' ? raw.knockback : base.knockback,
    emergeDir: HARM_EMERGE_DIRS.includes(raw.emergeDir) ? raw.emergeDir : base.emergeDir,
    moveAxis: HARM_MOVE_AXES.includes(raw.moveAxis) ? raw.moveAxis : base.moveAxis,
    speed: HARM_SPEEDS.includes(raw.speed) ? raw.speed : base.speed
  };
}

export function getHarmDamage(sp) {
  const str = (sp && sp.harmOpts && sp.harmOpts.strength) || 'NORMAL';
  return HARM_DAMAGE_MAP[str] || 20;
}

export function isDeadlyHarmSubType(subType) {
  return (
    subType === 'DEADLY' ||
    subType === 'CHANGING DEADLY' ||
    subType === 'DEADLY EMERGING' ||
    subType === 'DEADLY MOVING'
  );
}

export function isAnimatedHarmSubType(subType) {
  return (
    subType === 'CHANGING HARMFUL' ||
    subType === 'CHANGING DEADLY'
  );
}

/* Single-cel vs. Multi-cel Creation Policy:
   Static creation types are hardlocked to 1 cel so "Things" and "Changing Things"
   stay cleanly distinct. Only types/subtypes that functionally require multiple
   cels (Changing, Interacting, Body/Motion, Changing Hazards/Living, Activator
   Change, Light Glow, and Big Thing Back+Front / Transforming) unlock extra cels. */
export function getCelPolicy(type, subType) {
  if (type === 'BODY') {
    return {
      mode: subType === 'MOTION' ? 'multi' : 'body-rig',
      min: 1,
      max: 64,
      single: false,
      reason: ''
    };
  }
  if (type === 'LIGHT' && subType === 'LIGHT GLOW') {
    return {
      mode: 'fixed',
      min: 2,
      max: 2,
      single: false,
      reason: 'LIGHT GLOW HAS 2 CELS (19x19 + 38x38)'
    };
  }
  if (type === 'BIG_THING') {
    if (subType === 'BACK + FRONT') {
      return {
        mode: 'fixed',
        min: 2,
        max: 2,
        single: false,
        reason: 'BACK + FRONT HAS 2 CELS (BACK + FRONT)'
      };
    }
    if (subType === 'TRANSFORMING') {
      return {
        mode: 'capped',
        min: 1,
        max: BIG_THING_MAX_TRANSFORM_CELLS,
        single: false,
        reason: `TRANSFORMING ALLOWS UP TO ${BIG_THING_MAX_TRANSFORM_CELLS} CELS`
      };
    }
    return {
      mode: 'single',
      min: 1,
      max: 1,
      single: true,
      reason: '1 CEL ONLY - USE TRANSFORMING FOR MULTI-CEL'
    };
  }
  if (type === 'CHANGING' || type === 'INTERACTING' || type === 'DYNAMIC') {
    return { mode: 'multi', min: 1, max: 64, single: false, reason: '' };
  }
  if (type === 'HARMFUL' && isAnimatedHarmSubType(subType)) {
    return { mode: 'multi', min: 1, max: 64, single: false, reason: '' };
  }
  if (type === 'LIVING' && subType === 'CHANGING') {
    return { mode: 'multi', min: 1, max: 64, single: false, reason: '' };
  }
  if (type === 'ACTIVATOR' && subType === 'CHANGE') {
    return { mode: 'multi', min: 1, max: 64, single: false, reason: '' };
  }

  let reason = '1 CEL ONLY - USE CHANGING THING FOR MULTI-CEL';
  if (type === 'HARMFUL') reason = '1 CEL ONLY - USE CHANGING HARMFUL OR CHANGING DEADLY';
  else if (type === 'LIVING') reason = '1 CEL ONLY - USE LIVING (CHANGING) FOR MULTI-CEL';
  else if (type === 'ACTIVATOR') reason = '1 CEL ONLY - USE ACTIVATOR (CHANGE) FOR MULTI-CEL';
  else if (type === 'LIGHT') reason = '1 CEL ONLY - USE LIGHT GLOW FOR 2-CEL GLOW';
  return { mode: 'single', min: 1, max: 1, single: true, reason };
}

export function isSingleCelType(type, subType) {
  return getCelPolicy(type, subType).single;
}

export function isEmergingHarmSubType(subType) {
  return subType === 'DEADLY EMERGING';
}

export function isMovingHarmSubType(subType) {
  return subType === 'DEADLY MOVING';
}

export function defaultLightOpts() {
  return {
    pulsating: false,
    thick: false,
    fillMode: 'FULL SCREEN',
    surroundThick: 'NORMAL',
    glowBehavior: 'PULSATING',
    glowStyle: 'TRANSLUCENT'
  };
}

export function sanitizeLightOpts(raw) {
  const base = defaultLightOpts();
  if (!raw || typeof raw !== 'object') return base;
  return {
    pulsating: Boolean(raw.pulsating),
    thick: Boolean(raw.thick),
    fillMode: LIGHT_FILL_MODES.includes(raw.fillMode) ? raw.fillMode : base.fillMode,
    surroundThick: LIGHT_SURROUND_THICKS.includes(raw.surroundThick) ? raw.surroundThick : base.surroundThick,
    glowBehavior: LIGHT_GLOW_BEHAVIORS.includes(raw.glowBehavior) ? raw.glowBehavior : base.glowBehavior,
    glowStyle: LIGHT_GLOW_STYLES.includes(raw.glowStyle) ? raw.glowStyle : base.glowStyle
  };
}

export function getTypeDef(typeId) {
  return TYPE_MAP.get(typeId) || TYPE_MAP.get('SOLID');
}

export function isGearType(typeId) {
  return typeId === 'BODY' || typeId === 'WEARABLE' || typeId === 'HOLDABLE';
}

export function migrateLegacyType(rawType, rawSubType) {
  if (rawType === 'BG') return { type: 'BACK', subType: rawSubType || 'BACK' };
  if (rawType === 'FG') return { type: 'THING', subType: rawSubType || 'IN FRONT' };
  if (rawType === 'CLIMB') return { type: 'CLIMBABLE', subType: rawSubType || 'LADDER' };
  if (rawType === 'BOUNCE') return { type: 'BOUNCY', subType: rawSubType || 'UP' };
  if (rawType === 'SLIP') return { type: 'SLIDEY', subType: rawSubType || 'ICE' };
  if (rawType === 'LIGHT') {
    if (rawSubType === 'GLOW') return { type: 'LIGHT', subType: 'LIGHT GLOW' };
    if (rawSubType === 'WARM' || rawSubType === 'ORANGE' || rawSubType === 'COOL') {
      return { type: 'LIGHT', subType: 'LIGHT' };
    }
  }
  if (rawType === 'ENVIRONMENT') {
    if (rawSubType === 'EMBERS') return { type: 'ENVIRONMENT', subType: 'RISING HEAT' };
    if (rawSubType === 'DUST') return { type: 'ENVIRONMENT', subType: 'VILLAGE DUST' };
  }
  if (rawType === 'BIG_THING') {
    if (rawSubType === '2X2 BIG' || rawSubType === 'FRONT 2X2') {
      return { type: 'BIG_THING', subType: 'BIG THING' };
    }
    if (rawSubType === '3X3 HUGE') {
      return { type: 'BIG_THING', subType: 'VERY BIG THING' };
    }
  }
  if (rawType === 'DYNAMIC') {
    if (!rawSubType || PHYSICS_SUBTYPES.includes(rawSubType)) {
      return {
        type: 'PHYSICS',
        subType: PHYSICS_SUBTYPES.includes(rawSubType) ? rawSubType : 'CRATE'
      };
    }
    return {
      type: 'DYNAMIC',
      subType: DYNAMIC_SUBTYPES.includes(rawSubType) ? rawSubType : DYNAMIC_SUBTYPES[0]
    };
  }
  if (rawType === 'HARMFUL') {
    if (HARM_SUBTYPES.includes(rawSubType)) {
      return { type: 'HARMFUL', subType: rawSubType };
    }
    return { type: 'HARMFUL', subType: 'HARMFUL' };
  }
  const def = TYPE_MAP.get(rawType) || TYPE_MAP.get('SOLID');
  const sub = def.subTypes.includes(rawSubType) ? rawSubType : def.subTypes[0];
  return { type: def.id, subType: sub };
}

export const PHYS = {
  walkMax: 112,               // Calm ~5.9 tiles/sec Manyland-inspired pace
  groundAccel: 650,           // Weighted ramp-up
  groundDecel: 720,           // Smooth deliberate stop
  airAccel: 450,
  airDecel: 180,
  gravity: 550,
  maxFall: 280,
  jumpVel: -232,
  jumpCutFactor: 0.55,        // Variable jump height on early W/Up release
  coyoteMax: 0.09,            // 90 ms
  jumpBufMax: 0.10,           // 100 ms
  climbSpeed: 72,
  liquidGravity: 132,
  liquidBuoyancy: 95,         // Gentle upward float acceleration toward surface
  liquidFloatSpeed: -26,      // Calm, slow upward rising speed when floating to top
  liquidDiveSpeed: 84,        // Active downward swim speed when holding S/Down
  liquidSwimAccelX: 280,      // Fluid horizontal swim thrust
  liquidDragX: 145,           // Smooth water glide resistance
  liquidMaxX: 80,             // Max horizontal swim speed
  liquidSwimVel: -96,         // Active upward swim speed when holding W/Up underwater
  liquidSwimAccel: 360,       // Active vertical swim thrust
  liquidExitHop: -206,        // Clean leap out of the water surface
  slipAccel: 200,
  slipDecel: 78,
  bounceVel: -322
};

export const BASE_PALETTE = ['#000000', '#ffffff'];

export const JOINT_KINDS = ['ROPE', 'ROD', 'SPRING'];

export function getPhysicsSpec(subType) {
  switch (subType) {
    case 'BOUNCY BALL':
      return { mass: 0.65, restitution: 0.74, drag: 1.2, isBall: true, isWheel: false, isThruster: false, isExplosive: false, isHeavy: false, floats: true, standable: false };
    case 'HEAVY METAL':
      return { mass: 3.2, restitution: 0.10, drag: 8.5, isBall: false, isWheel: false, isThruster: false, isExplosive: false, isHeavy: true, floats: false, standable: true };
    case 'WHEEL':
      return { mass: 1.1, restitution: 0.22, drag: 1.8, isBall: true, isWheel: true, isThruster: false, isExplosive: false, isHeavy: false, floats: true, standable: true };
    case 'THRUSTER':
      return { mass: 1.25, restitution: 0.18, drag: 3.2, isBall: false, isWheel: false, isThruster: true, isExplosive: false, isHeavy: false, floats: true, standable: true };
    case 'EXPLOSIVE':
      return { mass: 0.95, restitution: 0.24, drag: 5.5, isBall: false, isWheel: false, isThruster: false, isExplosive: true, isHeavy: false, floats: true, standable: true };
    default: // CRATE
      return { mass: 1.0, restitution: 0.14, drag: 6.8, isBall: false, isWheel: false, isThruster: false, isExplosive: false, isHeavy: false, floats: true, standable: true };
  }
}

export const ACT_SWITCH_MODES = ['TOGGLE', 'TIMED', 'PULSE'];
export const ACT_CHANGE_SOLIDS = ['PASSABLE', 'SOLID WHEN ON', 'SOLID WHEN OFF'];

export const MOTION_RENDER_MODES = ['REPLACE', 'OVERLAY'];
export const MOTION_PLAY_MODES = ['HOLD', 'QUICK', 'SPOKEN'];
export const MOTION_PARTICLES = ['NONE', 'HEARTS', 'SPARKLES', 'SWEAT', 'NOTES', 'POOF'];
export const MOTION_BAR_SLOTS = 8;

export function defaultMotionOpts() {
  return {
    renderMode: 'REPLACE',
    playMode: 'HOLD',
    keywords: '',
    particles: 'NONE',
    hideBody: false,
    launchFx: false
  };
}

export function sanitizeMotionOpts(raw) {
  const base = defaultMotionOpts();
  if (!raw || typeof raw !== 'object') return base;
  const kw = typeof raw.keywords === 'string'
    ? raw.keywords.replace(/\s+/g, ' ').trim().slice(0, 80)
    : '';
  return {
    renderMode: MOTION_RENDER_MODES.includes(raw.renderMode) ? raw.renderMode : base.renderMode,
    playMode: MOTION_PLAY_MODES.includes(raw.playMode) ? raw.playMode : base.playMode,
    keywords: kw,
    particles: MOTION_PARTICLES.includes(raw.particles) ? raw.particles : base.particles,
    hideBody: Boolean(raw.hideBody),
    launchFx: Boolean(raw.launchFx)
  };
}

export function isMotionBarEligible(sp) {
  if (!sp) return false;
  if (sp.type === 'BODY' && sp.subType === 'MOTION') return true;
  if (sp.type === 'DYNAMIC' && sp.dynamicOpts && sp.dynamicOpts.mode && sp.dynamicOpts.mode !== 'WORLD') {
    return true;
  }
  return false;
}

export function defaultActOpts() {
  return {
    switchMode: 'TOGGLE',
    duration: 3,
    interval: 1.5,
    range: 4,
    delay: 0,
    changeSolid: 'PASSABLE'
  };
}

export function sanitizeActOpts(raw) {
  const base = defaultActOpts();
  if (!raw || typeof raw !== 'object') return base;
  const dur = Number(raw.duration);
  const intv = Number(raw.interval);
  const rng = Math.round(Number(raw.range));
  const dly = Number(raw.delay);
  return {
    switchMode: ACT_SWITCH_MODES.includes(raw.switchMode) ? raw.switchMode : base.switchMode,
    duration: Number.isFinite(dur) ? Math.max(0.5, Math.min(30, Math.round(dur * 2) / 2)) : base.duration,
    interval: Number.isFinite(intv) ? Math.max(0.4, Math.min(10, Math.round(intv * 10) / 10)) : base.interval,
    range: Number.isFinite(rng) ? Math.max(2, Math.min(8, rng)) : base.range,
    delay: Number.isFinite(dly) ? Math.max(0, Math.min(10, Math.round(dly * 2) / 2)) : base.delay,
    changeSolid: ACT_CHANGE_SOLIDS.includes(raw.changeSolid) ? raw.changeSolid : base.changeSolid
  };
}

export function isWireLogicInfo(info) {
  if (!info || info.type !== 'ACTIVATOR') return false;
  return info.subType === 'NOT GATE' || info.subType === 'AND GATE' || info.subType === 'OR / RELAY';
}

export function isWireSourceInfo(info) {
  if (!info) return false;
  if (info.type === 'ACTIVATOR') {
    return (
      info.subType === 'SWITCH' ||
      info.subType === 'PRESSURE PLATE' ||
      info.subType === 'TIMER' ||
      info.subType === 'PROXIMITY' ||
      isWireLogicInfo(info)
    );
  }
  return info.type === 'INTERACTING';
}

export function isWireTargetInfo(info) {
  if (!info) return false;
  if (info.type === 'ACTIVATOR') {
    return (
      info.subType === 'DOOR' ||
      info.subType === 'PISTON' ||
      info.subType === 'CHANGE' ||
      isWireLogicInfo(info)
    );
  }
  if (info.type === 'PHYSICS') {
    return info.subType === 'THRUSTER' || info.subType === 'WHEEL' || info.subType === 'EXPLOSIVE';
  }
  if (info.type === 'DYNAMIC') return true;
  if (info.type === 'MOVING') return true;
  if (info.type === 'CHANGING' && info.subType === 'ITEM THROWER') return true;
  if (info.type === 'PUSHING') return true;
  return false;
}

export function defaultBackOpts() {
  return {
    smartFill: true
  };
}

export function sanitizeBackOpts(raw) {
  if (!raw || typeof raw !== 'object') return defaultBackOpts();
  return {
    smartFill: raw.smartFill !== false
  };
}

export function isSmartBackSprite(sp) {
  return Boolean(sp && sp.type === 'BACK' && sp.subType !== 'FAR BACK' && (!sp.backOpts || sp.backOpts.smartFill !== false));
}

/* =========================================================================
   WORLD SCENERY STUDIO (WIDE-CANVAS MULTI-DEPTH PARALLAX BACKDROPS)
   Per-world panoramic pixel-art parallax layers (no anchor tiles needed).
   ========================================================================= */
export const SCENERY_W = 240;
export const SCENERY_H = 120;
export const SCENERY_MAX_LAYERS = 6;
export const SCENERY_DRIFTS = ['NONE', 'LEFT', 'RIGHT', 'WIND'];
export const SCENERY_PALETTE = [
  '#ffffff', '#dfe8f5', '#b3c6de', '#7c96b8', '#4c6588', '#2c3d59', '#1b2538', '#111622',
  '#f4d6a8', '#e8a86a', '#c9724b', '#8d4642', '#522c3c', '#352236', '#7b6399', '#4f4475',
  '#a5d6a7', '#63a375', '#3b7059', '#254741', '#c7b88d', '#917f5e', '#5e503f', '#382f28'
];

export function defaultSceneryLayer(name = 'LAYER 1', depth = 0.22) {
  const safeDepth = Math.round(Math.max(0.05, Math.min(0.65, Number(depth) || 0.22)) * 100) / 100;
  return {
    id: 'sc_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
    name: String(name || 'LAYER 1').trim().toUpperCase().slice(0, 20) || 'LAYER 1',
    visible: true,
    w: SCENERY_W,
    h: SCENERY_H,
    depth: safeDepth,
    yOffset: 0,
    opacity: 95,
    atmoTint: 60,
    autoScale: true,
    tileX: true,
    drift: 'NONE',
    pixels: { p: [], d: [0, SCENERY_W * SCENERY_H] }
  };
}

export function sanitizeSceneryLayer(raw, idx = 1) {
  const base = defaultSceneryLayer('LAYER ' + idx, 0.22);
  if (!raw || typeof raw !== 'object') return base;
  const w = Math.round(Number(raw.w)) === SCENERY_W ? SCENERY_W : SCENERY_W;
  const h = Math.round(Number(raw.h)) === SCENERY_H ? SCENERY_H : SCENERY_H;
  const rawDepth = Number(raw.depth);
  const depth = Number.isFinite(rawDepth) ? Math.round(Math.max(0.05, Math.min(0.65, rawDepth)) * 100) / 100 : base.depth;
  const rawY = Math.round(Number(raw.yOffset));
  const yOffset = Number.isFinite(rawY) ? Math.max(-160, Math.min(160, rawY)) : 0;
  const rawOp = Math.round(Number(raw.opacity));
  const opacity = Number.isFinite(rawOp) ? Math.max(10, Math.min(100, rawOp)) : base.opacity;
  const rawTint = Math.round(Number(raw.atmoTint));
  const atmoTint = Number.isFinite(rawTint) ? Math.max(0, Math.min(100, rawTint)) : base.atmoTint;
  const pixels = (raw.pixels && typeof raw.pixels === 'object' && Array.isArray(raw.pixels.p) && Array.isArray(raw.pixels.d))
    ? { p: raw.pixels.p.slice(0, 512), d: raw.pixels.d.slice() }
    : { p: [], d: [0, w * h] };
  return {
    id: (typeof raw.id === 'string' && raw.id.trim()) ? raw.id.trim() : base.id,
    name: (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ('LAYER ' + idx)).toUpperCase().slice(0, 20),
    visible: raw.visible !== false,
    w,
    h,
    depth,
    yOffset,
    opacity,
    atmoTint,
    autoScale: raw.autoScale !== false,
    tileX: raw.tileX !== false,
    drift: SCENERY_DRIFTS.includes(raw.drift) ? raw.drift : 'NONE',
    pixels
  };
}

export function getWireNodeMeta(info) {
  if (!info) return null;
  const canOut = isWireSourceInfo(info);
  const canIn = isWireTargetInfo(info);
  if (!canOut && !canIn) return null;
  let tag = info.type.slice(0, 3);
  if (info.type === 'ACTIVATOR') {
    const map = {
      SWITCH: 'SW',
      'PRESSURE PLATE': 'PLT',
      TIMER: 'TMR',
      PROXIMITY: 'PRX',
      'NOT GATE': 'NOT',
      'AND GATE': 'AND',
      'OR / RELAY': 'OR',
      DOOR: 'DR',
      PISTON: 'PST',
      CHANGE: 'CHG'
    };
    tag = map[info.subType] || 'ACT';
  } else if (info.type === 'PHYSICS') {
    const map = { THRUSTER: 'THR', WHEEL: 'WHL', EXPLOSIVE: 'TNT' };
    tag = map[info.subType] || 'PHY';
  } else if (info.type === 'DYNAMIC') {
    tag = 'DYN';
  } else if (info.type === 'MOVING') {
    tag = 'MOV';
  } else if (info.type === 'PUSHING') {
    tag = info.subType === 'CONVEYOR' ? 'BLT' : 'FAN';
  } else if (info.type === 'CHANGING' && info.subType === 'ITEM THROWER') {
    tag = 'THW';
  } else if (info.type === 'INTERACTING') {
    tag = 'INT';
  }
  const role = (canIn && canOut) ? 'GATE' : (canOut ? 'SRC' : 'DST');
  return { tag, role, canOut, canIn };
}
