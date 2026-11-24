'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { wordsKey, type CreateSpecIds, type WordsAnswer } from '@/lib/createCards';
import { shownWords, WordsLookup, type LastWords } from '@/lib/createWordsLookup';

/**
 * The "Adds" words for Create Sprite's card and rows (G2), from GET
 * /api/create-words (ENG, PR #81). The lookup itself, its keeping, its
 * retries and its timers are createWordsLookup.ts's (tested there); this
 * hook gives it the browser and the form's choice. What it returns is the
 * answer for the choice being rendered only (the key guard).
 */

const noLast = (): LastWords | null => null;

export function useCreateWords(
  promptStyle: string,
  spec: CreateSpecIds | null,
  getToken: () => Promise<string | null>
): { words: WordsAnswer; renew: () => void } {
  const tokenRef = useRef(getToken);
  useEffect(() => {
    tokenRef.current = getToken;
  });
  const [lookup] = useState(
    () =>
      new WordsLookup({
        fetch: (url, init) => fetch(url, init),
        getToken: () => tokenRef.current(),
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      })
  );
  const key = spec ? wordsKey(promptStyle, spec) : null;

  useEffect(() => {
    lookup.choose(promptStyle, spec);
    // `spec` and `promptStyle` are in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup, key]);
  useEffect(() => () => lookup.dispose(), [lookup]);

  const last = useSyncExternalStore(lookup.subscribe, lookup.last, noLast);
  const renew = useCallback(() => lookup.renew(), [lookup]);
  return { words: shownWords(key, last), renew };
}
