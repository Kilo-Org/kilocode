// Process-wide test state that leaks into the other files of one `bun test` process. The test runner runs a file with
// this state in its own process, and `script/check-architecture.ts` ratchets it in Kilo tests. A write inside a hook or
// a test is not listed: the file can restore it.
export const PROCESS_STATE = [
  /\bmock\.module\s*\(/,
  /\bspyOn\s*\(\s*globalThis\b/,
  /^process\.env[.[]/m,
  /^delete\s+process\.env\b/m,
  /^(?:globalThis|global)\.[\w$]+\s*=(?!=)/m,
]
