'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  CLEAN_FAILED,
  CLEAN_STALE,
  EMPTY_SCOPE,
  NONE_TICKED,
  UNDO_FAILED,
  UNDO_STALE,
  cleanKeyFrame,
  cleanedLine,
  foundAnnouncement,
  foundManyLine,
  foundOneTail,
  framesWord,
  possibleAnnouncement,
  possibleLine,
  quietKind,
  rowLine,
  sheetIsOpaque,
  keyFindings,
  keyMarkKinds,
  keyTotals,
  rowCount,
  scanKeyFrame,
  scanKeySheet,
  tickedRows,
  undoneLine,
  unsureLine,
  ROW_IDS,
  type FrameKeyScan,
  type KeyFinding,
  type KeyName,
  type RowId,
} from '@/lib/keyResidue';
import { residueOverlay } from '@/lib/residueCleanup';
import { frameToDataURL, imageToCanvas, loadImage } from '@/lib/spriteUtils';
import { useSpriteStore } from '@/stores/spriteStore';
import type { SpriteFrame, SpriteSheet } from '@/lib/types';

/** The sheet's pixels after a Clean, or before it for Undo: the shape the
 *  page's commit takes (as Align frames' AlignedSheet). */
export interface CleanedSheet {
  sourceImage: string;
  urls: Map<string, string>;
}

/** One frame's pixels. */
interface PixelFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** The frames as read and scanned, for the frame map they came from. */
interface Read {
  urls: Map<string, string>;
  frames: Map<string, PixelFrame>;
  scans: Map<string, FrameKeyScan>;
}

interface LeftoverBackgroundProps {
  sheet: SpriteSheet;
  frameDataUrls: Map<string, string>;
  /** The frames selected in the grid, for the "Selected" scope. */
  selectedFrames: string[];
  /** Puts what `prepare` returns on the sheet it was started from; false if
   *  the sheet moved on first, or `prepare` returned null. */
  onCommit: (prepare: () => Promise<CleanedSheet | null>) => Promise<boolean>;
  /** The "Show where" marks, one image per frame id, for the grid to draw
   *  over its thumbnails; null when they are off. */
  onMarks: (marks: Map<string, string> | null) => void;
  /** The keys the page knows were the background (Send to Slicer's fill,
   *  what Remove background took). Only their rows start ticked. */
  knownBackground: ReadonlySet<KeyName>;
}

/** The grid draws a frame in a 64 px box: a mark grows so that one pixel
 *  of a larger frame still shows there. */
const THUMBNAIL_PX = 64;
const ALL_ROWS: ReadonlySet<RowId> = new Set(ROW_IDS);

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A Clean's record: what Undo puts back, and the frame map it is for. */
interface Cleaned {
  pixels: number;
  frames: number;
  before: CleanedSheet;
  beforeRead: Read;
  version: number;
  urls: Map<string, string>;
}

/**
 * What the strip keeps for one sheet while the person is elsewhere (Preview,
 * the editor) and the card unmounts: their ticks, each row's first default
 * (so a Clean that brings a gem to the cut edge cannot turn it from art into
 * leftover), the last Clean (so Undo is offered again on return while the
 * frames are those it made), what was closed, and whether the strip was
 * announced (AUDIT clean-frames r1 M1, M2, H1, L9). Only the newest sheet
 * is kept; nothing is stored on the device.
 */
/** The frame map on which the person closed each strip. */
interface Closed {
  cleaned: Map<string, string> | null;
  found: Map<string, string> | null;
}

interface SheetMemory {
  sheetId: string;
  toggled: Map<RowId, boolean>;
  defaults: Map<RowId, boolean>;
  /** The keys the page knew were the background when the defaults were
   *  recorded. */
  defaultsKnown: Set<KeyName>;
  cleaned: Cleaned | null;
  closed: Closed;
  announced: boolean;
}
let memory: SheetMemory | null = null;
function memoryFor(sheetId: string): SheetMemory {
  if (!memory || memory.sheetId !== sheetId) {
    memory = { sheetId, toggled: new Map(), defaults: new Map(), defaultsKnown: new Set(), cleaned: null, closed: { cleaned: null, found: null }, announced: false };
  }
  return memory;
}

/** Each row's first default, recorded once per sheet, and again only when
 *  the page has since learned its key was the background (Remove
 *  background took it). */
function rememberDefaults(m: SheetMemory, findings: readonly KeyFinding[], known: ReadonlySet<KeyName>): void {
  for (const f of findings) {
    if (!m.defaults.has(f.row) || (known.has(f.key) && !m.defaultsKnown.has(f.key))) m.defaults.set(f.row, f.art === null);
  }
  for (const k of known) m.defaultsKnown.add(k);
}

/** The next control after `el` that takes focus, outside it. */
function nextFocusable(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  const all = [...document.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
  return all.find((c) => !el.contains(c) && !!(el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && !c.hasAttribute('disabled')) ?? null;
}

/** Dims a button that cannot act yet but keeps its focus (no native disabled). */
const DIMMED = 'aria-disabled:opacity-40 aria-disabled:cursor-not-allowed';
const BUTTON = 'inline-flex items-center justify-center min-h-8 pointer-coarse:min-h-11 px-3 rounded text-xs font-mono font-medium whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber';
const PRIMARY = `${BUTTON} bg-accent-amber text-bg-primary hover:bg-accent-amber-strong ${DIMMED}`;
// A pressed ghost toggle (Show where) takes the amber border and text.
const GHOST = `${BUTTON} border border-border-strong text-text-primary hover:bg-bg-hover aria-pressed:border-accent-amber aria-pressed:text-accent-amber`;
const ICON_BUTTON = 'inline-flex shrink-0 items-center justify-center w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber';
// The scope switch is the app's one switch style: the result card's Sheet
// and Playing, Edited and Before edit (DESIGN 2026-11-11-009, -014).
const SCOPE_TRACK = 'flex flex-wrap gap-1 rounded-lg bg-bg-secondary p-1 w-fit max-w-full';
const SCOPE_BUTTON =
  'px-3 min-h-8 pointer-coarse:min-h-11 rounded-md text-xs font-mono whitespace-nowrap cursor-pointer transition-colors '
  + 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber';
const SCOPE_ON = 'bg-accent-amber text-bg-primary';
const SCOPE_OFF = 'text-text-secondary hover:text-text-primary hover:bg-bg-hover';

async function decodeFrame(url: string): Promise<PixelFrame> {
  const img = await loadImage(url);
  return imageToCanvas(img).getContext('2d')!.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
}

const toImageData = (frame: PixelFrame) => new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);

/** The sheet's source image with each cleaned frame put back at its rect,
 *  and each cleaned frame's new data URL (as Align frames builds its own). */
async function buildCleanedSheet(
  sheet: SpriteSheet,
  cleaned: { frame: SpriteFrame; pixels: PixelFrame }[],
  frameDataUrls: Map<string, string>
): Promise<CleanedSheet> {
  const sheetCanvas = imageToCanvas(await loadImage(sheet.sourceImage));
  const sheetContext = sheetCanvas.getContext('2d')!;
  const cell = document.createElement('canvas');
  const urls = new Map(frameDataUrls);
  for (const { frame, pixels } of cleaned) {
    const image = toImageData(pixels);
    cell.width = pixels.width;
    cell.height = pixels.height;
    cell.getContext('2d')!.putImageData(image, 0, 0);
    urls.set(frame.id, frameToDataURL(cell));
    // An auto-detected frame can be padded or scaled, so its pixels are not
    // the size of its rect. Its data URL is what plays and exports; only the
    // rect-sized frames go back on the sheet.
    if (pixels.width === frame.width && pixels.height === frame.height) {
      sheetContext.putImageData(image, frame.x, frame.y);
    }
  }
  return { sourceImage: frameToDataURL(sheetCanvas), urls };
}

/** One frame's "Show where" marks as an image the size of the frame. */
function marksImage(scan: FrameKeyScan, rows: ReadonlySet<RowId>): string | null {
  const grow = Math.max(0, Math.ceil(Math.max(scan.width, scan.height) / THUMBNAIL_PX) - 1);
  const kinds = keyMarkKinds(scan, rows, grow);
  if (!kinds.some((k) => k !== 0)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = scan.width;
  canvas.height = scan.height;
  canvas.getContext('2d')!.putImageData(new ImageData(residueOverlay(kinds, scan.width, scan.height), scan.width, scan.height), 0, 0);
  return frameToDataURL(canvas);
}

/**
 * The leftover background strip in the Frames card on /upload (George, Nov
 * 11, 2026; DESIGN ticket upload-residue-clean). After slicing, and again
 * after a saved frame edit, every frame is scanned for leftover key color
 * (src/lib/keyResidue.ts). The strip shows only when something is found,
 * says what and how much, and changes nothing until Clean. Clean and Undo go
 * through the page's commit, as Align frames does, so the pixels land only
 * on the sheet they were made from and one Undo restores the whole batch.
 */
export default function LeftoverBackground({ sheet, frameDataUrls, selectedFrames, onCommit, onMarks, knownBackground }: LeftoverBackgroundProps) {
  const sheetVersion = useSpriteStore((s) => s.sheetVersion);
  const mem = memoryFor(sheet.id);
  const [read, setRead] = useState<Read | null>(null);
  // The frame map this strip's own Clean or Undo is committing: it already
  // holds those pixels, so the read skips it.
  const committedRef = useRef<Map<string, string> | null>(null);
  // Only the person's own ticks and unticks; every other row follows its
  // remembered default. Kept for the sheet across Clean, Undo, rescans and
  // leaving the page (AUDIT clean-frames r1 M2).
  const [toggled, setToggledState] = useState<Map<RowId, boolean>>(() => mem.toggled);
  const [defaults, setDefaults] = useState<Map<RowId, boolean>>(() => mem.defaults);
  const [scopeMode, setScopeMode] = useState<'all' | 'selected'>('all');
  const [showWhere, setShowWhere] = useState(false);
  const [cleaned, setCleanedState] = useState<Cleaned | null>(() => mem.cleaned);
  // The frame map on which the person closed the Cleaned line, or the found
  // strip. Each comes back for the next frame map (a new slice, a saved
  // edit) if there is still something to say. Closing the Cleaned line
  // brings back the found strip for what the Clean left (L8).
  const [closed, setClosedState] = useState<Closed>(() => mem.closed);
  // What a screen reader hears (once per event), and a refusal shown in the strip.
  const [said, setSaid] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const reasonId = useId();
  const artNoteId = useId();
  const foundRef = useRef<HTMLElement>(null);
  const cleanedRef = useRef<HTMLElement>(null);
  const cleanButtonRef = useRef<HTMLButtonElement>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the strip that replaces a pressed button is drawn
  // (AUDIT clean-frames r1 L1).
  const focusNextRef = useRef<'undo' | 'clean' | null>(null);

  const setToggled = useCallback((next: Map<RowId, boolean>) => {
    memoryFor(sheet.id).toggled = next;
    setToggledState(next);
  }, [sheet.id]);
  const setCleaned = useCallback((next: Cleaned | null) => {
    memoryFor(sheet.id).cleaned = next;
    setCleanedState(next);
  }, [sheet.id]);
  const setClosed = useCallback((next: Closed) => {
    memoryFor(sheet.id).closed = next;
    setClosedState(next);
  }, [sheet.id]);
  /** A new read: each new row's default is recorded once. On a read of
   *  frames changed from outside (`prune`), a tick whose row is gone from
   *  the sheet is dropped; a Clean's own read keeps it, so Undo brings the
   *  row back ticked. */
  const takeRead = useCallback((next: Read, prune: boolean) => {
    const m = memoryFor(sheet.id);
    const all = keyFindings(next.scans, undefined, knownBackground);
    rememberDefaults(m, all, knownBackground);
    const present = new Set(all.map((f) => f.row));
    if (prune && [...m.toggled.keys()].some((row) => !present.has(row))) {
      setToggled(new Map([...m.toggled].filter(([row]) => present.has(row))));
    }
    setDefaults(new Map(m.defaults));
    setRead(next);
  }, [sheet.id, setToggled, knownBackground]);

  const allFrames = useMemo(() => sheet.animations.flatMap((a) => a.frames), [sheet]);

  // Read and scan each frame, after a yield so the page never freezes. The
  // whole sheet is scanned at one art pixel size (AUDIT clean-frames r1 M5).
  useEffect(() => {
    if (committedRef.current === frameDataUrls) {
      committedRef.current = null;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const frames = new Map<string, PixelFrame>();
        for (const frame of allFrames) {
          const url = frameDataUrls.get(frame.id);
          if (!url || frames.has(frame.id)) continue;
          const pixels = await decodeFrame(url);
          if (cancelled) return;
          frames.set(frame.id, pixels);
        }
        await nextTask();
        if (cancelled) return;
        const scans = scanKeySheet(frames);
        takeRead({ urls: frameDataUrls, frames, scans }, true);
        const m = memoryFor(sheet.id);
        const found = sheetIsOpaque(scans) ? 0 : keyTotals(scans, ALL_ROWS).frames;
        if (found > 0 && !m.announced) {
          m.announced = true;
          const quietly = tickedRows(keyFindings(scans, undefined, knownBackground), new Map(), m.defaults).size === 0;
          setSaid(quietly ? possibleAnnouncement(found) : foundAnnouncement(found));
        }
      } catch {
        // A frame that cannot be read is not scanned: no strip, nothing said.
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allFrames, frameDataUrls, sheet.id, takeRead, knownBackground]);

  // What the strip knows, for the frame map it read. While a new map is
  // being read the last strip stays, still, so the thumbnails do not jump
  // (AUDIT clean-frames r1 L4); nothing in it acts until the read lands.
  const fresh = read !== null && read.urls === frameDataUrls;
  const stale = read !== null && !fresh;
  const total = read ? read.scans.size : 0;
  const selectedHere = useMemo(
    () => (read ? selectedFrames.filter((id) => read.scans.has(id)) : []),
    [read, selectedFrames]
  );
  // The scope goes back to all frames when the selection empties (L6).
  const hasSelection = selectedHere.length > 0;
  const [hadSelection, setHadSelection] = useState(hasSelection);
  if (hadSelection !== hasSelection) {
    setHadSelection(hasSelection);
    if (!hasSelection) setScopeMode('all');
  }
  const scope = useMemo(
    () => (scopeMode === 'selected' && hasSelection ? new Set(selectedHere) : undefined),
    [scopeMode, hasSelection, selectedHere]
  );
  const findings = useMemo(() => (read ? keyFindings(read.scans, scope, knownBackground) : []), [read, scope, knownBackground]);
  // Whether the sheet holds any, whatever the scope: the strip stays while a
  // selection happens to be clean, so the scope can be switched back.
  // An opaque sheet is the page banner's to clean, so it shows no strip
  // (HQ 2026-11-11-051, ruling 2).
  const anyOnSheet = useMemo(
    () => read !== null && !sheetIsOpaque(read.scans) && keyTotals(read.scans, ALL_ROWS).frames > 0,
    [read]
  );
  const ticked = useMemo(() => tickedRows(findings, toggled, defaults), [findings, toggled, defaults]);
  const byDefault = useCallback((f: KeyFinding) => defaults.get(f.row) ?? f.art === null, [defaults]);
  const listed = useMemo(
    () => (read ? keyTotals(read.scans, new Set(findings.map((f) => f.row)), scope) : { pixels: 0, frames: 0 }),
    [read, findings, scope]
  );
  const scopeTotal = scope ? scope.size : total;

  const cleanedOpen = cleaned !== null && cleaned.version === sheetVersion && cleaned.urls === frameDataUrls
    && closed.cleaned !== frameDataUrls;
  // Every row found starts unticked, and none is ticked yet: a quieter strip.
  // Once the person ticks a row it reads as found (L9).
  const quiet = findings.length > 0 && findings.every((f) => !byDefault(f)) && ticked.size === 0;
  const kind = quietKind(findings);
  const foundOpen = !cleanedOpen && anyOnSheet && closed.found !== frameDataUrls;
  const marksOn = showWhere && foundOpen && fresh;
  // What "Show where" marks: what Clean would clear; with nothing ticked,
  // every listed row, so the person can look first.
  const markRows = useMemo(
    () => (ticked.size === 0 ? new Set(findings.map((f) => f.row)) : ticked),
    [ticked, findings]
  );

  // The marks for the grid: every pixel Clean would clear, in scope.
  useEffect(() => {
    if (!marksOn || !read) {
      onMarks(null);
      return;
    }
    const marks = new Map<string, string>();
    for (const [id, scan] of read.scans) {
      if (scope && !scope.has(id)) continue;
      const image = marksImage(scan, markRows);
      if (image) marks.set(id, image);
    }
    onMarks(marks);
  }, [marksOn, read, scope, markRows, onMarks]);
  useEffect(() => () => onMarks(null), [onMarks]);

  // Focus follows a press to the control that replaced it (L1).
  useEffect(() => {
    const target = focusNextRef.current;
    if (target === 'undo' && cleanedOpen) {
      focusNextRef.current = null;
      undoButtonRef.current?.focus();
    } else if (target === 'clean' && foundOpen) {
      focusNextRef.current = null;
      cleanButtonRef.current?.focus();
    }
  });

  /** Runs one press of Clean or Undo. A press while one runs does nothing. */
  const runPress = useCallback(async (press: () => Promise<void>, failed: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNote('');
    setSaid('');
    try {
      await press();
    } catch {
      setNote(failed);
      setSaid(failed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  /** A refusal, shown in the strip and said once (L9). */
  const refuse = useCallback((text: string) => {
    setNote(text);
    setSaid(text);
  }, []);

  /** False when a pixel edit landed since the press: the version guard does
   *  not see those. */
  const stillCurrent = useCallback(
    () => useSpriteStore.getState().frameDataUrls === frameDataUrls,
    [frameDataUrls]
  );

  const handleClean = useCallback(() => {
    if (!read || !fresh || ticked.size === 0) return;
    const current = read;
    void runPress(async () => {
      const changed: { frame: SpriteFrame; pixels: PixelFrame }[] = [];
      const done = new Set<string>();
      let pixels = 0;
      for (const frame of allFrames) {
        if (done.has(frame.id) || (scope && !scope.has(frame.id))) continue;
        done.add(frame.id);
        const before = current.frames.get(frame.id);
        const scan = current.scans.get(frame.id);
        if (!before || !scan) continue;
        const { data, cleared } = cleanKeyFrame(before.data, scan, ticked);
        if (cleared === 0) continue;
        pixels += cleared;
        changed.push({ frame, pixels: { data, width: before.width, height: before.height } });
      }
      if (changed.length === 0) return;
      let committed = frameDataUrls;
      const applied = await onCommit(async () => {
        await nextTask();
        const built = await buildCleanedSheet(sheet, changed, frameDataUrls);
        committed = built.urls;
        committedRef.current = built.urls;
        return stillCurrent() ? built : null;
      });
      if (!applied) {
        committedRef.current = null;
        refuse(CLEAN_STALE);
        return;
      }
      // The strip keeps the pixels it committed, so nothing is read again;
      // the cleaned frames are scanned at the sheet's art pixel.
      const frames = new Map(current.frames);
      const scans = new Map(current.scans);
      for (const { frame, pixels: after } of changed) {
        frames.set(frame.id, after);
        const was = current.scans.get(frame.id);
        scans.set(frame.id, scanKeyFrame(after.data, after.width, after.height, was?.artPixel));
      }
      takeRead({ urls: committed, frames, scans }, false);
      setShowWhere(false);
      // Undo is for the map this Clean committed. If the store holds another
      // by now, it is not offered.
      const now = useSpriteStore.getState();
      if (now.frameDataUrls === committed) {
        setCleaned({
          pixels,
          frames: changed.length,
          before: { sourceImage: sheet.sourceImage, urls: frameDataUrls },
          beforeRead: current,
          version: now.sheetVersion,
          urls: committed,
        });
        setClosed({ cleaned: null, found: null });
        focusNextRef.current = 'undo';
      }
      setSaid(cleanedLine(pixels, changed.length));
    }, CLEAN_FAILED);
  }, [read, fresh, ticked, scope, allFrames, frameDataUrls, sheet, onCommit, runPress, stillCurrent, takeRead, setCleaned, setClosed, refuse]);

  const handleUndo = useCallback(() => {
    const last = cleaned;
    if (!last || !cleanedOpen) return;
    void runPress(async () => {
      committedRef.current = last.before.urls;
      const applied = await onCommit(async () => {
        await nextTask();
        return stillCurrent() ? last.before : null;
      });
      if (!applied) {
        committedRef.current = null;
        refuse(UNDO_STALE);
        return;
      }
      takeRead(last.beforeRead, false);
      setCleaned(null);
      focusNextRef.current = 'clean';
      setSaid(undoneLine(last.frames));
    }, UNDO_FAILED);
  }, [cleaned, cleanedOpen, onCommit, runPress, stillCurrent, takeRead, setCleaned, refuse]);

  /** Closes the strip for this frame map; focus moves on to what follows. */
  const handleDismiss = useCallback((strip: HTMLElement | null, which: keyof Closed) => {
    const next = nextFocusable(strip);
    setClosed({ ...memoryFor(sheet.id).closed, [which]: frameDataUrls });
    setShowWhere(false);
    setNote('');
    setSaid('');
    // Closing the Cleaned line brings back the found strip for what is
    // left: focus goes to its Clean when there is one, else on past it.
    requestAnimationFrame(() => {
      if (which === 'cleaned' && cleanButtonRef.current) cleanButtonRef.current.focus();
      else next?.focus();
    });
  }, [frameDataUrls, sheet.id, setClosed]);

  const toggleRow = useCallback((row: RowId, on: boolean) => {
    setToggled(new Map(memoryFor(sheet.id).toggled).set(row, on));
  }, [sheet.id, setToggled]);

  // One row, ticked by default and still ticked, reads as a single line;
  // anything else (several rows, or one that is unticked) as a row each, so
  // there is always a box to untick (L7).
  const single = findings.length === 1 && byDefault(findings[0]) && ticked.has(findings[0].row) ? findings[0] : null;
  const emptyScope = foundOpen && findings.length === 0;
  const noneTicked = foundOpen && !emptyScope && ticked.size === 0;
  const dim = busy || stale;
  // The polite status speaks only while a strip is there (L9).
  const status = cleanedOpen || foundOpen ? said : '';

  return (
    <>
      <p className="sr-only" role="status">{status}</p>
      {cleanedOpen && cleaned && (
        <section
          ref={cleanedRef}
          role="region"
          aria-label="Leftover background"
          aria-busy={busy || undefined}
          className="mb-3 rounded-lg border border-accent-teal/40 bg-accent-teal/[0.07] p-3 font-mono text-[13px] text-text-primary"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>{cleanedLine(cleaned.pixels, cleaned.frames)}</p>
            <div className="flex items-center gap-2">
              <button ref={undoButtonRef} type="button" onClick={handleUndo} className={`${GHOST} flex-1 sm:flex-none`}>
                Undo
              </button>
              <button
                type="button"
                onClick={() => handleDismiss(cleanedRef.current, 'cleaned')}
                aria-label="Dismiss"
                className={ICON_BUTTON}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          </div>
          {note && <p className="mt-2 text-xs text-text-secondary">{note}</p>}
        </section>
      )}
      {foundOpen && (
        <section
          ref={foundRef}
          role="region"
          aria-label="Leftover background"
          aria-busy={dim || undefined}
          className={`mb-3 rounded-lg border p-3 font-mono text-[13px] text-text-primary ${quiet ? 'border-border-default bg-bg-secondary' : 'border-accent-amber/40 bg-accent-amber/5'}`}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              {emptyScope ? (
                <p>{EMPTY_SCOPE}</p>
              ) : single ? (
                <p>
                  Leftover background found:{' '}
                  <span
                    aria-hidden
                    className="inline-block w-4 h-4 rounded-[4px] border border-border-strong align-[-3px]"
                    style={{ backgroundColor: single.hex }}
                  />{' '}
                  <strong className="font-semibold">{single.hex}</strong>, {foundOneTail(single, scopeTotal)}
                </p>
              ) : (
                <>
                  <p>{!quiet ? foundManyLine(listed.frames, scopeTotal) : kind === 'unsure' ? unsureLine(listed.frames, scopeTotal, findings.length) : possibleLine(listed.frames, scopeTotal)}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {findings.map((f) => {
                      const on = ticked.has(f.row);
                      // A row's own line, only where the strip's line does
                      // not already say it (DESIGN -114).
                      const artLine = rowLine(f, quiet, kind, !byDefault(f) && !on);
                      return (
                        <li key={f.row}>
                          <label className="flex items-center gap-2 min-h-8 pointer-coarse:min-h-11 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={stale}
                              onChange={(e) => toggleRow(f.row, e.target.checked)}
                              aria-describedby={artLine ? `${artNoteId}-${f.row}` : undefined}
                              className="w-4 h-4 shrink-0 accent-accent-amber cursor-pointer"
                            />
                            <span
                              aria-hidden
                              className="inline-block w-4 h-4 shrink-0 rounded-[4px] border border-border-strong"
                              style={{ backgroundColor: f.hex }}
                            />
                            {/* On a narrow phone the count does not fit beside
                                the hex: it drops under it whole, never mid-phrase. */}
                            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                              <span className="font-semibold">{f.hex}</span>
                              <span className="whitespace-nowrap text-text-secondary">{rowCount(f)}</span>
                            </span>
                          </label>
                          {artLine && (
                            <p id={`${artNoteId}-${f.row}`} className="pl-6 text-xs text-text-secondary">
                              {artLine}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {hasSelection && (
                <div className={`${SCOPE_TRACK} mt-3`} role="group" aria-label="Frames to clean">
                  <button
                    type="button"
                    aria-pressed={scope === undefined}
                    onClick={() => setScopeMode('all')}
                    className={`${SCOPE_BUTTON} ${scope === undefined ? SCOPE_ON : SCOPE_OFF}`}
                  >
                    All {framesWord(total)}
                  </button>
                  <button
                    type="button"
                    aria-pressed={scope !== undefined}
                    onClick={() => setScopeMode('selected')}
                    className={`${SCOPE_BUTTON} ${scope !== undefined ? SCOPE_ON : SCOPE_OFF}`}
                  >
                    Selected ({selectedHere.length.toLocaleString('en-US')})
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:shrink-0">
              {/* In the quiet strip Clean shows only once a row is checked. */}
              {!quiet && (
                <button
                  ref={cleanButtonRef}
                  type="button"
                  onClick={handleClean}
                  aria-disabled={noneTicked || emptyScope || dim || undefined}
                  aria-describedby={noneTicked ? reasonId : undefined}
                  className={PRIMARY}
                >
                  Clean
                </button>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={showWhere}
                  aria-disabled={stale || undefined}
                  onClick={() => !stale && setShowWhere((on) => !on)}
                  className={`${GHOST} flex-1 sm:flex-none`}
                >
                  Show where
                </button>
                <button
                  type="button"
                  onClick={() => handleDismiss(foundRef.current, 'found')}
                  aria-label="Dismiss"
                  className={ICON_BUTTON}
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
            </div>
          </div>
          {noneTicked && !quiet && <p id={reasonId} className="mt-2 text-xs text-text-secondary">{NONE_TICKED}</p>}
          {note && <p className="mt-2 text-xs text-text-secondary">{note}</p>}
        </section>
      )}
    </>
  );
}
