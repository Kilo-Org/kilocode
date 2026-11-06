#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Enforces domain architecture boundaries and state ratchets for Kilo packages and Kilo-owned code.
 *
 * Upstream-owned shared opencode files are exempt to prevent upstream merge conflicts.
 *
 * Rules checked:
 * 1. core-directionality: Schema, Core, Protocol, and Client must not import
 *    higher application layers or Kilo packages in the forbidden directions.
 * 2. kilo-gateway-core-isolation: packages/kilo-gateway-core must not import @opencode/*.
 * 3. kilo-instance-state: No unclassified InstanceState.make singletons in Kilo-owned code.
 * 4. kilo-database-constructors: Direct SQLite instantiation in Kilo-owned code is restricted.
 * 5. kilo-tool-process-env: Direct process.env reads in Kilo tools must be classified.
 * 6. kilo-httpapi-handlers: Kilo-owned handlers must not call raw OS or process operations.
 * 7. kilo-test-process-state: Kilo tests must not change process-wide state that leaks into other test files.
 * 8. kilo-test-blocking-spawn: Kilo tests must not start child processes synchronously.
 * 9. kilo-module-state: Module-level mutable state in Kilo-owned source is counted per package.
 *
 * Rules 7 to 9 keep each test file and each domain independent. `bun test` runs all files of a package in one
 * process, so a module mock, a global or an env write in one file changes the next file, and module-level state
 * needs reset hooks that couple the tests to each other. Order-dependent tests pass alone and fail in CI.
 */

import path from "node:path"
import {
  code,
  countMatches,
  forbiddenDirection,
  HIGHER_LAYERS,
  importSpecifiers,
  ratchet,
  type Entry,
  type Violation,
} from "./kilocode/architecture-rules"

const ROOT = path.resolve(import.meta.dir, "..")
const ALLOWLIST_PATH = path.join(ROOT, "script", "kilocode", "architecture-allowlist.json")

type Allowlist = {
  rules?: Record<string, { allowed?: Record<string, Entry> }>
}

const allowlist: Allowlist = await Bun.file(ALLOWLIST_PATH).json()
const allowed = (rule: string) => allowlist.rules?.[rule]?.allowed ?? {}

const violations: Violation[] = []

function scan(pattern: string) {
  const glob = new Bun.Glob(pattern)
  return [...glob.scanSync({ cwd: ROOT, onlyFiles: true })].map((file) => file.replaceAll("\\", "/"))
}

function uniqueFiles(patterns: string[]) {
  return [...new Set(patterns.flatMap((pattern) => scan(pattern)))]
}

function read(file: string) {
  return Bun.file(path.join(ROOT, file)).text()
}

// ---------------------------------------------------------------------------
// Shared scopes
// ---------------------------------------------------------------------------

const KILO_FILES = uniqueFiles(["packages/kilo-*/src/**/*.{ts,tsx}", "packages/*/src/kilocode/**/*.{ts,tsx}"])
// A bunfig preload is the one place for deliberate process-wide test setup, so the test rules skip it.
const PRELOADS = new Set(
  (
    await Promise.all(
      scan("packages/*/bunfig.toml").map(async (file) =>
        [...(await read(file)).matchAll(/\bpreload\s*=\s*\[([^\]]*)\]/g)].flatMap((match) =>
          [...match[1]!.matchAll(/["']\.\/([^"']+)["']/g)].map((entry) =>
            path.posix.join(path.posix.dirname(file), entry[1]!),
          ),
        ),
      ),
    )
  ).flat(),
)
const KILO_TESTS = uniqueFiles(["packages/kilo-*/test/**/*.{ts,tsx}", "packages/*/test/kilocode/**/*.{ts,tsx}"]).filter(
  (file) => !PRELOADS.has(file),
)

// ---------------------------------------------------------------------------
// Rule 1: Core Directionality Guard
// ---------------------------------------------------------------------------

const CORE_DIRECTIONS = [
  {
    scope: "packages/schema/src",
    forbidden: (specifier: string) => forbiddenDirection(specifier, HIGHER_LAYERS),
  },
  {
    scope: "packages/core/src",
    forbidden: (specifier: string) =>
      forbiddenDirection(
        specifier,
        HIGHER_LAYERS.filter((pkg) => pkg !== "@opencode/core"),
      ),
  },
  {
    scope: "packages/protocol/src",
    forbidden: (specifier: string) =>
      forbiddenDirection(
        specifier,
        HIGHER_LAYERS.filter((pkg) => pkg !== "@opencode/protocol"),
      ),
  },
  {
    scope: "packages/client/src",
    forbidden: (specifier: string) =>
      forbiddenDirection(specifier, [
        "@opencode/core",
        "@opencode/server",
        "@opencode/cli",
        "@opencode/tui",
        "@opencode/sdk",
      ]),
  },
]

const coreHits = new Map<string, { count: number; details: string[] }>()
for (const direction of CORE_DIRECTIONS) {
  for (const file of scan(`${direction.scope}/**/*.{ts,tsx}`)) {
    const text = await read(file)
    const details = importSpecifiers(text).flatMap((specifier) => {
      const reason = direction.forbidden(specifier)
      return reason ? [`${specifier} (${reason})`] : []
    })
    if (details.length > 0) coreHits.set(file, { count: details.length, details })
  }
}

const allowedCore = allowed("core-directionality")
for (const [file, hit] of coreHits) {
  const expected = allowedCore[file]
  if (!expected) {
    for (const detail of hit.details) {
      violations.push({
        file,
        rule: "core-directionality",
        message: `Forbidden dependency ${detail}. Domain packages must not depend on application layers or Kilo packages.`,
      })
    }
  } else if (expected.count !== hit.count) {
    violations.push({
      file,
      rule: "core-directionality",
      message: `Ratchet drift: expected ${expected.count} site(s), found ${hit.count}. Update script/kilocode/architecture-allowlist.json!`,
    })
  }
}

for (const file of Object.keys(allowedCore)) {
  if (!coreHits.has(file)) {
    violations.push({
      file,
      rule: "core-directionality",
      message: `Stale allowlist entry: no forbidden dependency found in ${file}. Remove from script/kilocode/architecture-allowlist.json!`,
    })
  }
}

// ---------------------------------------------------------------------------
// Rule 2: Kilo Gateway Core Isolation
// ---------------------------------------------------------------------------

const gatewayHits = new Map<string, { count: number; details: string[] }>()
for (const file of scan("packages/kilo-gateway-core/src/**/*.{ts,tsx}")) {
  const text = await read(file)
  const details = importSpecifiers(text).filter((specifier) => specifier.startsWith("@opencode/"))
  if (details.length > 0) gatewayHits.set(file, { count: details.length, details })
}

const allowedGateway = allowed("kilo-gateway-core-isolation")
for (const [file, hit] of gatewayHits) {
  const expected = allowedGateway[file]
  if (!expected) {
    for (const detail of hit.details) {
      violations.push({
        file,
        rule: "kilo-gateway-core-isolation",
        message: `Forbidden @opencode dependency ${detail}. Kilo logic packages must not import from @opencode/*.`,
      })
    }
  } else if (expected.count !== hit.count) {
    violations.push({
      file,
      rule: "kilo-gateway-core-isolation",
      message: `Ratchet drift: expected ${expected.count} site(s), found ${hit.count}. Update script/kilocode/architecture-allowlist.json!`,
    })
  }
}

for (const file of Object.keys(allowedGateway)) {
  if (!gatewayHits.has(file)) {
    violations.push({
      file,
      rule: "kilo-gateway-core-isolation",
      message: `Stale allowlist entry: no @opencode dependency found in ${file}. Remove from script/kilocode/architecture-allowlist.json!`,
    })
  }
}

// ---------------------------------------------------------------------------
// Rule 3: Kilo InstanceState.make Ratchet (Kilo-owned code)
// ---------------------------------------------------------------------------

const instanceHits = new Map<string, number>()
for (const file of KILO_FILES) {
  const text = await read(file)
  const count = [...text.matchAll(/\bInstanceState\.make\b/g)].length
  if (count > 0) instanceHits.set(file, count)
}

violations.push(
  ...ratchet("kilo-instance-state", instanceHits, allowed("kilo-instance-state"), {
    unclassified: (count) =>
      `Unclassified InstanceState.make found in Kilo-owned code (${count} site(s)). Encapsulate state in a scoped Effect Service in packages/core or add to script/kilocode/architecture-allowlist.json.`,
    drift: (file, expected, count) =>
      `Ratchet drift for InstanceState.make in ${file}: expected ${expected}, found ${count}. Update script/kilocode/architecture-allowlist.json!`,
    stale: (file) =>
      `Stale allowlist entry: no InstanceState.make found in ${file}. Remove from script/kilocode/architecture-allowlist.json to lock in progress!`,
  }),
)

// ---------------------------------------------------------------------------
// Rule 4: Kilo Database Direct Instantiation Guard (Kilo-owned code)
// ---------------------------------------------------------------------------

const databaseHits = new Map<string, number>()
for (const file of KILO_FILES) {
  const text = await read(file)
  const count = [...text.matchAll(/\bnew\s+(?:Database|DatabaseSync)\s*\(/g)].length
  if (count > 0) databaseHits.set(file, count)
}

violations.push(
  ...ratchet("kilo-database-constructors", databaseHits, allowed("kilo-database-constructors"), {
    unclassified: (count) =>
      `Unclassified SQLite constructor (new Database / new DatabaseSync) in Kilo code (${count} site(s)). Route persistence through Database.Service in @opencode/core.`,
    drift: (file, expected, count) =>
      `Ratchet drift for database constructor in ${file}: expected ${expected}, found ${count}. Update script/kilocode/architecture-allowlist.json!`,
    stale: (file) =>
      `Stale database constructor allowlist entry: no direct instantiation found in ${file}. Remove from script/kilocode/architecture-allowlist.json!`,
  }),
)

// ---------------------------------------------------------------------------
// Rule 5: Kilo Tool process.env Reads Guard
// ---------------------------------------------------------------------------

const toolHits = new Map<string, number>()
for (const file of KILO_FILES.filter((entry) => entry.includes("/tool/"))) {
  const text = await read(file)
  const count = [...text.matchAll(/\bprocess\.env\b/g)].length
  if (count > 0) toolHits.set(file, count)
}

violations.push(
  ...ratchet("kilo-tool-process-env", toolHits, allowed("kilo-tool-process-env"), {
    unclassified: (count) =>
      `Direct process.env read found in Kilo tool (${count} site(s)). Pass configuration via Tool.Context or Env.Service.`,
    drift: (file, expected, count) =>
      `Ratchet drift for process.env in ${file}: expected ${expected}, found ${count}. Update script/kilocode/architecture-allowlist.json!`,
    stale: (file) =>
      `Stale tool-process-env entry: no process.env read found in ${file}. Remove from script/kilocode/architecture-allowlist.json!`,
  }),
)

// ---------------------------------------------------------------------------
// Rule 6: Kilo HttpApi Handler Boundaries (No raw OS operations in Kilo handlers)
// ---------------------------------------------------------------------------

const handlerFiles = KILO_FILES.filter((file) => /\/handlers?\//.test(file) || file.includes("/httpapi/"))
const handlerHits = new Map<string, number>()
for (const file of handlerFiles) {
  const text = await read(file)
  const count = [
    ...text.matchAll(/\bchild_process\b|\bBun\.spawn(?:Sync)?\b|from\s+["'](?:node:)?fs(?:\/promises)?["']/g),
  ].length
  if (count > 0) handlerHits.set(file, count)
}

violations.push(
  ...ratchet("kilo-httpapi-handlers", handlerHits, allowed("kilo-httpapi-handlers"), {
    unclassified: (count) =>
      `Direct OS/process operations forbidden in Kilo HttpApi route handlers (${count} site(s)). Delegate to domain Effect services.`,
    drift: (file, expected, count) =>
      `Ratchet drift for OS/process operations in ${file}: expected ${expected}, found ${count}. Update script/kilocode/architecture-allowlist.json!`,
    stale: (file) =>
      `Stale handler allowlist entry: no raw OS/process operation found in ${file}. Remove from script/kilocode/architecture-allowlist.json!`,
  }),
)

// ---------------------------------------------------------------------------
// Rule 7: Kilo Test Process-Wide State
// ---------------------------------------------------------------------------

// The same process-wide state that script/kilocode/test/test-runner.ts runs in its own process, plus module-scope
// global writes. A write inside a hook or a test is not counted: the file can restore it.
const PROCESS_STATE = [
  /\bmock\.module\s*\(/g,
  /\bspyOn\s*\(\s*globalThis\b/g,
  /^process\.env\b/gm,
  /^delete\s+process\.env\b/gm,
  /^(?:globalThis|global)\.[\w$]+\s*=(?!=)/gm,
]

const processStateHits = new Map<string, number>()
for (const file of KILO_TESTS) {
  const count = countMatches(code(await read(file)), PROCESS_STATE)
  if (count > 0) processStateHits.set(file, count)
}

violations.push(
  ...ratchet("kilo-test-process-state", processStateHits, allowed("kilo-test-process-state"), {
    unclassified: (count) =>
      `Process-wide test state (${count} site(s)): mock.module, spyOn(globalThis), or a module-scope global or process.env write. It leaks into the other files of the same bun test process. Inject the dependency, or set and restore the value in beforeEach/afterEach.`,
    drift: (file, expected, count) =>
      `Ratchet drift for process-wide test state in ${file}: expected ${expected}, found ${count}. Update script/kilocode/architecture-allowlist.json!`,
    stale: (file) =>
      `Stale test-process-state entry: no process-wide test state found in ${file}. Remove from script/kilocode/architecture-allowlist.json!`,
  }),
)

// ---------------------------------------------------------------------------
// Rule 8: Kilo Test Blocking Spawn
// ---------------------------------------------------------------------------

const blockingHits = new Map<string, number>()
for (const file of KILO_TESTS) {
  const count = countMatches(code(await read(file)), [/\b(?:spawnSync|execSync|execFileSync)\s*\(/g])
  if (count > 0) blockingHits.set(file, count)
}

violations.push(
  ...ratchet("kilo-test-blocking-spawn", blockingHits, allowed("kilo-test-blocking-spawn"), {
    unclassified: (count) =>
      `Synchronous child process in a Kilo test (${count} site(s)). It blocks the test process, so Bun cannot stop it at the test timeout, and the timeout then kills shared helpers such as the esbuild service for the next files. Use Bun.spawn with a kill timer below the test timeout.`,
    drift: (file, expected, count) =>
      `Ratchet drift for synchronous child processes in ${file}: expected ${expected}, found ${count}. Update script/kilocode/architecture-allowlist.json!`,
    stale: (file) =>
      `Stale test-blocking-spawn entry: no synchronous child process found in ${file}. Remove from script/kilocode/architecture-allowlist.json!`,
  }),
)

// ---------------------------------------------------------------------------
// Rule 9: Kilo Module-Level State (per package)
// ---------------------------------------------------------------------------

// Counted per package, not per file: the target is fewer process-global singletons in each domain.
const moduleStateHits = new Map<string, number>()
for (const file of KILO_FILES) {
  const count = countMatches(code(await read(file)), [
    /^(?:export\s+)?let\s/gm,
    /^(?:export\s+)?const\s+[\w$]+(?:\s*:[^=\n]+)?\s*=\s*new\s+(?:Map|Set)\b/gm,
  ])
  const pkg = file.split("/").slice(0, 2).join("/")
  if (count > 0) moduleStateHits.set(pkg, (moduleStateHits.get(pkg) ?? 0) + count)
}

violations.push(
  ...ratchet("kilo-module-state", moduleStateHits, allowed("kilo-module-state"), {
    unclassified: (count) =>
      `Module-level mutable state (${count} site(s)): a top-level let, Map or Set. It is shared by every caller in the process and needs reset hooks in tests. Keep the state in an instance that a service, layer or runtime owns.`,
    drift: (pkg, expected, count) =>
      `Ratchet drift for module-level state in ${pkg}: expected ${expected}, found ${count}. Keep new state in an owned instance, or update script/kilocode/architecture-allowlist.json with the reason!`,
    stale: (pkg) =>
      `Stale module-state entry: no module-level state found in ${pkg}. Remove from script/kilocode/architecture-allowlist.json!`,
  }),
)

// ---------------------------------------------------------------------------
// Output & Exit
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  console.error(`\n❌ Found ${violations.length} architecture boundary violation(s):\n`)
  for (const violation of violations) {
    console.error(`  [${violation.rule}] ${violation.file}`)
    console.error(`    ↳ ${violation.message}\n`)
  }
  console.error("Architecture rules protect domain decoupling and enable fast in-process testing.")
  console.error("To refactor an existing site, update script/kilocode/architecture-allowlist.json.")
  process.exit(1)
}

const rules = [
  "core-directionality",
  "kilo-gateway-core-isolation",
  "kilo-instance-state",
  "kilo-database-constructors",
  "kilo-tool-process-env",
  "kilo-httpapi-handlers",
  "kilo-test-process-state",
  "kilo-test-blocking-spawn",
  "kilo-module-state",
]
const totalTracked = rules.reduce((total, rule) => total + Object.keys(allowed(rule)).length, 0)

console.log(`check-architecture: ok (${totalTracked} classified Kilo ratchet sites, 0 boundary violations).`)
