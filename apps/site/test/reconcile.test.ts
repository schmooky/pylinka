/**
 * The canvas draws from React Flow's copy of each node's position, the editor
 * edits its own. These cover the reconciliation between them — the thing that
 * decides whether an undo (or an import, or a re-layout) actually moves a node
 * on screen, or only in the data behind it.
 */
import { describe, expect, it } from 'vitest';
import type { Node as RFNode } from '@xyflow/react';
import { geometryOf, geometrySignature, reconcilePositions } from '../src/editor/reconcile';
import type { Annotations } from '../src/editor/types';

const node = (id: string, x: number, y: number): RFNode =>
  ({ id, position: { x, y }, data: {} }) as RFNode;

const annotations = (): Annotations => ({
  frames: [{ id: 'f1', systemId: 's1', x: 10, y: 20, w: 100, h: 80, title: 'T', color: '#fff' }],
  notes: [{ id: 'k1', systemId: 's1', x: 30, y: 40, w: 100, h: 80, text: 'n', color: '#fff' }],
});

describe('geometryOf — where the store says each node belongs', () => {
  it('covers graph nodes and both kinds of annotation', () => {
    const want = geometryOf({ n1: { x: 1, y: 2 } }, annotations());
    expect(want.get('n1')).toEqual({ x: 1, y: 2 });
    expect(want.get('frame:f1')).toEqual({ x: 10, y: 20 });
    expect(want.get('note:k1')).toEqual({ x: 30, y: 40 });
  });
});

describe('geometrySignature — the effect key', () => {
  it('is stable when nothing moved, whatever order the keys come in', () => {
    const a = geometrySignature({ n1: { x: 1, y: 2 }, n2: { x: 3, y: 4 } }, undefined);
    const b = geometrySignature({ n2: { x: 3, y: 4 }, n1: { x: 1, y: 2 } }, undefined);
    expect(a).toBe(b);
  });

  it('changes when a node moves — including by one pixel', () => {
    const before = geometrySignature({ n1: { x: 1, y: 2 } }, undefined);
    expect(geometrySignature({ n1: { x: 1, y: 3 } }, undefined)).not.toBe(before);
  });

  it('changes when an annotation moves', () => {
    const before = geometrySignature({}, annotations());
    const moved = annotations();
    moved.frames[0]!.x = 999;
    expect(geometrySignature({}, moved)).not.toBe(before);
  });

  it('does NOT change when an annotation is only resized or renamed', () => {
    // resize and rename are rendered straight from the store by the annotation
    // components, so they must not churn the canvas
    const before = geometrySignature({}, annotations());
    const edited = annotations();
    edited.frames[0]!.w = 400;
    edited.frames[0]!.title = 'renamed';
    expect(geometrySignature({}, edited)).toBe(before);
  });
});

describe('reconcilePositions — what the canvas ends up drawing', () => {
  it('pulls a stale node back to where the store says it is', () => {
    const nodes = [node('n1', 500, 500)];
    const out = reconcilePositions(nodes, geometryOf({ n1: { x: 0, y: 0 } }, undefined));
    expect(out[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('corrects annotations the same way', () => {
    const nodes = [node('frame:f1', 0, 0), node('note:k1', 0, 0)];
    const out = reconcilePositions(nodes, geometryOf({}, annotations()));
    expect(out[0]!.position).toEqual({ x: 10, y: 20 });
    expect(out[1]!.position).toEqual({ x: 30, y: 40 });
  });

  it('returns the SAME array when everything already agrees', () => {
    // identity matters: the effect feeds this to setNodes, and a fresh array on
    // every unrelated store change would re-render the whole canvas
    const nodes = [node('n1', 7, 8)];
    expect(reconcilePositions(nodes, geometryOf({ n1: { x: 7, y: 8 } }, undefined))).toBe(nodes);
  });

  it('leaves a node the store has no position for alone', () => {
    // a just-added node gets its position written after the graph commit;
    // snapping it to the origin in that window would make it jump
    const nodes = [node('n9', 120, 60)];
    const out = reconcilePositions(nodes, geometryOf({ n1: { x: 0, y: 0 } }, undefined));
    expect(out[0]!.position).toEqual({ x: 120, y: 60 });
    expect(out).toBe(nodes);
  });

  it('touches only the nodes that actually drifted', () => {
    const stay = node('n1', 1, 1);
    const drift = node('n2', 500, 500);
    const out = reconcilePositions([stay, drift], geometryOf({ n1: { x: 1, y: 1 }, n2: { x: 2, y: 2 } }, undefined));
    expect(out[0]).toBe(stay);
    expect(out[1]).not.toBe(drift);
    expect(out[1]!.position).toEqual({ x: 2, y: 2 });
  });
});
