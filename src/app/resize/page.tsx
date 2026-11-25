'use client';

// /resize, the free pixel-art resizer (DESIGN design/tickets/editor-tools-batch.md
// v4.1, B2 to B5; DESIGN 2026-11-14-249). No account: the image is read,
// resized and saved in the browser, and never sent anywhere. The engine is
// src/lib/pixelResize.ts; the page's own rules and words are
// src/lib/resizePage.ts.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, ImageUp, Pencil, Upload, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { resizeImage, type PixelImage, type SizeChoice } from '@/lib/pixelResize';
import { detectGridSmart } from '@/lib/resizerGrid';
import {
  RESIZE_ACCEPT,
  RESIZE_WORDS as W,
  caption,
  downloadName,
  fileProblem,
  gridLine,
  otherState,
  readSide,
  pillLabel,
  previewZoom,
  boxSize,
  BOX_PAD,
  sizeRows,
  unitOf,
  cleanSizeLabel,
  wholeCounts,
  wholeGuess,
  fitZoom,
  fitPans,
  FIT_PAD,
  defaultPreviewMode,
  previewLine,
  type PreviewMode,
  type PageGrid,
  gifFrameCount,
  editorPick,
  fitsEditor,
} from '@/lib/resizePage';
import { sendToEditor, takeForResize } from '@/lib/editorResizeHandoff';

interface Loaded {
  name: string;
  image: PixelImage;
  thumb: string;
  /** Frames in a GIF (only the first is read); 0 for anything else. */
  gifFrames: number;
}

/** The size the After shows: a choice from the rows, or Other size. */
interface Target {
  width: number;
  height: number;
  /** null for "as is". */
  key: string | null;
}

const PILL = 'inline-flex items-center justify-center rounded-full border px-3 min-h-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-[13px] font-mono transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';
// A worker that has not answered by then is put down and the page resizes
// by itself (AUDIT resize-page-r1, M1).
const RESIZE_TIME_LIMIT_MS = 15000;
const PILL_ON = 'bg-accent-amber text-bg-primary border-accent-amber';
const PILL_OFF = 'bg-bg-elevated text-text-secondary border-border-default hover:bg-bg-hover hover:text-text-primary';
const CHECKER = {
  backgroundImage:
    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
};

/** Reads a file into pixels: a GIF gives its first frame. */
async function readImage(file: File): Promise<{ image: PixelImage; thumb: string } | 'too-large' | 'unreadable'> {
  let source: CanvasImageSource & { width: number; height: number };
  let close = () => {};
  try {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    close = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      source = Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
    } catch {
      return 'unreadable';
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  try {
    const { width, height } = source;
    if (!width || !height) return 'unreadable';
    if (fileProblem({ type: 'image/png', name: '' }, width, height)) return 'too-large';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'unreadable';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, width, height);
    const thumbCanvas = document.createElement('canvas');
    const scale = Math.min(1, 96 / Math.max(width, height));
    thumbCanvas.width = Math.max(1, Math.round(width * scale));
    thumbCanvas.height = Math.max(1, Math.round(height * scale));
    const tctx = thumbCanvas.getContext('2d');
    if (tctx) {
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    }
    return { image: { width, height, data: data.data }, thumb: thumbCanvas.toDataURL('image/png') };
  } finally {
    close();
  }
}

/** The top-left frame of an image, as its own pixels. */
function frameOne(image: PixelImage, width: number, height: number): PixelImage {
  if (width === image.width && height === image.height) return image;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    out.set(image.data.subarray(y * image.width * 4, (y * image.width + width) * 4), y * width * 4);
  }
  return { width, height, data: out };
}

function paint(canvas: HTMLCanvasElement | null, image: PixelImage | null): void {
  if (!canvas || !image) return;
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
}

export default function ResizePage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [grid, setGrid] = useState<PageGrid | null>(null);
  const [picking, setPicking] = useState(false);
  // The detector found no grid of whole frames: the pickers opened by themselves.
  const [noGuess, setNoGuess] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [other, setOther] = useState<{ width: string; height: string } | null>(null);
  const [result, setResult] = useState<PixelImage | null>(null);
  const [resizing, setResizing] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  // The person's preview choice, kept until another picture is loaded.
  const [previewChoice, setPreviewChoice] = useState<PreviewMode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const otherButtonRef = useRef<HTMLButtonElement>(null);
  const otherFirstRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const warnRef = useRef<HTMLDivElement>(null);
  // Enter was pressed with a side that is not a size: say so even if it is empty.
  const [otherTried, setOtherTried] = useState(false);
  const boxRef = useRef<HTMLElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  const beforeScrollRef = useRef<HTMLDivElement>(null);
  const afterScrollRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  // Resizes waiting on the worker, by their ask: each is told the image,
  // or null to resize on the page.
  const waitingRef = useRef(new Map<number, (image: PixelImage | null) => void>());
  const askRef = useRef(0);
  const readRef = useRef(0);
  const router = useRouter();
  // An image the editor refused, handed over by its "Resize page" link: open
  // it, and pick the largest size the editor opens (external audit SB-06).
  const autoPickRef = useRef(false);
  const [fromEditor, setFromEditor] = useState<{ width: number; height: number } | null>(null);
  const editTooLargeId = useId();

  const unit = useMemo(() => (loaded ? unitOf(loaded.image.width, loaded.image.height, sheet ? grid : null) : null), [loaded, sheet, grid]);
  const rows = useMemo(() => (unit ? sizeRows(unit) : null), [unit]);
  const otherNow = useMemo(() => (unit && other ? otherState(unit, other.width, other.height) : null), [unit, other]);
  // A side typed that is not a size, or left empty when Enter was pressed.
  const otherBad = other ? {
    width: readSide(other.width) === null && (otherTried || other.width.trim() !== ''),
    height: readSide(other.height) === null && (otherTried || other.height.trim() !== ''),
  } : null;
  const shownSheet = sheet && grid !== null;

  // A new file, or a new unit (one image or a sheet, another grid): the
  // After goes back to "as is".
  const resetTarget = useCallback(() => {
    askRef.current += 1;
    setTarget(null);
    setResult(null);
    setResizing(false);
    setOther(null);
  }, []);

  const takeFile = useCallback(async (file: File, handed = false) => {
    const read = (readRef.current += 1);
    autoPickRef.current = false;
    setFromEditor(null);
    const wrong = fileProblem(file);
    if (wrong) {
      // It replaces a read still on its way, so the button comes back
      // (AUDIT resize-page-r1, L6).
      setReading(false);
      setProblem(wrong);
      return;
    }
    setProblem(null);
    setReading(true);
    const out = await readImage(file);
    const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
    const gifFrames = isGif ? gifFrameCount(new Uint8Array(await file.arrayBuffer().catch(() => new ArrayBuffer(0)))) : 0;
    if (read !== readRef.current) return;
    setReading(false);
    if (out === 'too-large') { setProblem(W.tooLarge); return; }
    if (out === 'unreadable') { setProblem(W.unreadable); return; }
    resetTarget();
    setSheet(false);
    setGrid(null);
    setPicking(false);
    setNoGuess(false);
    setLoaded({ name: file.name, image: out.image, thumb: out.thumb, gifFrames });
    setPreviewChoice(null);
    autoPickRef.current = handed;
  }, [resetTarget]);

  useEffect(() => {
    const handed = takeForResize();
    if (handed) void takeFile(handed, true);
  }, [takeFile]);

  // Once a handed image is in, pick the editor's size, as a pill press would.
  useEffect(() => {
    if (!autoPickRef.current || !loaded || !unit || sheet) return;
    autoPickRef.current = false;
    const pick = editorPick(unit);
    if (!pick) return;
    askRef.current += 1;
    setOther(null);
    setResult(null);
    setResizing(true);
    setTarget({ width: pick.width, height: pick.height, key: `${pick.direction}:${pick.factor}` });
    setFromEditor({ width: pick.width, height: pick.height });
  }, [loaded, unit, sheet]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void takeFile(file);
  };

  const chooseSheet = (yes: boolean) => {
    if (!loaded || yes === sheet) return;
    resetTarget();
    setSheet(yes);
    if (!yes) { setPicking(false); return; }
    if (grid) return;
    const { width, height, data } = loaded.image;
    let guess: PageGrid | null = null;
    try {
      const found = detectGridSmart(new ImageData(new Uint8ClampedArray(data), width, height));
      guess = wholeGuess(width, height, found);
    } catch {
      guess = null;
    }
    // No guess whose frames are whole: the picker opens (B3).
    setNoGuess(!guess);
    if (guess) { setGrid(guess); setPicking(false); }
    else { setGrid(null); setPicking(true); }
  };

  const pickGrid = (columns: number, rows: number) => {
    resetTarget();
    setNoGuess(false);
    setGrid(columns === 1 && rows === 1 ? null : { columns, rows });
  };

  // A worker that failed (its script did not load, or it broke) or did not
  // answer in time: it goes, and every resize waiting on it resizes on the
  // page. Its listeners live as long as it does (AUDIT resize-page-r1, M1).
  const dropWorker = useCallback((w: Worker) => {
    if (workerRef.current === w) workerRef.current = null;
    w.terminate();
    const waiting = [...waitingRef.current.values()];
    waitingRef.current.clear();
    waiting.forEach((back) => back(null));
  }, []);
  const startWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    if (typeof Worker === 'undefined') return null;
    let w: Worker;
    try {
      w = new Worker(new URL('../../lib/pixelResize.worker.ts', import.meta.url));
    } catch {
      return null;
    }
    w.addEventListener('message', (event: MessageEvent<{ id: number; ok: boolean; width?: number; height?: number; data?: Uint8ClampedArray }>) => {
      const m = event.data;
      const back = waitingRef.current.get(m.id);
      if (!back) return;
      back(m.ok && m.data && m.width && m.height ? { width: m.width, height: m.height, data: m.data } : null);
    });
    w.addEventListener('error', () => dropWorker(w));
    w.addEventListener('messageerror', () => dropWorker(w));
    workerRef.current = w;
    return w;
  }, [dropWorker]);

  // The resize itself, in a worker where the browser has one; on the page
  // otherwise, after the "Resizing..." line has painted.
  useEffect(() => {
    if (!loaded || !unit || !target) return;
    const ask = (askRef.current += 1);
    const toWidth = target.width * unit.columns;
    const toHeight = target.height * unit.rows;
    const done = (image: PixelImage | null) => {
      if (ask !== askRef.current) return;
      setResult(image);
      setResizing(false);
    };
    const onPage = () => window.setTimeout(() => {
      if (ask !== askRef.current) return;
      try { done(resizeImage(loaded.image, toWidth, toHeight)); } catch { done(null); }
    }, 0);
    const w = startWorker();
    if (!w) { onPage(); return; }
    const waiting = waitingRef.current;
    // The worker's answer, or the page's own resize if the worker fails or
    // has not answered in time; whichever comes first, once.
    let settled = false;
    const back = (image: PixelImage | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      waiting.delete(ask);
      if (image) done(image);
      else onPage();
    };
    const timer = window.setTimeout(() => {
      // A worker that has not answered in time is put down: what waits on
      // it resizes on the page, and the next resize starts a new one.
      dropWorker(w);
      back(null);
    }, RESIZE_TIME_LIMIT_MS);
    waiting.set(ask, back);
    const copy = new Uint8ClampedArray(loaded.image.data);
    w.postMessage({ id: ask, width: loaded.image.width, height: loaded.image.height, data: copy, toWidth, toHeight }, [copy.buffer]);
    return () => {
      settled = true;
      window.clearTimeout(timer);
      waiting.delete(ask);
    };
  }, [loaded, unit, target, startWorker, dropWorker]);

  useEffect(() => {
    const waiting = waitingRef.current;
    return () => {
      workerRef.current?.terminate();
      waiting.clear();
    };
  }, []);

  const choose = (choice: SizeChoice) => {
    if (choice.overCap) return;
    setOther(null);
    if (choice.direction === 'same') { resetTarget(); return; }
    askRef.current += 1;
    setResult(null);
    setResizing(true);
    setTarget({ width: choice.width, height: choice.height, key: `${choice.direction}:${choice.factor}` });
  };

  const applyOther = (width: number, height: number) => {
    if (!unit) return;
    setOther(null);
    // Every way out clears the tried state (AUDIT resize-page-r2, R2-L3).
    setOtherTried(false);
    otherButtonRef.current?.focus();
    if (width === unit.width && height === unit.height) { resetTarget(); return; }
    // A size the rows offer is that pill, however it was reached.
    const offered = rows ? [...rows.down, ...rows.up].find((c) => c.width === width && c.height === height) : undefined;
    askRef.current += 1;
    setResult(null);
    setResizing(true);
    setTarget({ width, height, key: offered ? `${offered.direction}:${offered.factor}` : 'other' });
  };

  // The room Before and After have: a column's width, and at most 408 px
  // tall (264 px on a phone).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: window.innerWidth >= 640 ? 408 : 264 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [loaded]);

  const before = useMemo(() => (loaded && unit ? frameOne(loaded.image, unit.width, unit.height) : null), [loaded, unit]);
  const after = useMemo(() => {
    if (!unit) return null;
    if (!target) return before;
    return result ? frameOne(result, target.width, target.height) : null;
  }, [unit, target, result, before]);
  // The room for a picture: the column less the box's border, and the
  // height less 12 px above and below.
  const inner = { width: box.width - 2, height: box.height - 2 * BOX_PAD };
  const { zoom, pans } = before ? previewZoom(before.width, before.height, inner.width, inner.height) : { zoom: 1, pans: false };
  const boxed = before ? boxSize(before.height, zoom, pans, box.width, box.height) : { width: 0, height: 0 };
  // After's size is the size picked, known before the new After is drawn,
  // so the preview's choice and its zooms hold while it is made (REV
  // resize-phone-preview-rev.md, REV-L1).
  const afterSize = target ? { width: target.width, height: target.height } : before;
  const afterOver = afterSize ? afterSize.width * zoom > inner.width || afterSize.height * zoom > boxed.height - 2 * BOX_PAD : false;
  const afterPans = pans || afterOver;
  // The preview's choice shows whenever Before and After differ in size, or
  // a picture would pan at one zoom (DESIGN design/resize/phone-preview/phone-preview.md, 2eae516d; HQ -236).
  const differ = !!before && !!afterSize && (before.width !== afterSize.width || before.height !== afterSize.height);
  const showChoice = !!before && (differ || pans || afterOver);
  const mode: PreviewMode = showChoice ? previewChoice ?? defaultPreviewMode(pans, afterOver) : 'same';
  // Fit each: boxes as wide as their column and no taller than the room
  // (square on a phone), each picture fitted inside a 4 px margin and the
  // box's border.
  const fitBox = Math.max(0, Math.min(box.width, box.height));
  const fitRoom = { width: box.width - 2 - 2 * FIT_PAD, height: fitBox - 2 - 2 * FIT_PAD };
  const beforeFit = before ? fitZoom(before.width, before.height, fitRoom.width, fitRoom.height) : 1;
  const afterFit = afterSize ? fitZoom(afterSize.width, afterSize.height, fitRoom.width, fitRoom.height) : 1;
  const beforeFitPans = before ? fitPans(before.width, before.height, beforeFit, fitRoom.width, fitRoom.height) : false;
  const afterFitPans = afterSize ? fitPans(afterSize.width, afterSize.height, afterFit, fitRoom.width, fitRoom.height) : false;
  const line = previewLine(shownSheet, mode, zoom, { beforeZoom: beforeFit, afterZoom: afterFit, beforeOver: pans, afterOver });
  const modeRefs = useRef<Record<PreviewMode, HTMLButtonElement | null>>({ fit: null, same: null });
  // Arrow keys move and choose within the two-choice group.
  const onModeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next: PreviewMode = mode === 'fit' ? 'same' : 'fit';
    setPreviewChoice(next);
    modeRefs.current[next]?.focus();
  };

  useLayoutEffect(() => { paint(beforeRef.current, before); }, [before]);
  useLayoutEffect(() => { paint(afterRef.current, after); }, [after]);


  // When the two pan, they pan together.
  const syncing = useRef(false);
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    const fx = from.scrollWidth > from.clientWidth ? from.scrollLeft / (from.scrollWidth - from.clientWidth) : 0;
    const fy = from.scrollHeight > from.clientHeight ? from.scrollTop / (from.scrollHeight - from.clientHeight) : 0;
    to.scrollLeft = fx * (to.scrollWidth - to.clientWidth);
    to.scrollTop = fy * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => { syncing.current = false; });
  };

  // A picture that pans starts at its centre, not its top-left corner; in
  // Same scale the two still pan together.
  useLayoutEffect(() => {
    const beforePan = mode === 'same' ? pans : beforeFitPans;
    const afterPan = mode === 'same' ? afterPans : afterFitPans;
    syncing.current = true;
    for (const [el, pan] of [[beforeScrollRef.current, beforePan], [afterScrollRef.current, afterPan]] as const) {
      if (!el || !pan) continue;
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, [mode, pans, afterPans, beforeFitPans, afterFitPans, zoom, before, after, boxed.width, boxed.height, box.width, fitBox]);

  // Other size: every way out returns the focus to "Other size..."
  // (AUDIT resize-page-r1, M3).
  const closeOther = useCallback(() => {
    setOther(null);
    setOtherTried(false);
    otherButtonRef.current?.focus();
  }, []);
  // Enter applies a clean size; for a size with a warning it moves to the
  // warning's choices; for a side that is not a size it says so.
  const submitOther = () => {
    if (!otherNow) return;
    if (otherNow.kind === 'invalid') { setOtherTried(true); return; }
    if (!otherNow.overCap && otherNow.button && otherNow.width && otherNow.height) { setOtherTried(false); applyOther(otherNow.width, otherNow.height); return; }
    // A warning's first open choice, over the cap or not (AUDIT resize-page-r2, R2-L2).
    warnRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  };
  // Tab and Shift+Tab stay inside the dialog while it is open.
  const keepFocusIn = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const stops = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
    if (stops.length === 0) return;
    const first = stops[0], last = stops[stops.length - 1];
    // Focus on the dialog itself (a click on its text) goes in, not out
    // (AUDIT resize-page-r2, R2-L1).
    if (!stops.includes(document.activeElement as HTMLElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // Other size: focus its first field on open; Escape closes it.
  useEffect(() => {
    if (!other) return;
    otherFirstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOther();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Focus only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other !== null]);

  const save = () => {
    if (!loaded) return;
    const image = target ? result : loaded.image;
    if (!image) return;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName(loaded.name, target ? { width: target.width, height: target.height } : null);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  // "Edit resized image": the image the page would download, if the editor
  // opens it (external audit SB-06). aria-disabled, not disabled, so the
  // button and its reason stay in the Tab order.
  const editImage = loaded ? (target ? result : loaded.image) : null;
  const tooLarge = !!editImage && !fitsEditor(editImage.width, editImage.height);
  const editable = !!editImage && !tooLarge;
  const edit = () => {
    if (!loaded || !editImage || !editable) return;
    const canvas = document.createElement('canvas');
    canvas.width = editImage.width;
    canvas.height = editImage.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(editImage.data), editImage.width, editImage.height), 0, 0);
    sendToEditor({ dataUrl: canvas.toDataURL('image/png'), width: editImage.width, height: editImage.height, name: loaded.name });
    router.push('/editor');
  };

  const pressed = (choice: SizeChoice) => (choice.direction === 'same' ? target === null : target?.key === `${choice.direction}:${choice.factor}`);

  return (
    <div className="max-w-5xl mx-auto">
      <section className="rounded-lg border border-border-default bg-bg-surface p-3 sm:p-6 flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{W.title}</h1>
          <p className="mt-1.5 text-[13px] text-text-secondary">{W.lead}</p>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          className={`rounded-lg border-2 border-dashed p-4 sm:p-6 transition-colors ${dragOver ? 'border-accent-amber bg-accent-amber-glow' : 'border-border-default'}`}
        >
          {loaded ? (
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <div className="h-12 w-12 flex-shrink-0 rounded border border-border-subtle flex items-center justify-center overflow-hidden" style={CHECKER}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={loaded.thumb} alt="" className="max-h-full max-w-full" style={{ imageRendering: 'pixelated' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono text-text-primary truncate">{loaded.name}</p>
                <p className="text-[13px] font-mono text-text-secondary">{`${loaded.image.width} by ${loaded.image.height} px`}</p>
                {fromEditor && (
                  <p className="text-[13px] font-mono text-text-secondary">{W.fromEditor(fromEditor.width, fromEditor.height)}</p>
                )}
                {loaded.gifFrames > 1 && (
                  <p className="text-[13px] font-mono text-accent-amber">{W.gifStill(loaded.gifFrames)}</p>
                )}
              </div>
              <Button variant="secondary" className="w-full sm:w-auto pointer-coarse:min-h-11" onClick={() => inputRef.current?.click()}>
                <Upload size={16} /> {W.another}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <ImageUp size={32} className="text-text-primary" aria-hidden="true" />
              <p className="text-sm font-mono text-text-primary">{W.drop}</p>
              <Button className="w-full sm:w-auto pointer-coarse:min-h-11" onClick={() => inputRef.current?.click()} disabled={reading}>
                <Upload size={16} /> {W.choose}
              </Button>
              <p className="text-[13px] font-mono text-text-secondary">{W.hint}</p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={RESIZE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void takeFile(file);
              e.target.value = '';
            }}
          />
          {problem && (
            <p role="alert" className="mt-3 flex items-center justify-center gap-2 text-[13px] font-mono text-red-400">
              <AlertTriangle size={14} aria-hidden="true" />{problem}
            </p>
          )}
        </div>

        {loaded && unit && rows && (
          <>
            <div className="flex gap-1 rounded-lg bg-bg-secondary p-1" role="group" aria-label={W.what}>
              {([[false, W.oneImage], [true, W.sheet]] as const).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={sheet === value}
                  onClick={() => chooseSheet(value)}
                  className={`flex-1 rounded px-3 min-h-9 pointer-coarse:min-h-11 text-[13px] font-mono transition-colors cursor-pointer ${sheet === value ? 'bg-accent-amber text-bg-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {sheet && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-mono text-text-secondary">
                    {grid ? gridLine(loaded.image.width, loaded.image.height, grid) : ''}
                  </span>
                  {!picking && (
                    <button type="button" onClick={() => setPicking(true)} className="text-[13px] font-mono text-accent-amber underline underline-offset-4 min-h-9 pointer-coarse:min-h-11 cursor-pointer">
                      {W.change}
                    </button>
                  )}
                </div>
                {picking && noGuess && <p className="text-[13px] font-mono text-text-secondary">{W.noGrid}</p>}
                {picking && (
                  <div className="flex flex-wrap gap-3">
                    {(['columns', 'rows'] as const).map((axis) => {
                      const side = axis === 'columns' ? loaded.image.width : loaded.image.height;
                      const value = grid ? grid[axis] : 1;
                      return (
                        <label key={axis} className="flex items-center gap-2 text-[13px] font-mono text-text-secondary">
                          {axis === 'columns' ? W.columns : W.rows}
                          <select
                            value={value}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              pickGrid(axis === 'columns' ? n : grid?.columns ?? 1, axis === 'rows' ? n : grid?.rows ?? 1);
                            }}
                            className="rounded border border-border-default bg-bg-elevated px-2 min-h-9 pointer-coarse:min-h-11 text-text-primary"
                          >
                            {wholeCounts(side).map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <p className="text-xs font-mono uppercase tracking-wider text-text-secondary">{shownSheet ? W.frameSize : W.size}</p>
              <div className="flex flex-wrap gap-2">
                {rows.down.map((choice) => (
                  <button key={`${choice.direction}${choice.factor}`} type="button" aria-pressed={pressed(choice)} onClick={() => choose(choice)} className={`${PILL} ${pressed(choice) ? PILL_ON : PILL_OFF}`}>
                    {pillLabel(choice)}
                  </button>
                ))}
                <button
                  ref={otherButtonRef}
                  type="button"
                  aria-pressed={target?.key === 'other'}
                  aria-haspopup="dialog"
                  onClick={() => { setOtherTried(false); setOther({ width: String(target?.width ?? unit.width), height: String(target?.height ?? unit.height) }); }}
                  className={`${PILL} ${target?.key === 'other' ? PILL_ON : PILL_OFF}`}
                >
                  {W.other}
                </button>
              </div>
              {rows.noSmaller && <p className="text-[13px] font-mono text-text-secondary">{rows.noSmaller}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-mono uppercase tracking-wider text-text-secondary">{W.bigger}</p>
              <div className="flex flex-wrap gap-2">
                {rows.up.map((choice) => (
                  <button key={`${choice.direction}${choice.factor}`} type="button" aria-pressed={pressed(choice)} disabled={choice.overCap} onClick={() => choose(choice)} className={`${PILL} ${pressed(choice) ? PILL_ON : PILL_OFF}`}>
                    {pillLabel(choice)}
                  </button>
                ))}
              </div>
              {rows.overLine && <p className="text-[13px] font-mono text-text-secondary">{rows.overLine}</p>}
            </div>

            {showChoice && (
              <div className="flex flex-col gap-2">
                <p id="resize-preview-label" className="text-xs font-mono uppercase tracking-wider text-text-secondary">{W.previewLabel}</p>
                <div role="radiogroup" aria-labelledby="resize-preview-label" className="flex flex-wrap gap-2" onKeyDown={onModeKey}>
                  {(['fit', 'same'] as const).map((m) => (
                    <button
                      key={m}
                      ref={(el) => { modeRefs.current[m] = el; }}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      tabIndex={mode === m ? 0 : -1}
                      onClick={() => setPreviewChoice(m)}
                      className={`${PILL} ${mode === m ? PILL_ON : PILL_OFF}`}
                    >
                      {m === 'fit' ? W.fitEach : W.sameScale}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {(['before', 'after'] as const).map((which) => {
                const image = which === 'before' ? before : after;
                const scroll = which === 'before' ? beforeScrollRef : afterScrollRef;
                const pan = mode === 'same' ? (which === 'before' ? pans : afterPans) : which === 'before' ? beforeFitPans : afterFitPans;
                const shown = mode === 'fit' ? (which === 'before' ? beforeFit : afterFit) : zoom;
                const size = mode === 'fit' ? { width: box.width, height: fitBox } : boxed;
                return (
                  <figure key={which} ref={which === 'before' ? boxRef : undefined} className="flex flex-col gap-2 min-w-0">
                    <div
                      ref={(el) => { scroll.current = el; }}
                      onScroll={() => (which === 'before' ? follow(beforeScrollRef.current, afterScrollRef.current) : follow(afterScrollRef.current, beforeScrollRef.current))}
                      tabIndex={pan ? 0 : undefined}
                      aria-label={pan ? `${which === 'before' ? W.before : W.after}, scrolls` : undefined}
                      className={`relative max-w-full rounded-lg border border-border-default flex ${pan ? (mode === 'fit' ? 'overflow-auto p-1' : 'overflow-auto p-3') : 'overflow-hidden items-center justify-center'}`}
                      style={{ ...CHECKER, width: size.width, height: size.height }}
                    >
                      {image ? (
                        <canvas
                          ref={which === 'before' ? beforeRef : afterRef}
                          role="img"
                          aria-label={caption(which, shownSheet, image.width, image.height)}
                          // A picture shrunk to fit is smoothed; one shown at a whole zoom stays crisp.
                          // Auto margins in the flex box: a picture smaller than a panning box sits
                          // in its middle, one larger scrolls from its edge (PILOT -031, DESIGN -034).
                          style={{ width: image.width * shown, height: image.height * shown, imageRendering: shown >= 1 ? 'pixelated' : 'auto', flex: 'none', margin: 'auto' }}
                        />
                      ) : (
                        <p role="status" className="text-[13px] font-mono text-text-secondary">{resizing ? W.resizing : ''}</p>
                      )}
                    </div>
                    <figcaption className="text-[13px] font-mono text-text-secondary">
                      {image ? caption(which, shownSheet, image.width, image.height) : `${W.after}`}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            <p className="text-[13px] font-mono text-text-secondary">{line}</p>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                className="w-full sm:w-auto pointer-coarse:min-h-11 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
                onClick={edit}
                aria-disabled={!editable}
                aria-describedby={tooLarge ? editTooLargeId : undefined}
              >
                <Pencil size={16} aria-hidden="true" /> {W.edit}
              </Button>
              <Button className="w-full sm:w-auto pointer-coarse:min-h-11" onClick={save} disabled={target !== null && !result}>
                <Download size={16} /> {W.download}
              </Button>
            </div>
            {tooLarge && (
              <p id={editTooLargeId} className="text-[13px] font-mono text-text-secondary sm:text-right">{W.editTooLarge}</p>
            )}
          </>
        )}
      </section>

      {other && otherNow && unit && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); closeOther(); } }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="other-size-title" tabIndex={-1} onKeyDown={keepFocusIn} className="w-full max-w-md rounded-lg border border-border-default bg-bg-surface p-4 sm:p-6 outline-none">
            <form noValidate onSubmit={(e) => { e.preventDefault(); submitOther(); }} className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 id="other-size-title" className="text-base font-semibold text-text-primary">{W.otherTitle}</h2>
                <Button type="button" variant="ghost" aria-label="Close" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick={closeOther}>
                  <X size={16} />
                </Button>
              </div>
              <div className="flex flex-wrap gap-3">
                {(['width', 'height'] as const).map((side) => {
                  const bad = otherBad?.[side] ?? false;
                  return (
                    <label key={side} className="flex flex-col gap-1 text-[13px] font-mono text-text-secondary">
                      {side === 'width' ? W.width : W.height}
                      <input
                        ref={side === 'width' ? otherFirstRef : undefined}
                        value={other[side]}
                        inputMode="numeric"
                        aria-label={`${side === 'width' ? W.width : W.height} in px`}
                        aria-invalid={bad || undefined}
                        aria-describedby={bad ? 'other-size-error' : undefined}
                        onChange={(e) => setOther({ ...other, [side]: e.target.value })}
                        // Enter acts for every kind of size, not only when the
                        // form has its submit button (AUDIT resize-page-r1, M3).
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitOther(); } }}
                        className="w-28 rounded border border-border-default bg-bg-elevated px-3 min-h-9 pointer-coarse:min-h-11 text-text-primary"
                      />
                    </label>
                  );
                })}
              </div>
              {otherBad && (otherBad.width || otherBad.height) && (
                <p id="other-size-error" className="flex items-center gap-2 text-[13px] font-mono text-red-400">
                  <AlertTriangle size={14} aria-hidden="true" />{W.notASize}
                </p>
              )}
              {/* Each warning is said once as it appears (AUDIT resize-page-r1, M3). */}
              <p role="status" className="sr-only">{otherTried && otherBad && (otherBad.width || otherBad.height) ? W.notASize : [otherNow.line, otherNow.overLine].filter(Boolean).join(' ')}</p>
              {otherNow.line && (
                <div ref={warnRef} className="flex gap-2 rounded border border-accent-amber/40 bg-accent-amber/10 p-3 text-[13px] font-mono text-text-primary">
                  <AlertTriangle size={16} className="flex-shrink-0 text-accent-amber" aria-hidden="true" />
                  <div>
                    <p>{otherNow.line}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {[otherNow.smaller, otherNow.larger].map((choice) => choice && (
                        <Button key={`${choice.width}x${choice.height}`} type="button" variant="secondary" size="sm" className="pointer-coarse:min-h-11" onClick={() => applyOther(choice.width, choice.height)}>
                          {cleanSizeLabel(choice)}
                        </Button>
                      ))}
                      <button
                        type="button"
                        disabled={otherNow.overCap}
                        onClick={() => otherNow.width && otherNow.height && applyOther(otherNow.width, otherNow.height)}
                        className="text-accent-amber underline underline-offset-4 min-h-9 pointer-coarse:min-h-11 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {W.anyway}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {otherNow.overLine && <p className="text-[13px] font-mono text-text-secondary">{otherNow.overLine}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="secondary" className="pointer-coarse:min-h-11" onClick={closeOther}>{W.cancel}</Button>
                {otherNow.button && (
                  <Button type="submit" className="pointer-coarse:min-h-11" disabled={otherNow.overCap}>
                    {otherNow.button}
                  </Button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
