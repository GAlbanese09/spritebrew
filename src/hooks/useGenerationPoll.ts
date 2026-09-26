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

export type GenStatus = 'idle' | 'polling' | 'success' | 'error' | 'abandoned';
export type GenMode = 'create' | 'animate';

export interface ActiveJobLocalStorage {
  jobId: string;
  idempotencyKey: string;
  mode: GenMode;
  startedAt: number;
}

const ACTIVE_JOB_KEY = 'spritebrew:activeJob';
const STALE_THRESHOLD_MS = 10 * 60 * 1_000;

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
  /** True when the active poll was resumed from localStorage on mount,
   *  rather than freshly initiated this session. Lets callers skip
   *  history-write side effects that need click-time context (prompt/style). */
  isResume: boolean;
  /** Latest in-flight stage from the status poll; null before the first
   *  intermediate response and once a terminal state lands. */
  serverStatus: 'pending' | 'running' | null;
  /** Consumer's startedAt for the current attempt (server clock). Present
   *  only while running; null otherwise. */
  serverStartedAt: number | null;
  /** Client start time persisted with the active job, so a resumed poll
   *  keeps the original start. Null when idle. */
  startedAt: number | null;
  /** Mode of the active job, fresh or resumed. Null when idle. */
  mode: GenMode | null;
  startPolling: (jobId: string, idempotencyKey: string, mode: GenMode) => void;
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
    return parsed;
  } catch {
    return null;
  }
}

function writeActiveJob(entry: ActiveJobLocalStorage): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(entry));
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
 * - `startPolling` writes localStorage + kicks off the poll loop.
 * - On mount, if a fresh-enough localStorage entry exists, resumes polling
 *   automatically (handy if the user reloaded mid-generation).
 * - On unmount, aborts the in-flight poll loop.
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<GenMode | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Stable callback so effect deps don't churn.
  const getTokenStable = useCallback(() => getToken(), [getToken]);

  const runPoll = useCallback(
    (
      jid: string,
      _idempotencyKey: string,
      jobMode: GenMode,
      resumed: boolean,
      jobStartedAt: number
    ): void => {
      // Cancel any prior loop before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus('polling');
      setResult(undefined);
      setError(undefined);
      setJobId(jid);
      setIsResume(resumed);
      setServerStatus(null);
      setServerStartedAt(null);
      setStartedAt(jobStartedAt);
      setMode(jobMode);

      void (async () => {
        try {
          const terminal: PollTerminalState = await pollJobStatus(jid, getTokenStable, {
            signal: controller.signal,
            onUpdate: (state) => {
              if (controller.signal.aborted) return;
              setServerStatus(state.status);
              setServerStartedAt(typeof state.startedAt === 'number' ? state.startedAt : null);
            },
          });
          if (controller.signal.aborted) return;
          setServerStatus(null);
          setServerStartedAt(null);

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
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setServerStatus(null);
          setServerStartedAt(null);

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
      })();
    },
    [getTokenStable]
  );

  const startPolling = useCallback(
    (jid: string, idempotencyKey: string, mode: GenMode): void => {
      const now = Date.now();
      writeActiveJob({
        jobId: jid,
        idempotencyKey,
        mode,
        startedAt: now,
      });
      runPoll(jid, idempotencyKey, mode, false, now);
    },
    [runPoll]
  );

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearActiveJob();
    setStatus('idle');
    setResult(undefined);
    setError(undefined);
    setJobId(undefined);
    setIsResume(false);
    setServerStatus(null);
    setServerStartedAt(null);
    setStartedAt(null);
    setMode(null);
  }, []);

  // Resume from localStorage on mount.
  useEffect(() => {
    const persisted = readActiveJob();
    if (!persisted) return;
    if (Date.now() - persisted.startedAt > STALE_THRESHOLD_MS) {
      clearActiveJob();
      return;
    }
    runPoll(persisted.jobId, persisted.idempotencyKey, persisted.mode, true, persisted.startedAt);
    // runPoll captures getTokenStable; if Clerk hasn't hydrated yet, the
    // first getToken() call inside pollJobStatus may return null and throw
    // PollAuthError → status 'error' → user sees an actionable message.

    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    result,
    error,
    jobId,
    isResume,
    serverStatus,
    serverStartedAt,
    startedAt,
    mode,
    startPolling,
    reset,
  };
}
