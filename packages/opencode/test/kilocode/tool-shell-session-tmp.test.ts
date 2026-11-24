import { afterAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { forLocalSession } from "../../src/kilocode/tool/shell-tmp"

const sessionIDs = [`codex-${randomUUID()}`, `codex-${randomUUID()}`] as const
const sessionDirs = sessionIDs.map((id) => path.join(Global.Path.tmp, id))
const sharedDescription = `Use \`${Global.Path.tmp}\` for temporary work outside the workspace.`

const withCloudAgentDisabled = async <T>(run: () => Promise<T>) => {
  const original = process.env.KILO_CLOUD_AGENT
  delete process.env.KILO_CLOUD_AGENT
  try {
    return await run()
  } finally {
    if (original === undefined) delete process.env.KILO_CLOUD_AGENT
    else process.env.KILO_CLOUD_AGENT = original
  }
}

describe("local shell session temp paths", () => {
  afterAll(async () => {
    await Promise.all(sessionDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test("keeps parallel sessions' temporary files in separate directories", async () => {
    await withCloudAgentDisabled(async () => {
      const firstDescription = forLocalSession(sharedDescription, sessionIDs[0])
      const secondDescription = forLocalSession(sharedDescription, sessionIDs[1])
      const firstPath = path.join(Global.Path.tmp, sessionIDs[0])
      const secondPath = path.join(Global.Path.tmp, sessionIDs[1])

      expect(firstDescription).toContain(`Use \`${firstPath}\` for temporary work`)
      expect(secondDescription).toContain(`Use \`${secondPath}\` for temporary work`)
      expect(firstPath).not.toBe(secondPath)

      await Promise.all([
        fs.writeFile(path.join(firstPath, "same-name.txt"), "first session"),
        fs.writeFile(path.join(secondPath, "same-name.txt"), "second session"),
      ])

      expect(await fs.readFile(path.join(firstPath, "same-name.txt"), "utf8")).toBe("first session")
      expect(await fs.readFile(path.join(secondPath, "same-name.txt"), "utf8")).toBe("second session")
    })
  })

  test("leaves the shared description unchanged for an unsafe session id", async () => {
    await withCloudAgentDisabled(async () => {
      expect(forLocalSession(sharedDescription, "../outside")).toBe(sharedDescription)
    })
  })
})
