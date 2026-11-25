# SPRITELAB — Agent & Workspace Context

SPRITELAB is a dark-studio, Manyland-inspired 2D pixel-art world builder, sandbox platformer, and sprite/animation editor.

## Core Constraints (Do Not Break)
- **Preserve `localStorage` keys verbatim** so existing worlds, sprites, drafts, and JSON backups stay compatible:
  - `sprite_engine_sprites_v3`
  - `sprite_engine_worlds_v3`
  - `sprite_engine_prefs_v3`
  - `sprite_engine_editor_draft_v3`
  - `sprite_engine_session_lock_v3`
  - `sprite_engine_session_handoff_v3`
- **Preserve JSON Backup Schema (`version: 3`)** in Worlds Export/Import.
- **Crisp Pixel Art Rendering:** Keep `image-rendering: pixelated` on canvases/images and `ctx.imageSmoothingEnabled = false` on all 2D contexts.
- **Simulation Pause Boundary:** `state.simTime` only advances in `PLAY` mode when no modal is open; `state.uiTime` always runs for UI, previews, and build feedback animations.
- **Single-Session Overwrite Guard:** Keep `sessionGuard` (`BroadcastChannel('spritelab_session_v3')` + heartbeat lock) active so multiple open tabs cannot overwrite saved worlds or drafts.

## Engine Architecture
- **Grid & Timestep:** Infinite sparse 2D grid (`TILE = 19` logical px per tile; `bg`, `main`, `fg` layers; built-in `STARTER_TILE_ID = '__starter__'`). Fixed 60 Hz physics loop (`FIXED_DT = 1 / 60`, `MAX_FRAME_DT = 0.05`).
- **30 Creation Object Types (`TYPE_DEFS`):**
  - **Terrain & Platforming:** `SOLID` (`SOLID`, `ONE-WAY`, `STICKY`), `SLOPE`, `SLIDEY`, `BOUNCY`, `CRUMBLING`, `MOVING`, `CLIMBABLE`, `PUSHING`, `DYNAMIC`, `ACTIVATOR` (`SWITCH` / `DOOR`), `TRANSPORTING`.
  - **Liquids (`LIQUID`):** Automatic float-to-top buoyancy, active swimming walk-cycle, exposed bobbing pixel waterline (omitted on stacked liquid tiles underneath), velocity-scaled splashes, Minecraft-style 10-bubble breath bar, and `liquidOpts.breathable` attribute.
  - **Hazards (`HARMFUL`):** Currently implements `HARMFUL` & `CHANGING HARMFUL` (`harmOpts.strength`: `LOW` 10 HP / `NORMAL` 20 HP / `HIGH` 35 HP with automatic regen after leaving) and `DEADLY` & `CHANGING DEADLY` (instant kill on contact).
  - **Health, Death & Revival:** 10-heart pixel health bar, gradual drowning damage once breath reaches 0, 3-second death animation, ragdoll fall death (falling off map or > 4s continuous fall), and revival at the safest nearby dry ledge (`findSafestRevivePos`).
  - **Character & Gear:** Bare translucent wireframe fallback (`drawDefaultWireframe`), articulated wireframe ragdoll (`drawRagdollWireframe`), 29×29 7-state `BODY` rig (`STAND`, `WALK`, `JUMP`, `FALL`, `CLIMB`, `SIT`, `BLINK` overlay), `MOTION`, `WEARABLE`, `HOLDABLE`, and `MOUNTABLE`.
  - **Atmosphere & Lighting:** 5 `LIGHT` subtypes (`LIGHT`, `TOP LIGHT`, `FILL LIGHT`, `SURROUND LIGHT` driven by the 1st palette swatch; `LIGHT GLOW` 2-cell 19×19 fixture + 38×38 translucent glow) and 9 physics `ENVIRONMENT` attributes (`RAIN`, `SNOW`, `VILLAGE DUST`, `RISING HEAT`, `MIST`, `STEAM`, `CLOUDS`, `STARS`, `WIND` with real-time wind coupling).
  - **Props & Social:** `BACK`, `THING`, `BIG_THING`, `CHANGING`, `LIVING`, `GATHERABLE`, `PLACES`, `VIEWABLE`, `TEXTUAL`, `HOLDER`, `INTERACTING`.
- **Performance Caching:** Uses O(1) `spriteByIdMap`, lazy `bgEffectCache` (zero per-frame `parseInt` over `world.layers.bg`), cached animated sidebar thumbnails (`animatedDockThumbs`), reusable `LIGHT GLOW` scratch canvas, and cached `runtime.sparkling` list.
- **Audio (`SFX`):** Web Audio API layered acoustic/foley sound engine with synthesized stereo room reverb, built-in generative ambient synth (`TOYBOX DRIFT`), and YouTube IFrame API ambient music with automatic fallback.
- **Create Editor:** 8–32px canvas (plus 38×38 for `LIGHT GLOW` Cell 2), HSV picker + palette, selection tools (Marquee, Lasso, Magic Wand), non-transparent cel-to-cel `Ctrl+C`/`Ctrl+X`/`Ctrl+V` floating paste, Aseprite PNG/strip slicer, cross-world layer migration on edit (`migrateSpritePlacementsAcrossWorlds`), and auto-saved draft recovery.

## Recommended Modular Refactor Structure
When splitting `index.html` into modules, keep clear boundaries:
- `index.html` — Minimal shell & modals
- `src/styles/` — Precision dark pixel workstation CSS tokens & layout
- `src/constants.js` — `TILE`, `PHYS`, `TYPE_DEFS`, storage keys, option sanitizers
- `src/state.js` — `state`, `player`, `camera`, `runtime`, `worldFX`, `spriteByIdMap`, `bgEffectCache`
- `src/storage.js` — RLE codec, `localStorage` persistence, `sessionGuard`, JSON export/import
- `src/audio.js` — Web Audio `SFX` foley engine, ambient synth, YouTube player
- `src/physics.js` — `stepPhysics`, death/ragdoll/safe-revival, `updateRuntimeObjects`
- `src/environment.js` — `envSys` weather/wind simulation & backdrop/mist rendering
- `src/renderer.js` — World layers, lighting, bobbing liquids, player/ragdoll, breath & heart HUD
- `src/editor/` — Sprite editor canvas, tools, selection/clipboard, palette, timeline, draft recovery
- `src/ui/` — Topbar, sidebar dock, worlds modal, type picker, tooltips, keyboard/pointer bindings

## Verification Checklist
After any refactor or feature change, run the local dev server and verify with `/browser`:
1. Zero console or runtime errors on load.
2. `PLAY` and `BUILD` mode toggle (`B`), camera zoom/pan, and `TAB` UI hide/show work smoothly.
3. Create Editor opens, draws, copies/pastes without transparent space, saves, and places tiles into the world.
4. Water buoyancy, bobbing waterline, breath bar, drowning health drain, and `HARMFUL` / `DEADLY` collisions work cleanly.