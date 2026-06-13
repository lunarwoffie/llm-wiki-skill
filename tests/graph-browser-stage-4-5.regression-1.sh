#!/bin/bash
# Regression: stage 4.5 graph browser interactions

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

target="offline"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      target="${2:-}"
      shift 2
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [ "$target" != "offline" ]; then
  fail "stage 4.5 browser regression target '$target' is not implemented yet"
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
  || fail "graph-engine build should succeed before stage 4.5 browser regression"
build_graph_html_fixture "$tmp_dir"

artifact_dir="$REPO_ROOT/workbench/docs/stage-4.5-artifacts"
mkdir -p "$artifact_dir"

export GRAPH_STAGE_4_5_TARGET="$target"
export GRAPH_STAGE_4_5_OFFLINE_HTML="$tmp_dir/wiki/knowledge-graph.html"
export GRAPH_STAGE_4_5_ARTIFACT_DIR="$artifact_dir"

cd "$REPO_ROOT"
playwright_node_path="$(
  npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"
NODE_PATH="$playwright_node_path" node tests/browser/graph-stage-4-5.mjs

echo "PASS: stage 4.5 browser regression ($target)"
