'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Scissors, Trash2, Images, Sparkles, Play } from 'lucide-react';
import { useAuth } from '@clerk/react';
import {
  loadHistory,
  deleteHistoryEntry,
  clearHistory,
  relativeTime,
  type GenerationHistoryEntry,
  type GenerationMode,
} from '@/lib/generationHistory';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

type FilterTab = 'all' | 'create' | 'animate';

export default function GalleryPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);

  const [entries, setEntries] = useState<GenerationHistoryEntry[]>([]);
  const [filter, setFilter] = useState<FilterTab>('all');

  useEffect(() => {
    setEntries(loadHistory(userId));
  }, [userId]);

  const counts = useMemo(
    () => ({
      all: entries.length,
      create: entries.filter((e) => e.mode === 'create').length,
      animate: entries.filter((e) => e.mode === 'animate').length,
    }),
    [entries]
  );

  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.mode === filter)),
    [entries, filter]
  );

  const handleDownload = useCallback((entry: GenerationHistoryEntry) => {
    const url = entry.fullImageDataUrl ?? entry.thumbnailDataUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `spritebrew_${entry.mode}_${entry.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleSendToSlicer = useCallback(
    (entry: GenerationHistoryEntry) => {
      if (!entry.fullImageDataUrl) return;
      setGeneratedImage(entry.fullImageDataUrl, entry.fullImageDataUrl);
      setGenerationStyle(entry.style);
      router.push('/upload');
    },
    [setGeneratedImage, setGenerationStyle, router]
  );

  const handleDelete = useCallback((id: string) => {
    if (!confirm('Delete this generation? This cannot be undone.')) return;
    deleteHistoryEntry(userId, id);
    setEntries(loadHistory(userId));
  }, [userId]);

  const handleClearAll = useCallback(() => {
    if (!confirm('Clear all generation history? This cannot be undone.')) return;
    clearHistory(userId);
    setEntries([]);
  }, [userId]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-sm text-accent-amber mb-2">Generation Gallery</h1>
          <p className="text-sm font-mono text-text-secondary">
            Browse and download your generated sprite sheets.
          </p>
        </div>
        {entries.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClearAll}>
            <Trash2 size={14} />
            Clear All
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      {entries.length > 0 && (
        <div className="flex gap-1 rounded-lg bg-bg-secondary p-1 w-fit">
          <FilterButton
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label="All"
            count={counts.all}
          />
          <FilterButton
            active={filter === 'create'}
            onClick={() => setFilter('create')}
            label="Created"
            count={counts.create}
            icon={<Sparkles size={12} />}
          />
          <FilterButton
            active={filter === 'animate'}
            onClick={() => setFilter('animate')}
            label="Animated"
            count={counts.animate}
            icon={<Play size={12} />}
          />
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-default bg-bg-surface p-12 text-center">
          <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-bg-elevated mx-auto mb-4">
            <Images size={28} className="text-text-muted" />
          </div>
          <p className="text-sm font-mono text-text-secondary mb-4">
            No generations yet. Head to the Generate page to create your first sprite sheet!
          </p>
          <Link href="/generate">
            <Button variant="primary" size="md">
              <Sparkles size={14} />
              Go to Generate
            </Button>
          </Link>
        </div>
      )}

      {/* Gallery grid */}
      {filtered.length > 0 && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((entry) => (
            <GalleryCard
              key={entry.id}
              entry={entry}
              onDownload={() => handleDownload(entry)}
              onSendToSlicer={() => handleSendToSlicer(entry)}
              onDelete={() => handleDelete(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Filter yielded no results */}
      {entries.length > 0 && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-default bg-bg-surface p-8 text-center">
          <p className="text-sm font-mono text-text-muted">
            No {filter === 'create' ? 'created' : 'animated'} generations yet.
          </p>
        </div>
      )}
    </div>
  );
}

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
}

function FilterButton({ active, onClick, label, count, icon }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-mono cursor-pointer transition-colors
        ${active
          ? 'bg-accent-amber text-bg-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
        }`}
    >
      {icon}
      {label} ({count})
    </button>
  );
}

interface GalleryCardProps {
  entry: GenerationHistoryEntry;
  onDownload: () => void;
  onSendToSlicer: () => void;
  onDelete: () => void;
}

function GalleryCard({ entry, onDownload, onSendToSlicer, onDelete }: GalleryCardProps) {
  const hasFullImage = !!entry.fullImageDataUrl;
  const imgSrc = entry.fullImageDataUrl ?? entry.thumbnailDataUrl;

  return (
    <div className="rounded-lg border border-border-default bg-bg-surface overflow-hidden transition-all duration-150 hover:border-accent-amber/40 hover:shadow-[0_0_12px_var(--accent-amber-glow)] group">
      {/* Thumbnail */}
      <div
        className="relative aspect-square w-full flex items-center justify-center"
        style={{
          backgroundImage:
            'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
          backgroundSize: '10px 10px',
          backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
        }}
      >
        {imgSrc && (
          <img
            src={imgSrc}
            alt={entry.prompt}
            className="max-w-full max-h-full object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        )}
        {/* Mode badge */}
        <div className="absolute top-2 left-2">
          {entry.mode === 'create' ? (
            <Badge variant="amber">
              <Sparkles size={8} className="inline mr-1" />
              Created
            </Badge>
          ) : (
            <Badge variant="teal">
              <Play size={8} className="inline mr-1" />
              Animated
            </Badge>
          )}
        </div>
        {/* Delete button — only visible on hover */}
        <button
          onClick={onDelete}
          title="Delete"
          className="absolute top-2 right-2 p-1.5 rounded bg-bg-primary/80 border border-border-default
            text-text-muted hover:text-red-400 hover:bg-bg-primary cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <p
          className="text-xs font-mono text-text-primary line-clamp-2 min-h-[2rem]"
          title={entry.prompt}
        >
          {entry.prompt || <span className="text-text-muted">(no prompt)</span>}
        </p>
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-mono text-text-muted truncate flex-1 min-w-0" title={entry.style}>
            {entry.style}
          </p>
          <p className="text-[9px] font-mono text-text-muted flex-shrink-0 ml-2">
            {relativeTime(entry.timestamp)}
          </p>
        </div>

        {!hasFullImage && (
          <p className="text-[9px] font-mono text-amber-400/80">
            Full image not available — only the 10 most recent generations are stored for download.
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={onSendToSlicer}
            disabled={!hasFullImage}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-mono
              bg-accent-amber text-bg-primary hover:bg-accent-amber-strong cursor-pointer
              disabled:opacity-40 disabled:cursor-not-allowed"
            title="Send to Slicer"
          >
            <Scissors size={11} />
            Slicer
          </button>
          <button
            onClick={onDownload}
            disabled={!imgSrc}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-mono
              bg-bg-elevated text-text-primary border border-border-default hover:bg-bg-hover cursor-pointer
              disabled:opacity-40 disabled:cursor-not-allowed"
            title="Download PNG"
          >
            <Download size={11} />
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
