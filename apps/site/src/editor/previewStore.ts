/**
 * Live state shared between the preview and the things that drive it — knob
 * nodes on the canvas, and the trajectory editor in Settings. Kept out of the
 * project store on purpose: a knob's VALUE is what the effect is doing right
 * now, the same thing a game writes with setKnob() at runtime, so it is not
 * part of the document and does not belong in undo. The knob's definition —
 * name, range, default — does, and lives in the project.
 */
import { create } from 'zustand';

/** Which simulation backend the preview runs. Persisted per browser. */
export type BackendChoice = 'webgl' | 'webgpu' | 'webgl2';
const BACKEND_KEY = 'pylinka.editor.backend';

function initialBackend(): BackendChoice {
  try {
    const v = localStorage.getItem(BACKEND_KEY);
    if (v === 'webgl' || v === 'webgpu' || v === 'webgl2') return v;
  } catch {
    /* no storage — the default is fine */
  }
  return 'webgl';
}

interface PreviewState {
  /**
   * The running backend. It lives here rather than inside the preview because
   * the GRAPH needs it too: the interpreted backend recognises node patterns
   * instead of evaluating the graph, so which nodes are inert depends on this,
   * and a node has to be able to say so.
   */
  backend: BackendChoice;
  setBackend(b: BackendChoice): void;
  /** live knob values by NAME (falls back to each knob's default) */
  knobs: Record<string, number>;
  /** the Emitter tab's "draw trajectory" mode — the preview overlays a spline editor */
  pathEdit: boolean;
  /** forwards a knob write to the running handles; registered by Preview */
  apply: (name: string, v: number) => void;
  setKnobs(k: Record<string, number>): void;
  setKnob(name: string, v: number): void;
  setPathEdit(v: boolean): void;
  setApply(fn: (name: string, v: number) => void): void;
}

export const usePreview = create<PreviewState>((set, get) => ({
  backend: initialBackend(),
  setBackend: (backend) => {
    set({ backend });
    try {
      localStorage.setItem(BACKEND_KEY, backend);
    } catch {
      /* the choice just will not survive a reload */
    }
  },
  knobs: {},
  pathEdit: false,
  apply: () => {},
  setKnobs: (knobs) => set({ knobs }),
  setKnob: (name, v) => {
    set((s) => ({ knobs: { ...s.knobs, [name]: v } }));
    get().apply(name, v);
  },
  setPathEdit: (pathEdit) => set({ pathEdit }),
  setApply: (apply) => set({ apply }),
}));
