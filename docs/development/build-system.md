# Build System Documentation

## Overview

Kilo Code uses a modern monorepo build system orchestrated by [Turbo](https://turbo.build/) with [pnpm](https://pnpm.io/) as the package manager.
The build system handles multiple packages including the VS Code extension, webview UI, documentation, and various supporting packages.

## Monorepo Structure

The project is organized as a pnpm workspace with the following structure:

```
kilo-code/
├── src/                    # Main VS Code extension
├── webview-ui/            # React-based webview interface
├── docs/                  # Documentation system
├── apps/                  # Application packages
│   ├── playwright-e2e/    # End-to-end tests
│   ├── storybook/         # Component library
│   ├── vscode-e2e/        # VS Code extension E2E tests
│   ├── vscode-nightly/    # Nightly build configuration
│   ├── web-docs/          # Web documentation
│   ├── web-evals/         # Evaluation tools
│   └── web-roo-code/      # Web interface
└── packages/              # Shared packages
    ├── build/             # Build utilities
    ├── cloud/             # Cloud services
    ├── config-eslint/     # ESLint configuration
    ├── config-typescript/ # TypeScript configuration
    ├── evals/             # Evaluation framework
    ├── ipc/               # Inter-process communication
    ├── telemetry/         # Telemetry utilities
    └── types/             # Shared TypeScript types
```

## Turbo Configuration

### Root Turbo Configuration

The main `turbo.json` defines the build pipeline tasks:

```json
{
	"tasks": {
		"build": {
			"outputs": ["dist/**"],
			"inputs": ["src/**", "package.json", "tsconfig.json", "tsup.config.ts", "vite.config.ts"]
		},
		"test": {
			"dependsOn": ["@roo-code/types#build"]
		},
		"lint": {},
		"check-types": {},
		"format": {},
		"clean": { "cache": false }
	}
}
```

### Task Dependencies

- **test**: Depends on `@roo-code/types#build` to ensure type definitions are built first
- **build**: Outputs to `dist/**` directories with proper input tracking
- **clean**: Runs without cache to ensure complete cleanup

### Workspace-Specific Tasks

Each workspace can extend the root configuration:

- **docs**: Has specialized tasks for documentation building (`docs:build`, `docs:validate`, `docs:check-links`)
- **webview-ui**: Includes development server tasks (`dev`, `preview`)
- **storybook**: Has persistent tasks for the Storybook development server

## Package Manager Configuration

### pnpm Workspace

The `pnpm-workspace.yaml` defines workspace packages:

```yaml
packages:
    - src
    - webview-ui
    - docs
    - apps/*
    - packages/*
```

### Dependency Management

- **onlyBuiltDependencies**: Ensures certain packages are built from source
- **overrides**: Security and compatibility overrides for specific packages
- **Frozen lockfile**: Production builds use `--frozen-lockfile` for reproducibility

## Extension Build System

### esbuild Configuration

The VS Code extension uses esbuild for fast bundling:

```javascript
// src/esbuild.mjs
const buildOptions = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	format: "cjs",
	platform: "node",
	external: ["vscode"],
}
```

### Build Targets

1. **Extension Bundle**: Main extension code (`extension.ts` → `dist/extension.js`)
2. **Worker Bundle**: Background workers (`workers/countTokens.ts` → `dist/workers/`)

### Build Plugins

- **copyFiles**: Copies static assets (README, CHANGELOG, LICENSE, icons)
- **copyWasms**: Handles WebAssembly files for tree-sitter parsing
- **copyLocales**: Manages internationalization files
- **esbuild-problem-matcher**: VS Code integration for build errors

### Asset Management

The build system automatically copies:

- Documentation files (README.md, CHANGELOG.md, LICENSE)
- VS Code Material Icons
- Audio files for webview
- Walkthrough content
- Locale files for internationalization

## Webview UI Build System

### Vite Configuration

The webview UI uses Vite with React:

```typescript
// webview-ui/vite.config.ts
export default defineConfig(({ mode }) => ({
	plugins: [react(), tailwindcss(), persistPortPlugin(), wasmPlugin()],
	build: {
		outDir: "../src/webview-ui/build",
		sourcemap: true,
		rollupOptions: {
			external: ["vscode"],
			output: {
				entryFileNames: "assets/[name].js",
				chunkFileNames: "assets/chunk-[hash].js",
			},
		},
	},
}))
```

### Build Modes

1. **Development**: Standard build with HMR support
2. **Production**: Optimized build with minification
3. **Nightly**: Special build for nightly releases with different branding

### Code Splitting

- **Mermaid Bundle**: Large diagram library is split into separate chunk
- **Font Assets**: Fonts are organized in dedicated directory
- **Manual Chunks**: Strategic chunking for optimal loading

### Development Features

- **HMR**: Hot module replacement for fast development
- **Port Persistence**: Saves dev server port to `.vite-port` file
- **CORS**: Configured for cross-origin development

## Build Scripts and Commands

### Root Package Scripts

```json
{
	"build": "pnpm vsix",
	"bundle": "turbo bundle --log-order grouped --output-logs new-only",
	"vsix": "turbo vsix --log-order grouped --output-logs new-only",
	"clean": "turbo clean --log-order grouped --output-logs new-only && rimraf dist out bin .vite-port .turbo"
}
```

### Extension Scripts

```json
{
	"bundle": "node esbuild.mjs",
	"watch:bundle": "pnpm bundle --watch",
	"watch:tsc": "cd .. && tsc --noEmit --watch --project src/tsconfig.json",
	"vsix": "mkdirp ../bin && vsce package --no-dependencies --out ../bin"
}
```

### Webview Scripts

```json
{
	"dev": "vite",
	"build": "tsc -b && vite build",
	"build:nightly": "tsc -b && vite build --mode nightly"
}
```

## Development vs Production Builds

### Development Build Characteristics

- **Source Maps**: Enabled for debugging
- **No Minification**: Readable code for development
- **Watch Mode**: Automatic rebuilding on file changes
- **HMR**: Hot module replacement for webview
- **Development Server**: Vite dev server for webview UI

### Production Build Characteristics

- **Minification**: Code is minified for smaller bundle size
- **No Source Maps**: Reduced bundle size
- **Asset Optimization**: Images and fonts are optimized
- **Tree Shaking**: Unused code is eliminated
- **Bundle Analysis**: Size analysis and optimization

### Build Optimization Strategies

1. **External Dependencies**: VS Code API is marked as external
2. **Code Splitting**: Large libraries are split into separate chunks
3. **Asset Optimization**: Fonts and images are optimized
4. **Bundle Size Monitoring**: Turbo tracks output sizes
5. **Caching**: Turbo caches build outputs for faster rebuilds

## Environment-Specific Configuration

### Environment Variables

The build system uses environment variables for configuration:

```javascript
const define = {
	"process.env.PKG_NAME": JSON.stringify(pkg.name),
	"process.env.PKG_VERSION": JSON.stringify(pkg.version),
	"process.env.PKG_OUTPUT_CHANNEL": JSON.stringify("Kilo-Code"),
	"process.env.PKG_SHA": JSON.stringify(gitSha),
}
```

### Nightly Builds

Nightly builds have special configuration:

- Different package name and branding
- Separate output directory
- Modified environment variables
- Different VS Code marketplace settings

## Build Performance

### Turbo Caching

Turbo provides intelligent caching:

- **Local Cache**: `.turbo/cache` stores build outputs
- **Input Tracking**: Only rebuilds when inputs change
- **Parallel Execution**: Tasks run in parallel when possible
- **Dependency Awareness**: Respects task dependencies

### Build Speed Optimizations

1. **esbuild**: Fast JavaScript bundler for extension
2. **Vite**: Fast development server and build tool for webview
3. **Parallel Tasks**: Turbo runs independent tasks in parallel
4. **Incremental Builds**: Only rebuilds changed packages
5. **Smart Caching**: Turbo caches based on input hashes

### Performance Monitoring

- **Build Times**: Turbo reports task execution times
- **Bundle Sizes**: Vite reports bundle size analysis
- **Cache Hit Rates**: Turbo shows cache effectiveness
- **Dependency Analysis**: Tools like `knip` detect unused dependencies

## Troubleshooting Common Issues

### Build Failures

1. **Clear Cache**: `pnpm clean` removes all build artifacts
2. **Reinstall Dependencies**: `pnpm install --frozen-lockfile`
3. **Check Node Version**: Ensure Node.js 20.19.2 is used
4. **Verify pnpm Version**: Use pnpm 10.8.1 as specified

### Development Issues

1. **Port Conflicts**: Check `.vite-port` file for webview dev server
2. **HMR Not Working**: Restart Vite dev server
3. **Type Errors**: Run `pnpm check-types` to verify TypeScript
4. **Extension Not Loading**: Check VS Code developer console

### Performance Issues

1. **Slow Builds**: Check Turbo cache status
2. **Large Bundles**: Analyze bundle with Vite build reports
3. **Memory Issues**: Increase Node.js memory limit if needed
4. **Watch Mode Issues**: Restart watch processes

## Integration with VS Code

### Extension Packaging

The build system integrates with VS Code extension packaging:

```json
{
	"main": "./dist/extension.js",
	"vscode:prepublish": "pnpm bundle --production",
	"vsix": "vsce package --no-dependencies --out ../bin"
}
```

### Development Workflow

1. **Extension Development**: Use `pnpm watch:bundle` for auto-rebuild
2. **Webview Development**: Use `pnpm dev` in webview-ui directory
3. **Type Checking**: Use `pnpm watch:tsc` for continuous type checking
4. **Testing**: Use `pnpm test` for unit tests

### Debugging Configuration

The build system supports VS Code debugging:

- Source maps are generated in development mode
- Extension can be debugged using VS Code's extension host
- Webview can be debugged using browser developer tools

## Continuous Integration

### GitHub Actions Integration

The build system is designed for CI/CD:

```yaml
- name: Install dependencies
  run: pnpm install --frozen-lockfile

- name: Build packages
  run: pnpm build

- name: Run tests
  run: pnpm test

- name: Package extension
  run: pnpm vsix
```

### Build Validation

CI runs the following validations:

- **Linting**: ESLint checks code quality
- **Type Checking**: TypeScript compiler validates types
- **Testing**: Vitest runs unit tests
- **Build**: Ensures all packages build successfully
- **Packaging**: Validates VS Code extension packaging

## Future Improvements

### Planned Enhancements

1. **Remote Caching**: Turbo remote cache for team builds
2. **Bundle Analysis**: Automated bundle size monitoring
3. **Build Metrics**: Performance tracking and optimization
4. **Dependency Updates**: Automated dependency management
5. **Build Notifications**: Integration with development tools

### Performance Targets

- **Extension Build**: < 5 seconds for incremental builds
- **Webview Build**: < 10 seconds for development builds
- **Full Clean Build**: < 60 seconds for entire monorepo
- **Cache Hit Rate**: > 80% for typical development workflows
