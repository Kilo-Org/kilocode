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
 */

import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const ALLOWLIST_PATH = path.join(ROOT, "script", "architecture-allowlist.json")

type Entry = { count: number; owner: string; reason: string }
type Allowlist = {
  rules?: Record<string, { allowed?: Record<string, Entry> }>
}

const allowlist: Allowlist = await Bun.file(ALLOWLIST_PATH).json()
const allowed = (rule: string) => allowlist.rules?.[rule]?.allowed ?? {}

type Violation = { file: string; rule: string; message: string }
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

function importSpecifiers(text: string) {
  const specifiers: string[] = []
  for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) specifiers.push(match[1])
  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1])
  for (const match of text.matchAll(/\bimport\s+["']([^"']+)["']/g)) specifiers.push(match[1])
  return specifiers
}

function isPackage(specifier: string, pkg: string) {
  return specifier === pkg || specifier.startsWith(`${pkg}/`)
}

function isInternalAlias(specifier: string) {
  return specifier === "@/" || specifier.startsWith("@/")
}

// ---------------------------------------------------------------------------
// Shared scopes
// ---------------------------------------------------------------------------

const KILO_FILES = uniqueFiles(["packages/kilo-*/src/**/*.{ts,tsx}", "packages/*/src/kilocode/**/*.{ts,tsx}"])

function ratchet(
  rule: string,
  hits: Map<string, number>,
  messages: {
    unclassified: (count: number) => string
    drift: (file: string, expected: number, count: number) => string
    stale: (file: string) => string
  },
) {
  const allowedSites = allowed(rule)

  for (const [file, count] of hits) {
    const expected = allowedSites[file]
    if (!expected) {
      violations.push({ file, rule, message: messages.unclassified(count) })
    } else if (expected.count !== count) {
      violations.push({ file, rule, message: messages.drift(file, expected.count, count) })
    }
  }

  for (const file of Object.keys(allowedSites)) {
    if (!hits.has(file)) {
      violations.push({ file, rule, message: messages.stale(file) })
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 1: Core Directionality Guard
// ---------------------------------------------------------------------------

const HIGHER_LAYERS = [
  "@opencode/core",
  "@opencode/protocol",
  "@opencode/server",
  "@opencode/client",
  "@opencode/cli",
  "@opencode/tui",
  "@opencode/sdk",
]

function forbiddenDirection(specifier: string, forbidden: string[]) {
  if (isInternalAlias(specifier)) return "internal alias (@/)"
  if (forbidden.some((pkg) => isPackage(specifier, pkg))) return "higher layer package"
  if (specifier.startsWith("@kilocode/")) return "Kilo package"
  return null
}

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
      message: `Ratchet drift: expected ${expected.count} site(s), found ${hit.count}. Update script/architecture-allowlist.json!`,
    })
  }
}

for (const file of Object.keys(allowedCore)) {
  if (!coreHits.has(file)) {
    violations.push({
      file,
      rule: "core-directionality",
      message: `Stale allowlist entry: no forbidden dependency found in ${file}. Remove from script/architecture-allowlist.json!`,
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
      message: `Ratchet drift: expected ${expected.count} site(s), found ${hit.count}. Update script/architecture-allowlist.json!`,
    })
  }
}

for (const file of Object.keys(allowedGateway)) {
  if (!gatewayHits.has(file)) {
    violations.push({
      file,
      rule: "kilo-gateway-core-isolation",
      message: `Stale allowlist entry: no @opencode dependency found in ${file}. Remove from script/architecture-allowlist.json!`,
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

ratchet("kilo-instance-state", instanceHits, {
  unclassified: (count) =>
    `Unclassified InstanceState.make found in Kilo-owned code (${count} site(s)). Encapsulate state in a scoped Effect Service in packages/core or add to script/architecture-allowlist.json.`,
  drift: (file, expected, count) =>
    `Ratchet drift for InstanceState.make in ${file}: expected ${expected}, found ${count}. Update script/architecture-allowlist.json!`,
  stale: (file) =>
    `Stale allowlist entry: no InstanceState.make found in ${file}. Remove from script/architecture-allowlist.json to lock in progress!`,
})

// ---------------------------------------------------------------------------
// Rule 4: Kilo Database Direct Instantiation Guard (Kilo-owned code)
// ---------------------------------------------------------------------------

const databaseHits = new Map<string, number>()
for (const file of KILO_FILES) {
  const text = await read(file)
  const count = [...text.matchAll(/\bnew\s+(?:Database|DatabaseSync)\s*\(/g)].length
  if (count > 0) databaseHits.set(file, count)
}

ratchet("kilo-database-constructors", databaseHits, {
  unclassified: (count) =>
    `Unclassified SQLite constructor (new Database / new DatabaseSync) in Kilo code (${count} site(s)). Route persistence through Database.Service in @opencode/core.`,
  drift: (file, expected, count) =>
    `Ratchet drift for database constructor in ${file}: expected ${expected}, found ${count}. Update script/architecture-allowlist.json!`,
  stale: (file) =>
    `Stale database constructor allowlist entry: no direct instantiation found in ${file}. Remove from script/architecture-allowlist.json!`,
})

// ---------------------------------------------------------------------------
// Rule 5: Kilo Tool process.env Reads Guard
// ---------------------------------------------------------------------------

const toolHits = new Map<string, number>()
for (const file of KILO_FILES.filter((entry) => entry.includes("/tool/"))) {
  const text = await read(file)
  const count = [...text.matchAll(/\bprocess\.env\b/g)].length
  if (count > 0) toolHits.set(file, count)
}

ratchet("kilo-tool-process-env", toolHits, {
  unclassified: (count) =>
    `Direct process.env read found in Kilo tool (${count} site(s)). Pass configuration via Tool.Context or Env.Service.`,
  drift: (file, expected, count) =>
    `Ratchet drift for process.env in ${file}: expected ${expected}, found ${count}. Update script/architecture-allowlist.json!`,
  stale: (file) =>
    `Stale tool-process-env entry: no process.env read found in ${file}. Remove from script/architecture-allowlist.json!`,
})

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

ratchet("kilo-httpapi-handlers", handlerHits, {
  unclassified: (count) =>
    `Direct OS/process operations forbidden in Kilo HttpApi route handlers (${count} site(s)). Delegate to domain Effect services.`,
  drift: (file, expected, count) =>
    `Ratchet drift for OS/process operations in ${file}: expected ${expected}, found ${count}. Update script/architecture-allowlist.json!`,
  stale: (file) =>
    `Stale handler allowlist entry: no raw OS/process operation found in ${file}. Remove from script/architecture-allowlist.json!`,
})

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
  console.error("To refactor an existing site, update script/architecture-allowlist.json.")
  process.exit(1)
}

const rules = [
  "core-directionality",
  "kilo-gateway-core-isolation",
  "kilo-instance-state",
  "kilo-database-constructors",
  "kilo-tool-process-env",
  "kilo-httpapi-handlers",
]
const totalTracked = rules.reduce((total, rule) => total + Object.keys(allowed(rule)).length, 0)

console.log(`check-architecture: ok (${totalTracked} classified Kilo ratchet sites, 0 boundary violations).`)
