# Testing Framework and Strategies

## Overview

Kilo Code uses a comprehensive testing strategy that includes unit testing, integration testing, and end-to-end testing.
The testing framework is built around [Vitest](https://vitest.dev/) for unit tests and [Playwright](https://playwright.dev/) for E2E testing,
with specialized configurations for VS Code extension testing.

## Testing Architecture

### Testing Layers

```
┌─────────────────────────────────────────┐
│           E2E Testing                   │
│  ┌─────────────────┐ ┌─────────────────┐│
│  │   Playwright    │ │  VS Code E2E    ││
│  │   Web Tests     │ │  Extension      ││
│  └─────────────────┘ └─────────────────┘│
├─────────────────────────────────────────┤
│         Integration Testing             │
│  ┌─────────────────┐ ┌─────────────────┐│
│  │   Service       │ │   Component     ││
│  │   Integration   │ │   Integration   ││
│  └─────────────────┘ └─────────────────┘│
├─────────────────────────────────────────┤
│           Unit Testing                  │
│  ┌─────────────────┐ ┌─────────────────┐│
│  │   Extension     │ │   Webview UI    ││
│  │   Units         │ │   Components    ││
│  └─────────────────┘ └─────────────────┘│
└─────────────────────────────────────────┘
```

## Vitest Configuration

### Extension Testing Configuration

The main extension uses Vitest with Node.js environment:

```typescript
// src/vitest.config.ts
export default defineConfig({
	test: {
		globals: true,
		setupFiles: ["./vitest.setup.ts"],
		watch: false,
		reporters: ["dot"],
		silent: true,
		testTimeout: 20_000,
		hookTimeout: 20_000,
	},
	resolve: {
		alias: {
			vscode: path.resolve(__dirname, "./__mocks__/vscode.js"),
		},
	},
})
```

### Webview UI Testing Configuration

The webview UI uses Vitest with jsdom environment for React testing:

```typescript
// webview-ui/vitest.config.ts
export default defineConfig({
	test: {
		globals: true,
		setupFiles: ["./vitest.setup.ts"],
		environment: "jsdom",
		include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@src": path.resolve(__dirname, "./src"),
			"@roo": path.resolve(__dirname, "../src/shared"),
		},
	},
})
```

### Test Setup and Configuration

#### Extension Test Setup

```typescript
// src/vitest.setup.ts
import nock from "nock"

// Disable network requests by default
nock.disableNetConnect()

// Global mocks for extension environment
global.structuredClone = global.structuredClone || ((obj: any) => JSON.parse(JSON.stringify(obj)))

// Console suppression for cleaner test output
console.log = () => {}
console.warn = () => {}
console.info = () => {}
```

#### Webview Test Setup

```typescript
// webview-ui/vitest.setup.ts
import "@testing-library/jest-dom"
import "@testing-library/jest-dom/vitest"

// React Testing Library setup
globalThis.process.env.NODE_ENV = "test"

// Mock browser APIs
global.ResizeObserver = MockResizeObserver
Element.prototype.scrollIntoView = vi.fn()
```

## Testing Patterns and Strategies

### Unit Testing Patterns

#### 1. Service Layer Testing

```typescript
// Example: src/services/marketplace/__tests__/MarketplaceManager.spec.ts
describe("MarketplaceManager", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should load marketplace items", async () => {
		const manager = new MarketplaceManager()
		const items = await manager.loadItems()
		expect(items).toBeDefined()
	})
})
```

#### 2. Utility Function Testing

```typescript
// Example: src/utils/__tests__/config.spec.ts
describe("config utilities", () => {
	it("should inject environment variables", () => {
		const result = injectEnv("Hello ${NODE_ENV}", { NODE_ENV: "test" })
		expect(result).toBe("Hello test")
	})
})
```

#### 3. React Component Testing

```typescript
// Example: webview-ui/src/components/ui/hooks/__tests__/useSelectedModel.spec.ts
import { renderHook } from "@testing-library/react"
import { useSelectedModel } from "../useSelectedModel"

describe("useSelectedModel", () => {
	it("should return default model when none selected", () => {
		const { result } = renderHook(() => useSelectedModel())
		expect(result.current.model).toBe("claude-3-5-sonnet-20241022")
	})
})
```

### Mocking Strategies

#### 1. VS Code API Mocking

The project uses a comprehensive VS Code API mock:

```javascript
// src/__mocks__/vscode.js
export const workspace = {
	workspaceFolders: [],
	getConfiguration: () => ({ get: () => null }),
	fs: {
		readFile: () => Promise.resolve(new Uint8Array()),
		writeFile: () => Promise.resolve(),
	},
}

export const window = {
	showErrorMessage: () => Promise.resolve(),
	createOutputChannel: () => ({
		appendLine: () => {},
		show: () => {},
	}),
}
```

#### 2. File System Mocking

```typescript
// src/__mocks__/fs/promises.ts
const mockFiles = new Map()
const mockDirectories = new Set()

const mockFs = {
	readFile: vi.fn().mockImplementation(async (filePath: string) => {
		if (mockFiles.has(filePath)) {
			return mockFiles.get(filePath)
		}
		throw new Error(`ENOENT: no such file or directory`)
	}),

	writeFile: vi.fn().mockImplementation(async (path: string, content: string) => {
		mockFiles.set(path, content)
	}),
}
```

#### 3. Network Request Mocking

```typescript
// Using nock for HTTP mocking
import nock from "nock"

beforeEach(() => {
	nock("https://api.example.com").get("/data").reply(200, { success: true })
})
```

### Integration Testing

#### 1. Service Integration Tests

```typescript
describe("Service Integration", () => {
	it("should integrate multiple services", async () => {
		const browserService = new BrowserService()
		const contentFetcher = new UrlContentFetcher(browserService)

		const result = await contentFetcher.fetchContent("https://example.com")
		expect(result).toContain("expected content")
	})
})
```

#### 2. Component Integration Tests

```typescript
describe("Component Integration", () => {
  it("should handle user interactions", async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(screen.getByText("Settings saved")).toBeInTheDocument()
  })
})
```

## End-to-End Testing

### Playwright Configuration

#### Web Application E2E Testing

```typescript
// apps/playwright-e2e/playwright.config.ts
export default defineConfig<void, TestOptions>({
	timeout: 120_000,
	expect: { timeout: 30_000 },
	reporter: process.env.CI ? "html" : "list",
	workers: process.env.CI ? 2 : 1,
	retries: process.env.CI ? 2 : 0,
	projects: [{ name: "VSCode stable", use: { vscodeVersion: "stable" } }],
	use: {
		trace: "on-first-retry",
		video: "retry-with-video",
	},
})
```

#### VS Code Extension E2E Testing

```javascript
// apps/vscode-e2e/.vscode-test.mjs
export default defineConfig({
	label: "integrationTest",
	files: "out/suite/**/*.test.js",
	workspaceFolder: ".",
	mocha: {
		ui: "tdd",
		timeout: 60000,
	},
	launchArgs: ["--enable-proposed-api=kilocode.Kilo-Code", "--disable-extensions"],
})
```

### E2E Testing Patterns

#### 1. Extension Activation Tests

```typescript
suite("Extension Activation", () => {
	test("should activate extension", async () => {
		const extension = vscode.extensions.getExtension("kilocode.Kilo-Code")
		await extension?.activate()
		assert.ok(extension?.isActive)
	})
})
```

#### 2. User Workflow Tests

```typescript
test("complete user workflow", async ({ page }) => {
	await page.goto("/")
	await page.click('[data-testid="new-chat"]')
	await page.fill('[data-testid="message-input"]', "Hello")
	await page.click('[data-testid="send-button"]')

	await expect(page.locator('[data-testid="message"]')).toContainText("Hello")
})
```

## Test Organization and Structure

### Directory Structure

```
src/
├── __tests__/                    # Global extension tests
├── services/
│   └── marketplace/
│       └── __tests__/           # Service-specific tests
├── utils/
│   └── __tests__/               # Utility function tests
└── __mocks__/                   # Global mocks

webview-ui/
├── src/
│   ├── components/
│   │   └── ui/
│   │       └── hooks/
│   │           └── __tests__/   # Hook tests
│   └── utils/
│       └── __tests__/           # Utility tests

apps/
├── playwright-e2e/
│   └── tests/                   # Playwright E2E tests
└── vscode-e2e/
    └── src/
        └── suite/               # VS Code E2E tests
```

### Test Naming Conventions

- **Unit Tests**: `*.spec.ts` or `*.spec.tsx`
- **Integration Tests**: `*.integration.spec.ts`
- **E2E Tests**: `*.test.ts` (Playwright) or `*.test.js` (VS Code)

### Test File Organization

```typescript
// Standard test file structure
describe("ComponentName", () => {
	beforeEach(() => {
		// Setup before each test
	})

	afterEach(() => {
		// Cleanup after each test
	})

	describe("method or feature", () => {
		it("should behave correctly", () => {
			// Test implementation
		})
	})
})
```

## Coverage Requirements and Reporting

### Coverage Configuration

```typescript
// vitest.config.ts coverage settings
export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/", "dist/", "**/*.spec.ts", "**/*.test.ts", "__mocks__/"],
		},
	},
})
```

### Coverage Targets

- **Unit Tests**: Minimum 80% line coverage
- **Critical Services**: Minimum 90% line coverage
- **Utility Functions**: Minimum 95% line coverage
- **UI Components**: Minimum 70% line coverage

### Coverage Reporting

```bash
# Generate coverage report
pnpm test --coverage

# View HTML coverage report
open coverage/index.html
```

## Test Execution and Commands

### Running Tests

#### Unit Tests

```bash
# Run all unit tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run tests for specific package
pnpm --filter @roo-code/vscode-webview test

# Run specific test file
npx vitest src/utils/__tests__/config.spec.ts
```

#### E2E Tests

```bash
# Run Playwright E2E tests
pnpm --filter @roo-code/playwright-e2e playwright

# Run VS Code E2E tests
pnpm --filter @roo-code/vscode-e2e test:run

# Run E2E tests in CI mode
pnpm --filter @roo-code/vscode-e2e test:ci
```

### Test Scripts in package.json

```json
{
	"scripts": {
		"test": "vitest run",
		"test:watch": "vitest",
		"test:coverage": "vitest run --coverage",
		"test:ui": "vitest --ui",
		"test:ci": "vitest run --reporter=junit --outputFile=test-results.xml"
	}
}
```

## Continuous Integration Testing

### GitHub Actions Integration

```yaml
# .github/workflows/test.yml
- name: Run unit tests
  run: pnpm test

- name: Run E2E tests
  run: pnpm playwright

- name: Upload test results
  uses: actions/upload-artifact@v3
  with:
      name: test-results
      path: test-results/
```

### Test Environment Setup

```bash
# CI test preparation
pnpm install --frozen-lockfile
pnpm build
pnpm test --run
```

## Debugging Tests

### VS Code Test Debugging

1. **Extension Tests**: Use VS Code's built-in debugger with launch configuration
2. **Webview Tests**: Use browser developer tools for React components
3. **E2E Tests**: Use Playwright's trace viewer and video recordings

### Debug Configuration

```json
// .vscode/launch.json
{
	"type": "node",
	"request": "launch",
	"name": "Debug Tests",
	"program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
	"args": ["run", "${relativeFile}"],
	"console": "integratedTerminal"
}
```

### Test Debugging Strategies

1. **Isolation**: Run single test files to isolate issues
2. **Logging**: Use `console.log` in tests (temporarily)
3. **Breakpoints**: Set breakpoints in test files and source code
4. **Mock Inspection**: Verify mock calls and return values

## Best Practices

### Test Writing Guidelines

1. **Descriptive Names**: Use clear, descriptive test names
2. **Single Responsibility**: Each test should verify one behavior
3. **Arrange-Act-Assert**: Structure tests with clear phases
4. **Independent Tests**: Tests should not depend on each other
5. **Deterministic**: Tests should produce consistent results

### Mock Guidelines

1. **Mock External Dependencies**: Always mock external services
2. **Minimal Mocking**: Only mock what's necessary
3. **Realistic Mocks**: Mocks should behave like real implementations
4. **Mock Verification**: Verify mock interactions when relevant

### Performance Considerations

1. **Parallel Execution**: Use Vitest's parallel test execution
2. **Test Isolation**: Avoid shared state between tests
3. **Resource Cleanup**: Clean up resources in afterEach/afterAll
4. **Selective Testing**: Use test patterns to run specific tests

## Troubleshooting Common Issues

### Test Failures

1. **Timeout Issues**: Increase timeout for slow operations
2. **Mock Issues**: Verify mock setup and reset between tests
3. **Environment Issues**: Check test environment configuration
4. **Async Issues**: Properly handle promises and async operations

### VS Code Extension Testing Issues

1. **Extension Not Loading**: Check activation events and manifest
2. **API Mocking**: Ensure VS Code API is properly mocked
3. **File System Issues**: Use proper file system mocks
4. **Webview Communication**: Mock message passing between extension and webview

### Performance Issues

1. **Slow Tests**: Profile tests and optimize heavy operations
2. **Memory Leaks**: Check for proper cleanup in tests
3. **Network Issues**: Use nock to mock network requests
4. **File System Issues**: Use in-memory file system mocks

## Future Improvements

### Planned Enhancements

1. **Visual Regression Testing**: Add screenshot comparison tests
2. **Performance Testing**: Add performance benchmarks
3. **Accessibility Testing**: Add automated accessibility tests
4. **Cross-Platform Testing**: Expand testing across different OS
5. **Test Analytics**: Add test performance and reliability metrics

### Testing Infrastructure

1. **Test Data Management**: Centralized test data and fixtures
2. **Test Utilities**: Shared testing utilities and helpers
3. **Custom Matchers**: Domain-specific test matchers
4. **Test Reporting**: Enhanced test reporting and analytics
5. **Parallel Testing**: Optimize parallel test execution
