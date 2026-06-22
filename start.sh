#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NODE_BIN="${NODE_BIN:-}"

if [[ -z "$NODE_BIN" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  elif [[ -x /usr/bin/node ]]; then
    NODE_BIN="/usr/bin/node"
  elif [[ -x /opt/homebrew/bin/node ]]; then
    NODE_BIN="/opt/homebrew/bin/node"
  elif [[ -x /usr/local/bin/node ]]; then
    NODE_BIN="/usr/local/bin/node"
  elif [[ -x /opt/node/bin/node ]]; then
    NODE_BIN="/opt/node/bin/node"
  fi
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "[Redline] node not found" >&2
  echo "[Redline] PATH=$PATH" >&2
  echo "[Redline] Set NODE_BIN=/path/to/node or make node available to OpenDeck." >&2
  exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/index.js" "$@"
