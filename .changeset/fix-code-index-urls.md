---
"kilo-code": patch
---

Fix broken code indexing URLs by using shared getAppUrl() function

Replaced hardcoded URLs with the shared `getAppUrl()` function from `@roo-code/types` in:
- `ManagedCodeIndexPopover.tsx` - Fixed organization code indexing link
- `OrganizationIndexingTab.tsx` - Fixed admin dashboard link
