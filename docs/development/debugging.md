# Debugging and Development Tools Documentation

## Overview

Kilo Code provides comprehensive debugging and development tools to help developers efficiently debug the VS Code extension, webview UI, and related components.
This documentation covers debugging configurations, development workflows, performance profiling, and troubleshooting techniques.

## VS Code Extension Debugging

### Debug Configurations

The project includes pre-configured debug settings in `.vscode/launch.json`:

#### 1. Run Extension (Standard)

```json
{
	"name": "Run Extension",
	"type": "extensionHost",
	"request": "launch",
	"runtimeExecutable": "${execPath}",
	"args": ["--extensionDevelopmentPath=${workspaceFolder}/src"],
	"sourceMaps": true,
	"outFiles": ["${workspaceFolder}/dist/**/*.js"],
	"preLaunchTask": "${defaultBuildTask}",
	"env": {
		"NODE_ENV": "development",
		"VSCODE_DEBUG_MODE": "true"
	}
}
```

**Features:**

- Automatic build before debugging
- Source map support for TypeScript debugging
- Development environment variables
- Full extension functionality

#### 2. Run Extension [Isolated]

```json
{
	"name": "Run Extension [Isolated]",
	"type": "extensionHost",
	"request": "launch",
	"args": ["--extensionDevelopmentPath=${workspaceFolder}/src", "--disable-extensions", "${workspaceFolder}/launch"]
}
```

**Features:**

- Isolated testing environment
- Disabled other extensions
- Clean workspace for testing
- Focused debugging experience

### Debugging Workflow

#### Starting a Debug Session

1. **Set Breakpoints**: Click in the gutter next to line numbers
2. **Select Configuration**: Choose "Run Extension" or "Run Extension [Isolated]"
3. **Start Debugging**: Press F5 or use the Debug panel
4. **Extension Host Opens**: New VS Code window with extension loaded

#### Debug Features

- **Breakpoints**: Set, disable, and manage breakpoints
- **Step Through Code**: Step over, into, and out of functions
- **Variable Inspection**: Examine variables in the Debug Console
- **Call Stack**: Navigate through the execution stack
- **Watch Expressions**: Monitor specific variables or expressions

### Extension-Specific Debugging

#### Activation Debugging

```typescript
// src/extension.ts
export async function activate(context: vscode.ExtensionContext) {
	console.log("Extension activating...") // Debug output

	// Set breakpoint here to debug activation
	const provider = new SidebarProvider(context)

	// Debug command registration
	const disposable = vscode.commands.registerCommand("kilo-code.newTask", () => {
		// Breakpoint for command debugging
	})
}
```

#### Webview Communication Debugging

```typescript
// Debug message passing
webviewPanel.webview.onDidReceiveMessage((message) => {
	console.log("Received message:", message) // Debug log
	// Set breakpoint to inspect messages
})
```

#### Service Layer Debugging

```typescript
// src/services/example/ExampleService.ts
export class ExampleService {
	async processRequest(request: any) {
		console.log("Processing request:", request)
		// Set breakpoint for service debugging

		try {
			const result = await this.handleRequest(request)
			return result
		} catch (error) {
			console.error("Service error:", error) // Debug error logging
			throw error
		}
	}
}
```

## Webview UI Debugging

### Browser Developer Tools

The webview UI runs in a browser context within VS Code, allowing standard web debugging:

#### Accessing Developer Tools

1. **Open Command Palette**: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. **Run Command**: "Developer: Open Webview Developer Tools"
3. **Select Webview**: Choose the Kilo Code webview

#### Development Server Debugging

For enhanced debugging during development:

```bash
# Start webview development server
cd webview-ui
pnpm dev
```

**Features:**

- Hot Module Replacement (HMR)
- React Developer Tools support
- Source maps for TypeScript
- Network request inspection

### React Component Debugging

#### React Developer Tools

Install the React Developer Tools browser extension for enhanced debugging:

- **Component Tree**: Inspect React component hierarchy
- **Props and State**: Examine component props and state
- **Performance Profiling**: Analyze component render performance
- **Hooks Debugging**: Debug React hooks usage

#### Component Debugging Patterns

```typescript
// webview-ui/src/components/ExampleComponent.tsx
import { useEffect, useState } from 'react'

export const ExampleComponent = () => {
  const [state, setState] = useState(null)

  useEffect(() => {
    console.log('Component mounted') // Debug log
    // Set breakpoint for effect debugging
  }, [])

  const handleClick = () => {
    console.log('Button clicked', state) // Debug interaction
    // Breakpoint for event handling
  }

  return <button onClick={handleClick}>Click me</button>
}
```

### State Management Debugging

#### Context Debugging

```typescript
// webview-ui/src/context/ExtensionStateContext.tsx
export const ExtensionStateProvider = ({ children }) => {
  const [state, setState] = useState(initialState)

  const updateState = (newState) => {
    console.log('State update:', { old: state, new: newState })
    // Breakpoint for state debugging
    setState(newState)
  }

  return (
    <ExtensionStateContext.Provider value={{ state, updateState }}>
      {children}
    </ExtensionStateContext.Provider>
  )
}
```

## Development Tasks and Automation

### VS Code Tasks Configuration

The `.vscode/tasks.json` provides automated development tasks:

#### Watch Tasks

```json
{
	"label": "watch",
	"dependsOn": ["watch:pnpm", "watch:webview", "watch:bundle", "watch:tsc"],
	"group": { "kind": "build", "isDefault": true }
}
```

**Components:**

- **watch:pnpm**: Monitors package.json changes
- **watch:webview**: Runs Vite development server
- **watch:bundle**: Watches extension bundle changes
- **watch:tsc**: TypeScript compilation watching

#### Individual Watch Tasks

1. **watch:webview**: Vite development server with HMR
2. **watch:bundle**: esbuild watch mode for extension
3. **watch:tsc**: TypeScript compiler in watch mode
4. **watch:pnpm**: Automatic dependency installation

### Development Scripts

#### Bootstrap Script

```javascript
// scripts/bootstrap.mjs
// Ensures pnpm is available and installs dependencies
```

**Features:**

- Automatic pnpm installation if missing
- Dependency installation
- Environment setup
- Error handling and recovery

#### VSIX Installation Script

```javascript
// scripts/install-vsix.js
// Automates extension installation for testing
```

**Usage:**

```bash
node scripts/install-vsix.js -y --editor=code
```

**Features:**

- Automatic uninstall of existing version
- VSIX package installation
- Multiple editor support (code, cursor, code-insiders)
- Interactive and automated modes

#### Internationalization Tools

```javascript
// scripts/find-missing-i18n-key.js
// Finds missing translation keys
```

**Usage:**

```bash
node scripts/find-missing-i18n-key.js --locale=de --file=chat.json
```

**Features:**

- Missing translation detection
- Locale-specific checking
- File-specific analysis
- Comprehensive reporting

## Performance Profiling and Optimization

### Extension Performance Profiling

#### VS Code Performance Tools

1. **Developer Tools**: Access via Command Palette
2. **Performance Profiler**: Built-in VS Code profiling
3. **Extension Host Profiling**: Monitor extension performance

#### Performance Monitoring

```typescript
// Performance measurement example
const startTime = performance.now()

await someAsyncOperation()

const endTime = performance.now()
console.log(`Operation took ${endTime - startTime} milliseconds`)
```

#### Memory Usage Monitoring

```typescript
// Memory usage tracking
const memoryUsage = process.memoryUsage()
console.log("Memory usage:", {
	rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
	heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
	heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
})
```

### Webview Performance Profiling

#### React Performance Profiling

1. **React DevTools Profiler**: Analyze component render times
2. **Performance API**: Use browser performance APIs
3. **Bundle Analysis**: Analyze bundle size and composition

#### Bundle Analysis

```bash
# Analyze webview bundle
cd webview-ui
pnpm build
npx vite-bundle-analyzer dist
```

#### Performance Optimization Techniques

1. **Code Splitting**: Lazy load components and modules
2. **Memoization**: Use React.memo and useMemo
3. **Virtual Scrolling**: For large lists
4. **Image Optimization**: Optimize assets
5. **Bundle Optimization**: Tree shaking and minification

### Build Performance Optimization

#### Turbo Cache Analysis

```bash
# Check Turbo cache effectiveness
npx turbo build --dry-run
npx turbo build --summarize
```

#### Build Time Profiling

```bash
# Profile build times
time pnpm build
npx turbo build --profile
```

## Logging and Monitoring

### Extension Logging

#### Output Channel Logging

```typescript
// src/utils/logging/logger.ts
const outputChannel = vscode.window.createOutputChannel("Kilo Code")

export const logger = {
	info: (message: string) => {
		outputChannel.appendLine(`[INFO] ${new Date().toISOString()}: ${message}`)
	},
	error: (message: string, error?: Error) => {
		outputChannel.appendLine(`[ERROR] ${new Date().toISOString()}: ${message}`)
		if (error) {
			outputChannel.appendLine(error.stack || error.message)
		}
	},
}
```

#### Structured Logging

```typescript
// Structured logging with context
export class CompactLogger {
	private context: string

	constructor(context: string) {
		this.context = context
	}

	log(level: string, message: string, data?: any) {
		const logEntry = {
			timestamp: new Date().toISOString(),
			level,
			context: this.context,
			message,
			data,
		}

		console.log(JSON.stringify(logEntry))
	}
}
```

### Webview Logging

#### Console Logging

```typescript
// webview-ui/src/utils/logger.ts
export const logger = {
	debug: (message: string, data?: any) => {
		if (process.env.NODE_ENV === "development") {
			console.log(`[DEBUG] ${message}`, data)
		}
	},

	error: (message: string, error?: Error) => {
		console.error(`[ERROR] ${message}`, error)
		// Send to extension for centralized logging
		vscode.postMessage({
			type: "log",
			level: "error",
			message,
			error: error?.message,
		})
	},
}
```

## Troubleshooting Common Issues

### Extension Development Issues

#### Extension Not Loading

**Symptoms:**

- Extension doesn't appear in Extensions view
- Commands not registered
- No activation events

**Solutions:**

1. Check `package.json` manifest
2. Verify activation events
3. Check extension host console
4. Rebuild extension bundle

```bash
# Rebuild and reinstall
pnpm clean
pnpm build
node scripts/install-vsix.js -y
```

#### Webview Not Displaying

**Symptoms:**

- Blank webview panel
- Webview content not loading
- JavaScript errors in webview

**Solutions:**

1. Check webview build output
2. Verify CSP (Content Security Policy)
3. Check browser developer tools
4. Rebuild webview bundle

```bash
# Rebuild webview
cd webview-ui
pnpm clean
pnpm build
```

#### Source Maps Not Working

**Symptoms:**

- Breakpoints not hitting
- Unable to debug TypeScript
- Stack traces show compiled JavaScript

**Solutions:**

1. Verify source map generation
2. Check `outFiles` configuration
3. Ensure proper build configuration
4. Clear VS Code cache

### Performance Issues

#### Slow Extension Startup

**Diagnosis:**

```typescript
// Add timing to activation
export async function activate(context: vscode.ExtensionContext) {
	const startTime = Date.now()

	// Extension initialization

	const endTime = Date.now()
	console.log(`Extension activated in ${endTime - startTime}ms`)
}
```

**Solutions:**

1. Lazy load heavy dependencies
2. Optimize activation events
3. Use background initialization
4. Profile startup code

#### Memory Leaks

**Diagnosis:**

```typescript
// Monitor memory usage
setInterval(() => {
	const usage = process.memoryUsage()
	console.log("Memory:", usage.heapUsed / 1024 / 1024, "MB")
}, 10000)
```

**Solutions:**

1. Proper disposal of resources
2. Remove event listeners
3. Clear timers and intervals
4. Dispose VS Code disposables

### Build and Development Issues

#### Build Failures

**Common Causes:**

- TypeScript compilation errors
- Missing dependencies
- Configuration issues
- File system permissions

**Solutions:**

```bash
# Clean and rebuild
pnpm clean
rm -rf node_modules
pnpm install
pnpm build
```

#### Watch Mode Issues

**Symptoms:**

- Changes not reflected
- Build not triggering
- File watching errors

**Solutions:**

1. Check file system permissions
2. Verify watch configuration
3. Restart watch processes
4. Check file system limits

```bash
# Restart all watch processes
pkill -f "watch"
pnpm run watch
```

## Advanced Debugging Techniques

### Remote Debugging

#### Extension Host Debugging

```bash
# Start VS Code with debugging enabled
code --inspect-extensions=9229
```

#### Node.js Debugging

```bash
# Debug Node.js processes
node --inspect-brk=9229 script.js
```

### Network Debugging

#### HTTP Request Debugging

```typescript
// Intercept and log HTTP requests
import axios from "axios"

axios.interceptors.request.use((request) => {
	console.log("Starting Request:", request)
	return request
})

axios.interceptors.response.use(
	(response) => {
		console.log("Response:", response)
		return response
	},
	(error) => {
		console.log("Request Error:", error)
		return Promise.reject(error)
	},
)
```

### Testing and Debugging Integration

#### Debug Tests

```json
// .vscode/launch.json - Test debugging configuration
{
	"name": "Debug Tests",
	"type": "node",
	"request": "launch",
	"program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
	"args": ["run", "${relativeFile}"],
	"console": "integratedTerminal",
	"sourceMaps": true
}
```

#### Test-Driven Debugging

```typescript
// Write failing test first
describe("Feature", () => {
	it("should work correctly", () => {
		// Set breakpoint here
		const result = myFunction()
		expect(result).toBe(expected)
	})
})
```

## Development Environment Setup

### Recommended VS Code Extensions

1. **TypeScript and JavaScript**: Enhanced TypeScript support
2. **ESLint**: Code linting and formatting
3. **Prettier**: Code formatting
4. **GitLens**: Git integration and history
5. **Thunder Client**: API testing
6. **Error Lens**: Inline error display

### Environment Configuration

#### VS Code Settings

```json
// .vscode/settings.json
{
	"files.exclude": {
		"out": false,
		"dist": false
	},
	"search.exclude": {
		"out": true,
		"dist": true
	},
	"typescript.tsc.autoDetect": "off",
	"vitest.disableWorkspaceWarning": true
}
```

#### Development Environment Variables

```bash
# .env.development
NODE_ENV=development
VSCODE_DEBUG_MODE=true
LOG_LEVEL=debug
```

## Best Practices

### Debugging Best Practices

1. **Use Descriptive Breakpoints**: Add conditions and log points
2. **Structured Logging**: Use consistent logging format
3. **Error Boundaries**: Implement proper error handling
4. **Performance Monitoring**: Regular performance checks
5. **Documentation**: Document debugging procedures

### Development Workflow

1. **Start with Tests**: Write tests before debugging
2. **Incremental Development**: Small, testable changes
3. **Regular Profiling**: Monitor performance regularly
4. **Code Reviews**: Peer review for debugging insights
5. **Documentation**: Keep debugging notes updated

### Performance Optimization

1. **Profile First**: Measure before optimizing
2. **Focus on Bottlenecks**: Address the slowest parts first
3. **Monitor Continuously**: Regular performance monitoring
4. **User Experience**: Prioritize user-facing performance
5. **Resource Management**: Proper cleanup and disposal

## Tools and Utilities Summary

### Built-in Tools

- **VS Code Debugger**: Primary debugging interface
- **Developer Tools**: Webview debugging
- **Output Channels**: Extension logging
- **Performance Profiler**: Built-in performance monitoring

### External Tools

- **React DevTools**: React component debugging
- **Node.js Inspector**: Advanced Node.js debugging
- **Chrome DevTools**: Web debugging capabilities
- **Performance APIs**: Browser performance monitoring

### Custom Scripts

- **bootstrap.mjs**: Environment setup
- **install-vsix.js**: Extension installation
- **find-missing-i18n-key.js**: Translation validation
- **Build scripts**: Automated build processes

This comprehensive debugging and development tools documentation provides developers with the knowledge and tools needed to effectively debug,
profile, and optimize the Kilo Code extension and its components.
