import { describe, expect, test } from "bun:test"
import path from "path"
import { bin, clean } from "../../src/browser/bin"

describe("re-running the CLI as a child process", () => {
  test("passes the script as an absolute path for an installed shim", () => {
    const cmd = bin({ argv: ["/usr/bin/bun", "src/index.ts"], execArgv: [], execPath: "/usr/bin/bun" })
    expect(cmd).toStrictEqual(["/usr/bin/bun", path.resolve("src/index.ts")])
  })

  test("drops --cwd, which is relative to the developer's shell", () => {
    const cmd = bin({
      argv: ["/usr/bin/bun", "packages/kilo-cli/src/index.ts"],
      execArgv: ["--cwd", "packages/kilo-cli", "--conditions=browser"],
      execPath: "/usr/bin/bun",
    })
    expect(cmd).toStrictEqual(["/usr/bin/bun", "--conditions=browser", path.resolve("packages/kilo-cli/src/index.ts")])
    expect(clean(["--cwd=packages/kilo-cli", "--smol"])).toStrictEqual(["--smol"])
  })

  test("uses the executable alone for a bundled binary", () => {
    expect(
      bin({ argv: ["/opt/kilo", "/$bunfs/root/kilo"], execArgv: ["--smol"], execPath: "/opt/kilo" }),
    ).toStrictEqual(["/opt/kilo"])
  })
})
