# Technology Stack

## Development Requirements

- **Node.js**: v20.18.1 (exact version via .nvmrc)
- **pnpm**: v10.8.1 (enforced via preinstall script) - NEVER use npm
- **Extension Runtime**: Extension runs automatically in VSCode - NEVER try to run watch mode
- **TypeScript Compilation**: NEVER run `tsc` manually - compilation happens automatically in VSCode

## Testing Commands

### Fast Targeted Testing

```bash
# Core extension test (Vitest) - PREFERRED
cd $WORKSPACE_ROOT/src; npx vitest run **/*.spec.ts

# Core extension test (Jest)
cd $WORKSPACE_ROOT/src; npx jest src/api/providers/__tests__/anthropic.test.ts

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
