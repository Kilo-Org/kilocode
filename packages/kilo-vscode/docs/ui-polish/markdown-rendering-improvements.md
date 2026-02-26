# Markdown Rendering Improvements

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6088](https://github.com/Kilo-Org/kilocode/issues/6088)

## Problem

Markdown headers (h1, h2, h3, etc.) render at the same visual size as body text — there are no size, weight, or spacing differences between heading levels. The chat output looks flat and hard to scan.

## Remaining Work

- Add CSS rules for heading elements (`h1`–`h6`) rendered inside the markdown output area:
  - Distinct font sizes (e.g., h1: 1.5em, h2: 1.3em, h3: 1.1em)
  - Increased font weight
  - Vertical spacing (margin-top/margin-bottom) to visually separate sections
- Verify that heading styles don't bleed outside the markdown content area (scope with a parent selector)
- Check that styles work across VS Code's built-in themes (light, dark, high-contrast) using CSS variables from kilo-ui or VS Code's theme tokens
- Also verify: bullet lists, numbered lists, blockquotes, horizontal rules, and bold/italic all render visually correctly

## Implementation Notes

- Markdown is rendered by the kilo-ui `<Markdown>` component or the webview's own markdown handler
- CSS for chat content lives in `webview-ui/src/styles/chat.css` — add the heading rules there, or in kilo-ui if the component lives there
