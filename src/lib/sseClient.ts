/**
 * Generate-endpoint client.
 *
 * Two response modes today:
 *   1. 202 + JSON `{ jobId, replayed? }`  → queue-and-poll path (Build #2A).
 *      Caller polls /api/generation-status/[jobId] (see lib/pollClient).
 *   2. 200 + text/event-stream            → legacy synchronous SSE path.
 *      Caller drives consumeSSEStream(response) to await the result.
 *
 * Errors (4xx / 5xx) come back as JSON. 402 carries balance/required (insufficient
 * tokens) or code/tier (free-tier cap reached) — surfaced via Error properties so
 * forms can render specific UX.
 *
 * SSE format (legacy path):
 *   : heartbeat                            ← comment, ignored
 *   data: {"type":"status","message":"…"}  ← informational, ignored
 *   data: {"type":"result","data":{…}}     ← success payload
 *   data: {"type":"error","message":"…"}   ← error
 *   data: [DONE]                           ← stream end
 */

export interface GenerationSSEResult {
  success: boolean;
  imageUrl?: string;
  prediction?: Record<string, unknown>;
  [key: string]: unknown;
}

export type FetchGenerationResult =
  | { mode: 'poll'; jobId: string; replayed?: boolean }
  | { mode: 'stream'; response: Response };

export type Payload = Record<string, unknown> & {
  /** Client-supplied UUID. Required by the queue-kickoff path; harmless on the
   *  legacy SSE path (the route ignores it). */
  idempotencyKey?: string;
};

/**
 * POST to /api/generate. Detects whether the producer chose the queue path
 * (returns { mode: 'poll' }) or the legacy SSE path (returns { mode: 'stream' }).
 * Throws on 4xx/5xx with JSON error bodies.
 */
export async function fetchGeneration(
  payload: Payload,
  authToken: string | null
): Promise<FetchGenerationResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const contentType = res.headers.get('Content-Type') ?? '';

  // Queue-kickoff path — 202 + JSON.
  if (res.status === 202 && contentType.includes('application/json')) {
    const json = await res.json();
    if (typeof json.jobId !== 'string') {
      throw new Error('Server returned 202 without jobId.');
    }
    return { mode: 'poll', jobId: json.jobId, replayed: !!json.replayed };
  }

  // Legacy SSE path — 200 + text/event-stream.
  if (res.ok && contentType.includes('text/event-stream') && res.body) {
    return { mode: 'stream', response: res };
  }

  // JSON error envelope (validation, auth, insufficient tokens, free-tier cap).
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!data.success) {
      // 402 — surface balance/required (insufficient_tokens) and code/tier
      // (free_tier_cap_reached) so forms can render specific UX.
      if (res.status === 402) {
        const message = data.message || data.error || `HTTP ${res.status}`;
        const err = new Error(message) as Error & {
          balance?: number;
          required?: number;
          code?: string;
          tier?: 'pro' | 'fast';
        };
        if (data.balance !== undefined) err.balance = data.balance;
        if (data.required !== undefined) err.required = data.required;
        if (data.code) err.code = data.code;
        if (data.tier) err.tier = data.tier;
        throw err;
      }
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    // 200 + JSON + success:true (rare path the legacy code allowed; preserve).
    return { mode: 'stream', response: res };
  }

  // Anything else — unexpected.
  throw new Error(
    `Unexpected response: status=${res.status} content-type=${contentType}`
  );
}

/**
 * Consume an SSE stream from /api/generate and return the terminal result.
 * Extracted from the legacy fetchGenerationSSE so callers receiving
 * { mode: 'stream' } from fetchGeneration can drive it explicitly.
 */
export async function consumeSSEStream(response: Response): Promise<GenerationSSEResult> {
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: GenerationSSEResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE events (separated by double newlines)
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const trimmed = event.trim();
      // Skip empty events and SSE comments (heartbeats)
      if (!trimmed || trimmed.startsWith(':')) continue;

      // Extract the data payload from "data: {...}" lines
      const dataMatch = trimmed.match(/^data:\s*(.+)$/m);
      if (!dataMatch) continue;

      const raw = dataMatch[1].trim();
      if (raw === '[DONE]') continue;

      try {
        const parsed = JSON.parse(raw);

        if (parsed.type === 'result' && parsed.data) {
          result = parsed.data as GenerationSSEResult;
        } else if (parsed.type === 'error') {
          throw new Error(parsed.message || 'Generation failed.');
        }
        // 'status' type is informational — ignore
      } catch (e) {
        if (e instanceof SyntaxError) continue; // malformed JSON, skip
        throw e;
      }
    }
  }

  if (!result) {
    throw new Error('Stream ended without a result.');
  }

  return result;
}

/**
 * Backwards-compat wrapper. Combines fetchGeneration + consumeSSEStream into
 * the original Promise<GenerationSSEResult> shape. Callers that haven't been
 * updated to the new branching API can keep using this — but new code paths
 * should call fetchGeneration directly so they can branch on `mode`.
 *
 * NOTE: this wrapper will throw if the producer returns the queue-path 202;
 * existing callers should be updated to the new API before they hit a user
 * with the queue flag enabled.
 */
export async function fetchGenerationSSE(
  payload: Payload,
  authToken: string | null
): Promise<GenerationSSEResult> {
  const result = await fetchGeneration(payload, authToken);
  if (result.mode === 'poll') {
    throw new Error(
      'fetchGenerationSSE: server returned queue-path 202 but caller expected SSE. ' +
        'Update caller to use fetchGeneration + consumeSSEStream/pollJobStatus.'
    );
  }
  return consumeSSEStream(result.response);
}
