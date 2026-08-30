import type { PylinkaProject } from '@pylinka/graph';
import type { AtlasPlay } from '@pylinka/core';

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
  /** see `AtlasPlay` in @pylinka/core — only 'loop' and 'hold' use `fps` */
  play: AtlasPlay;
  pick: 'per-particle' | 'per-spawn';
  /** editor-only: source frames of a sequence built from individual files, kept
   *  so they can be reordered and re-baked. Absent for a plain sprite/sheet. The
   *  baked grid lives in `src` + cols/rows; a strict consumer ignores this. */
  frames?: string[];
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
 * A scene reference: the artwork the effect has to sit on top of. Kept in the
 * project's asset library (not bound to a system) so the same background can be
 * reused across every effect authored for that screen.
 */
export interface ReferenceImage {
  id: string;
  name: string;
  /** data URL or served path */
  src: string;
  width: number;
  height: number;
}

/** How the active reference is laid under (or over) the preview. */
export interface ReferenceSettings {
  /** which library image is shown; null = none */
  id: string | null;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  /** multiplier on the contain-fit size */
  scale: number;
  /** px offset from the preview centre, in canvas CSS space */
  offset: [number, number];
  /** draw ABOVE the particles — for checking what the effect has to read through */
  front: boolean;
}

export const DEFAULT_REFERENCE: ReferenceSettings = {
  id: null,
  visible: true,
  opacity: 0.6,
  scale: 1,
  offset: [0, 0],
  front: false,
};

/**
 * What sits behind the particles in the preview.
 *
 * A transparent canvas over solid black is the worst case for judging a light
 * blend mode: additive means "add to what is behind", and adding to black is
 * indistinguishable from covering it. A checkerboard says "this is transparent"
 * the way every other art tool does, and a solid colour lets you check the
 * effect against the tone it will actually play on.
 */
export interface PreviewBackground {
  mode: 'grid' | 'solid';
  /** the solid colour, and the darker square of the grid */
  color: string;
  /** grid square size in px */
  size: number;
}

export const DEFAULT_PREVIEW_BACKGROUND: PreviewBackground = {
  mode: 'grid',
  color: '#101010',
  size: 16,
};

/** A named, colored comment frame around an area of a system's graph (à la UE Blueprints). */
export interface CommentFrame {
  id: string;
  systemId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  color: string; // hex accent
  /** pinned: cannot be dragged or deleted from the canvas (see StickyNote.locked) */
  locked?: boolean;
}

/** A free-floating sticky note on a system's canvas (à la Miro). */
export interface StickyNote {
  id: string;
  systemId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  /**
   * Pinned. Annotations sit UNDER the graph nodes and cover a large area, so
   * they are easy to grab by accident while wiring — and a stray drag silently
   * rearranges (or, with a delete key, destroys) work that took real effort.
   * Locking leaves them visible and editable but immovable.
   */
  locked?: boolean;
}

/** Graph annotations. Exported with the project (a consumer ignores them); strippable on export. */
export interface Annotations {
  frames: CommentFrame[];
  notes: StickyNote[];
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
  /** comment frames + sticky notes on the graph canvases */
  annotations?: Annotations;
  /** muted node ids — kept in the graph but excluded from the running sim */
  disabledNodes?: string[];
  /** scene reference artwork available to any system */
  references?: ReferenceImage[];
  /** which reference is shown behind the preview, and how */
  reference?: ReferenceSettings;
  /** what the preview draws behind everything else */
  previewBackground?: PreviewBackground;
}

/** Per-frame atlas dims from a uniform grid (matches the runtime's tools). */
export function frameSize(t: EditorTexture): { frameW: number; frameH: number } {
  return {
    frameW: Math.max(1, Math.round(t.width / t.cols) - t.pad),
    frameH: Math.max(1, Math.round(t.height / t.rows) - t.pad),
  };
}
