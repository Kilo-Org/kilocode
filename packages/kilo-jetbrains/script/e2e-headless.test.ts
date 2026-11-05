import { describe, expect, test } from "bun:test"
import { cellRunId } from "./e2e-cell"
import {
  STACK_SERVICES,
  UsageError,
  downServices,
  failureHint,
  parseArgs,
  parseJavaMajor,
  parseStackStatus,
  providerLogName,
  renderSummary,
  resolveEnvironment,
  validRunId,
  type CellResult,
} from "./e2e-headless-lib"

const defaults = { artifacts: "/tmp/kilo-e2e-artifacts" }

describe("parseArgs", () => {
  test("defaults to both lanes, session.open, and automatic stack/display handling", () => {
    const options = parseArgs([], defaults)
    expect(options.lanes).toEqual(["local", "cloud"])
    expect(options.scenarios).toEqual(["session.open"])
    expect(options.stack).toBe("auto")
    expect(options.display).toBe("auto")
    expect(options.keepStack).toBe(false)
    expect(options.artifacts).toBe(defaults.artifacts)
  })

  test("selects one lane and resolves the Cloud checkout", () => {
    const options = parseArgs(["--lane", "cloud", "--cloud-repo", "./cloud"], defaults)
    expect(options.lanes).toEqual(["cloud"])
    expect(options.cloud).toBe(`${process.cwd()}/cloud`)
  })

  test("accepts comma-separated and repeated scenarios without duplicates", () => {
    const options = parseArgs(
      ["--scenario", "session.open,prompt.stream", "--scenario", "prompt.stream"],
      defaults,
    )
    expect(options.scenarios).toEqual(["session.open", "prompt.stream"])
  })

  test("keeps help and keep-stack booleans independent of values", () => {
    const options = parseArgs(["--help", "--keep-stack"], defaults)
    expect(options.help).toBe(true)
    expect(options.keepStack).toBe(true)
  })

  test("rejects unknown flags, lanes, scenarios, stack modes, and unsafe run ids", () => {
    expect(() => parseArgs(["--nope"], defaults)).toThrow(UsageError)
    expect(() => parseArgs(["--lane", "desktop"], defaults)).toThrow(UsageError)
    expect(() => parseArgs(["--scenario", "session.open,unknown"], defaults)).toThrow(UsageError)
    expect(() => parseArgs(["--stack", "always"], defaults)).toThrow(UsageError)
    expect(() => parseArgs(["--run-id", "../escape"], defaults)).toThrow(UsageError)
  })

  test("requires a value after value flags", () => {
    expect(() => parseArgs(["--lane"], defaults)).toThrow(UsageError)
    expect(() => parseArgs(["--cloud-repo", "--help"], defaults)).toThrow(UsageError)
  })
})

describe("environment fallbacks", () => {
  test("uses KILO_E2E_CLOUD_REPO and E2E_GIT_URL when flags are absent", () => {
    const options = resolveEnvironment(parseArgs([], defaults), {
      KILO_E2E_CLOUD_REPO: "./cloud",
      E2E_GIT_URL: "https://example.com/fixture.git",
    })
    expect(options.cloud).toBe(`${process.cwd()}/cloud`)
    expect(options.gitUrl).toBe("https://example.com/fixture.git")
  })

  test("flags win over environment values", () => {
    const options = resolveEnvironment(
      parseArgs(["--cloud-repo", "/tmp/flag-cloud", "--git-url", "https://flag.example/fixture.git"], defaults),
      { KILO_E2E_CLOUD_REPO: "/tmp/env-cloud", E2E_GIT_URL: "https://env.example/fixture.git" },
    )
    expect(options.cloud).toBe("/tmp/flag-cloud")
    expect(options.gitUrl).toBe("https://flag.example/fixture.git")
  })
})

describe("provider logs", () => {
  test("reads the prepare log for prepare failures and cleanup log for cleanup failures", () => {
    expect(providerLogName("provider_failed")).toBe("provider-prepare.log")
    expect(providerLogName("cleanup_failed")).toBe("provider-cleanup.log")
    expect(providerLogName("driver_failed")).toBe("provider-prepare.log")
  })
})

describe("stack status", () => {
  const json = JSON.stringify({
    session: "kilo-dev-cloud",
    services: [
      { name: "nextjs", port: 3000, status: "up" },
      { name: "cloud-agent-next", port: 3001, status: "up" },
      { name: "ai-gateway", port: 3002, status: "up" },
      { name: "fake-llm", port: 3003, status: "up" },
      { name: "postgres", port: 5432, status: "up" },
      { name: "container-usage-meter", port: 3004, status: "up" },
    ],
  })

  test("finds the JSON object after pnpm install noise", () => {
    const status = parseStackStatus(`Scope: all workspace projects\nDone in 43.8s\n${json}\n`)
    expect(status).toBeDefined()
    expect(downServices(status!)).toEqual([])
  })

  test("reports every required service when nothing is running", () => {
    const status = parseStackStatus('{"session":"kilo-dev-cloud","services":[]}')
    expect(status).toBeDefined()
    expect(downServices(status!)).toEqual([...STACK_SERVICES])
  })

  test("reports only the missing required services", () => {
    const status = parseStackStatus(
      JSON.stringify({
        services: [
          { name: "nextjs", port: 3000, status: "up" },
          { name: "fake-llm", port: 3003, status: "down" },
        ],
      }),
    )
    expect(downServices(status!)).toEqual([
      "cloud-agent-next",
      "ai-gateway",
      "fake-llm",
      "postgres",
      "container-usage-meter",
    ])
  })

  test("ignores non-status JSON and malformed output", () => {
    expect(parseStackStatus("not json")).toBeUndefined()
    expect(parseStackStatus('{"session":"x"}')).toBeUndefined()
    expect(parseStackStatus('{"services":[{"name":"nextjs"}]}')).toBeUndefined()
  })
})

describe("java versions", () => {
  test("parses modern and legacy version strings", () => {
    expect(parseJavaMajor('openjdk version "21.0.5" 2024-10-15 LTS')).toBe(21)
    expect(parseJavaMajor('openjdk version "25-ea" 2026-09-01')).toBe(25)
    expect(parseJavaMajor('java version "1.8.0_392"')).toBe(8)
  })

  test("returns undefined when no version is present", () => {
    expect(parseJavaMajor("java: command not found")).toBeUndefined()
  })
})

describe("run ids", () => {
  test("accepts safe path segments and rejects traversal", () => {
    expect(validRunId("jetbrains-headless-1793900000000")).toBe(true)
    expect(validRunId("session.open")).toBe(true)
    expect(validRunId("../escape")).toBe(false)
    expect(validRunId(".hidden")).toBe(false)
    expect(validRunId("a/b")).toBe(false)
  })

  test("sanitizes scenario dots for directory names", () => {
    expect(cellRunId("base", "session.open", "cloud")).toBe("base-session-open-cloud")
    expect(cellRunId("base", "permission.continue", "local")).toBe("base-permission-continue-local")
  })
})

describe("summary", () => {
  const cell = (overrides: Partial<CellResult> = {}): CellResult => ({
    scenario: "session.open",
    lane: "local",
    runId: "run-session-open-local",
    outcome: "passed",
    evidence: "run-session-open-local/evidence.json",
    failed: [],
    passed: 4,
    cleanup: { status: "clean", removed: 1, leftovers: 0 },
    ...overrides,
  })

  test("renders a passing matrix and exit code", () => {
    const summary = renderSummary({
      runId: "run",
      startedAt: "2026-11-05T00:00:00.000Z",
      endedAt: "2026-11-05T00:10:00.000Z",
      platform: "darwin-arm64",
      display: "macOS WindowServer (virtual display)",
      stack: "reused a running local stack",
      cleanup: "reused Cloud stack left running",
      kiloCommit: "abc",
      cloudCommit: "def",
      cells: [cell(), cell({ lane: "cloud", runId: "run-session-open-cloud" })],
      exitCode: 0,
    })
    expect(summary).toContain("# JetBrains headless E2E — run")
    expect(summary).toContain("| `local` | `session.open` | passed | 0 |")
    expect(summary).toContain("| `cloud` | `session.open` | passed | 0 |")
    expect(summary).toContain("- Cleanup: reused Cloud stack left running")
    expect(summary).toContain("## Exit code\n\n0")
  })

  test("renders failed assertions, hints, and non-zero exit codes", () => {
    const summary = renderSummary({
      runId: "run",
      startedAt: "2026-11-05T00:00:00.000Z",
      endedAt: "2026-11-05T00:10:00.000Z",
      platform: "linux-x64",
      display: "owned Xvfb :99",
      stack: "started by this run",
      cleanup: "owned Cloud stack stopped",
      kiloCommit: null,
      cloudCommit: null,
      cells: [
        cell({
          outcome: "failed",
          failure: { code: "driver_failed", message: "IDE driver reported a failed scenario" },
          providerLog: "provider exploded",
          failed: [{ name: "descriptor.valid", detail: "missing descriptor.json" }],
        }),
      ],
      exitCode: 1,
    })
    expect(summary).toContain("Result: **failed** (exit 1)")
    expect(summary).toContain("`local` `session.open` / `descriptor.valid`: missing descriptor.json")
    expect(summary).toContain("driver_failed")
    expect(summary).toContain(failureHint("driver_failed"))
    expect(summary).toContain("## Provider output")
    expect(summary).toContain("_Unsanitized local-stack output; review before sharing._")
    expect(summary).toContain("provider exploded")
  })

  test("distinguishes setup failures and cancellation", () => {
    const base = {
      runId: "run",
      startedAt: "2026-11-05T00:00:00.000Z",
      endedAt: "2026-11-05T00:00:01.000Z",
      platform: "darwin-arm64",
      display: "not started",
      stack: "not started",
      cleanup: "not required",
      kiloCommit: null,
      cloudCommit: null,
      cells: [],
    }
    expect(renderSummary({ ...base, exitCode: 2 })).toContain("Result: **preflight/setup failed** (exit 2)")
    expect(renderSummary({ ...base, exitCode: 130 })).toContain("Result: **cancelled** (exit 130)")
  })
})
