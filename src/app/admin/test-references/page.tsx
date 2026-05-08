'use client';

/**
 * TEMPORARY admin-only test page for the Phase 1 reference-images cost probe.
 * Will be removed in Phase 2. Not linked from anywhere; admin-gated.
 *
 * Purpose: fire ONE real RD generation with a reference_image attached so the
 * `[REF_IMAGE_COST_PROBE]` server log captures RD's actual cost-field name and
 * value. Inspect Cloudflare → Workers & Pages → spritebrew → Logs after click.
 */

import { useState } from 'react';
import { useUser, useAuth } from '@clerk/react';
import { fetchGeneration, consumeSSEStream, type Payload } from '@/lib/sseClient';
import { pollJobStatus } from '@/lib/pollClient';

const ADMIN_USER_ID = 'user_3C34WAUmVRoHvKiyhYSNrMt4dvT';

// 64×64 valid PNG (transparent background), no `data:` prefix.
const TEST_BASE64_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJ0lEQVR42u3OAQ0AAAjDsH/Pi3ihFhiSTtGVqgIBAQEBAQEBAQHBYsHnA1Pq5caXAAAAAElFTkSuQmCC';

const TEST_REQUEST_BODY = {
  mode: 'create' as const,
  prompt: 'fantasy knight character, full body, idle pose',
  promptStyle: 'rd_pro__default',
  width: 256,
  height: 256,
  referenceImages: [TEST_BASE64_PNG],
};

interface ProbeResponse {
  status: number;
  body: unknown;
  error?: string;
}

export default function TestReferencesPage() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<ProbeResponse | null>(null);

  if (!isLoaded) {
    return null;
  }

  if (!user || user.id !== ADMIN_USER_ID) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-text-muted text-sm font-mono">Page not found.</p>
      </div>
    );
  }

  async function runProbe() {
    setIsLoading(true);
    setResponse(null);
    try {
      const token = await getToken();
      if (!token) {
        setResponse({
          status: 0,
          body: null,
          error: 'No Clerk session token available. Try refreshing the page.',
        });
        setIsLoading(false);
        return;
      }

      // Admin's userId is in the queue-kickoff allowlist, so this WILL hit
      // the 202+jobId path. Inline-poll until terminal — keeps the page
      // self-contained without dragging in useGenerationPoll's localStorage.
      const probeBody: Payload = {
        ...TEST_REQUEST_BODY,
        idempotencyKey: crypto.randomUUID(),
      };

      const result = await fetchGeneration(probeBody, token);

      if (result.mode === 'poll') {
        const terminal = await pollJobStatus(
          result.jobId,
          getToken,
          {
            // Probe deadline matches the form-side default; admin can refresh
            // if the job somehow stalls past 8 min.
            abandonAfterMs: 8 * 60 * 1_000,
          }
        );
        setResponse({
          status: 200,
          body: { jobId: result.jobId, replayed: result.replayed ?? false, terminal },
        });
        return;
      }

      // Legacy SSE path — only hits this if the flag flips OFF for admin
      // somehow (e.g., manual override). Kept for parity.
      const sseResult = await consumeSSEStream(result.response);
      setResponse({ status: 200, body: sseResult });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setResponse({ status: 0, body: null, error: msg });
    } finally {
      setIsLoading(false);
    }
  }

  // Truncated request preview — full base64 is sent in the actual request,
  // we just don't want it dominating the page.
  const requestPreview = {
    ...TEST_REQUEST_BODY,
    referenceImages: [`<base64 PNG, ${TEST_BASE64_PNG.length} chars>`],
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-lg font-display text-accent-amber">
        Reference Images Cost Probe (Admin)
      </h1>

      {/* Amber warning banner — can't-miss styling */}
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3">
        <p className="text-xs font-mono text-amber-300 leading-relaxed">
          ⚠️ This page fires REAL RD API calls. Each click costs ~$0.22 of RD
          credit and consumes 40 admin tokens. Use sparingly. This page will be
          removed in Phase 2.
        </p>
      </div>

      <p className="text-sm font-mono text-text-secondary leading-relaxed">
        Sends one <code className="text-accent-amber">rd_pro__default</code>{' '}
        generation with a single reference image attached. The server logs{' '}
        <code className="text-accent-amber">[REF_IMAGE_COST_PROBE]</code> with
        RD&apos;s actual cost field. Read it from Cloudflare logs after the
        request returns.
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={runProbe}
          disabled={isLoading}
          className="bg-amber-500 hover:bg-amber-600 disabled:bg-bg-elevated
            disabled:text-text-muted disabled:cursor-not-allowed
            text-bg-primary font-bold py-3 px-6 rounded-lg transition-colors
            text-sm font-mono cursor-pointer"
        >
          {isLoading ? 'Probing…' : 'Run Cost Probe (1 reference)'}
        </button>
        {isLoading && (
          <span className="text-xs font-mono text-text-muted">
            Calling /api/generate…
          </span>
        )}
      </div>

      {/* Request body preview */}
      <div>
        <h3 className="text-xs font-mono font-bold text-text-muted mb-2 uppercase tracking-wider">
          Request Body
        </h3>
        <pre className="bg-bg-elevated border border-border-default rounded p-4
          text-[11px] font-mono text-text-primary overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(requestPreview, null, 2)}
        </pre>
      </div>

      {/* Response display — only after first probe runs */}
      {response && (
        <div>
          <h3 className="text-xs font-mono font-bold text-text-muted mb-2 uppercase tracking-wider">
            Response — HTTP {response.status}
            {response.error && ' (network error)'}
          </h3>
          <pre className="bg-bg-elevated border border-border-default rounded p-4
            text-[11px] font-mono text-text-primary overflow-x-auto whitespace-pre-wrap break-all max-h-96">
            {response.error
              ? response.error
              : typeof response.body === 'string'
                ? response.body.slice(0, 4000) + (response.body.length > 4000 ? '\n... [truncated]' : '')
                : JSON.stringify(response.body, null, 2).slice(0, 4000)}
          </pre>
        </div>
      )}

      <div className="text-xs font-mono text-text-muted leading-relaxed border-t border-border-subtle pt-4">
        <p>
          <strong className="text-text-secondary">Next step:</strong> Open
          Cloudflare → Workers &amp; Pages → spritebrew → Logs → search for{' '}
          <code className="text-accent-amber">REF_IMAGE_COST_PROBE</code>. The
          structured JSON line shows RD&apos;s actual cost field.
        </p>
      </div>
    </div>
  );
}
