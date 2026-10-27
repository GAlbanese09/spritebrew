/**
 * Generation history — stored in localStorage.
 *
 * Thumbnails are always kept (small, ~2-5 KB each). Full images are only
 * kept for the most recent N entries because localStorage is capped at ~5 MB.
 *
 * It is per browser and feeds Recent on /generate. The Gallery lists the
 * server's copy of every finished job instead.
 */

export type GenerationMode = 'create' | 'animate';

export interface SlicerHints {
  source: 'animate' | 'create';
  animationType: string; // slicer type id (e.g. 'walk', 'idle', 'attack')
  frameCount: number;
  directional: boolean;
  rows?: number;
  cols?: number;
  /**
   * Set true when the consumer's fallback pipeline delivered this sheet
   * (i.e. the primary RD job timed out/failed and we auto-downgraded to
   * a 64×64 rescue). Additive field — older entries and non-rescued
   * successes leave this undefined and behave identically.
   */
  rescued?: true;
  /**
   * Cell size in px the sheet was delivered at (animate only): the size the
   * request was sent at, or the delivered cell size on a rescue. Additive;
   * absent on gallery hints and older entries.
   */
  frameSize?: number;
}

export interface GenerationHistoryEntry {
  id: string;
  /** The generation job it came from, so a job has one entry; absent on
   *  older entries and on the legacy stream path. */
  jobId?: string;
  prompt: string;
  style: string;
  mode: GenerationMode;
  action?: string; // animate mode only: walk, idle, attack, etc.
  timestamp: number;
  thumbnailDataUrl: string;
  fullImageDataUrl?: string; // only for recent entries
  slicerHints?: SlicerHints;
}

const MAX_HISTORY = 50;
const FULL_IMAGE_KEEP = 10; // keep full images only for N most recent

/** Build the per-user localStorage key. Falls back to "anonymous" when not signed in. */
function historyKey(userId: string | null | undefined): string {
  return `spritebrew_generations_${userId || 'anonymous'}`;
}

/** Read all history entries (newest first) for the given user. */
export function loadHistory(userId: string | null | undefined): GenerationHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(historyKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Migrate old entries that lack mode/id/thumbnailDataUrl fields
    return parsed.map(
      (e: Record<string, unknown>, idx: number): GenerationHistoryEntry => ({
        id: (e.id as string) ?? `legacy-${e.timestamp ?? idx}`,
        ...(typeof e.jobId === 'string' ? { jobId: e.jobId } : {}),
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

/** What addToHistory tells listeners: a new entry was saved, or, with
 *  failedFor (the entry's full image), it could not be. */
export interface HistoryChange {
  failedFor?: string;
}

const historyListeners = new Set<(change: HistoryChange) => void>();

/** Listens for addToHistory's outcome; returns the unsubscribe function.
 *  Recent on /generate reads the history again when told: an entry is saved
 *  after its thumbnail is drawn, which is after its result shows. */
export function onHistoryChange(listener: (change: HistoryChange) => void): () => void {
  historyListeners.add(listener);
  return () => {
    historyListeners.delete(listener);
  };
}

/** Save entries to localStorage, pruning full images from older entries
 *  first. False when nothing could be saved. */
function saveHistory(userId: string | null | undefined, entries: GenerationHistoryEntry[]): boolean {
  if (typeof window === 'undefined') return false;
  const key = historyKey(userId);

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
    localStorage.setItem(key, JSON.stringify(trimmed));
    return true;
  } catch {
    // Quota exceeded — try again with fewer full images
    try {
      const stripped = trimmed.map((entry, idx) => {
        if (idx < 3) return entry;
        const { fullImageDataUrl: _unused, ...rest } = entry;
        void _unused;
        return rest;
      });
      localStorage.setItem(key, JSON.stringify(stripped));
      return true;
    } catch {
      // Still failed — drop full images entirely
      try {
        const noFull = trimmed.map(({ fullImageDataUrl: _unused, ...rest }) => {
          void _unused;
          return rest;
        });
        localStorage.setItem(key, JSON.stringify(noFull));
        return true;
      } catch {
        // Give up: localStorage is full or unavailable. Recent misses this
        // entry; the Gallery, which the server writes, still has the sheet.
        return false;
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
  userId: string | null | undefined;
  prompt: string;
  style: string;
  mode: GenerationMode;
  action?: string;
  fullImageDataUrl: string;
  slicerHints?: SlicerHints;
  jobId?: string;
}

/** Add a new entry to history for the given user, unless its job already
 *  has one (another tab of this browser finished the same job). Resolves
 *  false when it could not be saved; the listeners hear the outcome either
 *  way. */
export async function addToHistory(input: AddHistoryInput): Promise<boolean> {
  const thumbnail = await createThumbnail(input.fullImageDataUrl, 128);

  const entry: GenerationHistoryEntry = {
    id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    prompt: input.prompt,
    style: input.style,
    mode: input.mode,
    action: input.action,
    timestamp: Date.now(),
    thumbnailDataUrl: thumbnail,
    fullImageDataUrl: input.fullImageDataUrl,
    slicerHints: input.slicerHints,
  };

  const entries = loadHistory(input.userId);
  if (input.jobId && entries.some((e) => e.jobId === input.jobId)) {
    historyListeners.forEach((listener) => listener({}));
    return true;
  }
  entries.unshift(entry);
  const saved = saveHistory(input.userId, entries);
  const change: HistoryChange = saved ? {} : { failedFor: input.fullImageDataUrl };
  historyListeners.forEach((listener) => listener(change));
  return saved;
}

/** Delete a single entry by id for the given user. */
export function deleteHistoryEntry(userId: string | null | undefined, id: string): void {
  const entries = loadHistory(userId).filter((e) => e.id !== id);
  saveHistory(userId, entries);
}

/** Clear all history for the given user. */
export function clearHistory(userId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(historyKey(userId));
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
