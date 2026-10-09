# VSCode Extension VSIX Packaging — Kilo v2 Preview

Status: **Locally verified; VSIX packaging of prebuilt `dist/extension.cjs` + `dist/web` + icon + README + LICENSE implemented and passing tests using cached `@vscode/vsce 3.9.2`. No network downloads, no live stores touched.**

---

## 1. Overview & Constraints

Under the user goal to package the Kilo v2 VSCode extension:
- **No external network / downloads:** Reuses existing cached `@vscode/vsce` binary discovered from local cache (`kilocode/packages/kilo-vscode/node_modules/.bin/vsce`).
- **No build modification:** Does not rebuild or modify existing `dist/extension.cjs` or `dist/web` bundles; packages existing verified build outputs.
- **Dependency isolation:** `workspace:*` dependencies in `package.json` are sanitized during packaging so they never leak into the installed runtime manifest. The extension bundle is self-contained.
- **Proven VSIX tooling:** Utilizes standard `@vscode/vsce package --no-dependencies` rather than custom/handwritten zip generators.
- **Ownership compliance:** Only `packages/kilo-vscode/script/package.ts`, `packages/kilo-vscode/test/package.test.ts`, `packages/kilo-vscode/.vscodeignore`, and this document are created/owned. `package.json`, `build.ts`, and `README.md` remain root-owned.

---

## 2. Packaging Architecture

### A. Discovery of Cached Tooling
`findVsceBinary()` searches candidate locations in precedence order:
1. `process.env.VSCE_BIN`
2. Local relative binary `packages/kilo-vscode/node_modules/.bin/vsce`
3. Sibling checkouts:
   - `../kilocode/packages/kilo-vscode/node_modules/.bin/vsce`
   - `../kilocode/node_modules/.bin/vsce`
4. PATH discovery via `Bun.which("vsce")`

### B. Manifest Sanitization (`sanitizePackageJson`)
Before invoking `vsce`:
- Deletes `"private": true` (required for vsce packaging).
- Deletes `"devDependencies"` and `"scripts"`.
- Deletes `"dependencies"`: completely removes `workspace:*` and `catalog:` references so the installed manifest is clean and self-contained.
- Preserves `main: "./dist/extension.cjs"`, `activationEvents`, `contributes` (commands, views, viewContainers, configurations), `engines`, `publisher`, `name`, `displayName`.
- Ensures valid repository metadata.

### C. Resource Boundaries & `.vscodeignore`
Packaged VSIX contents:
- `extension/package.json` (sanitized manifest)
- `extension/dist/extension.cjs` (main entrypoint)
- `extension/dist/web/**` (webview chat and settings frontend bundle, index.html, assets)
- `extension/assets/kilo.svg` (activity bar icon)
- `extension/README.md` & `extension/LICENSE.txt` (requires real `LICENSE`, never synthesizes fake header)
- `[Content_Types].xml` & `extension.vsixmanifest`

Ignored via `.vscodeignore`:
- `src/**`, `web/**` (source TS/TSX files)
- `test/**`, `script/**` (test fixtures and packaging scripts)
- `tsconfig*.json`, `vite.config.mjs`, `*.map`, `*.log`
- `node_modules/**`, `dist/extension-host.cjs`

### D. Verification (`validateVsix`)
Inspects generated VSIX via standard Info-ZIP utilities (`zipinfo` and `unzip`):
- Confirms all required entries are present.
- Confirms forbidden source/test/tooling prefixes are excluded.
- Reads `extension/package.json` and asserts zero `workspace:*` or `catalog:` dependencies leaked.

---

## 3. Programmatic & CLI Invocation Contracts

### Programmatic API (`packages/kilo-vscode/script/package.ts`)
```ts
export interface PackageOptions {
  readonly out?: string       // Target .vsix file path
  readonly cwd?: string       // kilo-vscode root directory
  readonly vsceBin?: string   // Explicit vsce executable path
}

export interface PackageResult {
  readonly vsixPath: string   // Absolute path to generated .vsix
  readonly sizeBytes: number  // Total VSIX file size in bytes
  readonly fileCount: number  // Total entries inside VSIX
  readonly version: string    // Package version from manifest
}

export function packageExtension(options?: PackageOptions): Promise<PackageResult>
export function validateVsix(vsixPath: string): Promise<VsixValidationResult>
export function findVsceBinary(customPath?: string): string
export function sanitizePackageJson(rawJson: Record<string, unknown>): Record<string, unknown>
```

### CLI Command (For Root Wiring / Direct Invocation)
```bash
# Package to default dist/kilo-code-v2-preview-0.0.1.vsix
bun packages/kilo-vscode/script/package.ts

# Package to an explicit output path
bun packages/kilo-vscode/script/package.ts -o /path/to/output.vsix
```

### Isolated Profile Installation Command (For Root Testing)
```bash
code --user-data-dir /tmp/vscode-test-profile \
     --extensions-dir /tmp/vscode-test-profile/extensions \
     --install-extension packages/kilo-vscode/dist/kilo-code-v2-preview-0.0.1.vsix
```

---

## 4. Verification Results

Run with bundled Bun 1.4.0 (`packages/kilo-cli/dist/interactive/bun test test/package.test.ts`):
```
bun test v1.4.0 (34cbb9a40)

 3 pass
 0 fail
 33 expect() calls
Ran 3 tests across 1 file. [2.58s]
```

Test coverage:
1. `findVsceBinary discovers cached @vscode/vsce binary`: Verified execution of `@vscode/vsce 3.9.2`.
2. `sanitizePackageJson strips workspace:* dependencies, devDependencies, and private flag`: Confirmed clean runtime manifest.
3. `packageExtension generates a complete, self-contained VSIX without workspace:* leaks`:
   - Built output size: ~9.36 MB (9,817,318 bytes).
   - Total files: 912 (including full `dist/web` assets).
   - Validated: `extension.cjs`, `web/index.html`, `kilo.svg`, `package.json`, `vsixmanifest`.
   - Validated: zero `src/**`, `web/**`, `test/**`, `tsconfig*.json` entries.
   - Validated: zero `workspace:*` dependencies in `extension/package.json`.
