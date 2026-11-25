/**
 * The fidelity report. Every RevoltFX setting the converter cannot carry over
 * exactly lands here. Nothing is dropped silently: a setting that changes the
 * picture and is not in this list is a converter bug.
 */

export type IssueLevel =
  /** same intent, measurably different motion or timing */
  | 'approximate'
  /** Pylinka cannot express it; the setting was dropped */
  | 'unsupported'
  /** an input problem (missing texture data, bad reference, bundle hash) */
  | 'warning';

export interface FidelityIssue {
  level: IssueLevel;
  /** stable feature id, e.g. 'particle.align', 'spawn.onHalfway', 'ease' */
  feature: string;
  /** the emitter or sequence (by name) the setting belongs to */
  source: string;
  /** what happened, in a sentence */
  detail: string;
  /** measured error where there is one (ease fits: output units; drag fits: fraction of distance) */
  error?: number;
}

export class Report {
  private readonly seen = new Set<string>();
  readonly issues: FidelityIssue[] = [];

  add(level: IssueLevel, feature: string, source: string, detail: string, error?: number): void {
    const key = `${level}|${feature}|${source}|${detail}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push(error !== undefined ? { level, feature, source, detail, error } : { level, feature, source, detail });
  }
}

/** Issues grouped as `feature → count`, for a one-line summary. */
export function summarizeIssues(issues: FidelityIssue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of issues) {
    const k = `${i.level}:${i.feature}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
