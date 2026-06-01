import { afterEach, describe, expect, it } from "bun:test"
import * as os from "os"
import * as path from "path"
import { globalConfigDir } from "../../src/shared/global-config-dir"

const env = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }

afterEach(() => {
  if (env.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME
})

describe("globalConfigDir", () => {
  it("uses XDG_CONFIG_HOME/kilo when set", () => {
    const root = path.join(os.tmpdir(), "kilo-xdg-test")
    process.env.XDG_CONFIG_HOME = root
    expect(globalConfigDir()).toBe(path.join(root, "kilo"))
  })

  it("uses ~/.config/kilo on Windows (matches CLI xdg-basedir)", () => {
    delete process.env.XDG_CONFIG_HOME
    if (process.platform !== "win32") return
    expect(globalConfigDir()).toBe(path.join(os.homedir(), ".config", "kilo"))
  })
})
