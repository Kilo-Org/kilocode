# Script Update Instructions

## File to Update: `test-autocomplete.sh`

### Current Content:

```bash
#!/bin/bash

pushd core
npm test -- autocomplete nextEdit vscode-test-harness
popd
```

### New Content:

```bash
#!/bin/bash

pushd core
npm test -- autocomplete nextEdit vscode-test-harness diff llm/autodetect indexing/ignore util/LruCache
popd
```

### Changes Made:

Added 4 new test pattern arguments to include critical dependency tests:

- `diff` - Includes all 3 diff test files (myers, streamDiff, util)
- `llm/autodetect` - Includes LLM model detection tests
- `indexing/ignore` - Includes security filtering tests
- `util/LruCache` - Includes caching tests

### Test Coverage Summary:

**Original**: 24 test files

- 5 autocomplete tests
- 13 NextEdit tests
- 6 vscode-test-harness tests

**After Update**: 29 test files

- 5 autocomplete tests
- 13 NextEdit tests
- 6 vscode-test-harness tests
- 3 diff tests (NEW)
- 1 llm/autodetect test (NEW)
- 1 indexing/ignore test (NEW)
- 1 util/LruCache test (NEW)

### Verification Command:

After updating, verify the script works:

```bash
./test-autocomplete.sh
```

Or check which tests will run without executing:

```bash
cd core
npm test -- --reporter=verbose autocomplete nextEdit vscode-test-harness diff llm/autodetect indexing/ignore util/LruCache --run=false
```
