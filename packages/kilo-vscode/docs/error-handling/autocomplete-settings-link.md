# Autocomplete Broken Notice — Settings Link Not Clickable

**Priority:** P1
**Issue:** [#6284](https://github.com/Kilo-Org/kilocode/issues/6284)

Autocomplete settings tab exists but the "settings" link in the broken notice may not navigate to it.

## Remaining Work

- Fix the "settings" link in the autocomplete broken notice to navigate to the Autocomplete settings tab
- Investigate why autocomplete model selector shows "no model selected" by default — add a sensible fallback
- Check whether the "autocomplete broken" state is correctly detected and cleared
