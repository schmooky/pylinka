/**
 * Graph problems, shown where the problem is.
 *
 * The validator already works out exactly which node is wrong and why — a
 * missing required output, a second writer to a single-writer sink, a value
 * that cannot exist at the time it is read. The editor used to throw all of
 * that away and show whatever string the compiler happened to throw, in the
 * corner of the preview, after the fact. So you learned that something was
 * broken but not what or where.
 *
 * This runs the same validator the compiler runs, keyed by node, so a node can
 * say what is wrong with it.
 */
import { useMemo } from 'react';
import { V1_CATALOG, validateGraph, type Diagnostic, type System } from '@pylinka/graph';
import { useEditor } from './store';
import type { EditorProject } from './types';

export interface NodeDiagnostics {
  /** by node id — a node can collect more than one */
  byNode: Map<string, Diagnostic[]>;
  /** problems with no node to pin them on (a missing required output kind) */
  loose: Diagnostic[];
  errors: number;
  warnings: number;
}

const EMPTY: NodeDiagnostics = { byNode: new Map(), loose: [], errors: 0, warnings: 0 };

/** Validate one system, tolerating a graph too broken for the validator itself. */
export function diagnose(project: EditorProject, system: System): NodeDiagnostics {
  let diags: Diagnostic[];
  try {
    diags = validateGraph({ params: project.params, assets: project.assets, system }, V1_CATALOG);
  } catch {
    // the validator is not supposed to throw; if it does, an editor that goes
    // blank is worse than one that simply reports nothing
    return EMPTY;
  }
  const round = roundSpriteWarning(project, system);
  if (round) diags = [...diags, round];
  const halfLinked = subEmitterWarning(project, system);
  if (halfLinked) diags = [...diags, halfLinked];
  const byNode = new Map<string, Diagnostic[]>();
  const loose: Diagnostic[] = [];
  let errors = 0;
  let warnings = 0;
  for (const d of diags) {
    if (d.severity === 'error') errors++;
    else warnings++;
    if (d.nodeId === undefined) {
      loose.push(d);
      continue;
    }
    const list = byNode.get(d.nodeId) ?? [];
    list.push(d);
    byNode.set(d.nodeId, list);
  }
  return { byNode, loose, errors, warnings };
}

/** Node kinds that turn a particle. */
const ROTATION_KINDS = new Set([
  'output.initRotation',
  'output.writeRotation',
  'gen.spin',
  'gen.rotationOverLife',
]);

/**
 * Rotation on an untextured particle.
 *
 * The default sprite is a soft round disc — it is radially symmetric, so
 * turning it produces exactly the same pixels. Wire up a birth angle, a spin
 * and a rotation ramp on it and NOTHING happens, which reads as the feature
 * being broken rather than the sprite having no corners. It was reported as
 * "nothing affects the initial rotation angle", and the rotation was working
 * the whole time.
 */
function roundSpriteWarning(project: EditorProject, system: System): Diagnostic | undefined {
  const spins = system.graph.nodes.filter((n) => ROTATION_KINDS.has(n.kind));
  if (spins.length === 0) return undefined;
  if ((project.systemTextures ?? {})[system.id]) return undefined;
  return {
    severity: 'warning',
    code: 'W105_ROTATION_UNSEEN',
    message:
      'This emitter rotates its particles but has no texture, and the default sprite is a round dot — a circle looks identical at every angle. Give it a texture in Assets to see the rotation.',
    nodeId: spins[0]!.id,
  };
}

/**
 * A sub-emitter needs BOTH halves, and each half is silent without the other.
 *
 * The link says which emitter's particles this one is born from; the
 * `output.deathBurst` node says how many and on which event. A burst node with
 * no parent spawns nothing at all — the node is simply never reached — and a
 * parent with no burst node gets one particle per event, which on a slow
 * parent looks like nothing much. Both read as "sub-emitters do not work".
 */
function subEmitterWarning(project: EditorProject, system: System): Diagnostic | undefined {
  const burst = system.graph.nodes.find((n) => n.kind === 'output.deathBurst');
  const parentId = (project.subEmitters ?? {})[system.id];
  const parent = parentId ? project.systems.find((s) => s.id === parentId) : undefined;

  if (burst !== undefined && parent === undefined) {
    return {
      severity: 'warning',
      code: 'W106_SUB_EMITTER_HALF_LINKED',
      message:
        'This emitter has a “Burst from parent” node but is not born from anything, so the burst never fires. Right-click its tab and pick an emitter under “Born from”.',
      nodeId: burst.id,
    };
  }
  if (burst === undefined && parent !== undefined) {
    return {
      severity: 'warning',
      code: 'W106_SUB_EMITTER_HALF_LINKED',
      message: `Born from “${parent.name}”, but with no “Burst from parent” node it spawns a single particle per event. Add one to choose how many, and whether they come on birth or on death.`,
    };
  }
  return undefined;
}

/**
 * Diagnostics for the emitter on screen. Recomputed when the graph changes —
 * validation is a walk over a few dozen nodes, far cheaper than the recompile
 * it saves you from triggering.
 */
export function useDiagnostics(): NodeDiagnostics {
  const project = useEditor((s) => s.project);
  const activeSystemId = useEditor((s) => s.activeSystemId);
  return useMemo(() => {
    const sys = project.systems.find((s) => s.id === activeSystemId) ?? project.systems[0];
    return sys ? diagnose(project, sys) : EMPTY;
  }, [project, activeSystemId]);
}
