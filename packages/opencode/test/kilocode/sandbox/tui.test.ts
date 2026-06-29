import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { indicator } from "@/kilocode/plugins/sandbox"

const source = path.resolve(import.meta.dir, "../../../src/kilocode/plugins/sandbox.tsx")

describe("sandbox TUI", () => {
  test("shows an indicator only for an active available sandbox", () => {
    expect(indicator({ directory: "/repo", enabled: true, available: true, version: 1 })).toBe("◆ Sandbox on")
    expect(indicator({ directory: "/repo", enabled: false, available: true, version: 2 })).toBeUndefined()
    expect(
      indicator({ directory: "/repo", enabled: false, available: false, reason: "unavailable", version: 0 }),
    ).toBeUndefined()
  })

  test("keeps the prompt status contribution mounted while inactive", () => {
    const content = fs.readFileSync(source, "utf8")
    expect(content).toContain("<box flexShrink={0}>")
    expect(content).toContain('indicator(props.status().get(props.sessionID)) ?? ""')
  })

  test("keeps the session override available independently of the persistent default", () => {
    const content = fs.readFileSync(source, "utf8")
    expect(content).not.toContain("enabled: () =>")
    expect(content).toContain("await ensureSession(api)")
    expect(content).toContain("api.client.session.create")
    expect(content).toContain('api.route.navigate("session", { sessionID })')
    expect(content).toContain("props.api.state.config.experimental?.sandbox")
    expect(content).toContain("void props.load(props.sessionID, true)")
    expect(content).toContain('api.event.on("sandbox.status.changed"')
  })
})
