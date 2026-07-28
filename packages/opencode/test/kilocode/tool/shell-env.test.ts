import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { resolveServerFile } from "@/kilocode/tool/shell-env"

describe("resolveServerFile", () => {
  test("returns null when the server is not a vscode extension server", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "vscode-server-123.json"), "{}")
    expect(resolveServerFile({ stateDir: tmp.path, pid: 123, client: undefined })).toBeNull()
    expect(resolveServerFile({ stateDir: tmp.path, pid: 123, client: "daemon" })).toBeNull()
    expect(resolveServerFile({ stateDir: tmp.path, pid: 123, client: "" })).toBeNull()
  })

  test("returns null when the discovery file does not exist", async () => {
    await using tmp = await tmpdir()
    expect(resolveServerFile({ stateDir: tmp.path, pid: 123, client: "vscode" })).toBeNull()
  })

  test("returns the pid-keyed discovery file for a vscode extension server", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "vscode-server-123.json")
    await Bun.write(file, "{}")
    expect(resolveServerFile({ stateDir: tmp.path, pid: 123, client: "vscode" })).toBe(file)
  })

  test("does not match a different pid's discovery file", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "vscode-server-999.json"), "{}")
    expect(resolveServerFile({ stateDir: tmp.path, pid: 123, client: "vscode" })).toBeNull()
  })
})
