/**
 * The latest browser frame of each test that is running with "Watch live".
 *
 * Kept in this process's memory, not the database: only the newest picture
 * matters, it changes several times a second, and nothing needs it once the
 * run is over. A frame nobody has replaced for a while is dropped.
 */

type Frame = { bytes: Buffer; at: number; runId: string };

const MAX_AGE_MS = 2 * 60_000;

const store: Map<string, Frame> = ((globalThis as { __liveFrames?: Map<string, Frame> })
  .__liveFrames ??= new Map());

function prune(now = Date.now()) {
  for (const [itemId, frame] of store) {
    if (now - frame.at > MAX_AGE_MS) store.delete(itemId);
  }
}

export function putFrame(itemId: string, runId: string, bytes: Buffer) {
  prune();
  store.set(itemId, { bytes, at: Date.now(), runId });
}

export function getFrame(itemId: string): Frame | undefined {
  return store.get(itemId);
}

/** Items of a run with a frame newer than `withinMs` — the ones on screen now. */
export function liveItemsOf(runId: string, withinMs = 15_000) {
  const now = Date.now();
  prune(now);
  return [...store.entries()]
    .filter(([, frame]) => frame.runId === runId && now - frame.at <= withinMs)
    .map(([itemId, frame]) => ({ itemId, at: frame.at }));
}

/** A finished item's last frame is no longer live. */
export function dropFrame(itemId: string) {
  store.delete(itemId);
}
