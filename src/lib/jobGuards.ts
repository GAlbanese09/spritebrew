/**
 * What an Animate job's character had of its own, kept on this device by job
 * id, so the Gallery can clean that job's sheet as the result card did (HQ
 * 2026-11-24-018, B): `fill`, fill-coloured pixels (then nothing is keyed),
 * and `magenta`, mostly-magenta ones (then the bright rule and the residue
 * cleanup stay off). Same-device jobs only: the server keeps no such field,
 * and a job this device did not finish is cleaned as before. Holds the
 * newest JOB_GUARDS_MAX jobs. Storage may be missing, full or blocked; then
 * nothing is kept and nothing throws.
 */

export const JOB_GUARDS_KEY = 'spritebrew_job_guards_v1';
export const JOB_GUARDS_MAX = 300;

export interface JobGuards {
  fill: boolean;
  magenta: boolean;
}

type Stored = Record<string, [boolean, boolean]>;

function readAll(): Stored {
  try {
    const raw = globalThis.localStorage?.getItem(JOB_GUARDS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Stored = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'boolean' && typeof v[1] === 'boolean') out[id] = [v[0], v[1]];
    }
    return out;
  } catch {
    return {};
  }
}

/** Keeps a finished Animate job's guards. Both must be known. */
export function rememberJobGuards(jobId: string, guards: { fill?: unknown; magenta?: unknown }): void {
  if (!jobId || typeof guards.fill !== 'boolean' || typeof guards.magenta !== 'boolean') return;
  try {
    const all = readAll();
    delete all[jobId];
    all[jobId] = [guards.fill, guards.magenta];
    const ids = Object.keys(all);
    for (const id of ids.slice(0, Math.max(0, ids.length - JOB_GUARDS_MAX))) delete all[id];
    globalThis.localStorage?.setItem(JOB_GUARDS_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the Gallery cleans this job as before.
  }
}

/** A job's guards when this device finished it, else null. */
export function jobGuards(jobId: string): JobGuards | null {
  const v = readAll()[jobId];
  return v ? { fill: v[0], magenta: v[1] } : null;
}
