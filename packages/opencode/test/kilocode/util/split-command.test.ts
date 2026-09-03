import { describe, expect, test } from "bun:test"
import { splitCommand } from "@/kilocode/util/split-command"

describe("splitCommand", () => {
  test("honors quoted segments with spaces", () => {
    expect(splitCommand("code --wait")).toEqual(["code", "--wait"])
    expect(splitCommand('"/Applications/My Editor.app/editor" --wait')).toEqual([
      "/Applications/My Editor.app/editor",
      "--wait",
    ])
    expect(splitCommand("'/path with space/editor'")).toEqual(["/path with space/editor"])
  })
})
