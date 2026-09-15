// kilocode_change - new file
import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "os"
import path from "path"
import { ShellPrompt } from "../../src/tool/shell/prompt"

// kilocode_change start - cloud sessions allowlist a session-scoped temp dir, so the
// bash tool description must name a path the injected external_directory rules permit
const sharedTmp = path.join(os.tmpdir(), "kilo")
const sessionTmp = path.join(os.tmpdir(), "agent_test-session_1")

const withEnv = (env: Record<string, string | undefined>, run: () => void) => {
  const saved = Object.entries(env).map(([key]) => [key, process.env[key]] as const)
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    run()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const renderBash = () => ShellPrompt.render("bash", "linux", { maxLines: 100, maxBytes: 100 }, 1000).description

describe("tool.shell prompt tmp", () => {
  afterAll(async () => {
    await fs.rm(sessionTmp, { recursive: true, force: true })
    await fs.rm(path.join(os.tmpdir(), "agent_symlink-test"), { force: true })
  })

  test("names the shared temp dir outside cloud sessions", () => {
    withEnv({ KILO_CLOUD_AGENT: undefined, SESSION_ID: undefined }, () => {
      expect(renderBash()).toContain(`Use \`${sharedTmp}\` for temporary work`)
    })
  })

  test("names the session-scoped temp dir in cloud sessions", () => {
    withEnv({ KILO_CLOUD_AGENT: "1", SESSION_ID: "agent_test-session_1" }, () => {
      expect(renderBash()).toContain(`Use \`${sessionTmp}\` for temporary work`)
    })
  })

  test("accepts truthy KILO_CLOUD_AGENT case-insensitively", () => {
    withEnv({ KILO_CLOUD_AGENT: "TRUE", SESSION_ID: "agent_test-session_1" }, () => {
      expect(renderBash()).toContain(`Use \`${sessionTmp}\` for temporary work`)
    })
  })

  test("creates the session-scoped temp dir in cloud sessions", async () => {
    withEnv({ KILO_CLOUD_AGENT: "1", SESSION_ID: "agent_test-session_1" }, () => {
      renderBash()
    })
    const stat = await fs.stat(sessionTmp)
    expect(stat.isDirectory()).toBe(true)
  })

  test("falls back to the shared temp dir when the session id is unsafe", () => {
    withEnv({ KILO_CLOUD_AGENT: "1", SESSION_ID: "agent/../escape" }, () => {
      expect(renderBash()).toContain(`Use \`${sharedTmp}\` for temporary work`)
    })
  })

  test("falls back to the shared temp dir when SESSION_ID is missing", () => {
    withEnv({ KILO_CLOUD_AGENT: "1", SESSION_ID: undefined }, () => {
      expect(renderBash()).toContain(`Use \`${sharedTmp}\` for temporary work`)
    })
  })

  test("falls back to the shared temp dir when the session path is a symlink", async () => {
    if (process.platform === "win32") return
    const link = path.join(os.tmpdir(), "agent_symlink-test")
    await fs.symlink(sharedTmp, link)
    try {
      withEnv({ KILO_CLOUD_AGENT: "1", SESSION_ID: "agent_symlink-test" }, () => {
        expect(renderBash()).toContain(`Use \`${sharedTmp}\` for temporary work`)
      })
    } finally {
      await fs.rm(link, { force: true })
    }
  })
})
// kilocode_change end
