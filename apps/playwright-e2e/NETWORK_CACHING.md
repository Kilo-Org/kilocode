# Network Caching System for Playwright E2E Tests

## Overview

This system enables deterministic Playwright tests by caching API responses in HAR (HTTP Archive) files. Tests can run locally with API keys for recording, then run in CI without API keys using cached responses.

## How It Works

### 🎬 Recording Phase (Local Development)

1. **Run tests locally** with `OPENROUTER_API_KEY` set in `.env.local`
2. **Network requests are captured** and stored as HAR files in `network-cache/`
3. **API keys are automatically sanitized** (e.g., `Bearer sk-o...c2af`) before storage
4. **HAR files are safe to commit** to version control

### 🎭 Replay Phase (CI/Production)

1. **Tests run without API keys** using `NETWORK_CACHE_MODE=none`
2. **Cached responses are replayed** from committed HAR files
3. **Tests are deterministic** and ~90% faster (200ms vs 2000ms)
4. **No API costs** in CI environment

## Cache Modes

| Mode      | API Key Required | Behavior                                                                | Use Case                        |
| --------- | ---------------- | ----------------------------------------------------------------------- | ------------------------------- |
| `none`    | ❌ No            | Uses only cached HAR files, never makes real API calls                  | **CI/Production**               |
| `minimal` | ✅ Yes           | Uses cached responses when available, makes real calls for missing ones | **Local development** (default) |
| `full`    | ✅ Yes           | Always makes real API calls and updates HAR files                       | **Re-recording responses**      |

## Usage Examples

### Local Development (Default)

```bash
# Uses existing HAR files + makes new calls as needed
npm run playwright
```

### Re-record All Responses

```bash
# Forces fresh API calls and updates all HAR files
NETWORK_CACHE_MODE=full npm run playwright
```

### CI Mode (Cache Only)

```bash
# Uses only cached responses, no API key needed
NETWORK_CACHE_MODE=none npm run playwright
```

### Verify HAR Sanitization

```bash
# Check that all API keys are properly redacted
npm run verify-har
```

## Security Features

### 🔒 Automatic API Key Sanitization

The system automatically detects and sanitizes sensitive headers:

- `Authorization: Bearer sk-...` → `Authorization: Bearer sk-o...c2af`
- `x-api-key: ...` → `x-api-key: key1...key4`
- Works for both request and response headers

### ✅ Built-in Verification

Every test automatically verifies HAR sanitization:

```
🔒 Verified 9 API keys are properly sanitized in test.har
```

If unsanitized keys are found, tests fail with:

```
🚨 SECURITY VIOLATION: Found 3 unsanitized API keys in HAR file
```

## File Structure

```
apps/playwright-e2e/
├── network-cache/                    # Cached HAR files (committed to git)
│   ├── should_configure_credentials.har
│   ├── should_handle_streaming.har
│   └── README.md
├── scripts/
│   └── verify-har-sanitization.js   # Verification utility
└── tests/
    ├── playwright-base-test.ts       # Auto-sanitization setup
    └── *.test.ts                     # Test files
```

## CI Integration

The GitHub Actions workflow now runs without API keys:

```yaml
- name: Run Playwright E2E tests (using cached HAR files)
  run: |
      cd apps/playwright-e2e
      node run-docker-playwright.js
  env:
      NETWORK_CACHE_MODE: none # Cache-only mode
      # OPENROUTER_API_KEY intentionally omitted
```

## Benefits

- **🚀 90% faster tests** (200ms vs 2000ms)
- **💰 Zero API costs** in CI
- **🔒 Secure by design** - automatic key sanitization
- **🎯 Deterministic results** - same responses every time
- **🌐 Offline capable** - works without internet in CI
- **🔄 Easy re-recording** - just change cache mode

## Troubleshooting

### Tests fail with "API key required"

- **Solution**: Set `NETWORK_CACHE_MODE=none` for cache-only mode
- **Or**: Add `OPENROUTER_API_KEY` to `.env.local` for recording mode

### Tests fail with "HAR file not found"

- **Solution**: Run tests locally first with API key to generate HAR files
- **Or**: Use `NETWORK_CACHE_MODE=full` to re-record missing responses

### Security violation errors

- **Solution**: Run `npm run verify-har` to check sanitization
- **Fix**: Delete HAR files and re-record with updated sanitization logic

### Stale cached responses

- **Solution**: Use `NETWORK_CACHE_MODE=full` to refresh all cached responses
- **Or**: Delete specific HAR files to re-record individual tests

## Development Workflow

1. **Initial setup**: Run tests locally with API key to generate HAR files
2. **Daily development**: Use default `minimal` mode for fast iteration
3. **Before commit**: Security verification happens automatically during tests
4. **CI deployment**: Tests run automatically without API keys
5. **Response updates**: Use `full` mode when API responses change
