import { describe, expect, test } from "bun:test"
import { Equal, Hash } from "effect"
import { readFileSync } from "node:fs"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"

const opencode = new URL("../../src/", import.meta.url)
const server = new URL("../../../server/src/", import.meta.url)

function source(root: URL, path: string) {
  return readFileSync(new URL(path, root), "utf8")
}

describe("shared location service map keys", () => {
  test("all location route consumers include workspaceID in their cache key", () => {
    const consumers = [
      [opencode, "server/routes/instance/httpapi/handlers/file.ts"],
      [opencode, "server/routes/instance/httpapi/handlers/pty.ts"],
      [server, "middleware/session-location.ts"],
    ] as const

    for (const [root, path] of consumers) {
      expect(source(root, path), path).toMatch(/Location\.Ref\.make\(\{[^}]*workspaceID/)
    }
  })

  test("omitted and explicit undefined workspace IDs are distinct keys", () => {
    const directory = AbsolutePath.make("/workspace")
    const omitted = Location.Ref.make({ directory })
    const explicit = Location.Ref.make({ directory, workspaceID: undefined })

    expect(Object.hasOwn(omitted, "workspaceID")).toBe(false)
    expect(Object.hasOwn(explicit, "workspaceID")).toBe(true)
    expect(Equal.equals(omitted, explicit)).toBe(false)
    expect(Hash.hash(omitted)).not.toBe(Hash.hash(explicit))
  })
})
