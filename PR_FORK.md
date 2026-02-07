# Pull Request: Fix Silent JSON Parse Errors in combineApiRequests

## 📋 PR Summary

**Branch:** `fix/silent-json-parse-errors`  
**Target:** `zwbproducts/kilocode:main`  
**Type:** 🐛 Bug Fix  

This PR fixes a bug where JSON parsing errors in the `combineApiRequests` function were silently swallowed, making debugging extremely difficult and potentially causing data loss.

---

## 🔗 Related Issues

- Fixes silent error handling anti-pattern
- Improves debuggability of API request processing
- See [BUGFIX.md](BUGFIX.md) for detailed bug documentation

---

## 📝 Description

### Problem
The `combineApiRequests` function had empty catch blocks that silently swallowed JSON parsing errors:
```typescript
try { startData = JSON.parse(startMessage.text) } catch (e) {}  // Silent failure!
try { finishData = JSON.parse(message.text) } catch (e) {}      // Silent failure!
```

This made it impossible to debug issues when API request/response data was malformed.

### Solution
Added proper warning logging with context (including timestamps) while preserving graceful degradation:
```typescript
try {
    startData = JSON.parse(startMessage.text)
} catch (e) {
    console.warn(
        `[combineApiRequests] Failed to parse api_req_started JSON (ts=${startMessage.ts}):`,
        e instanceof Error ? e.message : String(e)
    )
}
```

---

## 📁 Changes

### Modified Files
| File | Description |
|------|-------------|
| `src/shared/combineApiRequests.ts` | Added error logging with timestamp context |
| `src/shared/__tests__/combineApiRequests.spec.ts` | Added 3 new tests for error logging |

### Change Statistics
- **Lines Added:** ~45
- **Lines Removed:** ~4
- **Test Cases Added:** 3

---

## 🧪 Testing

### New Tests Added
```
✓ Error logging
  ✓ should log warning when api_req_started has malformed JSON
  ✓ should log warning when api_req_finished has malformed JSON
  ✓ should include timestamp in warning when parsing fails
```

### Verification
- [x] All existing tests pass
- [x] New tests cover error logging behavior
- [x] No TypeScript errors
- [x] Graceful degradation verified (partial data still returned)

---

## 🔄 Changeset

```md
---
"kilo-code": patch
---

Fix silent JSON parse errors in combineApiRequests - now logs warnings for debugging
```

---

## ✅ PR Checklist

- [x] Code follows project style guidelines
- [x] Changes are marked with `kilocode_change` comments
- [x] Tests added for new functionality
- [x] All tests pass
- [x] No breaking changes
- [x] Documentation updated (BUGFIX.md)
- [x] Changeset created

---

## 📸 Screenshots/Logs

### Before (Silent Failure)
```
// No output when JSON parsing fails - impossible to debug
```

### After (Visible Warning)
```
[combineApiRequests] Failed to parse api_req_started JSON (ts=1000): Unexpected token 'm' at position 1
```

---

## 🚀 Deployment Notes

- **Breaking Changes:** None
- **Migration Required:** No
- **Feature Flags:** None
- **Performance Impact:** Minimal (only additional logging on errors)

---

## 👥 Reviewers

Please review:
1. Error message format and context
2. Test coverage adequacy
3. Compliance with kilocode_change marking guidelines

---

## 🤖 AI Code Reviewer Activation

This PR is ready for automated review. The Kilo Code AI reviewer should:
1. Verify error handling patterns
2. Check test coverage
3. Validate TypeScript types
4. Ensure kilocode_change markers are properly placed

---

*This PR improves the developer experience by making API request processing errors visible and debuggable.*
