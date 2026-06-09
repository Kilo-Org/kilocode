import { describe, expect, it } from "bun:test"
import { dict as en } from "../../webview-ui/agent-manager/i18n/en"
import { cloudStatusError, cloudStatusKey } from "../../webview-ui/src/components/chat/cloud-status-label"

const steps = [
  ["disk_check", "agentManager.cloud.status.diskCheck"],
  ["workspace_setup", "agentManager.cloud.status.workspaceSetup"],
  ["cloning", "agentManager.cloud.status.cloning"],
  ["branch", "agentManager.cloud.status.branch"],
  ["devcontainer_setup", "agentManager.cloud.status.devcontainerSetup"],
  ["setup_commands", "agentManager.cloud.status.setupCommands"],
  ["kilo_server", "agentManager.cloud.status.kiloServer"],
  ["kilo_session", "agentManager.cloud.status.kiloSession"],
  ["ready", "agentManager.cloud.status.ready"],
  ["failed", "agentManager.cloud.status.failed"],
] as const

describe("cloud status label", () => {
  it("hides absent and ready cloud status", () => {
    expect(cloudStatusKey()).toBeUndefined()
    expect(cloudStatusKey({ type: "ready" })).toBeUndefined()
  })

  it("maps every allowlisted step to an existing English label", () => {
    for (const [step, expected] of steps) {
      const key = cloudStatusKey({ type: "preparing", step })
      expect(key).toBe(expected)
      expect(key && en[key]).toBeDefined()
    }
  })

  it("uses type fallbacks when no step is present", () => {
    const preparing = cloudStatusKey({ type: "preparing" })
    const finalizing = cloudStatusKey({ type: "finalizing" })
    expect(preparing).toBe("agentManager.cloud.status.preparing")
    expect(finalizing).toBe("agentManager.cloud.status.finalizing")
    expect(preparing && en[preparing]).toBeDefined()
    expect(finalizing && en[finalizing]).toBeDefined()
  })

  it("always maps and presents error and failed as setup failures", () => {
    const error = { type: "error", step: "cloning" } as const
    const failed = { type: "preparing", step: "failed" } as const
    expect(cloudStatusKey(error)).toBe("agentManager.cloud.status.failed")
    expect(cloudStatusKey(failed)).toBe("agentManager.cloud.status.failed")
    expect(cloudStatusError(error)).toBeTrue()
    expect(cloudStatusError(failed)).toBeTrue()
    expect(cloudStatusError({ type: "preparing", step: "cloning" })).toBeFalse()
  })
})
