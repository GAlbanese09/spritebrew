/**
 * SpriteBrew's release notes, newest first: one source for the What's New
 * pop-up (src/components/layout/WhatsNew.tsx) and the /updates page.
 *
 * To ship a release: add it at the top with the next version. CURRENT_VERSION
 * follows from the first entry. Release labels read "DATE: TITLE" (no dashes).
 */

export interface ChangelogEntry {
  emoji: string;
  title: string;
  description: string;
}

export interface Release {
  /** Dotted numbers, unique, strictly decreasing down the list. */
  version: string;
  /** As shown: "OCT 21, 2026", "May 2026" or "Earlier". */
  date: string;
  title: string;
  entries: ChangelogEntry[];
}

export const RELEASES: Release[] = [
  {
    version: '0.6.4',
    date: 'OCT 27, 2026',
    title: 'ANIMATION PRICES',
    entries: [
      {
        emoji: '🪙',
        title: 'Two animation styles now cost 50 tokens',
        description:
          'Custom Animation and 8-Direction Rotation on the Create tab now cost 50 tokens, the same as Custom Action and Subtle Motion on the Animate tab, because they cost us more to make than their old price of 25. Every other price is the same. If a page you opened before the change still shows 25, Generate asks you to refresh first and takes no tokens.',
      },
    ],
  },
  {
    version: '0.6.3',
    date: 'OCT 24, 2026',
    title: 'SMARTER UPLOADS',
    entries: [
      {
        emoji: '🔍',
        title: 'Better guesses for big frames',
        description:
          'When you upload a sheet with large frames, such as four 256 px characters on a 512 px sheet, the Resize screen now reads the pixels to find the grid. It works best on transparent backgrounds. Check the rows and columns it picks, and change them if they are off.',
      },
      {
        emoji: '📜',
        title: 'Every update in one place',
        description:
          'Click the version number at the bottom of the sidebar to see every SpriteBrew update, newest first. The What\'s New window now shows only what is new since you last closed it.',
      },
    ],
  },
  {
    version: '0.6.2',
    date: 'OCT 21, 2026',
    title: 'EASIER ANIMATIONS',
    entries: [
      {
        emoji: '🧩',
        title: 'Drag frames to make animations',
        description:
          'In Sheet Tools, drag a frame onto the Animations panel to start a new animation, and drop more frames to add them. "Use all frames" makes one from the whole sheet in a click, and you can rename an animation and set its type right on its card.',
      },
      {
        emoji: '🎯',
        title: 'Your prepared character stays put',
        description:
          'On the Animate tab, changing the resolution no longer throws away a character you prepared or touched up by hand. Switch back and it is still there, or click "Prepare at" to make a fresh version at the new size. Pixel edits also survive padding changes now.',
      },
    ],
  },
  {
    version: '0.6.1',
    date: 'OCT 4, 2026',
    title: 'PRIVACY POLICY UPDATED',
    entries: [
      {
        emoji: '🔒',
        title: 'Privacy policy updated',
        description:
          'We rewrote our privacy policy to match how SpriteBrew handles your data today, including payments, your saved generations and what you can delete. You can read it on the Privacy page.',
      },
    ],
  },
  {
    version: '0.6.0',
    date: 'JUN 18, 2026',
    title: 'MOBILE EDITING AND EDIT RECOVERY',
    entries: [
      {
        emoji: '📱',
        title: 'Edit on your phone',
        description:
          'The pixel editor now works with touch. Draw with your finger, pinch to zoom and pan, and the layout adapts to phone screens, so you no longer need a desktop to edit sprites.',
      },
      {
        emoji: '🔄',
        title: 'Edit recovery',
        description:
          'Close or refresh the editor by accident? We will now offer to bring your last in-progress sprite back, so you can pick up where you left off.',
      },
    ],
  },
  {
    version: '0.5.13',
    date: 'JUN 2, 2026',
    title: 'ANIMATE & PREVIEW POLISH',
    entries: [
      {
        emoji: '🎨',
        title: 'Smarter defaults and a cleaner result preview',
        description:
          'Two improvements: new animations now default to a magenta background fill, which keeps your character cleaner when the background is removed. And the result preview now picks the right zoom automatically based on the image size, so your sprite fits the view and stays centered instead of getting cut off or shrunk.',
      },
    ],
  },
  {
    version: '0.5.12',
    date: 'MAY 31, 2026',
    title: 'SAVE YOUR ANIMATION PRESETS',
    entries: [
      {
        emoji: '⭐',
        title: 'Save and reuse your animation settings',
        description:
          'You can now save your animation settings as named templates and load them with one click. Set up your favorite frame count, action, background, and resolution once, save it as a preset, and reuse it on any character. Find it in the Animate tab above the action picker.',
      },
    ],
  },
  {
    version: '0.5.11',
    date: 'MAY 31, 2026',
    title: 'ANIMATE SETTINGS REMEMBERED',
    entries: [
      {
        emoji: '💾',
        title: 'Your animation settings now stick around',
        description:
          'The Animate form now remembers your settings. Frame count, animation action, background color, resolution, and the rest stay put if you refresh the page or switch tabs, so you no longer lose your setup partway through. Your last-used settings are waiting for you next time too.',
      },
    ],
  },
  {
    version: '0.5.10',
    date: 'MAY 30, 2026',
    title: 'SMOOTHER PIXEL EDITOR',
    entries: [
      {
        emoji: '🖌️',
        title: 'Faster, smoother brush on large canvases',
        description:
          'The pixel editor brush is now much smoother on larger canvases. Strokes keep up with fast movements without gaps, and the canvas no longer stutters while you draw at higher zoom levels. Editing at 128x128 and above feels the way it should.',
      },
    ],
  },
  {
    version: '0.5.9',
    date: 'MAY 30, 2026',
    title: 'EDITOR ROUND-TRIP COMPLETE',
    entries: [
      {
        emoji: '🔄',
        title: 'Send your edited sprite straight to the Animator',
        description:
          'Added a "Send to Animator" button inside the Pixel Editor. Now you can take a fresh generation, clean it up in the editor (removing unwanted details or fixing pixels), then send it straight into the Animate flow without downloading and re-uploading. Closes the full round-trip: generate, edit, animate. Your edited sprite is preserved exactly as you made it: background removal is skipped by default since you just spent time editing.',
      },
    ],
  },
  {
    version: '0.5.8',
    date: 'MAY 28, 2026',
    title: 'SEND TO ANIMATOR + BG CONTROL',
    entries: [
      {
        emoji: '🎬',
        title: 'Send your generated sprites straight to the Animator',
        description:
          "Added a \"Send to Animator\" button on every Create-mode generation result. Click it to drop your sprite straight into the Animate flow with no download-and-reupload step. Now you can also choose whether to keep your sprite's background: your \"Remove background\" choice from the result carries through to AutoPrep, and there is a new \"Skip background removal\" toggle for when you want to keep the original background completely intact.",
      },
    ],
  },
  {
    version: '0.5.7',
    date: 'MAY 27, 2026',
    title: 'SEND TO EDITOR',
    entries: [
      {
        emoji: '🖌️',
        title: 'Send your generated sprites straight to the Pixel Editor',
        description:
          "Added a new 'Send to Editor' button on every generation result. Click it to open your sprite in the Pixel Editor for pixel-level refinements, perfect for cleaning up small details the AI got slightly wrong. Honors the 'Remove background' toggle so you get the variant you saw on the result.",
      },
    ],
  },
  {
    version: '0.5.6',
    date: 'MAY 22, 2026',
    title: 'GALLERY GOES SERVER-SIDE',
    entries: [
      {
        emoji: '🌐',
        title: 'Your gallery now syncs across devices',
        description:
          'Sign in on any browser or device and your generations are there. No more losing work when you clear your browser cache.',
      },
    ],
  },
  {
    version: '0.5.5',
    date: 'MAY 21, 2026',
    title: 'EDITOR HAS A HOME',
    entries: [
      {
        emoji: '🎨',
        title: 'Pixel Editor now has its own tab',
        description:
          'Find it as "Edit" in the sidebar. Start a blank canvas at any size or upload an image to edit pixel by pixel. No more digging through Generate → Animate → upload to find the editor.',
      },
      {
        emoji: '🧩',
        title: 'Editor toolbar layout fixed',
        description:
          'The color palette no longer clips at the right edge. Cleaner editor surface across the board.',
      },
    ],
  },
  {
    version: '0.5.4',
    date: 'MAY 20, 2026',
    title: 'SLICER QUICK EXPORT',
    entries: [
      {
        emoji: '📦',
        title: 'Quick download all sliced frames',
        description:
          'After slicing your sprite sheet on the Upload & Slice page, you can now download every frame as a separate transparent PNG with a single click. Look for "Download all frames (PNG ZIP)" right next to "Continue to Preview."',
      },
    ],
  },
  {
    version: '0.5.3',
    date: 'MAY 19, 2026',
    title: 'EDITOR FOUNDATION',
    entries: [
      {
        emoji: '💾',
        title: 'Your edits are safe now',
        description:
          'Clicking outside the editor or pressing Esc with unsaved work now asks before discarding. Auto-save coming next.',
      },
      {
        emoji: '🖌️',
        title: 'Brush sizes',
        description:
          'Pencil and eraser now support sizes 1, 2, 4, 8, and 16 pixels. Use [ and ] keys to cycle.',
      },
      {
        emoji: '⚡',
        title: 'Editor under the hood',
        description:
          'Big architectural upgrade: the editor is now built on a foundation that will support animation preview, palette swap, and onion skinning in upcoming releases.',
      },
    ],
  },
  {
    version: '0.5.2',
    date: 'MAY 12, 2026',
    title: 'STYLE PREVIEW UPGRADE',
    entries: [
      {
        emoji: '🎨',
        title: 'See examples for every style',
        description:
          'Tap the ⤢ icon on any style card to open a carousel showing what each style actually produces. 15 of 21 styles now have curated examples, animation previews coming in a future release.',
      },
      {
        emoji: '🌅',
        title: 'Background toggle on the generate bar',
        description:
          "The 'Remove background' control is now always visible on the sticky generate bar, no more hunting through the form. Default is on for character styles, off for tiles. Toggle off to keep environmental detail in your generation.",
      },
      {
        emoji: '📐',
        title: 'Larger downloads coming soon',
        description:
          "All generations output at 256×256 native pixel grid, the right size for sprite sheets and pixel-perfect game engines. Some example images may display at larger sizes; a 'Download at 2× / 4×' option for upscaled PNG output is coming in a future release.",
      },
    ],
  },
  {
    version: '0.5.1',
    date: 'MAY 10, 2026',
    title: 'UX POLISH',
    entries: [
      {
        emoji: '🎯',
        title: 'Always-visible Generate button',
        description:
          'The Generate button now stays pinned at the bottom of the screen while you scroll through styles or settings. No more scrolling back up after picking your style.',
      },
      {
        emoji: '📁',
        title: 'Collapsible style picker',
        description:
          'Each style category (Characters, Items, Tiles, UI, Animations) now collapses with a single click. Focus on the kind of sprite you want without wading through every option.',
      },
      {
        emoji: '📱',
        title: 'Mobile polish',
        description:
          'Better layouts, bigger tap targets, and a cleaner Generate bar that stacks gracefully on phones and tablets.',
      },
    ],
  },
  {
    version: '0.5.0',
    date: 'May 10, 2026',
    title: 'Reliability',
    entries: [
      {
        emoji: '🛡️',
        title: 'More reliable generations',
        description:
          "We've made big improvements behind the scenes so generations finish smoothly even when they take a while. If anything ever goes wrong, your tokens are refunded automatically.",
      },
    ],
  },
  {
    version: '0.4.0',
    date: 'May 2026',
    title: 'Daily Brew & Pixel Polish',
    entries: [
      {
        emoji: '🔥',
        title: 'Daily Login Rewards',
        description:
          'Earn +3 tokens every day you generate. Streak builds with each consecutive day.',
      },
      {
        emoji: '⭐',
        title: '7-Day Streak Bonus',
        description:
          'Hit a 7-day streak and earn +6 tokens instead of +3. Miss a day and the streak resets.',
      },
      {
        emoji: '📬',
        title: 'Newsletter Signup Bonus',
        description:
          'Subscribe to product updates from inside the app and earn +5 tokens. One-time, your account email only.',
      },
      {
        emoji: '🖼️',
        title: 'Reference Images on Pro Styles',
        description:
          'Attach up to 9 images to guide the style, palette, and design feel of your generation. Pro tier only.',
      },
      {
        emoji: '↔️',
        title: 'Sprite-Flip Toggle',
        description:
          'Demo Area now lets you flip your sprite’s natural facing, fixes moonwalk on left-facing sheets.',
      },
      {
        emoji: '🔍',
        title: 'Pixel-Perfect Demo Area',
        description:
          'Integer-scale rendering (1×/2×/4×/8×) with drop shadows. Crisp pixels at every zoom level.',
      },
      {
        emoji: '🎬',
        title: 'Showcase Mode',
        description:
          'Press F in the Demo Area for distraction-free fullscreen preview. Esc or F to exit.',
      },
    ],
  },
  {
    version: '0.3.0',
    date: 'Earlier',
    title: 'Token Economy & Foundations',
    entries: [
      {
        emoji: '🪙',
        title: 'Token Economy',
        description:
          'Replaced daily limits with tokens. Signup bonus, token packs from $4.99, and tokens that never expire.',
      },
      {
        emoji: '💳',
        title: 'Buy Token Packs',
        description:
          'Purchase tokens via Stripe. Four packs available: Starter, Creator, Studio, and Pro.',
      },
      {
        emoji: '📜',
        title: 'Refund Policy',
        description:
          'Refund policy now live. 14-day refund on unused token packs. See /refund-policy for full terms.',
      },
      {
        emoji: '✨',
        title: 'Animate My Character',
        description:
          'Upload your pixel art and generate walk, idle, and attack animations from it.',
      },
      {
        emoji: '🔍',
        title: 'Auto-Detect Sprites',
        description:
          'Find individual sprites in any layout, no grid required. Uses contour detection.',
      },
      {
        emoji: '🪄',
        title: 'Auto-Prep Character',
        description:
          'Drop any image: SpriteBrew finds, crops, removes background, and resizes your character automatically.',
      },
      {
        emoji: '🔐',
        title: 'Sign In to Generate',
        description:
          'Free account required for AI features. Upload, slice, preview, and export stay free.',
      },
      {
        emoji: '🖼️',
        title: 'Generation Gallery',
        description:
          'Browse past generations. Filter, download, or send to slicer.',
      },
      {
        emoji: '📐',
        title: 'Smart Image Resizer',
        description:
          'Choose target frame size: SpriteBrew calculates sheet dimensions automatically.',
      },
      {
        emoji: '🖌️',
        title: 'Pixel Editor',
        description:
          'Click any frame to edit. Pencil, eraser, eyedropper, undo/redo.',
      },
      {
        emoji: '🎯',
        title: 'Background Removal',
        description:
          'Remove solid backgrounds from generated animations automatically.',
      },
    ],
  },
];

export const CURRENT_VERSION = RELEASES[0].version;

/** "DATE: TITLE", as the pop-up and the page show it (both upper-case it). */
export function releaseLabel(release: Release): string {
  return `${release.date}: ${release.title}`;
}

/** The numbers of a dotted version, or null if it is not one. */
export function parseVersion(value: string | null | undefined): number[] | null {
  if (typeof value !== 'string' || !/^\d+(\.\d+)*$/.test(value.trim())) return null;
  return value.trim().split('.').map(Number);
}

/** Negative if a is older than b, 0 if equal, positive if newer (missing parts count as 0). */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The releases a returning visitor has not seen: every release newer than the
 * version stored at their last visit. A stored value that is not a version
 * gets the newest release alone; one at or past CURRENT_VERSION gets none.
 */
export function releasesSince(seen: string | null | undefined): Release[] {
  const seenVersion = parseVersion(seen);
  if (!seenVersion) return RELEASES.slice(0, 1);
  return RELEASES.filter((r) => {
    const v = parseVersion(r.version);
    return v !== null && compareVersions(v, seenVersion) > 0;
  });
}
