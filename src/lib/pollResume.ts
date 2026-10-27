/**
 * When the generation poll (src/hooks/useGenerationPoll.ts) resumes a saved
 * job, the click-time context saved with it, and what a finished job writes
 * from that context. Pure, so it is tested offline
 * (scripts/poll-resume-test.mjs).
 */

import { generatedFrameSize } from '@/lib/animationGeometry';
import type { RescueInfo } from '@/stores/spriteStore';

/** A saved job from an earlier page load, older than this, is dropped. */
export const STALE_THRESHOLD_MS = 10 * 60 * 1_000;

/**
 * Whether a mounted poll hook should resume the saved job. A job saved
 * before this page loaded is from an earlier visit and is dropped once it is
 * older than STALE_THRESHOLD_MS ('drop'). A job started since is always
 * resumed, however long the user spent on other pages: the form that
 * started it is gone, and nothing else will finish it ('resume'). With
 * nothing saved: 'none'.
 */
export function resumeDecision(
  saved: { startedAt: number } | null,
  now: number,
  pageLoadedAt: number
): 'none' | 'drop' | 'resume' {
  if (!saved) return 'none';
  if (saved.startedAt < pageLoadedAt && now - saved.startedAt > STALE_THRESHOLD_MS) return 'drop';
  return 'resume';
}

/**
 * The click that sent a job, as the form that finishes it needs it: the
 * job's Recent entry, slicer hints and style come from it. It is saved with
 * the job, so a job resumed after a reload, a return to /generate or a tab
 * switch finishes like one that stayed in its form (history gap, HQ
 * 2026-10-27-017).
 */
export interface CreateJobContext {
  prompt: string;
  styleId: string;
}

export interface AnimateJobContext {
  action: string;
  motionPrompt: string;
  /** The fill the request was flattened onto, for the despill. */
  bgColor: string;
  /** The frame count requested. */
  frameCount: number;
  /** The cell size requested, in px. */
  frameSize: number;
}

export type JobContext = CreateJobContext | AnimateJobContext;

export function isAnimateContext(ctx: JobContext | null | undefined): ctx is AnimateJobContext {
  return !!ctx && 'action' in ctx;
}

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/**
 * A saved job's context, checked against the job's mode and copied field by
 * field; undefined when it is missing or malformed, as on a job saved before
 * contexts were. Such a job still resumes, without a Recent entry.
 */
export function parseJobContext(mode: 'create' | 'animate', raw: unknown): JobContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  if (mode === 'create') {
    return typeof c.prompt === 'string' && typeof c.styleId === 'string'
      ? { prompt: c.prompt, styleId: c.styleId }
      : undefined;
  }
  return typeof c.action === 'string' &&
    typeof c.motionPrompt === 'string' &&
    typeof c.bgColor === 'string' &&
    isPositiveInt(c.frameCount) &&
    isPositiveInt(c.frameSize)
    ? { action: c.action, motionPrompt: c.motionPrompt, bgColor: c.bgColor, frameCount: c.frameCount, frameSize: c.frameSize }
    : undefined;
}

/** What a finished job hands the page (onGenerated): the Recent entry's
 *  prompt and style, and for an animation its slicer hints' inputs. */
export interface FinishedJob {
  prompt: string;
  style: string;
  animate?: { frameCount: number; frameSize: number; rescueInfo?: RescueInfo };
}

/**
 * What a finished job writes, from its own context, whichever form finishes
 * it: null without a context (a job saved before contexts were), which
 * writes no entry. An animation's cell size is the delivered one on a
 * rescue (rescueInfo, built by the finishing form from the status result).
 */
export function finishedJob(ctx: JobContext | null | undefined, rescueInfo: RescueInfo | null | undefined): FinishedJob | null {
  if (!ctx) return null;
  if (!isAnimateContext(ctx)) return { prompt: ctx.prompt, style: ctx.styleId };
  return {
    prompt: ctx.motionPrompt || ctx.action,
    style: `any_animation_${ctx.action}`,
    animate: {
      frameCount: ctx.frameCount,
      frameSize: generatedFrameSize(ctx.frameSize, rescueInfo),
      ...(rescueInfo ? { rescueInfo } : {}),
    },
  };
}
