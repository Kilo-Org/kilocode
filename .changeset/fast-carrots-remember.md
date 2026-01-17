---
"kilo-code": patch
---

Add id field to autocomplete cache for better visibility tracking

Added an `id` property to `FillInAtCursorSuggestion` type and updated visibility tracking to use the id instead of the prefix/suffix/suggestion triplet for more reliable telemetry.
