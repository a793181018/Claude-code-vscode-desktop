#!/bin/bash
# Copy bridge dist into the VS Code extension for bundling
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIST="$SCRIPT_DIR/../../claude-code-bridge/dist"
EXT_BRIDGE_DIR="$SCRIPT_DIR/../bridge-dist"

rm -rf "$EXT_BRIDGE_DIR"
cp -r "$BRIDGE_DIST" "$EXT_BRIDGE_DIR"
echo "Copied bridge dist to $EXT_BRIDGE_DIR"
ls "$EXT_BRIDGE_DIR"
