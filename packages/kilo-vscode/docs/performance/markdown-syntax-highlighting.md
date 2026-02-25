# Markdown Syntax Highlighting Performance

**Priority:** P0
**Status:** ❌ Not started
**Issue:** [#6221](https://github.com/Kilo-Org/kilocode/issues/6221)

## Problem

When switching sessions in the Agent Manager (or loading a large session), the webview main thread is blocked for **2.3+ seconds** by synchronous syntax highlighting. During this time, the UI is completely frozen.

**Root cause:** The `Markdown` component uses `marked-shiki` which calls `highlighter.codeToHtml()` synchronously on the main thread via the Oniguruma WASM regex engine. A session with 45 messages containing code blocks can trigger 91.4% of render time in `findNextMatchSync` (Oniguruma regex).

## Remaining Work

The recommended fix is a **two-pass render (Option A)**:

1. **First pass (instant):** Parse markdown but render code blocks as plain `<pre><code>` with no syntax highlighting. Messages appear immediately.
2. **Second pass (deferred):** After the initial paint, progressively highlight code blocks using `requestIdleCallback` or `setTimeout(0)`.

Implementation:

- Add a `skipHighlighting` option to the `markedShiki` plugin that returns plain `<pre><code>` blocks
- On first render, use skip mode
- Schedule full highlight pass after initial paint
- Replace plain blocks with highlighted HTML once ready

**Also investigate (Option D):** Verify that the JS regex engine (`createJavaScriptRegexEngine()`) is actually being used on the main thread instead of Oniguruma WASM. The code configures `preferredHighlighter: "shiki-js"` but the profiling trace shows Oniguruma being called — this may be a configuration bug.

## Relevant Files

- `packages/ui/src/context/marked.tsx` — Shiki highlighter setup (lines 426–460, 511–526)
- `packages/ui/src/components/markdown.tsx` — `Markdown` component with 200-entry LRU cache
- `packages/ui/src/components/message-part.tsx` — `TextPart` renders `<Markdown>`
- `packages/ui/src/pierre/worker.ts` — Web Worker pool (reference pattern for off-thread highlighting)
