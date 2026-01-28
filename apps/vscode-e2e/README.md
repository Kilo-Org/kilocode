# E2E Tests for Roo Code

End-to-end tests for the Roo Code VSCode extension using the VSCode Extension Test Runner.

## Prerequisites

- Node.js 20.19.2 (or compatible version 20.x)
- pnpm 10.8.1+
- OpenRouter API key with available credits

## Setup

### 1. Install Dependencies

From the project root:

```bash
pnpm install
```

### 2. Configure API Key

Create a `.env.local` file in this directory:

```bash
cd apps/vscode-e2e
cp .env.local.sample .env.local
```

Edit `.env.local` and add your OpenRouter API key:

```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### 3. Build Dependencies

The E2E tests require the extension and its dependencies to be built:

```bash
# From project root
pnpm -w bundle
pnpm --filter @roo-code/vscode-webview build
```

Or use the `test:ci` script which handles this automatically (recommended).

## Running Tests

### Run All Tests (Recommended)

```bash
cd apps/vscode-e2e
pnpm test:ci
```

This command:

1. Builds the extension bundle
2. Builds the webview UI
3. Compiles TypeScript test files
4. Downloads VSCode test runtime (if needed)
5. Runs all tests

**Expected output**: ~39 passing tests, ~0 skipped tests, ~6-8 minutes

### Run Specific Test File

```bash
TEST_FILE="task.test" pnpm test:ci
```

Available test files:

- `extension.test` - Extension activation and command registration
- `task.test` - Basic task execution
- `modes.test` - Mode switching functionality
- `markdown-lists.test` - Markdown rendering
- `subtasks.test` - Subtask handling
- `tools/write-to-file.test` - File writing tool
- `tools/read-file.test` - File reading tool
- `tools/search-files.test` - File search tool
- `tools/list-files.test` - Directory listing tool
- `tools/execute-command.test` - Command execution tool
- `tools/apply-diff.test` - Diff application tool
- `tools/use-mcp-tool.test` - MCP tool integration

### Run Tests Matching Pattern

```bash
TEST_GREP="markdown" pnpm test:ci
```

This will run only tests whose names match "markdown".

### Development Workflow

For faster iteration during test development:

1. Build dependencies once:

    ```bash
    pnpm -w bundle
    pnpm --filter @roo-code/vscode-webview build
    ```

2. Run tests directly (faster, but requires manual rebuilds):
    ```bash
    pnpm test:run
    ```

**Note**: If you modify the extension code, you must rebuild before running `test:run`.

## Test Structure

```
apps/vscode-e2e/
├── src/
│   ├── runTest.ts           # Test runner entry point
│   ├── suite/
│   │   ├── index.ts         # Test suite setup and configuration
│   │   ├── utils.ts         # Test utilities (waitFor, etc.)
│   │   ├── test-utils.ts    # Test configuration helpers
│   │   ├── extension.test.ts
│   │   ├── task.test.ts
│   │   ├── modes.test.ts
│   │   ├── markdown-lists.test.ts
│   │   ├── subtasks.test.ts
│   │   └── tools/           # Tool-specific tests
│   │       ├── write-to-file.test.ts
│   │       ├── read-file.test.ts
│   │       ├── search-files.test.ts
│   │       ├── list-files.test.ts
│   │       ├── execute-command.test.ts
│   │       ├── apply-diff.test.ts
│   │       └── use-mcp-tool.test.ts
│   └── types/
│       └── global.d.ts      # Global type definitions
├── .env.local.sample        # Sample environment file
├── .env.local               # Your API key (gitignored)
├── package.json
├── tsconfig.json            # TypeScript config for tests
└── README.md                # This file
```

## How Tests Work

1. **Test Runner** ([`runTest.ts`](src/runTest.ts)):

    - Downloads VSCode test runtime (cached in `.vscode-test/`)
    - Creates temporary workspace directory
    - Launches VSCode with the extension loaded
    - Runs Mocha test suite

2. **Test Setup** ([`suite/index.ts`](src/suite/index.ts)):

    - Activates the extension
    - Configures API with OpenRouter credentials
    - Sets up global `api` object for tests
    - Configures Mocha with 20-minute timeout

3. **Test Execution**:

    - Tests use the `RooCodeAPI` to programmatically control the extension
    - Tests can start tasks, send messages, wait for completion, etc.
    - Tests observe events emitted by the extension

4. **Cleanup**:
    - Temporary workspace is deleted after tests complete
    - VSCode instance is closed

## Common Issues

### "Cannot find module '@roo-code/types'"

**Cause**: The `@roo-code/types` package hasn't been built.

**Solution**: Use `pnpm test:ci` instead of `pnpm test:run`, or build dependencies manually:

```bash
pnpm -w bundle
pnpm --filter @roo-code/vscode-webview build
```

### "Extension not found: RooVeterinaryInc.roo-cline"

**Cause**: The extension bundle hasn't been created.

**Solution**: Build the extension:

```bash
pnpm -w bundle
```

### Tests timeout or hang

**Possible causes**:

1. Invalid or expired OpenRouter API key
2. No credits remaining on OpenRouter account
3. Network connectivity issues
4. Model is unavailable

**Solution**:

- Verify your API key is valid
- Check your OpenRouter account has credits
- Try running a single test to isolate the issue

### "OPENROUTER_API_KEY is not defined"

**Cause**: Missing or incorrect `.env.local` file.

**Solution**: Create `.env.local` with your API key:

```bash
echo "OPENROUTER_API_KEY=sk-or-v1-your-key-here" > .env.local
```

### VSCode download fails

**Cause**: Network issues or GitHub rate limiting.

**Solution**: The test runner has retry logic. If it continues to fail:

1. Check your internet connection
2. Try again later
3. Manually download VSCode to `.vscode-test/` directory

## Current Test Status

As of the last run:

- ✅ **39 tests passing** (100% coverage)
- ⏭️ **0 tests skipped**
- ❌ **0 tests failing**
- ⏱️ **~6-8 minutes** total runtime

### Passing Tests

1. Task execution and response handling
2. Mode switching functionality
3. Markdown list rendering (4 tests)
4. Extension command registration

### Skipped Tests

Most tool tests are currently skipped. These need to be investigated and re-enabled:

- File operation tools (write, read, list, search)
- Command execution tool
- Diff application tool
- MCP tool integration
- Subtask handling

## Writing New Tests

### Basic Test Structure

```typescript
import * as assert from "assert"
import { RooCodeEventName } from "@roo-code/types"
import { waitUntilCompleted } from "./utils"
import { setDefaultSuiteTimeout } from "./test-utils"

suite("My Test Suite", function () {
	setDefaultSuiteTimeout(this)

	test("Should do something", async () => {
		const api = globalThis.api

		// Start a task
		const taskId = await api.startNewTask({
			configuration: {
				mode: "code",
				autoApprovalEnabled: true,
			},
			text: "Your task prompt here",
		})

		// Wait for completion
		await waitUntilCompleted({ api, taskId })

		// Assert results
		assert.ok(true, "Test passed")
	})
})
```

### Available Utilities

- `waitFor(condition, options)` - Wait for a condition to be true
- `waitUntilCompleted({ api, taskId })` - Wait for task completion
- `waitUntilAborted({ api, taskId })` - Wait for task abortion
- `sleep(ms)` - Sleep for specified milliseconds
- `setDefaultSuiteTimeout(context)` - Set 2-minute timeout for suite

### API Methods

The `globalThis.api` object provides:

```typescript
// Task management
api.startNewTask({ configuration, text, images })
api.resumeTask(taskId)
api.cancelCurrentTask()
api.clearCurrentTask()

// Interaction
api.sendMessage(text, images)
api.pressPrimaryButton()
api.pressSecondaryButton()

// Configuration
api.getConfiguration()
api.setConfiguration(values)

// Events
api.on(RooCodeEventName.TaskStarted, (taskId) => {})
api.on(RooCodeEventName.TaskCompleted, (taskId) => {})
api.on(RooCodeEventName.Message, ({ taskId, message }) => {})
// ... and many more events
```

## CI/CD Integration

The E2E tests run automatically in GitHub Actions on:

- Pull requests to `main`
- Pushes to `main`
- Manual workflow dispatch

See [`.github/workflows/code-qa.yml`](../../.github/workflows/code-qa.yml) for the CI configuration.

**Requirements**:

- `OPENROUTER_API_KEY` secret must be configured in GitHub
- Tests run on Ubuntu with xvfb for headless display
- VSCode 1.101.2 is downloaded and cached

## Troubleshooting

### Enable Debug Logging

Set environment variable to see detailed logs:

```bash
DEBUG=* pnpm test:ci
```

### Check VSCode Logs

VSCode logs are written to the console during test execution. Look for:

- Extension activation messages
- API configuration logs
- Task execution logs
- Error messages

### Inspect Test Workspace

The test workspace is created in `/tmp/roo-test-workspace-*` and deleted after tests.

To preserve it for debugging, modify [`runTest.ts`](src/runTest.ts):

```typescript
// Comment out this line:
// await fs.rm(testWorkspace, { recursive: true, force: true })
```

### Run Single Test in Isolation

```bash
TEST_FILE="extension.test" pnpm test:ci
```

This helps identify if issues are test-specific or systemic.

## Contributing

When adding new E2E tests:

1. Follow the existing test structure
2. Use descriptive test names
3. Clean up resources in `teardown()` hooks
4. Use appropriate timeouts
5. Add comments explaining complex test logic
6. Ensure tests are deterministic (no flakiness)

## Resources

- [VSCode Extension Testing Guide](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Mocha Documentation](https://mochajs.org/)
- [@vscode/test-electron](https://github.com/microsoft/vscode-test)
- [OpenRouter API Documentation](https://openrouter.ai/docs)

## Support

If you encounter issues:

1. Check this README for common issues
2. Review test logs for error messages
3. Try running tests locally to reproduce
4. Check GitHub Actions logs for CI failures
5. Ask in the team chat or create an issue
