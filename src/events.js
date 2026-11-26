/* =========================================================================
   WORLD EVENT BUS
   Lightweight pub/sub decoupling Speech Chat, Body Motions, Dynamics,
   and Interactings without circular module dependencies.
   ========================================================================= */
const listeners = new Map();

export function onWorldEvent(type, handler) {
  if (!type || typeof handler !== 'function') return () => {};
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) listeners.delete(type);
  };
}

export function emitWorldEvent(type, payload = null) {
  const set = listeners.get(type);
  if (!set || set.size === 0) return;
  for (const fn of Array.from(set)) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[WorldEvent:${type}] listener failed:`, err);
    }
  }
}
