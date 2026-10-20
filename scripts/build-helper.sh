#!/bin/sh
# Builds bin/title-cards-render from helper/render.swift.
# One file that runs on Apple Silicon and Intel Macs, macOS 13 or newer.
# Only people who change the helper need this. It needs Xcode or the
# Command Line Tools (xcode-select --install). Officers do not.
set -e
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13" \
    -framework Cocoa -framework WebKit -framework AVFoundation -framework CoreVideo \
    helper/render.swift -o "$tmp/render-$arch"
done
lipo -create "$tmp/render-arm64" "$tmp/render-x86_64" -output bin/title-cards-render
rm -rf "$tmp"
codesign --force --sign - bin/title-cards-render
echo "Built bin/title-cards-render ($(du -h bin/title-cards-render | cut -f1), $(lipo -archs bin/title-cards-render))"
