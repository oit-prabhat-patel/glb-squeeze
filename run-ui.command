#!/usr/bin/env bash
#
# glb-squeeze — double-click to launch the drag-and-drop web app.
#
# macOS runs a .command file in Terminal when you double-click it. This installs
# dependencies on first run, starts the local server, and opens the app in your
# browser. Keep the window open while you use it; close it (or Ctrl-C) to stop.
#
# (Not on a Mac? Just run `npm run ui` in a terminal instead.)

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org and double-click this again."
  read -r -n 1 -p "Press any key to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run — installing dependencies (one time, may take a minute)..."
  npm install || { echo "npm install failed."; read -r -n 1 -p "Press any key to close..."; exit 1; }
fi

PORT="${PORT:-4747}"
echo ""
echo "  Starting glb-squeeze — a browser tab will open at http://localhost:${PORT}"
echo "  Keep this window open while you use it. Close it (or press Ctrl-C) to stop."
echo ""

GLBSQ_OPEN=1 PORT="$PORT" exec node server.js
