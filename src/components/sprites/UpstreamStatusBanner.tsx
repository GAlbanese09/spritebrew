'use client';

import { useState, type JSX } from 'react';

export function UpstreamStatusBanner(): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      style={{
        padding: '12px 16px',
        marginBottom: '16px',
        backgroundColor: 'rgba(234, 179, 8, 0.1)',
        border: '1px solid rgba(234, 179, 8, 0.5)',
        borderRadius: '6px',
        color: 'rgb(252, 211, 77)',
        fontSize: '0.875rem',
        lineHeight: '1.5',
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
      }}
    >
      <span aria-hidden="true">⚠️</span>
      <div style={{ flex: 1 }}>
        <strong>Heads up:</strong> We&apos;re currently working with our AI partner to resolve intermittent generation failures. If a generation fails, your tokens are automatically refunded. For animations, try a smaller frame count (6 or 8) if 16-frame jobs keep failing. Thanks for your patience.
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss notice"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgb(252, 211, 77)',
          cursor: 'pointer',
          fontSize: '1.25rem',
          lineHeight: '1',
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
