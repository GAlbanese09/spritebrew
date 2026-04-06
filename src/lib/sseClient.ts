/**
 * SSE stream consumer for the /api/generate endpoint.
 *
 * The API returns a Server-Sent Events stream with heartbeat comments to keep
 * the Cloudflare proxy alive. This helper reads the stream, ignores comments
 * and heartbeats, and resolves with the generation result (or throws on error).
 *
 * SSE format:
 *   : heartbeat          ← comment, ignored
 *   data: {"type":"status","message":"..."}  ← informational
 *   data: {"type":"result","data":{...}}     ← success payload
 *   data: {"type":"error","message":"..."}   ← error
 *   data: [DONE]                            ← stream end
 */

export interface GenerationSSEResult {
  success: boolean;
  imageUrl?: string;
  prediction?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * POST to the generate endpoint, consume the SSE stream, and return the
 * generation result. Throws on HTTP errors, stream errors, and API errors.
 */
export async function fetchGenerationSSE(
  payload: Record<string, unknown>,
  authToken: string | null
): Promise<GenerationSSEResult> {
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

  // If the response is JSON (validation errors, auth errors), handle directly
  const contentType = res.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data as GenerationSSEResult;
  }

  // Must be an SSE stream
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
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
