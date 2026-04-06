'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Check, Loader2 } from 'lucide-react';

const JOINED_KEY = 'spritebrew_waitlist_joined';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WaitlistModalProps {
  open: boolean;
  onClose: () => void;
  onJoined: () => void;
}

export default function WaitlistModal({ open, onClose, onJoined }: WaitlistModalProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus the input when the modal opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, [open]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !EMAIL_RE.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }

      setSuccess(true);
      try {
        localStorage.setItem(JOINED_KEY, 'true');
      } catch { /* ignore */ }
      onJoined();

      // Auto-close after 3 seconds
      autoCloseRef.current = setTimeout(() => {
        onClose();
      }, 3000);
    } catch {
      setError('Connection failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [email, onClose, onJoined]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !submitting) handleSubmit();
    },
    [handleSubmit, submitting]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-sm rounded-xl border p-6 space-y-4
          animate-[whatsNewSlideUp_0.3s_ease-out]"
        style={{ backgroundColor: '#1e1a16', borderColor: '#3a3430' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded text-[#5c5550]
            hover:text-[#e8e0d6] hover:bg-[#2a2725] cursor-pointer transition-colors"
        >
          <X size={16} />
        </button>

        {success ? (
          /* ── Success state ── */
          <div className="text-center py-4 space-y-3">
            <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/30
              flex items-center justify-center mx-auto">
              <Check size={24} className="text-green-400" />
            </div>
            <h3 className="text-sm font-mono font-semibold text-[#e8e0d6]">
              You&apos;re on the list!
            </h3>
            <p className="text-xs font-mono text-[#9a918a]">
              We&apos;ll be in touch when Pro launches.
            </p>
          </div>
        ) : (
          /* ── Form state ── */
          <>
            <div>
              <h3 className="text-sm font-mono font-semibold text-[#e8e0d6]">
                Get notified when Pro launches
              </h3>
              <p className="text-xs font-mono text-[#9a918a] mt-1">
                We&apos;ll email you when unlimited generations are available. No spam.
              </p>
            </div>

            <div>
              <input
                ref={inputRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="your@email.com"
                className="w-full rounded-lg border px-4 py-2.5 text-sm font-mono
                  text-[#e8e0d6] placeholder:text-[#5c5550]
                  focus:outline-none focus:border-[#d4871c] transition-colors"
                style={{
                  backgroundColor: '#2a2420',
                  borderColor: error ? '#ef4444' : '#3a3430',
                }}
              />
              {error && (
                <p className="text-[10px] font-mono text-red-400 mt-1.5">{error}</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-mono font-semibold
                bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] cursor-pointer
                transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Joining...
                </>
              ) : (
                'Notify Me'
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Check if the user has already joined the waitlist (from localStorage). */
export function hasJoinedWaitlist(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(JOINED_KEY) === 'true';
  } catch {
    return false;
  }
}
