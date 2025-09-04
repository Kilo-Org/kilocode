# Technology Stack

## Development Requirements

- **Node.js**: v20.18.1 (exact version via .nvmrc)
- **pnpm**: v10.8.1 (enforced via preinstall script) - NEVER use npm
- **Extension Runtime**: Extension runs automatically in VSCode - NEVER try to run watch mode

## Testing Commands

### Fast Targeted Testing

```bash
# Core extension test (Vitest) - PREFERRED
cd $WORKSPACE_ROOT/src; npx vitest run **/*.spec.ts

# Webview test (Jest)
cd $WORKSPACE_ROOT/webview-ui; npx jest src/components/__tests__/component.test.tsx
```

### Full Test Suite

```bash
# From workspace root only - slow, includes build
pnpm test
```

## Critical Testing Rules

- **NEVER run tests in watch mode** - causes system hang
- **Always verify file exists** with list_files before running tests
- **Use correct path format**: Remove `src/` prefix for vitest, keep for jest
- **Jest config**: Looks for `**/__tests__/**/*.test.ts` files
- **Vitest config**: Looks for `**/__tests__/**/*.spec.ts` files

## Terminal Integration

- **WORKSPACE_ROOT Environment Variable**: All Kilo Code terminals automatically have `$WORKSPACE_ROOT` set to workspace root
- **Cross-platform**: Works on Windows (`%WORKSPACE_ROOT%`), macOS, and Linux (`$WORKSPACE_ROOT`)

## JetBrains Plugin Development

### Build System

- **Gradle**: Uses IntelliJ Platform Gradle Plugin 2.x
- **Kotlin**: Primary language for plugin development
- **Java**: 17+ required (Java 21 for platform version 2024.3+)

### Key Dependencies

- **IntelliJ Platform**: Core IDE integration APIs
- **Git4Idea**: Git integration and VCS operations
- **VCS Module**: Version control system framework

### Plugin Structure

- **Source**: `jetbrains/plugin/src/main/kotlin/`
- **Resources**: `jetbrains/plugin/src/main/resources/`
- **Configuration**: `jetbrains/plugin/src/main/resources/META-INF/plugin.xml`
- **Build**: `jetbrains/plugin/build.gradle.kts`

## Git Commit Message Integration

### VSCode Extension Components

- **CommitMessageProvider**: AI-powered message generation orchestrator
- **GitExtensionService**: Git operations using shell commands
- **Single Completion Handler**: Lightweight AI API interface
- **Support Prompt System**: Conventional commit message templates

### JetBrains Plugin Components

- **CheckinHandlerFactory**: Commit dialog integration point
- **CheckinHandler**: UI components and commit workflow hooks
- **Git Integration**: Native JetBrains VCS API usage
- **RPC Communication**: Socket-based communication with VSCode extension

### Command Interface

```typescript
// External command for JetBrains integration
'kilo-code.generateCommitMessageForExternal'

// Parameters
{
  workspacePath: string,  // Absolute path to Git repository
  staged?: boolean        // Whether to analyze staged or unstaged changes
}

// Response format
{
  message: string,        // Generated commit message
  error?: string         // Error message if generation failed
}
```
