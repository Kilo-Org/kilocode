import { describe, expect, test } from "bun:test"
import { permissionOptions, mcpEnvelope } from "../../src/routes/session/permission-view"

describe("permissionOptions — interactive-only requests never offer 'Allow always'", () => {
  test("actionGateDegraded -> only Allow once / Reject (no always)", () => {
    const o = permissionOptions({ actionGateDegraded: true }, false)
    expect(o).toEqual({ once: "Allow once", reject: "Reject" })
    expect(o.always).toBeUndefined()
  })
  test("skillShell / sandboxEscalation -> no always", () => {
    expect(permissionOptions({ skillShell: true }, false).always).toBeUndefined()
    expect(permissionOptions({ sandboxEscalation: true }, false).always).toBeUndefined()
  })
  test("ordinary request -> offers Allow always", () => {
    expect(permissionOptions({}, false).always).toBe("Allow always")
  })
  test("config-protection disableAlways -> no always", () => {
    expect(permissionOptions({}, true).always).toBeUndefined()
  })
})

describe("mcpEnvelope — safe view: server + tool + argument KEY names, never values", () => {
  test("extracts server/tool/argKeys and carries no argument value", () => {
    const env = mcpEnvelope({ server: "github", tool: "create_issue", argKeys: ["title", "token"] })
    expect(env).toEqual({ server: "github", tool: "create_issue", argKeys: ["title", "token"] })
    expect(JSON.stringify(env).includes("SECRET")).toBe(false) // only key NAMES present, no values
  })
  test("undefined when no envelope present", () => {
    expect(mcpEnvelope({})).toBeUndefined()
    expect(mcpEnvelope(undefined)).toBeUndefined()
  })
})
