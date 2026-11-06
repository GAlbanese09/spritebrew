#!/usr/bin/env bash
# Builds public/wasm/pixel-grid.wasm from wasm/pixel-grid (the fixer behind
# "Fix pixel grid" in /editor), its sha256 file and the fixer's license. The
# result is reproducible: run it twice, or after cargo clean, and the sha256
# is the same, and git status stays clean.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE="$ROOT/wasm/pixel-grid"
OUT="$ROOT/public/wasm"
PINNED_RUSTC='rustc 1.99.1 (58cf8f9c3 2026-10-13)'
CARGO_DIR="${CARGO_HOME:-$HOME/.cargo}"

export PATH="$CARGO_DIR/bin:$PATH"
# rust-toolchain.toml names 1.99.1, and rustup would download a toolchain of
# that name even when stable is that same compiler. An installed toolchain is
# used instead (set RUSTUP_TOOLCHAIN to pick another); the check below is what
# holds it to the pinned compiler.
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable}"
# Cargo's panic messages carry source paths. Without this the .wasm would
# hold this machine's home folder, and its hash would depend on the checkout.
export RUSTFLAGS="--remap-path-prefix=$CARGO_DIR=/cargo --remap-path-prefix=$CRATE=/pixel-grid"

cd "$CRATE"

FOUND_RUSTC="$(rustc --version)"
if [ "$FOUND_RUSTC" != "$PINNED_RUSTC" ]; then
  echo "STOP: this build is pinned to '$PINNED_RUSTC' but found '$FOUND_RUSTC'." >&2
  echo "A different compiler gives a different .wasm. Use the pinned one, or change the pin on purpose." >&2
  exit 1
fi

cargo build --release --locked --target wasm32-unknown-unknown

mkdir -p "$OUT"
cp target/wasm32-unknown-unknown/release/pixel_grid_wasm.wasm "$OUT/pixel-grid.wasm"
chmod 644 "$OUT/pixel-grid.wasm"
cp LICENSE-pixel-art-fixer "$OUT/pixel-art-fixer-LICENSE.txt"

cd "$OUT"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum pixel-grid.wasm > pixel-grid.wasm.sha256
else
  shasum -a 256 pixel-grid.wasm > pixel-grid.wasm.sha256
fi
cat pixel-grid.wasm.sha256
