// scripts/motion-words-test.mjs
//
// Offline tests for src/lib/motionWords.ts, the prompt help under Animate's
// motion box (DESIGN design/tickets/prompt-help-v1a.md; HQ 2026-11-11-075):
// which motion texts get a line, which do not, the words of the lines, and
// the example text per action. Also pins what AnimateForm must keep, which
// has no browser test here: the request is built exactly as it was before
// Prompt help (ENG's condition for a display-only touch of a freeze file),
// and the line never blocks Generate. Check D0 carries that condition
// whole: with the display lines undone (the motion help, the background
// advice in the drop zone, the 12 px lines), the form must be the freeze
// baseline byte for byte: the file as it stood before Prompt help, git blob
// BASE_BLOB. Each display region is pinned as it was reviewed. D0 cannot
// say where a change outside the regions is: git diff does. After a
// reviewed change to AnimateForm.tsx, MOTION_WORDS_PINS=1 prints the pins
// as the file now stands; before any is copied in, compare the file with
// the baseline yourself, because a new pin makes D0 pass whatever it was
// given.
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
  MOTION_SPEAK_AGAIN_MS, MOTION_SPOKEN_CLEAR_MS, DIRECTION_ACTIONS, LOOSE_DIRECTIONS_ACTIONS, PAIR_QUIET_ACTIONS, SEEN_FROM_ACTIONS, SIDE_VIEW_STYLE_ID, FOUR_ANGLE_STYLE_ID,
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
  const each = ['sideway', 'to a side', 'left', 'right', 'leftward', 'rightward', 'leftwards', 'rightwards', 'sideways', 'to the side', 'to one side', 'side view', 'front view', 'back view', 'side-view', 'front-view', 'back-view', 'sideview', 'frontview', 'backview', 'to either side', 'towards', 'toward', 'forward', 'forwards', 'backward', 'backwards', 'turn', 'turns', 'turned', 'turning', 'turn around', 'turned around', 'facing', 'lower left', 'lower right', 'upper left', 'upper right'];
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
  const PARTS = ['hand', 'arm', 'leg', 'foot', 'feet', 'eye', 'ear', 'fist', 'knee', 'shoulder', 'wing', 'claw', 'paw', 'hook', 'jab', 'uppercut', 'kick', 'wrist', 'elbow', 'hip', 'palm', 'finger', 'thumb', 'heel', 'toe', 'horn', 'tentacle', 'fin', 'hoof', 'tail', 'punch', 'cross', 'talon'];
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
  const notTravel = ['raises left arm', 'swings right fist', 'waves the right hand', 'shows left palm', 'a walking stick held in the right hand'];
  const [ok15, loud15] = all(notTravel, 'attack', null);
  check('A15: after any other word a body side stays a body side', ok15, loud15);
  check('A16: the place after a part must be the whole word: "right hand sidestep" and "left arm halfway up" are still a hand and an arm', motionCatch('right hand sidestep', 'attack') === null && motionCatch('left arm halfway up', 'attack') === null && motionCatch('left paw cornered', 'attack') === null);
  const wider = ['jump right arms up', 'hop left feet together', 'sneak right palms open', 'crawl right elbows low', 'leaps left arms wide', 'creeping right claws out', 'strides left fists clenched', 'sprints right arms pumping', 'slides left knees bent', 'rolls right arms tucked', 'dodges left hands up', 'strafe right arm steady', 'floats left wings still', 'flies right wings spread', 'swims left arms pulling', 'snuck right hand on hilt', 'walks slowly left arms swinging', 'walk to the left arms swinging', 'runs very fast right legs blurring', 'leapt right arms wide', 'swam left arms pulling', 'has swum right legs kicking'];
  const [ok18, missed18] = all(wider, 'walking', 'direction');
  check('A18: the wider list of travel verbs, and up to two words between the verb and the side', ok18 && motionCatch('jump right arms up', 'jump') === 'direction' && motionCatch('hop left feet together', 'jump') === 'direction', missed18);
  check('A19: but three words between is too far, and a verb not on the list is not one', motionCatch('walks with a big left arm swing', 'walking') === null && motionCatch('struts left thumbs in belt', 'walking') === null && motionCatch('walk. raise left arm', 'walking') === null);
  check('A20: a known false alarm of that rule: "walking stick in right hand"', motionCatch('walking stick in right hand', 'attack') === 'direction');
  const sides = ['left-legged kick', 'right legged stance', 'left-eyed stare', 'right cross', 'right punch', 'left punches', 'left and right arms swing', 'right and left fists up', 'right upper arm flex', 'left lower leg sweep', 'left talon strike', 'right talons out', 'left crosses'];
  const [ok21, loud21] = all(sides, 'attack', null);
  check('A21: more body sides: "-legged" and "-eyed", punch, cross and talon, "upper" and "lower" between, "left and right" before a part', ok21 && all(sides, 'walking', null)[0], loud21);
  check('A22: the word before a body side stays in the text: "turns left arm raised" keeps its "turns"; and a place after a hyphen is a place: "to the right-hand-side"', motionCatch('turns left arm raised', 'attack') === 'direction' && motionCatch('to the right-hand-side', 'walking') === 'direction' && motionCatch('to the left hand-side', 'attack') === 'direction');
  const upDown = ['walk up', 'walk down', 'walking away', 'walks slowly upward', 'runs downwards', 'steps back down', 'marching up the hill', 'goes far away', 'walk upwards', 'walks very slowly down'];
  const [ok23, missed23] = all(upDown, 'walking', 'direction');
  const notWalk = ['idle', 'attack', 'jump', 'crouch'].flatMap((a) => upDown.concat(['jump up', 'leap up and slash']).filter((t) => motionCatch(t, a) !== null).map((t) => `${a}: ${t}`));
  check('A23: on Walk a verb of travel then "up", "down" or "away" is a direction; on no other action', ok23 && notWalk.length === 0, [...missed23, ...notWalk]);
  check('A24: but "up" and "down" without a verb of travel, or three words after it, are not: "arms up", "head down", "walks with both arms up"', all(['arms up', 'head down', 'looking away', 'walks with both arms up', 'warm up', 'upbeat walk', 'walk downtown'], 'walking', null)[0]);
  const seen = ['from behind', 'seen from the side', 'from one side', 'from a side', 'from either side', 'side profile', 'side-profile', 'sideprofile'];
  const loudSeen = ['attack', 'jump', 'crouch', 'destroy'].flatMap((a) => ['stab from behind', 'strike from the side', 'side profile'].filter((t) => motionCatch(t, a) !== null).map((t) => `${a}: ${t}`));
  check('A25: where the character is seen from ("from behind", "from the side", "side profile") is a direction on Walk and Idle, and the motion on the others', all(seen, 'walking', 'direction')[0] && all(seen, 'idle', 'direction')[0] && loudSeen.length === 0 && motionCatch('from the sideline', 'idle') === null && motionCatch('sides profile', 'idle') === null && same([...SEEN_FROM_ACTIONS], ['walking', 'idle']), loudSeen);
  const pairs = ['slash from left to right', 'sways left and right', 'right to left sweep', 'swing left-to-right', 'rocks side to side', 'side-to-side sway', 'bobs back and forth', 'looks right and left', 'from right to left'];
  pairs.push('sways left and right, then right to left', 'left to right arm swing', 'rocks left and right, side to side, back and forth');
  const loudPairs = ['idle', 'attack', 'jump'].flatMap((a) => pairs.filter((t) => motionCatch(t, a) !== null).map((t) => `${a}: ${t}`));
  check('A26: on Idle, Attack and Jump a pair of sides is a motion and gets no line, every pair in the text, and before the body-side rule ("left to right arm swing")', loudPairs.length === 0 && same([...PAIR_QUIET_ACTIONS], ['idle', 'attack', 'jump']), loudPairs);
  check('A27: on Walk a pair still counts, and on every one of the four a single side does', all(['paces left and right', 'walks from left to right', 'right to left'], 'walking', 'direction')[0] && ['walking', 'idle', 'attack', 'jump'].every((a) => motionCatch('attack from the left', a) === 'direction' && motionCatch('left to right, then facing left', a) === 'direction' && motionCatch('left to the right', a) === 'direction'));
  check('A28: "side views" asks for many on Walk and Idle and is a direction on Attack and Jump; "side view" is a direction on all four', same(['walking', 'idle', 'attack', 'jump', 'crouch'].map((a) => motionCatch('side views', a)), ['directions', 'directions', 'direction', 'direction', null]) && same(['walking', 'idle', 'attack', 'jump'].map((a) => motionCatch('side view', a)), ['direction', 'direction', 'direction', 'direction']));
  // Run apart from this process, with a clock on it: a pattern that
  // backtracks cannot be stopped from inside, and the form runs the matcher
  // on every render.
  const hard = `
    const { motionCatch } = await import(${JSON.stringify(pathToFileURL(path.join(OUT_DIR, 'motionWords.mjs')).href)});
    const texts = ['walk slowly '.repeat(2000) + 'x', 'from the '.repeat(3000) + 'x', 'side-'.repeat(3000) + 'x', 'left and '.repeat(2000) + 'x', 'a b c '.repeat(2000) + 'left', 'left to '.repeat(2000) + 'x', 'walk up'.repeat(2000) + 'x', 'left '.repeat(600), 'left-'.repeat(2000), ' -'.repeat(5000), 'right hand '.repeat(1000) + 'side', 'walk '.repeat(3000) + 'right', 'a'.repeat(20000), '8 '.repeat(4000) + 'direction', 'to the '.repeat(3000) + 'side', ('x'.repeat(30) + ' ').repeat(700) + 'left arm', 'left' + '-'.repeat(34) + 'x', 'right ' + '- '.repeat(30) + 'q', 'left' + ' '.repeat(40) + 'x'];
    const t0 = performance.now();
    for (const text of texts) for (const action of ${JSON.stringify(EVERY_ACTION)}) motionCatch(text, action);
    if (motionCatch('walk '.repeat(3000) + 'right', 'walking') !== 'direction') process.exit(3);
    // Reached only when no earlier pattern answers: the last patterns of the matcher.
    if (motionCatch('x '.repeat(3000) + 'side profile', 'idle') !== 'direction') process.exit(4);
    if (motionCatch('step '.repeat(1500) + 'slowly away', 'walking') !== 'direction') process.exit(5);
    process.exit(performance.now() - t0 < 1000 ? 0 : 2);
  `;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', hard], { timeout: 5000, encoding: 'utf8' });
  check('A17: long and repetitive texts are answered at once and never throw', ran.status === 0, { status: ran.status, signal: ran.signal, err: (ran.stderr ?? '').slice(0, 200) });
}

// ---- B. more than one direction ----
{
  const real = 'Full 8-frame walk cycle, 8-directional movement sprite sheet (front, back, left, right)';
  check('B1: the 8-direction request people really typed gets the directions line, on Walk, Attack and Custom action', same(['walking', 'attack', 'custom_action'].map((a) => motionCatch(real, a)), ['directions', 'directions', 'directions']));
  const plain = ['8-direction', '8 direction', '8direction', '8-directional', '8 directions', 'eight direction', 'eight directions', '4-direction', '4 direction', '4-directional', '4 directions', 'four direction', 'four directions', 'multi-direction', 'multi direction', 'multidirectional', 'multi-directions', '4-angle', '4 angle', 'four-angle', '16 directions', 'sixteen directions', '16-directional', '8dir', '8-dir', '4dir', '4 dirs', '16dirs', '16 dir'];
  const missed = plain.filter((w) => !EVERY_ACTION.every((a) => motionCatch(`walk cycle, ${w} sheet`, a) === 'directions'));
  check('B2: asking for many directions in so many words is caught on every action', missed.length === 0, missed);
  const loose = ['4 angles', 'four angles', '8 angles', '8-angle', 'eight angles', '16 angles', '2-way', 'two-way', '2 ways', '16-way', 'turn-around', 'turn-arounds', 'side views', 'front views', 'back-views', 'all directions', 'every direction', 'both directions', 'multiple directions', 'rotation', 'rotate', 'rotates', 'rotated', 'rotating', '360', '8-way', '8 way', 'eight-way', '4-way', 'four way', '4 ways', '8 ways', 'turnaround', 'turnarounds'];
  const missedLoose = loose.filter((w) => !['walking', 'idle'].every((a) => motionCatch(`cycle, ${w} sheet`, a) === 'directions'));
  const loudLoose = loose.filter((w) => !['attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action'].every((a) => motionCatch(`cycle, ${w} sheet`, a) !== 'directions'));
  check('B3: the looser ways ("all directions", "rotating", "360", "8-way", "turnaround") count on Walk and Idle', missedLoose.length === 0 && same([...LOOSE_DIRECTIONS_ACTIONS], ['walking', 'idle']), missedLoose);
  check('B4: and on no other action, where they are about the motion', loudLoose.length === 0 && motionCatch('cycle, 8-way sheet', 'attack') === null && motionCatch('cycle, 4 angles sheet', 'jump') === null, loudLoose);
  check('B5: so these get no line: pieces flying, a 360 flip, a rotating blade, a rotating coin, an 8-way shot, a turnaround kick', motionCatch('pieces fly in all directions', 'destroy') === null && motionCatch('360 flip', 'jump') === null && motionCatch('rotating blade', 'attack') === null && motionCatch('360 spin attack', 'attack') === null && motionCatch('coin rotating', 'custom_action') === null && motionCatch('8-way shot', 'attack') === null && motionCatch('turnaround kick', 'attack') === null && motionCatch('four way explosion', 'destroy') === null && motionCatch('turnaround jump shot', 'jump') === null);
  check('B6: it wins over the direction line', motionCatch('walk left and right in all directions', 'walking') === 'directions' && motionCatch('4-angle sheet, facing left', 'attack') === 'directions' && motionCatch('turnaround to the left', 'attack') === 'direction');
  check('B7: "left and right" and "front and back" alone are about legs: the direction line on Walk, nothing on Crouch', motionCatch('legs move left and right', 'walking') === 'direction' && motionCatch('legs move left and right', 'crouch') === null && motionCatch('sways front and back', 'crouch') === null);
  check('B8: "turn around" in two words is a direction word, not a request for many', motionCatch('turn around', 'walking') === 'direction' && motionCatch('turned around', 'idle') === 'direction' && motionCatch('turn around', 'crouch') === null);
  const quiet = ['8 frames', '4 steps', 'a 360p look', 'direction', 'in one direction', 'corrode', '3600', 'eight frames', 'halfway', 'one way', 'a 4 angled blade', 'triangle', 'four wayward steps', '14 ways', '48 directions', 'a wayside inn', 'turnaroundish', 'dirt', '4 dirty rats', '48dir', '116 dirs', '8 dire wolves', '3-way', '4 angled cuts', 'a turn around the corner is not asked'].filter((w) => w !== 'a turn around the corner is not asked');
  const [ok9, loud] = all(quiet, 'crouch', null);
  check('B9: numbers and "direction" on their own are not a request for many', ok9 && all(quiet, 'walking', null)[0], loud);
  const spaced = ['8  direction sheet', 'all\ndirections', 'multi\tdirectional', 'every  direction', '8 - direction sheet', 'multi - directional', '4 - way walk'];
  const [ok10, missed10] = all(spaced, 'walking', 'directions');
  check('B10: any gap between the words of a phrase reads as one space, and a hyphen with spaces round it as a hyphen', ok10, missed10);
  check('B11: the many-directions line\'s own words, typed back, are caught: "walking 4 ways"', motionCatch('a new character walking 4 ways', 'walking') === 'directions');
  check('B12: "N angles" counts on Walk and Idle only; "4-angle", the style\'s own name, on every action', motionCatch('strike from 4 angles', 'attack') === null && motionCatch('seen from 8 angles', 'jump') === null && motionCatch('4 angles', 'walking') === 'directions' && motionCatch('8-angle walk', 'idle') === 'directions' && EVERY_ACTION.every((a) => motionCatch('4-angle slash', a) === 'directions'));
  check('B13: "turn-around" with a hyphen asks for many on Walk and Idle; "turn around" in two words stays a direction word', motionCatch('turn-around sheet', 'walking') === 'directions' && motionCatch('turn - around sheet', 'idle') === 'directions' && motionCatch('turn around', 'walking') === 'direction' && motionCatch('turn-around kick', 'attack') === 'direction');
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
  check('C5: the direction line says what to do on Create, with the style, its cost and the words to start the description with', directionLine('Platformer', 40) === `The animation keeps the way your character faces, so direction words in the motion box are ignored. To walk sideways, make a side view first: on Create, pick Platformer${nbsp}(40${nbsp}${coin}) and start your description with "facing right, side view, full body".`);
  check('C6: the directions line says to make a picture for each direction, and that the 4-direction style draws a new character', directionsLine('4-Angle Walking', 25) === `One animation makes one direction. For each other direction, make a picture of your character facing that way and animate it. For a new character walking 4 ways, 4-Angle Walking on Create${nbsp}(25${nbsp}${coin}) draws all four from a description.`);
  check('C7: both lines carry the name and the cost they are given; the cost stays with its coin and with the word before it', directionLine('Top-Down', 7).includes(`pick Top-Down${nbsp}(7${nbsp}${coin}) and`) && directionsLine('Walk Sheet', 9).includes(`Walk Sheet on Create${nbsp}(9${nbsp}${coin}) draws`) && !/ \(/.test(directionLine('x', 1) + directionsLine('x', 1)));
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
  const flat = (t) => t.replace(/\s+/g, ' ').trim();
  const srcFlat = flat(src);
  const has = (code) => srcFlat.includes(flat(code));

  // ENG's condition, whole: AnimateForm.tsx is a freeze file and this change
  // is display only. REGIONS are the display lines: each is found by its
  // first line (which occurs once in the file) and runs to the first line
  // equal to its last; its bytes are pinned by sha256; "was" is what the
  // baseline has there. Undoing every region must give the baseline, byte
  // for byte (its git blob). So a change anywhere outside the regions fails
  // here, and so does a change inside one.
  const BASE_BLOB = 'e2eb4625e398df77ca094991d780c282fd04d2bd';
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
      sha256: 'dfbd680f0080e21330b27c68f606cc9eed6c319653ce5154e1e0e74728a1c482',
      was: [
        "  const isCustomAction = selectedAction === 'custom_action';",
      ],
    },
    {
      start: "            {/* Under 480 px the text takes a row of its own under the",
      end: "            <div className=\"flex flex-wrap items-start gap-4\">",
      sha256: 'e79346d50a2688e434db6aed8177bd7e4818222d7262d5c8f9bbbbd5ec89e3d1',
      was: [
        "            <div className=\"flex items-start gap-4\">",
      ],
    },
    {
      start: "              <div className=\"flex-1 min-w-0 max-[480px]:order-last max-[480px]:basis-full\">",
      end: "              <div className=\"flex-1 min-w-0 max-[480px]:order-last max-[480px]:basis-full\">",
      sha256: 'e33655d5636d17f3fedc51c95267038134cb422dc758264ae4328903eef5f6f0',
      was: [
        "              <div className=\"flex-1 min-w-0\">",
      ],
    },
    {
      start: "                <p className=\"text-xs font-mono text-text-muted mt-1\">",
      end: "                <p className=\"text-xs font-mono text-text-muted mt-1\">",
      sha256: '617f746f448e4259140288593a43532a78c4bece13d2ce8c5f9765653898ea8a',
      was: [
        "                <p className=\"text-[10px] font-mono text-text-muted mt-1\">",
      ],
    },
    {
      start: "                  <p className=\"text-xs font-mono text-red-400 mt-1\">",
      end: "                  <p className=\"text-xs font-mono text-red-400 mt-1\">",
      sha256: '8c13ae29286b02b8e0fdfa64d1706b9c48767f32db4303c40c2fc0a5222a67fc',
      was: [
        "                  <p className=\"text-[10px] font-mono text-red-400 mt-1\">",
      ],
    },
    {
      start: "                  <p className=\"text-xs font-mono text-green-400 mt-1\">",
      end: "                  <p className=\"text-xs font-mono text-green-400 mt-1\">",
      sha256: '8b905396446eccbc22d6590f197e46d28028d6f0638dabf0da2d074196b85a7f',
      was: [
        "                  <p className=\"text-[10px] font-mono text-green-400 mt-1\">",
      ],
    },
    {
      start: "                className=\"ml-auto flex-shrink-0 p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer\"",
      end: "                className=\"ml-auto flex-shrink-0 p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer\"",
      sha256: 'b8e71203ada1f233f462a315e3f2ab60cd695584171137dfb7790d8e8219034b',
      was: [
        "                className=\"flex-shrink-0 p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer\"",
      ],
    },
    {
      start: "            <p className=\"text-sm font-mono text-text-secondary text-center mb-1\">",
      end: "            <p className=\"text-sm font-mono text-text-secondary text-center mb-1\">",
      sha256: '520c73147fe8ff2dbb27bed8f8891e26374d393d8605cbdae4336802bd5bc3aa',
      was: [
        "            <p className=\"text-sm font-mono text-text-secondary mb-1\">",
      ],
    },
    {
      start: "            <p className=\"text-xs font-mono text-text-secondary text-center text-balance mb-1\">",
      end: "            <p className=\"text-xs font-mono text-text-muted text-center mb-3\">",
      sha256: '624cfa3b1825f48d12d02985ce2acb8d82543f4617cab2ced02b8a343f902c4f',
      was: [
        "            <p className=\"text-[10px] font-mono text-text-muted mb-3\">",
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
      start: "          onChange={(e) => {",
      end: "          aria-required={isCustomAction}",
      sha256: 'b40c2d272b26028ab3fa2a52c8e0ca246b8b5ecc3a2e77eec192ca427e8ee25e',
      was: [
        "          onChange={(e) => setMotionPrompt(e.target.value)}",
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
      end: "          {MOTION_HELP}",
      sha256: 'ae9d561cacf750db5456ea0b0c32f8d53cf3d3d70e78ac1ebff320b49b1ef480',
      was: [
        "        <p className=\"text-[9px] font-mono text-text-muted/70 mt-1\">",
        "          For best character fidelity, leave blank or use minimal descriptions.",
        "          Detailed prompts may alter your character&apos;s appearance.",
      ],
    },
    {
      start: "        {/* The line. Empty when the text asks for nothing an animation cannot",
      end: "          )}",
      sha256: 'ee0d1a2e5f3cd7a7d5daaacf3f87ac462f738bb54378ab04ab01bfd6a824048a',
      was: [
        "      </div>",
        "",
        "      {/* Note about constraints */}",
        "      <div className=\"text-[9px] font-mono text-text-muted/70 border-t border-border-subtle pt-3 space-y-1\">",
        "        <p>",
        "          Generates a single-direction sprite strip \u2014 generate separately for each",
        "          direction if you need a full 4-direction sheet.",
      ],
    },
    {
      start: "        {/* Always in the page, so a screen reader hears a new line once. */}",
      end: "          {motionSpoken}",
      sha256: 'be0b21c0618fb83337fce8a6d47a824d414735d89204d07c289418ccd7c49987',
      was: [
        "        <p>",
        "          For best results, your character should be on a solid color background",
        "          that contrasts with the character.",
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
  if (undone !== BASE_BLOB) wrong.push(`with the display lines undone the file is blob ${undone}, not the baseline`);
  if (process.env.MOTION_WORDS_PINS) console.log(`pins  ${JSON.stringify({ regions: pins, undone })}`);
  check('D0: with the display lines undone, the form is the freeze baseline byte for byte, and each display region is as reviewed', wrong.length === 0, wrong);

  // The whole callback that builds and sends the request, byte for byte as
  // in the baseline (the blob BASE_BLOB).
  const a = raw.indexOf('  const handleGenerate = useCallback(async () => {');
  const b = raw.indexOf('\n  ]);', a) + '\n  ]);'.length;
  const hash = sha256(raw.slice(a, b));
  check('D1: the callback that builds and sends the request is byte for byte the baseline\'s', a > 0 && hash === 'b8c0a475506358935c3d0f8124b8aa7d06d2212048e8c1651b88f573df2bc95d', hash);
  check('D2: the motion text is still written in three places only (a restore, a template, the box), and sent trimmed; a key counts, a paste, a drop or a cut does not', (src.match(/setMotionPrompt\(/g) ?? []).length === 3 && /motionPrompt: motionPrompt\.trim\(\),/.test(src) && has(`onChange={(e) => { setMotionPrompt(e.target.value); const how = (e.nativeEvent as InputEvent).inputType ?? ''; if (!/^(?:insertFrom|deleteBy)/.test(how)) setMotionKeys((n) => n + 1); }}`) && (src.match(/setMotionKeys\(/g) ?? []).length === 1);
  check('D3: only a key waits a moment after the last key; any other change of the text (even to a text typed before), and a change of action, are taken at once; the request never reads any of it', has(`
    const [motionKeys, setMotionKeys] = useState(0);
    const [motionSeen, setMotionSeen] = useState({ text: motionPrompt, keys: 0, typed: false });
    if (motionSeen.text !== motionPrompt || motionSeen.keys !== motionKeys) {
      setMotionSeen({ text: motionPrompt, keys: motionKeys, typed: motionSeen.keys !== motionKeys });
    }
    const [motionSettled, setMotionSettled] = useState({ text: '', action: selectedAction });
    const motionWaits = motionSeen.typed && motionSeen.text === motionPrompt && motionSettled.action === selectedAction;
    useEffect(() => {
      const settle = () =>
        setMotionSettled((was) =>
          was.text === motionPrompt && was.action === selectedAction ? was : { text: motionPrompt, action: selectedAction },
        );
      if (!motionWaits) {
        settle();
        return;
      }
      const timer = setTimeout(settle, MOTION_CATCH_DELAY_MS);
      return () => clearTimeout(timer);
    }, [motionPrompt, selectedAction, motionWaits]);
    const motionText = motionWaits ? motionSettled.text : motionPrompt;
    const motionCaught = motionCatch(motionText, selectedAction);`) && !/motion(?:Caught|Settled|Spoken|Line|Text|Keys|Seen|Waits)/.test(raw.slice(a, b)) && (src.match(/setMotionSettled\(/g) ?? []).length === 1 && (src.match(/setMotionSeen\(/g) ?? []).length === 1);
  check('D4: the right line for each catch, its names and costs from the registry', /const sideViewStyle = getStyleById\(SIDE_VIEW_STYLE_ID\);\s*const fourAngleStyle = getStyleById\(FOUR_ANGLE_STYLE_ID\);\s*const motionCaughtLine =\s*motionCaught === 'directions' && fourAngleStyle\s*\? directionsLine\(fourAngleStyle\.label, fourAngleStyle\.tokenCost\)\s*: motionCaught === 'direction' && sideViewStyle\s*\? directionLine\(sideViewStyle\.label, sideViewStyle\.tokenCost\)\s*: null;/.test(src));
  check('D5: the box has its own id, its label and example from the library, the help line as its description, and says when it is required', /const motionBoxId = useId\(\);\s*const motionHelpId = useId\(\);/.test(src) && /<label htmlFor=\{motionBoxId\} className="block text-xs font-mono text-text-secondary mb-1">\s*\{motionLabel\(isCustomAction\)\}/.test(src) && /<textarea\s*id=\{motionBoxId\}/.test(src) && /placeholder=\{motionPlaceholder\(selectedAction\)\}\s*aria-describedby=\{motionHelpId\}\s*aria-required=\{isCustomAction\}/.test(src) && /<p id=\{motionHelpId\} className="text-xs font-mono text-text-secondary mt-1">\s*\{MOTION_HELP\}/.test(src));
  check('D6: the line is amber, 12 px, with an icon a screen reader skips, in a paragraph that is always in the page', /<p\s*ref=\{motionLineRef\}\s*style=\{motionLineRoom > 0 \? \{ minHeight: motionLineRoom \} : undefined\}\s*className="text-xs font-mono text-accent-amber"\s*>\s*\{motionCaughtLine !== null && \(\s*<span className="pt-1 flex items-start gap-1\.5">\s*<Info size=\{14\} className="mt-0\.5 shrink-0" aria-hidden="true" \/>\s*<span>\{motionCaughtLine\}<\/span>/.test(src));
  check('D7: the old example and the two small lines are gone', !/walking forward, sword swing/.test(raw) && !/For best character fidelity/.test(raw) && !/less is more\)'\}/.test(raw));
  const block = src.slice(src.indexOf('<label htmlFor={motionBoxId}'), src.indexOf('{motionSpoken}'));
  check('D8: nothing in the motion block is under 12 px: its label, box, help line and line are each 12 px, and no size is written in pixels', block.length > 200 && !/text-\[[^\]]*\]/.test(block) && !/text-(?:2xs|\[)/.test(block) && (block.match(/text-xs/g) ?? []).length >= 4 && /<label htmlFor=\{motionBoxId\} className="block text-xs /.test(block) && /text-xs font-mono text-text-primary placeholder:text-text-secondary/.test(block) && /<p id=\{motionHelpId\} className="text-xs /.test(block) && /className="text-xs font-mono text-accent-amber"/.test(block));
  check('D9: its words are readable: the label, the example and the help line use the secondary color, not the muted one', !/text-text-muted/.test(block) && /placeholder:text-text-secondary/.test(block));
  check('D10: the old one-direction sentence and the always-on background note under the form are gone, border and all', !/single-direction sprite strip/.test(raw) && !/full 4-direction sheet/.test(raw) && !/For best results/.test(raw) && !/solid color background/.test(raw) && !/Note about constraints/.test(raw) && !/border-t border-border-subtle pt-3/.test(raw));
  check('D11: Generate does not look at the line', !/motion(?:Caught|Settled|Spoken|Line|Text)/.test(src.slice(src.indexOf('Generate Animation (') - 1500, src.indexOf('Generate Animation ('))) && !/disabled=\{[^}]*motion(?:Caught|Settled|Spoken|Line|Text)/.test(src) && !/canGenerate[^;\n]*motion(?:Caught|Settled|Spoken|Line|Text)/.test(src));
  check('D12: the room a line took stays: a min-height that only grows, the real height rounded up, kept current while the line shows', /const keepRoom = \(\) => setMotionLineRoom\(\(room\) => Math\.max\(room, Math\.ceil\(line\.getBoundingClientRect\(\)\.height\)\)\);\s*keepRoom\(\);\s*if \(typeof ResizeObserver === 'undefined'\) return;\s*const observer = new ResizeObserver\(keepRoom\);\s*observer\.observe\(line\);\s*return \(\) => observer\.disconnect\(\);\s*\}, \[motionCaughtLine\]\);/.test(src) && (src.match(/setMotionLineRoom\(/g) ?? []).length === 1);
  check('D13: a line is said once, when it appears or changes, by a status that is always in the page; back soon for a text that only grew from the text that last showed it, it is not said again', /<p role="status" aria-live="polite" className="sr-only">\s*\{motionSpoken\}\s*<\/p>/.test(src) && has(`
    const motionLineLastRef = useRef<{ line: string; text: string } | null>(null);
    useEffect(() => {
      if (motionCaughtLine === null) {
        if (motionLineShownRef.current !== null) {
          motionLineShownRef.current = null;
          motionLineGoneAtRef.current = Date.now();
        }
        return;
      }
      const shown = motionLineShownRef.current;
      const last = motionLineLastRef.current;
      motionLineShownRef.current = motionCaughtLine;
      motionLineLastRef.current = { line: motionCaughtLine, text: motionText };
      if (shown === motionCaughtLine) return;
      const backSoon = Date.now() - motionLineGoneAtRef.current < MOTION_SPEAK_AGAIN_MS;
      if (last !== null && last.line === motionCaughtLine && backSoon && motionText.startsWith(last.text)) return;
      setMotionSpoken(motionCaughtLine);
    }, [motionCaughtLine, motionText]);`) && (block.match(/aria-live="polite"/g) ?? []).length === 1 && !/<p[^>]*ref=\{motionLineRef\}[^>]*(?:role|aria-live)/.test(src));
  check('D14: the words stay in the status for their moment whatever the line does, then leave it', /useEffect\(\(\) => \{\s*if \(motionSpoken === ''\) return;\s*const clear = setTimeout\(\(\) => setMotionSpoken\(''\), MOTION_SPOKEN_CLEAR_MS\);\s*return \(\) => clearTimeout\(clear\);\s*\}, \[motionSpoken\]\);/.test(src) && (src.match(/setMotionSpoken\(/g) ?? []).length === 2);
  check('D15: the hidden status is laid out inside the motion block (a positioned block), not against the document, so it adds no height to the page', /<div className="relative">\s*<label htmlFor=\{motionBoxId\}/.test(src) && src.indexOf('<div className="relative">\n        <label htmlFor={motionBoxId}') < src.indexOf('className="sr-only">\n          {motionSpoken}') && !/sr-only/.test(src.slice(src.indexOf('{motionSpoken}') + 20, src.indexOf('{motionSpoken}') + 400)));
  check('D16: on touch screens, and in a window under 340 px wide, the box has room for three lines of example text', /\[@media\(hover:none\)_and_\(pointer:coarse\)\]:min-h-\[calc\(3lh\+1rem\+2px\)\]\s*max-\[340px\]:min-h-\[calc\(3lh\+1rem\+2px\)\]"/.test(block) && /rows=\{2\}/.test(block));
  check('D17: nothing on the page moves after the last key: the form scrolls nothing (DESIGN 2026-11-14-236 withdrew the scroll into view)', !/scrollBy\(|scrollIntoView\(|scrollTo\(|scrollTop\s*=|generateBarRef/.test(src));
  const zone = src.slice(src.indexOf('Drop your pixel art character here'), src.indexOf('Browse files'));
  check('D18: the background advice is one line in the empty drop zone, between its title and its formats line, 12 px in the secondary color, and nowhere else; the zone\'s three lines are centred', has(`
<p className="text-sm font-mono text-text-secondary text-center mb-1">
      Drop your pixel art character here
    </p>
    <p className="text-xs font-mono text-text-secondary text-center text-balance mb-1">
      Works best on a plain background in a color your character doesn&apos;t use.
    </p>
    <p className="text-xs font-mono text-text-muted text-center mb-3">
      PNG, JPG, or WebP &middot; any size, we&apos;ll auto-crop and resize
    </p>`) && (raw.match(/plain background/g) ?? []).length === 1 && src.indexOf('Works best on a plain background') > src.indexOf(') : pendingDataUrl ? null : (') && zone.length > 100 && !/text-\[/.test(zone));
  const card = src.slice(src.indexOf('Character ready'), src.indexOf('aria-label="Remove character"'));
  check('D19: the loaded character card has no text under 12 px, and under 480 px its text takes a row of its own under the picture', card.length > 200 && !/text-\[/.test(card) && (card.match(/text-xs font-mono/g) ?? []).length === 3 && has(`<p className="text-xs font-mono text-text-muted mt-1"> {charWidth}x{charHeight}`) && has(`<p className="text-xs font-mono text-red-400 mt-1"> Prepared at`) && has(`<p className="text-xs font-mono text-green-400 mt-1"> Ready for animation`) && has(`<div className="flex flex-wrap items-start gap-4">`) && has(`<div className="flex-1 min-w-0 max-[480px]:order-last max-[480px]:basis-full"> <p className="text-xs font-mono text-text-primary">Character ready</p>`) && has(`aria-label="Remove character" className="ml-auto flex-shrink-0 p-1.5 rounded`));
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
