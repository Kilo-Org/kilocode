# Files and Dependencies That Cannot Be Removed

This file documents items flagged by knip as unused but are actually required.

## Test Fixtures

The following test fixture files are required by RootPathContextService tests:

- `core/autocomplete/context/root-path-context/__fixtures__/files/typescript/arrowFunctions.ts` - Used by arrow_function tests
- `core/autocomplete/context/root-path-context/__fixtures__/files/typescript/classes.ts` - Used by class_declaration tests
- `core/autocomplete/context/root-path-context/__fixtures__/files/typescript/classMethods.ts` - Used by method_declaration tests
- `core/autocomplete/context/root-path-context/__fixtures__/files/typescript/functions.ts` - Used by function_declaration tests
- `core/autocomplete/context/root-path-context/__fixtures__/files/typescript/generators.ts` - Used by generator function tests

These files are loaded at runtime by tests and not directly imported in TypeScript code.

## Dependencies

### tree-sitter-wasms

**Status:** REQUIRED - Must be kept

**Location:** `package.json` line 58

**Why it cannot be removed:**
This package provides the WASM binaries for tree-sitter language parsers that are essential for tree-sitter functionality. It is actively used in `core/util/treeSitter.ts` (lines 245, 248, 261) to load language-specific WASM files.

**Usage details:**

- The `loadLanguageForFileExt()` function searches for WASM files in multiple locations including:
    - `node_modules/tree-sitter-wasms/out/` (hoisted location)
    - `tree-sitter-wasms/` (local bundled layout)
- Each supported language (TypeScript, Python, JavaScript, Go, Rust, etc.) requires its corresponding WASM file (e.g., `tree-sitter-typescript.wasm`, `tree-sitter-python.wasm`)
- These WASM files are loaded dynamically at runtime via `Parser.Language.load()` to enable:
    - Code parsing and syntax tree generation
    - Symbol extraction from code files
    - Language-aware code analysis

**Impact if removed:**
Removing this dependency would break all tree-sitter functionality, preventing the system from:

- Parsing source code files
- Extracting symbols (classes, functions, methods)
- Understanding code structure across multiple programming languages

**Verification:**

```bash
grep -r "tree-sitter-wasms" core/ --include="*.ts"
```

Shows active usage in `core/util/treeSitter.ts`

### fetch-blob/from.js

**Status:** REQUIRED (transitive dependency) - No action needed

**Location:** Imported in `core/fetch/node-fetch-patch.js:31`

**Why it's not in package.json:**
This is a transitive dependency of `node-fetch` (listed in package.json line 47). The import uses a sub-path (`fetch-blob/from.js`) to access specific exports from the `fetch-blob` package that node-fetch depends on.

**Usage details:**

- Provides Blob, File, blobFrom, blobFromSync, fileFrom, and fileFromSync exports
- Used in the patched node-fetch implementation to handle file and blob uploads
- Part of node-fetch's peer dependency chain

**Verification:**

```bash
grep -n "fetch-blob/from.js" core/fetch/node-fetch-patch.js
# Line 31: } from "fetch-blob/from.js";
```

### formdata-polyfill/esm.min.js

**Status:** REQUIRED (transitive dependency) - No action needed

**Location:** Imported in `core/fetch/node-fetch-patch.js:32`

**Why it's not in package.json:**
This is a transitive dependency of `node-fetch` (listed in package.json line 47). The import uses a sub-path (`formdata-polyfill/esm.min.js`) to access the ESM build.

**Usage details:**

- Provides FormData polyfill for Node.js environments
- Used in the patched node-fetch implementation for multipart form data handling
- Part of node-fetch's peer dependency chain

**Verification:**

```bash
grep -n "formdata-polyfill/esm.min.js" core/fetch/node-fetch-patch.js
# Line 32: import { FormData } from "formdata-polyfill/esm.min.js";
```

### @aws-sdk/token-providers

**Status:** REMOVED - Import was unused

**Location:** Previously imported in `core/llm/openai-adapters/apis/Bedrock.ts:33`

**Action taken:**
Removed the unused import of `fromStatic` from `@aws-sdk/token-providers`. The import was never actually used in the code.

**Why it's not needed:**

- The `fromStatic` function was imported but never called anywhere in Bedrock.ts
- This package is a transitive dependency of `@aws-sdk/credential-providers` (listed in package.json line 22)
- If needed in the future, it would be available through the dependency chain

**Verification:**

```bash
grep -n "fromStatic" core/llm/openai-adapters/apis/Bedrock.ts
# (No results after removal - previously only on import line)
```

## Unresolved Imports (Fixed)

### node-fetch-patch.js JSDoc Type References

**Status:** FIXED

**Location:** `core/fetch/node-fetch-patch.js:67,69`

**Issue:**
JSDoc type annotations referenced non-existent local files:

- `import('./request').default`
- `import('./response').default`

These files (`./request` and `./response`) don't exist in the core/fetch directory. The imports were likely copied from the original node-fetch source code structure.

**Resolution:**
Updated the JSDoc comments to use the `Request` and `Response` types that are already imported and exported at the top of the file (lines 37-38, 58-59):

- Changed `import('./request').default` to `Request`
- Changed `import('./response').default` to `Response`

**Verification:**

```bash
npm run typecheck  # Passes
npm test           # All 778 tests pass
```

### CodebaseIndexer Import

**Status:** FIXED

**Location:** `core/index.d.ts:32,1102`

**Issue:**
The file attempted to import `CodebaseIndexer` from `./indexing/CodebaseIndexer`, but this file doesn't exist in the codebase. The only files in `core/indexing/` are:

- codeChunker.ts
- continueignore.ts
- ignore.ts
- ignore.vitest.ts
- README.md
- refreshIndex.ts
- types.ts

**Resolution:**

1. Removed the import statement on line 32
2. Changed the type annotation on line 1102 from `codeBaseIndexer?: CodebaseIndexer` to `codeBaseIndexer?: any` with a TODO comment indicating proper typing should be added when CodebaseIndexer is implemented

**Why this is safe:**

- The `ToolExtras` interface (which contains the `codeBaseIndexer` field) is used for tool execution context
- Since CodebaseIndexer doesn't exist yet, using `any` is appropriate
- The TODO comment ensures this gets properly typed when the functionality is added
- This allows the type definitions to compile without requiring a non-existent dependency

**Verification:**

```bash
npm run typecheck  # Passes
npm test           # All 778 tests pass
```
