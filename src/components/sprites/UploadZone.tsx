'use client';

import { useCallback, useRef, useState, type DragEvent } from 'react';
import { UploadCloud, X, AlertCircle } from 'lucide-react';
import Button from '@/components/ui/Button';

const ACCEPTED_TYPES = ['image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface UploadZoneProps {
  onImageLoaded: (file: File, blobUrl: string, width: number, height: number) => void;
  currentImage: string | null;
  onRemove: () => void;
}

export default function UploadZone({ onImageLoaded, currentImage, onRemove }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      setError(null);

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError('Invalid file type. Please use PNG, WEBP, or GIF.');
        return;
      }

      if (file.size > MAX_SIZE_BYTES) {
        setError('File too large. Maximum size is 10 MB.');
        return;
      }

      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        onImageLoaded(file, blobUrl, img.naturalWidth, img.naturalHeight);
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        setError('Failed to load image. The file may be corrupted.');
      };
      img.src = blobUrl;
    },
    [onImageLoaded]
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // reset so same file can be re-selected
      e.target.value = '';
    },
    [processFile]
  );

  // Show thumbnail preview if an image is already uploaded
  if (currentImage) {
    return (
      <div className="relative rounded-lg border border-border-default bg-bg-surface p-4">
        <div className="flex items-start gap-4">
          <div
            className="relative flex-shrink-0 rounded border border-border-subtle overflow-hidden"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
            }}
          >
            <img
              src={currentImage}
              alt="Uploaded sprite sheet"
              className="block max-w-[200px] max-h-[200px]"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-text-secondary">Sprite sheet loaded</p>
            <p className="text-[10px] font-mono text-text-muted mt-1">
              Configure frame size below, then slice.
            </p>
          </div>
          <button
            onClick={onRemove}
            className="flex-shrink-0 p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
            title="Remove image"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed
          py-16 px-8 cursor-pointer transition-all duration-200
          ${
            dragOver
              ? 'border-accent-amber bg-accent-amber-glow glow-amber'
              : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
          }
        `}
      >
        <div
          className={`flex items-center justify-center w-14 h-14 rounded-lg mb-4 transition-colors ${
            dragOver ? 'bg-accent-amber/20' : 'bg-bg-elevated'
          }`}
        >
          <UploadCloud
            size={28}
            className={dragOver ? 'text-accent-amber' : 'text-text-muted'}
          />
        </div>
        <p className="text-sm font-mono text-text-secondary mb-1">
          Drop your sprite sheet here
        </p>
        <p className="text-[10px] font-mono text-text-muted mb-4">
          PNG, WEBP, or GIF &middot; Max 10 MB
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Browse files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".png,.webp,.gif"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded bg-red-500/10 border border-red-500/20 px-3 py-2">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
          <p className="text-xs font-mono text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
