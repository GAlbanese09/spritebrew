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
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  // Collect all frames across animations
  const allFrames: { anim: SpriteAnimation; frameIdx: number; canvas: HTMLCanvasElement; name: string }[] = [];

  for (const anim of animations) {
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    for (let i = 0; i < canvases.length; i++) {
      const name = `${sanitizeFilename(anim.name)}_${i}`;
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

  // Build frameTags
  const frameTags: unknown[] = [];
  let frameOffset = 0;
  for (const anim of animations) {
    const count = anim.frames.length;
    if (count === 0) continue;
    frameTags.push({
      name: anim.name,
      from: frameOffset,
      to: frameOffset + count - 1,
      direction: 'forward',
    });
    frameOffset += count;
  }

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
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  const allFrames: { anim: SpriteAnimation; frameIdx: number; canvas: HTMLCanvasElement; name: string }[] = [];

  for (const anim of animations) {
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    for (let i = 0; i < canvases.length; i++) {
      const name = `${sanitizeFilename(anim.name)}_${i}`;
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
    const count = anim.frames.length;
    if (count === 0) return;
    frameTags.push({
      name: anim.name,
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

  if (includeMetadata) {
    await downloadAsZip(
      [
        { name: pngFilename, data: pngBlob },
        { name: jsonFilename, data: jsonData },
      ],
      `spritebrew_export_aseprite.zip`
    );
  } else {
    downloadFile(pngBlob, pngFilename);
  }
}

// ─── GameMaker Strip ───

export async function exportGameMaker(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  const files: { name: string; data: Blob }[] = [];

  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    const strip = assembleStripSheet(canvases);
    const blob = await canvasToBlob(strip);
    const name = `${sanitizeFilename(anim.name)}_strip${canvases.length}.png`;
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
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  // Build combined sheet
  const allCanvases: HTMLCanvasElement[] = [];
  const animMeta: { name: string; startIdx: number; count: number; fps: number }[] = [];

  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    animMeta.push({ name: anim.name, startIdx: allCanvases.length, count: canvases.length, fps: anim.fps });
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
    "loop": true,
    "name": "${am.name}",
    "speed": ${am.fps}.0
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
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  const files: { name: string; data: Blob | string }[] = [];
  const manifestAnimations: unknown[] = [];

  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    const animName = sanitizeFilename(anim.name);
    const frameFiles: string[] = [];

    for (let i = 0; i < canvases.length; i++) {
      const filename = `${animName}_${String(i).padStart(2, '0')}.png`;
      const blob = await canvasToBlob(canvases[i]);
      files.push({ name: filename, data: blob });
      frameFiles.push(filename);
    }

    manifestAnimations.push({
      name: anim.name,
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
