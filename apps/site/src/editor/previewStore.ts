/**
 * Small store for state SHARED between the preview and the left-panel tabs
 * (Knobs / Emitter), kept out of the project store so it never touches undo.
 * The Preview owns the live particle handles; it registers `apply` so a knob
 * write from the left panel reaches them, and it reads `pathEdit` to toggle the
 * trajectory overlay drawn on the canvas.
 */
import { create } from 'zustand';

interface PreviewState {
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
