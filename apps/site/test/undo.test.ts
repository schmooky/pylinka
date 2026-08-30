/**
 * Undo, over the whole action surface.
 *
 * `store-history.test.ts` proves no action can change the document without
 * recording a step. This proves the step actually restores it — every action
 * that edits the project is driven for real, and the document is compared
 * before and after. The snapshot scheme means no action carries an inverse, so
 * what is really under test is that each action routes through `commit` with
 * everything it touched, including the editor state a change implies.
 *
 * The store guards every browser global it uses (`localStorage`, `location`)
 * behind try/catch, so it runs here as-is, on the seed project.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../src/editor/store';
import { copyNodes, emitterPayload } from '../src/editor/clipboard';
import { EMITTER_TEMPLATES } from '../src/editor/templates';
import { diagnose } from '../src/editor/diagnostics';
import { autoLayout } from '../src/editor/layout';

/**
 * Everything an undo step is supposed to restore. `updatedAt` is a timestamp
 * the store stamps on every commit, and it is part of the snapshot, so it
 * round-trips like anything else — no need to exclude it.
 */
function documentOf() {
  const s = useEditor.getState();
  return structuredClone({
    project: s.project,
    positions: s.positions,
    activeSystemId: s.activeSystemId,
  });
}

const store = () => useEditor.getState();
const sys = () => {
  const s = store();
  return s.project.systems.find((x) => x.id === s.activeSystemId) ?? s.project.systems[0]!;
};

/**
 * Drive one action and assert the round trip: it changes the document, undo
 * restores it exactly, and redo puts the change back. Anything that fails one
 * of the three is a hole in undo, whatever it looked like on screen.
 */
function roundTrip(act: () => void) {
  const before = documentOf();
  act();
  const after = documentOf();
  expect(after, 'the action changed nothing — the test drove it wrong').not.toEqual(before);

  store().undo();
  expect(documentOf(), 'undo did not restore the document').toEqual(before);

  store().redo();
  expect(documentOf(), 'redo did not reapply the change').toEqual(after);

  store().undo(); // leave the store where we found it
  expect(documentOf()).toEqual(before);
}

beforeEach(() => {
  // reset() reloads the seed and clears both stacks, so each case starts clean
  store().reset();
});

describe('undo — graph editing', () => {
  it('add a node', () => roundTrip(() => store().addNode('gen.noise', 120, 80)));

  it('delete a node (and the edges that referenced it)', () =>
    roundTrip(() => store().deleteNode('n13')));

  it('move a node', () => roundTrip(() => store().moveNode('n1', 640, 480)));

  it('edit a port value', () =>
    roundTrip(() => store().setValue('n7', 'g', { t: 'vec2', v: [0, 999] })));

  it('change a structural (an ease preset)', () =>
    roundTrip(() => store().setStructural('n13', 'ease', 'sine.inOut')));

  it('connect two ports', () =>
    roundTrip(() =>
      store().connect({ nodeId: 'n3', portId: 'out' }, { nodeId: 'n15', portId: 'from' }),
    ));

  it('delete an edge', () => roundTrip(() => store().deleteEdge('e8')));

  it('mute a node', () => roundTrip(() => store().toggleNodeDisabled('n7')));

  it('rename the project', () => roundTrip(() => store().rename('Something else')));
});

describe('undo — emitters', () => {
  it('add an emitter', () => roundTrip(() => store().addSystem()));

  it('remove an emitter, with everything hanging off it', () => {
    store().addSystem();
    const added = store().activeSystemId;
    roundTrip(() => store().removeSystem(added));
  });

  it('rename an emitter', () => roundTrip(() => store().renameSystem('s1', 'renamed')));

  it('reorder emitters — the list is the draw order', () => {
    store().addSystem();
    const moved = store().activeSystemId;
    roundTrip(() => store().moveSystem(moved, -1));
  });

  it('a reorder at either end is a no-op, not a wrap-around', () => {
    const only = store().project.systems[0]!.id;
    const before = store().project.systems.map((s) => s.id);
    store().moveSystem(only, -1);
    store().moveSystem(only, 1);
    expect(store().project.systems.map((s) => s.id)).toEqual(before);
  });

  it('mute an emitter', () => roundTrip(() => store().toggleSystem('s1')));

  it('change the blend mode', () => roundTrip(() => store().setActiveBlend('screen')));

  it('emitter rate', () => roundTrip(() => store().setEmitter({ rate: 999 })));

  it('emitter mode, which grows a burst sub-object', () =>
    roundTrip(() => store().setEmitter({ mode: 'burst', burst: { count: 77, interval: 2 } })));

  it('link a sub-emitter', () => {
    store().addSystem();
    const child = store().activeSystemId;
    roundTrip(() => store().setSubParent(child, 's1'));
  });

  it('switch a sub-emitter to birth-triggered, which adds a node', () => {
    store().addSystem();
    const child = store().activeSystemId;
    store().setSubParent(child, 's1');
    roundTrip(() => store().setSubTrigger('birth'));
  });
});

describe('undo — knobs', () => {
  it('add a knob', () => roundTrip(() => store().addParam({ name: 'gust' })));

  it('edit a knob', () => roundTrip(() => store().updateParam('p1', { max: 500 })));

  it('delete a knob, and the param.ref nodes pointing at it', () =>
    roundTrip(() => store().removeParam('p1')));

  it('promote a port to a knob', () => roundTrip(() => store().promoteValue('n15', 'from')));

  it('detach a port from its knob', () => {
    store().promoteValue('n15', 'from');
    roundTrip(() => store().unbindKnob('n15', 'from'));
  });
});

describe('undo — annotations', () => {
  it('add a comment frame', () => roundTrip(() => store().addFrame({ x: 0, y: 0, w: 300, h: 200 })));

  it('move a frame', () => {
    store().addFrame({ x: 0, y: 0, w: 300, h: 200 });
    const id = store().project.annotations!.frames.at(-1)!.id;
    roundTrip(() => store().updateFrame(id, { x: 500, y: 500 }));
  });

  it('resize a frame', () => {
    store().addFrame({ x: 0, y: 0, w: 300, h: 200 });
    const id = store().project.annotations!.frames.at(-1)!.id;
    roundTrip(() => store().updateFrame(id, { w: 900, h: 700 }));
  });

  it('delete a frame', () => {
    store().addFrame({ x: 0, y: 0, w: 300, h: 200 });
    const id = store().project.annotations!.frames.at(-1)!.id;
    roundTrip(() => store().removeFrame(id));
  });

  it('add a sticky note', () => roundTrip(() => store().addNote({ x: 10, y: 10 })));

  it('retext a note', () => {
    store().addNote({ x: 10, y: 10 });
    const id = store().project.annotations!.notes.at(-1)!.id;
    roundTrip(() => store().updateNote(id, { text: 'changed' }));
  });

  it('delete a note', () => {
    store().addNote({ x: 10, y: 10 });
    const id = store().project.annotations!.notes.at(-1)!.id;
    roundTrip(() => store().removeNote(id));
  });

  it('lock every annotation on the canvas', () => roundTrip(() => store().lockAnnotations(true)));
});

describe('undo — per-system attachments', () => {
  it('paint an emission mask', () =>
    roundTrip(() => store().setMask({ src: 'data:image/png;base64,AA', width: 200, offset: [0, 0] })));

  it('draw an emitter trajectory', () =>
    roundTrip(() =>
      store().setPath({
        points: [
          [0, 0],
          [1, 1],
        ],
        duration: 2,
        mode: 'loop',
        closed: false,
      }),
    ));

  it('bind a texture to the active system', () => {
    const id = store().addTextureId({
      name: 't', src: 'data:image/png;base64,AA', width: 8, height: 8,
      cols: 1, rows: 1, pad: 0, fps: 12, play: 'loop', pick: 'per-particle',
    });
    store().setActiveTexture(null);
    roundTrip(() => store().setActiveTexture(id));
  });

  it('place the scene reference', () =>
    roundTrip(() => store().setReference({ opacity: 0.25, offset: [40, 60] })));

  it('change the preview backdrop', () =>
    roundTrip(() => store().setPreviewBackground({ a: '#334455', b: '#445566', size: 24 })));

  it('pick a texture on a tex node', () => {
    const id = store().addTextureId({
      name: 't', src: 'data:image/png;base64,AA', width: 8, height: 8,
      cols: 1, rows: 1, pad: 0, fps: 12, play: 'loop', pick: 'per-particle',
    });
    store().addNode('tex.single', 0, 0);
    const node = sys().graph.nodes.at(-1)!.id;
    roundTrip(() => store().setNodeAsset(node, id));
  });
});

describe('undo — the stack itself', () => {
  it('counts steps, and stops at the beginning', () => {
    expect(store().past).toBe(0);
    store().setEmitter({ rate: 1 });
    store().setValue('n7', 'g', { t: 'vec2', v: [0, 1] });
    expect(store().past).toBe(2);

    const atStart = (() => {
      store().undo();
      store().undo();
      return documentOf();
    })();
    expect(store().past).toBe(0);

    store().undo(); // one too many — must be a no-op, not a crash or a wipe
    expect(documentOf()).toEqual(atStart);
    expect(store().past).toBe(0);
  });

  it('a fresh edit forks the timeline, dropping the redo stack', () => {
    store().setEmitter({ rate: 111 });
    store().undo();
    expect(store().future).toBe(1);
    store().setEmitter({ rate: 222 });
    expect(store().future).toBe(0);
    store().redo(); // nothing to redo — must not resurrect the abandoned branch
    expect(sys().emitter.rate).toBe(222);
  });

  it('rapid edits to one field collapse into a single step', () => {
    for (const v of [1, 2, 3, 4, 5]) store().setEmitter({ rate: v });
    expect(store().past).toBe(1);
    store().undo();
    expect(sys().emitter.rate).toBe(420); // the seed's rate, not 4
  });

  it('edits to DIFFERENT fields stay separate steps', () => {
    store().setEmitter({ rate: 50 });
    store().setValue('n7', 'g', { t: 'vec2', v: [0, 7] });
    expect(store().past).toBe(2);
  });

  it('loading a project clears the history — a different document is a different timeline', () => {
    store().setEmitter({ rate: 123 });
    expect(store().past).toBe(1);
    store().newProject();
    expect(store().past).toBe(0);
    expect(store().future).toBe(0);
  });

  it('caps the stack instead of growing without bound', () => {
    for (let i = 0; i < 200; i++) store().setValue('n7', 'g', { t: 'vec2', v: [0, i] });
    expect(store().past).toBeLessThanOrEqual(80);
  });
});

describe('undo — the documented exclusions', () => {
  it('does NOT step on selection', () => {
    const before = store().past;
    store().select('n7');
    expect(store().past).toBe(before);
  });

  it('does NOT step on switching emitter tabs', () => {
    store().addSystem();
    const before = store().past;
    store().setActiveSystem('s1');
    expect(store().past).toBe(before);
  });

  it('renaming a library image is not undoable either — same reason', () => {
    const id = store().addReferenceId({ name: 'bg', src: 'data:image/png;base64,AA', width: 4, height: 4 });
    store().renameReference(id, 'renamed');
    store().undo();
    expect(store().project.references?.find((r) => r.id === id)?.name).toBe('renamed');
  });

  it('undoing a deleted image leaves the binding without the image, and degrades quietly', () => {
    // the library is carried forward, so the image does NOT come back while the
    // system's binding does. Nothing crashes: an unresolvable texture id falls
    // through to the untextured sprite, the same as no texture at all.
    const id = store().addTextureId({
      name: 'sheet', src: 'data:image/png;base64,AA', width: 8, height: 8,
      cols: 1, rows: 1, pad: 0, fps: 12, play: 'loop', pick: 'per-particle',
    });
    store().removeTexture(id);
    store().undo();
    expect(store().project.systemTextures?.[store().activeSystemId]).toBe(id);
    expect(store().project.textures?.some((t) => t.id === id)).toBe(false);
  });

  it('carries the asset library forward rather than snapshotting it', () => {
    // adding an image is deliberately not undoable: the library holds data URLs
    const id = store().addTextureId({
      name: 'sheet', src: 'data:image/png;base64,AA', width: 8, height: 8,
      cols: 1, rows: 1, pad: 0, fps: 12, play: 'loop', pick: 'per-particle',
    });
    store().undo();
    expect(store().project.textures?.some((t) => t.id === id)).toBe(true);
  });
});

describe('copy, paste and duplicate', () => {
  it('pasting nodes rewrites ids instead of merging into the originals', () => {
    const sys = store().project.systems[0]!;
    const payload = copyNodes(store().project, sys, store().positions, ['n1', 'n2']);
    const before = sys.graph.nodes.length;
    const fresh = store().pasteNodes(payload, { x: 500, y: 500 });
    expect(fresh).toHaveLength(2);
    expect(fresh).not.toContain('n1');
    const after = store().project.systems[0]!.graph.nodes;
    expect(after).toHaveLength(before + 2);
    // the original is untouched and the copy carries its values
    expect(after.find((n) => n.id === 'n1')).toBeDefined();
    expect(after.find((n) => n.id === fresh[0])!.kind).toBe('shape.point');
  });

  it('carries the edges BETWEEN the copied nodes, and no half-edges', () => {
    const sys = store().project.systems[0]!;
    // n1 -> n2 is an edge inside the pair; n3 -> n4 is outside it
    const payload = copyNodes(store().project, sys, store().positions, ['n1', 'n2']);
    expect(payload.edges).toHaveLength(1);
    const before = sys.graph.edges.length;
    store().pasteNodes(payload, { x: 0, y: 0 });
    expect(store().project.systems[0]!.graph.edges).toHaveLength(before + 1);
  });

  it('a copied knob node reuses a knob of the same name rather than making another', () => {
    const sys = store().project.systems[0]!;
    const payload = copyNodes(store().project, sys, store().positions, ['n9']); // param.ref -> windPower
    const before = store().project.params.length;
    const [id] = store().pasteNodes(payload, { x: 0, y: 0 });
    expect(store().project.params).toHaveLength(before); // no duplicate knob
    const pasted = store().project.systems[0]!.graph.nodes.find((n) => n.id === id)!;
    expect(pasted.structural?.param).toBe('p1');
  });

  it('paste is one undo step', () => {
    const sys = store().project.systems[0]!;
    const payload = copyNodes(store().project, sys, store().positions, ['n1', 'n2']);
    roundTrip(() => store().pasteNodes(payload, { x: 300, y: 300 }));
  });

  it('duplicating an emitter copies its graph under fresh ids and names it apart', () => {
    const before = store().project.systems.length;
    store().duplicateSystem('s1');
    const systems = store().project.systems;
    expect(systems).toHaveLength(before + 1);
    const copy = systems.at(-1)!;
    expect(copy.name).not.toBe(systems[0]!.name);
    expect(copy.graph.nodes).toHaveLength(systems[0]!.graph.nodes.length);
    // node ids are unique across the whole project — positions are keyed by them
    const all = systems.flatMap((s) => s.graph.nodes.map((n) => n.id));
    expect(new Set(all).size).toBe(all.length);
    expect(store().activeSystemId).toBe(copy.id);
  });

  it('duplicating an emitter is one undo step', () => roundTrip(() => store().duplicateSystem('s1')));
});

describe('emitter templates', () => {
  it('every template is a graph the validator accepts', () => {
    for (const t of EMITTER_TEMPLATES) {
      const system = { ...structuredClone(t.system), id: `t_${t.id}` };
      const diags = diagnose(store().project, system);
      expect(diags.errors, `${t.id}: ${[...diags.byNode.values()].flat().concat(diags.loose).map((d) => d.message).join(' | ')}`).toBe(0);
    }
  });

  it('a template lands as a real emitter, in one undo step', () => {
    const t = EMITTER_TEMPLATES[0]!;
    const system = { ...structuredClone(t.system), id: `t_${t.id}` };
    roundTrip(() => store().pasteEmitter(emitterPayload(system, autoLayout(system.graph))));
  });

  it('two of the same template do not collide on ids or names', () => {
    const t = EMITTER_TEMPLATES[0]!;
    const drop = () => {
      const system = { ...structuredClone(t.system), id: `t_${t.id}` };
      store().pasteEmitter(emitterPayload(system, autoLayout(system.graph)));
    };
    drop();
    drop();
    const systems = store().project.systems;
    const ids = systems.flatMap((s) => s.graph.nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(systems.map((s) => s.id)).size).toBe(systems.length);
    expect(new Set(systems.map((s) => s.name)).size).toBe(systems.length);
  });
});
