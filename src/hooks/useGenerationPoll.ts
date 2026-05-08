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

export interface UseGenerationPollResult {
  status: GenStatus;
  result?: { resultBase64: string; completedAt: number };
  error?: { message: string; errorCode?: string; refunded: boolean };
  jobId?: string;
  /** True when the active poll was resumed from localStorage on mount,
   *  rather than freshly initiated this session. Lets callers skip
   *  history-write side effects that need click-time context (prompt/style). */
  isResume: boolean;
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
  const [result, setResult] = useState<{ resultBase64: string; completedAt: number } | undefined>();
  const [error, setError] = useState<{ message: string; errorCode?: string; refunded: boolean } | undefined>();
  const [jobId, setJobId] = useState<string | undefined>();
  const [isResume, setIsResume] = useState<boolean>(false);

  const abortRef = useRef<AbortController | null>(null);

  // Stable callback so effect deps don't churn.
  const getTokenStable = useCallback(() => getToken(), [getToken]);

  const runPoll = useCallback(
    (
      jid: string,
      _idempotencyKey: string,
      _mode: GenMode,
      resumed: boolean
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

      void (async () => {
        try {
          const terminal: PollTerminalState = await pollJobStatus(jid, getTokenStable, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;

          if (terminal.status === 'success') {
            setResult({
              resultBase64: terminal.resultBase64,
              completedAt: terminal.completedAt,
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

          if (err instanceof PollAbandonedError) {
            setError({
              message:
                'Generation took too long. If your tokens were debited, they will be refunded automatically.',
              refunded: false,
            });
            setStatus('abandoned');
            clearActiveJob();
            return;
          }
          if (err instanceof PollNotFoundError) {
            setError({
              message:
                'Job not found — it may have expired. Try generating again; tokens are refunded automatically on consumer failures.',
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
              message: 'Server is having trouble — please try again in a moment.',
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
      writeActiveJob({
        jobId: jid,
        idempotencyKey,
        mode,
        startedAt: Date.now(),
      });
      runPoll(jid, idempotencyKey, mode, false);
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
  }, []);

  // Resume from localStorage on mount.
  useEffect(() => {
    const persisted = readActiveJob();
    if (!persisted) return;
    if (Date.now() - persisted.startedAt > STALE_THRESHOLD_MS) {
      clearActiveJob();
      return;
    }
    runPoll(persisted.jobId, persisted.idempotencyKey, persisted.mode, true);
    // runPoll captures getTokenStable; if Clerk hasn't hydrated yet, the
    // first getToken() call inside pollJobStatus may return null and throw
    // PollAuthError → status 'error' → user sees an actionable message.

    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, result, error, jobId, isResume, startPolling, reset };
}
