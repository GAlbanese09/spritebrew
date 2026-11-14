// scripts/motion-words-test.mjs
//
// Offline tests for src/lib/motionWords.ts, the prompt help under Animate's
// motion box (DESIGN design/tickets/prompt-help-v1a.md; HQ 2026-11-11-075):
// which motion texts get a line, which do not, the words of the lines, and
// the example text per action. Also pins what AnimateForm must keep, which
// has no browser test here: the request is built exactly as on main (ENG's
// condition for a display-only touch of a freeze file), and the line never
// blocks Generate. Check D0 carries that condition whole: with the motion
// help's display lines undone, the form must be main's file byte for byte,
// and each display region is pinned as it was reviewed. D0 cannot say where
// a change outside the regions is: git diff against main does. After a
// reviewed change to AnimateForm.tsx, MOTION_WORDS_PINS=1 prints the pins
// as the file now stands; before any is copied in, compare the file with
// main yourself, because a new pin makes D0 pass whatever it was given.
// Run from the repo root: `node scripts/motion-words-test.mjs`. Bundles with
// esbuild into local/.motion-words-test/ (gitignored). Prints only case names
// and pass or fail.

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.motion-words-test');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/motionWords.ts'), path.join(ROOT, 'src/lib/styleRegistry.ts')],
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const {
  motionCatch, motionPlaceholder, motionLabel, directionLine, directionsLine, MOTION_HELP, MOTION_CATCH_DELAY_MS,
  MOTION_SPEAK_AGAIN_MS, MOTION_SPOKEN_CLEAR_MS, DIRECTION_ACTIONS, LOOSE_DIRECTIONS_ACTIONS, SIDE_VIEW_STYLE_ID, FOUR_ANGLE_STYLE_ID,
} = await import(pathToFileURL(path.join(OUT_DIR, 'motionWords.mjs')).href);
const { getStyleById, OFFERED_STYLES } = await import(pathToFileURL(path.join(OUT_DIR, 'styleRegistry.mjs')).href);

let failed = 0;
const names = new Set();
function check(name, ok, detail) {
  const id = name.slice(0, name.indexOf(':'));
  if (names.has(id)) { console.log(`FAIL  two checks are named ${id}`); failed++; }
  names.add(id);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const EVERY_ACTION = ['walking', 'idle', 'attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action'];
const caught = (texts, action) => texts.map((t) => motionCatch(t, action));
const all = (texts, action, want) => { const got = caught(texts, action); return [got.every((g) => g === want), texts.filter((_, i) => got[i] !== want)]; };

// ---- A. direction words ----
{
  // What people typed (HQ's read of the provider's activity page, Nov 11).
  const real = ['Turns head and body to one side and walks left or right', 'walks to the side', 'walk right', 'walk towards lower right', 'alternating left right strides'];
  const [ok, missed] = all(real, 'walking', 'direction');
  check('A1: the direction phrases people really typed get the direction line on Walk', ok, missed);
  const each = ['left', 'right', 'leftward', 'rightward', 'leftwards', 'rightwards', 'sideways', 'to the side', 'to one side', 'side view', 'front view', 'back view', 'side-view', 'front-view', 'back-view', 'sideview', 'frontview', 'backview', 'to either side', 'towards', 'toward', 'forward', 'forwards', 'backward', 'backwards', 'turn', 'turns', 'turned', 'turning', 'turn around', 'turned around', 'facing', 'lower left', 'lower right', 'upper left', 'upper right'];
  const [ok2, missed2] = all(each.map((w) => `walks ${w} slowly`), 'walking', 'direction');
  check('A2: every word and phrase on the list is caught', ok2, missed2);
  check('A3: on Walk, Idle, Attack and Jump, and on no other action', same(EVERY_ACTION.map((a) => motionCatch('walk right', a)), ['direction', 'direction', 'direction', 'direction', null, null, null, null]) && same([...DIRECTION_ACTIONS], ['walking', 'idle', 'attack', 'jump']));
  check('A4: any letter case, and punctuation beside the word', all(['Walk RIGHT', 'walks Left.', 'run (forward)', 'walk,right'], 'walking', 'direction')[0]);
  const quiet = ['sword swing', 'high jump', 'breathing', 'heavy steps', '', '   ', 'sneaking', 'limping', 'cape blowing', 'punch', 'hop', 'waving hello', 'a clear view of the sword', 'with a view to the hills'];
  const [ok5, loud] = all(quiet, 'walking', null);
  check('A5: the examples the form itself gives, and an empty box, get no line', ok5 && all(quiet, 'attack', null)[0], loud);
  const inside = ['bright sparks', 'upright stance', 'copyright', 'return to idle', 'leftover energy', 'forwarded', 'outward', 'defacing', 'turnip', 'sidestep', 'frontal slash', 'straight punch', 'alright', 'overview', 'to the sideline'];
  const [ok6, loud6] = all(inside, 'walking', null);
  check('A6: whole words only: a direction word inside another word is not one', ok6, loud6);
  // Every part on the list, on each side.
  const PARTS = ['hand', 'arm', 'leg', 'foot', 'feet', 'eye', 'ear', 'fist', 'knee', 'shoulder', 'wing', 'claw', 'paw', 'hook', 'jab', 'uppercut', 'kick', 'wrist', 'elbow', 'hip', 'palm', 'finger', 'thumb', 'heel', 'toe', 'horn', 'tentacle', 'fin', 'hoof', 'tail'];
  const [ok7, loud7] = all([...PARTS.flatMap((part) => [`raises right ${part}`, `swings the left ${part} up`]), 'lifts left front paw', 'kicks with the right hind leg', 'left back foot stomp'], 'attack', null);
  check('A7: a side of the body is not a direction, for every part on the list', ok7, loud7);
  const forms = ['right-hand punch', 'left-handed slash', 'right hook', 'left wings flap', 'flicks right wrist', 'both right hands up', 'left  arm raised', 'right\nleg kick', 'right_hand wave', 'left legs kick', 'right-footed shot'];
  const [ok7b, loud7b] = all(forms, 'attack', null);
  check('A8: with a hyphen, a plural, "-ed", or any gap between the two words', ok7b, loud7b);
  check('A9: every body side in the text is set aside, not only the first', motionCatch('right hand up, then left arm, then right leg', 'attack') === null);
  check('A10: but a direction beside a body side still is', motionCatch('raises right hand and walks left', 'walking') === 'direction' && motionCatch('right hand, facing right', 'attack') === 'direction');
  const sideOf = ['walks to the right hand side', 'moves to the left hand side', 'right-hand side step', 'walks to the right-hand corner', 'walk in the right-hand lane', 'keeps to the left hand wall', 'along the right hand edge', 'stays in the left-hand half'];
  const [ok11, missed11] = all(sideOf, 'walking', 'direction');
  check('A11: a part followed by a place ("the right hand side", "the right-hand corner") is a direction, not a hand', ok11, missed11);
  check('A12: known false alarms, accepted on the ticket: "forward lunge", "turn the page"', motionCatch('forward lunge', 'attack') === 'direction' && motionCatch('turn the page', 'idle') === 'direction');
  const spaced = ['walks to the  side', 'side\tview walk', 'walks to\nthe side', 'walk_right', 'to   one\n side', 'walks   left', `walks to the${String.fromCharCode(0xA0)}side`, 'side - view walk'];
  const [ok13, missed13] = all(spaced, 'walking', 'direction');
  check('A13: two spaces, a tab, a line break, a no-break space or an underscore between words reads as one space, and a hyphen with spaces round it as a hyphen', ok13, missed13);
  const travel = ['walk left arms swinging', 'run right legs pumping', 'walks left hand on hip', 'walk right knees bent', 'walk left hip swaying', 'walk right wings spread', 'walks left armed with a sword', 'moves left arm', 'goes right foot first', 'marching left fists raised', 'dashes right claws out', 'stepped right heel first', 'ran left tail up', 'went right hand raised'];
  const [ok14, missed14] = all(travel, 'walking', 'direction');
  check('A14: right after a verb of travel, "left" or "right" is where the character goes, whatever follows', ok14, missed14);
  const notTravel = ['raises left arm', 'swings right fist', 'waves the right hand', 'shows left palm', 'walking stick in right hand'];
  const [ok15, loud15] = all(notTravel, 'attack', null);
  check('A15: after any other word a body side stays a body side', ok15, loud15);
  check('A16: the place after a part must be the whole word: "right hand sidestep" and "left arm halfway up" are still a hand and an arm', motionCatch('right hand sidestep', 'attack') === null && motionCatch('left arm halfway up', 'attack') === null && motionCatch('left paw cornered', 'attack') === null);
  // Run apart from this process, with a clock on it: a pattern that
  // backtracks cannot be stopped from inside, and the form runs the matcher
  // on every render.
  const hard = `
    const { motionCatch } = await import(${JSON.stringify(pathToFileURL(path.join(OUT_DIR, 'motionWords.mjs')).href)});
    const texts = ['left '.repeat(600), 'left-'.repeat(2000), ' -'.repeat(5000), 'right hand '.repeat(1000) + 'side', 'walk '.repeat(3000) + 'right', 'a'.repeat(20000), '8 '.repeat(4000) + 'direction', 'to the '.repeat(3000) + 'side', ('x'.repeat(30) + ' ').repeat(700) + 'left arm', 'left' + '-'.repeat(34) + 'x', 'right ' + '- '.repeat(30) + 'q', 'left' + ' '.repeat(40) + 'x'];
    const t0 = performance.now();
    for (const text of texts) for (const action of ${JSON.stringify(EVERY_ACTION)}) motionCatch(text, action);
    if (motionCatch('walk '.repeat(3000) + 'right', 'walking') !== 'direction') process.exit(3);
    process.exit(performance.now() - t0 < 1000 ? 0 : 2);
  `;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', hard], { timeout: 5000, encoding: 'utf8' });
  check('A17: long and repetitive texts are answered at once and never throw', ran.status === 0, { status: ran.status, signal: ran.signal, err: (ran.stderr ?? '').slice(0, 200) });
}

// ---- B. more than one direction ----
{
  const real = 'Full 8-frame walk cycle, 8-directional movement sprite sheet (front, back, left, right)';
  check('B1: the 8-direction request people really typed gets the directions line, on Walk, Attack and Custom action', same(['walking', 'attack', 'custom_action'].map((a) => motionCatch(real, a)), ['directions', 'directions', 'directions']));
  const plain = ['8-direction', '8 direction', '8direction', '8-directional', '8 directions', 'eight direction', 'eight directions', '4-direction', '4 direction', '4-directional', '4 directions', 'four direction', 'four directions', 'multi-direction', 'multi direction', 'multidirectional', 'multi-directions', '4-angle', '4 angle', 'four-angle', '4 angles', 'four angles'];
  const missed = plain.filter((w) => !EVERY_ACTION.every((a) => motionCatch(`walk cycle, ${w} sheet`, a) === 'directions'));
  check('B2: asking for many directions in so many words is caught on every action', missed.length === 0, missed);
  const loose = ['all directions', 'every direction', 'both directions', 'multiple directions', 'rotation', 'rotate', 'rotates', 'rotated', 'rotating', '360', '8-way', '8 way', 'eight-way', '4-way', 'four way', '4 ways', '8 ways', 'turnaround', 'turnarounds'];
  const missedLoose = loose.filter((w) => !['walking', 'idle'].every((a) => motionCatch(`cycle, ${w} sheet`, a) === 'directions'));
  const loudLoose = loose.filter((w) => !['attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action'].every((a) => motionCatch(`cycle, ${w} sheet`, a) === null));
  check('B3: the looser ways ("all directions", "rotating", "360", "8-way", "turnaround") count on Walk and Idle', missedLoose.length === 0 && same([...LOOSE_DIRECTIONS_ACTIONS], ['walking', 'idle']), missedLoose);
  check('B4: and on no other action, where they are about the motion', loudLoose.length === 0, loudLoose);
  check('B5: so these get no line: pieces flying, a 360 flip, a rotating blade, a rotating coin, an 8-way shot, a turnaround kick', motionCatch('pieces fly in all directions', 'destroy') === null && motionCatch('360 flip', 'jump') === null && motionCatch('rotating blade', 'attack') === null && motionCatch('360 spin attack', 'attack') === null && motionCatch('coin rotating', 'custom_action') === null && motionCatch('8-way shot', 'attack') === null && motionCatch('turnaround kick', 'attack') === null && motionCatch('four way explosion', 'destroy') === null && motionCatch('turnaround jump shot', 'jump') === null);
  check('B6: it wins over the direction line', motionCatch('walk left and right in all directions', 'walking') === 'directions' && motionCatch('4-angle sheet, facing left', 'attack') === 'directions' && motionCatch('turnaround to the left', 'attack') === 'direction');
  check('B7: "left and right" and "front and back" alone are about legs: the direction line on Walk, nothing on Crouch', motionCatch('legs move left and right', 'walking') === 'direction' && motionCatch('legs move left and right', 'crouch') === null && motionCatch('sways front and back', 'crouch') === null);
  check('B8: "turn around" in two words is a direction word, not a request for many', motionCatch('turn around', 'walking') === 'direction' && motionCatch('turned around', 'idle') === 'direction' && motionCatch('turn around', 'crouch') === null);
  const quiet = ['8 frames', '4 steps', 'a 360p look', 'direction', 'in one direction', 'corrode', '3600', 'eight frames', 'halfway', 'one way', 'a 4 angled blade', 'triangle', 'four wayward steps', '14 ways', '48 directions', 'a wayside inn', 'turnaroundish'];
  const [ok9, loud] = all(quiet, 'crouch', null);
  check('B9: numbers and "direction" on their own are not a request for many', ok9 && all(quiet, 'walking', null)[0], loud);
  const spaced = ['8  direction sheet', 'all\ndirections', 'multi\tdirectional', 'every  direction', '8 - direction sheet', 'multi - directional', '4 - way walk'];
  const [ok10, missed10] = all(spaced, 'walking', 'directions');
  check('B10: any gap between the words of a phrase reads as one space, and a hyphen with spaces round it as a hyphen', ok10, missed10);
  check('B11: the many-directions line\'s own words, typed back, are caught: "walking 4 ways"', motionCatch('a new character walking 4 ways', 'walking') === 'directions');
}

// ---- C. the words ----
{
  check('C1: the example text follows the action', same(EVERY_ACTION.map(motionPlaceholder), [
    'Leave blank, or say how: heavy steps, sneaking, limping',
    'Leave blank, or: breathing, cape blowing',
    'Leave blank, or: sword swing, punch',
    'Leave blank, or: high jump, hop',
    'Leave blank, or a few words',
    'Leave blank, or a few words',
    'Leave blank, or a few words',
    'Required: what it does, e.g. waving hello',
  ]));
  check('C2: no example invites a direction', EVERY_ACTION.every((a) => motionCatch(motionPlaceholder(a), a) === null));
  check('C3: the label says optional or required, with a comma, no dash', motionLabel(false) === 'Motion description (optional, less is more)' && motionLabel(true) === 'Motion description (required)');
  check('C4: the help line', MOTION_HELP === 'Say how it moves, not which way. The way it faces comes from the picture.');
  const coin = String.fromCodePoint(0x1FA99), nbsp = String.fromCharCode(0xA0);
  check('C5: the direction line says what to do on Create, with the style, its cost and the words to start the description with', directionLine('Platformer', 40) === `The animation keeps the way your character faces, so direction words in the motion box are ignored. To walk sideways, make a side view first: on Create, pick Platformer (40${nbsp}${coin}) and start your description with "facing right, side view, full body".`);
  check('C6: the directions line says to make a picture for each direction, and that the 4-direction style draws a new character', directionsLine('4-Angle Walking', 25) === `One animation makes one direction. For each other direction, make a picture of your character facing that way and animate it. For a new character walking 4 ways, 4-Angle Walking on Create (25${nbsp}${coin}) draws one from text.`);
  check('C7: both lines carry the name and the cost they are given, the cost and its coin kept on one line', directionLine('Top-Down', 7).includes(`pick Top-Down (7${nbsp}${coin}) and`) && directionsLine('Walk Sheet', 9).includes(`Walk Sheet on Create (9${nbsp}${coin}) draws`));
  const side = getStyleById(SIDE_VIEW_STYLE_ID), four = getStyleById(FOUR_ANGLE_STYLE_ID);
  check('C8: both styles are in the registry, with a name and a cost, and Create offers them', !!side && !!four && side.label === 'Platformer' && four.label === '4-Angle Walking' && side.tokenCost > 0 && four.tokenCost > 0 && OFFERED_STYLES.includes(side) && OFFERED_STYLES.includes(four), [side?.label, four?.label]);
  const dash = String.fromCharCode(0x2014);
  check('C9: no em dash in any string', ![MOTION_HELP, motionLabel(true), motionLabel(false), directionLine('x', 1), directionsLine('x', 1), ...EVERY_ACTION.map(motionPlaceholder)].some((t) => t.includes(dash)));
  check('C10: the line waits a moment after the last key; a line that comes back is said again only after a real gap', MOTION_CATCH_DELAY_MS === 400 && MOTION_SPEAK_AGAIN_MS === 3000 && MOTION_SPOKEN_CLEAR_MS === 1000 && MOTION_SPEAK_AGAIN_MS > 4 * MOTION_CATCH_DELAY_MS);
  check('C11: neither line names a control Create does not have yet', !/Side, facing right/.test(directionLine('Platformer', 40) + directionsLine('4-Angle Walking', 25)));
}

// ---- D. the form (source) ----
{
  const raw = fs.readFileSync(path.join(ROOT, 'src/components/sprites/AnimateForm.tsx'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

  // ENG's condition, whole: AnimateForm.tsx is a freeze file and this change
  // is display only. REGIONS are the display lines: each is found by its
  // first line (which occurs once in the file) and runs to the first line
  // equal to its last; its bytes are pinned by sha256; "was" is what main
  // has there. Undoing every region must give main's file, byte for byte
  // (its git blob). So a change anywhere outside the regions fails here, and
  // so does a change inside one.
  const MAIN_BLOB = 'e2eb4625e398df77ca094991d780c282fd04d2bd';
  const REGIONS = [
    {
      start: "import { useState, useCallback, useRef, useEffect, useId, useMemo } from 'react';",
      end: "import { useState, useCallback, useRef, useEffect, useId, useMemo } from 'react';",
      sha256: 'dfb9848df744d9ee875572252e30494deb44dd801c122a71fbbc5477555c2a31',
      was: [
        "import { useState, useCallback, useRef, useEffect, useMemo } from 'react';",
      ],
    },
    {
      start: "  Info,",
      end: "  Info,",
      sha256: 'c8b2e8a4b9a0a529af145e19bfdd934b49469f7e1fc815ec77da0af2bcf06479',
      was: [],
    },
    {
      start: "  getStyleById,",
      end: "  getStyleById,",
      sha256: '045365f369ea0160bc82f314747bb5baeea27ec4805d1da2dcadc92ac6155731',
      was: [],
    },
    {
      start: "} from '@/lib/styleRegistry';",
      end: "} from '@/lib/motionWords';",
      sha256: '1ffcd15af387683bcba41000dfbbb36e72034102001cd6a2a85de5cc51d3502d',
      was: [
        "} from '@/lib/styleRegistry';",
      ],
    },
    {
      start: "  const isCustomAction = selectedAction === 'custom_action';",
      end: "  }, [motionSpoken]);",
      sha256: '601ca2c0dbc1fd88de01c8ce03b62042bf2f57ded64af106058efbd553430a7e',
      was: [
        "  const isCustomAction = selectedAction === 'custom_action';",
      ],
    },
    {
      start: "      {/* Motion prompt. \"relative\" keeps the hidden read-out paragraph inside",
      end: "          {motionLabel(isCustomAction)}",
      sha256: '73ef43cc9bc4f516194f0916773ea46ef7aefe167061e350c4318c8e9cdb4b4d',
      was: [
        "      {/* Motion prompt */}",
        "      <div>",
        "        <label className=\"block text-[10px] font-mono text-text-muted mb-1\">",
        "          Motion description {isCustomAction ? '(required)' : '(optional \u2014 less is more)'}",
      ],
    },
    {
      start: "          id={motionBoxId}",
      end: "          id={motionBoxId}",
      sha256: 'e7248fdc31ed04d1872032b848e28452fb1cd047d9f12383c8b9a4d4d60511f9',
      was: [],
    },
    {
      start: "          placeholder={motionPlaceholder(selectedAction)}",
      end: "          aria-required={isCustomAction}",
      sha256: '0183014eceef67eb71c58012344c5e7303743b48c4d6cfd558d0021214b04706',
      was: [
        "          placeholder=\"Keep short (2-4 words) or leave blank. e.g., walking forward, sword swing\"",
      ],
    },
    {
      start: "            text-xs font-mono text-text-primary placeholder:text-text-secondary resize-none",
      end: "            max-[340px]:min-h-[calc(3lh+1rem+2px)]\"",
      sha256: '1b45b263354e183f5edff22ce5d70e9b8c0cbc1137de42062d439eb3a0a3dc7a',
      was: [
        "            text-xs font-mono text-text-primary placeholder:text-text-muted resize-none",
        "            focus:outline-none focus:border-accent-amber\"",
      ],
    },
    {
      start: "        <p id={motionHelpId} className=\"text-xs font-mono text-text-secondary mt-1\">",
      end: "          {motionSpoken}",
      sha256: '8c75edacdad3e2f09d7b46b29bb3412dedbc58856ff02f25c454108b8e0d57b5',
      was: [
        "        <p className=\"text-[9px] font-mono text-text-muted/70 mt-1\">",
        "          For best character fidelity, leave blank or use minimal descriptions.",
        "          Detailed prompts may alter your character&apos;s appearance.",
      ],
    },
    {
      start: "      {/* Note about constraints. The one-direction sentence that stood here",
      end: "      <div className=\"text-xs font-mono text-text-secondary border-t border-border-subtle pt-3\">",
      sha256: '70ce6a003f8139a1ca4dbca95b0666a5bcd1858a97f3ecd9d4b1d413df825713',
      was: [
        "      {/* Note about constraints */}",
        "      <div className=\"text-[9px] font-mono text-text-muted/70 border-t border-border-subtle pt-3 space-y-1\">",
        "        <p>",
        "          Generates a single-direction sprite strip \u2014 generate separately for each",
        "          direction if you need a full 4-direction sheet.",
        "        </p>",
      ],
    },
  ];
  const sha256 = (t) => createHash('sha256').update(t).digest('hex');
  const gitBlob = (t) => { const b = Buffer.from(t, 'utf8'); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
  const lines = raw.split('\n');
  const wrong = [];
  const pins = [];
  for (const [i, r] of REGIONS.entries()) {
    const starts = raw.split('\n').filter((l) => l === r.start).length;
    const from = lines.indexOf(r.start);
    const to = from < 0 ? -1 : lines.indexOf(r.end, from);
    if (starts !== 1 || to < 0) { wrong.push(`region ${i + 1} not found once: ${r.start.trim()}`); continue; }
    const now = sha256(lines.slice(from, to + 1).join('\n'));
    pins.push(now);
    if (now !== r.sha256) wrong.push(`region ${i + 1} changed: ${r.start.trim()}`);
    lines.splice(from, to + 1 - from, ...r.was);
  }
  const undone = gitBlob(lines.join('\n'));
  if (undone !== MAIN_BLOB) wrong.push(`with the display lines undone the file is blob ${undone}, not main's`);
  if (process.env.MOTION_WORDS_PINS) console.log(`pins  ${JSON.stringify({ regions: pins, undone })}`);
  check('D0: with the motion help\'s display lines undone, the form is main\'s file byte for byte, and each display region is as reviewed', wrong.length === 0, wrong);

  // The whole callback that builds and sends the request, byte for byte as
  // on main (the file there is the blob MAIN_BLOB).
  const a = raw.indexOf('  const handleGenerate = useCallback(async () => {');
  const b = raw.indexOf('\n  ]);', a) + '\n  ]);'.length;
  const hash = sha256(raw.slice(a, b));
  check('D1: the callback that builds and sends the request is byte for byte main\'s', a > 0 && hash === 'b8c0a475506358935c3d0f8124b8aa7d06d2212048e8c1651b88f573df2bc95d', hash);
  check('D2: the motion text is still written in three places only (a restore, a template, the box), and sent trimmed', (src.match(/setMotionPrompt\(/g) ?? []).length === 3 && /motionPrompt: motionPrompt\.trim\(\),/.test(src) && /onChange=\{\(e\) => setMotionPrompt\(e\.target\.value\)\}/.test(src));
  check('D3: typing is taken a moment after the last key, a change of action takes the text as it stands at once, and the request never reads any of it', /const \[motionSettled, setMotionSettled\] = useState\(\{ text: '', action: selectedAction \}\);\s*const motionSettledForAction = motionSettled\.action === selectedAction;\s*useEffect\(\(\) => \{\s*const settle = \(\) =>\s*setMotionSettled\(\(was\) =>\s*was\.text === motionPrompt && was\.action === selectedAction \? was : \{ text: motionPrompt, action: selectedAction \},\s*\);\s*if \(!motionSettledForAction\) \{\s*settle\(\);\s*return;\s*\}\s*const timer = setTimeout\(settle, MOTION_CATCH_DELAY_MS\);\s*return \(\) => clearTimeout\(timer\);\s*\}, \[motionPrompt, selectedAction, motionSettledForAction\]\);\s*const motionText = motionSettledForAction \? motionSettled\.text : motionPrompt;\s*const motionCaught = motionCatch\(motionText, selectedAction\);/.test(src) && !/motion(?:Caught|Settled|Spoken|Line|Text)/.test(raw.slice(a, b)) && (src.match(/setMotionSettled\(/g) ?? []).length === 1);
  check('D4: the right line for each catch, its names and costs from the registry', /const sideViewStyle = getStyleById\(SIDE_VIEW_STYLE_ID\);\s*const fourAngleStyle = getStyleById\(FOUR_ANGLE_STYLE_ID\);\s*const motionCaughtLine =\s*motionCaught === 'directions' && fourAngleStyle\s*\? directionsLine\(fourAngleStyle\.label, fourAngleStyle\.tokenCost\)\s*: motionCaught === 'direction' && sideViewStyle\s*\? directionLine\(sideViewStyle\.label, sideViewStyle\.tokenCost\)\s*: null;/.test(src));
  check('D5: the box has its own id, its label and example from the library, the help line as its description, and says when it is required', /const motionBoxId = useId\(\);\s*const motionHelpId = useId\(\);/.test(src) && /<label htmlFor=\{motionBoxId\} className="block text-xs font-mono text-text-secondary mb-1">\s*\{motionLabel\(isCustomAction\)\}/.test(src) && /<textarea\s*id=\{motionBoxId\}/.test(src) && /placeholder=\{motionPlaceholder\(selectedAction\)\}\s*aria-describedby=\{motionHelpId\}\s*aria-required=\{isCustomAction\}/.test(src) && /<p id=\{motionHelpId\} className="text-xs font-mono text-text-secondary mt-1">\s*\{MOTION_HELP\}/.test(src));
  check('D6: the line is amber, 12 px, with an icon a screen reader skips, in a paragraph that is always in the page', /<p\s*ref=\{motionLineRef\}\s*style=\{motionLineRoom > 0 \? \{ minHeight: motionLineRoom \} : undefined\}\s*className="text-xs font-mono text-accent-amber"\s*>\s*\{motionCaughtLine !== null && \(\s*<span className="pt-1 flex items-start gap-1\.5">\s*<Info size=\{14\} className="mt-0\.5 shrink-0" aria-hidden="true" \/>\s*<span>\{motionCaughtLine\}<\/span>/.test(src));
  check('D7: the old example and the two small lines are gone', !/walking forward, sword swing/.test(raw) && !/For best character fidelity/.test(raw) && !/less is more\)'\}/.test(raw));
  const block = src.slice(src.indexOf('<label htmlFor={motionBoxId}'), src.indexOf('{motionSpoken}'));
  check('D8: nothing in the motion block is under 12 px: its label, box, help line and line are each 12 px, and no size is written in pixels', block.length > 200 && !/text-\[[^\]]*\]/.test(block) && !/text-(?:2xs|\[)/.test(block) && (block.match(/text-xs/g) ?? []).length >= 4 && /<label htmlFor=\{motionBoxId\} className="block text-xs /.test(block) && /text-xs font-mono text-text-primary placeholder:text-text-secondary/.test(block) && /<p id=\{motionHelpId\} className="text-xs /.test(block) && /className="text-xs font-mono text-accent-amber"/.test(block));
  check('D9: its words are readable: the label, the example and the help line use the secondary color, not the muted one', !/text-text-muted/.test(block) && /placeholder:text-text-secondary/.test(block));
  check('D10: the old one-direction sentence under the form is gone (the line under the box says it), and the note that stays is 12 px in the secondary color', !/single-direction sprite strip/.test(raw) && !/full 4-direction sheet/.test(raw) && /<div className="text-xs font-mono text-text-secondary border-t border-border-subtle pt-3">\s*<p>\s*For best results, your character should be on a solid color background\s*that contrasts with the character\.\s*<\/p>\s*<\/div>/.test(src));
  check('D11: Generate does not look at the line', !/motion(?:Caught|Settled|Spoken|Line|Text)/.test(src.slice(src.indexOf('Generate Animation (') - 1500, src.indexOf('Generate Animation ('))) && !/disabled=\{[^}]*motion(?:Caught|Settled|Spoken|Line|Text)/.test(src) && !/canGenerate[^;\n]*motion(?:Caught|Settled|Spoken|Line|Text)/.test(src));
  check('D12: the room a line took stays: a min-height that only grows, the real height rounded up, kept current while the line shows', /const keepRoom = \(\) => setMotionLineRoom\(\(room\) => Math\.max\(room, Math\.ceil\(line\.getBoundingClientRect\(\)\.height\)\)\);\s*keepRoom\(\);\s*if \(typeof ResizeObserver === 'undefined'\) return;\s*const observer = new ResizeObserver\(keepRoom\);\s*observer\.observe\(line\);\s*return \(\) => observer\.disconnect\(\);\s*\}, \[motionCaughtLine\]\);/.test(src) && (src.match(/setMotionLineRoom\(/g) ?? []).length === 1);
  check('D13: a line is said once, when it appears or changes, by a status that is always in the page; back soon for a text that only grew, it is not said again', /<p role="status" aria-live="polite" className="sr-only">\s*\{motionSpoken\}\s*<\/p>/.test(src) && /if \(motionCaughtLine === null\) \{\s*if \(motionLineShownRef\.current !== null\) \{\s*motionLineShownRef\.current = null;\s*motionLineGoneAtRef\.current = Date\.now\(\);\s*\}\s*return;\s*\}\s*if \(motionLineShownRef\.current === motionCaughtLine\) return;\s*motionLineShownRef\.current = motionCaughtLine;\s*const last = motionLastSpokenRef\.current;\s*const backSoon = Date\.now\(\) - motionLineGoneAtRef\.current < MOTION_SPEAK_AGAIN_MS;\s*if \(last !== null && last\.line === motionCaughtLine && backSoon && motionText\.startsWith\(last\.text\)\) return;\s*motionLastSpokenRef\.current = \{ line: motionCaughtLine, text: motionText \};\s*setMotionSpoken\(motionCaughtLine\);\s*\}, \[motionCaughtLine, motionText\]\);/.test(src) && (block.match(/aria-live="polite"/g) ?? []).length === 1 && !/<p[^>]*ref=\{motionLineRef\}[^>]*(?:role|aria-live)/.test(src));
  check('D14: the words stay in the status for their moment whatever the line does, then leave it', /useEffect\(\(\) => \{\s*if \(motionSpoken === ''\) return;\s*const clear = setTimeout\(\(\) => setMotionSpoken\(''\), MOTION_SPOKEN_CLEAR_MS\);\s*return \(\) => clearTimeout\(clear\);\s*\}, \[motionSpoken\]\);/.test(src) && (src.match(/setMotionSpoken\(/g) ?? []).length === 2);
  check('D15: the hidden status is laid out inside the motion block (a positioned block), not against the document, so it adds no height to the page', /<div className="relative">\s*<label htmlFor=\{motionBoxId\}/.test(src) && src.indexOf('<div className="relative">\n        <label htmlFor={motionBoxId}') < src.indexOf('className="sr-only">\n          {motionSpoken}') && !/sr-only/.test(src.slice(src.indexOf('{motionSpoken}') + 20, src.indexOf('{motionSpoken}') + 400)));
  check('D16: on touch screens, and in a window under 340 px wide, the box has room for three lines of example text', /\[@media\(hover:none\)_and_\(pointer:coarse\)\]:min-h-\[calc\(3lh\+1rem\+2px\)\]\s*max-\[340px\]:min-h-\[calc\(3lh\+1rem\+2px\)\]"/.test(block) && /rows=\{2\}/.test(block));
}

// ---- E. the library (source) ----
{
  // The form runs motionCatch on every render, so the library must stay
  // what it is: words and patterns. It imports nothing and touches nothing
  // outside itself.
  const lib = fs.readFileSync(path.join(ROOT, 'src/lib/motionWords.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  const named = lib.match(/\b(?:import|require|window|document|globalThis|self|localStorage|sessionStorage|fetch|XMLHttpRequest|navigator|process|eval|Function|setTimeout|setInterval|console|prototype|addEventListener)\b/g) ?? [];
  check('E1: the library imports nothing and names nothing outside itself', named.length === 0, [...new Set(named)]);
  check('E2: its patterns have no look-behind (older Safari cannot read one, and the page would not load)', !/\(\?<[=!]/.test(lib));
}

console.log(failed === 0 ? '\nall pass' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
