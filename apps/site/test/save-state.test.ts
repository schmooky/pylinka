/**
 * What the editor claims about saving has to be true.
 *
 * Autosave used to swallow its own failures: `persist` caught the localStorage
 * write and ignored it, so a full quota — reachable, since textures and
 * reference images are base64 INSIDE the project — turned every subsequent
 * edit into a no-op while the editor carried on looking fine. The work was
 * gone at the next reload.
 *
 * These drive the store with a stubbed storage and check the three states the
 * header shows: saved, unsaved-since-a-real-save, and autosave-failed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../src/editor/store';

const store = () => useEditor.getState();

/** A localStorage that works, or one that refuses in a specific way. */
function stubStorage(fail?: () => never) {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (fail) fail();
        map.set(k, v);
      },
      removeItem: (k: string) => map.delete(k),
    },
  });
}

/** What a browser throws when the origin is out of room. */
function quotaError(): never {
  const e = new Error("Failed to execute 'setItem' on 'Storage': quota exceeded");
  e.name = 'QuotaExceededError';
  throw e;
}

beforeEach(() => {
  stubStorage();
  // start from a known point: a real save closes any gap left by another test
  store().markSaved();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('save state', () => {
  it('an edit is unsaved until it is written somewhere that outlives the browser', () => {
    expect(store().dirty).toBe(false);

    store().rename('renamed while testing');
    expect(store().dirty).toBe(true);
    expect(store().saveError).toBeNull();

    store().markSaved();
    expect(store().dirty).toBe(false);
    expect(store().savedAt).not.toBeNull();
  });

  it('undo does not count as un-editing — the library still has not seen it', () => {
    store().rename('a');
    store().markSaved();
    store().undo();
    expect(store().dirty).toBe(true);
  });

  it('reports a failed autosave instead of swallowing it', () => {
    stubStorage(quotaError);
    store().rename('renamed with storage full');

    const err = store().saveError;
    expect(err).not.toBeNull();
    // and it says what to DO about it, since "quota exceeded" alone is not
    // something a person editing an effect can act on
    expect(err).toMatch(/storage is full/i);
    expect(err).toMatch(/texture|export/i);
  });

  it('clears the failure once a write lands again', () => {
    stubStorage(quotaError);
    store().rename('while full');
    expect(store().saveError).not.toBeNull();

    stubStorage();
    store().rename('after room was freed');
    expect(store().saveError).toBeNull();
  });

  it('passes an unrecognised storage failure through as-is', () => {
    stubStorage(() => {
      throw new Error('storage disabled by policy');
    });
    store().rename('with storage off');
    expect(store().saveError).toBe('storage disabled by policy');
  });
});
