/**
 * A dead-simple DOM preloader overlay (Fira Code). Shows a progress bar and the
 * file currently loading, then fades out. No framework — one element, inline
 * styles. Import `createPreloader()`, call `tick(url)` as each asset resolves,
 * and `done()` when the scene is on screen.
 */
export interface Preloader {
  tick(label: string, done: number, total: number): void;
  done(): void;
}

export function createPreloader(title = 'loading textures'): Preloader {
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
    background: #0b0f1a; color: #cbd5e1; transition: opacity .35s ease;
    font: 13px 'Fira Code', ui-monospace, monospace;`;
  el.innerHTML = `
    <div style="width: min(420px, 82vw)">
      <div style="display:flex; justify-content:space-between; margin-bottom:8px">
        <span style="color:#a78bfa">${title}</span><span data-pct style="color:#64748b">0%</span>
      </div>
      <div style="height:4px; border-radius:4px; background:#1e293b; overflow:hidden">
        <div data-bar style="height:100%; width:0%; background:#a78bfa; transition:width .2s ease"></div>
      </div>
      <div data-file style="margin-top:8px; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">&nbsp;</div>
    </div>`;
  document.body.appendChild(el);
  const bar = el.querySelector<HTMLElement>('[data-bar]')!;
  const pct = el.querySelector<HTMLElement>('[data-pct]')!;
  const file = el.querySelector<HTMLElement>('[data-file]')!;

  return {
    tick(label, done, total) {
      const p = total ? Math.round((done / total) * 100) : 0;
      bar.style.width = `${p}%`;
      pct.textContent = `${p}%`;
      file.textContent = label;
    },
    done() {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    },
  };
}
