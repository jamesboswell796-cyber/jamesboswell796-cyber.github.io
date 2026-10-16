#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"
OUT="$ROOT/dist"
APP="$OUT/ProjectHubShelf.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN_DIR/ProjectHubShelf" "$APP/Contents/MacOS/ProjectHubShelf"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.projecthub.shelf</string>
  <key>CFBundleName</key><string>Project Hub Shelf</string>
  <key>CFBundleDisplayName</key><string>Project Hub Shelf</string>
  <key>CFBundleExecutable</key><string>ProjectHubShelf</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# Development-only signing, NOT Apple notarization.
codesign --force --sign - "$APP"
mkdir -p "$OUT"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/ProjectHubShelf-macOS-arm64.zip"
echo "Created $OUT/ProjectHubShelf-macOS-arm64.zip"
