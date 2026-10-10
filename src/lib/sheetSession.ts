/**
 * sheetSession: the Sheet Tools session (/upload, /preview, /export) kept on
 * this device so a reload does not lose it.
 *
 * Modelled on editorRecovery's IndexedDbDraftStore, but deliberately separate:
 * its own database, one store, one record per browser. The record holds the
 * sheet's bytes as a Blob (the store's sourceImage is often a blob URL, which
 * dies with the page), the slice config, the frames, every frame's data URL
 * and the user's groups.
 *
 * Errors never reach the user. A failed save logs once and turns saving off
 * for the rest of the page session; PR 6's beforeunload guard still covers
 * the work. Reads that fail behave as "nothing saved".
 *
 * The codec (serializeSheetSession / deserializeSheetSession) is pure so it
 * can be tested in node without IndexedDB.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { SlicerHints } from '@/lib/generationHistory';
import type { SpriteAnimation, SpriteFrame, SpriteSheet } from '@/lib/types';

const DB_NAME = 'spritebrew-sheet-session';
const DB_VERSION = 1;
const STORE = 'session' as const;
/** One session per browser: every save overwrites this key. */
const KEY = 'current';

// ── Codec ───────────────────────────────────────────────────────────────────

/** The slice of the sprite store that makes up a Sheet Tools session. */
export interface SheetSessionState {
  spriteSheet: SpriteSheet;
  animations: SpriteAnimation[];
  frameDataUrls: Map<string, string>;
  currentSheetMetadata: SlicerHints | null;
  generationStyle: string | null;
}

/** A frame as stored: everything but imageData (always null in Sheet Tools). */
type StoredFrame = Omit<SpriteFrame, 'imageData'>;
type StoredAnimation = Omit<SpriteAnimation, 'frames'> & { frames: StoredFrame[] };

export interface SheetSessionRecordV1 {
  schema: 'spritebrew.sheet-session';
  version: 1;
  savedAt: number;
  /** The sheet image itself. Never a URL. */
  sheetBytes: Blob;
  /** The sheet minus sourceImage: id, name, the slice config (frame size,
   *  columns, rows, padding) and the full frame list. */
  sheet: Omit<SpriteSheet, 'sourceImage' | 'animations'> & { animations: StoredAnimation[] };
  /** The user's groups, in order, duplicates included. */
  groups: StoredAnimation[];
  /** frameDataUrls as [frameId, data URL] pairs, in Map order. */
  frameData: [string, string][];
  sheetMetadata: SlicerHints | null;
  generationStyle: string | null;
}

const storeFrame = (f: SpriteFrame): StoredFrame => ({
  id: f.id, x: f.x, y: f.y, width: f.width, height: f.height, duration: f.duration,
});
const storeAnimation = (a: SpriteAnimation): StoredAnimation => ({
  id: a.id, name: a.name, type: a.type, fps: a.fps, loop: a.loop, frames: a.frames.map(storeFrame),
});
const loadFrame = (f: StoredFrame): SpriteFrame => ({ ...f, imageData: null });
const loadAnimation = (a: StoredAnimation): SpriteAnimation => ({ ...a, frames: a.frames.map(loadFrame) });

/** Pure: store state plus the sheet's bytes to a record IndexedDB can hold. */
export function serializeSheetSession(
  state: SheetSessionState,
  sheetBytes: Blob,
  savedAt: number,
): SheetSessionRecordV1 {
  const { spriteSheet: s } = state;
  return {
    schema: 'spritebrew.sheet-session',
    version: 1,
    savedAt,
    sheetBytes,
    sheet: {
      id: s.id,
      name: s.name,
      frameWidth: s.frameWidth,
      frameHeight: s.frameHeight,
      columns: s.columns,
      rows: s.rows,
      totalFrames: s.totalFrames,
      padding: s.padding,
      animations: s.animations.map(storeAnimation),
    },
    groups: state.animations.map(storeAnimation),
    frameData: Array.from(state.frameDataUrls.entries()),
    sheetMetadata: state.currentSheetMetadata ? { ...state.currentSheetMetadata } : null,
    generationStyle: state.generationStyle,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Pure: a stored record back to store state, with `sourceImage` as the
 *  sheet's new URL. Null when the record is missing or not this schema. */
export function deserializeSheetSession(
  record: unknown,
  sourceImage: string,
): SheetSessionState | null {
  if (!isObj(record)) return null;
  if (record.schema !== 'spritebrew.sheet-session' || record.version !== 1) return null;
  const { sheet, groups, frameData } = record;
  if (!isObj(sheet) || !Array.isArray(sheet.animations)) return null;
  if (!Array.isArray(groups) || !Array.isArray(frameData)) return null;
  const r = record as unknown as SheetSessionRecordV1;
  return {
    spriteSheet: {
      id: r.sheet.id,
      name: r.sheet.name,
      sourceImage,
      frameWidth: r.sheet.frameWidth,
      frameHeight: r.sheet.frameHeight,
      columns: r.sheet.columns,
      rows: r.sheet.rows,
      totalFrames: r.sheet.totalFrames,
      animations: r.sheet.animations.map(loadAnimation),
      padding: r.sheet.padding,
    },
    animations: r.groups.map(loadAnimation),
    frameDataUrls: new Map(r.frameData),
    currentSheetMetadata: r.sheetMetadata ? { ...r.sheetMetadata } : null,
    generationStyle: r.generationStyle ?? null,
  };
}

// ── IndexedDB ───────────────────────────────────────────────────────────────

interface SheetSessionDbV1 extends DBSchema {
  session: { key: string; value: SheetSessionRecordV1 };
}

let dbPromise: Promise<IDBPDatabase<SheetSessionDbV1>> | null = null;

/** Same lazy, self-evicting connection as IndexedDbDraftStore.getDb. */
function getDb(): Promise<IDBPDatabase<SheetSessionDbV1>> {
  if (!dbPromise) {
    const p = openDB<SheetSessionDbV1>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
      terminated: () => { if (dbPromise === p) dbPromise = null; },
    });
    p.catch(() => { if (dbPromise === p) dbPromise = null; });
    dbPromise = p;
  }
  return dbPromise;
}

const available = () => typeof indexedDB !== 'undefined';

/** Set by the first failed save; no more saves for this page session. */
let savingOff = false;
/** Bumped by every clear, so a save prepared before it never lands after it. */
let epoch = 0;
/** All writes run in call order, so a clear is never overtaken by a save. */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const next = chain.then(op, op);
  chain = next.catch(() => undefined);
  return next;
}

/** Any URL the page holds (blob: or data:) to a data URL that survives a reload. */
async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** True while saves are still on for this page session. */
export function isSheetSessionSaving(): boolean {
  return available() && !savingOff;
}

/** Save the session. Never throws: a failure logs and turns saving off. */
export async function saveSheetSession(state: SheetSessionState): Promise<void> {
  if (!isSheetSessionSaving()) return;
  const startEpoch = epoch;
  try {
    const sheetBytes = await (await fetch(state.spriteSheet.sourceImage)).blob();
    const frameData = new Map<string, string>();
    for (const [id, url] of state.frameDataUrls) frameData.set(id, await toDataUrl(url));
    const record = serializeSheetSession({ ...state, frameDataUrls: frameData }, sheetBytes, Date.now());
    await enqueue(async () => {
      if (epoch !== startEpoch) return;
      const db = await getDb();
      await db.put(STORE, record, KEY);
    });
  } catch (err) {
    // A clear while this save was preparing (say Replace sheet revoked the
    // blob URL) is not a storage failure.
    if (epoch !== startEpoch) return;
    savingOff = true;
    console.warn('[sheetSession] save failed; saving is off for this page session', err);
  }
}

/** True when a saved session exists. Never throws. */
export async function hasSheetSession(): Promise<boolean> {
  if (!available()) return false;
  try {
    const db = await getDb();
    return (await db.count(STORE, KEY)) > 0;
  } catch (err) {
    console.warn('[sheetSession] read failed', err);
    return false;
  }
}

/** The saved session as store state, its sheet on a fresh blob URL the
 *  caller owns. Null when nothing usable is saved; an unreadable record is
 *  deleted. Never throws. */
export async function loadSheetSession(): Promise<SheetSessionState | null> {
  if (!available()) return null;
  try {
    const db = await getDb();
    const record = await db.get(STORE, KEY);
    if (!record) return null;
    if (!(record.sheetBytes instanceof Blob)) {
      await clearSheetSession();
      return null;
    }
    const url = URL.createObjectURL(record.sheetBytes);
    const state = deserializeSheetSession(record, url);
    if (!state) {
      URL.revokeObjectURL(url);
      await clearSheetSession();
    }
    return state;
  } catch (err) {
    console.warn('[sheetSession] restore failed', err);
    return null;
  }
}

/** Delete the saved session, and drop any save still being prepared.
 *  Never throws. */
export async function clearSheetSession(): Promise<void> {
  epoch++;
  if (!available()) return;
  try {
    await enqueue(async () => {
      const db = await getDb();
      await db.delete(STORE, KEY);
    });
  } catch (err) {
    console.warn('[sheetSession] clear failed', err);
  }
}
