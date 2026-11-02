import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { RunError, run } from "../src/coordinator"
import { manifest } from "../src/scenarios"
import { command, options, readEvidence, rejected, sandbox } from "./helpers"

describe("coordinator success", () => {
  test("runs local and cloud cells with normalized evidence and clean teardown", async () => {
    for (const lane of ["local", "cloud"] as const) {
      await sandbox(async (dir) => {
        const runId = `run-${lane}`
        const evidence = await run(options(dir, { manifest: manifest("session.open", lane), runId }))
        expect(evidence.outcome).toBe("passed")
        expect(evidence.lane).toBe(lane)
        expect(evidence.cleanup.status).toBe("clean")
        expect(evidence.cleanup.removed).toHaveLength(2)
        expect(evidence.provenance.kiloCommit).toBe("1".repeat(40))
        expect(evidence.provenance.cloudCommit).toBe("2".repeat(40))
        expect(evidence.assertions.some((assertion) => assertion.name === "environment.credentials")).toBe(true)
        expect(evidence.assertions.some((assertion) => assertion.name === "transcript.visible")).toBe(true)

        const runDir = join(dir, runId)
        expect(await Bun.file(join(runDir, "descriptor.json")).exists()).toBe(false)
        const providerRequest = await Bun.file(join(runDir, "provider-prepare-request.json")).text()
        const driverRequest = await Bun.file(join(runDir, "driver-request.json")).text()
        const driverResult = await Bun.file(join(runDir, "driver-result.json")).text()
        for (const document of [providerRequest, driverRequest, driverResult, JSON.stringify(evidence)]) {
          expect(document).not.toContain("fake-key-")
          expect(document).not.toContain("cleanup-")
        }

        const stored = await readEvidence(dir, runId)
        expect(stored.runId).toBe(runId)
        expect(stored.cleanup.removed).toHaveLength(2)
      })
    }
  })

  test("creates a deterministic project commit across runs", async () => {
    await sandbox(async (dir) => {
      const first = await run(options(dir, { runId: "first" }))
      const second = await run(options(dir, { runId: "second" }))
      expect(first.lastState.projectCommit).toBe(second.lastState.projectCommit)
    })
  })

  test("strips ambient Kilo credentials before running the driver", async () => {
    const previous = process.env.KILO_API_KEY
    process.env.KILO_API_KEY = "ambient-secret"
    try {
      await sandbox(async (dir) => {
        const evidence = await run(options(dir))
        expect(evidence.outcome).toBe("passed")
        expect(evidence.assertions.find((assertion) => assertion.name === "environment.credentials")?.status).toBe(
          "passed",
        )
        expect(JSON.stringify(evidence)).not.toContain("ambient-secret")
      })
    } finally {
      if (previous === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = previous
    }
  })
})

describe("coordinator cleanup guarantees", () => {
  test("cleans up after an assertion failure", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(options(dir, { driver: { id: "fake-driver", command: command("driver-fail.ts") } })),
      )
      expect(error.code).toBe("driver_failed")
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("failed")
      expect(evidence.cleanup.removed).toHaveLength(2)
      expect(evidence.assertions.find((assertion) => assertion.name === "transcript.visible")?.status).toBe("failed")
    })
  })

  test("cleans up after a driver crash", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(options(dir, { driver: { id: "fake-driver", command: command("driver-crash.ts") } })),
      )
      expect(error.code).toBe("driver_crash")
      expect(error.evidencePath).toBe(join(dir, "run", "evidence.json"))
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("failed")
      expect(evidence.cleanup.removed).toHaveLength(2)
      expect(await Bun.file(join(dir, "run", "descriptor.json")).exists()).toBe(false)
    })
  })

  test("cleans up after driver cancellation", async () => {
    await sandbox(async (dir) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 200)
      try {
        const error = await rejected(
          run(
            options(dir, {
              driver: { id: "fake-driver", command: command("driver-slow.ts") },
              signal: controller.signal,
              timeouts: { provider: 15_000, driver: 10_000 },
            }),
          ),
        )
        expect(error.code).toBe("cancelled")
      } finally {
        clearTimeout(timer)
      }
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("cancelled")
      expect(evidence.cleanup.status).toBe("clean")
      expect(evidence.cleanup.removed).toHaveLength(2)
    })
  })

  test("cleans up after an invalid driver result", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(options(dir, { driver: { id: "fake-driver", command: command("driver-invalid.ts") } })),
      )
      expect(error.code).toBe("driver_result")
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("failed")
      expect(evidence.cleanup.removed).toHaveLength(2)
    })
  })

  test("escalates to SIGKILL when a driver ignores SIGTERM", async () => {
    await sandbox(async (dir) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 300)
      try {
        const error = await rejected(
          run(
            options(dir, {
              driver: { id: "fake-driver", command: command("driver-ignore-term.ts") },
              signal: controller.signal,
              timeouts: { provider: 15_000, driver: 15_000 },
            }),
          ),
        )
        expect(error.code).toBe("cancelled")
      } finally {
        clearTimeout(timer)
      }
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("cancelled")
      expect(evidence.cleanup.removed).toHaveLength(2)
    })
  })

  test("cleans up after provider prepare failure", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(options(dir, { provider: { id: "fake-provider", command: command("provider-prepare-fail.ts") } })),
      )
      expect(error.code).toBe("provider_failed")
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("failed")
      expect(evidence.cleanup.status).toBe("clean")
      expect(await Bun.file(join(dir, "run", "descriptor.json")).exists()).toBe(false)
    })
  })
})

describe("coordinator rejection paths", () => {
  test("rejects secret-bearing driver evidence and persists only a sanitized report", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(options(dir, { driver: { id: "fake-driver", command: command("driver-secret.ts") } })),
      )
      expect(error.code).toBe("evidence")
      const text = await Bun.file(join(dir, "run", "evidence.json")).text()
      expect(text).not.toContain("authorization")
      expect(text).not.toContain("sk-live-secret")
      expect(text).not.toContain("Bearer")
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("failed")
      expect(evidence.lastState).toEqual({})
      expect(evidence.cleanup.status).toBe("clean")
      expect(evidence.assertions.find((assertion) => assertion.name === "evidence.schema")?.status).toBe("failed")
    })
  })

  test("fails the run when cleanup fails", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(options(dir, { provider: { id: "fake-provider", command: command("provider-cleanup-fail.ts") } })),
      )
      expect(error.code).toBe("cleanup_failed")
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("failed")
      expect(evidence.cleanup.status).toBe("failed")
      expect(evidence.cleanup.leftovers).toHaveLength(2)
      expect(evidence.assertions.find((assertion) => assertion.name === "cleanup.complete")?.status).toBe("failed")
      expect(await Bun.file(join(dir, "run", "descriptor.json")).exists()).toBe(true)
    })
  })

  test("records owned resources when cleanup exits without a result", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(options(dir, { provider: { id: "fake-provider", command: command("provider-cleanup-crash.ts") } })),
      )
      expect(error.code).toBe("cleanup_failed")
      const evidence = await readEvidence(dir)
      expect(evidence.cleanup.status).toBe("failed")
      expect(evidence.cleanup.leftovers.map((resource) => resource.kind)).toEqual(["workspace", "cloud-session"])
      expect(JSON.stringify(evidence)).not.toContain("cleanup-")
      expect(await Bun.file(join(dir, "run", "descriptor.json")).exists()).toBe(true)
    })
  })

  test("recovers owned resources from the on-disk descriptor when prepare validation and cleanup both fail", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(
          options(dir, { provider: { id: "fake-provider", command: command("provider-bad-prepare-cleanup-fail.ts") } }),
        ),
      )
      expect(error.code).toBe("provider_result")
      const evidence = await readEvidence(dir)
      expect(evidence.cleanup.status).toBe("failed")
      expect(evidence.cleanup.removed.map((resource) => `${resource.kind}:${resource.id}`)).toEqual([
        "workspace:ws-run",
      ])
      expect(evidence.cleanup.leftovers.map((resource) => `${resource.kind}:${resource.id}`)).toEqual([
        "cloud-session:cs-run",
      ])
      expect(evidence.cleanup.error).toBe("fixture provider cleanup did not complete")
      expect(evidence.cleanup.leftovers.every((resource) => resource.reason.length > 0)).toBe(true)
      const text = await Bun.file(join(dir, "run", "evidence.json")).text()
      expect(text).not.toContain("cleanup-run")
      expect(await Bun.file(join(dir, "run", "descriptor.json")).exists()).toBe(true)
    })
  })

  test("allows no-op cleanup", async () => {
    await sandbox(async (dir) => {
      const evidence = await run(
        options(dir, { provider: { id: "fake-provider", command: command("provider-noop.ts") } }),
      )
      expect(evidence.outcome).toBe("passed")
      expect(evidence.cleanup.status).toBe("clean")
      expect(evidence.cleanup.removed).toEqual([])
      expect(evidence.cleanup.leftovers).toEqual([])
    })
  })

  test("rejects a non-loopback fixture descriptor", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(options(dir, { provider: { id: "fake-provider", command: command("provider-bad-origin.ts") } })),
      )
      expect(error.code).toBe("origin")
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("failed")
      expect(evidence.cleanup.removed).toHaveLength(2)
    })
  })

  test("rejects a driver that lacks a required capability", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(
        run(
          options(dir, {
            manifest: manifest("permission.continue", "cloud"),
            driver: { id: "fake-driver", command: command("driver-capability.ts") },
          }),
        ),
      )
      expect(error.code).toBe("capability")
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("failed")
      expect(evidence.cleanup.removed).toHaveLength(2)
    })
  })

  test("rejects an unsafe run id before touching the filesystem", async () => {
    await sandbox(async (dir) => {
      const error = await rejected(run(options(dir, { runId: "../escape" })))
      expect(error.code).toBe("config")
    })
  })

  test("rejects a reused run directory instead of reading stale results", async () => {
    await sandbox(async (dir) => {
      const first = await run(options(dir))
      expect(first.outcome).toBe("passed")
      const error = await rejected(
        run(options(dir, { driver: { id: "fake-driver", command: command("driver-crash.ts") } })),
      )
      expect(error.code).toBe("config")
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("passed")
    })
  })

  test("allows only one concurrent run to claim a run id", async () => {
    await sandbox(async (dir) => {
      const driver = { id: "fake-driver", command: command("driver.ts") }
      const results = await Promise.allSettled([
        run(options(dir, { driver })),
        run(options(dir, { driver })),
        run(options(dir, { driver })),
      ])
      const passed = results.filter((result) => result.status === "fulfilled")
      const failed = results.filter((result) => result.status === "rejected")
      expect(passed).toHaveLength(1)
      expect(failed).toHaveLength(2)
      for (const result of failed) {
        if (result.status !== "rejected") continue
        expect(result.reason).toBeInstanceOf(RunError)
        expect((result.reason as RunError).code).toBe("config")
      }
      const evidence = await readEvidence(dir)
      expect(evidence.outcome).toBe("passed")
      expect(evidence.cleanup.status).toBe("clean")
    })
  })
})
