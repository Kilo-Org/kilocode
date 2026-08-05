import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { RunController, type RunTaskConfig } from "../../src/agent-manager/run/controller"
import type { RunStatus } from "../../src/agent-manager/run/manager"
import type { RunTerminalDestination } from "../../src/agent-manager/run/destination"

const destination: RunTerminalDestination = "vscode"

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "kilo-run-controller-"))
  const configs: RunTaskConfig[] = []
  const statuses: RunStatus[] = []
  const controller = new RunController({
    root: () => root,
    state: () => undefined,
    open: () => Promise.resolve(),
    start: (config, done) => {
      configs.push(config)
      return Promise.resolve({ stop: () => done({ stopped: true }) })
    },
    post: (status) => statuses.push(status),
    error: () => undefined,
    log: () => undefined,
  })
  return { root, configs, statuses, controller, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe("RunController local key scoping", () => {
  it("resolves a project-qualified local key to the repo root", async () => {
    const { root, configs, controller, cleanup } = setup()
    try {
      await controller.configure()
      await controller.run("prj-a:local", destination)

      expect(configs).toHaveLength(1)
      expect(configs[0]!.worktreeId).toBe("prj-a:local")
      expect(configs[0]!.cwd).toBe(root)
      expect(configs[0]!.branch).toBe("local")
    } finally {
      cleanup()
    }
  })

  it("keeps two projects' local runs as independent entries", async () => {
    const { statuses, controller, cleanup } = setup()
    try {
      await controller.configure()
      await controller.run("prj-a:local", destination)
      await controller.run("prj-b:local", destination)

      // Starting B must not stop A: both entries report running.
      const all = controller.state().runStatuses
      expect(all.find((s) => s.worktreeId === "prj-a:local")?.state).toBe("running")
      expect(all.find((s) => s.worktreeId === "prj-b:local")?.state).toBe("running")

      // Stopping A leaves B untouched.
      controller.stop("prj-a:local")
      await new Promise((resolve) => setTimeout(resolve, 10))
      const after = controller.state().runStatuses
      expect(after.find((s) => s.worktreeId === "prj-a:local")?.state).not.toBe("running")
      expect(after.find((s) => s.worktreeId === "prj-b:local")?.state).toBe("running")
      expect(statuses.some((s) => s.worktreeId === "prj-a:local" && s.state === "stopping")).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("still treats the legacy unqualified local key as local", async () => {
    const { root, configs, controller, cleanup } = setup()
    try {
      await controller.configure()
      await controller.run("local", destination)

      expect(configs[0]!.worktreeId).toBe("local")
      expect(configs[0]!.cwd).toBe(root)
      expect(configs[0]!.branch).toBe("local")
    } finally {
      cleanup()
    }
  })
})
