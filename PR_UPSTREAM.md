# Pull Request: Fix Silent JSON Parse Errors in combineApiRequests

## 📋 PR Summary

**Target Repository:** `Kilo-Org/kilocode`  
**Branch:** `fix/silent-json-parse-errors`  
**Type:** 🐛 Bug Fix  

---

## 🎯 Summary

Fix silent error handling in `combineApiRequests` that was swallowing JSON parsing errors, making debugging impossible when API request/response data was malformed.

---

## 🔍 Problem

The `combineApiRequests` function in `src/shared/combineApiRequests.ts` contained **empty catch blocks** that silently discarded JSON parsing errors:

```typescript
// BEFORE: Silent failure - impossible to debug
try {
    startData = JSON.parse(startMessage.text)
} catch (e) {}  // Error silently swallowed!
```

### Impact
- **Data Loss:** Malformed API data silently discarded
- **No Visibility:** Developers have no indication parsing failed
- **Debugging Nightmare:** Issues only surface in downstream systems
- **Production Risk:** Corrupted data goes undetected

---

## ✅ Solution

Added proper warning logging with contextual information while preserving graceful degradation:

```typescript
// AFTER: Visible warning with context
try {
    startData = JSON.parse(startMessage.text)
} catch (e) {
    console.warn(
        `[combineApiRequests] Failed to parse api_req_started JSON (ts=${startMessage.ts}):`,
        e instanceof Error ? e.message : String(e)
    )
}
```

### Benefits
- ✅ Errors now visible in console for debugging
- ✅ Timestamp included for correlation with logs
- ✅ Graceful degradation preserved (no breaking changes)
- ✅ Better type safety with explicit type annotations

---

## 📁 Files Changed

| File | Change |
|------|--------|
| `src/shared/combineApiRequests.ts` | Added error logging with context |
| `src/shared/__tests__/combineApiRequests.spec.ts` | Added 3 tests for error logging |

---

## 🧪 Tests

### New Test Cases
- `should log warning when api_req_started has malformed JSON`
- `should log warning when api_req_finished has malformed JSON`
- `should include timestamp in warning when parsing fails`

### Test Results
All existing tests pass, plus 3 new tests for error logging behavior.

---

## 📋 Checklist

- [x] Tests added
- [x] No breaking changes
- [x] TypeScript types verified
- [x] Code follows project conventions

---

## 📸 Example Output

### Before (Silent)
```
// Nothing logged - completely invisible failure
```

### After (Visible)
```
[combineApiRequests] Failed to parse api_req_started JSON (ts=1000): Unexpected token 'm' at position 1
```

---

## 🔄 Changeset

```md
---
"kilo-code": patch
---

Fix silent JSON parse errors in combineApiRequests - now logs warnings for debugging
```

---

## 🤝 Contributing Notes

This is a straightforward bug fix that improves developer experience without changing any external behavior. The function still returns partial data on parse errors (graceful degradation), but now developers can see when this happens.

### Related Issues
This pattern (empty catch blocks) exists in a few other places in the codebase:
- `src/utils/tts.ts:35`
- `src/api/providers/openrouter.ts:808`
- `src/services/checkpoints/excludes.ts:196`

These could be addressed in follow-up PRs.

---

*Submitted by: Community Contributor*
