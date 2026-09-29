import { useSyncExternalStore } from 'react';

/**
 * Whether graph nodes draw their previews. On by default; a project laid out
 * before previews existed can be tight enough that they cover the node below,
 * and this is the way to get the compact graph back. Per viewer, so browser
 * storage is the right home for it.
 */
const KEY = 'pylinka.editor.nodePreviews';
const subs = new Set<() => void>();

let on = (() => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
})();

export function setNodePreviews(v: boolean): void {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* fine to forget */
  }
  for (const f of subs) f();
}

export function useNodePreviews(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => on,
    () => true,
  );
}
