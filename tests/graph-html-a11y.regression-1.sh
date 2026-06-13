#!/bin/bash
# Regression: engine graph HTML should keep accessible node and reader hooks

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_reduced_motion_and_accessible_markup() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "prefers-reduced-motion"
    assert_file_contains "$html" "aria-label=\"图谱统计\""
    assert_file_contains "$html" 'setAttribute(`aria-hidden`,`true`)'
    assert_file_contains "$html" 'setAttribute(`aria-pressed`,e.selected?`true`:`false`)'
    assert_file_contains "$html" 'setAttribute(`aria-label`,`关闭阅读面板`)'

    rm -rf "$tmp_dir"
}

test_graph_html_has_keyboard_safe_reader_close() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    grep -Eq '[[:alnum:]_$]+\.type=`button`' "$html" \
        || fail "Expected $html to set generated graph buttons to type=button"
    assert_file_contains "$html" "graph-reader-close"
    assert_file_contains "$html" "关闭阅读面板"
    assert_file_contains "$REPO_ROOT/packages/graph-engine/src/render/static-renderer.ts" 'close.addEventListener("click", () => clearInteractionState());'

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_has_reduced_motion_and_accessible_markup
    test_graph_html_has_keyboard_safe_reader_close
    echo "PASS: graph HTML a11y regression coverage"
}

main "$@"
