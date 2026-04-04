/**
 * Generation history — stored in localStorage.
 *
 * Thumbnails are always kept (small, ~2-5 KB each). Full images are only
 * kept for the most recent N entries because localStorage is capped at ~5 MB.
 */

export type GenerationMode = 'create' | 'animate';

export interface GenerationHistoryEntry {
  id: string;
  prompt: string;
  style: string;
  mode: GenerationMode;
  action?: string; // animate mode only: walk, idle, attack, etc.
  timestamp: number;
  thumbnailDataUrl: string;
  fullImageDataUrl?: string; // only for recent entries
}

const HISTORY_KEY = 'spritebrew_gen_history';
const MAX_HISTORY = 50;
const FULL_IMAGE_KEEP = 10; // keep full images only for N most recent

/** Read all history entries (newest first). */
export function loadHistory(): GenerationHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Migrate old entries that lack mode/id/thumbnailDataUrl fields
    return parsed.map(
      (e: Record<string, unknown>, idx: number): GenerationHistoryEntry => ({
        id: (e.id as string) ?? `legacy-${e.timestamp ?? idx}`,
        prompt: (e.prompt as string) ?? '',
        style: (e.style as string) ?? 'unknown',
        mode: ((e.mode as GenerationMode) ??
          (typeof e.style === 'string' && e.style.startsWith('any_animation_')
            ? 'animate'
            : 'create')) as GenerationMode,
        action: e.action as string | undefined,
        timestamp: (e.timestamp as number) ?? Date.now(),
        thumbnailDataUrl:
          (e.thumbnailDataUrl as string) ?? (e.thumbnail as string) ?? '',
        fullImageDataUrl: e.fullImageDataUrl as string | undefined,
      })
    );
  } catch {
    return [];
  }
}

/** Save entries to localStorage, pruning full images from older entries first. */
function saveHistory(entries: GenerationHistoryEntry[]) {
  if (typeof window === 'undefined') return;

  // Cap total count
  let trimmed = entries.slice(0, MAX_HISTORY);

  // Drop fullImageDataUrl from all but the most recent FULL_IMAGE_KEEP entries
  trimmed = trimmed.map((entry, idx) => {
    if (idx < FULL_IMAGE_KEEP) return entry;
    if (!entry.fullImageDataUrl) return entry;
    const { fullImageDataUrl: _unused, ...rest } = entry;
    void _unused;
    return rest;
  });

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded — try again with fewer full images
    try {
      const stripped = trimmed.map((entry, idx) => {
        if (idx < 3) return entry;
        const { fullImageDataUrl: _unused, ...rest } = entry;
        void _unused;
        return rest;
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(stripped));
    } catch {
      // Still failed — drop full images entirely
      try {
        const noFull = trimmed.map(({ fullImageDataUrl: _unused, ...rest }) => {
          void _unused;
          return rest;
        });
        localStorage.setItem(HISTORY_KEY, JSON.stringify(noFull));
      } catch {
        // Give up — localStorage unavailable
      }
    }
  }
}

/** Create a small nearest-neighbor thumbnail from a data URL. */
export function createThumbnail(dataUrl: string, size: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

interface AddHistoryInput {
  prompt: string;
  style: string;
  mode: GenerationMode;
  action?: string;
  fullImageDataUrl: string;
}

/** Add a new entry to history. */
export async function addToHistory(input: AddHistoryInput): Promise<void> {
  const thumbnail = await createThumbnail(input.fullImageDataUrl, 128);

  const entry: GenerationHistoryEntry = {
    id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    prompt: input.prompt,
    style: input.style,
    mode: input.mode,
    action: input.action,
    timestamp: Date.now(),
    thumbnailDataUrl: thumbnail,
    fullImageDataUrl: input.fullImageDataUrl,
  };

  const entries = loadHistory();
  entries.unshift(entry);
  saveHistory(entries);
}

/** Delete a single entry by id. */
export function deleteHistoryEntry(id: string): void {
  const entries = loadHistory().filter((e) => e.id !== id);
  saveHistory(entries);
}

/** Clear all history. */
export function clearHistory(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(HISTORY_KEY);
}

/** Format a timestamp as a relative string. */
export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 60) return 'Just now';
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  if (day === 1) return 'Yesterday';
  if (day < 7) return `${day} days ago`;
  if (day < 30) return `${Math.floor(day / 7)} week${Math.floor(day / 7) === 1 ? '' : 's'} ago`;
  return new Date(timestamp).toLocaleDateString();
}
