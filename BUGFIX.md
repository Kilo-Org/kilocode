# Bug Report: Silent JSON Parse Error Handling in combineApiRequests

## 🐛 Bug Summary

**Component:** `src/shared/combineApiRequests.ts`  
**Severity:** Medium  
**Type:** Error Handling / Data Integrity  

Empty catch blocks silently swallow JSON parsing errors when combining API request messages, potentially causing data loss and making debugging extremely difficult.

---

## 📍 Location

**File:** [src/shared/combineApiRequests.ts](src/shared/combineApiRequests.ts#L62-L77)

**Original Code (Lines 62-77):**
```typescript
try {
    if (startMessage.text) {
        startData = JSON.parse(startMessage.text)
    }
} catch (e) {}  // ← Silent failure

try {
    if (message.text) {
        finishData = JSON.parse(message.text)
    }
} catch (e) {}  // ← Silent failure
```

---

## 🔍 Problem Description

### What Happens
When the `combineApiRequests` function encounters malformed JSON in either:
- `api_req_started` messages
- `api_req_finished` messages

The errors are silently swallowed with empty catch blocks (`catch (e) {}`), and the function continues with empty objects.

### Impact
1. **Data Loss:** API request/response data that couldn't be parsed is silently discarded
2. **Debugging Nightmare:** No indication that parsing failed; developers have no visibility into data corruption
3. **Hidden Failures:** The function appears to succeed but returns incomplete data
4. **Production Issues:** Malformed API responses go unnoticed until downstream systems fail

### Reproduction Scenario
```typescript
const messages = [
    { type: "say", say: "api_req_started", text: "{malformed json", ts: 1000 },
    { type: "say", say: "api_req_finished", text: '{"cost":0.005}', ts: 1001 }
];
const result = combineApiRequests(messages);
// Result: [{ text: '{"cost":0.005}' }] - NO indication that request data was lost!
```

---

## ✅ Fix Applied

### Changes Made
1. **Added proper error logging** with context (timestamp) for debugging
2. **Added explicit type annotations** for better type safety
3. **Preserved graceful degradation** - function still returns partial data on parse errors
4. **Added comprehensive tests** for error logging behavior

### Fixed Code:
```typescript
try {
    if (startMessage.text) {
        startData = JSON.parse(startMessage.text)
    }
} catch (e) {
    // Log JSON parse error with context for debugging malformed API request data
    console.warn(
        `[combineApiRequests] Failed to parse api_req_started JSON (ts=${startMessage.ts}):`,
        e instanceof Error ? e.message : String(e),
    )
}

try {
    if (message.text) {
        finishData = JSON.parse(message.text)
    }
} catch (e) {
    // Log JSON parse error with context for debugging malformed API response data
    console.warn(
        `[combineApiRequests] Failed to parse api_req_finished JSON (ts=${message.ts}):`,
        e instanceof Error ? e.message : String(e),
    )
}
```

---

## 📁 Files Changed

| File | Change |
|------|--------|
| [src/shared/combineApiRequests.ts](src/shared/combineApiRequests.ts) | Added error logging with timestamp context |
| [src/shared/__tests__/combineApiRequests.spec.ts](src/shared/__tests__/combineApiRequests.spec.ts) | Added 3 new tests for error logging behavior |

---

## 🧪 Test Coverage Added

Three new tests in the "Error logging" describe block:

1. **`should log warning when api_req_started has malformed JSON`**
   - Verifies warning is logged when start message has invalid JSON
   - Confirms graceful degradation (output still produced)

2. **`should log warning when api_req_finished has malformed JSON`**
   - Verifies warning is logged when finish message has invalid JSON
   - Confirms graceful degradation (output still produced)

3. **`should include timestamp in warning when parsing fails`**
   - Verifies timestamp is included for debugging purposes

---

## 🔄 Behavior Comparison

| Scenario | Before (Bug) | After (Fixed) |
|----------|--------------|---------------|
| Malformed start JSON | Silent failure, empty object used | Warning logged, empty object used |
| Malformed finish JSON | Silent failure, empty object used | Warning logged, empty object used |
| Both malformed | Silent failure, both empty | Both warnings logged |
| Valid JSON | Works correctly | Works correctly (no change) |

---

## ⚠️ Related Issues

This pattern of empty catch blocks exists in other files as well:
- `src/utils/tts.ts:35` - TTS playback errors silently swallowed
- `src/api/providers/openrouter.ts:808` - Rate limit parsing errors silently swallowed
- `src/services/checkpoints/excludes.ts:196` - LFS pattern errors silently swallowed

These should be addressed in follow-up PRs.

---

## 📋 Checklist

- [x] Bug identified and documented
- [x] Fix implemented with proper error handling
- [x] Tests added for new behavior
- [x] No TypeScript errors
- [x] Code follows kilocode_change marking guidelines
- [x] Graceful degradation preserved (no breaking changes)
