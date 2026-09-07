// Pre-install package preflight. Package operations are read from the
// normalised command (nested payloads and wrappers included), assessed against deterministic registry
// fixtures, and folded into the existing engine's monotonic reducer: a look-alike, new, unadopted or
// unverifiable package never installs silently, and no package evidence can weaken a base decision.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { SecurityEngine } from "../../../src/kilocode/security/engine"
import { PathRisk } from "../../../src/kilocode/security/path"
import { ShellNormalizer } from "../../../src/kilocode/security/shell"
import { SecurityGate } from "../../../src/kilocode/security/gate"
import { PackageMetadata } from "../../../src/kilocode/security/package/metadata"
import { PackageOperation } from "../../../src/kilocode/security/package/operation"
import { PackageRiskEvaluator } from "../../../src/kilocode/security/package/evaluator"
import { PackageSimilarity } from "../../../src/kilocode/security/package/similarity"
import type { NormalizedAction, SecurityContext, SecurityDecision } from "../../../src/kilocode/security/types"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-security-pkg-"))
const home = await fs.realpath(root).then((dir) => path.join(dir, "home"))
const ws = path.join(home, "projects", "app")
const env = PathRisk.env({
  workspace: { directory: ws, worktree: ws },
  home,
  temp: ["/tmp", "/private/tmp", "/var/tmp"],
  system: [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/System",
    "/Library",
    "/dev",
    "/boot",
    "/proc",
    "/sys",
    "/home",
    "/Users",
    "/opt",
  ],
})
const ctx: SecurityContext = {
  sessionID: "ses_pkg",
  agent: "build",
  workspace: { directory: ws, worktree: ws },
  cwd: ws,
  home,
  sandbox: { enabled: false },
}

beforeAll(async () => {
  await fs.mkdir(ws, { recursive: true })
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

// Frozen clock so every relative age in the fixtures is deterministic.
const NOW = new Date("2026-09-03T12:00:00Z")
const now = () => NOW

const FIXTURES: PackageMetadata.FixtureEntry[] = [
  {
    name: "lodash",
    createdDaysAgo: 4000,
    versions: [
      { version: "4.17.20", daysAgo: 1500 },
      { version: "4.17.21", daysAgo: 1400 },
    ],
    latest: "4.17.21",
    weeklyDownloads: 50_000_000,
    maintainers: 3,
    repository: "git+https://github.com/lodash/lodash.git",
  },
  {
    name: "react",
    createdDaysAgo: 4500,
    versions: [
      { version: "18.3.1", daysAgo: 500 },
      { version: "19.1.0", daysAgo: 120 },
    ],
    latest: "19.1.0",
    weeklyDownloads: 30_000_000,
    maintainers: 5,
    repository: "https://github.com/facebook/react",
  },
  {
    name: "create-react-app",
    createdDaysAgo: 3000,
    versions: [{ version: "5.0.1", daysAgo: 900 }],
    weeklyDownloads: 200_000,
    maintainers: 4,
    repository: "https://github.com/facebook/create-react-app",
  },
  // Slopsquat: plausible name an LLM would invent, registered days ago, postinstall, no repo.
  {
    name: "axios-retry-helper",
    createdDaysAgo: 3,
    versions: [{ version: "1.0.0", daysAgo: 3, scripts: ["postinstall"] }],
    weeklyDownloads: 12,
    maintainers: 1,
  },
  // Typosquat of lodash: old enough not to be "new", tiny adoption, no scripts, no repo.
  {
    name: "lodahs",
    createdDaysAgo: 400,
    versions: [{ version: "1.0.0", daysAgo: 400 }],
    weeklyDownloads: 40,
    maintainers: 1,
  },
  // Brand-new but honest: no scripts, has a repository.
  {
    name: "@acme/new-lib",
    createdDaysAgo: 5,
    versions: [{ version: "0.1.0", daysAgo: 5 }],
    weeklyDownloads: 20,
    maintainers: 1,
    repository: "https://github.com/acme/new-lib",
  },
  // Young, well adopted, with a repository: should pass with informational evidence only.
  {
    name: "express-jwt-guard",
    createdDaysAgo: 60,
    versions: [{ version: "1.2.0", daysAgo: 20 }],
    weeklyDownloads: 3_000,
    maintainers: 2,
    repository: "https://github.com/example/express-jwt-guard",
  },
  // Unadopted package with scripts but no repository — suspicious pair.
  {
    name: "quiet-native-bindings",
    createdDaysAgo: 200,
    versions: [{ version: "2.0.0", daysAgo: 100, scripts: ["install"] }],
    weeklyDownloads: 30,
    maintainers: 1,
  },
  // Mature package whose newest release (with a new postinstall) landed two days ago.
  {
    name: "widely-used-cli",
    createdDaysAgo: 2000,
    versions: [
      { version: "3.4.0", daysAgo: 400 },
      { version: "3.5.0", daysAgo: 2, scripts: ["postinstall"] },
    ],
    latest: "3.5.0",
    weeklyDownloads: 800_000,
    maintainers: 2,
    repository: "https://github.com/example/widely-used-cli",
  },
  // New tool that would be executed through npx.
  {
    name: "fresh-tool",
    createdDaysAgo: 10,
    versions: [{ version: "0.0.3", daysAgo: 1 }],
    weeklyDownloads: 90,
    maintainers: 1,
  },
  {
    name: "flaky-registry-pkg",
    createdDaysAgo: 900,
    versions: [{ version: "1.0.0", daysAgo: 900 }],
    unavailable: true,
  },
]

const provider = PackageMetadata.fixture(FIXTURES, { now })

const files = new Map<string, string>()
const readFile = (file: string) => files.get(file)

async function normalize(command: string, cwd = ws): Promise<NormalizedAction> {
  const normalized = await Effect.runPromise(ShellNormalizer.normalize({ command, cwd, shell: "/bin/bash", env }))
  return { kind: "shell", permission: "bash", command: normalized }
}

interface Outcome {
  decision: SecurityDecision
  result: PackageRiskEvaluator.Result
  operations: PackageOperation.Operation[]
}

/** The gate's flow: deterministic rules, then package evidence folded in monotonically. */
async function decide(
  command: string,
  opts: { cwd?: string; provider?: PackageMetadata.Provider } = {},
): Promise<Outcome> {
  const action = await normalize(command, opts.cwd)
  const base = SecurityEngine.evaluate(action, ctx)
  if (action.kind !== "shell") throw new Error("shell action expected")
  const operations = PackageOperation.collect(action.command)
  if (base.action === "deny" || operations.length === 0) {
    return { decision: base, result: { assessments: [], evidence: [], lookups: 0 }, operations }
  }
  const result = await Effect.runPromise(
    PackageRiskEvaluator.evaluate({
      operations,
      provider: opts.provider ?? provider,
      now,
      readFile,
      cwd: opts.cwd ?? ws,
    }),
  )
  return { decision: SecurityEngine.extend(base, result.evidence), result, operations }
}

function rules(decision: SecurityDecision) {
  return decision.evidence.map((item) => item.rule)
}

function signals(outcome: Outcome, name: string) {
  return outcome.result.assessments.find((item) => item.name === name)?.signals.map((signal) => signal.id) ?? []
}

describe("PackageOperation", () => {
  test("parses registry specs: bare, versioned, scoped, tagged", () => {
    expect(PackageOperation.parseSpec("lodash")).toMatchObject({ name: "lodash", source: "registry" })
    expect(PackageOperation.parseSpec("lodash@4.17.21")).toMatchObject({ name: "lodash", version: "4.17.21" })
    expect(PackageOperation.parseSpec("@types/node@^20")).toMatchObject({
      name: "@types/node",
      scope: "@types",
      version: "^20",
      source: "registry",
    })
    expect(PackageOperation.parseSpec("react@next")).toMatchObject({ name: "react", version: "next" })
  })

  test("recognises alias, git, url, file and dynamic specs", () => {
    expect(PackageOperation.parseSpec("my-lodash@npm:lodash@^4")).toMatchObject({
      name: "my-lodash",
      source: "alias",
      target: "lodash",
      version: "^4",
    })
    expect(PackageOperation.parseSpec("github:user/repo")).toMatchObject({ source: "git" })
    expect(PackageOperation.parseSpec("user/repo#v1")).toMatchObject({ source: "git" })
    expect(PackageOperation.parseSpec("git+https://example.com/x.git")).toMatchObject({ source: "git" })
    expect(PackageOperation.parseSpec("https://example.com/x.tgz")).toMatchObject({ source: "url" })
    expect(PackageOperation.parseSpec("./local-lib")).toMatchObject({ source: "file" })
    expect(PackageOperation.parseSpec("file:../lib")).toMatchObject({ source: "file" })
    expect(PackageOperation.parseSpec("$PKG")).toMatchObject({ source: "unknown" })
  })

  test("explicit install vs manifest install vs exec", async () => {
    const explicit = (await decide("npm install lodash")).operations[0]!
    expect(explicit).toMatchObject({ manager: "npm", kind: "install-explicit", explicit: true, lifecycle: "enabled" })
    expect(explicit.packages.map((spec) => spec.name)).toEqual(["lodash"])

    for (const command of [
      "npm install",
      "npm i",
      "npm ci",
      "npm clean-install",
      "pnpm install",
      "pnpm i",
      "yarn install",
    ]) {
      const op = (await decide(command)).operations[0]
      expect(op, command).toMatchObject({ kind: "install-manifest", explicit: false })
    }
    expect((await decide("npm install --ignore-scripts")).operations[0]).toMatchObject({ lifecycle: "disabled" })
    expect((await decide("npx fresh-tool --flag")).operations[0]).toMatchObject({
      kind: "exec",
      manager: "npx",
      packages: [{ name: "fresh-tool" }],
    })
    expect((await decide("npx -y -p fresh-tool some-bin arg")).operations[0]!.packages[0]).toMatchObject({
      name: "fresh-tool",
    })
    expect((await decide("npm exec -- fresh-tool")).operations[0]).toMatchObject({
      kind: "exec",
      packages: [{ name: "fresh-tool" }],
    })
    expect((await decide("pnpm dlx fresh-tool")).operations[0]).toMatchObject({ kind: "exec", manager: "pnpm" })
    expect((await decide("pnpm add lodahs")).operations[0]).toMatchObject({ kind: "install-explicit", manager: "pnpm" })
  })

  test("reads registry overrides from flags and environment assignments", async () => {
    expect((await decide("npm install lodash --registry https://evil.example/npm")).operations[0]!.registry).toEqual({
      host: "evil.example",
      origin: "flag",
    })
    expect((await decide("npm install lodash --registry=https://evil.example")).operations[0]!.registry).toMatchObject({
      host: "evil.example",
    })
    expect(
      (await decide("npm_config_registry=https://evil.example npm install lodash")).operations[0]!.registry,
    ).toEqual({
      host: "evil.example",
      origin: "env",
    })
    expect(
      (await decide("env NPM_CONFIG_REGISTRY=https://evil.example npm install lodash")).operations[0]!.registry,
    ).toEqual({ host: "evil.example", origin: "env" })
  })

  test("sees through wrappers and nested shells", async () => {
    for (const command of [
      'bash -c "npm install axios-retry-helper"',
      "sh -c 'cd /tmp && npm install axios-retry-helper'",
      "env npm install axios-retry-helper",
      "timeout 60 npm install axios-retry-helper",
      "nohup npm install axios-retry-helper &",
      "true && npm install axios-retry-helper",
      "echo start; npm i axios-retry-helper; echo done",
    ]) {
      const ops = (await decide(command)).operations
      expect(
        ops.map((op) => op.packages[0]?.name),
        command,
      ).toEqual(["axios-retry-helper"])
    }
  })

  test("dynamic operands make the operation ambiguous, never silently allowed", async () => {
    const outcome = await decide("npm install $PKG")
    expect(outcome.operations[0]).toMatchObject({ confidence: "ambiguous" })
    expect(outcome.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_UNVERIFIED" })
  })
})

describe("PackageSimilarity", () => {
  test("names the well-known package and the reason", () => {
    expect(PackageSimilarity.similar("lodahs")).toEqual({ target: "lodash", kind: "edit-distance", distance: 1 })
    expect(PackageSimilarity.similar("lo-dash")).toEqual({ target: "lodash", kind: "separator" })
    expect(PackageSimilarity.similar("l0dash")).toEqual({ target: "lodash", kind: "homoglyph" })
    expect(PackageSimilarity.similar("axiosjs")).toEqual({ target: "axios", kind: "affix" })
    expect(PackageSimilarity.similar("node-express")).toEqual({ target: "express", kind: "affix" })
    expect(PackageSimilarity.similar("@evil/react")).toEqual({ target: "react", kind: "scope" })
    expect(PackageSimilarity.similar("types-node")).toEqual({ target: "@types/node", kind: "scope" })
    expect(PackageSimilarity.similar("expresss")).toEqual({ target: "express", kind: "edit-distance", distance: 1 })
  })

  test("well-known packages and unrelated names do not match", () => {
    expect(PackageSimilarity.similar("react")).toBeUndefined()
    expect(PackageSimilarity.similar("react-dom")).toBeUndefined()
    expect(PackageSimilarity.similar("@types/node")).toBeUndefined()
    expect(PackageSimilarity.similar("express-jwt-guard")).toBeUndefined()
    expect(PackageSimilarity.similar("quiet-native-bindings")).toBeUndefined()
    // Short names need an exact-ish match; "got" vs "get" must not fire on 3-letter names.
    expect(PackageSimilarity.similar("get")).toBeUndefined()
  })
})

describe("PackageMetadata.resolve", () => {
  const meta: PackageMetadata.Metadata = {
    name: "x",
    found: true,
    distTags: { latest: "2.1.0", next: "3.0.0-beta.1" },
    versions: {
      "1.0.0": { scripts: [] },
      "1.2.0": { scripts: [] },
      "1.2.5": { scripts: [] },
      "2.0.0": { scripts: [] },
      "2.1.0": { scripts: [] },
      "3.0.0-beta.1": { scripts: [] },
    },
    provider: "test",
  }
  test("exact, tags, caret, tilde, x-ranges, comparators", () => {
    expect(PackageMetadata.resolve(meta, undefined)).toEqual({ version: "2.1.0", resolved: true })
    expect(PackageMetadata.resolve(meta, "next")).toEqual({ version: "3.0.0-beta.1", resolved: true })
    expect(PackageMetadata.resolve(meta, "1.2.0")).toEqual({ version: "1.2.0", resolved: true })
    expect(PackageMetadata.resolve(meta, "^1.2.0")).toEqual({ version: "1.2.5", resolved: true })
    expect(PackageMetadata.resolve(meta, "~1.2.0")).toEqual({ version: "1.2.5", resolved: true })
    expect(PackageMetadata.resolve(meta, "1.x")).toEqual({ version: "1.2.5", resolved: true })
    expect(PackageMetadata.resolve(meta, "2")).toEqual({ version: "2.1.0", resolved: true })
    expect(PackageMetadata.resolve(meta, ">=1.2.0 <2.0.0")).toEqual({ version: "1.2.5", resolved: true })
    expect(PackageMetadata.resolve(meta, "*")).toEqual({ version: "2.1.0", resolved: true })
  })
  test("unknown range syntax falls back to latest and reports it", () => {
    expect(PackageMetadata.resolve(meta, "1.2.0 || 2.0.0")).toEqual({ version: "2.1.0", resolved: false })
  })
})

describe("PackageRiskEvaluator through the engine", () => {
  test("trusted mature package: the base soft ask stands, with an informational assessment", async () => {
    const outcome = await decide("npm install lodash")
    expect(outcome.decision).toMatchObject({ action: "ask", hard: false, reasonCode: "PACKAGE_INSTALL" })
    expect(rules(outcome.decision)).toContain("default.pkg.assessed")
    expect(outcome.result.assessments[0]).toMatchObject({ tier: "mature", verdict: { action: "allow" } })
  })

  test("explicit version resolves and is reported", async () => {
    const outcome = await decide("npm i lodash@4.17.20")
    expect(outcome.result.assessments[0]).toMatchObject({ resolvedVersion: "4.17.20", tier: "mature" })
    expect(outcome.decision.hard).toBe(false)
  })

  test("new package without scripts: hard ask on provenance", async () => {
    const outcome = await decide("npm install @acme/new-lib")
    expect(outcome.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_PROVENANCE" })
    expect(signals(outcome, "@acme/new-lib")).toContain("new-package")
    expect(signals(outcome, "@acme/new-lib")).not.toContain("lifecycle-scripts")
  })

  test("slopsquat with postinstall: deny before anything is installed", async () => {
    const outcome = await decide("npm install axios-retry-helper")
    expect(outcome.decision).toMatchObject({ action: "deny", hard: true, reasonCode: "PACKAGE_LIFECYCLE" })
    const found = signals(outcome, "axios-retry-helper")
    expect(found).toEqual(
      expect.arrayContaining(["new-package", "low-adoption", "lifecycle-scripts", "no-repository", "similar-name"]),
    )
    const message = outcome.decision.message
    expect(message).toContain("axios-retry-helper")
    expect(message).toContain("postinstall")
    expect(message).toContain("axios-retry")
    // Facts, not thresholds.
    expect(message).not.toMatch(/\b30\b|\b500\b/)
  })

  test("typosquat without scripts: hard ask naming the look-alike", async () => {
    const outcome = await decide("pnpm add lodahs")
    expect(outcome.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_PROVENANCE" })
    expect(signals(outcome, "lodahs")).toEqual(
      expect.arrayContaining(["low-adoption", "similar-name", "no-repository"]),
    )
    expect(outcome.decision.message).toContain("lodash")
  })

  test("young but adopted package with a repository passes with information only", async () => {
    const outcome = await decide("npm install express-jwt-guard")
    expect(outcome.decision).toMatchObject({ action: "ask", hard: false })
    expect(outcome.result.assessments[0]!.verdict.action).toBe("allow")
  })

  test("install scripts on an unadopted package without a repository: deny", async () => {
    const outcome = await decide("npm install quiet-native-bindings")
    expect(outcome.decision).toMatchObject({ action: "deny", reasonCode: "PACKAGE_LIFECYCLE" })
  })

  test("--ignore-scripts removes the execution reason but keeps the provenance ask", async () => {
    const outcome = await decide("npm install --ignore-scripts axios-retry-helper")
    expect(outcome.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_PROVENANCE" })
  })

  test("mature package whose fresh release adds an install script: hard ask", async () => {
    const outcome = await decide("npm install widely-used-cli")
    expect(outcome.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_LIFECYCLE" })
    expect(signals(outcome, "widely-used-cli")).toEqual(expect.arrayContaining(["fresh-release", "lifecycle-scripts"]))
    // Pinning the previous release makes it an ordinary soft ask again.
    const pinned = await decide("npm install widely-used-cli@3.4.0")
    expect(pinned.decision.hard).toBe(false)
  })

  test("missing repository alone on an unadopted package: hard ask", async () => {
    const outcome = await decide("npm install lodahs@1.0.0")
    expect(signals(outcome, "lodahs")).toContain("no-repository")
    expect(outcome.decision.hard).toBe(true)
  })

  test("metadata failure is a hard ask, never allow", async () => {
    const outcome = await decide("npm install flaky-registry-pkg")
    expect(outcome.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_UNVERIFIED" })
    const offline = await decide("npm install lodash", { provider: PackageMetadata.unavailable() })
    expect(offline.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_UNVERIFIED" })
  })

  test("package not in the registry (hallucinated name): hard ask", async () => {
    const outcome = await decide("npm install requests-helper-pro")
    expect(outcome.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_UNVERIFIED" })
    expect(signals(outcome, "requests-helper-pro")).toContain("not-found")
  })

  test("evaluator defect never resolves to allow", async () => {
    const broken: PackageMetadata.Provider = {
      id: "broken",
      lookup: () => Effect.die(new Error("boom")),
    }
    const outcome = await decide("npm install lodash", { provider: broken })
    expect(outcome.decision.action).toBe("ask")
    expect(outcome.decision.hard).toBe(true)
    expect(outcome.decision.reasonCode).toBe("PACKAGE_UNVERIFIED")
  })

  test("alternate registry on the command line or in .npmrc: hard ask on provenance", async () => {
    for (const command of [
      "npm install lodash --registry https://evil.example",
      "npm_config_registry=https://evil.example npm install lodash",
      "pnpm add lodash --registry=https://evil.example",
    ]) {
      const outcome = await decide(command)
      expect(outcome.decision, command).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_PROVENANCE" })
    }
    files.set(path.join(ws, ".npmrc"), "registry=https://evil.example/\n")
    try {
      const outcome = await decide("npm install lodash")
      expect(rules(outcome.decision)).toContain("hard.pkg.npmrc-registry")
      expect(outcome.decision.hard).toBe(true)
    } finally {
      files.delete(path.join(ws, ".npmrc"))
    }
    // The default registry spelled out explicitly is not an override.
    const fine = await decide("npm install lodash --registry https://registry.npmjs.org")
    expect(fine.decision.hard).toBe(false)
  })

  test("git / url sources are asked on provenance; local paths keep the base policy", async () => {
    expect((await decide("npm install github:user/repo")).decision).toMatchObject({
      action: "ask",
      hard: true,
      reasonCode: "PACKAGE_PROVENANCE",
    })
    expect((await decide("npm install https://example.com/pkg.tgz")).decision.hard).toBe(true)
    const local = await decide("npm install ./local-lib")
    expect(local.decision.hard).toBe(false)
    expect(local.result.lookups).toBe(0)
  })

  test("bare install: direct dependencies are assessed and a bad one denies", async () => {
    const manifest = path.join(ws, "package.json")
    files.set(manifest, JSON.stringify({ dependencies: { lodash: "^4", "axios-retry-helper": "^1.0.0" } }))
    try {
      const outcome = await decide("npm install")
      expect(outcome.operations[0]).toMatchObject({ kind: "install-manifest" })
      expect(outcome.decision).toMatchObject({ action: "deny", reasonCode: "PACKAGE_LIFECYCLE" })
      expect(outcome.result.assessments.map((item) => item.name).sort()).toEqual(["axios-retry-helper", "lodash"])
      // npm ci is the same exposure.
      expect((await decide("npm ci")).decision.action).toBe("deny")
    } finally {
      files.delete(manifest)
    }
  })

  test("bare install of a clean manifest: soft ask about lifecycle exposure, nothing hard", async () => {
    const manifest = path.join(ws, "package.json")
    files.set(manifest, JSON.stringify({ dependencies: { lodash: "^4", react: "^19" } }))
    try {
      const outcome = await decide("npm install")
      expect(outcome.decision).toMatchObject({ action: "ask", hard: false, reasonCode: "PACKAGE_LIFECYCLE" })
      expect(rules(outcome.decision)).toContain("default.pkg.manifest-lifecycle")
      const quiet = await decide("npm install --ignore-scripts")
      expect(rules(quiet.decision)).not.toContain("default.pkg.manifest-lifecycle")
      expect(quiet.decision.action).toBe("allow")
    } finally {
      files.delete(manifest)
    }
  })

  test("bare install with no manifest is the base allow", async () => {
    const outcome = await decide("npm install")
    expect(outcome.decision.action).toBe("allow")
    expect(outcome.result.lookups).toBe(0)
  })

  test("npx / npm exec / pnpm dlx of a new package: deny; of a mature one: soft ask", async () => {
    for (const command of [
      "npx fresh-tool",
      "npx -y fresh-tool@latest",
      "npm exec -- fresh-tool",
      "pnpm dlx fresh-tool",
      "bunx fresh-tool",
    ]) {
      const outcome = await decide(command)
      expect(outcome.decision, command).toMatchObject({ action: "deny", reasonCode: "PACKAGE_LIFECYCLE" })
    }
    const mature = await decide("npx create-react-app my-app")
    expect(mature.decision).toMatchObject({ action: "ask", hard: false })
    const unknown = await decide("npx totally-unknown-cli")
    expect(unknown.decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_UNVERIFIED" })
  })

  test("nested invocation is assessed like the direct one", async () => {
    expect((await decide('bash -c "npm install axios-retry-helper"')).decision.action).toBe("deny")
    expect((await decide("sh -c 'npx fresh-tool'")).decision.action).toBe("deny")
    expect((await decide("timeout 30 pnpm add lodahs")).decision.hard).toBe(true)
  })

  test("existing hard decisions cannot be weakened by package evidence", async () => {
    const privileged = await decide("sudo npm install lodash")
    expect(privileged.decision).toMatchObject({ action: "deny", reasonCode: "PRIVILEGE_ESCALATION" })
    expect(privileged.result.lookups).toBe(0)
    const compound = await decide("npm install lodash && rm -rf ~/.ssh")
    expect(compound.decision.action).toBe("deny")
    const opaque = await decide('npm install lodash; eval "$X"')
    expect(opaque.decision).toMatchObject({ action: "ask", hard: true })
    expect(rules(opaque.decision)).toContain("default.pkg.assessed")
  })

  test("global installs keep the system-modification ask and are still assessed", async () => {
    const outcome = await decide("npm install -g axios-retry-helper")
    expect(outcome.decision.action).toBe("deny")
    expect(outcome.operations[0]!.global).toBe(true)
  })

  test("evidence carries facts and signal ids, never thresholds or commands", async () => {
    const outcome = await decide("npm install axios-retry-helper")
    const lead = outcome.decision.evidence.find((item) => item.rule === "hard.pkg.unvetted-execution")!
    expect(lead.attributes).toMatchObject({
      package: "axios-retry-helper",
      manager: "npm",
      via: "explicit",
      tier: "new",
    })
    expect(String(lead.attributes?.signals)).toContain("lifecycle-scripts")
    expect(JSON.stringify(lead)).not.toContain("npm install")
  })
})

describe("SecurityGate with the package layer", () => {
  const options = (packages: boolean): SecurityGate.Options => ({
    enabled: true,
    sandboxed: false,
    workspace: { directory: ws, worktree: ws },
    layers: { packages, egress: false, tools: false, content: false, code: false, runtime: false, classifier: false },
  })

  function evaluate(command: string, packages: boolean) {
    return Effect.runPromise(
      SecurityGate.evaluate({
        request: { permission: "bash", patterns: [command], always: [], metadata: { command, cwd: ws } },
        options: options(packages),
        sessionID: "ses_gate_pkg",
        agent: "build",
      }),
    )
  }

  test("layer on: fixtures drive the decision; layer off: base behaviour byte for byte", async () => {
    const restore = PackageMetadata.use(provider)
    try {
      const on = await evaluate("npm install axios-retry-helper", true)
      expect(on).toMatchObject({ action: "deny", reasonCode: "PACKAGE_LIFECYCLE" })
      const off = await evaluate("npm install axios-retry-helper", false)
      expect(off).toMatchObject({ action: "ask", hard: false, reasonCode: "PACKAGE_INSTALL" })
      expect(rules(off).some((rule) => rule.includes("pkg.") && rule !== "default.pkg.install")).toBe(false)
    } finally {
      restore()
    }
  })

  test("layer on with an unreachable registry: hard ask, never allow", async () => {
    const restore = PackageMetadata.use(PackageMetadata.unavailable("offline"))
    try {
      const decision = await evaluate("npm install lodash", true)
      expect(decision).toMatchObject({ action: "ask", hard: true, reasonCode: "PACKAGE_UNVERIFIED" })
    } finally {
      restore()
    }
  })

  test("non-package commands never consult the provider", async () => {
    let calls = 0
    const counting: PackageMetadata.Provider = {
      id: "counting",
      lookup: (name) =>
        Effect.suspend(() => {
          calls += 1
          return provider.lookup(name)
        }),
    }
    const restore = PackageMetadata.use(counting)
    try {
      await evaluate("npm test", true)
      await evaluate("npm run build", true)
      await evaluate("ls -la", true)
      await evaluate("git status", true)
      expect(calls).toBe(0)
    } finally {
      restore()
    }
  })
})
