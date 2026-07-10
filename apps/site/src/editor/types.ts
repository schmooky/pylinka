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
}

/** Per-frame atlas dims from a uniform grid (matches the runtime's tools). */
export function frameSize(t: EditorTexture): { frameW: number; frameH: number } {
  return {
    frameW: Math.max(1, Math.round(t.width / t.cols) - t.pad),
    frameH: Math.max(1, Math.round(t.height / t.rows) - t.pad),
  };
}
