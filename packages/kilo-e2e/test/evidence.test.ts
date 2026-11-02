import { describe, expect, test } from "bun:test"
import { EvidenceError, parseDriverResult } from "../src/evidence"
import {
  FixtureDescriptor,
  SCHEMA_VERSION,
  type Assertion,
  type DriverResult,
  type ScenarioManifest,
} from "../src/schema"
import { join } from "node:path"
import { ProtocolError, readJsonAs, writeJson } from "../src/protocol"
import { sandbox } from "./helpers"
import { manifest } from "../src/scenarios"

function result(scenario: ScenarioManifest, overrides: Partial<DriverResult> = {}): DriverResult {
  const assertions: Assertion[] = [...scenario.expected.ui, ...scenario.expected.model].map((name) => ({
    name,
    status: "passed",
  }))
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run",
    scenarioId: scenario.id,
    lane: scenario.lane,
    driver: { id: "fake-driver", version: "0.0.0" },
    ide: { name: "fake-ide", version: "0.0.0" },
    provenance: { clientHash: null, cliHash: null },
    capabilities: scenario.requires,
    outcome: "passed",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    assertions,
    lastState: {},
    artifacts: { logs: [], screenshots: [], snapshots: [] },
    ...overrides,
  }
}

describe("driver result consistency", () => {
  const scenario = manifest("prompt.stream", "local")

  test("accepts a passed result with every expected assertion", () => {
    expect(parseDriverResult(result(scenario), scenario, "run").outcome).toBe("passed")
  })

  test("rejects a passed result that omits an expected assertion", () => {
    const missing = scenario.expected.ui[0]
    const candidate = result(scenario, {
      assertions: result(scenario).assertions.filter((assertion) => assertion.name !== missing),
    })
    expect(() => parseDriverResult(candidate, scenario, "run")).toThrow(EvidenceError)
    try {
      parseDriverResult(candidate, scenario, "run")
    } catch (error) {
      expect((error as EvidenceError).code).toBe("mismatch")
    }
  })

  test("rejects a passed result that contradicts a failed assertion", () => {
    const candidate = result(scenario, {
      assertions: [...result(scenario).assertions, { name: "extra", status: "failed" }],
    })
    expect(() => parseDriverResult(candidate, scenario, "run")).toThrow(EvidenceError)
  })

  test("allows a failed result with missing or failed assertions", () => {
    const candidate = result(scenario, {
      outcome: "failed",
      assertions: [{ name: "assistant.streaming", status: "failed" }],
    })
    expect(parseDriverResult(candidate, scenario, "run").outcome).toBe("failed")
  })

  test("rejects missing capabilities", () => {
    const candidate = result(scenario, { capabilities: ["transcript.read"] })
    try {
      parseDriverResult(candidate, scenario, "run")
    } catch (error) {
      expect((error as EvidenceError).code).toBe("capability")
      return
    }
    throw new Error("expected capability rejection")
  })
})

describe("malformed subprocess results", () => {
  test("rejection messages do not echo document content", async () => {
    await sandbox(async (dir) => {
      const file = join(dir, "result.json")
      await writeJson(file, { schemaVersion: SCHEMA_VERSION, descriptorPath: "secret-value" })
      try {
        await readJsonAs(file, FixtureDescriptor)
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolError)
        expect((error as Error).message).not.toContain("secret-value")
        return
      }
      throw new Error("expected a protocol error")
    })
  })
})
