import type { SpriteAnimation, SpriteSheet } from '@/lib/types';

/** A synthetic group holding every sliced frame, in sheet order, for the
 *  upload page's ZIP shortcut when the user has made no groups yet. Built on
 *  demand and never written to the store, so the Animation Groups panel and
 *  Continue to Preview are unaffected. */
export function allFramesGroup(sheet: Pick<SpriteSheet, 'animations'>): SpriteAnimation {
  return {
    id: 'all-frames-export',
    name: 'All Frames',
    type: 'all',
    frames: sheet.animations.flatMap((a) => a.frames),
    fps: 8,
    loop: true,
  };
}
