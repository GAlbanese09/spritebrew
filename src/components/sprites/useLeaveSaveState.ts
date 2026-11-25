'use client';

import { useSyncExternalStore } from 'react';
import type { LeaveSaveState } from '@/lib/editorCopy';
import { leaveSaveState, subscribeLeaveSaveState } from './useEditorRecovery';

/** How the session's work under `key` is kept (leaveSaveState), as React
 *  state: it follows the writes and the editor. */
export function useLeaveSaveState(key: string): LeaveSaveState {
  return useSyncExternalStore(subscribeLeaveSaveState, () => leaveSaveState(key), () => 'saving');
}
