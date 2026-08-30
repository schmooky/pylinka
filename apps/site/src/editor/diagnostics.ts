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
