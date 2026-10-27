'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import {
  pollJobStatus,
  PollAbandonedError,
  PollAuthError,
  PollNotFoundError,
  PollTransientError,
  type PollTerminalState,
} from '@/lib/pollClient';
import { parseJobContext, resumeDecision, type JobContext } from '@/lib/pollResume';

export type GenStatus = 'idle' | 'polling' | 'success' | 'error' | 'abandoned';
export type GenMode = 'create' | 'animate';

export interface ActiveJobLocalStorage {
  jobId: string;
  idempotencyKey: string;
  mode: GenMode;
  startedAt: number;
  /** The click that sent the job (see JobContext). Absent on a job saved
   *  before contexts were. */
  context?: JobContext;
}

const ACTIVE_JOB_KEY = 'spritebrew:activeJob';
/** When this module loaded in the browser, which is no later than the first
 *  visit to /generate in this page session (see resumeDecision). */
const PAGE_LOADED_AT = Date.now();

/** The mounted hooks, told when a job is saved by a hook whose form has
 *  unmounted (the user left /generate while the request was in flight), so
 *  the form on screen picks the job up. */
const jobSavedListeners = new Set<() => void>();

/** Asked before any hook resumes a saved job, with the job's mode. One that
 *  returns true takes the job: the page opens the job's tab, whose form
 *  resumes it on mount, and the hook that asked leaves it alone, so the
 *  other tab's form never finishes it. */
const resumeChecks = new Set<(mode: GenMode) => boolean>();

/** Registers a check asked before any hook resumes a saved job; returns the
 *  unregister function. The generate page's tab (useGenerateTab) uses it. */
export function onBeforeResume(check: (mode: GenMode) => boolean): () => void {
  resumeChecks.add(check);
  return () => {
    resumeChecks.delete(check);
  };
}

export interface PollSuccessResult {
  resultBase64: string;
  completedAt: number;
  /**
   * Rescue metadata mirrored from PollTerminalSuccess. Present iff the
   * consumer's fallback path delivered this sheet; deliveredFrames may
   * still be absent when rescued=true if the consumer couldn't read the
   * PNG header.
   */
  rescued?: true;
  requestedWidth?: number;
  requestedHeight?: number;
  deliveredCellSize?: number;
  deliveredFrames?: number;
}

export interface UseGenerationPollResult {
  status: GenStatus;
  result?: PollSuccessResult;
  error?: { message: string; errorCode?: string; refunded: boolean };
  jobId?: string;
  /** True when the active poll was resumed from a saved job, rather than
   *  started by this hook's form. */
  isResume: boolean;
  /** The click-time context saved with the active job, fresh or resumed:
   *  the form that finishes the job writes its Recent entry, hints and style
   *  from it. Null when idle, and on a job saved without one. */
  context: JobContext | null;
  /** Latest in-flight stage from the status poll; null before the first
   *  intermediate response and once a terminal state lands. */
  serverStatus: 'pending' | 'running' | null;
  /** Consumer's startedAt for the current attempt (server clock). Present
   *  only while running; null otherwise. */
  serverStartedAt: number | null;
  /** The status route's paused copy (S0, n1-ledger-03 012 ruling 1): set
   *  while the last intermediate response carried paused: true, null once
   *  one does not, and null before and after polling. */
  pausedMessage: string | null;
  /** Client start time persisted with the active job, so a resumed poll
   *  keeps the original start. Null when idle. */
  startedAt: number | null;
  /** Mode of the active job, fresh or resumed. Null when idle. */
  mode: GenMode | null;
  startPolling: (jobId: string, idempotencyKey: string, mode: GenMode, context?: JobContext) => void;
  reset: () => void;
}

function readActiveJob(): ActiveJobLocalStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveJobLocalStorage;
    if (
      typeof parsed?.jobId !== 'string' ||
      typeof parsed?.idempotencyKey !== 'string' ||
      (parsed.mode !== 'create' && parsed.mode !== 'animate') ||
      typeof parsed?.startedAt !== 'number'
    ) {
      return null;
    }
    // A missing or malformed context leaves the job without one; it still resumes.
    const { context: rawContext, ...job } = parsed;
    const context = parseJobContext(job.mode, rawContext);
    return context ? { ...job, context } : job;
  } catch {
    return null;
  }
}

/** The mode of the saved job that the next mount will resume (the same rule
 *  as the mount effect), or null. GeneratePage opens on that job's tab, so
 *  the form that started a job finishes it. */
export function savedJobMode(): GenMode | null {
  const saved = readActiveJob();
  if (!saved || resumeDecision(saved, Date.now(), PAGE_LOADED_AT) !== 'resume') return null;
  return saved.mode;
}

function writeActiveJob(entry: ActiveJobLocalStorage): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(entry));
    return;
  } catch { /* the record with its context did not fit, or storage is unavailable */ }
  if (!entry.context) return;
  // Nearly full storage: save the lean record, which a later mount can still
  // resume (without a Recent entry), rather than nothing (Second 094). The
  // hook that sent the job keeps the full context for its own finish.
  const { context: _dropped, ...lean } = entry;
  void _dropped;
  try {
    window.localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(lean));
  } catch { /* localStorage unavailable; ignore */ }
}

function clearActiveJob(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch { /* ignore */ }
}

/**
 * Drives the queue-and-poll flow client-side.
 *
 * - `startPolling` saves the job, with its click-time context, to
 *   localStorage and kicks off the poll loop.
 * - On mount, resumes a saved job (see resumeDecision): after a reload, and
 *   after the user left /generate and came back while or after it ran.
 * - On unmount, aborts the poll loop and keeps the saved job, so the next
 *   mount (the other tab's form, or /generate on return) resumes it. A loop
 *   left running would finish unseen and clear the saved job, which left the
 *   page on "Brewing..." on return and polled the job twice after a tab
 *   switch (paused-message audit, Oct 25).
 * - `reset` clears state + localStorage; call it when the user starts a new generation.
 */
export function useGenerationPoll(): UseGenerationPollResult {
  const { getToken } = useAuth();

  const [status, setStatus] = useState<GenStatus>('idle');
  const [result, setResult] = useState<PollSuccessResult | undefined>();
  const [error, setError] = useState<{ message: string; errorCode?: string; refunded: boolean } | undefined>();
  const [jobId, setJobId] = useState<string | undefined>();
  const [isResume, setIsResume] = useState<boolean>(false);
  const [serverStatus, setServerStatus] = useState<'pending' | 'running' | null>(null);
  const [serverStartedAt, setServerStartedAt] = useState<number | null>(null);
  const [pausedMessage, setPausedMessage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<GenMode | null>(null);
  const [context, setContext] = useState<JobContext | null>(null);

  // The running loop: its controller and job. Null when idle.
  const activeRef = useRef<{ controller: AbortController; jobId: string } | null>(null);
  const mountedRef = useRef(false);

  // Stable callback so effect deps don't churn.
  const getTokenStable = useCallback(() => getToken(), [getToken]);

  const runPoll = useCallback(
    (
      jid: string,
      _idempotencyKey: string,
      jobMode: GenMode,
      resumed: boolean,
      jobStartedAt: number,
      jobContext: JobContext | undefined
    ): void => {
      // Cancel any prior loop before starting a new one.
      activeRef.current?.controller.abort();
      const controller = new AbortController();
      activeRef.current = { controller, jobId: jid };

      setStatus('polling');
      setResult(undefined);
      setError(undefined);
      setJobId(jid);
      setIsResume(resumed);
      setServerStatus(null);
      setServerStartedAt(null);
      setPausedMessage(null);
      setStartedAt(jobStartedAt);
      setMode(jobMode);
      setContext(jobContext ?? null);

      void (async () => {
        try {
          await pollUntilDone();
        } finally {
          if (activeRef.current?.controller === controller) activeRef.current = null;
        }
      })();

      async function pollUntilDone(): Promise<void> {
        try {
          const terminal: PollTerminalState = await pollJobStatus(jid, getTokenStable, {
            signal: controller.signal,
            onUpdate: (state) => {
              if (controller.signal.aborted) return;
              setServerStatus(state.status);
              setServerStartedAt(typeof state.startedAt === 'number' ? state.startedAt : null);
              setPausedMessage(state.paused && state.message ? state.message : null);
            },
          });
          if (controller.signal.aborted) return;
          setServerStatus(null);
          setServerStartedAt(null);
          setPausedMessage(null);

          if (terminal.status === 'success') {
            // Rescue fields (rescued / requestedWidth / requestedHeight /
            // deliveredCellSize / deliveredFrames) forwarded verbatim.
            // Consumers use them to render a rescue notice + prefer
            // delivered geometry for the preview/slicer.
            setResult({
              resultBase64: terminal.resultBase64,
              completedAt: terminal.completedAt,
              ...(terminal.rescued ? { rescued: terminal.rescued } : {}),
              ...(typeof terminal.requestedWidth === 'number' ? { requestedWidth: terminal.requestedWidth } : {}),
              ...(typeof terminal.requestedHeight === 'number' ? { requestedHeight: terminal.requestedHeight } : {}),
              ...(typeof terminal.deliveredCellSize === 'number' ? { deliveredCellSize: terminal.deliveredCellSize } : {}),
              ...(typeof terminal.deliveredFrames === 'number' ? { deliveredFrames: terminal.deliveredFrames } : {}),
            });
            setStatus('success');
          } else {
            setError({
              message: terminal.error,
              errorCode: terminal.errorCode,
              refunded: terminal.refunded,
            });
            setStatus('error');
          }
          clearActiveJob();
        } catch (err) {
          // A loop that was stopped (unmount, reset or a newer loop) must not
          // touch state or the saved job, whatever it throws: an abort while
          // the body is read surfaces as pollClient's non-JSON error, and a
          // token that resolves after the abort can surface as an auth error.
          // Clearing the saved job here would take it from the form that
          // resumed it (Second 073 P2-A). Only the live loop reports errors.
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setServerStatus(null);
          setServerStartedAt(null);
          setPausedMessage(null);

          if (err instanceof PollAbandonedError) {
            setError({
              message:
                'This is taking much longer than usual. If it finishes, it will be in your gallery. If it fails, your tokens come back automatically.',
              refunded: false,
            });
            setStatus('abandoned');
            clearActiveJob();
            return;
          }
          if (err instanceof PollNotFoundError) {
            setError({
              message:
                'We could not find this generation anymore. If it finished, it is in your gallery. If it failed, your tokens come back automatically.',
              refunded: false,
            });
            setStatus('error');
            clearActiveJob();
            return;
          }
          if (err instanceof PollAuthError) {
            setError({
              message: 'Session expired during generation. Please sign in again.',
              refunded: false,
            });
            setStatus('error');
            clearActiveJob();
            return;
          }
          if (err instanceof PollTransientError) {
            setError({
              message: 'The server is having trouble right now. Your generation may still finish, so check your gallery in a minute.',
              refunded: false,
            });
            setStatus('error');
            clearActiveJob();
            return;
          }
          const msg = err instanceof Error ? err.message : 'Unknown polling error';
          setError({ message: msg, refunded: false });
          setStatus('error');
          clearActiveJob();
        }
      }
    },
    [getTokenStable]
  );

  const startPolling = useCallback(
    (jid: string, idempotencyKey: string, mode: GenMode, jobContext?: JobContext): void => {
      const now = Date.now();
      writeActiveJob({
        jobId: jid,
        idempotencyKey,
        mode,
        startedAt: now,
        ...(jobContext ? { context: jobContext } : {}),
      });
      if (!mountedRef.current) {
        // The form that sent this job has unmounted (the user left /generate
        // while the request was in flight): keep the job saved, and tell the
        // form on screen, if any, to pick it up; a later mount resumes it.
        jobSavedListeners.forEach((pickUp) => pickUp());
        return;
      }
      runPoll(jid, idempotencyKey, mode, false, now, jobContext);
    },
    [runPoll]
  );

  const reset = useCallback((): void => {
    activeRef.current?.controller.abort();
    activeRef.current = null;
    clearActiveJob();
    setStatus('idle');
    setResult(undefined);
    setError(undefined);
    setJobId(undefined);
    setIsResume(false);
    setServerStatus(null);
    setServerStartedAt(null);
    setPausedMessage(null);
    setStartedAt(null);
    setMode(null);
    setContext(null);
  }, []);

  // Resume a saved job on mount and whenever an unmounted hook saves one
  // while this one is idle; abort the loop on unmount, keeping the saved job.
  useEffect(() => {
    mountedRef.current = true;
    const pickUp = (): void => {
      if (activeRef.current) return;
      const persisted = readActiveJob();
      const decision = resumeDecision(persisted, Date.now(), PAGE_LOADED_AT);
      if (decision === 'drop') clearActiveJob();
      if (decision !== 'resume' || !persisted) return;
      // The page decides which form finishes a job, whenever the job was
      // saved: if a check takes it, the form on the job's tab resumes it.
      for (const check of resumeChecks) {
        if (check(persisted.mode)) return;
      }
      runPoll(persisted.jobId, persisted.idempotencyKey, persisted.mode, true, persisted.startedAt, persisted.context);
      // runPoll captures getTokenStable; if Clerk hasn't hydrated yet, the
      // first getToken() call inside pollJobStatus may return null and throw
      // PollAuthError, so the status is 'error' and the user sees a message.
    };
    pickUp();
    jobSavedListeners.add(pickUp);

    return () => {
      mountedRef.current = false;
      jobSavedListeners.delete(pickUp);
      activeRef.current?.controller.abort();
      activeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    result,
    error,
    jobId,
    isResume,
    context,
    serverStatus,
    serverStartedAt,
    pausedMessage,
    startedAt,
    mode,
    startPolling,
    reset,
  };
}
