# ContinueDev Integration with Kilocode

## Current Status

The ContinueDev library is **fully integrated** into the Kilocode monorepo as a TypeScript service component located at `src/services/continuedev/`.

**Integration Type**: Pure source code library - no independent build configuration or package management.

## What This Means

### This Library IS:

- ✅ A **TypeScript source code library** providing autocomplete and NextEdit functionality
- ✅ **Fully managed** by Kilocode's pnpm workspace
- ✅ **Part of Kilocode's build system** - uses parent TypeScript config, vitest, and tooling
- ✅ **Tested via Kilocode's test suite** - integrated into the main test workflow

### This Library IS NOT:

- ❌ NOT an independent npm package
- ❌ NOT a standalone repository
- ❌ DOES NOT have its own package.json or node_modules
- ❌ DOES NOT require separate installation or build steps

## Structure

```
src/services/continuedev/
├── core/                    # TypeScript source code
│   ├── autocomplete/        # Autocomplete feature
│   ├── nextEdit/           # NextEdit feature
│   ├── llm/                # LLM provider integrations
│   ├── diff/               # Myers diff algorithm
│   ├── util/               # Shared utilities
│   └── vscode-test-harness/ # VSCode integration example
├── tree-sitter/            # Tree-sitter query files
├── legacy_code_rewrite/    # Historical extraction docs (49 files)
├── API_REFERENCE.md        # API documentation
├── ARCHITECTURE.md         # Technical architecture
├── EXAMPLES.md            # Usage examples
├── INTEGRATION.md         # This file
├── LICENSE                # Apache 2.0
└── README.md              # Overview
```

**Note**: No package.json, tsconfig.json, or other build configuration files exist in this directory. All dependencies and configuration are managed by the parent Kilocode project.

## Development Workflow

### Working with ContinueDev Code

Since this library is fully integrated into Kilocode:

1. **Clone Kilocode repository**:

    ```bash
    git clone https://github.com/kilocode/kilocode.git
    cd kilocode
    ```

2. **Install all dependencies**:

    ```bash
    pnpm install
    ```

    This installs all dependencies for the entire Kilocode monorepo, including those needed by continuedev.

3. **Run tests**:

    ```bash
    # Run all Kilocode tests (includes continuedev tests)
    cd src && npx vitest run

    # Run specific continuedev test file
    cd src && npx vitest run services/continuedev/core/path/to/test.ts
    ```

4. **Type checking**:

    ```bash
    # Check types for entire Kilocode project (includes continuedev)
    pnpm check-types
    ```

5. **Make code changes**:
    - Edit files directly in `src/services/continuedev/`
    - Follow Kilocode's coding standards and practices
    - Add tests as needed
    - Ensure all tests pass before submitting

## Testing

The continuedev library includes **857 tests** that are part of Kilocode's test suite:

- Autocomplete tests (~400 tests)
- NextEdit tests (~210 tests)
- Infrastructure tests (~80 tests)
- Integration tests (86 VSCode test harness tests)
- Diff algorithm tests (~80 tests)

All tests run via Kilocode's vitest configuration from the `src/` directory.

## Dependencies

All dependencies required by continuedev are specified in Kilocode's root `package.json`. Key dependencies include:

- LLM SDKs: `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `@aws-sdk/*`
- Tree-sitter: `web-tree-sitter` and language grammars
- Utilities: `diff`, `cross-fetch`, `lru-cache`
- Testing: `vitest`, `@types/node`

These are installed automatically when you run `pnpm install` in the Kilocode project.

## Historical Context

### Extraction Process

This library was extracted from the Continue project in October 2025 through a multi-phase process:

1. **Initial Extraction** - Removed all non-autocomplete/NextEdit code from Continue
2. **Package Consolidation** - Merged internal @continuedev/\* packages into a single codebase
3. **Test Migration** - Migrated from Jest to Vitest, consolidated test infrastructure
4. **Monorepo Integration** - Fully integrated into Kilocode's pnpm workspace
5. **Final Cleanup** - Removed all independent tooling and configuration

The detailed history of this process is documented in the [`legacy_code_rewrite/`](legacy_code_rewrite/) directory (49 numbered files).

### Key Historical Documents

- [`49-INTEGRATION.md`](legacy_code_rewrite/49-INTEGRATION.md) - Previous integration approach (superseded)
- [`44-CLEANUP_STATUS.md`](legacy_code_rewrite/44-CLEANUP_STATUS.md) - Cleanup status from Continue extraction
- [`42-MONOREPO_MERGE.md`](legacy_code_rewrite/42-MONOREPO_MERGE.md) - Package consolidation process

**Note**: The integration approach documented in `legacy_code_rewrite/49-INTEGRATION.md` described a hybrid model with independent npm/turbo tooling. That approach has been superseded by full monorepo integration.

## Code Organization

### Why This Structure?

This library is organized as a **service component** within Kilocode because:

1. **Reusability**: The code can be used by different parts of Kilocode
2. **Isolation**: Clear separation from Kilocode-specific code
3. **Maintenance**: Easier to track and update code extracted from Continue
4. **Testing**: Comprehensive test suite validates functionality independently

### Integration Points

ContinueDev code is used by Kilocode through standard TypeScript imports:

```typescript
// In Kilocode code:
import { CompletionProvider } from "../services/continuedev/core/autocomplete/CompletionProvider"
import { NextEditProvider } from "../services/continuedev/core/nextEdit/NextEditProvider"
```

No special build steps or package linking required - it's just TypeScript code in the same project.

## Contributing

To contribute to the continuedev library within Kilocode:

1. Follow Kilocode's contribution guidelines
2. Ensure all tests pass: `cd src && npx vitest run`
3. Add tests for new features in the appropriate test files
4. Follow existing code style and TypeScript patterns
5. Update documentation as needed (README.md, API_REFERENCE.md, etc.)

## Summary

The ContinueDev library provides battle-tested autocomplete and NextEdit functionality from the Continue project, fully integrated into Kilocode's monorepo. It contains pure TypeScript source code without independent tooling, making it a seamless part of the Kilocode development workflow.

For technical details, see [`ARCHITECTURE.md`](ARCHITECTURE.md).  
For usage examples, see [`EXAMPLES.md`](EXAMPLES.md).  
For API documentation, see [`API_REFERENCE.md`](API_REFERENCE.md).
