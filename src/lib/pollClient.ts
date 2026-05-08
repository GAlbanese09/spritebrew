/**
 * Pure polling client for /api/generation-status/[jobId].
 *
 * Polls at `initialIntervalMs` for the first `pollsBeforeBackoff` polls,
 * then switches to `longIntervalMs`. Aborts after `abandonAfterMs`.
 * Honors AbortSignal for unmount cleanup.
 *
 * Per Confluence 87490562 §3 (status contract) + §6 (client behavior).
 */

export class PollAbandonedError extends Error {
  constructor() {
    super('Generation took too long. Polling abandoned.');
    this.name = 'PollAbandonedError';
  }
}

export class PollAuthError extends Error {
  constructor(message = 'Polling authentication failed.') {
    super(message);
    this.name = 'PollAuthError';
  }
}

export class PollNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} not found in KV (TTL expired or unknown jobId).`);
    this.name = 'PollNotFoundError';
  }
}

export class PollTransientError extends Error {
  constructor(message = 'Polling endpoint returned 5xx three times in a row.') {
    super(message);
    this.name = 'PollTransientError';
  }
}

export interface PollIntermediateState {
  status: 'pending' | 'running';
  startedAt?: number;
}

export interface PollTerminalSuccess {
  status: 'success';
  resultBase64: string;
  completedAt: number;
}

export interface PollTerminalError {
  status: 'error';
  error: string;
  errorCode?: string;
  refunded: boolean;
}

export type PollTerminalState = PollTerminalSuccess | PollTerminalError;

export interface PollOptions {
  initialIntervalMs?: number;
  longIntervalMs?: number;
  pollsBeforeBackoff?: number;
  abandonAfterMs?: number;
  onUpdate?: (state: PollIntermediateState) => void;
  signal?: AbortSignal;
}

const DEFAULTS = {
  initialIntervalMs: 3_000,
  longIntervalMs: 5_000,
  pollsBeforeBackoff: 30,
  abandonAfterMs: 8 * 60 * 1_000,
} as const;

const FIVE_XX_BACKOFF_MS = [1_000, 2_000, 4_000];
const MAX_5XX_IN_A_ROW = 3;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Polls until terminal state, abandoned, or aborted. Returns the terminal
 * state on success or error; throws PollAbandonedError, PollAuthError,
 * PollNotFoundError, PollTransientError on the named conditions.
 */
export async function pollJobStatus(
  jobId: string,
  getToken: () => Promise<string | null>,
  opts: PollOptions = {}
): Promise<PollTerminalState> {
  const initialIntervalMs = opts.initialIntervalMs ?? DEFAULTS.initialIntervalMs;
  const longIntervalMs = opts.longIntervalMs ?? DEFAULTS.longIntervalMs;
  const pollsBeforeBackoff = opts.pollsBeforeBackoff ?? DEFAULTS.pollsBeforeBackoff;
  const abandonAfterMs = opts.abandonAfterMs ?? DEFAULTS.abandonAfterMs;
  const { onUpdate, signal } = opts;

  const startedAt = Date.now();
  let pollCount = 0;
  let consecutive5xx = 0;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (Date.now() - startedAt > abandonAfterMs) {
      throw new PollAbandonedError();
    }

    const token = await getToken();
    if (!token) {
      throw new PollAuthError('No session token available for polling.');
    }

    let res: Response;
    try {
      res = await fetch(`/api/generation-status/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
    } catch (err) {
      // AbortError propagates; everything else counts as a transient blip.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      consecutive5xx++;
      if (consecutive5xx >= MAX_5XX_IN_A_ROW) throw new PollTransientError();
      const delay = FIVE_XX_BACKOFF_MS[Math.min(consecutive5xx - 1, FIVE_XX_BACKOFF_MS.length - 1)];
      await sleep(delay, signal);
      continue;
    }

    if (res.status === 401) throw new PollAuthError();
    if (res.status === 404) throw new PollNotFoundError(jobId);

    if (res.status >= 500 && res.status < 600) {
      consecutive5xx++;
      if (consecutive5xx >= MAX_5XX_IN_A_ROW) throw new PollTransientError();
      const delay = FIVE_XX_BACKOFF_MS[Math.min(consecutive5xx - 1, FIVE_XX_BACKOFF_MS.length - 1)];
      await sleep(delay, signal);
      continue;
    }

    // Any other non-2xx → fatal (we treat it like the 4xx that it is).
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Polling failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }

    consecutive5xx = 0;

    let body: {
      status: 'pending' | 'running' | 'success' | 'error';
      resultBase64?: string;
      completedAt?: number;
      startedAt?: number;
      error?: string;
      errorCode?: string;
      refunded?: boolean;
    };
    try {
      body = await res.json();
    } catch {
      throw new Error('Polling endpoint returned non-JSON body.');
    }

    if (body.status === 'success') {
      if (!body.resultBase64 || typeof body.completedAt !== 'number') {
        throw new Error('Polling success state missing resultBase64/completedAt.');
      }
      return {
        status: 'success',
        resultBase64: body.resultBase64,
        completedAt: body.completedAt,
      };
    }

    if (body.status === 'error') {
      return {
        status: 'error',
        error: body.error ?? 'Generation failed.',
        errorCode: body.errorCode,
        refunded: body.refunded ?? false,
      };
    }

    // Intermediate — pending / running.
    onUpdate?.({ status: body.status, startedAt: body.startedAt });
    pollCount++;
    const interval = pollCount < pollsBeforeBackoff ? initialIntervalMs : longIntervalMs;
    await sleep(interval, signal);
  }
}
