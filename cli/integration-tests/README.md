# CLI Integration Tests

This directory contains integration tests for the Kilo Code CLI. These tests spawn actual CLI processes and verify behavior end-to-end.

## Overview

The integration tests use:

- **Vitest** as the test runner
- **@lydell/node-pty** for spawning interactive terminal sessions
- **strip-ansi** for cleaning ANSI escape codes from output

## Running Tests

### Prerequisites

1. Build the CLI first:

    ```bash
    pnpm build
    ```

2. Run the integration tests:
    ```bash
    pnpm test:integration
    ```

### Available Scripts

- `pnpm test:integration` - Run all integration tests once
- `pnpm test:integration:watch` - Run tests in watch mode
- `pnpm test:integration:verbose` - Run with verbose output (useful for debugging)

### Environment Variables

- `VERBOSE=true` - Enable verbose logging during tests
- `KEEP_OUTPUT=true` - Keep test output directories (don't clean up)
- `CI=true` - Use CI-specific timeouts (longer)

## Test Structure

### Test Helper (`test-helper.ts`)

The test helper provides utilities for integration testing:

#### `TestRig`

Main class for setting up and running tests:

```typescript
const rig = new TestRig()

// Setup test environment
rig.setup("test-name", {
	config: {
		/* CLI config */
	},
	env: {
		/* environment variables */
	},
})

// Create test files
rig.createFile("example.txt", "content")

// Run non-interactive
const result = await rig.run("prompt text", "--auto")

// Run interactive with PTY
const run = await rig.runInteractive(["--nosplash"])
```

#### `InteractiveRun`

Class for interacting with PTY-based CLI sessions:

```typescript
const run = await rig.runInteractive()

// Wait for text to appear
await run.expectText("Kilo Code")

// Wait for regex pattern
await run.expectPattern(/ready/i)

// Type text (with echo verification)
await run.type("/help")

// Send text immediately
await run.sendText("hello")

// Send keys one at a time
await run.sendKeys("multi-line\nprompt")

// Press special keys
await run.pressEnter()
await run.pressEscape()
await run.sendCtrlC()

// Get output
const stripped = run.getStrippedOutput()

// Kill process
await run.kill()
```

### Helper Functions

```typescript
// Poll for a condition
await poll(() => someCondition(), timeout, interval)

// Verify logo appears
expectKiloCodeLogo(output)

// Create minimal valid config
const config = createMinimalConfig()
```

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, beforeEach, afterEach } from "vitest"
import { TestRig, createMinimalConfig } from "./test-helper.js"

describe("Feature Name", () => {
	let rig: TestRig

	beforeEach(() => {
		rig = new TestRig()
	})

	afterEach(async () => {
		await rig.cleanup()
	})

	it("should do something", async () => {
		// Setup
		const config = createMinimalConfig()
		rig.setup("test-name", { config })

		// Run
		const run = await rig.runInteractive()

		// Verify
		await run.expectText("expected output")

		// Cleanup
		await run.sendCtrlC()
	}, 30000) // Timeout in ms
})
```

### Non-Interactive Tests

For testing CLI in autonomous/batch mode:

```typescript
it("should run in autonomous mode", async () => {
	const config = createMinimalConfig()
	rig.setup("autonomous-test", { config })

	const result = await rig.run({
		prompt: "echo hello",
		args: ["--auto", "--timeout", "5"],
	})

	expect(result.exitCode).toBe(0)
	expect(result.stdout).toContain("expected text")
})
```

### Interactive Tests

For testing user interactions:

```typescript
it("should respond to commands", async () => {
	const config = createMinimalConfig()
	rig.setup("interactive-test", { config })

	const run = await rig.runInteractive()

	// Wait for ready state
	await run.expectText("Type a message")

	// Send command
	await run.type("/help")
	await run.pressEnter()

	// Verify response
	await run.expectText("Available commands")

	await run.sendCtrlC()
})
```

## Best Practices

1. **Always clean up**: Use `afterEach` to call `rig.cleanup()`

2. **Set timeouts**: Integration tests can be slow, set appropriate timeouts:

    ```typescript
    it("test name", async () => {
    	// test code
    }, 30000) // 30 second timeout
    ```

3. **Use strip-ansi**: Terminal output has ANSI codes, use `stripAnsi()` or `getStrippedOutput()`:

    ```typescript
    const stripped = run.getStrippedOutput()
    expect(stripped).toContain("text")
    ```

4. **Wait for conditions**: Don't assume immediate output, use `expectText()` or `poll()`:

    ```typescript
    await run.expectText("ready", 5000)
    ```

5. **Build before testing**: Integration tests need the bundled CLI:

    ```bash
    pnpm build && pnpm test:integration
    ```

6. **Debug with verbose mode**: Use `VERBOSE=true` and `KEEP_OUTPUT=true` when debugging:
    ```bash
    VERBOSE=true KEEP_OUTPUT=true pnpm test:integration
    ```

## Current Tests

### `logo.test.ts`

Tests that verify the Kilo Code logo is displayed correctly:

- ✅ Logo appears on startup with valid config
- ✅ Logo appears when using environment variables
- ✅ Logo appears in autonomous mode
- ✅ --nosplash flag hides welcome message
- ✅ ASCII logo shows for narrow terminals
- ✅ Big text logo shows for wide terminals

## Future Test Ideas

- Command execution (`/help`, `/mode`, `/model`, etc.)
- Message approval workflow
- File operations
- Multi-turn conversations
- Error handling
- Git integration (parallel mode)
- Configuration management
- Provider/model switching

## Troubleshooting

### Tests timeout

- Increase test timeout: `it('test', async () => { ... }, 60000)`
- Check if CLI is built: `pnpm build`
- Run with verbose mode: `VERBOSE=true pnpm test:integration`

### Can't find bundled CLI

- Make sure to build first: `pnpm build`
- Check that `dist/index.js` exists
- Verify bundle path in `test-helper.ts`

### PTY issues

- PTY doesn't work well in some CI environments
- May need to mock or skip interactive tests in CI
- Use `CI` environment variable to adjust behavior

### Output doesn't match expected

- Use `KEEP_OUTPUT=true` to inspect test directories
- Check ANSI codes: use `stripAnsi()` or `getStrippedOutput()`
- Add debug logging: `console.log(run.output)`

## Contributing

When adding new integration tests:

1. Create a new `.test.ts` file in this directory
2. Follow the existing test structure
3. Document what the test covers
4. Set appropriate timeouts
5. Clean up resources in `afterEach`
6. Update this README with test descriptions
