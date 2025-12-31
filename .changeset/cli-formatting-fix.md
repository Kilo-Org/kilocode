---
"@kilocode/cli": patch
---

Fix CLI formatting issues for unknown message types and JSON content

This PR addresses formatting issues in the CLI where unknown message types and JSON content were not being properly handled in both CI mode and interactive terminal mode.

**Changes:**

1. **Improved JSON parsing in CI mode** (`jsonOutput.ts`):
   - Added robust JSON parsing with proper error handling
   - Distinguishes between JSON objects/arrays (placed in `metadata` field) and plain text (placed in `content` field)
   - Added debug logging for JSON parsing failures
   - Handles edge cases: empty text, malformed JSON, nested structures, null values

2. **Enhanced unknown message type handling** (interactive mode):
   - `ExtensionMessageRow`: Now displays message text for unknown types
   - `DefaultAskMessage` & `DefaultSayMessage`: Exported and improved to format JSON content nicely
   - Added proper fallback rendering for future/unknown message types

3. **Comprehensive test coverage**:
   - Added `jsonOutput.test.ts` with 50+ test cases covering:
     - Valid JSON parsing (objects, arrays, nested structures)
     - Malformed JSON handling
     - Empty/undefined/null values
     - Mixed content scenarios
     - Unknown message types
   - Added `UnknownMessageType.test.tsx` with 30+ test cases covering:
     - Unknown root message types
     - Unknown ask/say subtypes
     - Edge cases with images, partial flags, markdown
     - Error boundary integration

**Edge cases handled:**
- Unknown message types with various content structures
- JSON content in different message fields (text, content blocks)
- Mixed content (JSON + regular text)
- Malformed JSON
- Empty messages
- Nested JSON structures
- Arrays vs objects
- Null/undefined values
- Markdown and code fence content

**Backward compatibility:**
- All existing message types continue to work as before
- Only affects handling of unknown/future message types and JSON parsing
