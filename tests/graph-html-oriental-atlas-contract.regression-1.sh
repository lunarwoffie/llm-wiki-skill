#!/bin/bash
# Regression: generated graph HTML must keep the approved oriental atlas shell

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRAPH_HTML_BASIC="tests/fixtures/graph-interactive-basic"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_file_contains() {
    local file="$1"
    local text="$2"

    if ! grep -F -- "$text" "$file" > /dev/null; then
        fail "Expected $file to contain: $text"
    fi
}

assert_file_not_contains() {
    local file="$1"
    local text="$2"

    if grep -F -- "$text" "$file" > /dev/null; then
        fail "Expected $file to not contain: $text"
    fi
}

build_graph_html_fixture() {
    local tmp_dir="$1"
    local output_dir="$tmp_dir/wiki"

    mkdir -p "$output_dir"
    cp "$REPO_ROOT/$GRAPH_HTML_BASIC/wiki/graph-data.json" "$output_dir/graph-data.json"

    bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on basic fixture"
}

test_oriental_atlas_has_approved_shell() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"
    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" 'id="app"'
    assert_file_contains "$html" 'class="topbar"'
    assert_file_contains "$html" 'class="sidebar"'
    assert_file_contains "$html" 'class="canvas-card"'
    assert_file_contains "$html" 'class="canvas-footer"'
    assert_file_contains "$html" 'class="drawer" id="drawer"'
    assert_file_contains "$html" 'id="node-layer"'
    assert_file_contains "$html" 'id="edge-layer"'

    rm -rf "$tmp_dir"
}

test_oriental_atlas_rejects_old_learning_cockpit_shell() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"
    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_not_contains "$html" 'id="nav-panel"'
    assert_file_not_contains "$html" 'id="mode-switch"'
    assert_file_not_contains "$html" 'id="nav-close"'
    assert_file_not_contains "$html" 'id="secondary-panel"'
    assert_file_not_contains "$html" 'id="dr-close"'
    assert_file_not_contains "$html" '学习驾驶舱'

    rm -rf "$tmp_dir"
}

test_oriental_atlas_has_required_copy() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"
    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "国风知识库·数字山水图"
    assert_file_contains "$html" "文献索引"
    assert_file_contains "$html" "社区"
    assert_file_contains "$html" "聚焦"
    assert_file_contains "$html" "关系置信度"
    assert_file_contains "$html" "直接提取"
    assert_file_contains "$html" "推断关联"
    assert_file_contains "$html" "存在歧义"
    assert_file_contains "$html" "未核实"
    assert_file_contains "$html" "GitHub"

    rm -rf "$tmp_dir"
}

test_oriental_atlas_runtime_uses_shared_state() {
    local tmp_dir js
    tmp_dir="$(mktemp -d)"
    build_graph_html_fixture "$tmp_dir"
    js="$tmp_dir/wiki/graph-wash.js"

    assert_file_contains "$js" "buildAtlasModel(DATA)"
    assert_file_contains "$js" "deriveAtlasLayout(atlasModel)"
    assert_file_contains "$js" "resolveAtlasVisibleSnapshot(state.atlasModel, state.atlasLayout, state.ui)"
    assert_file_contains "$js" "renderAtlasView()"

    rm -rf "$tmp_dir"
}

main() {
    test_oriental_atlas_has_approved_shell
    test_oriental_atlas_rejects_old_learning_cockpit_shell
    test_oriental_atlas_has_required_copy
    test_oriental_atlas_runtime_uses_shared_state
    echo "PASS: oriental atlas HTML contract regression coverage"
}

main "$@"
