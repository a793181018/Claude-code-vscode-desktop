#!/bin/bash
# Copy bridge dist into the VS Code extension for bundling
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIST="$SCRIPT_DIR/../../claude-code-bridge/dist"
EXT_BRIDGE_DIR="$SCRIPT_DIR/../bridge-dist"

rm -rf "$EXT_BRIDGE_DIR"
cp -r "$BRIDGE_DIST" "$EXT_BRIDGE_DIR"
# Copy bridge package.json so Node.js recognizes it as ESM ("type": "module")
cp "$SCRIPT_DIR/../../claude-code-bridge/package.json" "$EXT_BRIDGE_DIR/package.json"
echo "Copied bridge dist to $EXT_BRIDGE_DIR"
ls "$EXT_BRIDGE_DIR"
