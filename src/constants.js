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
   MANYLAND-INSPIRED CREATION OBJECT TYPES (30 TYPES, 2-COLUMN GRID)
   Excludes MIFT, AUTOMATION, INSTRUMENT, and MUSIC.
   ========================================================================= */
export const TYPE_DEFS = [
  // Left Column (15) | Right Column (15) interleaved for 2-column grid layout
  // All icons authored on a 16x16 integer pixel grid with true transparent cutouts (no hardcoded bg fills)
  {
    id: 'SOLID', label: 'SOLID', layer: 'main',
    subTypes: ['SOLID', 'ONE-WAY', 'STICKY'],
    desc: 'Impassable block, jump-through ONE-WAY platform (Down to drop), or STICKY surface (slows & traps).',
    icon: '<rect x="2" y="2" width="5" height="3"/><rect x="8" y="2" width="6" height="3"/><rect x="2" y="6" width="2" height="4"/><rect x="5" y="6" width="6" height="4"/><rect x="12" y="6" width="2" height="4"/><rect x="2" y="11" width="6" height="3"/><rect x="9" y="11" width="5" height="3"/>'
  },
  {
    id: 'BODY', label: 'BODY', layer: 'gear', gear: true,
    subTypes: ['BODY', 'MOTION'],
    desc: '29x29 character avatar (Stand, Walk/Swim, Jump, Fall, Climb, Sit, Blink overlay) or Motion.',
    icon: '<path fill-rule="evenodd" d="M5 1h6v5H5zM6 3h1v1H6zM9 3h1v1H9z"/><rect x="7" y="6" width="2" height="1"/><rect x="4" y="7" width="8" height="1"/><rect x="3" y="8" width="1" height="3"/><rect x="5" y="8" width="6" height="3"/><rect x="12" y="8" width="1" height="3"/><rect x="5" y="11" width="2" height="4"/><rect x="9" y="11" width="2" height="4"/>'
  },
  {
    id: 'BACK', label: 'BACK', layer: 'bg',
    subTypes: ['BACK', 'FAR BACK', 'WALKABLE'],
    desc: 'Background wall behind player. FAR BACK dims for depth; WALKABLE lets you climb freely over it.',
    icon: '<path fill-rule="evenodd" opacity="0.5" d="M2 2h12v12H2zM3 3h10v10H3z"/><rect x="4" y="4" width="2" height="2"/><rect x="8" y="4" width="2" height="2"/><rect x="6" y="6" width="2" height="2"/><rect x="10" y="6" width="2" height="2"/><rect x="4" y="8" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/><rect x="6" y="10" width="2" height="2"/><rect x="10" y="10" width="2" height="2"/>'
  },
  {
    id: 'WEARABLE', label: 'WEARABLE', layer: 'gear', gear: true,
    subTypes: ['HAT', 'BODY OVER', 'BACK'],
    desc: 'Equippable hat, overlay, or back accessory worn over your Wireframe or Body sprite.',
    icon: '<rect x="3" y="2" width="3" height="1"/><rect x="10" y="2" width="3" height="1"/><rect x="2" y="3" width="5" height="1"/><rect x="9" y="3" width="5" height="1"/><rect x="1" y="4" width="14" height="3"/><rect x="4" y="7" width="8" height="7"/>'
  },
  {
    id: 'THING', label: 'THING', layer: 'bg',
    subTypes: ['BEHIND', 'IN FRONT'],
    desc: 'Non-solid decorative prop placed behind the player or IN FRONT on the foreground layer.',
    icon: '<rect x="5" y="2" width="6" height="1"/><rect x="6" y="3" width="4" height="2"/><rect x="3" y="4" width="2" height="1"/><rect x="3" y="5" width="1" height="3"/><rect x="11" y="4" width="2" height="1"/><rect x="12" y="5" width="1" height="3"/><rect x="5" y="5" width="6" height="1"/><rect x="4" y="6" width="8" height="5"/><rect x="5" y="11" width="6" height="1"/><rect x="6" y="12" width="4" height="1"/><rect x="4" y="13" width="8" height="1"/>'
  },
  {
    id: 'LIGHT', label: 'LIGHT', layer: 'bg',
    subTypes: ['LIGHT', 'TOP LIGHT', 'FILL LIGHT', 'SURROUND LIGHT', 'LIGHT GLOW'],
    desc: 'Tints nearby sky with your 1st palette color (Light, Top, Fill, Surround), or 2-cell 19x19 + 38x38 Glow.',
    icon: '<path fill-rule="evenodd" d="M6 2h4v1h1v1h1v4h-1v2H5V8H4V4h1V3h1zM6 4h2v1H7v1H6z"/><rect x="6" y="11" width="4" height="1"/><rect x="6" y="13" width="4" height="1"/><rect x="7" y="14" width="2" height="1"/><rect x="1" y="5" width="2" height="1"/><rect x="13" y="5" width="2" height="1"/><rect x="2" y="2" width="1" height="1"/><rect x="13" y="2" width="1" height="1"/><rect x="2" y="9" width="1" height="1"/><rect x="13" y="9" width="1" height="1"/>'
  },
  {
    id: 'CHANGING', label: 'CHANGING THING', layer: 'main',
    subTypes: ['LOOP', 'ON TOUCH', 'PING-PONG', 'SPARKLING', 'LIVELY', 'ITEM THROWER'],
    desc: 'Animated prop: loop, on touch, ping-pong, sparkling, organic LIVELY, or ITEM THROWER.',
    icon: '<g opacity="0.5"><rect x="2" y="2" width="8" height="1"/><rect x="2" y="3" width="1" height="7"/><rect x="9" y="3" width="1" height="1"/><rect x="3" y="9" width="1" height="1"/></g><path fill-rule="evenodd" d="M5 5h9v9H5zM6 6h7v7H6z"/><rect x="9" y="7" width="1" height="5"/><rect x="7" y="9" width="5" height="1"/>'
  },
  {
    id: 'ENVIRONMENT', label: 'ENVIRONMENT', layer: 'bg',
    subTypes: ['RAIN', 'SNOW', 'VILLAGE DUST', 'RISING HEAT', 'MIST', 'STEAM', 'CLOUDS', 'STARS', 'WIND'],
    desc: 'Physics weather effect (1 per object): Rain, Snow, Dust, Heat, Mist, Steam, Clouds, Stars, or Wind.',
    icon: '<rect x="6" y="2" width="4" height="1"/><rect x="4" y="3" width="7" height="1"/><rect x="3" y="4" width="10" height="1"/><rect x="2" y="5" width="12" height="3"/><rect x="3" y="8" width="10" height="1"/><rect x="4" y="10" width="1" height="2"/><rect x="3" y="12" width="1" height="2"/><rect x="8" y="10" width="1" height="2"/><rect x="7" y="12" width="1" height="2"/><rect x="12" y="10" width="1" height="2"/><rect x="11" y="12" width="1" height="2"/>'
  },
  {
    id: 'BIG_THING', label: 'BIG THING', layer: 'bg',
    subTypes: ['BIG THING', 'BACK + FRONT', 'TRANSFORMING', 'VERY BIG THING'],
    desc: 'Non-solid 38x38 prop (flippable): BIG THING, 2-cell climbable BACK + FRONT, 4-cell timed TRANSFORMING (gives items), or 57x57 VERY BIG THING.',
    icon: '<rect x="1" y="1" width="4" height="1"/><rect x="1" y="1" width="1" height="4"/><rect x="2" y="2" width="1" height="1"/><rect x="11" y="1" width="4" height="1"/><rect x="14" y="1" width="1" height="4"/><rect x="13" y="2" width="1" height="1"/><rect x="1" y="14" width="4" height="1"/><rect x="1" y="11" width="1" height="4"/><rect x="2" y="13" width="1" height="1"/><rect x="11" y="14" width="4" height="1"/><rect x="14" y="11" width="1" height="4"/><rect x="13" y="13" width="1" height="1"/><rect x="5" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="5" y="9" width="2" height="2"/><rect x="9" y="9" width="2" height="2"/>'
  },
  {
    id: 'MOUNTABLE', label: 'MOUNTABLE', layer: 'main',
    subTypes: ['GROUND', 'FLYING'],
    desc: 'Rideable vehicle or creature! Press Space nearby to mount or dismount (Ground boost or Flying).',
    icon: '<rect x="11" y="2" width="1" height="1"/><rect x="13" y="2" width="1" height="1"/><path fill-rule="evenodd" d="M10 3h4v1h1v2h-5zM12 4h1v1h-1z"/><rect x="9" y="5" width="3" height="3"/><rect x="6" y="6" width="3" height="1"/><rect x="3" y="7" width="8" height="4"/><rect x="1" y="7" width="2" height="2"/><rect x="1" y="9" width="1" height="2"/><rect x="3" y="11" width="1" height="3"/><rect x="5" y="11" width="1" height="3"/><rect x="8" y="11" width="1" height="3"/><rect x="10" y="11" width="1" height="3"/>'
  },
  {
    id: 'LIVING', label: 'LIVING', layer: 'main',
    subTypes: ['WANDER', 'FLIPPING', 'CHANGING', 'STILL'],
    desc: 'Living NPC/critter: WANDER patrols, FLIPPING glances/faces you, CHANGING shifts organically.',
    icon: '<rect x="4" y="2" width="2" height="1"/><rect x="10" y="2" width="2" height="1"/><path fill-rule="evenodd" d="M4 3h8v1h1v7h-1v1H4v-1H3V4h1zM5 6h2v2H5zM9 6h2v2H9zM7 9h2v1H7z"/><rect x="4" y="12" width="2" height="2"/><rect x="10" y="12" width="2" height="2"/>'
  },
  {
    id: 'GATHERABLE', label: 'GATHERABLE', layer: 'main',
    subTypes: ['COLLECT'],
    desc: 'Collectible pickup! Walk into it to gather with a spark burst (resets on R respawn).',
    icon: '<path fill-rule="evenodd" d="M4 3h8v1h1v1h1v2h-1v1h-1v1h-1v1h-1v1H9v2H7v-2H6v-1H5V9H4V8H3V7H2V5h1V4h1zM5 5h2v1H6v1H5z"/><rect x="13" y="1" width="1" height="3"/><rect x="12" y="2" width="3" height="1"/>'
  },
  {
    id: 'HOLDABLE', label: 'HOLDABLE', layer: 'gear', gear: true,
    subTypes: ['ITEM', 'EMITTER', 'LIGHT', 'CONSUMABLE', 'AIMABLE', 'SWING LINE'],
    desc: 'Handheld tool: ITEM, EMITTER, LIGHT, heal CONSUMABLE, cursor AIMABLE, or grapple SWING LINE.',
    icon: '<rect x="12" y="2" width="2" height="2"/><rect x="11" y="3" width="2" height="2"/><rect x="10" y="4" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="8" y="6" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="6" y="8" width="2" height="2"/><rect x="3" y="7" width="2" height="1"/><rect x="4" y="8" width="2" height="2"/><rect x="5" y="9" width="2" height="2"/><rect x="6" y="10" width="2" height="2"/><rect x="7" y="11" width="1" height="2"/><rect x="3" y="11" width="2" height="2"/><rect x="2" y="12" width="2" height="2"/><rect x="1" y="13" width="2" height="2"/>'
  },
  {
    id: 'PLACES', label: 'PLACES', layer: 'bg', hasText: true, textLabel: 'PLACE NAME',
    subTypes: ['LABEL', 'POINTER'],
    desc: 'Floating location sign or signpost that reveals its custom name when you walk nearby.',
    icon: '<rect x="7" y="1" width="2" height="2"/><rect x="3" y="3" width="9" height="1"/><rect x="3" y="4" width="11" height="1"/><rect x="3" y="5" width="9" height="1"/><rect x="7" y="6" width="2" height="2"/><rect x="4" y="8" width="9" height="1"/><rect x="2" y="9" width="11" height="1"/><rect x="4" y="10" width="9" height="1"/><rect x="7" y="11" width="2" height="3"/><rect x="5" y="14" width="6" height="1"/>'
  },
  {
    id: 'CLIMBABLE', label: 'CLIMBABLE', layer: 'main',
    subTypes: ['LADDER'],
    desc: 'Ladder, rope, or vine that lets the player climb freely up and down with W / S.',
    icon: '<rect x="3" y="1" width="2" height="14"/><rect x="11" y="1" width="2" height="14"/><rect x="5" y="3" width="6" height="1"/><rect x="5" y="6" width="6" height="1"/><rect x="5" y="9" width="6" height="1"/><rect x="5" y="12" width="6" height="1"/>'
  },
  {
    id: 'HARMFUL', label: 'HARMFUL', layer: 'main',
    subTypes: ['HARMFUL', 'CHANGING HARMFUL', 'DEADLY', 'CHANGING DEADLY', 'DEADLY EMERGING', 'DEADLY MOVING'],
    desc: 'Hazards: HARMFUL (10-35 HP, knockback), DEADLY, EMERGING pop-out, or MOVING patrol, plus SOLID & IN FRONT.',
    icon: '<path fill-rule="evenodd" d="M4 2h8v1h1v1h1v5h-1v2H3V9H2V4h1V3h1zM4 5h3v3H4zM9 5h3v3H9zM7 8h2v2H7z"/><rect x="4" y="11" width="2" height="3"/><rect x="7" y="11" width="2" height="3"/><rect x="10" y="11" width="2" height="3"/>'
  },
  {
    id: 'CRUMBLING', label: 'CRUMBLING', layer: 'main',
    subTypes: ['CRUMBLE', 'FAST', 'INSTANT', 'FLEXIBLE'],
    desc: 'Fragile block (CRUMBLE / FAST / INSTANT) that shatters & reforms, or bendy FLEXIBLE plank.',
    icon: '<rect x="2" y="2" width="5" height="3"/><rect x="2" y="5" width="4" height="3"/><rect x="2" y="8" width="5" height="2"/><rect x="8" y="2" width="6" height="2"/><rect x="7" y="4" width="7" height="3"/><rect x="8" y="7" width="6" height="2"/><rect x="3" y="12" width="2" height="2"/><rect x="7" y="11" width="2" height="2"/><rect x="11" y="10" width="2" height="2"/><rect x="10" y="13" width="2" height="2"/>'
  },
  {
    id: 'VIEWABLE', label: 'VIEWABLE', layer: 'main', hasText: true, textLabel: 'CAPTION',
    subTypes: ['INSPECT'],
    desc: 'Artwork or painting! Press Space nearby to open a crisp zoomed-in viewer with caption.',
    icon: '<path fill-rule="evenodd" d="M1 2h14v12H1zM2 3h12v10H2z"/><rect x="4" y="4" width="2" height="2"/><rect x="5" y="8" width="2" height="1"/><rect x="4" y="9" width="4" height="1"/><rect x="3" y="10" width="6" height="2"/><rect x="10" y="6" width="2" height="1"/><rect x="9" y="7" width="3" height="1"/><rect x="8" y="8" width="5" height="1"/><rect x="7" y="9" width="6" height="3"/>'
  },
  {
    id: 'PUSHING', label: 'PUSHING', layer: 'main',
    subTypes: ['UP', 'RIGHT', 'LEFT', 'DOWN', 'CONVEYOR'],
    desc: 'Directional wind/current pushing player & physics props, or solid motorized CONVEYOR belt (rotates with RMB).',
    icon: '<rect x="7" y="2" width="2" height="2"/><rect x="5" y="3" width="2" height="2"/><rect x="9" y="3" width="2" height="2"/><rect x="3" y="5" width="2" height="2"/><rect x="11" y="5" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="5" y="8" width="2" height="2"/><rect x="9" y="8" width="2" height="2"/><rect x="3" y="10" width="2" height="2"/><rect x="11" y="10" width="2" height="2"/><rect x="4" y="13" width="1" height="2"/><rect x="7" y="12" width="2" height="2"/><rect x="11" y="13" width="1" height="2"/>'
  },
  {
    id: 'TEXTUAL', label: 'TEXTUAL', layer: 'main', hasText: true, textLabel: 'READABLE TEXT',
    subTypes: ['READABLE'],
    desc: 'Readable sign, book, or note! Press Space nearby to display custom pixel dialogue text.',
    icon: '<rect x="3" y="2" width="10" height="1"/><rect x="2" y="3" width="1" height="7"/><rect x="13" y="3" width="1" height="7"/><rect x="3" y="10" width="2" height="1"/><rect x="8" y="10" width="5" height="1"/><rect x="4" y="11" width="1" height="3"/><rect x="5" y="12" width="1" height="1"/><rect x="6" y="11" width="2" height="1"/><rect x="4" y="5" width="8" height="1"/><rect x="4" y="7" width="6" height="1"/>'
  },
  {
    id: 'BOUNCY', label: 'BOUNCY', layer: 'main',
    subTypes: ['UP', 'LEFT', 'RIGHT'],
    desc: 'Spring block that compresses on impact and launches the player upward or diagonally.',
    icon: '<rect x="2" y="2" width="12" height="2"/><rect x="5" y="4" width="2" height="1"/><rect x="7" y="5" width="2" height="1"/><rect x="9" y="6" width="2" height="1"/><rect x="7" y="7" width="2" height="1"/><rect x="5" y="8" width="2" height="1"/><rect x="7" y="9" width="2" height="1"/><rect x="9" y="10" width="2" height="1"/><rect x="7" y="11" width="2" height="1"/><rect x="3" y="12" width="10" height="2"/>'
  },
  {
    id: 'HOLDER', label: 'HOLDER', layer: 'main',
    subTypes: ['DISPLAY'],
    desc: 'Decorative display stand or container tile that gently floats and showcases its art.',
    icon: '<rect x="7" y="2" width="2" height="1"/><rect x="6" y="3" width="4" height="2"/><rect x="7" y="5" width="2" height="1"/><rect x="3" y="8" width="10" height="2"/><rect x="6" y="10" width="4" height="2"/><rect x="3" y="12" width="10" height="2"/>'
  },
  {
    id: 'MOVING', label: 'MOVING', layer: 'main',
    subTypes: ['HORIZ', 'VERT'],
    desc: 'Solid moving platform that smoothly glides horizontally or vertically and carries the player.',
    icon: '<path fill-rule="evenodd" d="M5 4h6v6H5zM6 5h4v4H6z"/><rect x="7" y="6" width="2" height="2"/><rect x="3" y="4" width="1" height="6"/><rect x="2" y="5" width="1" height="4"/><rect x="1" y="6" width="1" height="2"/><rect x="12" y="4" width="1" height="6"/><rect x="13" y="5" width="1" height="4"/><rect x="14" y="6" width="1" height="2"/><rect x="2" y="12" width="12" height="1" opacity="0.55"/>'
  },
  {
    id: 'INTERACTING', label: 'INTERACTING', layer: 'main',
    subTypes: ['TOGGLE', 'CYCLE'],
    desc: 'Interactive prop! Press Space nearby to toggle between frames or cycle through all frames.',
    icon: '<rect x="6" y="1" width="2" height="1"/><rect x="3" y="3" width="2" height="1"/><rect x="9" y="3" width="2" height="1"/><rect x="6" y="4" width="2" height="6"/><rect x="8" y="7" width="2" height="3"/><rect x="10" y="8" width="2" height="3"/><rect x="4" y="9" width="2" height="2"/><rect x="5" y="10" width="7" height="4"/>'
  },
  {
    id: 'SLIDEY', label: 'SLIDEY', layer: 'main',
    subTypes: ['ICE'],
    desc: 'Low-friction icy solid block with slick momentum and icy landing/skid dust.',
    icon: '<path fill-rule="evenodd" d="M2 2h12v12H2zM4 4h8v8H4z"/><rect x="5" y="9" width="1" height="1"/><rect x="6" y="8" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/><rect x="8" y="6" width="1" height="1"/><rect x="9" y="5" width="1" height="1"/><rect x="8" y="10" width="1" height="1"/><rect x="9" y="9" width="1" height="1"/><rect x="10" y="8" width="1" height="1"/>'
  },
  {
    id: 'DYNAMIC', label: 'DYNAMIC', layer: 'main',
    subTypes: ['CRATE', 'BOUNCY BALL', 'HEAVY METAL', 'WHEEL', 'THRUSTER', 'EXPLOSIVE'],
    desc: 'Physics rigid body: stackable CRATE, BOUNCY BALL, HEAVY METAL, motorized WHEEL, jet THRUSTER, or TNT EXPLOSIVE. Grab & fling in PLAY!',
    icon: '<path fill-rule="evenodd" d="M9 3h4v1h1v4h-1v1H9V8H8V4h1zM9 4h2v1h-1v1H9z"/><rect x="2" y="7" width="1" height="2" opacity="0.6"/><rect x="3" y="9" width="2" height="2" opacity="0.75"/><rect x="5" y="10" width="2" height="1" opacity="0.75"/><rect x="7" y="8" width="1" height="2" opacity="0.6"/><rect x="1" y="13" width="14" height="1"/>'
  },
  {
    id: 'SLOPE', label: 'SLOPE', layer: 'main',
    subTypes: ['UP-RIGHT /', 'UP-LEFT \\', 'SLIDEY /', 'SLIDEY \\'],
    desc: 'Smooth 45-degree ramp or slippery icy SLIDEY SLOPE (also rotates & flips cleanly).',
    icon: '<rect x="12" y="2" width="2" height="12"/><rect x="10" y="4" width="2" height="10"/><rect x="8" y="6" width="2" height="8"/><rect x="6" y="8" width="2" height="6"/><rect x="4" y="10" width="2" height="4"/><rect x="2" y="12" width="2" height="2"/>'
  },
  {
    id: 'TRANSPORTING', label: 'TRANSPORTING', layer: 'main',
    subTypes: ['PORTAL', 'ON TOUCH', 'DIRECTIONAL'],
    desc: 'Teleports to nearest linked portal (25-tile range); DIRECTIONAL launches along exit angle.',
    icon: '<rect x="2" y="3" width="2" height="1"/><rect x="1" y="4" width="1" height="8"/><rect x="4" y="4" width="1" height="8"/><rect x="2" y="12" width="2" height="1"/><rect x="12" y="3" width="2" height="1"/><rect x="11" y="4" width="1" height="8"/><rect x="14" y="4" width="1" height="8"/><rect x="12" y="12" width="2" height="1"/><rect x="6" y="7" width="2" height="2"/><rect x="8" y="6" width="1" height="4"/><rect x="9" y="7" width="1" height="2"/>'
  },
  {
    id: 'LIQUID', label: 'LIQUID', layer: 'main',
    subTypes: ['WATER'],
    desc: 'Swimmable fluid with buoyancy & splashes. Supports BREATHABLE, viscous THICK, and HARMFUL.',
    icon: '<path fill-rule="evenodd" d="M7 1h2v2h1v2h1v3h-1v1H6V8H5V5h1V3h1zM6 5h1v2H6z"/><rect x="1" y="11" width="3" height="1"/><rect x="4" y="10" width="3" height="1"/><rect x="7" y="11" width="3" height="1"/><rect x="10" y="10" width="3" height="1"/><rect x="13" y="11" width="2" height="1"/><rect x="2" y="13" width="4" height="1" opacity="0.55"/><rect x="9" y="13" width="5" height="1" opacity="0.55"/>'
  },
  {
    id: 'ACTIVATOR', label: 'ACTIVATOR', layer: 'main',
    subTypes: ['SWITCH', 'PRESSURE PLATE', 'TIMER', 'DOOR', 'PISTON', 'CHANGE'],
    desc: 'Machine logic: SWITCH, weight PRESSURE PLATE, or clock TIMER wired to DOOR, launching PISTON, CHANGE, THRUSTER, WHEEL, or EXPLOSIVE.',
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
  RAIN: 'PHYSICS RAIN | FALLS, SPLASHES ON SOLIDS & SLANTS IN WIND',
  SNOW: 'PHYSICS SNOW | FLUTTERS, SWIRLS IN WIND & SETTLES ON LEDGES',
  'VILLAGE DUST': 'FLOATING SUNLIT DUST MOTES | DRIFTS & SWIRLS WITH WIND',
  'RISING HEAT': 'THERMAL UPDRAFT WISPS & WARM SPARKS | BENDS WITH WIND',
  MIST: 'LOW-LYING TRANSLUCENT FOG BANKS | FLOWS WITH WIND',
  STEAM: 'BILLOWING RISING VAPOR PLUMES | CURLS & DEFLECTS ON CEILINGS',
  CLOUDS: 'MULTI-LAYER PARALLAX SKY CLOUDS | DRIFTS WITH WIND',
  STARS: 'TWINKLING PARALLAX STARFIELD & OCCASIONAL SHOOTING STARS',
  WIND: 'ATMOSPHERIC FORCE | PUSHES RAIN, SNOW, DUST, HEAT, MIST, STEAM & CLOUDS'
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
    subType === 'CHANGING DEADLY' ||
    subType === 'DEADLY MOVING'
  );
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

export function getDynamicSpec(subType) {
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

export function isWireSourceInfo(info) {
  if (!info) return false;
  if (info.type === 'ACTIVATOR') {
    return info.subType === 'SWITCH' || info.subType === 'PRESSURE PLATE' || info.subType === 'TIMER';
  }
  return info.type === 'INTERACTING';
}

export function isWireTargetInfo(info) {
  if (!info) return false;
  if (info.type === 'ACTIVATOR') {
    return info.subType === 'DOOR' || info.subType === 'PISTON' || info.subType === 'CHANGE';
  }
  if (info.type === 'DYNAMIC') {
    return info.subType === 'THRUSTER' || info.subType === 'WHEEL' || info.subType === 'EXPLOSIVE';
  }
  if (info.type === 'MOVING') return true;
  if (info.type === 'CHANGING' && info.subType === 'ITEM THROWER') return true;
  if (info.type === 'PUSHING') return true;
  return false;
}
