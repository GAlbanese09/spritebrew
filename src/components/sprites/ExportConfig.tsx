'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Download,
  Check,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { ENGINE_TARGETS } from '@/lib/constants';
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
  resizeFrame,
} from '@/lib/downloadUtils';
import { loadImage } from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

type EngineId = (typeof ENGINE_TARGETS)[number]['id'];

const RPG_DIRECTIONS = ['Down', 'Left', 'Right', 'Up'] as const;

export default function ExportConfig() {
  const animations = useSpriteStore((s) => s.animations);
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);
  const frameDataUrls = useSpriteStore((s) => s.frameDataUrls);

  const [selectedEngine, setSelectedEngine] = useState<EngineId>('texturepacker');
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
  const [exporting, setExporting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const fw = spriteSheet?.frameWidth ?? 32;
  const fh = spriteSheet?.frameHeight ?? 32;

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

    const draw = async () => {
      const effectiveFw = resizeEnabled ? resizeW : fw;
      const effectiveFh = resizeEnabled ? resizeH : fh;

      // Load a few frames for preview (up to 16)
      const previewFrames: HTMLCanvasElement[] = [];
      for (const anim of activeAnimations) {
        for (const frame of anim.frames) {
          if (previewFrames.length >= 16) break;
          const url = frameDataUrls.get(frame.id);
          if (!url) continue;
          const img = await loadImage(url);
          const fc = document.createElement('canvas');
          fc.width = img.naturalWidth;
          fc.height = img.naturalHeight;
          const fctx = fc.getContext('2d')!;
          fctx.imageSmoothingEnabled = false;
          fctx.drawImage(img, 0, 0);
          if (resizeEnabled && (resizeW !== fc.width || resizeH !== fc.height)) {
            previewFrames.push(resizeFrame(fc, resizeW, resizeH));
          } else {
            previewFrames.push(fc);
          }
        }
        if (previewFrames.length >= 16) break;
      }

      if (cancelled || previewFrames.length === 0) return;

      let assembled: HTMLCanvasElement;
      if (selectedEngine === 'gamemaker') {
        assembled = assembleStripSheet(previewFrames);
      } else {
        const cols = Math.ceil(Math.sqrt(previewFrames.length));
        assembled = assembleGridSheet(
          previewFrames,
          cols,
          selectedEngine === 'texturepacker' || selectedEngine === 'aseprite' ? padding : 0,
          powerOfTwo
        );
      }

      // Scale to fit preview area
      const maxW = 400;
      const maxH = 300;
      const scale = Math.min(maxW / assembled.width, maxH / assembled.height, 4);
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
  }, [activeAnimations, frameDataUrls, selectedEngine, padding, powerOfTwo, resizeEnabled, resizeW, resizeH, fw, fh]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setWarnings([]);
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
            directionMap,
          };
          const result = await exportRPGMaker(rpgOpts);
          if (result.warnings.length > 0) setWarnings(result.warnings);
          break;
        }
        case 'godot-tres':
          await exportGodot(baseOpts);
          break;
        case 'raw-frames':
          await exportRawFrames({ ...baseOpts, includeManifest });
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
    spriteSheet, rpgFrameW, rpgFrameH, directionMap, includeManifest,
  ]);

  const engineInfo = ENGINE_TARGETS.find((e) => e.id === selectedEngine)!;

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="amber">{activeAnimations.length} animation{activeAnimations.length !== 1 ? 's' : ''}</Badge>
        <Badge variant="default">{totalFrames} frames</Badge>
        <Badge variant="default">{fw}x{fh} px</Badge>
      </div>

      {/* Engine selector */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Export Format
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ENGINE_TARGETS.map((engine) => {
            const active = selectedEngine === engine.id;
            return (
              <button
                key={engine.id}
                onClick={() => setSelectedEngine(engine.id as EngineId)}
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
                <p className="text-[10px] font-mono text-text-muted leading-relaxed">
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
                  <span className="text-text-muted">({a.frames.length})</span>
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
                onChange={(e) => setResizeW(Math.max(1, Number(e.target.value)))}
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
                onChange={(e) => setResizeH(Math.max(1, Number(e.target.value)))}
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
                  onChange={(e) => setPadding(Math.min(4, Math.max(0, Number(e.target.value))))}
                  className="w-16 rounded bg-bg-elevated border border-border-default px-2 py-1
                    text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-mono text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={powerOfTwo}
                onChange={(e) => setPowerOfTwo(e.target.checked)}
                className="accent-[var(--accent-amber)] cursor-pointer"
              />
              Power-of-two texture
            </label>
            <label className="flex items-center gap-2 text-xs font-mono text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includeMetadata}
                onChange={(e) => setIncludeMetadata(e.target.checked)}
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
                  onChange={(e) => setRpgFrameW(Math.max(1, Number(e.target.value)))}
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
                  onChange={(e) => setRpgFrameH(Math.max(1, Number(e.target.value)))}
                  className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                    text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-mono text-text-muted mb-2">Direction mapping (3x4 grid)</label>
              <div className="space-y-2">
                {RPG_DIRECTIONS.map((dir, idx) => (
                  <div key={dir} className="flex items-center gap-3">
                    <span className="w-12 text-[10px] font-mono text-text-muted">{dir}</span>
                    <select
                      value={directionMap[idx] ?? ''}
                      onChange={(e) => {
                        const next = [...directionMap];
                        next[idx] = e.target.value || null;
                        setDirectionMap(next);
                      }}
                      className="flex-1 max-w-xs rounded bg-bg-elevated border border-border-default px-2 py-1
                        text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber cursor-pointer"
                    >
                      <option value="">— none —</option>
                      {animations.filter((a) => a.frames.length > 0).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[10px] font-mono text-text-muted">
              Output: {rpgFrameW * 3}x{rpgFrameH * 4}px sheet &middot; Filename prefixed with $
            </p>
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
        <div className="rounded-lg border border-border-default bg-bg-elevated p-4 flex justify-center overflow-auto">
          <canvas
            ref={previewCanvasRef}
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

      {/* Success toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-3">
          <CheckCircle size={16} className="text-green-400" />
          <p className="text-xs font-mono text-green-400">Export downloaded successfully!</p>
        </div>
      )}

      {/* Export button */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleExport}
          disabled={exporting || totalFrames === 0}
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
      </div>
    </div>
  );
}
