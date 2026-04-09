# Chat Input Overflows on Narrow Sidebar

**Priority:** P2
**Issue:** [#6273](https://github.com/Kilo-Org/kilocode/issues/6273)

## Remaining Work

- Make the chat input toolbar responsive: wrap controls to a second row when sidebar is narrow
- Send button should always remain visible and anchored to the bottom-right
- Use CSS flexbox `flex-wrap: wrap` or container queries / `ResizeObserver`
- Test at sidebar widths of ~200px, ~280px, and ~350px
