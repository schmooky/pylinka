import type { PylinkaProject } from '@pylinka/graph';

/** A sprite-sequence atlas the editor can render (uniform grid: rows = sequences). */
export interface EditorTexture {
  id: string;
  name: string;
  src: string; // data URL or served path
  width: number;
  height: number;
  cols: number;
  rows: number;
  pad: number;
  fps: number;
  play: 'loop' | 'once';
  pick: 'per-particle' | 'per-spawn';
}

/** A painted/image emission area: opaque pixels of `src` mark where particles spawn. */
export interface EmissionMaskData {
  /** png data URL; the alpha channel is the mask */
  src: string;
  /** world width the mask maps to (px, emitter-centred; height follows aspect) */
  width: number;
  /** offset of the mask centre from the emitter */
  offset: [number, number];
}

/** An emitter trajectory: Catmull-Rom through `points` (normalized 0..1 canvas coords). */
export interface EmitterPathData {
  points: [number, number][];
  /** seconds per full traversal */
  duration: number;
  mode: 'loop' | 'pingpong' | 'once';
  closed: boolean;
}

/**
 * The editor's project shape: a standard pylinka/v1 project plus editor-only
 * texture bindings. The core fields round-trip through any pylinka consumer;
 * `textures`/`activeTextureId` are extra JSON a pure consumer ignores.
 */
export interface EditorProject extends PylinkaProject {
  /** shared texture library available to any system */
  textures?: EditorTexture[];
  /** which texture each system renders as (systemId → textureId | null) */
  systemTextures?: Record<string, string | null>;
  /** sub-emitters: childSystemId → parentSystemId (child spawns on parent deaths) */
  subEmitters?: Record<string, string>;
  /** painted emission areas per system (systemId → mask | null) */
  systemMasks?: Record<string, EmissionMaskData | null>;
  /** emitter trajectory splines per system (systemId → path | null) */
  systemPaths?: Record<string, EmitterPathData | null>;
}

/** Per-frame atlas dims from a uniform grid (matches the runtime's tools). */
export function frameSize(t: EditorTexture): { frameW: number; frameH: number } {
  return {
    frameW: Math.max(1, Math.round(t.width / t.cols) - t.pad),
    frameH: Math.max(1, Math.round(t.height / t.rows) - t.pad),
  };
}
