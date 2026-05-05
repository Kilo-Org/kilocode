export const skipped = new Set([
  // Upstream browser OAuth integration tests bind the fixed callback port and
  // race with other parallel OAuth tests in CI.
  "mcp/oauth-browser.test.ts",
])
