// scripts/landing-test.mjs
//
// Offline tests for what the homepage says about exporting (the external
// product audit's SB-15; DESIGN 2026-11-25-117). Run from the repo root:
// `node scripts/landing-test.mjs`. Bundles src/lib/exportPresets.ts and
// src/lib/constants.ts with esbuild into local/.landing-test/ (gitignored)
// and reads src/app/page.tsx. Prints only case names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.landing-test');
async function load(name) {
  const outfile = path.join(OUT, `${name}.mjs`);
  await build({ entryPoints: [path.join(ROOT, `src/lib/${name}.ts`)], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}
const { ENGINE_PRESETS, enginePreset } = await load('exportPresets');
const { ENGINE_TARGETS } = await load('constants');
const home = fs.readFileSync(path.join(ROOT, 'src/app/page.tsx'), 'utf8');

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

// The chips, as the source lists them.
const enginesSrc = (home.match(/const ENGINES = \[([\s\S]*?)\] as const;/) || [])[1] || '';
const chips = [...enginesSrc.matchAll(/'([^']*)'/g)].map((m) => m[1]);

// ── 1. The chips (DESIGN -117) ──
check('the chips are DESIGN\'s eight, in order',
  JSON.stringify(chips) === JSON.stringify([
    'Unity (Aseprite Importer)', 'Godot 4 (SpriteFrames)', 'GameMaker (strips)', 'RPG Maker MV/MZ',
    'Aseprite (.aseprite + JSON)', 'TexturePacker JSON', 'PNG frames', 'Animated GIF',
  ]));
check('the Unity chip names the importer the Unity preset uses',
  enginePreset('unity')?.target === 'aseprite' && chips.some((c) => /^Unity \(Aseprite Importer\)$/.test(c))
    && !chips.some((c) => /^Unity/.test(c) && /TexturePacker/.test(c)));
check('one chip per export target, plus the GIF and Unity (which takes the Aseprite target)',
  ENGINE_TARGETS.length + 2 === chips.length && ENGINE_TARGETS.some((t) => t.id === 'aseprite'));

// ── 2. The feature card counts the formats from the code ──
check('the card\'s count is read from ENGINE_TARGETS, plus the GIF',
  /title: `\$\{ENGINE_TARGETS\.length \+ 1\} Export Formats`/.test(home) && !/'\d+ Export Formats'/.test(home)
    && /import \{[^}]*\bENGINE_TARGETS\b[^}]*\} from '@\/lib\/constants';/.test(home));
check('the card lists the formats in DESIGN\'s words',
  home.includes("desc: 'Aseprite, TexturePacker, GameMaker, RPG Maker, Godot, PNG frames and GIF. One click, game-ready.'"));

// ── 3. Quick setup, read from the presets ──
check('every preset has a one-line summary for the homepage',
  ENGINE_PRESETS.length === 3 && ENGINE_PRESETS.every((p) => typeof p.summary === 'string' && p.summary.length > 20 && !p.summary.includes('—')));
check('each summary names the files its preset makes',
  /\.aseprite/.test(enginePreset('unity')?.summary ?? '') && /PNG/.test(enginePreset('unity')?.summary ?? '') && /JSON/.test(enginePreset('unity')?.summary ?? '')
    && /Aseprite Importer/.test(enginePreset('unity')?.summary ?? '')
    && /\.tres/.test(enginePreset('godot')?.summary ?? '')
    && /strip/.test(enginePreset('gamemaker')?.summary ?? ''));
check('the homepage shows each preset\'s label and summary from ENGINE_PRESETS',
  /ENGINE_PRESETS\.map\(\(preset\) =>/.test(home) && /\{preset\.label\}/.test(home) && /\{preset\.summary\}/.test(home)
    && /import \{[^}]*\bENGINE_PRESETS\b[^}]*\} from '@\/lib\/exportPresets';/.test(home));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
