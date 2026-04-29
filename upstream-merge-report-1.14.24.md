# Upstream Merge Conflict Report

Generated: 2026-04-29T19:02:14.155Z

## Summary

- **Upstream Version**: 1.14.24
- **Upstream Commit**: `da6683fe`
- **Base Branch**: main
- **Merge Branch**: markijbema/kilo-opencode-v1.14.24
- **Total Files Changed**: 32

## Files by Recommendation

### Skip (Auto-Remove)

- `packages/console/app/package.json` (package)
  - File should be skipped (does not exist in Kilo fork)
- `packages/console/core/package.json` (package)
  - File should be skipped (does not exist in Kilo fork)
- `packages/console/function/package.json` (package)
  - File should be skipped (does not exist in Kilo fork)
- `packages/console/mail/package.json` (package)
  - File should be skipped (does not exist in Kilo fork)
- `packages/enterprise/package.json` (package)
  - File should be skipped (does not exist in Kilo fork)
- `packages/function/package.json` (package)
  - File should be skipped (does not exist in Kilo fork)
- `packages/slack/package.json` (package)
  - File should be skipped (does not exist in Kilo fork)
- `packages/web/package.json` (package)
  - File should be skipped (does not exist in Kilo fork)

### Package.json Transform (Auto)

- `packages/app/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version
- `packages/desktop-electron/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version
- `packages/desktop/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version
- `packages/opencode/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version
- `packages/plugin/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version
- `packages/sdk/js/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version
- `packages/shared/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version
- `packages/ui/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version
- `sdks/vscode/package.json` (package)
  - Package.json: take upstream, transform names, inject Kilo deps, preserve version

### Extension Transform (Auto)

- `packages/extensions/zed/extension.toml` (extension)
  - Extension file: take upstream and apply Kilo branding

### Keep Kilo Version (Ours)

- `packages/opencode/specs/effect/http-api.md` (markdown)
  - Markdown files are typically Kilo-specific documentation

### Manual Review Required

- `bun.lock` (other)
  - File needs manual review
- `packages/opencode/src/file/index.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/mcp/index.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/provider/provider.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/provider/transform.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/server/routes/instance/file.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/server/routes/instance/httpapi/file.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/server/routes/instance/httpapi/mcp.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/server/routes/instance/httpapi/server.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/server/routes/instance/index.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/src/server/routes/instance/mcp.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/test/server/httpapi-file.test.ts` (code)
  - Code files need manual review for kilocode_change markers
- `packages/opencode/test/server/httpapi-mcp.test.ts` (code)
  - Code files need manual review for kilocode_change markers

## Recommendations

- 8 files will be skipped (auto-removed)
- 1 files will keep Kilo's version
- 13 files require manual review
