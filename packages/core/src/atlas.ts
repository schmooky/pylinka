/**
 * Sprite-sheet playback modes, shared by every backend so the three shaders
 * agree on what a mode means.
 */

/**
 * How an atlas sequence advances through its columns. Only `loop` and `hold`
 * look at `fps`:
 *
 * - `loop` — cycle the columns forever at `fps`.
 * - `once` — stretch the strip across the particle's LIFE. `fps` is ignored:
 *   the sequence always finishes exactly as the particle dies, whatever its
 *   lifetime. This is the mode that makes a changed `fps` look broken.
 * - `hold` — play once at `fps`, then stay on the last frame.
 *
 * Reach for `hold` when the frame rate is the thing you actually mean, and
 * `once` when "the animation finishes with the particle" is.
 */
export type AtlasPlay = 'loop' | 'once' | 'hold';

/** `AtlasPlay` as the shaders take it (a float in the anim uniform). */
export function playCode(play: AtlasPlay | undefined): 0 | 1 | 2 {
  return play === 'once' ? 0 : play === 'hold' ? 2 : 1;
}
