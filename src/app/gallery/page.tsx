'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Scissors, Trash2, Images, Sparkles, Play, Loader2 } from 'lucide-react';
import { useAuth } from '@clerk/react';
import JSZip from 'jszip';
import { type GalleryEntryV1, deriveSlicerHints } from '@/lib/galleryTypes';
import { loadHistory, type GenerationHistoryEntry } from '@/lib/generationHistory';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

type FilterMode = 'all' | 'create' | 'animate';

// Phase 2 (server-side gallery writes) shipped May 20, 2026 ~14:00 UTC.
// Conservative cutoff at 12:00 UTC catches all entries that definitively pre-date
// server-side persistence. A few hours of overlap means some Day-9 morning entries
// may show as both "legacy" (in the banner) and "server" (in the synced grid) —
// harmless; the customer just gets a backup copy.
const PHASE_2_SHIP_TS = new Date('2026-05-20T12:00:00Z').getTime();

// Banner self-removes after this date. Code stays for Phase 5+ cleanup commit.
const LEGACY_BANNER_SUNSET_TS = new Date('2026-06-05T00:00:00Z').getTime();

const LEGACY_BANNER_DISMISSED_KEY = 'spritebrew_legacy_banner_dismissed';

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
}

export default function GalleryPage() {
  const { userId, getToken } = useAuth();
  const router = useRouter();
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const setCurrentSheetMetadata = useSpriteStore((s) => s.setCurrentSheetMetadata);

  const [entries, setEntries] = useState<GalleryEntryV1[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [legacyEntries, setLegacyEntries] = useState<GenerationHistoryEntry[]>([]);
  const [legacyBannerDismissed, setLegacyBannerDismissed] = useState(false);
  const [legacyBackupBusy, setLegacyBackupBusy] = useState(false);

  // Ref tracks blob URLs for cleanup. We avoid revoking on unmount (Slicer handoff
  // needs them to survive); we revoke on individual delete, clear-all, and when
  // a fresh fetch supersedes an entry's previous URL.
  const urlsRef = useRef<Record<string, string>>({});

  // Initial fetch on mount.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setError('Please sign in to view your gallery.');
            setLoading(false);
          }
          return;
        }

        // 1. List entries
        const listResp = await fetch('/api/gallery?limit=50', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!listResp.ok) {
          if (!cancelled) {
            setError('Could not load your gallery. Please try again.');
            setLoading(false);
          }
          return;
        }
        const { entries: fetched } = (await listResp.json()) as { entries: GalleryEntryV1[] };

        // 2. Fetch image blobs in parallel
        const newUrls: Record<string, string> = {};
        await Promise.all(
          fetched.map(async (e) => {
            try {
              const imgResp = await fetch(`/api/gallery/image/${e.jobId}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (imgResp.ok) {
                const blob = await imgResp.blob();
                newUrls[e.jobId] = URL.createObjectURL(blob);
              }
            } catch {
              // Skip failed image silently — entry still shows in list with placeholder
            }
          })
        );

        if (cancelled) {
          // Cancelled during fetch — release any URLs we created
          Object.values(newUrls).forEach(URL.revokeObjectURL);
          return;
        }

        // Revoke obsoleted URLs (defensive — initial mount, urlsRef should be empty)
        Object.entries(urlsRef.current).forEach(([jobId, url]) => {
          if (!newUrls[jobId]) URL.revokeObjectURL(url);
        });
        urlsRef.current = newUrls;

        setEntries(fetched);
        setImageUrls(newUrls);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Could not load your gallery. Please try again.');
          setLoading(false);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
      // Intentionally NOT revoking urlsRef on unmount — Slicer handoff needs them
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Detect pre-Phase-2 localStorage entries for the backup banner.
  // Self-contained: doesn't touch the server gallery fetch or its state.
  useEffect(() => {
    // Sunset short-circuit
    if (Date.now() >= LEGACY_BANNER_SUNSET_TS) return;

    // Dismissed-state read
    if (typeof window !== 'undefined') {
      const dismissed = window.localStorage.getItem(LEGACY_BANNER_DISMISSED_KEY);
      if (dismissed === '1') {
        setLegacyBannerDismissed(true);
        return;
      }
    }

    if (!userId) return;

    // Read all localStorage entries, filter to pre-Phase-2 AND downloadable
    try {
      const all = loadHistory(userId);
      const legacy = all.filter(
        (e) => e.timestamp < PHASE_2_SHIP_TS && !!e.fullImageDataUrl
      );
      setLegacyEntries(legacy);
    } catch {
      // localStorage parse failure — silently ignore, banner won't render
    }
  }, [userId]);

  const handleLegacyBackup = useCallback(async () => {
    if (legacyEntries.length === 0 || legacyBackupBusy) return;
    setLegacyBackupBusy(true);

    try {
      const zip = new JSZip();
      legacyEntries.forEach((entry, idx) => {
        const dataUrl = entry.fullImageDataUrl;
        if (!dataUrl) return;
        // Strip the data URL prefix to get the base64 payload
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const filename = `spritebrew_${entry.mode}_${idx + 1}_${entry.id}.png`;
        zip.file(filename, base64, { base64: true });
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spritebrew_legacy_backup_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Auto-dismiss on successful download — they got what they came for
      window.localStorage.setItem(LEGACY_BANNER_DISMISSED_KEY, '1');
      setLegacyBannerDismissed(true);
    } catch (err) {
      console.error('Legacy backup failed:', err);
    } finally {
      setLegacyBackupBusy(false);
    }
  }, [legacyEntries, legacyBackupBusy]);

  const handleLegacyDismiss = useCallback(() => {
    window.localStorage.setItem(LEGACY_BANNER_DISMISSED_KEY, '1');
    setLegacyBannerDismissed(true);
  }, []);

  const showLegacyBanner =
    !legacyBannerDismissed &&
    legacyEntries.length > 0 &&
    Date.now() < LEGACY_BANNER_SUNSET_TS;

  const legacyBanner = showLegacyBanner ? (
    <div className="mb-6 p-4 bg-bg-elevated border border-accent-amber/40 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex-1 text-sm">
        <p className="text-text-primary font-medium">
          We found {legacyEntries.length} older generation{legacyEntries.length === 1 ? '' : 's'} in your browser
        </p>
        <p className="text-text-secondary mt-1">
          These were saved locally before gallery sync went live, and aren&apos;t in your synced gallery above. Download a backup zip to keep them. This banner disappears June 5.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          onClick={handleLegacyBackup}
          disabled={legacyBackupBusy}
          variant="primary"
          size="sm"
        >
          {legacyBackupBusy ? (
            <><Loader2 size={14} className="mr-2 animate-spin" /> Preparing…</>
          ) : (
            <><Download size={14} className="mr-2" /> Download backup</>
          )}
        </Button>
        <Button
          onClick={handleLegacyDismiss}
          variant="ghost"
          size="sm"
          className="text-text-secondary hover:text-text-primary"
        >
          Dismiss
        </Button>
      </div>
    </div>
  ) : null;

  const handleDownload = useCallback((entry: GalleryEntryV1) => {
    const url = imageUrls[entry.jobId];
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `spritebrew_${entry.mode}_${entry.jobId}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [imageUrls]);

  const handleSendToSlicer = useCallback((entry: GalleryEntryV1) => {
    const url = imageUrls[entry.jobId];
    if (!url) return;
    setGeneratedImage(url, url);
    setGenerationStyle(entry.style);
    setCurrentSheetMetadata(deriveSlicerHints(entry));
    router.push('/upload');
  }, [imageUrls, setGeneratedImage, setGenerationStyle, setCurrentSheetMetadata, router]);

  const handleDelete = useCallback(async (jobId: string) => {
    if (!confirm('Delete this generation? This cannot be undone.')) return;

    // Optimistic update — remove from local state immediately
    setEntries((prev) => prev.filter((e) => e.jobId !== jobId));
    const oldUrl = urlsRef.current[jobId];
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    delete urlsRef.current[jobId];
    setImageUrls((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });

    // Fire server delete (UI already updated)
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`/api/gallery/${jobId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error('Gallery delete failed:', err);
    }
  }, [getToken]);

  const handleClearAll = useCallback(async () => {
    // Determine scope from current filter
    const scopeLabel = filter === 'all' ? 'ALL generations'
      : filter === 'create' ? 'all Created generations'
      : 'all Animated generations';

    const targetEntries = filter === 'all' ? entries : entries.filter(e => e.mode === filter);
    if (targetEntries.length === 0) return; // shouldn't happen — button is disabled — but defensive

    if (!confirm(`Delete ${targetEntries.length} ${scopeLabel}? This cannot be undone.`)) return;

    // Optimistic update — revoke blob URLs for targeted entries only
    const targetIds = new Set(targetEntries.map(e => e.jobId));
    targetEntries.forEach(e => {
      const url = urlsRef.current[e.jobId];
      if (url) URL.revokeObjectURL(url);
      delete urlsRef.current[e.jobId];
    });
    setEntries(prev => prev.filter(e => !targetIds.has(e.jobId)));
    setImageUrls(prev => {
      const next = { ...prev };
      targetIds.forEach(id => delete next[id]);
      return next;
    });

    // Server delete — different route per scope
    try {
      const token = await getToken();
      if (!token) return;

      if (filter === 'all') {
        // Nuclear route — single call wipes everything for this user
        await fetch('/api/gallery', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        // Filtered scope — parallel per-entry deletes
        await Promise.all(
          targetEntries.map(e =>
            fetch(`/api/gallery/${e.jobId}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(err => {
              console.error(`Gallery delete failed for ${e.jobId}:`, err);
            })
          )
        );
      }
    } catch (err) {
      console.error('Gallery clear-all failed:', err);
    }
  }, [filter, entries, getToken]);

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter((e) => e.mode === filter);
  }, [entries, filter]);

  // Render: loading
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-text-secondary">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-sm">Loading your gallery…</p>
      </div>
    );
  }

  // Render: error
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-text-secondary">
        <p className="text-sm">{error}</p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </div>
    );
  }

  // Render: empty
  if (entries.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {legacyBanner}
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4 text-center">
          <Images size={48} className="text-text-muted" />
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-text-primary">No generations yet</h2>
            <p className="text-sm text-text-secondary max-w-md">
              Head to Generate to create your first sprite. Your gallery syncs across devices — sign in anywhere and your work is here.
            </p>
          </div>
          <Link href="/generate">
            <Button>
              <Sparkles size={16} className="mr-2" /> Go to Generate
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Render: gallery grid
  return (
    <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Your Gallery</h1>
          <p className="text-sm text-text-secondary mt-1">
            {entries.length} generation{entries.length === 1 ? '' : 's'} · synced to your account
          </p>
        </div>
        {(() => {
          const filteredCount = filter === 'all'
            ? entries.length
            : entries.filter(e => e.mode === filter).length;
          const label = filter === 'all' ? 'Clear all'
            : filter === 'create' ? 'Clear Created'
            : 'Clear Animated';
          return (
            <Button
              variant="ghost"
              onClick={handleClearAll}
              disabled={filteredCount === 0}
              className="text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} className="mr-2" /> {label}
            </Button>
          );
        })()}
      </div>

      {/* Legacy localStorage backup banner — sunsets June 5, 2026 */}
      {legacyBanner}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['all', 'create', 'animate'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setFilter(mode)}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              filter === mode
                ? 'bg-accent-amber text-bg-primary font-medium'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            {mode === 'all' ? 'All' : mode === 'create' ? 'Created' : 'Animated'}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredEntries.map((entry) => (
          <GalleryCard
            key={entry.jobId}
            entry={entry}
            imageUrl={imageUrls[entry.jobId]}
            onDownload={() => handleDownload(entry)}
            onSendToSlicer={() => handleSendToSlicer(entry)}
            onDelete={() => handleDelete(entry.jobId)}
          />
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
//  GalleryCard sub-component
// ──────────────────────────────────────────────────────────────────────────────

interface GalleryCardProps {
  entry: GalleryEntryV1;
  imageUrl: string | undefined;
  onDownload: () => void;
  onSendToSlicer: () => void;
  onDelete: () => void;
}

function GalleryCard({ entry, imageUrl, onDownload, onSendToSlicer, onDelete }: GalleryCardProps) {
  const ready = !!imageUrl;
  return (
    <div className="group bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden flex flex-col">
      <div className="relative aspect-square bg-bg-primary flex items-center justify-center">
        {/* Mode badge */}
        <Badge
          className={`absolute top-2 left-2 z-10 ${
            entry.mode === 'create' ? 'bg-accent-amber text-bg-primary' : 'bg-accent-teal text-bg-primary'
          }`}
        >
          {entry.mode === 'create' ? 'Created' : (
            <>
              <Play size={10} className="inline mr-1" />
              Animated
            </>
          )}
        </Badge>

        {/* Delete button — visible by default on touch, hover-revealed on
            fine pointers. Base `opacity-100` is the touch state; `pointer-fine`
            variants flip it back to opacity-0 unless the card is hovered.
            focus-visible keeps keyboard reveal. min-h-11 min-w-11 gives the
            44px tap area on mobile; md:min-h-0 md:min-w-0 restores the compact
            desktop visual. flex-centered so the icon stays centered when the
            mobile floor makes the button taller. */}
        <button
          onClick={onDelete}
          className="absolute top-2 right-2 z-10 p-1.5 bg-bg-primary/80 hover:bg-bg-primary rounded flex items-center justify-center min-h-11 min-w-11 md:min-h-0 md:min-w-0 opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          aria-label="Delete"
        >
          <Trash2 size={14} className="text-text-secondary" />
        </button>

        {/* Image OR loading placeholder */}
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={entry.prompt}
            className="max-w-full max-h-full object-contain pixel-art-render"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <Loader2 size={16} className="animate-spin text-text-muted" />
        )}
      </div>

      <div className="p-3 flex flex-col gap-3 flex-1">
        <p className="text-sm text-text-primary line-clamp-2" title={entry.prompt}>
          {entry.prompt}
        </p>
        <p className="text-xs text-text-muted">{relativeTime(entry.createdAt)}</p>

        <div className="flex gap-2 mt-auto">
          <Button
            onClick={onSendToSlicer}
            disabled={!ready}
            variant="primary"
            className="flex-1"
            size="sm"
          >
            <Scissors size={14} className="mr-2" /> Slicer
          </Button>
          <Button
            onClick={onDownload}
            disabled={!ready}
            variant="secondary"
            className="flex-1"
            size="sm"
          >
            <Download size={14} className="mr-2" /> Download
          </Button>
        </div>
      </div>
    </div>
  );
}
