import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { scanning } from "@opencode-ai/core/kilocode/fff"

describe("FFF scanning boundaries", () => {
  test("enables filesystem-root scanning only at the exact root", () => {
    const root = path.parse(process.cwd()).root
    expect(scanning(root)).toEqual({ enableFsRootScanning: true, enableHomeDirScanning: root === os.homedir() })
    expect(scanning(path.join(root, "workspace"))).toEqual({
      enableFsRootScanning: false,
      enableHomeDirScanning: false,
    })
  })

  test("enables home scanning only at the exact home directory", () => {
    const home = os.homedir()
    expect(scanning(home)).toEqual({
      enableFsRootScanning: home === path.parse(home).root,
      enableHomeDirScanning: true,
    })
    expect(scanning(path.join(home, "workspace"))).toEqual({
      enableFsRootScanning: false,
      enableHomeDirScanning: false,
    })
  })
})
