'use client';

import { useState, useMemo, useCallback, useEffect, useRef, useId } from 'react';
import {
  Download,
  Check,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { ENGINE_TARGETS } from '@/lib/constants';
import { ENGINE_PRESETS, nextPresetId, wholeNumberIn, wholePx, type EnginePresetId, type PresetEvent } from '@/lib/exportPresets';
import { useSpriteStore } from '@/stores/spriteStore';
import {
  exportTexturePacker,
  exportAseprite,
  exportGameMaker,
  exportRPGMaker,
  exportGodot,
  exportRawFrames,
  type ExportOptions,
  type RPGMakerOptions,
} from '@/lib/exportEngine';
import {
  assembleGridSheet,
  assembleStripSheet,
  downloadAsZip,
  downloadFile,
  resizeFrame,
  sanitizeFilename,
} from '@/lib/downloadUtils';
import { encodeGif, GIF_SCALES, GIF_SCALE_DEFAULT, type GifScale } from '@/lib/gifExport';
import type { SpriteAnimation } from '@/lib/types';
import { loadImage } from '@/lib/spriteUtils';
import { useContainerWidth } from '@/lib/useCanvasFitScale';
import { RPG_COLS, RPG_ROWS, isRpgCutNote, rpgChoices, rpgCutNote, rpgHasRow, rpgMapInUse, rpgRows } from '@/lib/rpgDirections';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

// The engine targets plus Animated GIF, which lives only on this page.
const TARGETS = [
  ...ENGINE_TARGETS,
  { id: 'animated-gif', label: 'Animated GIF', engines: ['Web', 'Docs'] },
] as const;

type EngineId = (typeof TARGETS)[number]['id'];

/** Loads a group's frames in order (duplicates kept) at w x h, nearest
 *  neighbor. A frame id repeated in the order reuses one canvas. */
async function loadGroupFrames(
  anim: SpriteAnimation,
  frameDataUrls: Map<string, string>,
  w: number,
  h: number
): Promise<HTMLCanvasElement[]> {
  const byId = new Map<string, HTMLCanvasElement>();
  const out: HTMLCanvasElement[] = [];
  for (const frame of anim.frames) {
    let canvas = byId.get(frame.id);
    if (!canvas) {
      const url = frameDataUrls.get(frame.id);
      if (!url) continue;
      const img = await loadImage(url);
      const fc = document.createElement('canvas');
      fc.width = img.naturalWidth;
      fc.height = img.naturalHeight;
      const ctx = fc.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      canvas = fc.width === w && fc.height === h ? fc : resizeFrame(fc, w, h);
      byId.set(frame.id, canvas);
    }
    out.push(canvas);
  }
  return out;
}

/** One GIF per group at the group's fps. One group downloads its GIF; two
 *  or more download a ZIP. Names are unique inside the ZIP. */
async function exportAnimatedGifs(opts: {
  animations: SpriteAnimation[];
  frameDataUrls: Map<string, string>;
  width: number;
  height: number;
  scale: GifScale;
  sheetName: string;
}): Promise<void> {
  const files: { name: string; data: Blob }[] = [];
  const used = new Set<string>();
  for (const anim of opts.animations) {
    const frames = await loadGroupFrames(anim, opts.frameDataUrls, opts.width, opts.height);
    if (frames.length === 0) continue;
    const base = sanitizeFilename(anim.name) || 'animation';
    let name = `${base}.gif`;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}.gif`;
    used.add(name);
    files.push({ name, data: encodeGif(frames, { scale: opts.scale, fps: anim.fps }) });
  }
  if (files.length === 0) throw new Error('No frames to export');
  if (files.length === 1) {
    downloadFile(files[0].data, files[0].name);
  } else {
    await downloadAsZip(files, `${sanitizeFilename(opts.sheetName) || 'spritesheet'}_gifs.zip`);
  }
}

const RPG_DIRECTIONS = ['Down', 'Left', 'Right', 'Up'] as const;

export default function ExportConfig() {
  const animations = useSpriteStore((s) => s.animations);
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);
  const frameDataUrls = useSpriteStore((s) => s.frameDataUrls);

  const [selectedEngine, setSelectedEngine] = useState<EngineId>('texturepacker');
  // The engine preset last picked (exportPresets.ts); cleared when another
  // format is picked by hand.
  const [presetId, setPresetId] = useState<EnginePresetId | null>(null);
  const presetEvent = useCallback((event: PresetEvent) => setPresetId((cur) => nextPresetId(cur, event)), []);
  const [selectedAnims, setSelectedAnims] = useState<Set<string>>(new Set());
  const [padding, setPadding] = useState(1);
  const [powerOfTwo, setPowerOfTwo] = useState(false);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [resizeEnabled, setResizeEnabled] = useState(false);
  const [resizeW, setResizeW] = useState(0);
  const [resizeH, setResizeH] = useState(0);
  const [rpgFrameW, setRpgFrameW] = useState(48);
  const [rpgFrameH, setRpgFrameH] = useState(48);
  const [directionMap, setDirectionMap] = useState<(string | null)[]>([null, null, null, null]);
  const [includeManifest, setIncludeManifest] = useState(true);
  const [gifScale, setGifScale] = useState<GifScale>(GIF_SCALE_DEFAULT);
  const [gifError, setGifError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  // Wave M2: measure the preview wrapper's actual width so mobile-portrait
  // (~270-300px) doesn't paint a 400px preview that then overflows.
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(previewWrapperRef);

  // Whole pixels, as the frame canvases hold them (a size typed on /upload
  // can be fractional; audit r1, finding 2).
  const fw = wholePx(spriteSheet?.frameWidth ?? 32);
  const fh = wholePx(spriteSheet?.frameHeight ?? 32);

  // Initialize resize to current frame size
  useEffect(() => {
    setResizeW(fw);
    setResizeH(fh);
  }, [fw, fh]);

  // Initialize selected animations to all
  useEffect(() => {
    setSelectedAnims(new Set(animations.filter((a) => a.frames.length > 0).map((a) => a.id)));
  }, [animations]);

  // Auto-assign RPG Maker direction map
  useEffect(() => {
    const withFrames = animations.filter((a) => a.frames.length > 0);
    const map: (string | null)[] = [null, null, null, null];
    for (let i = 0; i < Math.min(4, withFrames.length); i++) {
      map[i] = withFrames[i].id;
    }
    setDirectionMap(map);
  }, [animations]);

  const activeAnimations = useMemo(
    () => animations.filter((a) => selectedAnims.has(a.id) && a.frames.length > 0),
    [animations, selectedAnims]
  );

  const totalFrames = useMemo(
    () => activeAnimations.reduce((sum, a) => sum + a.frames.length, 0),
    [activeAnimations]
  );

  // RPG Maker: a direction set to an animation that is no longer checked
  // reads as none, and Download waits for one direction with an animation
  // (external audit SB-02).
  const rpgMap = useMemo(() => rpgMapInUse(directionMap, activeAnimations), [directionMap, activeAnimations]);
  const rpgBlank = selectedEngine === 'rpgmaker' && !rpgHasRow(directionMap, activeAnimations);
  const rpgBlankId = useId();
  // Each direction list is named by its word (AUDIT ext-mediums r1 L10).
  const dirFieldId = useId();
  // A changed map makes the last Download's warnings stale (AUDIT ext-mediums r2 L9).
  useEffect(() => {
    setWarnings([]);
  }, [rpgMap]);

  const toggleAnim = useCallback((id: string) => {
    setSelectedAnims((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Draw preview
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || activeAnimations.length === 0) return;

    let cancelled = false;

    const loadCanvas = async (url: string, w?: number, h?: number) => {
      const img = await loadImage(url);
      const fc = document.createElement('canvas');
      fc.width = img.naturalWidth;
      fc.height = img.naturalHeight;
      const fctx = fc.getContext('2d')!;
      fctx.imageSmoothingEnabled = false;
      fctx.drawImage(img, 0, 0);
      return w && h && (w !== fc.width || h !== fc.height) ? resizeFrame(fc, w, h) : fc;
    };

    const draw = async () => {
      const effectiveFw = resizeEnabled ? resizeW : fw;
      const effectiveFh = resizeEnabled ? resizeH : fh;

      let assembled: HTMLCanvasElement;
      if (selectedEngine === 'rpgmaker') {
        const rows = rpgRows(rpgMap, activeAnimations, (id) => frameDataUrls.has(id));
        // The sheet the download writes: 3 x 4 cells at the RPG frame size,
        // empty rows left empty (external audit SB-07).
        assembled = document.createElement('canvas');
        assembled.width = rpgFrameW * RPG_COLS;
        assembled.height = rpgFrameH * RPG_ROWS;
        const actx = assembled.getContext('2d')!;
        actx.imageSmoothingEnabled = false;
        for (let row = 0; row < RPG_ROWS; row++) {
          const r = rows[row];
          if (!r) continue;
          for (let col = 0; col < RPG_COLS; col++) {
            const cell = await loadCanvas(frameDataUrls.get(r.frameIds[col])!, rpgFrameW, rpgFrameH);
            if (cancelled) return;
            actx.drawImage(cell, col * rpgFrameW, row * rpgFrameH);
          }
        }
      } else {
        // Load a few frames for preview (up to 16)
        const previewFrames: HTMLCanvasElement[] = [];
        for (const anim of activeAnimations) {
          for (const frame of anim.frames) {
            if (previewFrames.length >= 16) break;
            const url = frameDataUrls.get(frame.id);
            if (!url) continue;
            previewFrames.push(await loadCanvas(url, resizeEnabled ? resizeW : undefined, resizeEnabled ? resizeH : undefined));
          }
          if (previewFrames.length >= 16) break;
        }

        if (cancelled || previewFrames.length === 0) return;

        if (selectedEngine === 'gamemaker') {
          assembled = assembleStripSheet(previewFrames);
        } else {
          const cols = Math.ceil(Math.sqrt(previewFrames.length));
          assembled = assembleGridSheet(
            previewFrames,
            cols,
            selectedEngine === 'texturepacker' || selectedEngine === 'aseprite' ? padding : 0,
            powerOfTwo && selectedEngine !== 'animated-gif'
          );
        }
      }

      // Wave M2 / M2.1: preview-area scale. Preserves the legacy max-width
      // (400), max-height (300), and upscale-cap (4) terms; adds a container
      // clamp so mobile-portrait doesn't paint past the wrapper's content
      // width. useContainerWidth is guaranteed non-null (see hook's
      // small-fallback contract), so no null branch is needed.
      const maxW = 400;
      const maxH = 300;
      const effectiveMaxW = Math.min(maxW, containerWidth);
      const scale = Math.min(effectiveMaxW / assembled.width, maxH / assembled.height, 4);
      const dispW = Math.floor(assembled.width * scale);
      const dispH = Math.floor(assembled.height * scale);

      canvas.width = dispW;
      canvas.height = dispH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;

      // Checkerboard bg
      const tileSize = Math.max(4, Math.floor(8 * scale));
      for (let y = 0; y < dispH; y += tileSize) {
        for (let x = 0; x < dispW; x += tileSize) {
          const light = ((x / tileSize + y / tileSize) % 2) === 0;
          ctx.fillStyle = light ? '#2a2725' : '#1e1b18';
          ctx.fillRect(x, y, tileSize, tileSize);
        }
      }

      ctx.drawImage(assembled, 0, 0, dispW, dispH);
    };

    draw();
    return () => { cancelled = true; };
  }, [activeAnimations, frameDataUrls, selectedEngine, padding, powerOfTwo, resizeEnabled, resizeW, resizeH, fw, fh, containerWidth, rpgMap, rpgFrameW, rpgFrameH]);

  const handleExport = useCallback(async () => {
    // Off while RPG Maker has no direction to draw (aria-disabled, so the
    // press does nothing here).
    if (rpgBlank) return;
    setExporting(true);
    setWarnings([]);
    setGifError(null);
    setShowSuccess(false);

    try {
      const baseOpts: ExportOptions = {
        animations: activeAnimations,
        frameDataUrls,
        frameWidth: fw,
        frameHeight: fh,
        padding,
        powerOfTwo,
        resizeWidth: resizeEnabled ? resizeW : undefined,
        resizeHeight: resizeEnabled ? resizeH : undefined,
        includeMetadata,
        sheetName: spriteSheet?.name ?? 'spritesheet',
      };

      switch (selectedEngine) {
        case 'texturepacker':
          await exportTexturePacker(baseOpts);
          break;
        case 'aseprite':
          await exportAseprite(baseOpts);
          break;
        case 'gamemaker':
          await exportGameMaker(baseOpts);
          break;
        case 'rpgmaker': {
          const rpgOpts: RPGMakerOptions = {
            ...baseOpts,
            rpgFrameWidth: rpgFrameW,
            rpgFrameHeight: rpgFrameH,
            directionMap: rpgMap,
          };
          const result = await exportRPGMaker(rpgOpts);
          // The cut line already shows under its direction (AUDIT ext-mediums r2 L9).
          if (result.warnings.length > 0) setWarnings(selectedEngine === 'rpgmaker' ? result.warnings.filter((w) => !isRpgCutNote(w)) : result.warnings);
          break;
        }
        case 'godot-tres':
          await exportGodot(baseOpts);
          break;
        case 'raw-frames':
          await exportRawFrames({ ...baseOpts, includeManifest });
          break;
        case 'animated-gif':
          // Padding, power of two and metadata do not apply; resize does,
          // before the scale.
          try {
            // Encoding is synchronous; yield once so the spinner paints first.
            await new Promise((resolve) => setTimeout(resolve, 0));
            await exportAnimatedGifs({
              animations: activeAnimations,
              frameDataUrls,
              width: resizeEnabled ? resizeW : fw,
              height: resizeEnabled ? resizeH : fh,
              scale: gifScale,
              sheetName: spriteSheet?.name ?? 'spritesheet',
            });
          } catch {
            setGifError('Could not make the GIF. Try a smaller scale.');
            return;
          }
          break;
      }

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } finally {
      setExporting(false);
    }
  }, [
    activeAnimations, frameDataUrls, fw, fh, padding, powerOfTwo,
    resizeEnabled, resizeW, resizeH, includeMetadata, selectedEngine,
    spriteSheet, rpgFrameW, rpgFrameH, rpgMap, includeManifest, gifScale, rpgBlank,
  ]);

  const engineInfo = TARGETS.find((e) => e.id === selectedEngine)!;
  const activePreset = ENGINE_PRESETS.find((p) => p.id === presetId && p.target === selectedEngine) ?? null;

  const pickPreset = (id: EnginePresetId) => {
    const preset = ENGINE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    presetEvent({ type: 'pickPreset', id: preset.id });
    setSelectedEngine(preset.target);
    setPadding(preset.padding);
    setPowerOfTwo(preset.powerOfTwo);
    setIncludeMetadata(preset.includeMetadata);
  };

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="amber">{activeAnimations.length} animation{activeAnimations.length !== 1 ? 's' : ''}</Badge>
        <Badge variant="default">{totalFrames} frames</Badge>
        <Badge variant="default">{fw}x{fh} px</Badge>
      </div>

      {/* Engine presets (W3): one pick per engine sets the format and its settings */}
      <div>
        <label id="engine-preset-label" className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Quick setup: pick your engine
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="engine-preset-label">
          {ENGINE_PRESETS.map((preset) => {
            const active = activePreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => pickPreset(preset.id)}
                aria-pressed={active}
                className={`
                  min-h-11 px-4 py-2 rounded-lg border text-sm font-mono font-semibold transition-colors cursor-pointer
                  ${active
                    ? 'border-accent-amber bg-accent-amber-glow text-accent-amber'
                    : 'border-border-default bg-bg-surface text-text-primary hover:border-border-strong hover:bg-bg-elevated'
                  }
                `}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        {/* One live region, always rendered, so the first pick's note is announced too. */}
        <p
          className={`mt-3 text-[11px] font-mono leading-relaxed max-w-2xl ${activePreset ? 'text-text-secondary' : 'text-text-muted'}`}
          aria-live="polite"
        >
          {activePreset
            ? activePreset.note
            : 'Pick your engine to choose the format and settings for it, or pick a format below.'}
        </p>
      </div>

      {/* Engine selector */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Or pick a format yourself
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TARGETS.map((engine) => {
            const active = selectedEngine === engine.id;
            return (
              <button
                key={engine.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSelectedEngine(engine.id as EngineId);
                  presetEvent({ type: 'pickFormat' });
                }}
                className={`
                  text-left rounded-lg border p-4 transition-all duration-150 cursor-pointer
                  ${active
                    ? 'border-accent-amber bg-accent-amber-glow glow-amber'
                    : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
                  }
                `}
              >
                <div className="flex items-center gap-2 mb-1">
                  <h3 className={`text-sm font-mono font-semibold ${active ? 'text-accent-amber' : 'text-text-primary'}`}>
                    {engine.label}
                  </h3>
                  {active && <Check size={14} className="text-accent-amber" />}
                </div>
                <p className={`text-[10px] font-mono leading-relaxed ${active ? 'text-text-primary' : 'text-text-muted'}`}>
                  {engine.engines.join(', ')}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Animation selection */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Animations to Export
        </label>
        <div className="flex flex-wrap gap-2">
          {animations
            .filter((a) => a.frames.length > 0)
            .map((a) => {
              const checked = selectedAnims.has(a.id);
              return (
                <label
                  key={a.id}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded border text-xs font-mono cursor-pointer transition-colors
                    ${checked
                      ? 'border-accent-amber/40 bg-accent-amber-glow text-accent-amber'
                      : 'border-border-default bg-bg-surface text-text-secondary hover:bg-bg-elevated'
                    }
                  `}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAnim(a.id)}
                    className="accent-[var(--accent-amber)] cursor-pointer"
                  />
                  {a.name}
                  <span className={checked ? 'text-text-primary' : 'text-text-muted'}>({a.frames.length})</span>
                </label>
              );
            })}
        </div>
      </div>

      {/* Format-specific options */}
      <div className="space-y-4">
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider">
          Options
        </label>

        {/* Resize option (all formats) */}
        <label className="flex items-center gap-2 text-xs font-mono text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={resizeEnabled}
            onChange={(e) => setResizeEnabled(e.target.checked)}
            className="accent-[var(--accent-amber)] cursor-pointer"
          />
          Resize frames before export
        </label>
        {resizeEnabled && (
          <div className="flex gap-3 ml-6">
            <div>
              <label className="block text-[10px] font-mono text-text-muted mb-1">Width</label>
              <input
                type="number"
                min={1}
                value={resizeW}
                onChange={(e) => setResizeW(wholeNumberIn(e.target.value, 1))}
                className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-text-muted mb-1">Height</label>
              <input
                type="number"
                min={1}
                value={resizeH}
                onChange={(e) => setResizeH(wholeNumberIn(e.target.value, 1))}
                className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              />
            </div>
          </div>
        )}

        {/* TexturePacker / Aseprite options */}
        {(selectedEngine === 'texturepacker' || selectedEngine === 'aseprite' || selectedEngine === 'godot-tres') && (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-[10px] font-mono text-text-muted mb-1">Padding (px)</label>
                <input
                  type="number"
                  min={0}
                  max={4}
                  value={padding}
                  onChange={(e) => {
                    setPadding(wholeNumberIn(e.target.value, 0, 4));
                    presetEvent({ type: 'changeSetting' });
                  }}
                  className="w-16 rounded bg-bg-elevated border border-border-default px-2 py-1
                    text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-mono text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={powerOfTwo}
                onChange={(e) => {
                  setPowerOfTwo(e.target.checked);
                  presetEvent({ type: 'changeSetting' });
                }}
                className="accent-[var(--accent-amber)] cursor-pointer"
              />
              Power-of-two texture
            </label>
            <label className="flex items-center gap-2 text-xs font-mono text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includeMetadata}
                onChange={(e) => {
                  setIncludeMetadata(e.target.checked);
                  presetEvent({ type: 'changeSetting' });
                }}
                className="accent-[var(--accent-amber)] cursor-pointer"
              />
              Include metadata ({selectedEngine === 'godot-tres' ? '.tres' : '.json'})
            </label>
          </div>
        )}

        {/* RPG Maker options */}
        {selectedEngine === 'rpgmaker' && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <div>
                <label className="block text-[10px] font-mono text-text-muted mb-1">Frame width</label>
                <input
                  type="number"
                  min={1}
                  value={rpgFrameW}
                  onChange={(e) => setRpgFrameW(wholeNumberIn(e.target.value, 1))}
                  className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                    text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-text-muted mb-1">Frame height</label>
                <input
                  type="number"
                  min={1}
                  value={rpgFrameH}
                  onChange={(e) => setRpgFrameH(wholeNumberIn(e.target.value, 1))}
                  className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                    text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-mono text-text-muted mb-2">Direction mapping (3x4 grid)</label>
              <div className="space-y-2">
                {RPG_DIRECTIONS.map((dir, idx) => {
                  // An animation longer than a row says so under its direction,
                  // before the download (AUDIT ext-mediums r1 L9).
                  const mapped = activeAnimations.find((a) => a.id === rpgMap[idx]);
                  const cut = mapped ? rpgCutNote(mapped.name, mapped.frames.filter((f) => frameDataUrls.has(f.id)).length) : null;
                  return (
                  <div key={dir}>
                  <div className="flex items-center gap-3">
                    <label htmlFor={`${dirFieldId}-${idx}`} className="w-12 text-[10px] font-mono text-text-muted">{dir}</label>
                    <select
                      id={`${dirFieldId}-${idx}`}
                      value={rpgMap[idx] ?? ''}
                      onChange={(e) => {
                        const next = [...rpgMap];
                        next[idx] = e.target.value || null;
                        setDirectionMap(next);
                      }}
                      className="flex-1 min-w-0 max-w-xs rounded bg-bg-elevated border border-border-default px-2 py-1
                        text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber cursor-pointer"
                    >
                      <option value="">(none)</option>
                      {rpgChoices(activeAnimations).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  {cut && (
                    <p className="mt-1 ml-15 text-xs font-mono text-accent-amber">{cut}</p>
                  )}
                  </div>
                  );
                })}
              </div>
            </div>
            <p className="text-[10px] font-mono text-text-muted">
              Output: {rpgFrameW * 3}x{rpgFrameH * 4}px sheet &middot; Filename prefixed with $
            </p>
          </div>
        )}

        {/* Animated GIF options */}
        {selectedEngine === 'animated-gif' && (
          <div className="flex items-center gap-2" role="group" aria-label="GIF scale">
            <span className="text-[10px] font-mono text-text-muted">GIF scale</span>
            {GIF_SCALES.map((s) => (
              <button
                key={s}
                onClick={() => setGifScale(s)}
                aria-pressed={gifScale === s}
                className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
                  ${gifScale === s
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {s}x
              </button>
            ))}
          </div>
        )}

        {/* Raw frames options */}
        {selectedEngine === 'raw-frames' && (
          <label className="flex items-center gap-2 text-xs font-mono text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={includeManifest}
              onChange={(e) => setIncludeManifest(e.target.checked)}
              className="accent-[var(--accent-amber)] cursor-pointer"
            />
            Include manifest.json
          </label>
        )}
      </div>

      {/* Preview */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Preview
        </label>
        <div
          ref={previewWrapperRef}
          className="rounded-lg border border-border-default bg-bg-elevated p-4 flex justify-center overflow-auto"
        >
          <canvas
            ref={previewCanvasRef}
            className="pixel-art-render"
            style={{ imageRendering: 'pixelated', display: 'block' }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10px] font-mono text-text-muted">
            Format: {engineInfo.label}
          </p>
          <p className="text-[10px] font-mono text-text-muted">
            {totalFrames} frame{totalFrames !== 1 ? 's' : ''} across {activeAnimations.length} animation{activeAnimations.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs font-mono text-amber-400">{w}</p>
          ))}
        </div>
      )}

      {/* GIF error */}
      {gifError && selectedEngine === 'animated-gif' && (
        <p className="text-xs font-mono text-red-400" role="alert">{gifError}</p>
      )}

      {/* Success toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-3">
          <CheckCircle size={16} className="text-green-400" />
          <p className="text-xs font-mono text-green-400">Export downloaded successfully!</p>
        </div>
      )}

      {/* Export button; while RPG Maker has no direction to draw, the line
          under it says why it is off (DESIGN 2026-11-25-042). */}
      <div className="flex flex-col items-end gap-2">
        <Button
          size="lg"
          onClick={handleExport}
          disabled={exporting || totalFrames === 0}
          aria-disabled={rpgBlank || undefined}
          aria-describedby={rpgBlank ? rpgBlankId : undefined}
          className="aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
        >
          {exporting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Download size={16} />
              Download Export
            </>
          )}
        </Button>
        {rpgBlank && (
          <p id={rpgBlankId} className="text-xs font-mono text-accent-amber text-right">
            Set at least one direction under Direction mapping to a checked animation to download the sheet.
          </p>
        )}
      </div>
    </div>
  );
}
