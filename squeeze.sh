#!/usr/bin/env bash
#
# squeeze.sh — batch-compress GLB models for mobile/web delivery.
#
#   ./squeeze.sh <input-dir> <output-dir>
#
# Tunables (env): RATIO TEX_SIZE TEX_FORMAT COMPRESS JOBS
#
set -euo pipefail

RATIO="${RATIO:-0.15}"
ERROR="${ERROR:-0.001}"
TEX_SIZE="${TEX_SIZE:-2048}"
TEX_FORMAT="${TEX_FORMAT:-webp}"
COMPRESS="${COMPRESS:-draco}"
JOBS="${JOBS:-4}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GT="$HERE/node_modules/.bin/gltf-transform"

# Worker branch: xargs re-invokes this script once per file so the parallelism
# stays in xargs rather than hand-rolled job control.
if [[ "${1:-}" == "--worker" ]]; then
  src="$2"; out_dir="$3"; res_dir="$4"
  name="${src##*/}"
  slug="$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')"
  dst="$out_dir/$name"

  before=$(stat -f%z "$src" 2>/dev/null || stat -c%s "$src")

  if "$GT" optimize "$src" "$dst" \
        --compress "$COMPRESS" \
        --simplify-ratio "$RATIO" \
        --simplify-error "$ERROR" \
        --texture-size "$TEX_SIZE" \
        --texture-compress "$TEX_FORMAT" \
        >"$res_dir/$slug.log" 2>&1; then
    after=$(stat -f%z "$dst" 2>/dev/null || stat -c%s "$dst")
    printf '%s,%s,%s,ok\n' "$name" "$before" "$after" >"$res_dir/$slug.csv"
    printf '  ✓ %-52s %6.1f MB → %5.2f MB  (%4.1fx)\n' \
      "$name" "$(bc -l <<<"$before/1048576")" "$(bc -l <<<"$after/1048576")" \
      "$(bc -l <<<"$before/$after")"
  else
    printf '%s,%s,0,FAILED\n' "$name" "$before" >"$res_dir/$slug.csv"
    printf '  ✗ %-52s FAILED (see %s.log)\n' "$name" "$slug"
  fi
  exit 0
fi

IN_DIR="${1:?usage: squeeze.sh <input-dir> <output-dir>}"
OUT_DIR="${2:?usage: squeeze.sh <input-dir> <output-dir>}"

[[ -x "$GT" ]] || { echo "gltf-transform missing — run: npm install" >&2; exit 1; }
mkdir -p "$OUT_DIR"

RES_DIR="$(mktemp -d)"
trap 'rm -rf "$RES_DIR"' EXIT

total=$(find "$IN_DIR" -maxdepth 1 -type f \( -iname '*.glb' -o -iname '*.gltf' \) | wc -l | tr -d ' ')
echo "squeeze: $total model(s) → $OUT_DIR"
echo "  ratio=$RATIO error=$ERROR textures=${TEX_SIZE}px/$TEX_FORMAT compress=$COMPRESS jobs=$JOBS"
echo

export RATIO ERROR TEX_SIZE TEX_FORMAT COMPRESS GT

find "$IN_DIR" -maxdepth 1 -type f \( -iname '*.glb' -o -iname '*.gltf' \) -print0 \
  | xargs -0 -P "$JOBS" -I{} "$HERE/squeeze.sh" --worker {} "$OUT_DIR" "$RES_DIR"

echo
REPORT="$OUT_DIR/squeeze-report.csv"
{ echo "file,bytes_before,bytes_after,status"; cat "$RES_DIR"/*.csv 2>/dev/null | sort; } >"$REPORT"
cp "$RES_DIR"/*.log "$OUT_DIR/" 2>/dev/null || true

awk -F, 'NR>1 && $4=="ok" {b+=$2; a+=$3; n++} NR>1 && $4!="ok" {f++} END {
  printf "─────────────────────────────────────────────\n"
  printf "  %d ok", n; if (f) printf ", %d FAILED", f; printf "\n"
  if (n) printf "  %.0f MB → %.0f MB  (%.1fx smaller, %.1f%% saved)\n", \
    b/1048576, a/1048576, b/a, (1-a/b)*100
  printf "─────────────────────────────────────────────\n"
}' "$REPORT"
echo "report: $REPORT"
