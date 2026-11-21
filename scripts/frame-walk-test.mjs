// scripts/frame-walk-test.mjs
//
// The frame walk on the Animate result card (HQ 2026-11-21-001): while the
// loop plays, the strip outlines the frame the preview draws, in amber; Play,
// Stop, Previous frame and Next frame sit with Speed. Source checks only:
// the steps themselves are in a1-loop-sequence-test.mjs (positionAt,
// stepFrom), and the card was looked at in a browser outside this
// repository. Run from the repo root: `node scripts/frame-walk-test.mjs`.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
// Whitespace-blind: every run of white space is one space.
const flat = (s) => s.replace(/\s+/g, ' ');
const hasIn = (src) => (snippet) => flat(src).includes(flat(snippet));

const loop = read('src/components/sprites/SheetLoop.tsx');
const strip = read('src/components/sprites/LoopFrameStrip.tsx');
const card = read('src/components/sprites/GenerationResult.tsx');
const lib = read('src/lib/loopSequence.ts');
const gallery = read('src/app/gallery/page.tsx');

// ---- F1. SheetLoop: a pause the person holds, a step it reports ----
{
  const has = hasIn(loop);
  check('F1a: the new props default to today\'s loop (not paused, step 0, not started), so a caller that passes none, like the Gallery, is unchanged',
    has('paused = false, holdStep = 0, started = false, onStep,') && !/\b(?:paused|holdStep|started|onStep)=/.test(gallery.slice(gallery.indexOf('<SheetLoop'), gallery.indexOf('/>', gallery.indexOf('<SheetLoop')))));
  check('F1b: a pause stops the loop; held, it draws the held step, and playing again goes on from there',
    has('const active = loaded && playing && !paused && (onScreen || !ioSupported) && tabVisible && (!reducedMotion || userStarted);')
    && has('if (playing && paused) frameRef.current = steps > 0 && Number.isInteger(holdStep) && holdStep >= 0 ? holdStep % steps : 0; else if (!playing || (reducedMotion && !userStarted)) frameRef.current = 0; drawStep(frameRef.current);')
    && has('}, [loaded, active, playing, paused, holdStep, steps, reducedMotion, userStarted, drawStep]);'));
  check('F1c: every step drawn is reported, through a ref, so a new callback never restarts the loop',
    has('drawFrame(playList ? playList[s] : s); onStepRef.current?.(s);') && has('useEffect(() => { onStepRef.current = onStep; }, [onStep]);')
    && !/\[[^\]]*\bonStep\b[^\]]*\]\);\s*$/m.test(loop.slice(loop.indexOf('// Animation loop.'))));
  check('F1d: under reduced motion a press of Play outside counts as the tap; the loop\'s own play button hides while paused',
    has('const userStarted = startedSrc === src || started;') && has('const showPlayButton = loaded && playing && !paused && reducedMotion && !userStarted;'));
}

// ---- F2. The card: the hold and the steps, kept with the result ----
{
  const has = hasIn(card);
  check('F2a: Stop and the steps hold one position with the result; a new generation plays again',
    has('const [loopHold, setLoopHold] = useState<{ src: string; pos: number } | null>(null);')
    && has('const loopHeld = loopHold && loopHold.src === resultKey && loopSeq.order.length > 0 ? Math.min(loopHold.pos, loopSeq.order.length - 1) : null;')
    && has('setLoopHold(pos === null ? null : { src: resultKey, pos }); if (pos === null) setLoopStartedSrc(resultKey);'));
  check('F2b: the loop gets the hold and reports its steps; the strip gets the hold and listens',
    has('paused={loopHeld !== null} holdStep={loopHeld ?? 0} started={loopStartedSrc === resultKey} onStep={handleLoopStep}')
    && has('onChange={handleLoopChange} heldPos={loopHeld} onHold={handleLoopHold} steps={loopSteps}'));
  check('F2c: the steps go to the strip by an event, not through this card\'s state, so the card does not render at the frame rate',
    has('const [loopSteps] = useState(() => new EventTarget());') && has("loopSteps.dispatchEvent(new CustomEvent('step', { detail: step }));")
    && !/setLoopStep\b|useState<number>\(0\)/.test(card));
  check('F2d: the GIF and the played sheet still come from the loop\'s order and speed, untouched',
    has('const loopPlayback = useMemo(() => playback(loopSeq), [loopSeq]);') && has('const blob = encodeGif(frames, { scale: gifScale, fps: loopSeq.fps });'));
}

// ---- F3. The strip: the outline and the four controls ----
{
  const has = hasIn(strip);
  check('F3a: the frame the preview shows carries the amber ring, playing or held; held, it is the current one',
    has("const shownPos = stopped ? heldPos : positionAt(sequence, shownStep);")
    && has("const isShown = onHold !== undefined && pos === shownPos;")
    && has("aria-current={isShown && stopped ? 'true' : undefined}")
    && has("${isShown ? 'ring-2 ring-accent-amber' : ''}"));
  check('F3b: today\'s selected outline stays as it was',
    has("? 'border-accent-amber bg-accent-amber/10' : 'border-border-subtle hover:border-accent-amber/40'"));
  check('F3c: the step the loop draws is set from its event, never during render',
    has("const listen = (e: Event) => setShownStep((e as CustomEvent<number>).detail); steps.addEventListener('step', listen); return () => steps.removeEventListener('step', listen);"));
  check('F3d: Play plays (pressed while playing); Stop holds the frame shown (pressed while held)',
    has('onClick={() => onHold(null)} aria-pressed={!stopped}') && has('onClick={stop} aria-pressed={stopped}')
    && has('const stop = () => onHold?.(shownPos);'));
  check('F3e: Previous frame and Next frame stop, move one with wrapping, and select that frame',
    has('const step = (delta: number) => { const pos = stepFrom(sequence, shownPos, delta); onHold?.(pos); setSelection({ seq: sequence, pos }); };')
    && has('onClick={() => step(-1)} aria-label="Previous frame" title="Previous frame"')
    && has('onClick={() => step(1)} aria-label="Next frame" title="Next frame"'));
  check('F3f: held, an edit keeps the preview on the frame being worked on',
    has('if (stopped && pos !== null) onHold?.(pos);'));
  const group = strip.slice(strip.indexOf('aria-label="Playback"'), strip.indexOf('<label className={`${TAP} flex items-center gap-2 flex-1'));
  const words = [...group.matchAll(/>\s*([A-Z][a-z]+)\s*<\/button>/g)].map((m) => m[1]);
  check('F3g: the four controls, in order, beside Speed: "Play", "Stop", then "Previous frame" and "Next frame" by name, each 44 px by touch at any width',
    group.length > 500 && JSON.stringify(words) === '["Play","Stop"]' && (group.match(/\$\{TAP_TOUCH\}/g) ?? []).length === 4
    && has('const TAP_TOUCH = `${TAP} pointer-coarse:min-h-11 pointer-coarse:min-w-11`;')
    && strip.indexOf('aria-label="Playback"') < strip.indexOf('>Speed<'));
  const kept = ['Earlier', 'Later', 'Duplicate', 'Remove', 'Ping-pong', 'Reset'].filter((w) => !new RegExp(`>\\s*${w}\\s*</button>`).test(strip));
  check('F3h: every button the strip had is still there', kept.length === 0, kept);
}

// ---- F4. Nothing sent, charged or saved; no em dash ----
{
  const imports = (src) => [...src.matchAll(/^import [^;]*? from '([^']+)';$/gm)].map((m) => m[1]);
  check('F4a: the strip and the loop import only React, icons, the loop\'s type and the order functions: no store, no fetch, no storage',
    JSON.stringify(imports(strip)) === JSON.stringify(['react', 'lucide-react', './SheetLoop', '@/lib/loopSequence'])
    && JSON.stringify(imports(loop)) === JSON.stringify(['react', 'lucide-react'])
    && ![strip, loop, lib].some((s) => /\bfetch\(|localStorage|sessionStorage|useSpriteStore/.test(s)));
  const dash = String.fromCharCode(0x2014);
  const added = [strip, loop].concat([lib.slice(lib.indexOf('export function positionAt'))]);
  check('F4b: no em dash in the strip, the loop or the new functions', added.every((s) => !s.includes(dash)));
}

console.log(failed === 0 ? 'all pass' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
