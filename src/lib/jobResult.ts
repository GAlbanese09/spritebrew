/**
 * How a finished generation job's result is prepared for the result card, the
 * same whichever form finishes it (#26's follow-up). The Create form finishes
 * an Animate job when the user picked the Create tab mid-job, and the Animate
 * form finishes a Create job the other way round; each used to treat the
 * other mode's result as its own. Pure apart from the browser steps passed in,
 * so it is tested offline (scripts/job-result-test.mjs).
 */

import type { PollSuccessResult } from '@/hooks/useGenerationPoll';
import type { RescueInfo } from '@/stores/spriteStore';
import { finishedJob, isAnimateContext, type FinishedJob, type JobContext } from '@/lib/pollResume';

/** The fill every animate request is flattened onto (AnimateForm's
 *  DEFAULT_BG_COLOR); the despill removes its rim from the returned sheet. */
export const ANIMATE_FILL = '#ff00ff';

/** The browser steps: the cleanup (spriteUtils' despillIfTransparent, which
 *  keys the fill pockets when `key` and despills the rim, with its bright
 *  rule when `bright`) and an image's decoded size, null when it cannot be
 *  decoded. */
export interface JobResultIO {
  despill: (dataUrl: string, fill: string, opts: { key: boolean; bright: boolean }) => Promise<string>;
  decodedSize: (dataUrl: string) => Promise<{ w: number; h: number } | null>;
}

/**
 * The rescue notice's fields for a sheet the consumer's fallback delivered,
 * or null. When the consumer could not report the frame count, it is derived
 * from the decoded sheet, if the delivered cell size divides it cleanly.
 */
export async function rescueInfoFor(
  result: PollSuccessResult,
  dataUrl: string,
  decodedSize: JobResultIO['decodedSize']
): Promise<RescueInfo | null> {
  if (!result.rescued) return null;
  const cell = result.deliveredCellSize;
  let frames = result.deliveredFrames;
  if (frames === undefined && typeof cell === 'number' && cell > 0) {
    const size = await decodedSize(dataUrl);
    if (size && size.w > 0 && size.h > 0 && size.w % cell === 0 && size.h % cell === 0) {
      frames = (size.w / cell) * (size.h / cell);
    }
  }
  return {
    rescued: true,
    ...(typeof result.requestedWidth === 'number' ? { requestedWidth: result.requestedWidth } : {}),
    ...(typeof result.requestedHeight === 'number' ? { requestedHeight: result.requestedHeight } : {}),
    ...(typeof cell === 'number' ? { deliveredCellSize: cell } : {}),
    ...(typeof frames === 'number' ? { deliveredFrames: frames } : {}),
  };
}

export interface PreparedResult {
  /** The image to show and save: despilled for an animation, as delivered otherwise. */
  dataUrl: string;
  /** The rescue notice's fields: an animation's, or null. */
  rescueInfo: RescueInfo | null;
  /** What the job writes (see finishedJob); null for a job saved without its context. */
  finished: FinishedJob | null;
}

/**
 * A finished job's result, by the job's own mode. An animation is cleaned
 * with its request's fill (ANIMATE_FILL for a job saved without its context),
 * its fill pockets keyed unless the character sent had fill-coloured pixels
 * of its own, the bright rim rule on only when the character is known to
 * have had no mostly-magenta ones, and gets its rescue fields; a Create sheet
 * is used as delivered, with no rescue, whichever form finishes it.
 */
export async function prepareJobResult(
  result: PollSuccessResult,
  mode: 'create' | 'animate' | null,
  ctx: JobContext | null,
  io: JobResultIO
): Promise<PreparedResult> {
  const delivered = `data:image/png;base64,${result.resultBase64}`;
  if (mode !== 'animate') return { dataUrl: delivered, rescueInfo: null, finished: finishedJob(ctx, null) };
  const animate = isAnimateContext(ctx) ? ctx : null;
  const dataUrl = await io.despill(delivered, animate ? animate.bgColor : ANIMATE_FILL, {
    key: animate?.inputHasFill !== true,
    bright: animate?.inputHasMagenta === false,
  });
  const rescueInfo = await rescueInfoFor(result, dataUrl, io.decodedSize);
  return { dataUrl, rescueInfo, finished: finishedJob(ctx, rescueInfo) };
}

/** Where a finished job lands: the store's result-card setters and the
 *  page's onGenerated, as the finishing form passes them. */
export interface JobFinishSink {
  setRescueInfo: (info: RescueInfo | null) => void;
  setOriginalCharacter: (dataUrl: string | null) => void;
  setGeneratedImage: (url: string, dataUrl: string) => void;
  setGenerationStyle: (style: string | null) => void;
  setCurrentSheetMetadata: (metadata: null) => void;
  fetchBalance: () => void;
  onGenerated: (dataUrl: string, prompt: string, style: string, animate?: FinishedJob['animate'], jobId?: string) => void;
}

/**
 * Puts a finished job's result on the card, the same in both forms. The
 * card's per-job state follows the job: an animation shows its rescue notice
 * when it has one, and a Create sheet clears the previous animation's notice
 * and its "Original" character, which used to stay on a Create result. Then
 * the job's Recent entry, hints and style, or, for a job saved without its
 * context, no entry and no stale style or hints.
 */
export async function finishJob(
  job: { result: PollSuccessResult; mode: 'create' | 'animate' | null; context: JobContext | null; jobId: string | undefined },
  io: JobResultIO,
  sink: JobFinishSink
): Promise<void> {
  const { dataUrl, rescueInfo, finished } = await prepareJobResult(job.result, job.mode, job.context, io);
  sink.setRescueInfo(rescueInfo);
  if (job.mode !== 'animate') sink.setOriginalCharacter(null);
  sink.setGeneratedImage(dataUrl, dataUrl);
  if (finished) {
    sink.setGenerationStyle(finished.style);
    sink.fetchBalance();
    sink.onGenerated(dataUrl, finished.prompt, finished.style, finished.animate, job.jobId);
  } else {
    sink.setGenerationStyle(null);
    sink.setCurrentSheetMetadata(null);
  }
}
