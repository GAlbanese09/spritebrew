// scripts/build-pixel-grid-notices.mjs
//
// Writes the license notices for public/wasm/pixel-grid.wasm: every crate
// compiled into it, from cargo metadata, with the license it is taken under
// and its copyright lines, then each license text once.
//   public/wasm/THIRD-PARTY-NOTICES.txt  served beside the .wasm
//   src/lib/pixelGridCredits.json        the rows of /credits
// Deterministic: sorted, no dates, no paths, so a rerun leaves git status
// clean. scripts/build-pixel-grid-wasm.sh runs it after copying the .wasm.
// Exits non-zero when a crate offers no license this may take: stop and report.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = path.join(ROOT, 'wasm/pixel-grid');
const FIXER_LICENSE = path.join(CRATE, 'LICENSE-pixel-art-fixer');
const NOTICES = path.join(ROOT, 'public/wasm/THIRD-PARTY-NOTICES.txt');
const CREDITS = path.join(ROOT, 'src/lib/pixelGridCredits.json');

/** The fixer's Cargo.toml names no license; its LICENSE sits at the root of
 *  its git checkout, and this repo keeps that file verbatim. Its repository
 *  is pixel-art-fixer, the name people know it by. */
const FIXER = 'pixelfixer';
const FIXER_TITLE = 'pixel-art-fixer (pixelfixer)';
/** These two offer BSD-3-Clause or Apache-2.0, and no MIT. */
const BSD_CRATES = new Set(['moxcms', 'pxfm']);

function stop(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => order(a.name, b.name) || order(a.version, b.version);
const readText = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** cargo metadata for the .wasm's target, run the way the build script runs
 *  cargo: rust-toolchain.toml would otherwise make rustup download one. */
function metadata() {
  const cargoHome = process.env.CARGO_HOME ?? path.join(homedir(), '.cargo');
  const stdout = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--locked', '--filter-platform', 'wasm32-unknown-unknown'],
    {
      cwd: CRATE,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? 'stable',
        PATH: `${path.join(cargoHome, 'bin')}${path.delimiter}${process.env.PATH}`,
      },
    },
  );
  return JSON.parse(stdout);
}

/** Every crate compiled into the .wasm: normal dependencies from the root,
 *  without proc-macro crates and what is reached only through them. */
function compiledCrates(meta) {
  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const isProcMacro = (p) => p.targets.some((t) => t.kind.includes('proc-macro'));
  const seen = new Set();
  const stack = [meta.resolve.root];
  while (stack.length > 0) {
    for (const dep of nodes.get(stack.pop()).deps) {
      const normal = dep.dep_kinds.some((k) => k.kind === null);
      if (!normal || seen.has(dep.pkg) || isProcMacro(packages.get(dep.pkg))) continue;
      seen.add(dep.pkg);
      stack.push(dep.pkg);
    }
  }
  return [...seen].map((id) => packages.get(id)).sort(byName);
}

/** The license a crate is taken under: MIT where offered, BSD-3-Clause for
 *  moxcms and pxfm. Anything else stops the build. */
function takenLicense(pkg) {
  const label = `${pkg.name} ${pkg.version}`;
  if (pkg.name === FIXER) {
    if (!readText(FIXER_LICENSE).startsWith('MIT License')) stop(`${label}: ${FIXER_LICENSE} is not the MIT license`);
    return 'MIT';
  }
  const expression = pkg.license ?? '';
  const offers = expression.split(/\s+OR\s+|\//).map((s) => s.replace(/[()]/g, '').trim()).filter(Boolean);
  if (/\s(AND|WITH)\s/.test(expression)) stop(`${label}: '${expression}' is not a plain choice of licenses`);
  if (offers.includes('MIT')) return 'MIT';
  if (BSD_CRATES.has(pkg.name) && offers.includes('BSD-3-Clause')) return 'BSD-3-Clause';
  if (offers.length > 0 && offers.every((o) => /^(A|L)?GPL|^MPL/.test(o))) {
    stop(`${label} offers only '${expression}': HQ's stop rule, stop and report`);
  }
  return stop(`${label}: no license this script may take in '${expression}'`);
}

/** A crate's license files: LICENSE-MIT, LICENSE.md, COPYING and the like. */
function licenseFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|copyright|notice)/i.test(f))
    .sort()
    .map((f) => path.join(dir, f))
    .filter((f) => statSync(f).isFile());
}

/** The Apache text's template and the sentences that only mention copyright. */
const NOT_A_NOTICE = /\[yyyy\]|\[name of copyright owner\]|<year>|<copyright holders?>|copyright (notice|license|owner|statement|holder)/i;

/** Whether a line names someone, not just a year ("Copyright (c) 2015"). */
function namesHolder(line) {
  const rest = line.replace(/copyright/gi, '').replace(/\(c\)|©/gi, '').replace(/\d{4}/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  return rest.length > 0;
}

/** The crate's own copyright lines, each once; `bare` holds lines that name
 *  no one. Read from the LICENSE files, so never a line from memory. */
function ownLines(files) {
  const lines = new Set();
  const bare = new Set();
  for (const file of files) {
    for (const raw of readText(file).split('\n')) {
      const line = raw.trim();
      if (!/^(copyright\b|©|\(c\)\s+\d{4})/i.test(line) || NOT_A_NOTICE.test(line)) continue;
      (namesHolder(line) ? lines : bare).add(line);
    }
  }
  return { lines: [...lines], bare: [...bare] };
}

/** A crate's copyright lines: from its LICENSE files, else from its
 *  Cargo.toml authors, without their email addresses. */
function copyrightLines(pkg) {
  if (pkg.name === FIXER) return ownLines([FIXER_LICENSE]).lines;
  const { lines, bare } = ownLines(licenseFiles(path.dirname(pkg.manifest_path)));
  if (lines.length > 0) return lines;
  const authors = pkg.authors.map((a) => a.replace(/\s*<[^>]*>/, '').replace(/\s+\S+\s+at\s+\S+$/, '').trim()).filter(Boolean);
  if (authors.length > 0) return [`Copyright (c) ${authors.join(', ')}`];
  // Neither names anyone (either): its own line stands, and where it lives.
  return [...bare, `No author named in the crate; see ${repository(pkg)}`];
}

/** The URL of a crate's source: its repository, or its git source. */
function repository(pkg) {
  if (pkg.repository) return pkg.repository;
  const git = /^git\+(https:[^?#]+)/.exec(pkg.source ?? '');
  return git ? git[1] : stop(`${pkg.name} ${pkg.version} names no repository`);
}

/** The compiler's version, which is the standard library's: the build script
 *  holds the compiler to the same one. */
function rustVersion() {
  const pin = /^channel\s*=\s*"([^"]+)"/m.exec(readText(path.join(CRATE, 'rust-toolchain.toml')));
  return pin ? pin[1] : stop('rust-toolchain.toml names no channel');
}

/** The text after a license's title and copyright lines, from `opening` on. */
function licenseBody(text, opening) {
  const at = text.indexOf(opening);
  if (at < 0) stop(`no license text starting '${opening}'`);
  return text.slice(at).trimEnd();
}

const meta = metadata();
const crates = compiledCrates(meta).map((pkg) => ({
  name: pkg.name,
  version: pkg.version,
  license: takenLicense(pkg),
  repository: repository(pkg),
  copyright: copyrightLines(pkg),
  dir: path.dirname(pkg.manifest_path),
}));
if (crates.length === 0) stop('cargo metadata listed no crates');

const bsdBodies = new Set(
  crates
    .filter((c) => c.license === 'BSD-3-Clause')
    .map((c) => licenseBody(readText(path.join(c.dir, 'LICENSE.md')), 'Redistribution and use')),
);
if (bsdBodies.size !== 1) stop('the BSD-3-Clause crates do not share one license text');

const block = ({ name, version, license, copyright }) => [`${name} ${version}`, `License: ${license}`, ...copyright].join('\n');

const notices = [
  'Third-party software in pixel-grid.wasm',
  'pixel-grid.wasm is the WebAssembly build behind "Fix pixel grid" in SpriteBrew. It contains the software listed here. '
    + 'Each entry gives the license it is used under and its copyright lines; the license texts follow the entries. '
    + 'Written by scripts/build-pixel-grid-notices.mjs.',
  ...crates.map((c) => block(c.name === FIXER ? { ...c, name: FIXER_TITLE } : c)),
  block({ name: 'Rust standard library', version: rustVersion(), license: 'MIT', copyright: ['Copyright (c) The Rust Project Developers'] }),
  `MIT License\n\nApplies to every entry marked MIT, each with its copyright lines above.\n\n${licenseBody(readText(FIXER_LICENSE), 'Permission is hereby granted')}`,
  `BSD 3-Clause License\n\nApplies to every entry marked BSD-3-Clause, each with its copyright lines above.\n\n${[...bsdBodies][0]}`,
].join('\n\n');

writeFileSync(NOTICES, `${notices}\n`);
writeFileSync(
  CREDITS,
  `${JSON.stringify(crates.map(({ name, version, license, repository: url }) => ({ name, version, license, repository: url })), null, 2)}\n`,
);
console.log(`notices: ${crates.length} crates and the Rust standard library`);
