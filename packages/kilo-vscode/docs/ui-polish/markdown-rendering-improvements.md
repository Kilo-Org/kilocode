# Markdown Rendering Improvements

**Priority:** P1
**Issue:** [#6088](https://github.com/Kilo-Org/kilocode/issues/6088)

Headings h1-h6 render at the same visual size as body text. kilo-ui CSS only resets margins, no distinct font sizes/weights.

## Remaining Work

- Add CSS rules for heading elements (`h1`-`h6`) with distinct font sizes, weights, and vertical spacing
- Scope heading styles to the markdown content area
- Verify styles across light, dark, and high-contrast VS Code themes
- Also verify: bullet lists, numbered lists, blockquotes, horizontal rules, and bold/italic
