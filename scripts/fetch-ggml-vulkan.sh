#!/bin/bash
# The llama.rn npm package does not ship vendor/llama.cpp/ggml/src/ggml-vulkan (it is excluded in
# llama.rn's package.json "files"). The Vulkan variant (custom Turnip driver support) needs it, so
# this script downloads that folder from the llama.cpp commit llama.rn vendors (vendor/VERSIONS)
# and applies scripts/llama-rn-ggml-vulkan.patch (custom driver loading) to it.
#
# Runs from scripts/postinstall.sh, before patch-package. Safe to run repeatedly.
# Offline use: GGML_VULKAN_TARBALL=/path/to/llama.cpp-<commit>.tar.gz
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LRN="$ROOT/node_modules/llama.rn"
VERSIONS="$LRN/vendor/VERSIONS"
DEST="$LRN/vendor/llama.cpp/ggml/src/ggml-vulkan"
EDIT_PATCH="$ROOT/scripts/llama-rn-ggml-vulkan.patch"
MARKER="$DEST/.pocketpal-ggml-vulkan"

if [ ! -d "$LRN" ]; then
  echo "fetch-ggml-vulkan: node_modules/llama.rn is not installed" >&2
  exit 1
fi
if [ ! -f "$VERSIONS" ]; then
  echo "fetch-ggml-vulkan: $VERSIONS not found; cannot tell which llama.cpp commit to fetch" >&2
  exit 1
fi

COMMIT="$(sed -n 's/^LLAMA_CPP_COMMIT=//p' "$VERSIONS" | head -n1 | tr -d '[:space:]')"
REPO="$(sed -n 's/^LLAMA_CPP_REPO=//p' "$VERSIONS" | head -n1 | tr -d '[:space:]')"
if [ -z "$COMMIT" ] || [ -z "$REPO" ]; then
  echo "fetch-ggml-vulkan: LLAMA_CPP_REPO / LLAMA_CPP_COMMIT missing in $VERSIONS" >&2
  exit 1
fi

STAMP="$COMMIT $(cksum < "$EDIT_PATCH" | cut -d' ' -f1,2)"
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$STAMP" ]; then
  echo "ggml-vulkan already fetched and patched (llama.cpp $COMMIT)."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "${GGML_VULKAN_TARBALL:-}" ]; then
  echo "Using $GGML_VULKAN_TARBALL for ggml-vulkan"
  cp "$GGML_VULKAN_TARBALL" "$TMP/src.tar.gz"
else
  URL="$REPO/archive/$COMMIT.tar.gz"
  echo "Downloading ggml-vulkan from $URL ..."
  curl -fsSL --retry 3 -o "$TMP/src.tar.gz" "$URL"
fi

# GNU tar needs --wildcards, bsdtar (macOS) takes patterns directly; fall back to everything.
tar -xzf "$TMP/src.tar.gz" -C "$TMP" --wildcards '*/ggml/src/ggml-vulkan/*' 2>/dev/null \
  || tar -xzf "$TMP/src.tar.gz" -C "$TMP" '*/ggml/src/ggml-vulkan/*' 2>/dev/null \
  || tar -xzf "$TMP/src.tar.gz" -C "$TMP"

SRC="$(ls -d "$TMP"/*/ggml/src/ggml-vulkan 2>/dev/null | head -n1 || true)"
if [ -z "$SRC" ] || [ ! -f "$SRC/ggml-vulkan.cpp" ]; then
  echo "fetch-ggml-vulkan: ggml/src/ggml-vulkan not found in the llama.cpp archive" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC"/. "$DEST"/

if ! patch -p1 --no-backup-if-mismatch -d "$DEST" < "$EDIT_PATCH"; then
  rm -rf "$DEST"
  echo "fetch-ggml-vulkan: scripts/llama-rn-ggml-vulkan.patch does not apply to llama.cpp $COMMIT." >&2
  echo "It was written for the commit llama.rn 0.13.0-rc.12 vendors; regenerate it after a llama.rn upgrade." >&2
  exit 1
fi

echo "$STAMP" > "$MARKER"
echo "ggml-vulkan fetched from llama.cpp $COMMIT and patched."
