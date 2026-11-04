import type { SpriteAnimation } from '@/lib/types';
import {
  assembleGridSheet,
  assembleStripSheet,
  canvasToBlob,
  downloadFile,
  downloadAsZip,
  resizeFrame,
  sanitizeFilename,
} from '@/lib/downloadUtils';
import { loadImage } from '@/lib/spriteUtils';
import { exportNames } from '@/lib/exportNames';
import { godotFloat, godotString, tagRanges, wholePx } from '@/lib/exportPresets';
import { asepriteDocumentFrom, encodeAseprite, type AseAnimationInput } from '@/lib/asepriteWriter';

export interface ExportOptions {
  animations: SpriteAnimation[];
  frameDataUrls: Map<string, string>;
  frameWidth: number;
  frameHeight: number;
  padding: number;
  powerOfTwo: boolean;
  resizeWidth?: number;
  resizeHeight?: number;
  includeMetadata: boolean;
  sheetName: string;
}

// ─── Helpers ───

async function loadFrameCanvases(
  frames: SpriteAnimation['frames'],
  frameDataUrls: Map<string, string>,
  resizeW?: number,
  resizeH?: number
): Promise<HTMLCanvasElement[]> {
  const canvases: HTMLCanvasElement[] = [];
  for (const frame of frames) {
    const url = frameDataUrls.get(frame.id);
    if (!url) continue;
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    if (resizeW && resizeH && (resizeW !== canvas.width || resizeH !== canvas.height)) {
      canvases.push(resizeFrame(canvas, resizeW, resizeH));
    } else {
      canvases.push(canvas);
    }
  }
  return canvases;
}

function optimalColumns(totalFrames: number): number {
  // Try to make roughly square sheets
  const sqrt = Math.ceil(Math.sqrt(totalFrames));
  return Math.min(sqrt, totalFrames);
}

// ─── TexturePacker JSON Hash ───

export async function exportTexturePacker(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls, padding, powerOfTwo, includeMetadata, sheetName } = opts;
  const fw = wholePx(opts.resizeWidth ?? opts.frameWidth);
  const fh = wholePx(opts.resizeHeight ?? opts.frameHeight);

  // Collect all frames across animations. Group names are made unique per
  // export (exportNames) so same-named groups keep separate frame keys.
  const names = exportNames(animations.map((a) => a.name), (i) => animations[i].frames.length === 0);
  const allFrames: { anim: SpriteAnimation; frameIdx: number; canvas: HTMLCanvasElement; name: string }[] = [];

  for (const [animIdx, anim] of animations.entries()) {
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    for (let i = 0; i < canvases.length; i++) {
      const name = `${names[animIdx].file}_${i}`;
      allFrames.push({ anim, frameIdx: i, canvas: canvases[i], name });
    }
  }

  if (allFrames.length === 0) return;

  const columns = optimalColumns(allFrames.length);
  const sheet = assembleGridSheet(
    allFrames.map((f) => f.canvas),
    columns,
    padding,
    powerOfTwo
  );

  const pngFilename = `${sanitizeFilename(sheetName)}.png`;
  const jsonFilename = `${sanitizeFilename(sheetName)}.json`;

  // Build JSON Hash
  const framesObj: Record<string, unknown> = {};
  for (let i = 0; i < allFrames.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * (fw + padding);
    const y = row * (fh + padding);

    framesObj[`${allFrames[i].name}.png`] = {
      frame: { x, y, w: fw, h: fh },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
    };
  }

  // Build frameTags from the frames actually on the sheet: a frame with no
  // image is skipped by loadFrameCanvases, so counting anim.frames would
  // shift every later tag (BUILD-2's audit, HQ 2026-11-04-004).
  const written = animations.map((anim) => allFrames.filter((f) => f.anim === anim).length);
  const frameTags: unknown[] = tagRanges(written).map((t) => ({
    name: names[t.index].label,
    from: t.from,
    to: t.to,
    direction: 'forward',
  }));

  const meta = {
    app: 'SpriteBrew',
    version: '1.0',
    image: pngFilename,
    format: 'RGBA8888',
    size: { w: sheet.width, h: sheet.height },
    scale: '1',
    frameTags,
  };

  const jsonData = JSON.stringify({ frames: framesObj, meta }, null, 2);
  const pngBlob = await canvasToBlob(sheet);

  if (includeMetadata) {
    await downloadAsZip(
      [
        { name: pngFilename, data: pngBlob },
        { name: jsonFilename, data: jsonData },
      ],
      `spritebrew_export_texturepacker.zip`
    );
  } else {
    downloadFile(pngBlob, pngFilename);
  }
}

// ─── Aseprite JSON ───

export async function exportAseprite(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls, padding, powerOfTwo, includeMetadata, sheetName } = opts;
  const fw = wholePx(opts.resizeWidth ?? opts.frameWidth);
  const fh = wholePx(opts.resizeHeight ?? opts.frameHeight);

  const names = exportNames(animations.map((a) => a.name), (i) => animations[i].frames.length === 0);
  const allFrames: { anim: SpriteAnimation; frameIdx: number; canvas: HTMLCanvasElement; name: string }[] = [];

  for (const [animIdx, anim] of animations.entries()) {
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    for (let i = 0; i < canvases.length; i++) {
      const name = `${names[animIdx].file}_${i}`;
      allFrames.push({ anim, frameIdx: i, canvas: canvases[i], name });
    }
  }

  if (allFrames.length === 0) return;

  const columns = optimalColumns(allFrames.length);
  const sheet = assembleGridSheet(
    allFrames.map((f) => f.canvas),
    columns,
    padding,
    powerOfTwo
  );

  const pngFilename = `${sanitizeFilename(sheetName)}.png`;
  const jsonFilename = `${sanitizeFilename(sheetName)}.json`;

  // Build Aseprite frames array
  const framesArr = allFrames.map((f, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * (fw + padding);
    const y = row * (fh + padding);
    const duration = Math.round(1000 / f.anim.fps);

    return {
      filename: `${f.name}.png`,
      frame: { x, y, w: fw, h: fh },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
      duration,
    };
  });

  // Build frameTags
  const frameTags: unknown[] = [];
  const tagColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#88ff00'];
  let frameOffset = 0;
  animations.forEach((anim, idx) => {
    // The frames actually on the sheet: a frame with no image is skipped by
    // loadFrameCanvases, so counting anim.frames would run past the sheet
    // (and disagree with the .aseprite file's tags).
    const count = allFrames.filter((f) => f.anim === anim).length;
    if (count === 0) return;
    frameTags.push({
      name: names[idx].label,
      from: frameOffset,
      to: frameOffset + count - 1,
      direction: 'forward',
      color: tagColors[idx % tagColors.length],
    });
    frameOffset += count;
  });

  const meta = {
    app: 'SpriteBrew',
    version: '1.0',
    image: pngFilename,
    format: 'RGBA8888',
    size: { w: sheet.width, h: sheet.height },
    scale: '1',
    frameTags,
    layers: [{ name: 'Layer 1', opacity: 255, blendMode: 'normal' }],
  };

  const jsonData = JSON.stringify({ frames: framesArr, meta }, null, 2);
  const pngBlob = await canvasToBlob(sheet);

  // The .aseprite file itself (W2; HQ 2026-11-03-021): one layer, each frame
  // with the duration playback shows, one tag per animation, from the same
  // frames the sheet uses. A failure here never costs the PNG and JSON.
  const files: { name: string; data: Blob | string }[] = [{ name: pngFilename, data: pngBlob }];
  if (includeMetadata) files.push({ name: jsonFilename, data: jsonData });
  try {
    // Whole pixels, as a canvas holds them: a typed 32.5 makes 32 px frames.
    const aw = Math.max(1, Math.floor(fw));
    const ah = Math.max(1, Math.floor(fh));
    const aseBytes = await encodeAseprite(asepriteDocumentFrom(asepriteInputs(allFrames, animations, names, aw, ah), aw, ah));
    files.push({ name: `${sanitizeFilename(sheetName)}.aseprite`, data: new Blob([aseBytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }) });
  } catch (err) {
    console.warn('[exportAseprite] .aseprite file skipped:', err);
  }

  if (files.length > 1) {
    await downloadAsZip(files, `spritebrew_export_aseprite.zip`);
  } else {
    downloadFile(pngBlob, pngFilename);
  }
}

/** Groups the exported frames by animation for the .aseprite file, each
 *  frame as fw x fh RGBA (a frame of another size is drawn at the top left
 *  of an fw x fh canvas, as the sheet would hold it). */
function asepriteInputs(
  allFrames: { anim: SpriteAnimation; canvas: HTMLCanvasElement }[],
  animations: SpriteAnimation[],
  names: { label: string }[],
  fw: number,
  fh: number
): AseAnimationInput[] {
  const colors: [number, number, number][] = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 136, 0], [136, 255, 0],
  ];
  return animations.map((anim, idx) => ({
    name: names[idx].label,
    fps: anim.fps,
    loop: anim.loop,
    color: colors[idx % colors.length],
    frames: allFrames
      .filter((f) => f.anim === anim)
      .map(({ canvas }) => {
        let c = canvas;
        if (c.width !== fw || c.height !== fh) {
          c = document.createElement('canvas');
          c.width = fw;
          c.height = fh;
          const ctx = c.getContext('2d')!;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(canvas, 0, 0);
        }
        return c.getContext('2d')!.getImageData(0, 0, fw, fh).data;
      }),
  }));
}

// ─── GameMaker Strip ───

export async function exportGameMaker(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls } = opts;
  const fw = wholePx(opts.resizeWidth ?? opts.frameWidth);
  const fh = wholePx(opts.resizeHeight ?? opts.frameHeight);

  const files: { name: string; data: Blob }[] = [];
  const names = exportNames(animations.map((a) => a.name), (i) => animations[i].frames.length === 0);

  for (const [animIdx, anim] of animations.entries()) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    const strip = assembleStripSheet(canvases);
    const blob = await canvasToBlob(strip);
    const name = `${names[animIdx].file}_strip${canvases.length}.png`;
    files.push({ name, data: blob });
  }

  if (files.length === 0) return;

  if (files.length === 1) {
    downloadFile(files[0].data, files[0].name);
  } else {
    await downloadAsZip(files, 'spritebrew_export_gamemaker.zip');
  }
}

// ─── RPG Maker MV/MZ ───

export interface RPGMakerOptions extends ExportOptions {
  rpgFrameWidth: number;
  rpgFrameHeight: number;
  /** Maps row index (0-3) to animation ID. Rows: 0=Down,1=Left,2=Right,3=Up */
  directionMap: (string | null)[];
}

export async function exportRPGMaker(opts: RPGMakerOptions): Promise<{ warnings: string[] }> {
  const { animations, frameDataUrls, rpgFrameWidth, rpgFrameHeight, directionMap, sheetName } = opts;
  const warnings: string[] = [];

  const COLS = 3;
  const ROWS = 4;

  const canvas = document.createElement('canvas');
  canvas.width = rpgFrameWidth * COLS;
  canvas.height = rpgFrameHeight * ROWS;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let row = 0; row < ROWS; row++) {
    const animId = directionMap[row];
    const anim = animId ? animations.find((a) => a.id === animId) : null;

    if (!anim || anim.frames.length === 0) {
      // Leave row blank
      continue;
    }

    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, rpgFrameWidth, rpgFrameHeight);

    if (canvases.length > COLS) {
      warnings.push(`"${anim.name}" has ${canvases.length} frames but RPG Maker uses 3 per direction. Extra frames ignored.`);
    }

    for (let col = 0; col < COLS; col++) {
      // Repeat/pad frames to fill 3 columns
      const frameCanvas = canvases[col % canvases.length];
      ctx.drawImage(frameCanvas, col * rpgFrameWidth, row * rpgFrameHeight);
    }
  }

  const filename = `$${sanitizeFilename(sheetName)}.png`;
  const blob = await canvasToBlob(canvas);
  downloadFile(blob, filename);

  return { warnings };
}

// ─── Godot SpriteFrames (.tres) ───

export async function exportGodot(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls, padding, powerOfTwo, includeMetadata, sheetName } = opts;
  const fw = wholePx(opts.resizeWidth ?? opts.frameWidth);
  const fh = wholePx(opts.resizeHeight ?? opts.frameHeight);

  // Build combined sheet
  const allCanvases: HTMLCanvasElement[] = [];
  const animMeta: { name: string; startIdx: number; count: number; fps: number; loop: boolean }[] = [];
  // SpriteFrames animation names must be unique.
  const names = exportNames(animations.map((a) => a.name), (i) => animations[i].frames.length === 0);

  for (const [animIdx, anim] of animations.entries()) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    animMeta.push({ name: names[animIdx].label, startIdx: allCanvases.length, count: canvases.length, fps: anim.fps, loop: anim.loop !== false });
    allCanvases.push(...canvases);
  }

  if (allCanvases.length === 0) return;

  const columns = optimalColumns(allCanvases.length);
  const sheet = assembleGridSheet(allCanvases, columns, padding, powerOfTwo);

  const pngFilename = `${sanitizeFilename(sheetName)}.png`;
  const tresFilename = `${sanitizeFilename(sheetName)}.tres`;

  // Build .tres
  const animEntries = animMeta.map((am) => {
    const frameEntries: string[] = [];
    for (let i = 0; i < am.count; i++) {
      const globalIdx = am.startIdx + i;
      const col = globalIdx % columns;
      const row = Math.floor(globalIdx / columns);
      const x = col * (fw + padding);
      const y = row * (fh + padding);
      frameEntries.push(
        `{
      "duration": 1.0,
      "texture": SubResource("atlas_${globalIdx}")
    }`
      );
      // We'll need to define atlas sub-resources
      void x; void y;
    }

    return `{
    "frames": [${frameEntries.join(', ')}],
    "loop": ${am.loop},
    "name": "${godotString(am.name)}",
    "speed": ${godotFloat(am.fps)}
  }`;
  });

  // Build atlas sub-resources
  const subResources: string[] = [];
  for (let i = 0; i < allCanvases.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * (fw + padding);
    const y = row * (fh + padding);
    subResources.push(
      `[sub_resource type="AtlasTexture" id="atlas_${i}"]
atlas = ExtResource("1")
region = Rect2(${x}, ${y}, ${fw}, ${fh})`
    );
  }

  const tres = `[gd_resource type="SpriteFrames" load_steps=${allCanvases.length + 2} format=3]

[ext_resource type="Texture2D" path="res://${pngFilename}" id="1"]

${subResources.join('\n\n')}

[resource]
animations = [${animEntries.join(', ')}]
`;

  const pngBlob = await canvasToBlob(sheet);

  if (includeMetadata) {
    await downloadAsZip(
      [
        { name: pngFilename, data: pngBlob },
        { name: tresFilename, data: tres },
      ],
      'spritebrew_export_godot.zip'
    );
  } else {
    downloadFile(pngBlob, pngFilename);
  }
}

// ─── Raw Individual Frames ───

export async function exportRawFrames(opts: ExportOptions & { includeManifest: boolean }): Promise<void> {
  const { animations, frameDataUrls, includeManifest } = opts;
  const fw = wholePx(opts.resizeWidth ?? opts.frameWidth);
  const fh = wholePx(opts.resizeHeight ?? opts.frameHeight);

  const files: { name: string; data: Blob | string }[] = [];
  const manifestAnimations: unknown[] = [];
  const names = exportNames(animations.map((a) => a.name), (i) => animations[i].frames.length === 0);

  for (const [animIdx, anim] of animations.entries()) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    const animName = names[animIdx].file;
    const frameFiles: string[] = [];

    for (let i = 0; i < canvases.length; i++) {
      const filename = `${animName}_${String(i).padStart(2, '0')}.png`;
      const blob = await canvasToBlob(canvases[i]);
      files.push({ name: filename, data: blob });
      frameFiles.push(filename);
    }

    manifestAnimations.push({
      name: names[animIdx].label,
      type: anim.type,
      fps: anim.fps,
      loop: anim.loop,
      frameCount: canvases.length,
      files: frameFiles,
    });
  }

  if (files.length === 0) return;

  if (includeManifest) {
    const manifest = JSON.stringify(
      {
        generator: 'SpriteBrew',
        version: '1.0',
        frameSize: { width: fw, height: fh },
        animations: manifestAnimations,
      },
      null,
      2
    );
    files.push({ name: 'manifest.json', data: manifest });
  }

  await downloadAsZip(files, 'spritebrew_export_raw_frames.zip');
}
