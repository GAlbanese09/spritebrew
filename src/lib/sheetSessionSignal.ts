/**
 * Tells the other tabs of this browser that the saved Sheet Tools session
 * changed: a save landed or it was cleared (audit M1 of PR #53). The saved
 * session is one IndexedDB record shared by every tab (sheetSession.ts), so a
 * tab that hears this can no longer count its own work as saved
 * (useSheetSession).
 *
 * BroadcastChannel where the browser has it, else a localStorage counter and
 * the storage event. Nothing is opened at import: the browser's transport is
 * made on first use, in a window only, and tests pass their own. Each message
 * carries the sending tab's id, so a tab never reacts to its own.
 */

/** How a message travels between tabs. */
export interface SheetSessionTransport {
  post(message: string): void;
  /** Calls `onMessage` for each message; returns a function that stops it. */
  listen(onMessage: (message: string) => void): () => void;
}

const CHANNEL_NAME = 'spritebrew-sheet-session';
const STORAGE_KEY = 'spritebrew_sheet_session_signal';

/** This tab, for this page load. */
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let transport: SheetSessionTransport | null = null;

function browserTransport(): SheetSessionTransport | null {
  if (typeof window === 'undefined') return null;
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    return {
      post: (message) => channel.postMessage(message),
      listen: (onMessage) => {
        const handler = (e: MessageEvent) => {
          if (typeof e.data === 'string') onMessage(e.data);
        };
        channel.addEventListener('message', handler);
        return () => channel.removeEventListener('message', handler);
      },
    };
  }
  // The storage event fires in the other tabs only, and only when the value
  // changes, so each post counts up: "<count> <tab id>".
  return {
    post: (message) => {
      try {
        const count = parseInt(window.localStorage.getItem(STORAGE_KEY) ?? '0', 10) || 0;
        window.localStorage.setItem(STORAGE_KEY, `${count + 1} ${message}`);
      } catch { /* storage unavailable: the other tabs are not told */ }
    },
    listen: (onMessage) => {
      const handler = (e: StorageEvent) => {
        if (e.key !== STORAGE_KEY || !e.newValue) return;
        const space = e.newValue.indexOf(' ');
        if (space > 0) onMessage(e.newValue.slice(space + 1));
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
  };
}

function currentTransport(): SheetSessionTransport | null {
  if (!transport) transport = browserTransport();
  return transport;
}

/** Tests: use this transport instead of the browser's. */
export function setSheetSessionTransport(next: SheetSessionTransport | null): void {
  transport = next;
}

/** Tells the other tabs the saved session changed. Never throws. */
export function signalSheetSessionChanged(): void {
  try {
    currentTransport()?.post(TAB_ID);
  } catch { /* a closed channel: the other tabs are not told */ }
}

/** Calls `onChange` each time another tab changes the saved session. Returns
 *  a function that stops listening. Never throws: where the transport cannot
 *  be opened, nothing is heard and the stop function does nothing. */
export function onSheetSessionChangedElsewhere(onChange: () => void): () => void {
  try {
    const t = currentTransport();
    if (!t) return () => {};
    return t.listen((from) => {
      if (from !== TAB_ID) onChange();
    });
  } catch {
    return () => {};
  }
}
