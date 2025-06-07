---
"packages/types": patch
"kilocode": patch
---

Fix: "Use this model for all modes" toggle now correctly restores per-mode model selections.

Previously, the "use this model for all modes" feature only handled provider-level configurations, not model-specific selections. This meant that when the toggle was disabled, users' previous per-mode model customizations were not restored.

This change enhances the feature to properly save and restore per-mode model configurations. When the toggle is enabled, the current model is applied globally, and the previous per-mode settings are backed up. When the toggle is disabled, the backed-up model selections are restored, allowing users to seamlessly switch between a unified model and individual mode customizations.
