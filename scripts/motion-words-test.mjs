// scripts/motion-words-test.mjs
//
// Offline tests for src/lib/motionWords.ts, the prompt help under Animate's
// motion box (DESIGN design/tickets/prompt-help-v1a.md; HQ 2026-11-11-075):
// which motion texts get a line, which do not, the words of the lines, and
// the example text per action. Also pins what AnimateForm must keep, which
// has no browser test here: the request is built exactly as it was before
// Prompt help (ENG's condition for a touch of a freeze file), and the line
// never blocks Generate. D1 holds the callback that builds and sends the
// request, byte for byte, and D22 and D23 hold, each by its own hash, the
// parts that make the picture sent and finish the job (the decoder, the
// encoder, the poll and its effects, the gate, Use This, and Auto-Prep's
// two stages and its accept), as they were before G4. D0 only says the form
// changed: since G4 moved its blocks (HQ 2026-11-18-051) its baseline is
// G4's reviewed file, git blob BASE_BLOB, so any later change to
// AnimateForm.tsx fails D0 until it is reviewed and the new blob is pinned.
// MOTION_WORDS_PINS=1 prints the blob as the file now stands; compare the
// file with the baseline yourself first, because a new pin makes D0 pass
// whatever it was given.
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
  motionCatch, motionPlaceholder, motionLabel, directionsLine, motionLine, askedFacing, SIDE_LINE, LEFT_LINE, MOTION_HELP, MOTION_CATCH_DELAY_MS,
  MOTION_SPEAK_AGAIN_MS, MOTION_SPOKEN_CLEAR_MS, DIRECTION_ACTIONS, LOOSE_DIRECTIONS_ACTIONS, PAIR_QUIET_ACTIONS, SEEN_FROM_ACTIONS, SIDE_VIEW_STYLE_ID, FOUR_ANGLE_STYLE_ID,
  FORWARD_ACTIONS, TURN_ACTIONS,
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
  const each = ['sideway', 'to a side', 'left', 'right', 'leftward', 'rightward', 'leftwards', 'rightwards', 'sideways', 'to the side', 'to one side', 'side view', 'front view', 'back view', 'side-view', 'front-view', 'back-view', 'sideview', 'frontview', 'backview', 'to either side', 'towards', 'toward', 'forward', 'forwards', 'backward', 'backwards', 'facing', 'lower left', 'lower right', 'upper left', 'upper right'];
  const [ok2, missed2] = all(each.map((w) => `walks ${w} slowly`), 'walking', 'direction');
  // A turn with no side is the motion on Walk and Idle, and a direction on Attack and Jump (DESIGN, room 2026-11-14-320).
  const turns = ['turn', 'turns', 'turned', 'turning', 'turn around', 'turned around'];
  const [ok2t, missed2t] = all(turns.map((w) => `jumps and ${w} slowly`), 'attack', 'direction');
  check('A2: every word and phrase on the list is caught; a turn on Attack and Jump', ok2 && ok2t && all(turns.map((w) => `jumps and ${w} slowly`), 'jump', 'direction')[0], [...missed2, ...missed2t]);
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
  check('A12: the two false alarms accepted on the ticket are gone: "forward lunge" on Attack and "turn the page" on Idle get no line (DESIGN, room 2026-11-14-320)', motionCatch('forward lunge', 'attack') === null && motionCatch('turn the page', 'idle') === null);
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
  const seen = ['seen from behind', 'viewed from behind', 'shown from behind', 'a view from behind', 'from behind view', 'seen from the side', 'from one side', 'from a side', 'from either side', 'side profile', 'side-profile', 'sideprofile'];
  const loudSeen = ['attack', 'jump', 'crouch', 'destroy'].flatMap((a) => ['stab from behind', 'strike from the side', 'side profile'].filter((t) => motionCatch(t, a) !== null).map((t) => `${a}: ${t}`));
  check('A25: where the character is seen from ("seen from behind", "from the side", "side profile") is a direction on Walk and Idle, and the motion on the others; on Idle "from behind" without a word for seeing is the motion ("wind from behind", DESIGN, room 2026-11-14-320: table B names Idle); on Walk it counts alone, as on main (AUDIT v1a step 3 r1, M2)', all(seen, 'walking', 'direction')[0] && all(seen, 'idle', 'direction')[0] && loudSeen.length === 0 && all(['wind from behind', 'from behind', 'pushed from behind'], 'idle', null)[0] && all(['wind from behind', 'walk cycle from behind', 'walking from behind', 'run cycle from behind'], 'walking', 'direction')[0] && motionCatch('from the sideline', 'idle') === null && motionCatch('sides profile', 'idle') === null && same([...SEEN_FROM_ACTIONS], ['walking', 'idle']), loudSeen);
  const pairs = ['slash from left to right', 'sways left and right', 'right to left sweep', 'swing left-to-right', 'rocks side to side', 'side-to-side sway', 'bobs back and forth', 'looks right and left', 'from right to left'];
  pairs.push('sways left and right, then right to left', 'left to right arm swing', 'rocks left and right, side to side, back and forth');
  const loudPairs = ['idle', 'attack', 'jump'].flatMap((a) => pairs.filter((t) => motionCatch(t, a) !== null).map((t) => `${a}: ${t}`));
  check('A26: on Idle, Attack and Jump a pair of sides is a motion and gets no line, every pair in the text, and before the body-side rule ("left to right arm swing")', loudPairs.length === 0 && same([...PAIR_QUIET_ACTIONS], ['idle', 'attack', 'jump']), loudPairs);
  check('A27: on Walk a pair still counts, and on every one of the four a single side does', all(['paces left and right', 'walks from left to right', 'right to left'], 'walking', 'direction')[0] && ['walking', 'idle', 'attack', 'jump'].every((a) => motionCatch('attack from the left', a) === 'direction' && motionCatch('left to right, then facing left', a) === 'direction' && motionCatch('left to the right', a) === 'direction'));
  check('A28: "side views" asks for many on Walk and Idle and is a direction on Attack and Jump; "side view" is a direction on all four', same(['walking', 'idle', 'attack', 'jump', 'crouch'].map((a) => motionCatch('side views', a)), ['directions', 'directions', 'direction', 'direction', null]) && same(['walking', 'idle', 'attack', 'jump'].map((a) => motionCatch('side view', a)), ['direction', 'direction', 'direction', 'direction']));
  // DESIGN's lists of room 2026-11-14-320 (table A: new catches; table B: quiet, as motion).
  check('A29: the new verbs of travel (pace, jog, wander, trot) count like the others on Walk', all(['jogs away', 'pacing left', 'trots right', 'wanders away', 'jogged down', 'pace up'], 'walking', 'direction')[0] && motionCatch('jogs away', 'idle') === null);
  const compass = ['walk north', 'walking south', 'walks east', 'runs west', 'jogs northeast', 'walks north-east', 'walk north - west', 'wander southwest', 'walks slowly northward', 'march eastwards'];
  check('A30: on Walk a verb of travel then a compass word is a direction; a compass word alone, or on another action, is not; "facing north" is a direction on Walk and Idle', all(compass, 'walking', 'direction')[0] && all(['north wind blows', 'eastern armour', 'a westerly breeze'], 'walking', null)[0] && all(['walk north', 'walks east'], 'idle', null)[0] && motionCatch('facing north', 'walking') === 'direction' && motionCatch('facing north', 'idle') === 'direction', all(compass, 'walking', 'direction')[1]);
  check('A31: "diagonally" or "diagonal" after a verb of travel is a direction on Walk; a diagonal slash is not', all(['walk diagonally', 'walks diagonal', 'moves slowly diagonally'], 'walking', 'direction')[0] && motionCatch('diagonal stripes on the cape', 'walking') === null && motionCatch('walk diagonally', 'attack') === null);
  const views = ['top-down walk', 'top down', 'top - down idle', 'isometric walk', '3/4 view', 'three-quarter view', 'three quarter view', 'profile view', 'profile-view walk'];
  check('A32: a view (top-down, isometric, 3/4, three-quarter, profile) is a direction on Walk and Idle and nothing on Attack and Jump', all(views, 'walking', 'direction')[0] && all(views, 'idle', 'direction')[0] && all(['isometric slash', 'top-down jump', '3/4 view'], 'attack', null)[0] && motionCatch('isometric', 'jump') === null, [...all(views, 'walking', 'direction')[1], ...all(views, 'idle', 'direction')[1]]);
  check('A33: "mirrored", "opposite direction" and "the other way" are a direction on Walk only', all(['mirrored walk', 'walk in the opposite direction', 'walks the other way'], 'walking', 'direction')[0] && all(['mirrored', 'opposite direction', 'the other way'], 'idle', null)[0] && motionCatch('mirrored', 'attack') === null);
  const pacing = ['walks back and forth', 'pacing side to side', 'pacing up and down', 'walk to and fro', 'runs back and forth', 'walks slowly back and forth'];
  check('A34: pacing after a verb of travel ("back and forth", "to and fro", "side to side", "up and down") is a direction on Walk; on Idle a motion; without a verb of travel, a motion on Walk too', all(pacing, 'walking', 'direction')[0] && all(['pacing back and forth', 'pacing side to side'], 'idle', null)[0] && all(['bobs back and forth', 'rocks side to side', 'sways to and fro'], 'walking', null)[0], all(pacing, 'walking', 'direction')[1]);
  const slopes = ['walk uphill', 'walks downstairs', 'walking upstairs', 'downhill walk', 'walk down the stairs', 'climbing up stairs', 'going up a hill', 'down a slope', 'up the hill'];
  check('A35: slopes and stairs are a direction on Walk (the generator draws flat ground), and nothing on Idle', all(slopes, 'walking', 'direction')[0] && all(['walk uphill', 'up the stairs', 'downhill'], 'idle', null)[0] && motionCatch('a hill in the background', 'walking') === null, all(slopes, 'walking', 'direction')[1]);
  const bodyUp = ['walks then sits down', 'walk bobbing up and down', 'walk, looks down', 'walks and looks up', 'walking then kneels down', 'walk, ducks down', 'walks bouncing up', 'walking crouched down', 'sits down', 'bobbing up and down'];
  check('A36: on Walk "up" or "down" right after a verb of the body (sit, bob, bounce, crouch, look, kneel, duck) is the motion, even after a verb of travel; after a verb of travel it is a direction, and so is any other way to go after a verb of the body ("walks looking north")', all(bodyUp, 'walking', null)[0] && all(['walks down', 'walk up and down', 'walks then goes down', 'walks down then sits', 'walks looking north', 'jogs bouncing side to side'], 'walking', 'direction')[0], all(bodyUp, 'walking', null)[1]);
  const forwardMotion = ['thrust forward', 'lunge forward', 'backward slash', 'forward flip', 'jump forward', 'backwards somersault', 'leans forward'];
  check('A37: "forward" and "backward" are the motion on Attack and Jump, and a direction on Walk and Idle', ['attack', 'jump'].every((a) => all(forwardMotion, a, null)[0]) && all(['walk forward', 'walks backwards', 'leans forward'], 'walking', 'direction')[0] && motionCatch('leans forward', 'idle') === 'direction' && same([...FORWARD_ACTIONS], ['walking', 'idle']), ['attack', 'jump'].flatMap((a) => all(forwardMotion, a, null)[1]));
  const turnMotion = ['head turns', 'turns around', 'turning slowly', 'turned around', 'turns to look'];
  check('A38: a turn with no side is the motion on Walk and Idle and a direction on Attack and Jump; a turn with a side is caught by its side', all(turnMotion, 'walking', null)[0] && all(turnMotion, 'idle', null)[0] && all(['spin and turn', 'turns and strikes'], 'attack', 'direction')[0] && motionCatch('turns mid-air', 'jump') === 'direction' && all(['turns left', 'turning to the right', 'turns sideways'], 'idle', 'direction')[0] && same([...TURN_ACTIONS], ['attack', 'jump']), [...all(turnMotion, 'walking', null)[1], ...all(turnMotion, 'idle', null)[1]]);
  // AUDIT, v1a step 3 round 1: M1 (every count of words after the verb is tried), L2 (hyphens), L3 (gaps).
  const wayThenBody = ['walking away looking down', 'walks away looking up', 'walks up looking down', 'walks down looking up', 'walks north looking up', 'walks away bobbing up and down', 'walks away, looking down', 'walks looking up north', 'walks then looks up, then runs down'];
  check('A39: on Walk a way to go right after the verb counts even when a verb of the body with up or down follows ("walks up looking down"); every count of words between is tried at every verb', all(wayThenBody, 'walking', 'direction')[0] && all(['walk, looks down', 'walks and looks up', 'walk cycle looking down', 'walking bobbing up and down'], 'walking', null)[0], [...all(wayThenBody, 'walking', 'direction')[1], ...all(['walk, looks down', 'walks and looks up', 'walk cycle looking down', 'walking bobbing up and down'], 'walking', null)[1]]);
  const hyphened = ['walks back-and-forth', 'paces side-to-side', 'walks to-and-fro', 'opposite-direction walk', 'walk in opposite directions'];
  check('A40: pacing words with hyphens count like the same words with spaces ("walks back-and-forth"), and so does "opposite directions"; on Idle they stay the motion', all(hyphened, 'walking', 'direction')[0] && all(['paces side-to-side', 'bobs back-and-forth', 'opposite directions'], 'idle', null)[0], all(hyphened, 'walking', 'direction')[1]);
  const gaps = ['walks southeast', 'walks northwest', 'walks south-east', 'walks south-west', 'up the slope', 'down the slope', 'walk up the slope'];
  check('A41: the four diagonal compass words, with and without a hyphen, and "the slope", are a direction on Walk', all(gaps, 'walking', 'direction')[0], all(gaps, 'walking', 'direction')[1]);
  check('A42: "several" and "multiple" before views or angles ask for many on Walk and Idle; a list with "back and forth" in it is set aside first ("sways left, right, back and forth" is a side, not three views); a digit before "directions" does not count yet (L1, for DESIGN)', ['walking', 'idle'].every((a) => all(['several views', 'multiple angles', 'several angles', 'multiple views'], a, 'directions')[0]) && motionCatch('sways left, right, back and forth', 'idle') === 'direction' && motionCatch('sways left, right, back-and-forth', 'idle') === 'direction' && all(['walk in 3 directions', 'walk in 2 directions'], 'walking', null)[0]);
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
  check('B8: "turn around" in two words is not a request for many: the motion on Walk and Idle, a direction word on Attack (DESIGN, room 2026-11-14-320)', motionCatch('turn around', 'walking') === null && motionCatch('turned around', 'idle') === null && motionCatch('turn around', 'attack') === 'direction' && motionCatch('turn around', 'crouch') === null);
  const quiet = ['8 frames', '4 steps', 'a 360p look', 'direction', 'in one direction', 'corrode', '3600', 'eight frames', 'halfway', 'one way', 'a 4 angled blade', 'triangle', 'four wayward steps', '14 ways', '48 directions', 'a wayside inn', 'turnaroundish', 'dirt', '4 dirty rats', '48dir', '116 dirs', '8 dire wolves', '3-way', '4 angled cuts', 'a turn around the corner is not asked'].filter((w) => w !== 'a turn around the corner is not asked');
  const [ok9, loud] = all(quiet, 'crouch', null);
  check('B9: numbers and "direction" on their own are not a request for many', ok9 && all(quiet, 'walking', null)[0], loud);
  const spaced = ['8  direction sheet', 'all\ndirections', 'multi\tdirectional', 'every  direction', '8 - direction sheet', 'multi - directional', '4 - way walk'];
  const [ok10, missed10] = all(spaced, 'walking', 'directions');
  check('B10: any gap between the words of a phrase reads as one space, and a hyphen with spaces round it as a hyphen', ok10, missed10);
  check('B11: the many-directions line\'s own words, typed back, are caught: "walking 4 ways"', motionCatch('a new character walking 4 ways', 'walking') === 'directions');
  check('B12: "N angles" counts on Walk and Idle only; "4-angle", the style\'s own name, on every action', motionCatch('strike from 4 angles', 'attack') === null && motionCatch('seen from 8 angles', 'jump') === null && motionCatch('4 angles', 'walking') === 'directions' && motionCatch('8-angle walk', 'idle') === 'directions' && EVERY_ACTION.every((a) => motionCatch('4-angle slash', a) === 'directions'));
  check('B13: "turn-around" with a hyphen asks for many on Walk and Idle; "turn around" in two words does not (no line on Walk, a direction word on Attack)', motionCatch('turn-around sheet', 'walking') === 'directions' && motionCatch('turn - around sheet', 'idle') === 'directions' && motionCatch('turn around', 'walking') === null && motionCatch('turn around', 'attack') === 'direction' && motionCatch('turn-around kick', 'attack') === 'direction');
  // DESIGN, rooms 2026-11-14-320 (table A, last row) and 2026-11-15-021 (option 1).
  const several = ['walk in two directions', 'in three directions', 'several directions', 'twelve directions', '3 angles', 'three views', '12 views', 'three views: front, side, back', 'front, side, back', 'front, back, left, right', 'front, side and back', 'front, side, and back', '(front, back, left, right)', 'front and side views', 'left and right angles', 'front and back views'];
  check('B14: several directions on Walk and Idle: a number word before "directions", any number before "views" or "angles", three or more of front, side, back, left and right in a list, or two with "views" or "angles" after', all(several, 'walking', 'directions')[0] && all(several, 'idle', 'directions')[0] && ['attack', 'jump'].every((a) => all(['front, side, back', 'in two directions', '3 angles'], a, 'directions')[1].length === 3), [...all(several, 'walking', 'directions')[1], ...all(several, 'idle', 'directions')[1]]);
  const notSeveral = [['3/4 views', 'walking', 'direction'], ['left and right sides', 'walking', 'direction'], ['sways left and right', 'idle', null], ['looks right and left', 'idle', null], ['rocks left and right, side to side, back and forth', 'idle', null], ['paces left and right', 'walking', 'direction'], ['left and right arms swing', 'walking', null], ['legs move left and right', 'walking', 'direction'], ['front and back legs', 'walking', null], ['48 directions', 'walking', null], ['one direction', 'idle', null], ['side to side, back and forth, to and fro', 'idle', null]];
  const wrongSeveral = notSeveral.filter(([t, a, want]) => motionCatch(t, a) !== want).map(([t, a]) => `${a}: ${t} -> ${motionCatch(t, a)}`);
  check('B15: and not otherwise: "3/4 views" is one view, "sides" is the body, and the four rulings on main stand (a pair on Idle, a pair on Walk, a body side, legs)', wrongSeveral.length === 0, wrongSeveral);
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
  check('C3: the label is the step\'s name, optional or required for Custom Action (generate-pass.md 4.3)', motionLabel(false) === 'How it moves (optional)' && motionLabel(true) === 'How it moves (required for Custom Action)');
  check('C4: the help line', MOTION_HELP === 'Say how it moves, not which way. The way it faces comes from the picture.');
  // The lines and their buttons (generate-pass.md 4.2, G4).
  const IGNORED = 'The animation keeps the way your character faces, so direction words in the motion box are ignored.';
  check('C5: the lines\' words: the side line, the left line (no button before G3), the many-directions line (its cost follows, shown with the coin)', SIDE_LINE === `${IGNORED} To walk sideways, start from a side view.` && LEFT_LINE === `${IGNORED} Walks face the way your picture does.` && directionsLine('4-Angle Walking') === 'One animation makes one direction. For each other direction, make a picture of your character facing that way and animate it. For a new character walking 4 ways, 4-Angle Walking draws all four from a description');
  const ml = (caught, text, facing = null, four = '4-Angle Walking') => { const l = motionLine(caught, text, facing, four); return l === null ? null : `${l.kind}/${l.button}`; };
  const lineCases = [
    // [catch, text, facing, want]
    ['directions', 'walk in all 4 directions', null, 'directions/four-angle'],
    [null, 'heavy steps', null, null],
    ['direction', 'walks to the right', null, 'side/side-view'],
    ['direction', 'walks north', null, 'side/side-view'],
    ['direction', 'walks left', null, 'left/null'],
    ['direction', 'walking leftward slowly', null, 'left/null'],
    ['direction', 'walk to the left', null, 'left/null'],
    ['direction', 'walks to the right', 'right', null],
    ['direction', 'walks left', 'left', null],
    ['direction', 'walks left', 'right', 'left/null'],
    ['direction', 'walks to the right', 'left', 'side/side-view'],
    ['direction', 'walks toward the camera', 'front', null],
    ['direction', 'walks toward the camera', 'right', 'side/side-view'],
    ['direction', 'walks north', 'right', 'side/side-view'],
    ['direction', 'swings the left arm and walks right', 'right', null],
    ['direction', 'walks left then right', 'right', 'side/side-view'],
  ];
  const lineWrong = lineCases.filter(([c, t, f, want]) => ml(c, t, f) !== want).map(([c, t, f, want]) => `${c} "${t}" ${f}: ${ml(c, t, f)}, want ${want}`);
  check('C6: each catch gets its line and button; a handed-over facing quiets the line for that same facing; left words get the left line; a side of the body is not a facing', lineWrong.length === 0, lineWrong);
  check('C7: with no 4-direction style there is no many-directions line; the line takes the name it is given', motionLine('directions', 'all 4 directions', null, null) === null && motionLine('directions', 'all 4 directions', null, 'Walk Sheet').text.includes('Walk Sheet draws all four'));
  const side = getStyleById(SIDE_VIEW_STYLE_ID), four = getStyleById(FOUR_ANGLE_STYLE_ID);
  check('C8: both styles are in the registry, with a name and a cost, and Create offers them', !!side && !!four && side.label === 'Platformer' && four.label === '4-Angle Walking' && side.tokenCost > 0 && four.tokenCost > 0 && OFFERED_STYLES.includes(side) && OFFERED_STYLES.includes(four), [side?.label, four?.label]);
  const dash = String.fromCharCode(0x2014);
  check('C9: no em dash in any string', ![MOTION_HELP, motionLabel(true), motionLabel(false), SIDE_LINE, LEFT_LINE, directionsLine('x'), ...EVERY_ACTION.map(motionPlaceholder)].some((t) => t.includes(dash)));
  check('C10: the line waits a moment after the last key; a line that comes back is said again only after a real gap', MOTION_CATCH_DELAY_MS === 400 && MOTION_SPEAK_AGAIN_MS === 3000 && MOTION_SPOKEN_CLEAR_MS === 1000 && MOTION_SPEAK_AGAIN_MS > 4 * MOTION_CATCH_DELAY_MS);
  check('C11: no line names a control Create does not have, or sends the person to type words', !/Side, facing right|on Create, pick|start your description/.test(SIDE_LINE + LEFT_LINE + directionsLine('4-Angle Walking')));
  const facingCases = [['walks right', 'right'], ['walks to the left', 'left'], ['leftwards', 'left'], ['walks toward the camera', 'front'], ['walks north', null], ['left arm swings, walks on', null], ['left and right', null], ['RIGHT', 'right']];
  const facingWrong = facingCases.filter(([t, want]) => askedFacing(t) !== want).map(([t, want]) => `${t}: ${askedFacing(t)}, want ${want}`);
  check('C12: the facing a text asks for: right, left or front, or none; a side of the body asks for none', facingWrong.length === 0, facingWrong);
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
  // Re-baselined for G4 (design/generate-pass/generate-pass.md 4 and 5.3): G4
  // moves whole blocks of the form, so its display lines can no longer be
  // undone one by one. In their place, as HQ ruled (room 2026-11-18-051, with
  // ENG's -054 adding no condition): D1 holds the request callback and D22
  // and D23 the parts around it, each byte for byte as before G4; G4's
  // request body was compared with the one before in a browser (BUILD-2 and
  // AUDIT, outside this repository); and the baseline here is G4's reviewed
  // file, with no regions, so any later change to the form fails D0 until it
  // is reviewed and pinned. D0 alone holds nothing else.
  // G4 round 1 was 9a77281b79cb8dc50279960f4e054a1914b3ef78; round 2 (AUDIT
  // g4-animate-r1's fixes) is the blob below.
  // Before G4: 0a72086f9c364f292d2a2d43c74652b6f4b32c68 (the file at the freeze
  // e2eb4625e398df77ca094991d780c282fd04d2bd, with the rd_ swap's three changes
  // and the display regions of Prompt help, REV-M1 and the em dash rows).
  const BASE_BLOB = 'e8265dece26b7b751696d4e4d2d6c9d997e63724';
  const REGIONS = [];
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
  check('D0: the form is the freeze baseline byte for byte (G4\'s reviewed file; HQ 2026-11-18-051)', wrong.length === 0, wrong);

  // The whole callback that builds and sends the request, byte for byte as
  // in the baseline (the blob BASE_BLOB), once its two shown messages are put
  // back as they were: the failure fallback and the free-tier cap (em dash
  // list rows 29 and 30; REV 2026-11-17-014). Each approved message stands in
  // the callback once, so nothing else in it can differ from the baseline.
  const CALLBACK_WORDS = [
    ["'Animation failed. Try again.'", "'Animation failed \u2014 try again.'"],
    ['Token packs start at $4.99. Top up to keep brewing.`', 'Token packs start at $4.99 \u2014 top up to keep brewing.`'],
  ];
  const a = raw.indexOf('  const handleGenerate = useCallback(async () => {');
  const b = raw.indexOf('\n  ]);', a) + '\n  ]);'.length;
  let callback = raw.slice(a, b);
  const wordsOnce = CALLBACK_WORDS.map(([now]) => callback.split(now).length - 1);
  for (const [now, was] of CALLBACK_WORDS) callback = callback.split(now).join(was);
  const hash = sha256(callback);
  check('D1: the callback that builds and sends the request is byte for byte the baseline\'s, once its two approved messages are put back as they were; each stands in it once', a > 0 && wordsOnce.every((n) => n === 1) && hash === 'b8c0a475506358935c3d0f8124b8aa7d06d2212048e8c1651b88f573df2bc95d', [wordsOnce, hash]);
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
  check('D4: the line and its button for each catch (G4, generate-pass.md 4.2): motionLine with the handed-over facing and the 4-direction style\'s name from the registry; the read-out carries its cost with the unit', /const sideViewStyle = getStyleById\(SIDE_VIEW_STYLE_ID\);\s*const fourAngleStyle = getStyleById\(FOUR_ANGLE_STYLE_ID\);/.test(src) && /const motionLineNow = sideViewStyle\s*\? motionLine\(motionCaught, motionText, handoffFacing, fourAngleStyle\?\.label \?\? null\)\s*: null;/.test(src) && /\? `\$\{motionLineNow\.text\} \(\$\{fourAngleStyle\.tokenCost\} tokens\)\.`/.test(src) && /requestCreate\(\{ card: 'side', subject: handoffSubject \}\)/.test(src) && /requestTextAnimation\(\{ styleId: FOUR_ANGLE_STYLE_ID, subject: handoffSubject \}\)/.test(src));
  check('D5: the box has its own id, its label (step 3) and example from the library, the help line as its description, and says when it is required', /const motionBoxId = useId\(\);\s*const motionHelpId = useId\(\);/.test(src) && /<StepLabel n=\{3\} state=\{stepState\(3\)\} htmlFor=\{motionBoxId\} className="mb-1">\s*\{motionLabel\(isCustomAction\)\}\s*<\/StepLabel>/.test(src) && /<textarea\s*id=\{motionBoxId\}/.test(src) && /placeholder=\{motionPlaceholder\(selectedAction\)\}\s*aria-describedby=\{motionHelpId\}\s*aria-required=\{isCustomAction\}/.test(src) && /<p id=\{motionHelpId\} className="text-xs font-mono text-text-secondary mt-1">\s*\{MOTION_HELP\}/.test(src));
  check('D6: the line is a 12 px box in the primary colour on amber, with its button, inside a block that is always in the page; "Make a side view" only once Create Sprite takes its request (G2; AUDIT g4-animate-r1 M3)', /<div\s*ref=\{motionLineRef\}\s*style=\{motionLineRoom > 0 \? \{ minHeight: motionLineRoom \} : undefined\}\s*>\s*\{motionLineNow !== null && \(\s*<div className="mt-2 rounded-lg border border-accent-amber\/50 bg-accent-amber\/10 p-3 space-y-3">\s*<p className="text-xs font-mono text-text-primary">\s*\{motionLineNow\.text\}/.test(src) && /motionLineNow\.button === 'side-view' && SIDE_VIEW_REQUEST_TAKEN && \(\s*<Button type="button" variant="secondary" size="sm" onClick=\{handleMakeSideView\} className="pointer-coarse:min-h-11">[\s\S]{0,80}Make a side view/.test(src) && /motionLineNow\.button === 'four-angle' && \(\s*<Button type="button" variant="secondary" size="sm" onClick=\{handleOpenFourAngle\} className="pointer-coarse:min-h-11">[\s\S]{0,80}Open 4-Angle Walking/.test(src));
  check('D7: the old example and the two small lines are gone', !/walking forward, sword swing/.test(raw) && !/For best character fidelity/.test(raw) && !/less is more\)'\}/.test(raw));
  const block = src.slice(src.indexOf('<StepLabel n={3}'), src.indexOf('{motionSpoken}'));
  check('D8: nothing in the motion block is under 12 px: its label (StepLabel, 12 px), box, help line and line are each 12 px, and no size is written in pixels', block.length > 200 && !/text-\[[^\]]*\]/.test(block) && !/text-(?:2xs|\[)/.test(block) && (block.match(/text-xs/g) ?? []).length >= 3 && /function StepLabel\([\s\S]{0,900}className=\{`flex items-center gap-2 text-xs font-mono text-text-secondary/.test(src) && /text-xs font-mono text-text-primary placeholder:text-text-secondary/.test(block) && /<p id=\{motionHelpId\} className="text-xs /.test(block) && /<p className="text-xs font-mono text-text-primary">\s*\{motionLineNow\.text\}/.test(block));
  check('D9: its words are readable: the label, the example and the help line use the secondary color, not the muted one', !/text-text-muted/.test(block) && /placeholder:text-text-secondary/.test(block));
  check('D10: the old one-direction sentence and the always-on background note under the form are gone, border and all', !/single-direction sprite strip/.test(raw) && !/full 4-direction sheet/.test(raw) && !/For best results/.test(raw) && !/solid color background/.test(raw) && !/Note about constraints/.test(raw) && !/border-t border-border-subtle pt-3/.test(raw));
  // The bar, from its mark to the end of the form, and the lines that decide
  // its hint and whether Generate may be pressed (AUDIT g4-animate-r1 M6: the
  // old anchor, 'Generate Animation (', went with G4).
  const barPart = src.slice(src.indexOf('data-generate-bar=""'));
  const barRules = src.slice(src.indexOf('  const canGenerate = '), src.indexOf('  return (\n    <>\n    <div className="space-y-6">'));
  check('D11: Generate does not look at the line: not the bar, not its hint, not whether it may be pressed', src.indexOf('data-generate-bar=""') > 0 && barPart.length > 1000 && /Generate animation · \{tokenCost\}/.test(barPart) && barRules.length > 1000 && !/motion(?:Caught|Settled|Spoken|Line|Text)/.test(barPart) && !/motion(?:Caught|Settled|Spoken|Line|Text)/.test(barRules) && !/disabled=\{[^}]*motion(?:Caught|Settled|Spoken|Line|Text)/.test(src) && !/canGenerate[^;\n]*motion(?:Caught|Settled|Spoken|Line|Text)/.test(src));
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
  check('D15: the hidden status is laid out inside the motion block (a positioned block), not against the document, so it adds no height to the page', /<div className="relative">\s*<StepLabel n=\{3\}/.test(src) && src.indexOf('<div className="relative">\n        <StepLabel n={3}') < src.indexOf('className="sr-only">\n          {motionSpoken}') && !/sr-only/.test(src.slice(src.indexOf('{motionSpoken}') + 20, src.indexOf('{motionSpoken}') + 400)));
  check('D16: on touch screens, and in a window under 340 px wide, the box has room for three lines of example text', /\[@media\(hover:none\)_and_\(pointer:coarse\)\]:min-h-\[calc\(3lh\+1rem\+2px\)\]\s*max-\[340px\]:min-h-\[calc\(3lh\+1rem\+2px\)\]"/.test(block) && /rows=\{2\}/.test(block));
  // The one scroll is the arrival from "Animate this" (generate-pass.md 5.3, item 3), in the effect that runs when a handoff opens Auto-Prep, never on a key.
  const arrival = src.slice(src.indexOf('if (!pendingPrep || !arrivalRef.current) return;'), src.indexOf('}, [pendingPrep, prepHeadingId]);'));
  const outsideArrival = src.replace(arrival, '');
  check('D17: nothing on the page moves after the last key: the form scrolls nothing (DESIGN 2026-11-14-236 withdrew the scroll into view), but for the arrival from "Animate this", once per handoff (5.3)', arrival.length > 100 && (src.match(/scrollTop\s*\+?=|scrollBy\(|scrollIntoView\(|scrollTo\(/g) ?? []).length === 1 && /main\.scrollTop \+= /.test(arrival) && /arrivalRef\.current = false;/.test(arrival) && !/scrollBy\(|scrollIntoView\(|scrollTo\(|scrollTop\s*\+?=|generateBarRef/.test(outsideArrival));
  const zone = src.slice(src.indexOf('Drop your pixel art character here'), src.indexOf('Browse files'));
  check('D18: the background advice is one line in the empty drop zone, between its title and its formats line, 12 px in the secondary color, and nowhere else; the zone\'s three lines are centred', has(`
<p className="text-sm font-mono text-text-secondary text-center mb-1">
      Drop your pixel art character here
    </p>
    <p className="text-xs font-mono text-text-secondary text-center text-balance mb-1">
      Works best on a plain background in a color your character doesn&apos;t use.
    </p>
    <p className="text-xs font-mono text-text-secondary text-center mb-3">
      PNG, JPG, or WebP &middot; any size, we&apos;ll auto-crop and resize
    </p>`) && (raw.match(/plain background/g) ?? []).length === 1 && src.indexOf('Works best on a plain background') > src.indexOf(') : pendingPrep ? null : (') && zone.length > 100 && !/text-\[/.test(zone));
  const card = src.slice(src.indexOf('Character ready'), src.indexOf('aria-label="Remove character"'));
  // L5 (AUDIT prompt-help-v1a-s2 r1; DESIGN, room 2026-11-14-320): the muted colour is 2.0 to 2.6:1 on every background; the secondary is 4.8:1 and up.
  const prep = fs.readFileSync(path.join(ROOT, 'src/components/sprites/CharacterAutoPrep.tsx'), 'utf8');
  check('D20: nothing on the form is in the muted colour (under 4.5:1 on every background), at any opacity, text, placeholder or icon, the picture being prepared (CharacterAutoPrep, drawn inside the form) included; the secondary colour takes its place, at full strength there and on the form (no opacity on the secondary or primary text colour), and on the selected action card (its amber glow leaves the secondary at 4.42:1) the cost and description take the primary', !/text-text-muted|text-muted\//.test(raw) && !/text-text-muted|text-muted\//.test(prep) && ![raw, prep].some((f) => /text-text-(?:secondary|primary)\//.test(f)) && (prep.match(/text-text-secondary/g) ?? []).length === 11 && (raw.match(/text-text-secondary/g) ?? []).length === 29 && /placeholder:text-text-secondary/.test(raw) && (raw.match(/\$\{active \? 'text-text-primary' : 'text-text-secondary'\}/g) ?? []).length === 2);
  check('D21: the Resolution note has a full stop where its em dash was (DESIGN, room 2026-11-15-091)', !/per generation \u2014/.test(raw) && raw.includes('Cost is flat per generation. No resolution surcharge.'));
  check('D19: the loaded character card has no text under 12 px, and under 480 px its text takes a row of its own under the picture', card.length > 200 && !/text-\[/.test(card) && (card.match(/text-xs font-mono/g) ?? []).length === 3 && has(`<p className="text-xs font-mono text-text-secondary mt-1"> {charWidth}x{charHeight}`) && has(`<p className="text-xs font-mono text-red-400 mt-1"> Prepared at`) && has(`<p className="text-xs font-mono text-green-400 mt-1"> Ready for animation`) && has(`<div className="flex flex-wrap items-start gap-4">`) && has(`<div className="flex-1 min-w-0 max-[480px]:order-last max-[480px]:basis-full"> <p className="text-xs font-mono text-text-primary">Character ready</p>`) && has(`aria-label="Remove character" className="ml-auto flex-shrink-0 p-1.5 rounded`));

  // AUDIT g4-animate-r1 M6: the parts that make the picture sent and finish
  // the job, each byte for byte as before G4 (main 27d26ec8, the file before
  // G4), by its own sha256, as D1 holds the callback. Each is found by its
  // first line (with its second where the first is common), once in the
  // file, and runs to the first line equal to its last.
  const PARTS = [
    ["af", "the picture decoder", "const decodeImage: DecodeImage = (dataUrl, onLoad, onError) => {", "};", undefined, "1ff80e8247c301769d324288e2974206186c59722b14783633d7c6edf6db66d4"],
    ["af", "the poll hook", "  const poll = useGenerationPoll({", "  });", undefined, "4d1972906b2856f18d3474b641fefbc04b4e72b957527da8faa838bfba13d4f2"],
    ["af", "the encoder", "  const convertToRgbBase64 = useCallback(async (): Promise<", "  }, [characterDataUrl, charWidth, charHeight]);", undefined, "be2d071ae67a37e478c12c3eea9de171de7879c7ec101d5e512f3e41a4222a5d"],
    ["af", "the poll effect", "  // Poll-effect: react to terminal states from the queue path.", "  }, [poll.status, poll.result, poll.error]);", undefined, "9b650417ff3db274b09ae62bcf985a4261852a347360220cf474ba1c5e2caedf"],
    ["af", "the progress mirror", "  // Mirror in-flight progress to the store so BrewingLoader can show the", "  }, [poll.startedAt, poll.serverStatus, poll.mode, poll.pausedMessage, setGenerationProgress]);", undefined, "96b540cf34c8342d43ef1b277981d68851f736f395f2e14635699ba8064f49e8"],
    ["af", "the gate", "  const gate = generateGate({", "  });", undefined, "bc06252384fc9e08de90962e0a05995f1640f907163be71e0762dfa5b363454a"],
    ["af", "Use This", "  const handleAutoPrepAccept = useCallback(", "  );", undefined, "8317cf994c15a0cc8574d06fbe826bf7c2a46c011b503998b20a997e48de7a62"],
    ["cap", "stage 1", "  useEffect(() => {", "  }, [sourceDataUrl]);", "    if (lastSourceRef.current === sourceDataUrl) return;", "01e901bf517ed13440a8491532c625af446dbd444cab3226fe6771cfe7dd25ab"],
    ["cap", "stage 2", "  useEffect(() => {", "  }, [baseVersion, targetSize, effectivePct]);", "    if (baseVersion === 0) return;", "f8bf557e0f8a0257cb458d1643977b34df1e337c879b68e6adf2f7a3d8e58ec2"],
    ["cap", "the accept", "  const handleAccept = useCallback(() => {", "  }, [fitCurrent, prepared, onAccept, editedBaseDataUrl, skipBgRemoval, tolerance]);", undefined, "068dd92365be089389f7d4d8dc3d50d5a8a08d53701e2d386acedda006428561"],
  ];
  const files = { af: raw, cap: prep };
  const partOf = (text, start, end, second) => {
    const L = text.split('\n');
    const at = [];
    L.forEach((l, i) => { if (l === start && (second === undefined || L[i + 1] === second)) at.push(i); });
    if (at.length !== 1) return null;
    const j = L.indexOf(end, at[0]);
    return j < 0 ? null : L.slice(at[0], j + 1).join('\n');
  };
  const partsWrong = (file) => PARTS.filter(([f]) => f === file).filter(([f, , start, end, second, want]) => {
    const got = partOf(files[f], start, end, second);
    return got === null || createHash('sha256').update(got).digest('hex') !== want;
  }).map(([, name]) => name);
  check('D22: AnimateForm\'s decoder, poll hook, encoder, poll effect, progress mirror, gate and Use This are each byte for byte as before G4', partsWrong('af').length === 0, partsWrong('af'));
  check('D23: Auto-Prep\'s stage 1 (detect, crop, remove the background), stage 2 (the fit) and its accept are each byte for byte as before G4', partsWrong('cap').length === 0, partsWrong('cap'));

  // G4's own rules around the request (AUDIT g4-animate-r1 M1, M2, M4, L1).
  check('D24: the kept character is read only through readKeptCharacter in an effect, never from the raw field; an account change under the form removes the character and writes nothing for the new account in that commit; Generate is off while Auto-Prep is open; the bar is marked for G1\'s room; "Change size" focuses at once when More settings is open',
    !/s\.keptCharacter\b|\.keptCharacter\b/.test(src) && (src.match(/readKeptCharacter\(/g) ?? []).length === 1
    && has(`useEffect(() => { const before = formAccountRef.current; formAccountRef.current = userId; if (!before || before === userId) return; accountChangedRef.current = true; handleRemoveChar(); }, [userId, handleRemoveChar]);`)
    && has(`useEffect(() => { if (!keptRestoredRef.current) return; if (accountChangedRef.current) { accountChangedRef.current = false; return; } keepCharacter(userId, character); }, [userId, character, keepCharacter]);`)
    && src.indexOf('const formAccountRef = useRef(userId);') < src.indexOf('keepCharacter(userId, character);')
    && has(`const canGenerate = !GENERATION_PAUSED && gate.canGenerate && !pendingPrep;`)
    && /data-generate-bar=""\s*className="fixed bottom-0/.test(src)
    && has(`const handleChangeSize = useCallback(() => { if (moreOpen) { focusResolutionRef.current = false; focusResolution(); return; } focusResolutionRef.current = true; setMoreOpen(true); }, [moreOpen, focusResolution]);`)
    && has(`useEffect(() => () => setAnimatePrepPending(false), [setAnimatePrepPending]);`));
  // The steps and the bar on G1's rules (AUDIT g4-animate-r1 M5, L2 to L5, L11).
  check('D25: badges by G1\'s badgeStates (step 3 done unless Custom Action is empty); the hint rows in order, paused giving screen readers the whole message, the guide, Auto-Prep, the character, step 3, the size, one token or more, ready; the dimmed Generate keeps its label; the arrival words leave once Auto-Prep closes',
    has(`const [badge1, badge2, badge3] = badgeStates( [{ required: true, done: step1Done }, { required: true, done: true }, { required: isCustomAction, done: !step3Needed }], guideShowing, );`)
    && has(`const step1Done = !!character && !pendingPrep;`)
    && /GENERATION_PAUSED\s*\? \(\s*<>\s*<span aria-hidden="true">\{PAUSED_HINT\}<\/span>\s*<span className="sr-only">\{GENERATION_PAUSED_MESSAGE\}<\/span>\s*<\/>\s*\)\s*: guideShowing\s*\? GUIDE_HINT\s*: pendingPrep\s*\? 'Step 1: check your character, then press Use This\.'\s*: !character\s*\? 'Step 1: add your character\.'\s*: step3Needed\s*\? 'Step 3: describe the action\.'\s*: sizeWarning/.test(src)
    && has(`You need {tokensNeeded} more {tokensWord(tokensNeeded)} for this action.{' '}`) && has(`const tokensWord = (n: number) => (n === 1 ? 'token' : 'tokens');`)
    && has(`style={!isGenerating && canGenerate ? undefined : DIMMED_GENERATE}`)
    && has(`useEffect(() => { if (!pendingPrep) setArrivalSpoken(''); }, [pendingPrep]);`));
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
